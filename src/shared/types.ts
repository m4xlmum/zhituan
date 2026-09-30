/**
 * 主进程、预加载与渲染进程共享的类型定义。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { BallCustomFit, BallIconChoice, HomeTheme, HomeView, SiteSection } from './constants'

export type {
  BallCustomFit,
  BallIcon,
  BallIconChoice,
  HomeTheme,
  HomeView,
  SectionId,
  SiteSection,
  SizePreset
} from './constants'

// ---------------------------------------------------------------- 配置

export interface WindowConfig {
  x: number | null
  y: number | null
  width: number
  height: number
  /** 无极透明度，0.05 ~ 1 */
  opacity: number
  alwaysOnTop: boolean
  /**
   * 显示在任务栏。默认 false。
   * 注意：skipTaskbar 同时把窗口移出 Alt+Tab，因此开启此项会显著降低隐蔽性。
   */
  showInTaskbar: boolean
}

export interface StealthConfig {
  /** 光标移出后自动收起成悬浮球 */
  autoCollapse: boolean
  /** 收起前的延迟，毫秒。收起慢、展开靠点击，避免误触 */
  hideDelayMs: number
  /**
   * 隐藏时暂停网页音视频：收起成球、藏进托盘、最小化这三种「没露出来」的状态，
   * 都算隐藏。
   *
   * 暂停的是**正在播的**那一些，并且只恢复由我们按下去的那些——用户自己按了
   * 暂停的视频，回到展开态时不该被我们放起来。字段名沿用下来（原先只做静音），
   * 现在一并把媒体真正暂停，静音仍然保留（见 tabManager 里的两个脚本）。
   */
  muteMediaOnCollapse: boolean
  /**
   * 切走时暂停那一页的媒体：切到别的标签、或进起始页 / 系统设置。
   *
   * 与上面那条是**两条独立的规矩**，合起来才是「谁该出声」：窗口收起来时全部停，
   * 窗口露着时只有正在看的那一张出声。判据在 TabManager.applyMediaState 一处合成
   * ——两边各算各的就会出现「展开时顺手把后台那张也放响」那种洞。
   * 那两屏也在同一条规矩里：它们同样占着正文区，此时没有任何视频可见。
   *
   * 与上面那条还有一处差别：**这里只暂停，不闭麦**。收起是「不能出声」，切走只是
   * 「不该在这儿播」——用户可能一边放着音乐一边翻别的页，而闭麦会连暂停够不着的
   * 那一半（Web Audio、各家自己实现的播放器）一起挡掉，那正是收起时要的、
   * 切走时不要的。
   *
   * 暂停前会打一个记号，恢复只认那个记号（见 tabManager 的两个脚本）：用户自己
   * 按了暂停的视频，切回来时不该被我们放起来。
   */
  pauseMediaOnSwitch: boolean
  /** 从屏幕捕获中排除窗口（SetWindowDisplayAffinity） */
  contentProtection: boolean
}

/**
 * 界面分区显隐。
 *
 * 悬浮球是顶栏里的一员，顶栏藏起来之后它改停在右上角，
 * 因此这两项都会牵动原生正文视图的版面，状态由主进程持有并落盘。
 */
export interface UiConfig {
  /** 显示顶部功能栏 */
  topBarOpen: boolean
  /** 显示右侧功能栏。顶栏隐藏时这一栏会被强制保留，见 WindowRuntime.railVisible */
  railOpen: boolean
  /**
   * 起始页的主题（纸白 / 暗夜 / 磷绿），只作用于起始页那一屏——
   * 顶栏、右栏、悬浮球、面板、系统设置页与 PDF 阅读页都不跟着换，
   * 网页与本机文件更不受影响。见 @shared/constants 的 HomeTheme。
   */
  homeTheme: HomeTheme
  /**
   * 起始页的视图（列表 / 小图标 / 图标），见 @shared/constants 的 HomeView。
   *
   * 与 homeTheme 同一条规矩：只作用于起始页那一屏，顶栏、右栏、面板、
   * 设置页与阅读页都不跟着换。默认「列表」=这一页一直以来的样子，
   * 于是老配置一个字都不用迁（新字段 + 安全默认值，不必动 CONFIG_VERSION）。
   */
  homeView: HomeView
  /**
   * 界面底板透明度 0–1。
   *
   * 与 window.opacity（整扇窗连带网页一起变淡）不同，这只影响界面自己画的底板：
   * 顶栏、地址栏、右侧栏与弹出面板。字与图标始终不透明，因此拉到 0
   * 也只是「底板没了，按钮浮在桌面上」，不会把自己锁在外面。
   * 网页与自家页面不受影响。
   */
  backgroundOpacity: number
  /**
   * 离线阅读透明度 0–1。
   *
   * 前两条滑块管的是**窗口**（整体连带网页、背景只管界面底板），这一条管的是
   * **正在读的那一份**：本机 TXT（Chromium 自己渲染的那一页）与自家 PDF 阅读页。
   * 于是「界面 100%、正文 40%」这种搭配成立——被读的那一份淡下去、栏还是实的。
   * 从前要淡一本 PDF 只有整体透明度一条路，那会把右栏与顶栏一起淡掉。
   *
   * **两种页上落的地方不一样**（1.5.2 起）：PDF 那一页淡的是**纸**——位图里只剩墨
   * （键控把纸写成 alpha 0），于是给它补一层元素底色，值 v 对应纸的 alpha = 1 − v，
   * 0% 是一张实心白纸、而字始终实心；TXT 那一页淡的是正文本身（那一页的底由
   * Chromium 画，碰不到）。默认值 1 在两处都是「什么都不加」。
   *
   * **网页永远不受它影响**（见 PRODUCT.md 的硬边界）：网页是别人的东西，
   * 该由整体透明度管。阅读页右下角那一条浮层（第几页 / 深浅键）也不跟着动——
   * 它是控件，控件要一直看得见（与 backgroundOpacity 里的字与图标同理）。
   */
  readerOpacity: number
  /**
   * 阅读排版四项：字号（px）、行距（倍数）、左右留白（相对正文宽的百分比）、
   * 段距（em，加在**段落之间**）。
   *
   * **四个落点，四种能碰到的程度。** 本机 EPUB 的章节进的是我们自己的 Shadow DOM
   * （book/BookApp.vue），本机 TXT 是自家的一页（txt/TxtApp.vue），这两处排版归我们；
   * Chromium 自己渲染的本机文本（`.md`、`.log` 这一类）整篇只有一个 `pre`；本机 PDF
   * 的字是画进位图里的。于是同一组配置在那四处**不装作一样**——没有对象的档位就
   * 禁掉（见下一条 readerParagraph 与 renderer 那两块面板），与 readerOpacity 同一条
   * 规矩。头三项在 `pre` 那一页照样能落（写那个 `pre` 自己的样式），段距落不下去。
   *
   * 三项都必须**压得过书自己写的排版**：书里动不动就是 `body { font-size: 20px }`，
   * 用户拉一下字号就该看见字变了，被书锁住会让控件看起来是坏的。因此它们落在
   * 书样式表**之后**的那一层并带 `!important`（书页里的 READER 那一块）。
   *
   * 前两项的默认值与书页原先写死的那组排版**逐字相同**（17px / 1.85 / 6%），
   * 因此老配置一个数都不用迁——与 readerOpacity 默认给 1 是同一个道理。
   */
  readerFontSize: number
  readerLineHeight: number
  readerMargin: number
  /**
   * 段距：**段落之间**多留出来的那一层（em 倍数，相对正文字号）。
   *
   * 它比另外三项多要一件东西：**段落**这个结构。四个落点里有几个有、几个没有，
   * 于是这一项在四处各是各的样子：
   *
   *   · **本机 TXT**：正文原先是一个文本节点，段落只是原文里的空行。值为 0 时
   *     一个 DOM 都不动（那正是这一版之前的样子）；一旦大于 0 就把这一章切成
   *     「段」与「空行」两种元素，段与段之间垫上这一层（见 @shared/txt 的
   *     splitParagraphs 与 txt/TxtApp.vue）；
   *   · **本机 EPUB**：书里的段落本来就是一个个 `<p>`，落成 `p + p` 上的
   *     `padding-top`。**值为 0 时那条规则整张停用**：不这样，一条
   *     `padding-top: 0 !important` 会把书自己写的 `p { padding-top: .4em }`
   *     一起压平——那与「不动上下 margin」是同一条规矩，书的版式我们不动。
   *   · **Chromium 排的本机文本**：整篇只有一个 `pre`，没有段落可指。两块面板上
   *     那一行因此是禁用的，不装作能点（见 popover/PopoverApp.vue）。
   *   · **本机 PDF**：整块面板都与它无关（字是画进位图的）。
   *
   * **落成 `padding` 而不是 `margin`**：段距是**加在**书/文本自己的版式上的，而
   * `margin-top` 会与上一条的 `margin-bottom` 折叠——折叠取大的那一个，于是滑块
   * 开头的半程会看起来什么也没做（UA 给 `p` 的 `margin: 1em 0` 正是那个大头）。
   * padding 只加不减，是从头到尾都跟手的那一个。
   *
   * 默认 **0**：段落之间不加料，也就是这一版之前的样子。老配置一个数都不用迁。
   */
  readerParagraph: number
  /**
   * 悬浮球画哪个图标。
   *
   * 内置的几个画在代码里（`chrome/BallGlyph.vue`），`'custom'` 指的是
   * 用户上传的那一张——它不在配置里，存在 userData/ball-icon.json，
   * 由 ballIcon 那组 IPC 单独读写。分开的理由是体积：配置一变就全量广播，
   * 而这张图有几 KB，透明度滑块每动一格都会把它推一遍。
   */
  ballIcon: BallIconChoice
  /** 自定义图标落进球里的方式。只在 ballIcon 为 'custom' 时有意义 */
  ballCustomFit: BallCustomFit
}

export interface HotkeyConfig {
  /** 老板键 1：最小化 / 恢复 */
  bossMinimize: string
  /** 老板键 2：藏进托盘 */
  bossHideToTray: string
}

export interface BrowserConfig {
  defaultUaMode: 'desktop' | 'mobile'
  defaultZoom: number
  /** 默认隐藏滚动条，避免长滚动条暴露阅读行为 */
  hideScrollbars: boolean
  searchTemplate: string
  /** target=_blank 转为新标签页，而非弹出新窗口 */
  newWindowAsTab: boolean
  /**
   * 点标签条末尾那颗 `+` 时打开的地址（默认见 DEFAULT_NEW_TAB_URL）。
   *
   * 归在 browser 段而不是 ui：它是**浏览器行为**，与 searchTemplate 同一类，
   * 与「界面长什么样」无关。写什么都行（`douyin.com` 这种不带协议的也认，
   * 走的是地址栏那条 resolveInput）；空值在 TabManager 那一侧回落到默认值。
   */
  newTabUrl: string
}

/**
 * 自动检查更新。
 *
 * 新增这一段**没有动 CONFIG_VERSION**：那条迁移阶梯是给「老值需要换算」的迁移
 * 用的（1 版竖屏尺寸、4 版 autoCollapse、8 版主题收编），而这里两个字段都是
 * 新增、都有安全默认值，normalize() 逐字段取值就够了。
 */
export interface UpdateConfig {
  /** 启动后静默查一次。关掉之后程序不再自己联网，只剩设置页里那个手动按钮 */
  autoCheck: boolean
  /**
   * 用户点了提示条上那个 ✕ 的版本号（`1.1.0` 这种形状），没有则为 null。
   *
   * 落盘而不是只记在内存里：否则用户关掉提示、下次启动它又冒出来，
   * 一个「已经说不要了」的东西反复出现，比一直挂着更烦人。
   * 只忽略这一个版本——下一个版本照常提示。
   */
  ignoredVersion: string | null
}

export interface AppConfig {
  version: number
  window: WindowConfig
  ui: UiConfig
  stealth: StealthConfig
  hotkeys: HotkeyConfig
  browser: BrowserConfig
  update: UpdateConfig
  lastSession: { openUrls: string[]; activeIndex: number }
}

// ---------------------------------------------------------------- 数据

export interface SiteRecord {
  id: string
  title: string
  url: string
  iconUrl?: string
  order: number
  pinned: boolean
  /** null 表示跟随全局默认 */
  uaMode: 'desktop' | 'mobile' | null
  zoom: number | null
  createdAt: number
  updatedAt: number
}

export interface PresetSite {
  id: string
  title: string
  url: string
  /** 归属起始页的哪一栏。表里的站点都有栏，用户自己加的站点不在表里 */
  section: SiteSection
}

/**
 * 起始页上被移除掉的站点域名。
 *
 * 起始页那一列站点的来源有三个（见 renderer/src/home/useTiles.ts）：
 * **我的站点**（有记录，本来就删得掉）、**常访问**（历史现推出来的）、
 * **热门站点**（内置表）。后两种没有「属于谁」这一说——删掉它无处可删。
 *
 * 于是「删除」这件事统一落成一份**域名黑名单**：删一行就是记下这个域名别再出现，
 * 添回一个站点就是把它从这份名单里划掉。三个来源因此只有一套删法，
 * 用户在界面上也只需要知道一条规矩：**删了就是没了**。
 *
 * 记的是可注册域名（`qq.com`，不是 `weread.qq.com`）——起始页本来就是一域名一行
 * （去重用的同一把尺子，见 useTiles 的 domainOf），否则删掉 weread.qq.com
 * 之后 book.qq.com 会顶上来，看着像没删干净。
 */
export interface HiddenSite {
  id: string
  domain: string
  removedAt: number
}

export interface Bookmark {
  id: string
  title: string
  url: string
  faviconUrl?: string
  order: number
  createdAt: number
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  faviconUrl?: string
  visitedAt: number
  visitCount: number
}

// ---------------------------------------------------------------- 运行时（不持久化）

/**
 * 窗口状态。
 *
 * 只有两个主状态：展开与收起成球。
 * 收起时窗口本身缩小到一颗球——屏幕上没有「看不见却仍占着」的区域，
 * 因此不需要再靠裁剪命中区域来实现点击穿透。
 */
export type WindowMode =
  /** 完整界面：顶栏 + 地址栏 + 正文 + 右侧功能栏 */
  | 'expanded'
  /** 缩成悬浮球 */
  | 'collapsed'
  /** 藏进托盘 */
  | 'trayHidden'
  /** 最小化 */
  | 'minimized'
  /** 正在退出 */
  | 'quitting'

export interface TabState {
  id: string
  url: string
  title: string
  faviconUrl?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
  uaMode: 'desktop' | 'mobile'
  zoom: number
  muted: boolean
}

/**
 * 自家那一屏：起始页或系统设置。
 *
 * 它们是窗口内的视图，但**不是标签页**——不进标签条、不给关闭键，
 * 各有各的入口（顶栏最左并排的那两颗键：起始页、设置）。
 * 正文区显示的是网页还是某一屏，由这个值说清。
 */
export type OwnScreen = 'home' | 'settings'

export interface WindowRuntime {
  mode: WindowMode
  opacity: number
  /**
   * 地址栏是否展开。
   *
   * 状态由主进程持有，而不是渲染进程自己记：地址栏一展开正文就要往下让一行，
   * 而正文是原生视图。若让渲染进程先改再通知主进程，两者在时序上必然错开，
   * 网页就会有一瞬间压在地址栏上。
   */
  addressOpen: boolean
  /** 顶栏是否显示（用户的选择） */
  topBarOpen: boolean
  /**
   * 右侧栏**实际**是否占位并绘制。
   *
   * 与 ui.railOpen 不一定相同：顶栏藏起来之后悬浮球就停在右栏顶端，
   * 那一栏是它唯一的落脚处，因此这时无论如何都要保留。
   * 版面与界面都按这个值走，省得两处各自推导。
   */
  railVisible: boolean
  /**
   * 是否已最大化（铺满当前显示器的整个工作区，不保 16:9）。
   *
   * 它是一个**临时的窗口状态**，不进配置：配置里存的是还原回去的那块 16:9
   * 矩形（见 windowController 的 restoreBounds）。因此「最大化着退出程序」
   * 下次启动仍是一个 16:9 的窗口。
   *
   * 界面按它做三件事：两栏与地址栏一起让位、不画那圈缩放手柄、
   * 只在右上角浮出「还原键 + 悬浮球」那一小块（退出最大化就靠那一枚）。
   * 三处都读同一个值，不各自从窗口尺寸反推——反推出来的「宽度等于屏幕宽度」
   * 在 16:9 显示器上恰好也是最大化的样子，分不清。
   *
   * 注意「顶栏那枚最大化键」不在其中：最大化之后整条顶栏都不画了，
   * 它跟着消失，图标不存在切换一说。还原键是另一枚，画在右上角那一小块里。
   */
  maximized: boolean
  /**
   * 更新提示条是否占版面。
   *
   * 与 addressOpen 同一种东西：提示条要吃掉 30px，正文是原生视图，只能由主进程
   * 重排。因此「有没有这一条」是**版面状态**，写在这里；而这一条上写什么字、
   * 按下去做什么，由 BROADCAST.updateState 那条单独给（见 UpdateState）。
   * 两者分开是因为管的人不同：这个字段归窗口控制器，那一条归更新服务。
   */
  noticeVisible: boolean
}

/**
 * 更新这件事走到哪一步了。
 *
 * 状态只有一份、在主进程里，界面（提示条与设置页）都只是它的投影。因此下载进度
 * 在哪个文档里看都是同一个数，也不会出现「提示条说下载完了、设置页说还在下」。
 */
export type UpdatePhase =
  /** 还没查过 */
  | 'idle'
  /** 查不了：开发模式，或用户把自动检查关了 */
  | 'disabled'
  | 'checking'
  /** 已是最新 */
  | 'none'
  /** 有更新的版本，但盘上还没有那一份 */
  | 'available'
  | 'downloading'
  /** 下完了、sha512 校验通过，等用户点「更新并重启」 */
  | 'ready'
  /** 查或下失败了。界面**不弹任何东西**，只在设置页里写一句 */
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** 这个构建能不能查更新（开发模式下为 false）。界面据此把按钮禁掉并说明理由 */
  enabled: boolean
  /** 正在运行的这个版本 */
  currentVersion: string
  /** 查到的新版本。available / downloading / ready 时有值 */
  version: string | null
  /** 下载进度 0–100（整数）。downloading 时有意义 */
  percent: number
  /** 给人看的一句话，失败时说清是什么失败 */
  message: string
  /** 这个新版本是否被用户忽略过（提示条据此不冒出来） */
  ignored: boolean
  /**
   * 用户已经按过「更新并重启」，只是那时还没下完——下完就自己装、自己重启。
   *
   * 「下载」不是界面上的一颗按钮，而是「更新并重启」这句话的前半截：按下去之后
   * downloading 这一段路要走几分钟，那几分钟里界面得说得出「接下来会发生什么」，
   * 也要把按钮收起来（已经没什么可按的了）。因此它是**必须广播出去**的一个事实，
   * 而不是界面自己记的点击状态。
   */
  pendingInstall: boolean
  /**
   * 本机登记的安装版本**比正在跑的这一版新**——上一次更新没落地（注册表写着
   * 新版、磁盘上还是旧版）。值是注册表里那个版本号；没这回事时是 null。
   *
   * 这是 1.6.6 那次事故留在用户机器上的形态：`resources\app.asar` 被一个退不掉
   * 的进程占着，安装器一个字节都没换掉，却把版本号登记成了新的，于是「点了更新
   * 并重启，只重启、没更新」。安装器那一侧现在会在动手之前探问、拦下并把话说清楚
   * （见 build/installer.nsh 的第 1 层）；这一枚是应用这一侧的同一句实话——用户
   * 可能从任一侧撞上这个状态，两边都得说得出「你上一次的更新没装成」。
   *
   * 判据见 installRegistry.ts：登记的目录要与正在跑的这个 exe 所在目录相同，
   * 否则沉默（不同目录时登记的版本讲的是另一份文件）。
   */
  mixedInstall: string | null
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 被拖动的边或角：`n` 上边、`s` 下边、`e` 右边、`w` 左边、`ne` 右上角……
 *
 * 放在 shared 里而不是算它的 geometry.ts 里：界面在按下手柄时要把「拖的是哪条边」
 * 发给主进程（算缩放需要屏幕坐标，只有主进程读得到），因此它是跨进程的词汇。
 * 真正算矩形的那一步仍然只有 geometry.ts 一处（见 resizeRect）。
 */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface HotkeyInfo {
  accelerator: string
  registered: boolean
}

export const IPC_ERROR = {
  /** globalShortcut.register 返回 false 时抛出，调用方需提示用户更换组合键 */
  HOTKEY_TAKEN: 'HOTKEY_TAKEN'
} as const
