/**
 * 应用配置的加载、合并、校验与持久化。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import path from 'node:path'
import {
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  BALL_CUSTOM_FITS,
  BALL_ICONS,
  CONFIG_VERSION,
  CUSTOM_BALL_ICON,
  DEFAULT_BALL_CUSTOM_FIT,
  DEFAULT_BALL_ICON,
  DEFAULT_BOSS_HIDE,
  DEFAULT_BOSS_MINIMIZE,
  DEFAULT_HOME_THEME,
  DEFAULT_HOME_VIEW,
  DEFAULT_NEW_TAB_URL,
  DEFAULT_READER_FONT,
  DEFAULT_READER_LINE,
  DEFAULT_READER_MARGIN,
  DEFAULT_SEARCH_TEMPLATE,
  HIDE_DELAY_MS,
  HOME_THEMES,
  HOME_VIEWS,
  LEGACY_HOME_THEMES,
  LEGACY_PORTRAIT_SIZES,
  OPACITY_MAX,
  OPACITY_MIN,
  PERSIST_DEBOUNCE_MS,
  READER_OPACITY_MAX,
  READER_OPACITY_MIN
} from '@shared/constants'
import type { ConfigPatch } from '@shared/ipc'
import type {
  AppConfig,
  HomeTheme,
  StealthConfig,
  UiConfig,
  UpdateConfig,
  WindowConfig
} from '@shared/types'
import { DebouncedWriter, readJson } from './jsonFile'
import { log } from './logger'

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    window: {
      x: null,
      y: null,
      width: 960,
      height: 540,
      opacity: 1,
      alwaysOnTop: true,
      showInTaskbar: false
    },
    ui: {
      // 两条栏默认都在。隐藏是留给「只想留一颗球看网页」的场合的，
      // 默认藏起来会把第一次打开的人挡在门外。
      topBarOpen: true,
      railOpen: true,
      homeTheme: DEFAULT_HOME_THEME,
      // 默认列表：这是起始页一直以来的样子，升级过来的人看到的版面不该变
      homeView: DEFAULT_HOME_VIEW,
      // 默认不透明：底板是界面的一部分，一上来就是半透的会让人以为没画好
      backgroundOpacity: 1,
      // 正文默认不淡：这一条管的是「我在读的那点字」，一上来就淡着
      // 等于把可读性默认调低，而它的用处只在「想让它更不容易被看见」时才有
      readerOpacity: 1,
      // 阅读排版三项与书页原先写死的那组逐字相同（17px / 1.85 / 6%），
      // 因此这一版把写死的值搬进配置之后，老用户看到的版面一个像素都不变。
      readerFontSize: DEFAULT_READER_FONT,
      readerLineHeight: DEFAULT_READER_LINE,
      readerMargin: DEFAULT_READER_MARGIN,
      ballIcon: DEFAULT_BALL_ICON,
      ballCustomFit: DEFAULT_BALL_CUSTOM_FIT
    },
    stealth: {
      // 默认关闭：收起与否由用户点悬浮球决定，不自动发生。
      // 自动收起会让界面在用户没打算藏的时候忽然缩成一颗球，反而更容易被注意到。
      autoCollapse: false,
      hideDelayMs: HIDE_DELAY_MS,
      muteMediaOnCollapse: true,
      // 默认开：切走那一页就该停，切回来接着放——不会有两张标签同时出声，
      // 也不会切回来发现进度已经跑掉了。想「放着音乐翻别的页」的自己关掉。
      pauseMediaOnSwitch: true,
      contentProtection: false
    },
    hotkeys: {
      bossMinimize: DEFAULT_BOSS_MINIMIZE,
      bossHideToTray: DEFAULT_BOSS_HIDE
    },
    browser: {
      defaultUaMode: 'desktop',
      defaultZoom: 1,
      hideScrollbars: true,
      searchTemplate: DEFAULT_SEARCH_TEMPLATE,
      newWindowAsTab: true,
      newTabUrl: DEFAULT_NEW_TAB_URL
    },
    update: {
      // 默认开：装完就再也收不到消息的软件，等于把用户留在旧版本里。
      // 关掉之后程序不再自己联网，设置页里那个手动按钮仍然可用
      autoCheck: true,
      ignoredVersion: null
    },
    lastSession: { openUrls: [], activeIndex: 0 }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 逐字段校验并夹紧，防止手工改坏的配置文件让应用进入异常状态 */
function normalize(input: Partial<AppConfig> | null | undefined): AppConfig {
  const d = defaultConfig()
  if (!input || typeof input !== 'object') return d

  const h = { ...d.hotkeys, ...(input.hotkeys ?? {}) }
  const b = { ...d.browser, ...(input.browser ?? {}) }
  const ls = { ...d.lastSession, ...(input.lastSession ?? {}) }

  // window / ui / stealth 都逐字段取，而不是整段摊开：
  // 摊开会让已经从类型里去掉的旧字段（ballCorner / ballSize / miniMode /
  // lastNormalSize …）随着落盘的配置一路活下来，每次合并都把它们原样写回去，
  // 永远清不掉。删掉一个配置项时，这里也要跟着删一行。
  const w: WindowConfig = {
    x: typeof input.window?.x === 'number' ? input.window.x : d.window.x,
    y: typeof input.window?.y === 'number' ? input.window.y : d.window.y,
    width: input.window?.width ?? d.window.width,
    height: input.window?.height ?? d.window.height,
    opacity: input.window?.opacity ?? d.window.opacity,
    alwaysOnTop: input.window?.alwaysOnTop ?? d.window.alwaysOnTop,
    showInTaskbar: input.window?.showInTaskbar ?? d.window.showInTaskbar
  }

  const ui: UiConfig = {
    topBarOpen: input.ui?.topBarOpen ?? d.ui.topBarOpen,
    railOpen: input.ui?.railOpen ?? d.ui.railOpen,
    homeTheme: input.ui?.homeTheme ?? d.ui.homeTheme,
    homeView: input.ui?.homeView ?? d.ui.homeView,
    backgroundOpacity: input.ui?.backgroundOpacity ?? d.ui.backgroundOpacity,
    readerOpacity: input.ui?.readerOpacity ?? d.ui.readerOpacity,
    readerFontSize: input.ui?.readerFontSize ?? d.ui.readerFontSize,
    readerLineHeight: input.ui?.readerLineHeight ?? d.ui.readerLineHeight,
    readerMargin: input.ui?.readerMargin ?? d.ui.readerMargin,
    ballIcon: input.ui?.ballIcon ?? d.ui.ballIcon,
    ballCustomFit: input.ui?.ballCustomFit ?? d.ui.ballCustomFit
  }

  const s: StealthConfig = {
    autoCollapse: input.stealth?.autoCollapse ?? d.stealth.autoCollapse,
    hideDelayMs: input.stealth?.hideDelayMs ?? d.stealth.hideDelayMs,
    muteMediaOnCollapse: input.stealth?.muteMediaOnCollapse ?? d.stealth.muteMediaOnCollapse,
    pauseMediaOnSwitch: input.stealth?.pauseMediaOnSwitch ?? d.stealth.pauseMediaOnSwitch,
    contentProtection: input.stealth?.contentProtection ?? d.stealth.contentProtection
  }

  const u: UpdateConfig = {
    autoCheck: input.update?.autoCheck ?? d.update.autoCheck,
    // 不是字符串就回 null（= 没有忽略任何版本）。宁可多提示一次，
    // 也不要因为一个写坏的值把提示永久关掉
    ignoredVersion:
      typeof input.update?.ignoredVersion === 'string' ? input.update.ignoredVersion : null
  }

  // 迁移：1 版的竖屏尺寸与新的 16:9 横屏版面不兼容。
  // 只重置「从未调过尺寸」的配置（即恰好等于某个旧预设），
  // 用户自己改过的大小保持不动。
  if ((input.version ?? 1) < CONFIG_VERSION) {
    const untouched = LEGACY_PORTRAIT_SIZES.some(
      (s2) => s2.width === w.width && s2.height === w.height
    )
    if (untouched) {
      w.width = d.window.width
      w.height = d.window.height
      // 位置也一并重算：横屏更宽，沿用旧坐标可能贴出屏幕外
      w.x = null
      w.y = null
    }
  }

  // 迁移到 4：悬浮球改为窗口内的常驻元素，交互也改成手动开关。
  // 旧配置里 autoCollapse 默认是开的，沿用会让人以为「界面自己会跑掉」。
  if ((input.version ?? 1) < 4) {
    s.autoCollapse = false
  }

  // 迁移到 5：底栏取消，功能移入右侧栏，窗口左下角不再是 chrome 区域。
  // 迁移到 6：悬浮球进了顶栏，停靠位置与大小都不再是配置项。
  // 迁移到 7：右侧栏去掉迷你与收藏，系统设置改在窗口内打开；
  //           window.miniMode / lastNormalSize 由上面的逐字段取值丢掉。
  // 迁移到 8：起始页主题由七个收到三个。收掉的那几个全是荧光屏主题，
  //           落到同属终端世界的磷绿上；落到纸白等于把选过黑底的人扔回白底。
  //           必须在下面「主题不在表里就回落默认」之前做。
  if ((input.version ?? 1) < 8 && LEGACY_HOME_THEMES.includes(String(input.ui?.homeTheme))) {
    ui.homeTheme = 'crt-green'
  }

  w.opacity = clamp(w.opacity, OPACITY_MIN, OPACITY_MAX)
  w.width = Math.round(clamp(w.width, 200, 4000))
  w.height = Math.round(clamp(w.height, 200, 4000))
  s.hideDelayMs = Math.round(clamp(s.hideDelayMs, 200, 5000))
  b.defaultZoom = clamp(b.defaultZoom, 0.25, 5)
  if (typeof b.searchTemplate !== 'string' || !b.searchTemplate.includes('%s')) {
    b.searchTemplate = d.browser.searchTemplate
  }
  /*
   * 只挡「不是字符串」。**空串是合法的**：设置页里把那一格清空就是这样，
   * 它表示「用默认的 google.com」，而那个兜底只有一处（TabManager.newTabUrl）。
   * 在这里把它改成默认值也能跑，但用户清空的字段会自己弹回一个网址，
   * 看着像是没改成功。
   */
  if (typeof b.newTabUrl !== 'string') b.newTabUrl = d.browser.newTabUrl
  if (!Array.isArray(ls.openUrls)) ls.openUrls = []
  if (typeof ui.topBarOpen !== 'boolean') ui.topBarOpen = d.ui.topBarOpen
  if (typeof ui.railOpen !== 'boolean') ui.railOpen = d.ui.railOpen
  // 非数值先回落默认再夹取：clamp 对非有限值给的是**下限**，
  // 而这里下限是 0——一个写坏的值不该让整个界面底板透掉。
  if (typeof ui.backgroundOpacity !== 'number' || !Number.isFinite(ui.backgroundOpacity)) {
    ui.backgroundOpacity = d.ui.backgroundOpacity
  }
  ui.backgroundOpacity = clamp(ui.backgroundOpacity, BACKGROUND_OPACITY_MIN, BACKGROUND_OPACITY_MAX)
  // 同一条规矩：非数值先回落默认再夹取。这里默认是 1，写坏的值不该让正文
  // 悄悄变淡（正文淡了是「读不出来」，比底板淡了更费解）
  if (typeof ui.readerOpacity !== 'number' || !Number.isFinite(ui.readerOpacity)) {
    ui.readerOpacity = d.ui.readerOpacity
  }
  ui.readerOpacity = clamp(ui.readerOpacity, READER_OPACITY_MIN, READER_OPACITY_MAX)
  if (!HOME_THEMES.some((t) => t.id === ui.homeTheme)) {
    ui.homeTheme = d.ui.homeTheme as HomeTheme
  }
  // 视图同一条规矩：表里没有的（旧配置、手改坏的、将来删掉的那一档）回落默认，
  // 而不是让起始页拿着一档不认识的视图去渲染一个空白页
  if (!HOME_VIEWS.some((v) => v.id === ui.homeView)) {
    ui.homeView = d.ui.homeView
  }
  // 图标同理：表里没有的（旧配置、手改坏的、将来删掉的）回落默认。
  // 'custom' 不在 BALL_ICONS 里，单独放行——它指的是用户上传的那张图，
  // 而「有没有那张图」由 ballIconStore 说了算，不是配置该管的事。
  if (ui.ballIcon !== CUSTOM_BALL_ICON && !BALL_ICONS.some((i) => i.id === ui.ballIcon)) {
    ui.ballIcon = d.ui.ballIcon
  }
  if (!BALL_CUSTOM_FITS.some((f) => f.id === ui.ballCustomFit)) {
    ui.ballCustomFit = d.ui.ballCustomFit
  }
  if (typeof u.autoCheck !== 'boolean') u.autoCheck = d.update.autoCheck

  return {
    version: CONFIG_VERSION,
    window: w,
    ui,
    stealth: s,
    hotkeys: h,
    browser: b,
    update: u,
    lastSession: ls
  }
}

type Listener = (config: AppConfig) => void

export class ConfigStore {
  private config: AppConfig
  private readonly writer: DebouncedWriter<AppConfig>
  private readonly listeners = new Set<Listener>()

  constructor(userDataDir: string) {
    const file = path.join(userDataDir, 'config.json')
    const raw = readJson<Partial<AppConfig> | null>(file, null)
    this.config = normalize(raw)
    this.writer = new DebouncedWriter<AppConfig>(file, PERSIST_DEBOUNCE_MS)
    if (raw && raw.version !== CONFIG_VERSION) {
      log.info(`配置版本由 ${raw.version} 迁移到 ${CONFIG_VERSION}`)
    }
  }

  get(): AppConfig {
    return this.config
  }

  /** 浅层合并每个顶层分区，随后整体校验；返回合并后的完整配置 */
  patch(patch: ConfigPatch): AppConfig {
    const next: AppConfig = {
      version: this.config.version,
      window: { ...this.config.window, ...(patch.window ?? {}) },
      ui: { ...this.config.ui, ...(patch.ui ?? {}) },
      stealth: { ...this.config.stealth, ...(patch.stealth ?? {}) },
      hotkeys: { ...this.config.hotkeys, ...(patch.hotkeys ?? {}) },
      browser: { ...this.config.browser, ...(patch.browser ?? {}) },
      update: { ...this.config.update, ...(patch.update ?? {}) },
      lastSession: { ...this.config.lastSession, ...(patch.lastSession ?? {}) }
    }
    this.config = normalize(next)
    this.writer.schedule(this.config)
    this.emit()
    return this.config
  }

  /** 直接替换，供内部服务使用；同样会持久化并广播 */
  set(mutator: (config: AppConfig) => AppConfig): AppConfig {
    this.config = normalize(mutator(this.config))
    this.writer.schedule(this.config)
    this.emit()
    return this.config
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config)
      } catch (err) {
        log.error('配置监听器抛错', err)
      }
    }
  }

  /** 进程退出前调用，确保最后一次变更已落盘 */
  flush(): void {
    this.writer.flush()
  }
}
