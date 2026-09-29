/**
 * IPC 通道与载荷契约。渲染进程、预加载与主进程共用这一份定义。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type {
  AppConfig,
  Bookmark,
  HiddenSite,
  HistoryEntry,
  HotkeyInfo,
  OwnScreen,
  Rect,
  ResizeEdge,
  SiteRecord,
  TabState,
  UpdateState,
  WindowRuntime
} from './types'

/** 渲染进程 → 主进程的请求通道（invoke/handle） */
export const INVOKE = {
  configGet: 'config:get',
  configPatch: 'config:patch',

  ballIconGet: 'ballIcon:get',
  ballIconSet: 'ballIcon:set',

  sitesList: 'sites:list',
  sitesAdd: 'sites:add',
  sitesUpdate: 'sites:update',
  sitesRemove: 'sites:remove',
  sitesReorder: 'sites:reorder',
  /**
   * 起始页上被移除的站点域名。
   *
   * 「删除」在起始页上是**一条规矩、三个来源**：我的站点删的是记录，
   * 常访问与热门站点没有记录可删，只能记下这个域名别再出现。这一组通道
   * 就是那后半截，见 @shared/types 的 HiddenSite 与 services/hiddenSiteStore.ts。
   */
  hiddenList: 'hidden:list',
  hiddenAdd: 'hidden:add',
  hiddenRemove: 'hidden:remove',

  historyList: 'history:list',
  historyClear: 'history:clear',

  bookmarksList: 'bookmarks:list',
  bookmarksRemove: 'bookmarks:remove',
  bookmarksUpdate: 'bookmarks:update',

  tabsCreate: 'tabs:create',
  tabsClose: 'tabs:close',
  tabsActivate: 'tabs:activate',
  tabsReorder: 'tabs:reorder',
  tabsList: 'tabs:list',

  navGoto: 'nav:goto',
  navBack: 'nav:back',
  navForward: 'nav:forward',
  navReload: 'nav:reload',
  navStop: 'nav:stop',

  pageSetZoom: 'page:setZoom',
  pageSetUa: 'page:setUa',

  winSetOpacity: 'window:setOpacity',
  winCollapse: 'window:collapse',
  winExpand: 'window:expand',
  /**
   * 最大化 / 还原。
   *
   * 走 invoke 而不是 SEND（与 collapse/expand 一样）：两者都会改版面，
   * 界面要等主进程排完再按回传的状态绘制。托盘菜单与悬浮球菜单走的是
   * 主进程内部同一个入口，因此三条路的结果必然一致。
   */
  winMaximize: 'window:maximize',
  winRestore: 'window:restore',
  winOpenBallMenu: 'window:openBallMenu',
  winSetSize: 'window:setSize',
  winMinimize: 'window:minimize',
  winHideToTray: 'window:hideToTray',
  winReassert: 'window:reassert',
  winClose: 'window:close',
  winGetState: 'window:getState',

  uiOpenPopover: 'ui:openPopover',
  uiClosePopover: 'ui:closePopover',
  uiOpenSettings: 'ui:openSettings',
  uiOpenHome: 'ui:openHome',
  /**
   * 从起始页 / 设置这两屏「原路返回」：回到进来之前那张网页。
   *
   * 顶栏最左并排的那两颗键（起始页、设置）共用这一条——它们在自己的那一屏上
   * 再被点一次就是这个意思。切换的判据在界面那一侧（它看得见此刻停在哪一屏），
   * 而托盘与悬浮球菜单里那两项不走这条路：菜单是明确意图，不是开关。
   */
  uiLeaveScreen: 'ui:leaveScreen',

  hotkeyList: 'hotkey:list',
  hotkeySet: 'hotkey:set',

  /**
   * 打开本机文件（离线阅读）。
   *
   * 主进程弹系统选文件框，选中的路径转成 file:// 打开成一张普通的网页标签
   * ——TXT 与 PDF 交给 Chromium 自己渲染，不需要新的视图种类。
   * 回来的是**文件名**数组，不是路径（见 @shared/url.ts 的 fileNameOf）。
   */
  fileOpenLocal: 'file:openLocal',

  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateIgnore: 'update:ignore',

  appQuit: 'app:quit'
} as const

/** 主进程 → 渲染进程的广播通道（send/on） */
export const BROADCAST = {
  configChanged: 'config:changed',
  /**
   * 自定义悬浮球图标变了。
   *
   * 图标不在配置里（见 `services/ballIconStore.ts`），因此它不走 configChanged；
   * 而球与设置页是两个文档，各自持有一份图，改动必须让两边同时知道。
   */
  ballIconChanged: 'ballIcon:changed',
  tabsState: 'tabs:state',
  windowState: 'window:state',
  /**
   * 更新这件事的状态（查到了什么、下到哪儿了）。
   *
   * 与提示条是否占版面（WindowRuntime.noticeVisible）分开：那条是版面状态、
   * 归窗口控制器；这条是内容、归更新服务。两份状态各有各的主人。
   */
  updateState: 'update:state'
} as const

/**
 * 渲染进程 → 主进程的单向消息。
 *
 * 用于不需要回执的事件。拖动是高频动作，走 invoke/handle 的往返会引入延迟，
 * 而拖动的定位完全由主进程计算，本就不需要返回值。
 */
export const SEND = {
  dragStart: 'window:dragStart',
  dragEnd: 'window:dragEnd',
  /**
   * 拖动窗口的边缘改大小。
   *
   * 与拖动同一套道理：界面只报「拖的是哪条边」，**起始矩形与光标位置都由主进程读**
   * （渲染进程读不到全局光标，指针一离开窗口它就收不到事件了）。
   * 于是两边不必各存一份几何，也不会出现「界面算出来的矩形与窗口实际的不一致」。
   * 载荷见 ResizeEdge；缩放严格保持 16:9，算它的只有 geometry.resizeRect 一处。
   */
  resizeStart: 'window:resizeStart',
  resizeEnd: 'window:resizeEnd',
  /** 展开或折叠地址栏。主进程据此重排版面，再回传最终状态 */
  setAddressOpen: 'window:setAddressOpen',
  /**
   * 顶栏 / 右侧栏的显隐。
   *
   * 与地址栏同理：两者都是版面的一部分，正文是原生视图，必须由主进程
   * 先重排再回传，界面按回传的结果绘制。用户的选择还会落盘。
   */
  setChrome: 'window:setChrome',
  /**
   * 悬浮球的窗口内矩形（DIP）。
   *
   * 球是 DOM 元素，它的位置由 CSS 的排布决定；而收起时主进程要把整扇窗
   * 缩到球身上，因此必须由渲染进程把量到的矩形报上来。在别处重算一遍
   * 球的位置等于把版面规则抄成两份，迟早会差出几个像素。
   */
  setBallRect: 'window:setBallRect',
  /**
   * 报一次读到哪儿了（本机 EPUB 与 TXT）。
   *
   * 走单向消息而不是 invoke：一次会话里会报很多次（翻章、停滚、关页），而这件事
   * **没有回话要听**——主进程拿去合并落盘，阅读页不需要任何人确认，与拖动、缩放
   * 是同一条道理。位置由阅读页自己量（只有它知道章内比例），主进程只把这串 token
   * 换算成本机路径再记下来（见 services/bookReader.ts 与 services/txtReader.ts
   * 的 rememberReading——两个页面同用这一条通道，token 是各自现发的）。
   */
  bookReading: 'book:reading'
} as const

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE]
export type BroadcastChannel = (typeof BROADCAST)[keyof typeof BROADCAST]

// ---------------------------------------------------------------- 载荷类型

export type ConfigPatch = {
  [K in keyof AppConfig]?: AppConfig[K] extends object ? Partial<AppConfig[K]> : AppConfig[K]
}

export interface TabsStatePayload {
  /** 标签条画的就是它：只有网页标签，自家那两屏不在其中 */
  tabs: TabState[]
  /** 正在看着的那张网页；停在起始页 / 设置上时为 null（那时没有哪一格是高亮的） */
  activeTabId: string | null
  /** 起始页 / 系统设置哪一屏正在上面；看着网页时为 null */
  screen: OwnScreen | null
  /**
   * 上一次看着的那张网页。
   *
   * 「原路返回」回的就是它（TabManager.leaveScreen）。它出现在这份快照里
   * **只为顶栏那个地址栏开关**：那一格写的是「当前这张网页」，而停在自家那两屏上时
   * 没有当前网页——没有它，界面就只剩屏名可写，于是那一格会变成「起始页」「系统设置」，
   * 顶栏读起来像多了一个叫「系统设置」的标签页（用户报的正是这条）。
   *
   * 界面拿到它，就不必自己攒一份「上一次是什么」的副本——那类副本迟早与真身对不上。
   */
  lastTabId: string | null
}

export interface OpenPopoverRequest {
  /**
   * 面板种类。
   *
   * `typeset` 是离线阅读的排版三项（字号 / 行距 / 左右留白）。它与自家 EPUB / TXT
   * 阅读页里那枚 Aa 打开的是同一组控件、写的是同一份配置，区别只在锚点：
   * 页里那一枚长在页面自己的右下角，这一枚长在顶栏上——它服务的对象是那些
   * **Chromium 自己渲染**的本机文本（`.md`、`.log` 这一类），页面上没有一处
   * 可以让我们挂控件。自家那两页也吃它（写的是同一份配置，页面听配置广播），
   * 于是「顶栏这一枚在读自家阅读页时是禁用的」这种别扭事不必发生。
   *
   * **没有 `sites` 这一档**（1.6.7 起）：站点改在起始页那一屏上管了
   * （增删改与视图切换都在那边），右栏那枚「站点」键与这块面板一并撤掉。
   * 站点记录本身还在（services/siteStore.ts），只是不再从这里进出。
   */
  kind: 'history' | 'bookmarks' | 'uaZoom' | 'tabs' | 'typeset'
  /** 锚点矩形（DIP，相对于摸鱼窗口的客户区），主进程据此摆放面板 */
  anchorRect: Rect
}

/** 顶栏 / 右侧栏的显隐请求。未给的字段保持原样 */
export interface ChromePatch {
  topBar?: boolean
  rail?: boolean
}

/**
 * 预加载暴露给渲染进程的 API 形状。
 * 这是渲染进程能触碰的全部主进程能力，不做任何额外暴露。
 */
export interface ZhituanApi {
  config: {
    get(): Promise<AppConfig>
    patch(patch: ConfigPatch): Promise<AppConfig>
    onChanged(cb: (config: AppConfig) => void): () => void
  }
  /**
   * 自定义的悬浮球图标（data URI），以及它的增删改。
   *
   * 与配置分开：这张图有几 KB，而配置一变就全量广播。`set(null)` 是清除，
   * 返回的总是**真正存下来的值**——不合法（超限、不是图片）的输入会被主进程
   * 挡下并回 null，界面据此把选择退回内置图标，而不是留着一个画不出来的选择。
   */
  ballIcon: {
    get(): Promise<string | null>
    set(input: { dataUrl: string | null }): Promise<string | null>
    onChanged(cb: (dataUrl: string | null) => void): () => void
  }
  sites: {
    list(): Promise<SiteRecord[]>
    add(input: { title?: string; url: string }): Promise<SiteRecord[]>
    update(input: { id: string; patch: Partial<SiteRecord> }): Promise<SiteRecord[]>
    remove(input: { id: string }): Promise<SiteRecord[]>
    reorder(input: { ids: string[] }): Promise<SiteRecord[]>
  }
  /**
   * 起始页上被移除的站点域名。
   *
   * 只有「记下来」与「划掉」两个动作，没有「改」：这份名单里每一条的内容就是
   * 一个域名，改它等于删一条再加一条。起始页那三个来源的删除因此共用这一组
   * ——见 @shared/types 的 HiddenSite。
   *
   * 两边都收**一个数组**：起始页上「移除」这一下可能同时牵动两个域名
   * （把一个站点的地址改成别家，旧域名也要一并消失），一次说清比来回两趟稳。
   */
  hidden: {
    list(): Promise<HiddenSite[]>
    add(input: { domains: string[] }): Promise<HiddenSite[]>
    remove(input: { domains: string[] }): Promise<HiddenSite[]>
  }
  history: {
    list(input?: { query?: string; limit?: number; offset?: number }): Promise<HistoryEntry[]>
    clear(): Promise<void>
  }
  bookmarks: {
    list(input?: { query?: string }): Promise<Bookmark[]>
    remove(input: { id: string }): Promise<Bookmark[]>
    update(input: { id: string; patch: Partial<Bookmark> }): Promise<Bookmark[]>
  }
  tabs: {
    /**
     * 新建一张网页标签。
     *
     * 不给 `url` 就是「新建标签页」：打开配置里的那一格（browser.newTabUrl，
     * 默认 google.com）。原先这一种退到 about:blank——透明窗口里那是一块
     * 透出桌面的空档，没有意义。
     */
    create(input?: { url?: string; activate?: boolean }): Promise<{ tabId: string }>
    close(input: { tabId: string }): Promise<void>
    activate(input: { tabId: string }): Promise<void>
    reorder(input: { tabId: string; toIndex: number }): Promise<void>
    list(): Promise<TabsStatePayload>
    onState(cb: (payload: TabsStatePayload) => void): () => void
  }
  nav: {
    /**
     * 打开一个地址。
     *
     * `tabId` 为 null（正文区正停在起始页 / 设置上，没有当前网页）时另开一张
     * 标签页并切过去——自家那两屏不承载访客内容，它们带着 preload。
     * 这也是起始页上那颗「打开」的一贯规矩：起始页始终留在原处。
     */
    goto(input: { tabId: string | null; input: string }): Promise<void>
    back(input: { tabId: string }): Promise<void>
    forward(input: { tabId: string }): Promise<void>
    reload(input: { tabId: string }): Promise<void>
    stop(input: { tabId: string }): Promise<void>
  }
  page: {
    setZoom(input: { tabId: string; op: 'in' | 'out' | 'reset' | 'set'; value?: number }): Promise<number>
    setUa(input: { tabId: string; mode: 'desktop' | 'mobile' }): Promise<string>
  }
  win: {
    setOpacity(input: { value: number }): Promise<void>
    /** 整个界面缩成悬浮球 */
    collapse(): Promise<void>
    /** 从悬浮球展开回完整界面 */
    expand(): Promise<void>
    /**
     * 铺满当前显示器的整个工作区。
     *
     * 不保 16:9（形状随显示器），随之隐藏顶栏、地址栏与右侧栏，只在右上角
     * 浮出「还原键 + 悬浮球」。还原回到最大化之前的那块 16:9 矩形，
     * 而不是回到某个预设档。
     */
    maximize(): Promise<void>
    /** 从最大化回到之前的 16:9 矩形 */
    restore(): Promise<void>
    /**
     * 开始拖动窗口。定位由主进程计算——它读得到全局光标位置，
     * 因此即使指针短暂移出窗口也不会丢失跟踪。
     */
    dragStart(): void
    /** 结束拖动 */
    dragEnd(): void
    /**
     * 开始拖动边缘改大小。与 dragStart 一样由主进程接过去按帧做，
     * 界面只报「拖的是哪条边」——起始矩形与光标都在主进程那一侧读。
     * 结果恒为 16:9，且被拖边对面那条边钉住不动。
     */
    resizeStart(edge: ResizeEdge): void
    /** 结束缩放。主进程据此停表并记下新矩形 */
    resizeEnd(): void
    /**
     * 展开或折叠地址栏。
     *
     * 它是版面的一部分：展开时正文要让出一行，所以状态由主进程持有，
     * 渲染进程只发出意图，界面按回传的状态绘制。因此没有回执。
     */
    setAddressOpen(input: { open: boolean }): void
    /** 显示或隐藏顶栏 / 右侧栏。两者都是版面的一部分，同 setAddressOpen */
    setChrome(input: ChromePatch): void
    /**
     * 上报悬浮球此刻在窗口内的矩形。
     *
     * 球的位置由 CSS 排布决定（排在顶栏里，或顶栏隐藏时浮在右上角），
     * 主进程不重复推导，只按收到的矩形把窗口缩到球身上。
     */
    setBallRect(rect: Rect): void
    /** 在光标处弹出悬浮球菜单（含「隐藏顶部栏」） */
    openBallMenu(): Promise<void>
    setSize(input: { preset: string } | { width: number; height: number }): Promise<void>
    minimize(): Promise<void>
    hideToTray(): Promise<void>
    reassert(): Promise<void>
    close(): Promise<void>
    getState(): Promise<WindowRuntime>
    onState(cb: (state: WindowRuntime) => void): () => void
  }
  ui: {
    openPopover(req: OpenPopoverRequest): Promise<void>
    closePopover(): Promise<void>
    /**
     * 进入系统设置。
     *
     * 它和起始页一样是窗口内的一屏，不开独立窗口：独立窗口会出现在任务栏
     * 与 Alt+Tab 里，等于把「我在摸鱼」写在脸上。已有这一屏就切过去，
     * 不重复开。托盘菜单与悬浮球菜单里那两项走的就是这条，**永远进去**。
     */
    openSettings(): Promise<void>
    /** 进入起始页。顶栏左上角那颗键在别的屏上时走这条 */
    openHome(): Promise<void>
    /**
     * 从这两屏原路返回进来之前那张网页（没有可回的就落回起始页）。
     *
     * 只有界面发这条：两颗键各自在自己那一屏上再被点一次时才是这个意思。
     */
    leaveScreen(): Promise<void>
  }
  hotkey: {
    list(): Promise<{ bossMinimize: HotkeyInfo; bossHideToTray: HotkeyInfo }>
    set(input: {
      which: 'bossMinimize' | 'bossHideToTray'
      accelerator: string
    }): Promise<{ ok: boolean; accelerator: string; reason?: string }>
  }
  /**
   * 本机文件（离线阅读）。
   *
   * 只有一个动作，因为这条路刻意做得最短：**系统选文件框选中的那几本直接
   * 开成普通的网页标签**，没有「书架」这种中间态要维护。回到的是文件名数组
   * （用户取消时是空的），只用来给界面一句回话——路径不出主进程。
   */
  files: {
    openLocal(): Promise<string[]>
  }
  /**
   * 本机阅读页（EPUB 与 TXT）的阅读位置。
   *
   * 只有「记」没有「读」：**上次读到哪儿，是主进程开这一页时就写进地址里的**
   * （`book.html?doc=…&at=…&ratio=…`，TXT 那一页同构，见 services/bookReader.ts
   * 的 bookReaderUrl 与 services/txtReader.ts 的 txtReaderUrl），
   * 于是阅读页打开的那一刻就是对的姿势，不必先问一次、再闪一下。
   *
   * 位置由**阅读页**给：章内比例只有量过滚动高度的那一边才知道；而把 token 换成
   * 哪一本书，只有主进程知道（路径不出主进程）。
   *
   * 两个页面同用这一条通道，「章」在两个页面上的含义也一样（EPUB 是书内那一章的
   * 相对路径，TXT 是 `<章序>:<章名>`，见 @shared/txt），因此没有第二个 API。
   */
  book: {
    /** 报一次位置。单向、不等回执，主进程那一侧合并落盘 */
    remember(input: { token: string; chapter: string; ratio: number }): void
  }
  /**
   * 检查更新。
   *
   * 四个动作都返回**做完之后**的状态：界面不必自己猜主进程走到了哪一步
   * （下载进度这种一路在变的东西，猜出来的那一份必然是错的）。
   *
   * 没有单独的「下载」——下载不是用户的一个动作，而是「检查更新」与「更新并重启」
   * 各自的后半截（见 updateService 的 check / install）。进度不另设回调：
   * 一个 BROADCAST.updateState 就够，提示条与设置页听的是同一条。
   */
  update: {
    get(): Promise<UpdateState>
    /** 查一次；查到的比现在新就开始下。正在查或正在下时直接返回当前状态，不叠第二次 */
    check(): Promise<UpdateState>
    /**
     * 更新并重启。已经下好就立刻装；还在下就记下这个意图、下完自己装；
     * 还没开始下就先把下载起起来。**没下完、没校验通过时不许装**。
     */
    install(): Promise<void>
    /** 忽略这个版本：整条提示收掉，且下次启动不再出现。正在下的话把那一份也中止掉。传 null 是撤销 */
    ignore(input: { version: string | null }): Promise<UpdateState>
    onState(cb: (state: UpdateState) => void): () => void
  }
  app: {
    quit(): Promise<void>
  }
}
