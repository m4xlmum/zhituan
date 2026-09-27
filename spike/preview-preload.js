/**
 * 预览与主进程之间的假桥。
 *
 * 它顶替真实的 preload：真实的 preload 要连主进程的 IPC 才活得下去，
 * 而这里只想把一个界面单独渲染出来看一眼，主进程的窗口、标签页、
 * 站点库一概不参与。
 *
 * 假数据要跟着 src/shared/types.ts 走：这份桥要是落后于真实接口，
 * 预览就会在一个已经不存在的数据形状上渲染，看了也白看。
 *
 * 顺带把渲染进程上报的悬浮球矩形转给主进程打印出来——那是「收起时
 * 窗口落到哪」的唯一依据，值得单独验一遍。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { contextBridge, ipcRenderer } = require('electron')

const opts = ipcRenderer.sendSync('preview:options')
const mode = opts.mode
const topBarOpen = mode !== 'no-topbar'
/**
 * 是否最大化（铺满工作区）。
 *
 * 与 mode 是两件事：最大化时仍然可以收起成球、也可以展开——真实的主进程
 * 也是这么分的（WindowRuntime 里 mode 与 maximized 各一个字段），
 * 因此这里不把它并进 mode，否则会验出一个真实程序走不到的形状。
 */
const maximized = opts.maximized === true

/**
 * 一枚内联图标，充作 favicon。
 *
 * 不用真实站点的图标地址：无头窗口不联网，取不到就是一条加载失败的破图，
 * 而这里要看的是「有图标时画图标」这条路本身。
 */
const FAVICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
      '<rect width="16" height="16" rx="4" fill="#1e80ff"/>' +
      '<path d="M4 12V6l2.5 3L9 6v6" stroke="#fff" stroke-width="1.4" fill="none"/>' +
      '<path d="M11 6v6" stroke="#fff" stroke-width="1.4"/>' +
      '</svg>'
  )

/**
 * 标签页。默认 5 个、标题都很长，正好试标签条的让位与下拉按钮的截断。
 *
 * **只有网页**：起始页与系统设置不进这一条（它们是「屏」不是「标签」，
 * 见 spike/own-screens.js 与 README 里那一版模型）。这里要是还留着
 * `zhituan://home` 那一格，预览里就会量出一个真实程序画不出来的标签条。
 *
 * 给其中一个配一枚 favicon：标签条上确实是「有图标画图标、没有画个点」，
 * 两条路都得看得见。其余留空——「还没有图标」本身也是线上最常见的状态。
 *
 * --tabs N 只取前 N 个：标签条放得下与否由宽度算出来，得能拿少几张标签
 * 试出「放得下」那一态，否则永远只看得到它让位。
 *
 * --no-tabs：一张网页都没有——全关光了，正文区自己落回起始页。
 * 这是顶栏上那个地址栏开关**唯一一个字都不写**的场合（没有网页就没有名字，
 * 只剩一枚放大镜），而它在别处都写得出东西来，所以得单独摆一次。
 */
const ALL_TABS = [
  ['Claude Code 官方文档 · 快速开始与环境配置', 'https://docs.claude.com/en/docs/claude-code'],
  ['掘金 - 代码不止，掘金不停', 'https://juejin.cn/'],
  ['知乎 - 有问题，就会有答案', 'https://www.zhihu.com/'],
  ['哔哩哔哩 (゜-゜)つロ 干杯~-bilibili', 'https://www.bilibili.com/'],
  ['GitHub - m4xlmum/zhituan', 'https://github.com/m4xlmum/zhituan']
].map(([title, url], i) => ({
  id: `t${i}`,
  url,
  title,
  faviconUrl: i === 1 ? FAVICON : undefined,
  isLoading: false,
  canGoBack: i > 0,
  canGoForward: false,
  uaMode: 'desktop',
  zoom: 1,
  muted: false
}))

const TABS = opts.noTabs === true ? [] : opts.tabs > 0 ? ALL_TABS.slice(0, opts.tabs) : ALL_TABS

/**
 * 正文区此刻停在哪一屏——`'home' | 'settings' | null`（null = 正在看着某张网页）。
 *
 * 说法与真实主进程一致（见 shared/ipc.ts 的 TabsStatePayload）：`activeTabId`
 * 只说「正在看着哪张网页」，停在自家那两屏上时它是 **null**——标签条因此哪一格
 * 都不高亮，而标签条本身照旧把网页都列着；「原路返回」要回的那一张另记在
 * `lastTabId` 里。把 screen 与 activeTabId 混成一个字段，就画不出
 * 「没有哪一格高亮」这一态了。
 *
 * --screen home|settings 摆的是「先开着网页、再进那一屏」那一态，
 * 因此两张表都要照着填：停在那屏上、并且记得回来该回哪张。
 * --no-tabs 时没有「刚才那张」可记，`lastTabId` 就是 null，屏也跟着落回起始页
 * （与主进程关掉最后一张网页时同一条路，见 TabManager.close）。
 */
let screen = opts.noTabs === true ? (opts.screen ?? 'home') : (opts.screen ?? null)
/** 默认停在第二格（有 favicon 的那一格），--tabs 1 时退回第一格 */
const FIRST_TAB = TABS[1]?.id ?? TABS[0]?.id ?? null
let activeTabId = screen ? null : FIRST_TAB
/** 「原路返回」要回的那一张。进自家那两屏不改它——这正是它记着来路的原因 */
let lastTabId = FIRST_TAB
const tabListeners = new Set()

const config = {
  version: 11,
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
    topBarOpen,
    railOpen: true,
    homeTheme: opts.theme,
    backgroundOpacity: opts.bgAlpha ?? 1,
    readerOpacity: opts.readerAlpha ?? 1,
    ballIcon: opts.ballIcon,
    ballCustomFit: opts.ballFit
  },
  stealth: {
    autoCollapse: false,
    hideDelayMs: 700,
    muteMediaOnCollapse: true,
    contentProtection: false
  },
  hotkeys: { bossMinimize: 'Alt+Z', bossHideToTray: 'Alt+X' },
  browser: {
    defaultUaMode: 'desktop',
    defaultZoom: 1,
    hideScrollbars: true,
    searchTemplate: 'https://www.bing.com/search?q=%s',
    // 设置页「通用」那一节里「新标签页」那一格的底色，照 DEFAULT_NEW_TAB_URL 摆
    newTabUrl: 'https://www.google.com',
    newWindowAsTab: true
  },
  update: {
    autoCheck: opts.noticeAutoCheck !== false,
    ignoredVersion: opts.noticeIgnored ?? null
  },
  lastSession: { openUrls: [], activeIndex: 0 }
}

/** 热门站点那张表，主进程打出来递进来的（只有弹出面板那一页非空） */
const presets = opts.presets ?? []

/** 起始页的磁贴来自「自己固定的 → 常访问的 → 预置的」，三样都给一点 */
const SITES = [  {
    id: 's1',
    title: '微信读书',
    url: 'https://weread.qq.com/',
    order: 0,
    pinned: true,
    uaMode: null,
    zoom: null,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 's2',
    title: '起点中文网',
    url: 'https://www.qidian.com/',
    order: 1,
    pinned: true,
    uaMode: null,
    zoom: null,
    createdAt: 0,
    updatedAt: 0
  }
]

/**
 * 本机文件的那几条假数据。
 *
 * 地址照 `pathToFileURL` 的写法给：非 ASCII 一律百分号编码。真机上的 TXT
 * 十有八九落在「文档」「下载」这种中文目录里，而起始页那一栏要显示的正是
 * **解码回来**的文件名——假数据要是直接写中文，那条解码的路就没走过。
 */
const fileUrl = (name) => `file:///E:/books/${encodeURIComponent(name)}`

/**
 * --reader [%]：此刻正在读一本本机 TXT。
 *
 * 右栏第三条滑块（离线阅读正文的透明度）只在**本机文件**上有对象，因此要摆出
 * 「它活着」那一态，正文区底下就得真是一本本机 TXT——停在网页上它按规矩是禁用的
 * （见 Rail.vue 的 offlineReading），拿那种界面来验这条滑块等于什么都没验。
 *
 * 开这一页的办法与「打开文件…」那一路**逐字相同**（见下面的 openLocalFiles）：
 * 追加一格、让它成为正在看的那一页、起始页退到后台。于是这里摆出来的标签条与
 * 真机点开一本 TXT 之后的样子没有差别——预览要是另摆一个更整齐的形状
 * （比如就地换掉某一格、好让标签条仍是五格），量出来的栏高就不是用户看到的那一栏。
 *
 * 数值那一半由 --reader 后面可选的百分数说了算（不给就是 100%），与 --bg 同一条
 * 规矩：「它此刻活在什么值上」与「它此刻活不活」是两件事，各自都要能单独摆。
 */
if (opts.reader === true) {
  TABS.push({
    id: 'r0',
    url: fileUrl('斗破苍穹.txt'),
    title: '斗破苍穹.txt',
    faviconUrl: undefined,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    uaMode: 'desktop',
    zoom: 1,
    muted: false
  })
  activeTabId = 'r0'
  lastTabId = 'r0'
  screen = null
}

/**
 * 两本本机书，排在历史里。
 *
 * 「离线阅读」那一栏的行、以及本机文件出现在「继续上次」时的样子（书名 + 格式，
 * 而不是一条路径），都要有假数据才画得出来。
 */
const LOCAL_HISTORY = [
  ['斗破苍穹.txt', 2],
  ['三体（全集）.pdf', 1]
].map(([name, visitCount], i) => ({
  id: `f${i}`,
  url: fileUrl(name),
  // 真机落库时标题就是文件名（见 HistoryStore 的 titleOf），这里照着摆
  title: name,
  faviconUrl: undefined,
  visitedAt: Date.now() - (i + 5) * 60000,
  visitCount
}))

const HISTORY = [
  ['如何在 Electron 里做无边框透明窗口', 'https://www.zhihu.com/question/123456789', 9],
  ['CSS 扫描线与文字发光效果', 'https://juejin.cn/post/7123456789', 6],
  ['纸团 · 项目主页', 'https://github.com/m4xlmum/zhituan', 4],
  ['Claude Code 官方文档', 'https://docs.claude.com/en/docs/claude-code', 3]
].map(([title, url, visitCount], i) => ({
  id: `h${i}`,
  url,
  title,
  // 最近读的那一条带图标：起始页第一行是「继续上次」，它也该画那个站的图标
  faviconUrl: i === 0 ? FAVICON : undefined,
  visitedAt: Date.now() - i * 60000,
  visitCount
}))

/*
 * 本机那两条排在网页之后（历史按时间倒序，所以它们更旧）。
 *
 * --resume-file 把第一本提到最前：那时「继续上次」落在本机文件上，
 * 走的是 rowsOf 里另一条分支（书名 + 格式，而不是域名）。
 * 这一态在真机上要「刚刚读完一本书」才出现，命令行不摆出来就看不到。
 */
if (opts.resumeFile) HISTORY.unshift(...LOCAL_HISTORY.splice(0, 1))
HISTORY.push(...LOCAL_HISTORY)

const BOOKMARKS = [
  {
    id: 'b1',
    title: '少数派',
    url: 'https://sspai.com/',
    order: 0,
    createdAt: 0
  }
]

/**
 * 窗口运行状态。真值都在主进程，这里只是把 getState 该回的东西照样摆一份。
 *
 * railVisible 与 topBarOpen 的算法**必须与 windowController 里的同名规则一致**
 * （getRuntime / railVisible 那个模块级函数）：界面按它们决定画不画那两条栏，
 * 假桥要是自己另定一套，预览里就会出现真实程序走不到的形状，看了也白看。
 * 最大化那一态尤其要紧——右侧栏在这一态必须报 false，否则 Rail 会照画，
 * 而真机上它已经让位了。
 */
const state = {
  mode: mode === 'collapsed' ? 'collapsed' : 'expanded',
  opacity: 1,
  addressOpen: false,
  topBarOpen,
  railVisible: !maximized && (config.ui.railOpen || !topBarOpen),
  // 由下面 syncNotice 按「有新版且没被忽略」算出来，这里只是给个初值
  noticeVisible: false,
  maximized
}

/**
 * 状态广播要真的发得出去。
 *
 * 「最大化之后点右上角那枚还原键，顶栏与右栏回来」是这一版最要紧的一条往返，
 * 而它全靠「界面发意图 → 主进程改状态 → 广播回来 → 界面重画」这条路。
 * 假桥若把 onState 当空操作吞掉（原先就是），这条路在预览里根本走不通：
 * 点了那枚键什么都不会变，也就验不出往返通没通。
 */
const stateListeners = new Set()

function emitState() {
  const snapshot = { ...state }
  for (const listener of stateListeners) listener(snapshot)
}

/**
 * 更新提示条是否占版面。
 *
 * 判据**必须与 updateService.setState 里那一条一致**：「有一个已知的新版本、
 * 且没被忽略」。假桥若自己另定一套（比如「有版本号就显示」），就会验出一个
 * 真实程序走不到的形状——被忽略的那一版在真机上不占版面，在预览里却占着。
 */
function syncNotice() {
  const visible = updateState.version !== null && !updateState.ignored
  if (state.noticeVisible === visible) return
  state.noticeVisible = visible
  emitState()
}

/**
 * 更新那条桥。
 *
 * 形态由命令行给（--notice 1.1.0 / --notice-phase ready / --notice-percent 42 /
 * --notice-pending），因为要看的正是那几种形态各自长什么样。**点击是真的会改
 * 状态的**：「按了更新并重启会走到已下载」「按了 ✕ 这一条会收掉」是这一版最
 * 要紧的两条往返，假桥要是把按钮当摆设，预览里点一下什么都不动，也就验不出
 * 按对了没有。
 *
 * 下载不去模拟 111MB 的进度：形态用 --notice-phase downloading --notice-percent 42
 * 直接摆出来（要验的是那一条进度线画在哪儿、以及按过之后那句话长了什么样）。
 * 真进度只有主进程那边才走得通，由 spike/update-check.js 验。
 */
const updateListeners = new Set()
const updateState = {
  phase: opts.notice ? (opts.noticePhase ?? 'available') : 'idle',
  enabled: opts.noticeEnabled !== false,
  currentVersion: opts.noticeCurrent ?? '1.0.0',
  version: opts.notice ?? null,
  percent: opts.noticePercent ?? 0,
  message: opts.noticeMessage ?? '',
  ignored: false,
  pendingInstall: opts.noticePending === true
}
let installCalls = 0
/** 整体透明度那条滑块发过来的请求，供 --drag-opacity 那一问来读（见下） */
const opacityCalls = []

/** 初始那一份也要按同一条判据算：--notice-ignored 供的就是「已忽略这一版」那一态 */
updateState.ignored = updateState.version !== null && config.update.ignoredVersion === updateState.version
syncNotice()

function emitUpdate() {
  const snapshot = { ...updateState }
  for (const listener of updateListeners) listener(snapshot)
}

function onUpdate(listener) {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

/** 最大化 / 还原只改这两个字段，其余照主进程的规则重算一遍 */
function setMaximized(next) {
  if (state.maximized === next) return
  state.maximized = next
  state.railVisible = !next && (config.ui.railOpen || !state.topBarOpen)
  emitState()
}

const ok = () => Promise.resolve()
const list = () => Promise.resolve([])

/**
 * 拖动信号的记账本。
 *
 * 「界面上哪一块能拖窗口」是这一版改动里最容易悄悄坏掉的一环：上一版整条顶栏
 * 都被 no-drag 的子元素盖满，于是只剩悬浮球拖得动，而从代码上看不出来。
 * 探针按一下、读这里的计数，就能问出「这个位置按下去到底起没起拖动」。
 *
 * 缩放（拖边缘改大小）是同一类问题、同一个记法，因此和拖动并排记在一起：
 * 边缘手柄压在顶栏与右栏的留白上，一旦它的盒子比预想的大，就会把按钮的点击
 * 悄悄变成缩放——那种错从截图上完全看不出来。
 *
 * dragLog / resizeLog 只存在于这份假桥里（真实的 preload 没有它们，界面也不需要），
 * 它们是给 spike/preview.js 的 --drag-probe 用的。
 */
let dragStarts = 0
let dragEnds = 0
let resizeStarts = 0
let resizeEnds = 0
/** 每次缩放开始时报上来的边名，按顺序记下来：拖的是不是那一条边，只能这么问 */
const resizeEdges = []

/**
 * 请求过的弹出面板，只记种类。
 *
 * 面板是另一个窗口，预览里不会出现，因此「点了它到底展开没展开」只能这么问：
 * 看有没有那一条请求（见上面 ui.openPopover）。
 */
const POPOVERS = []

/**
 * 进自家那一屏（起始页 / 系统设置）。
 *
 * 「正在看着的那张网页」就此变成没有——`activeTabId` 归 null，标签条上哪一格
 * 都不高亮；`lastTabId` 不动，它就是「再点一次原路返回」要回的那一张。
 */
function openScreen(kind) {
  screen = kind
  activeTabId = null
  emitTabs()
}

/**
 * 再点一次那颗键：原路返回。
 *
 * 回的是 `lastTabId` 那一张；它已经不在了就落回起始页——正文区不能空着
 * （与主进程同一条规矩，见 TabManager.close / leaveScreen）。
 */
function leaveScreen() {
  if (!screen) return
  const back = lastTabId && TABS.some((t) => t.id === lastTabId) ? lastTabId : null
  if (back) {
    screen = null
    activeTabId = back
  } else {
    screen = 'home'
    activeTabId = null
  }
  emitTabs()
}

/**
 * 标签页的对外快照。isActive 跟着当前那一格算，不另存一份，免得两处说法对不上。
 *
 * 四个字段名逐字照 `shared/ipc.ts` 的 TabsStatePayload 填。**这一条必须当真**：
 * 假桥是拿给真组件用的，字段名对不上不会报错，只会静静地读到 undefined——
 * 顶栏那个地址栏开关在停在自家那两屏上时就成了空白，而探针量到的是一句
 * 「与起点不一样」。这里原先那一格叫 `lastGuestId`（真机上没有这个名字），
 * 于是 Q13 那一问自它上线起就一直在报一个假失败，见 spike/theme-chrome.js。
 *
 * `lastTabId` 说的是**一张网页**：顶栏那个地址栏开关写的就是它，
 * 而不是屏名。
 */
function tabsState() {
  return {
    tabs: TABS.map((t) => ({ ...t, isActive: t.id === activeTabId })),
    activeTabId,
    screen,
    lastTabId
  }
}

function emitTabs() {
  const payload = tabsState()
  for (const listener of tabListeners) listener(payload)
}


/**
 * 配置桥要真的会改、真的会广播。
 *
 * 换主题这一步走的是「界面 → patch → 广播 → 重新渲染」这条路，
 * 假桥要是只把 patch 当空操作吞掉，就永远只能看到启动时那一套主题，
 * 「主题决定形态」这件事根本没被验证到。因此这里存下来并通知订阅者。
 */
const configListeners = new Set()

function patchConfig(input) {
  /*
   * 逐个子对象合并，与真的 ConfigStore.patch 一致。
   *
   * 这里曾经只对 `ui` 这么做，其余走 Object.assign —— 于是改一个 stealth 字段
   * 会把整个 stealth 换成只带这一个字段的新对象，`autoCollapse` 之类当场消失。
   * 假桥与真实现的差别只有一个后果：验出来的结论不算数。
   */
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      config[key] = { ...config[key], ...value }
    } else {
      config[key] = value
    }
  }
  for (const listener of configListeners) listener(config)
  return Promise.resolve(config)
}

/**
 * 自定义悬浮球图标那条桥。
 *
 * 与真实实现一样，图**不进 config**：它有几 KB，跟着每次 config 广播走不合适，
 * 因此这里也单开一份。--ball-image <路径> 就是把一张本地图当作用户上传过的那张
 * （读文件与编码都在主进程那侧做，见 preview.js），于是「铺满球面 / 中央图案」
 * 两种落法、以及「选了自定义却没有图」那条退路，都能在无头预览里各出一张图。
 *
 * set 要真的记住并广播——设置页选图、清除之后球该跟着变，而这件事只有
 * 桥真的动了才算验过。
 */
let ballImage = opts.ballImage ?? null
const ballListeners = new Set()

/**
 * 「用户选了这几本」（--open-file 一册一册给），走完真机那一整套：
 * 开一页、记一条历史、把新开的那一页变成正在看的那一页。
 *
 * 标题取**文件名**，与 HistoryStore 里 `file:` 那一条的规矩一致——
 * 这里要是照路径存，预览就会在一个真机上不存在的形状上渲染。
 */
let openedSeq = 9
function openLocalFiles() {
  const names = String(opts.openFile ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!names.length) return Promise.resolve([])

  for (const name of names) {
    const url = fileUrl(name)
    const id = `t${openedSeq}`
    openedSeq += 1
    TABS.push({
      id,
      url,
      title: name,
      faviconUrl: undefined,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      uaMode: 'desktop',
      zoom: 1,
      muted: false
    })
    // 新开的这一页就是正在看的那一页（真机上 activate: true），起始页随之退到后台
    activeTabId = id
    lastTabId = id
    screen = null
    HISTORY.unshift({
      id,
      url,
      title: name,
      faviconUrl: undefined,
      visitedAt: Date.now(),
      visitCount: 1
    })
  }

  emitTabs()
  // 只回文件名，不回路径——与真机的 handler 同一个规矩
  return Promise.resolve(names)
}

contextBridge.exposeInMainWorld('zhituan', {
  config: {
    get: () => Promise.resolve(config),
    patch: patchConfig,
    onChanged: (listener) => {
      configListeners.add(listener)
      return () => configListeners.delete(listener)
    }
  },
  ballIcon: {
    get: () => Promise.resolve(ballImage),
    set: (input) => {
      ballImage = input?.dataUrl ?? null
      // 存下来的那一份也报给主进程：裁剪弹窗导出的到底是个什么东西，
      // 只有把它捞出来存成文件看一眼才算验过（见 spike/ball-crop.js）
      ipcRenderer.send('preview:ballImage', ballImage)
      for (const listener of ballListeners) listener(ballImage)
      return Promise.resolve(ballImage)
    },
    onChanged: (listener) => {
      ballListeners.add(listener)
      return () => ballListeners.delete(listener)
    }
  },
  sites: {
    list: () => Promise.resolve(SITES),
    add: list,
    update: list,
    remove: list,
    reorder: list,
    /*
     * 热门站点那张表由主进程打出来递进来（见 preview.js 的 presetSitesOf）。
     * 原先这里回的是空数组，于是弹出面板的「热门站点」标题底下一条都没有
     * ——真机上那张表是有内容的，假桥必须跟着走，否则看到的是一个
     * 只存在于探针里的空面板。
     */
    presets: () => Promise.resolve(presets)
  },
  history: { list: () => Promise.resolve(HISTORY), clear: ok },
  bookmarks: { list: () => Promise.resolve(BOOKMARKS), remove: list, update: list },
  /*
   * 打开本机文件那条桥。
   *
   * 真机上是主进程弹系统选文件框、把选中的路径转成 file:// 再开一张标签页
   * （见 src/main/ipc/registerFileIpc.ts）。无头窗口里弹不出系统对话框，因此这里
   * 把「用户选了这几本」直接摆出来，后面那几步照做：新开一格标签、往历史里记
   * 一条、广播出去。
   *
   * 摆到这一步是有用的：点一下「打开文件…」之后，标签条上多一格、历史里多一条、
   * 「离线阅读」那一栏随后就列出这本书——界面这一半的路全通了。剩下那一半
   * （对话框的过滤器、路径转 URL、选中的书真读得起来）在真机上，由
   * spike/home-sections.js 拿一个假的 dialog 验。
   *
   * 不给 --open-file 时按「用户点了取消」算：什么都不发生，返回空数组。
   * 取消这条路也要看得见——它是这条路上最常发生的一步。
   */
  files: {
    openLocal: () => openLocalFiles()
  },
  tabs: {
    create: () => Promise.resolve({ tabId: 't9' }),
    /*
     * 切换、关闭、进出自家那两屏都要真的改掉这张表并广播出去。
     *
     * 标签条是「点了就该有反应」的东西，假桥要是把这些当空操作吞掉，
     * 预览里点一下什么动静都没有，也就验不出点中的是不是那一格。
     * 进出那两屏尤其要紧：--click-screen 要看的正是「点一下那颗键，
     * 标签条有没有变得哪一格都不高亮、那颗键自己有没有亮起来」。
     */
    close: (input) => {
      const at = TABS.findIndex((t) => t.id === input.tabId)
      if (at >= 0) TABS.splice(at, 1)
      if (lastTabId === input.tabId) lastTabId = null
      /*
       * 关掉的是**正在看着的那一张**：还有网页就切到最后一张，一张都不剩就
       * 落回起始页。停在自家那两屏上时「正在看着的那张」是 null（关谁都动不到
       * 那一屏），因此这一段与主进程的 close() 走的是同一套判断。
       */
      if (activeTabId === input.tabId) {
        const next = TABS[TABS.length - 1]
        if (next) {
          activeTabId = next.id
          lastTabId = next.id
          screen = null
        } else {
          screen = 'home'
          activeTabId = null
        }
      }
      emitTabs()
      return Promise.resolve()
    },
    activate: (input) => {
      activeTabId = input.tabId
      screen = null
      if (input.tabId) lastTabId = input.tabId
      emitTabs()
      return Promise.resolve()
    },
    reorder: ok,
    list: () => Promise.resolve(tabsState()),
    onState: (listener) => {
      tabListeners.add(listener)
      return () => tabListeners.delete(listener)
    }
  },
  nav: { goto: ok, back: ok, forward: ok, reload: ok, stop: ok },
  page: { setZoom: () => Promise.resolve(1), setUa: () => Promise.resolve('desktop') },
  win: {
    /*
     * 整体透明度这条滑块走的是窗口级属性，与设置页那条走 configPatch 的不是同一条
     * 路，因此这里**收下就完**——配置镜像不动，正是「主进程一声不响」的极端情形
     * （真机上广播迟早会来，这里永远不来）。--drag-opacity 那一问要量的恰恰是
     * 滑块自己那半边：松手之后它守不守得住刚拖到的值。请求照旧记一笔账，
     * 好确认它真的把意图发出去了。
     */
    setOpacity: (input) => {
      opacityCalls.push(input?.value ?? null)
      return Promise.resolve()
    },
    /** --drag-opacity 用：读回那条滑块发过哪些值 */
    opacityLog: () => ({ calls: [...opacityCalls] }),
    collapse: ok,
    expand: ok,
    maximize: () => {
      setMaximized(true)
      return Promise.resolve()
    },
    restore: () => {
      setMaximized(false)
      return Promise.resolve()
    },
    dragStart: () => {
      dragStarts += 1
    },
    dragEnd: () => {
      dragEnds += 1
    },
    dragLog: () => ({ starts: dragStarts, ends: dragEnds }),
    resizeStart: (edge) => {
      resizeStarts += 1
      resizeEdges.push(edge)
    },
    resizeEnd: () => {
      resizeEnds += 1
    },
    resizeLog: () => ({ starts: resizeStarts, ends: resizeEnds, edges: resizeEdges }),
    setAddressOpen: () => {},
    setChrome: () => {},
    setBallRect: (rect) => ipcRenderer.send('preview:ballRect', rect),
    openBallMenu: ok,
    setSize: ok,
    minimize: ok,
    hideToTray: ok,
    reassert: ok,
    close: ok,
    getState: () => Promise.resolve({ ...state }),
    onState: (listener) => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    }
  },
  /*
   * 进出自家那两屏那几条路。
   *
   * 顶栏最左并排那两颗键：起始页发的是 openHome / leaveScreen，设置发的是
   * openSettings / leaveScreen（判据在界面那一侧，主进程只认「进去」「退出来」
   * 这两件事，见 shared/ipc.ts 里 uiLeaveScreen 的注释）。这三条要真的改状态
   * 并广播，否则预览里点那颗键什么都不会变，也就验不出「再点一次原路返回」。
   */
  ui: {
    /*
     * 弹出面板这一条要记账，不能收下就完。
     *
     * 「点标签条那枚下拉按钮展开清单」与「点它进到那张网页里去」是两件事，
     * 而两件事都只是发一条请求：面板是另一个窗口，在预览里根本不会出现。
     * 因此判据只能落在「发没发这条请求」上——`--click-fallback` 就是问这个。
     */
    openPopover: (input) => {
      POPOVERS.push(input)
      return Promise.resolve()
    },
    closePopover: ok,
    /** 只存在于这份假桥里（真实的 preload 没有它），给 --click-fallback 用 */
    popoverLog: () => ({ requests: POPOVERS.map((p) => p.kind) }),
    openSettings: () => {
      openScreen('settings')
      return Promise.resolve()
    },
    openHome: () => {
      openScreen('home')
      return Promise.resolve()
    },
    leaveScreen: () => {
      leaveScreen()
      return Promise.resolve()
    }
  },
  update: {
    get: () => Promise.resolve({ ...updateState }),
    /*
     * 查一次不动形态：要看的形态都是命令行摆出来的，而「查完之后画成什么样」
     * 在真机上由 updateService 决定。这里只保证按钮点得动、回得来。
     */
    check: () => Promise.resolve({ ...updateState }),
    /*
     * 「更新并重启」这一下真的会改状态，改法与 updateService.install 一致：
     * 已下好的直接装（界面看不出变化，除了 installCalls 记了一笔）；正在下的
     * 只记下意图（pendingInstall），那句话就会变成「下完自动重启安装」、按钮收起；
     * 还没下的先把下载起起来——真机上那一瞬间就是 downloading + 0%。
     */
    install: () => {
      if (updateState.phase === 'ready') installCalls += 1
      else if (updateState.phase === 'available') {
        updateState.phase = 'downloading'
        updateState.percent = 0
        updateState.pendingInstall = true
      } else if (updateState.phase === 'downloading') updateState.pendingInstall = true
      emitUpdate()
      return Promise.resolve()
    },
    /** --drag-probe 那套的同一招：把点击的账记下来，供探针来读 */
    installLog: () => ({ calls: installCalls }),
    ignore: (input) => {
      config.update.ignoredVersion = input?.version ?? null
      updateState.ignored =
        updateState.version !== null && config.update.ignoredVersion === updateState.version
      // 与 updateService.ignore 同一条：正在下的时候被忽略，那份下载就中止了，
      // 状态落回 available（下半句「下完自动装」也跟着作废）
      if (input?.version !== null && updateState.phase === 'downloading') {
        updateState.phase = 'available'
        updateState.percent = 0
        updateState.pendingInstall = false
      } else updateState.pendingInstall = false
      emitUpdate()
      syncNotice()
      return Promise.resolve({ ...updateState })
    },
    onState: onUpdate
  },
  hotkey: {
    list: () =>
      Promise.resolve({
        bossMinimize: { accelerator: 'Alt+Z', registered: true },
        bossHideToTray: { accelerator: 'Alt+X', registered: true }
      }),
    set: () => Promise.resolve({ ok: true, accelerator: 'Alt+Z' })
  },
  app: { quit: ok }
})
