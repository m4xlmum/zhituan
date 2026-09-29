/**
 * 视图管理：每个标签页一个 WebContentsView，叠加在 chrome 视图之上、限制在主体区域内。
 *
 * 这里管三种视图，它们不共用同一本账：
 *
 * - **网页标签**（kind = 'guest'）：标签条画的就是它们，`order` 记着它们的次序；
 * - **本机 PDF 的阅读页**（kind = 'pdf'）：同样是标签条上的一格（它有标题、有 ✕、
 *   能被切走），但它画的是自家那一页 pdf.js，不是网页——见 services/pdfReader.ts。
 *   它对外示人的地址仍是那个 `file:///…/book.pdf`：历史、离线阅读那一行、地址栏
 *   上的名字都按本机文件读，而视图里加载的是阅读页（`viewUrl`）。
 * - **本机 EPUB 的阅读页**（kind = 'book'）：与上一条同构、同一条账——`viewUrl`
 *   指向自家书页，对外露的仍是那个 `.epub`。差别只在谁来拆书：见
 *   services/bookReader.ts（解包是主进程的活，排版是页面自己的活）。
 * - **本机 TXT 的阅读页**（kind = 'txt'）：同上第三条账，`viewUrl` 指向自家那一页，
 *   对外露的仍是那个 `.txt`。差别在它连解析都不在主进程：那一页自己认编码、自己切章
 *   （见 services/txtReader.ts 与 @shared/txt.ts），而「读到哪一章了」也由它报回来。
 * - **自家的两屏**（起始页、系统设置）：也在这一层视图里（独立窗口会进任务栏与
 *   Alt+Tab，等于把「我在摸鱼」写在脸上），但**不是标签页**——不进 `order`、
 *   没有关闭键、各有各的入口（两者是顶栏最左并排的两颗键：起始页、设置）。
 *
 * 五者共用同一套机制（视图、可见性、版面、广播），差别只在上面那本账：
 * **进标签条的是前四种**（isTab），**带 preload 的除了访客页都有**（needsPreload
 * 就是 `kind !== 'guest'`）——这两条判据在这一版之前是同一条（「不是访客页」），
 * 本机 PDF 一来就分家了。
 *
 * **kind 只在 create() 一处判**（本机 PDF / 本机 EPUB / 本机 TXT / 其余），四种入口
 * ——会话恢复、选文件框、网页里点一个 file: 链接、地址栏粘路径——都从那一条过。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import {
  WebContentsView,
  type BaseWindow,
  type Session,
  type WebContents,
  type WebFrameMain
} from 'electron'
import {
  DEFAULT_NEW_TAB_URL,
  HOME_TITLE,
  HOME_URL,
  SETTINGS_TITLE,
  SETTINGS_URL
} from '@shared/constants'
import type { TabsStatePayload } from '@shared/ipc'
import type { OwnScreen, Rect, TabState } from '@shared/types'
import { fileNameOf, isLocalEpub, isLocalFile, isLocalPdf, isLocalTxt, resolveInput } from '@shared/url'
import { uaFor, type UaMode } from '@shared/ua'
import { applyReaderOpacity, applyReaderTypeset, injectPageStyles } from './pageStyler'
import { bookReaderUrl } from './bookReader'
import { txtReaderUrl } from './txtReader'
import { pdfReaderUrl } from './pdfReader'
import { rendererUrl } from './rendererUrl'
import { log } from './logger'

/**
 * 自家页面（带 preload，以伪地址示人）、网页（纯网页，无 preload）、
 * 本机文件的三个阅读页（自家的一页，画在标签条上）。
 * 访客页绝不与另外几类共用视图：给访客页注入 preload 等于把主进程能力交给任意网页。
 */
export type TabKind = 'home' | 'settings' | 'guest' | 'pdf' | 'book' | 'txt'

/** 自家页面：渲染产物名、对外伪地址与标签标题 */
const OWN_PAGE: Record<OwnScreen, { page: 'home' | 'settings'; url: string; title: string }> = {
  home: { page: 'home', url: HOME_URL, title: HOME_TITLE },
  settings: { page: 'settings', url: SETTINGS_URL, title: SETTINGS_TITLE }
}

/** 窗口里的「一屏」：起始页与系统设置。它们不是标签页，各有各的入口键 */
const isScreen = (kind: TabKind): kind is OwnScreen => kind === 'home' || kind === 'settings'

/** 进标签条的东西：网页与本机文件。清单、次序、关闭、会话恢复都按它走 */
const isTab = (kind: TabKind): boolean => !isScreen(kind)

/**
 * 带 preload 的视图：自家那两屏，加三个阅读页（本机 PDF / EPUB / TXT）。
 *
 * 三个阅读页都要读配置——主题决定墨色，阅读透明度决定纸的深浅——因此它们与自家
 * 那两屏一样需要那座桥；网页则一律没有。
 */
const needsPreload = (kind: TabKind): boolean => kind !== 'guest'

/**
 * 暂停网页里正在播放的音视频。**暂停，不是静音。**
 *
 * 两种场合都要它，理由不同：
 *
 * - **窗口没露出来**（收起成球 / 藏进托盘 / 最小化）：窗口虽然不在屏幕上，网页
 *   那一侧仍是一个活着的渲染进程——视频会照常往下播，用户回来时进度已经跑掉了。
 *   那一场合还要闭麦：`setAudioMuted` 解决的是听得到的那一半（Web Audio 与我们
 *   暂停不到的播放器都靠它）。
 * - **切走那一页**（切到别的标签、或进起始页 / 设置）：页面照样活着，同样会往下播。
 *   这一场合只暂停、不闭麦——用户在别处可能正听着东西，见 @shared/types 的
 *   pauseMediaOnSwitch。
 *
 * 记号打成一个展开属性（`__zhituanPaused`）而不是 `data-` 属性：后者会出现在 DOM 里，
 * 页面自己能看见。也正因为记号在元素上，页面换了播放器元素、或者整页导航走了，
 * 这份账就自然作废，不会出现「恢复了一个已经不存在的播放器」。
 */
const PAUSE_PLAYING_MEDIA = `(() => {
  let n = 0
  for (const el of document.querySelectorAll('video, audio')) {
    if (el.paused || el.ended) continue
    el.__zhituanPaused = true
    el.pause()
    n += 1
  }
  return n
})()`

/**
 * 恢复**我们自己**按下去的暂停。
 *
 * 只认那个记号：用户自己按了暂停的视频，展开时不该被我们放起来——那比不暂停更烦。
 * 万一 `play()` 被拦下来（自动播放策略、DRM），就让它停着：停在原处总比误放强。
 */
const RESUME_PAUSED_MEDIA = `(() => {
  let n = 0
  for (const el of document.querySelectorAll('video, audio')) {
    if (el.__zhituanPaused !== true) continue
    delete el.__zhituanPaused
    n += 1
    const p = el.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  return n
})()`

interface TabEntry {
  id: string
  kind: TabKind
  view: WebContentsView
  /** **对外示人**的地址。本机 PDF 写的是那个 file:///…/book.pdf（历史、会话恢复、地址栏都用它） */
  url: string
  /**
   * 视图里实际加载的地址，**只在它与 `url` 不同的时候**才有值。
   *
   * 本机文件那三种阅读页（PDF / EPUB / TXT）都用它：对外是一个本机文件，视图里却是
   * 自家的阅读页（`file:///…/book.html?doc=<token>` 或 `…/txt.html?doc=<token>`）。
   * 为它单开一个字段，而不是把 `url`
   * 改成阅读页的地址，是因为那份地址不是「这本书在哪儿」——写进历史、
   * 写进会话恢复、写进地址栏都会把内部结构泄到界面上，且下次启动恢复不了
   * （token 是这次进程里现发的）。
   */
  viewUrl?: string
  title: string
  faviconUrl?: string
  isLoading: boolean
  uaMode: UaMode
  zoom: number
  muted: boolean
}

export interface TabManagerDeps {
  getWindow: () => BaseWindow | null
  getBodyRect: () => Rect
  getSession: () => Session
  /** 自家那两屏与三个阅读页都要 preload：前者读站点/历史，后者读配置 */
  getPreloadPath: () => string
  getConfig: () => {
    browser: {
      defaultUaMode: UaMode
      defaultZoom: number
      hideScrollbars: boolean
      newWindowAsTab: boolean
      searchTemplate: string
      newTabUrl: string
    }
    ui: {
      /** 离线阅读正文的透明度：开着的本机文件要按它往自己的视图里注入 */
      readerOpacity: number
      /**
       * 离线阅读的排版三项（字号 / 行距 / 左右留白）。
       *
       * 与上面那一条同一个去处、同一个时机，但**吃到它的东西分两种**：
       * Chromium 自己排的纯文本（`.md`、`.log` 这一类）只能由主进程往那个 `pre`
       * 上写（见 pageStyler 的 applyReaderTypeset）；本机 EPUB 与 TXT 那两页不吃
       * 这一条——它们自己从配置里读（book/BookApp.vue 与 txt/TxtApp.vue），
       * 于是那条路不经过这里。
       */
      readerFontSize: number
      readerLineHeight: number
      readerMargin: number
    }
    /**
     * 媒体那两条规矩读的就是这里（见 applyMediaState）。
     *
     * 只声明用得着的这两个字段，而不是把整份 stealth 摊开——与上面 browser / ui
     * 同一个写法：这一层要什么写什么，于是「它依赖了哪几项配置」一眼看得见，
     * 配置里多出一个字段也不会牵动这里。
     */
    stealth: {
      /** 窗口收起来（成球 / 托盘 / 最小化）时暂停全部媒体，并且静音 */
      muteMediaOnCollapse: boolean
      /** 切走那一页时暂停它：切到别的标签、或进起始页 / 系统设置 */
      pauseMediaOnSwitch: boolean
    }
  }
  onStateChange: () => void
  onNavigated: (entry: { url: string; title: string; faviconUrl?: string }) => void
  /**
   * 刚刚有一个标签页视图被加到最上层。
   *
   * 界面层（chrome 视图）有时必须压在网页之上——最大化时右上角那组控件、
   * 光标贴到窗口边框时左 / 下两条边的手柄（见 WindowController.syncChromeOrder）。
   * 而新建视图永远是加到最上层的，那一下就会把界面层盖住；改次序的只可能是
   * 界面层那一侧（它拿着 chrome 视图），于是这里只负责通知一声。
   */
  onViewAdded: () => void
  /**
   * 有标签页进了（true）或全部退出了（false）网页全屏。
   *
   * 只在**跃变**上报：从「没有页面在全屏」变成「有」，或反过来。
   * 后台标签页进出全屏不该掀动窗口，因此判据是整个集合的空 / 非空，
   * 而不是「谁进去了」。
   */
  onPageFullscreen: (active: boolean) => void
}

let seq = 0
const nextId = (): string => `tab-${Date.now().toString(36)}-${(seq++).toString(36)}`

export class TabManager {
  /** 全部视图：网页标签与自家那两屏都在这里（版面、显隐、广播按它走） */
  private tabs = new Map<string, TabEntry>()
  /** **标签条的次序**：只有网页标签。自家那两屏不进来，于是 list/reorder/会话恢复都不必再过滤 */
  private order: string[] = []
  /** 此刻画着的那一个（含自家那两屏）；对外只说成 activeTabId / screen 两份 */
  private activeId: string | null = null
  /** 自家那两屏的视图 id。各自只建一个，常驻不关 */
  private ownIds = new Map<OwnScreen, string>()
  /**
   * 上一次看着的那张**标签页**（网页或本机文件）。
   *
   * 从起始页 / 设置「原路返回」回的就是它。不需要另存一份「进屏之前的快照」：
   * 进这两屏不改动它，只有切到别张标签页（或它被关掉）才会变。
   */
  private lastTabId: string | null = null
  /** 主体隐藏时为 true，此时所有标签页视图都不绘制且静音 */
  private bodyVisible = true
  /**
   * 此刻停在网页全屏的标签页（按 webContents.id 记）。
   *
   * 记的是一个集合而不是一个布尔：同一时刻可能有好几个页面都在全屏
   * （用户切走了，先前那个还留在全屏态）。窗口那一侧只关心「有没有」，
   * 而退出全屏时要逐个退，因此这里必须记全。
   */
  private fullscreenTabs = new Set<number>()

  constructor(private readonly deps: TabManagerDeps) {}

  // ------------------------------------------------------------ 查询

  /** 标签条的内容。次序就是 `order` 的次序，自家那两屏不在其中 */
  list(): TabState[] {
    return this.order
      .map((id) => this.tabs.get(id))
      .filter((t): t is TabEntry => Boolean(t))
      .map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title || t.url,
        faviconUrl: t.faviconUrl,
        isLoading: t.isLoading,
        canGoBack: this.canGoBack(t),
        canGoForward: this.canGoForward(t),
        isActive: t.id === this.activeId,
        uaMode: t.uaMode,
        zoom: t.zoom,
        muted: t.muted
      }))
  }

  /**
   * 正在看着的那张**标签页**（网页或本机文件）的 id；停在起始页 / 设置上时为 null。
   *
   * 自家那两屏在内部也占着 `activeId`（谁在上面只有一份账），但它们不是标签，
   * 对外不该以 id 示人——界面拿着那个 id 只会想切它、关它。
   */
  getActiveId(): string | null {
    const entry = this.activeId ? this.tabs.get(this.activeId) : null
    return entry && isTab(entry.kind) ? entry.id : null
  }

  /** 正文区此刻停在哪一屏；看着标签页（网页或本机文件）时为 null */
  getScreen(): OwnScreen | null {
    const entry = this.activeId ? this.tabs.get(this.activeId) : null
    return entry && isScreen(entry.kind) ? entry.kind : null
  }

  /**
   * 这一份 webContents 是不是此刻画着的那一个。
   *
   * 阅读页拿它判「这一笔位置算不算数」（见 ipc/registerFileIpc.ts 的 bookReading）。
   * 同一本书开了两屏时，后台那一屏也会报位置——它换一次排版、被重新摆一次、
   * 自己那一次补位落定，都会发一串滚动事件，于是**它那一份位置会盖到用户正在读的
   * 那一屏头上**：用户在这一屏读到第 200 章，另一屏还停在开屏时的第 11 章，
   * 下一次打开就回到第 11 章——正是「记不住读到哪儿」这句话。
   *
   * 判的是**视图**而不是标签页 id：报告人手里只有自己的 webContents（见那条
   * IPC 的形状），而「谁在上面」这件事只有这一处记着。
   */
  isActiveView(sender: WebContents): boolean {
    const entry = this.activeId ? this.tabs.get(this.activeId) : null
    return entry ? entry.view.webContents === sender : false
  }

  /**
   * 一份对外快照。
   *
   * 广播（index.ts）与 `tabs:list` 这两个出口共用它，省得两处各拼一份、
   * 哪天加了一个字段只补了一边。
   */
  snapshot(): TabsStatePayload {
    return {
      tabs: this.list(),
      activeTabId: this.getActiveId(),
      screen: this.getScreen(),
      lastTabId: this.lastTabId
    }
  }

  /**
   * 供会话恢复使用的网址列表。
   *
   * 记的是 `entry.url`——本机 PDF 因此记的是那个 file: 地址，下次启动照样开得回来
   * （阅读页的 token 是进程内现发的，记它没有任何意义）。起始页与设置不是标签页，
   * 不参与恢复。
   */
  getOpenUrls(): string[] {
    const urls: string[] = []
    for (const id of this.order) {
      const entry = this.tabs.get(id)
      if (entry?.url) urls.push(entry.url)
    }
    return urls
  }

  private canGoBack(t: TabEntry): boolean {
    try {
      return t.view.webContents.navigationHistory.canGoBack()
    } catch {
      return false
    }
  }

  private canGoForward(t: TabEntry): boolean {
    try {
      return t.view.webContents.navigationHistory.canGoForward()
    } catch {
      return false
    }
  }

  // ------------------------------------------------------------ 生命周期

  create(input: { url?: string; activate?: boolean; kind?: TabKind } = {}): string {
    const win = this.deps.getWindow()
    if (!win) throw new Error('窗口尚未就绪')

    const cfg = this.deps.getConfig().browser
    /*
     * 「这个地址该开成哪一路」只有这一处判：本机 PDF / EPUB / TXT 各开成自家的
     * 阅读页，其余一律是普通网页。会话恢复（启动时把上次那些地址逐一 create）、
     * 选文件框、网页里点一个 file:// 的链接、地址栏里粘进来的路径——四条路都从
     * 这里过，谁也不必各自记着这条规矩（少一处判就少一处漏判）。
     */
    let kind: TabKind =
      input.kind ??
      (isLocalPdf(input.url)
        ? 'pdf'
        : isLocalEpub(input.url)
          ? 'book'
          : isLocalTxt(input.url)
            ? 'txt'
            : 'guest')
    const id = nextId()

    const view = new WebContentsView({
      webPreferences: {
        // 访客页面不注入任何 preload，是纯网页。
        // 一切注入都走主进程的 insertCSS / executeJavaScript。
        // 自家那两屏与两种本机阅读页（PDF / EPUB）带 preload，且 preload 内部还会再校验来源。
        preload: needsPreload(kind) ? this.deps.getPreloadPath() : undefined,
        session: this.deps.getSession(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        /*
         * 网页进全屏时不让 Chromium 自己去改窗口尺寸，改由我们接管
         * （见 WindowController.setPageFullscreen）。
         *
         * 不关掉的话两边会同时动手：Chromium 按自己的算法摆一次窗口，
         * 我们再按「铺满工作区」摆一次，肉眼上是一次跳。关掉之后页面照常收到
         * requestFullscreen（视频照样铺满），只有窗口那一侧的动作归我们。
         */
        disableHtmlFullscreenWindowResize: true
      }
    })
    // 必须设成全透明，否则会在透明窗口里画出一块白底（spike Q1/Q2）
    view.setBackgroundColor('#00000000')

    const own = isScreen(kind) ? OWN_PAGE[kind] : null
    /*
     * 访客标签没给地址就是「新建标签页」：打开配置里的那一格（默认 google.com）。
     * 原先这一种退到 about:blank——透明窗口里那是一块透出桌面的空档，没有意义。
     * 地址仍走 goto 那条路解析，因此 `douyin.com` 这种不带协议的写法照旧认。
     */
    const url = own ? own.url : (input.url ?? this.newTabUrl())

    /*
     * 本机 PDF：视图里加载的是自家阅读页，而**对外的地址仍是那个本机文件**
     * （见 TabEntry.viewUrl 那段注释）。唯一的例外是这条 file: 地址解析不出路径
     * ——Windows 上的网络路径就是这样——那时退回「当普通网页打开」，也就是这一版
     * 之前的行为：Chromium 内置阅读器照样读得起来，只是白底去不掉。
     */
    let viewUrl: string | undefined
    if (kind === 'pdf') {
      try {
        viewUrl = pdfReaderUrl(url)
      } catch (err) {
        log.warn(`打不开这本 PDF 的阅读页，退回内置阅读器：${url}`, err)
        kind = 'guest'
      }
    } else if (kind === 'book') {
      try {
        viewUrl = bookReaderUrl(url)
      } catch (err) {
        /*
         * 与 PDF 同一条退路：解析不出路径（Windows 上的网络路径）时退回「当普通
         * 网页打开」，比开出一张空白页强。区别在于 Chromium 读得懂 file: 的 PDF，
         * 读不懂 EPUB——这一退会变成一次下载。所以这不是「另一条能用的路」，而是
         * 「把选择权交回去」：用户至少看得见那个文件本身，而不是对着白屏猜。
         */
        log.warn(`打不开这本 EPUB 的阅读页，退回普通网页：${url}`, err)
        kind = 'guest'
      }
    } else if (kind === 'txt') {
      try {
        viewUrl = txtReaderUrl(url)
      } catch (err) {
        /*
         * 与上面两条同一条退路，代价最小的一种：Chromium 自己就有一个文本查看器，
         * 退回它照样读得起来（这就是 1.6.9 之前本机 TXT 的样子），丢掉的只是分章与
         * 位置——那总比一张空白页强。
         */
        log.warn(`打不开这一份 TXT 的阅读页，退回内置文本查看器：${url}`, err)
        kind = 'guest'
      }
    }

    const entry: TabEntry = {
      id,
      kind,
      view,
      url,
      viewUrl,
      // 本机文件在界面上只显示文件名（见 @shared/url.ts 的 fileNameOf）：
      // 标签条上那一格写的、地址栏上那一行写的，都是它
      title: own ? own.title : (fileNameOf(url) ?? ''),
      isLoading: false,
      uaMode: cfg.defaultUaMode,
      zoom: cfg.defaultZoom,
      muted: false
    }
    this.tabs.set(id, entry)
    /*
     * 进标签条的是网页与本机文件；自家那两屏在外面的身份是「屏」：
     * 各有各的入口、没有关闭键，因此不进 order；它们的 id 记在 ownIds 里，
     * 各自只建一个。
     */
    if (isScreen(kind)) this.ownIds.set(kind, id)
    else this.order.push(id)

    win.contentView.addChildView(view)
    this.layoutTab(entry)
    this.wireEvents(entry)
    // 新视图压在最上层，界面层若正需要待在上面就得重新抬一次（见 deps.onViewAdded）
    this.deps.onViewAdded()

    if (own) {
      view.webContents.loadURL(rendererUrl(own.page)).catch((err) => {
        log.error(`加载${own.title}失败`, err)
      })
    } else if (viewUrl) {
      view.webContents.loadURL(viewUrl).catch((err) => {
        log.error(`加载计算机上的阅读页失败：${url}`, err)
      })
    } else if (url && url !== 'about:blank') {
      // about:blank 是视图的初始状态，再 loadURL 一次会被 Chromium 判为
      // 中止的导航并抛出 ERR_ABORTED，没有意义
      this.goto(id, url)
    }

    if (input.activate !== false) this.activate(id)

    view.setVisible(this.bodyVisible)
    this.deps.onStateChange()
    return id
  }

  /**
   * 进起始页：顶栏左上角那颗键的落点。
   *
   * 它是常驻的一屏，不随导航消失——「回到起点」回到的就是它。
   */
  openHome(): void {
    this.openOwn('home')
  }

  /**
   * 进系统设置。
   *
   * 与起始页同一条路：窗口内的一屏，而不是一扇独立窗口。独立窗口会出现在
   * 任务栏与 Alt+Tab 里，等于把「我在摸鱼」写在脸上——那正是它原来的样子。
   */
  openSettings(): void {
    this.openOwn('settings')
  }

  /**
   * 从这两屏原路返回：回到进来之前那张网页。
   *
   * 那张网页要么已经不在了、要么从来就没有（刚启动，或者用户把它们全关了），
   * 这时落回起始页——正文区不能空着（透明窗口里空着就是一块透出桌面的空档）。
   *
   * 只在自家某一屏上时才动：看着网页时调它什么也不该发生，否则会莫名其妙
   * 切到「上一次那张网页」上去。
   */
  leaveScreen(): void {
    if (!this.getScreen()) return
    const back = this.lastTabId ? this.tabs.get(this.lastTabId) : null
    if (back && isTab(back.kind)) this.activate(back.id)
    else this.openHome()
  }

  private openOwn(kind: OwnScreen): void {
    const existing = this.ownIds.get(kind)
    if (existing && this.tabs.has(existing)) {
      this.activate(existing)
      return
    }
    this.create({ kind, activate: true })
  }

  /**
   * 「新建标签页」要打开的地址。
   *
   * 用户把设置里那一格写成空的时候回落到默认值——兜底只在这一处，
   * 设置页与界面都不必各自再判一次空。
   */
  private newTabUrl(): string {
    return this.deps.getConfig().browser.newTabUrl.trim() || DEFAULT_NEW_TAB_URL
  }

  /**
   * 关掉一张标签页（网页或本机文件）。
   *
   * 自家那两屏关不掉：界面上没有它们的关闭键，也就无从发出它们的 id；
   * 退出时由 destroyAll 直接拆。这条守卫是防着哪天多出一条路来。
   */
  close(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    if (isScreen(entry.kind)) return

    this.dispose(entry)
    if (this.lastTabId === tabId) this.lastTabId = null

    if (this.activeId === tabId) {
      this.activeId = null
      const next = this.order[this.order.length - 1]
      /*
       * 关掉的是正在看着的那一张：还有网页就切到最后一张（既有规矩，不动），
       * 一张都不剩就落回起始页——正文区不能空着，透明窗口里空着就是一块
       * 透出桌面的空档。
       */
      if (next) this.activate(next)
      else this.openHome()
    }

    this.deps.onStateChange()
  }

  /** 拆掉一个视图：从窗口上摘下来、关掉它的 webContents、退掉全屏记账 */
  private dispose(entry: TabEntry): void {
    // 视图下面就要被关掉了，全屏记账要用的 id 得先拿到手
    const wcId = this.webContentsId(entry)
    const win = this.deps.getWindow()
    try {
      win?.contentView.removeChildView(entry.view)
    } catch {
      // 窗口可能已在销毁中
    }
    // 关闭视图不会关闭其 webContents，必须显式关闭，
    // 否则渲染进程会残留（这是必然泄漏，不是偶发）。
    try {
      entry.view.webContents.close()
    } catch (err) {
      log.warn('关闭标签页 webContents 失败', err)
    }

    this.tabs.delete(entry.id)
    if (isScreen(entry.kind)) this.ownIds.delete(entry.kind)
    else this.order = this.order.filter((id) => id !== entry.id)

    /*
     * 关掉一个正在全屏的标签页，与用户自己按退出全屏是一回事：
     * 场上已经没有全屏的页面了，窗口不该继续铺满工作区。
     * 交给同一个入口，判据（跃变）与所有权（autoMaximized）都只有那一条。
     */
    if (wcId !== null) this.setPageFullscreen(wcId, false)
  }

  activate(tabId: string): void {
    const entry = this.tabs.get(tabId)
    if (!entry) return
    this.activeId = tabId
    // 记下「刚才看着的是哪张标签页」，起始页 / 设置上的「原路返回」回的就是它
    if (isTab(entry.kind)) this.lastTabId = tabId

    for (const [id, t] of this.tabs) {
      const visible = id === tabId && this.bodyVisible
      try {
        t.view.setVisible(visible)
      } catch (err) {
        log.warn('切换标签页可见性失败', err)
      }
    }
    /*
     * 谁在上面变了，「谁该出声」也就跟着变了：切走的那一张暂停、切进来的那张接着放。
     *
     * 收在这一处就够，因为 activate 是切标签的**唯一入口**——界面点击、新建标签、
     * 关掉一张后落到下一张、起始页 / 设置的「原路返回」、启动时会话恢复，五条路
     * 都从这儿过。它也顺带管住了「进起始页 / 设置」这件事：那两屏在内部同样占着
     * activeId（谁在上面只有一份账），于是切过去时刚才那张网页照样停下。
     */
    this.applyMediaState()
    this.layoutTab(entry)
    this.deps.onStateChange()
  }

  reorder(tabId: string, toIndex: number): void {
    const from = this.order.indexOf(tabId)
    if (from < 0) return
    const clamped = Math.max(0, Math.min(this.order.length - 1, toIndex))
    this.order.splice(from, 1)
    this.order.splice(clamped, 0, tabId)
    this.deps.onStateChange()
  }

  // ------------------------------------------------------------ 主体显隐

  /**
   * 主体隐藏时把所有标签页视图设为不绘制，并按「谁该出声」重算一遍媒体状态。
   *
   * 仅仅是「不绘制」远远不够：网页那一侧照常活着，视频会继续往下播，
   * 用户回来时进度已经跑掉了。判据在 applyMediaState 一处，这里只负责翻
   * `bodyVisible` 这个前提——它一翻，那条判据的结果就全变了（隐藏时全部停，
   * 露出来时只有正在看的那一张继续）。
   *
   * 从前那个 `muteMedia: boolean` 参数（调用方把 `stealth.muteMediaOnCollapse`
   * 传进来）撤掉了：窗口这一侧只知道「露没露出来」，凭什么替标签页决定后台
   * 那张该不该出声。两条规矩的开关都改在 applyMediaState 里现读。
   */
  setBodyVisible(visible: boolean): void {
    this.bodyVisible = visible
    for (const [id, t] of this.tabs) {
      try {
        t.view.setVisible(visible && id === this.activeId)
      } catch (err) {
        log.warn('同步主体显隐失败', err)
      }
    }
    this.applyMediaState()
  }

  /**
   * 「谁该出声」只有这一处算得出来。
   *
   * 两条独立的规矩合成一句话，取或——任一条要求它停，它就停：
   *
   * - **窗口没露出来**（收起成球 / 藏进托盘 / 最小化），且 `muteMediaOnCollapse`
   *   开着：全部停，并且闭麦。
   * - **窗口露着**，且 `pauseMediaOnSwitch` 开着：只有正在看的那一张出声，
   *   切走的那张停——不闭麦。
   *
   * 从前只有前一条，而且写成「隐藏就全停、露出来就全恢复」。多出第二条之后那种
   * 写法就漏了：窗口一展开会把后台那张也一起放起来，两个声音同时出来。所以判据
   * 必须收在一处，两个入口（activate 与 setBodyVisible）都调它，不各自算一遍。
   *
   * 重复把同一个值设下去是幂等的，因此这里不另存一份影子状态去判「变没变」——
   * 那才是两处不同步的来源。
   */
  private applyMediaState(): void {
    const stealth = this.deps.getConfig().stealth
    const hidden = !this.bodyVisible
    for (const [id, t] of this.tabs) {
      const wc = t.view.webContents
      if (wc.isDestroyed()) continue
      // 闭麦只跟「窗口收起来了」走；切走那一张只暂停，见 pauseMediaOnSwitch
      if (stealth.muteMediaOnCollapse) {
        try {
          wc.setAudioMuted(hidden)
        } catch {
          // 页面可能已销毁
        }
      }
      const stop =
        (stealth.muteMediaOnCollapse && hidden) ||
        (stealth.pauseMediaOnSwitch && id !== this.activeId)
      this.setMediaPaused(wc, stop)
    }
  }

  /**
   * 设置里刚改了那两条规矩：当场重算一遍，不必等下一次切标签。
   *
   * 与 refreshReaderOpacity 同一条道理——用户盯着开关按下去，指望的就是它立刻
   * 生效：关掉「切走时暂停」之后，刚才被我们暂停的那些应当马上放起来；打开它，
   * 此刻在后台的那些应当马上停下。等下一次切换才生效等于这条开关是坏的。
   *
   * 调用点挂在 index.ts 的配置订阅上（写配置的路不止一条，挂 store 才不漏）。
   */
  refreshMediaState(): void {
    this.applyMediaState()
  }

  /**
   * 让一页里所有框架一起暂停 / 恢复媒体。
   *
   * 逐帧跑，而不是只跑主框架：视频常常住在 iframe 里（各家网站的嵌入播放器都是），
   * 而跨源 iframe 的文档从顶层脚本够不着——主进程从 `framesInSubtree` 走没有这个限制。
   * 一次页面动作发一帧，互不等待；单帧失败（正在销毁、已拆掉）不该拖住其余的。
   */
  private setMediaPaused(wc: WebContents, paused: boolean): void {
    if (wc.isDestroyed()) return
    const script = paused ? PAUSE_PLAYING_MEDIA : RESUME_PAUSED_MEDIA
    let frames: WebFrameMain[]
    try {
      frames = wc.mainFrame.framesInSubtree
    } catch {
      return
    }
    for (const frame of frames) {
      try {
        const done = frame.executeJavaScript(script)
        if (done && typeof done.catch === 'function') done.catch(() => {})
      } catch {
        // 框架可能正在销毁
      }
    }
  }

  // ------------------------------------------------------------ 广播

  /**
   * 把广播发给自家页面（首页、系统设置，以及本机 PDF 的阅读页）。
   *
   * 只按 kind 挑选（needsPreload），而不是撒给全部 webContents：访客页面没有
   * preload，收不到也没人听，而自家页面需要跟着配置变化重绘——起始页换主题
   * 正是一条配置变更，阅读页的墨色也跟着主题走，同一条广播。
   */
  broadcastToOwnPages(channel: string, payload: unknown): void {
    for (const entry of this.tabs.values()) {
      if (!needsPreload(entry.kind)) continue
      try {
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.send(channel, payload)
      } catch {
        // 页面可能正在销毁
      }
    }
  }

  // ------------------------------------------------------------ 导航

  /**
   * 在某个视图里打开一个地址。
   *
   * `tabId` 为 null 指的是「正文区此刻不在任何一张网页上」——停在起始页或
   * 系统设置上时就是这样。两条路都另开一张网页标签并切过去：
   *
   * - 没有当前视图；
   * - 当前视图是自家那两屏、或者一本本机 PDF 的阅读页。它们不承载访客内容
   *   ——前两者带着 preload，后者画的是自家的页，网页进去就等于把主进程能力
   *   交给任意网页（阅读页连地址都不该变）。原来那一屏始终留在原处。
   *
   * 于是停在起始页上时，地址栏回车、点书签、点历史都是「新开一张网页」。
   * 解析仍走 resolveInput，`douyin.com` 那种写法照旧认。
   */
  goto(tabId: string | null, input: string): void {
    const entry = tabId ? this.tabs.get(tabId) : undefined

    if (!entry || entry.kind !== 'guest') {
      this.create({ url: input, activate: true })
      return
    }

    const url = resolveInput(input, this.deps.getConfig().browser.searchTemplate)
    entry.view.webContents.loadURL(url).catch((err) => {
      log.warn(`加载失败 ${url}`, err)
    })
  }

  back(tabId: string): void {
    const wc = this.tabs.get(tabId)?.view.webContents
    try {
      if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    } catch {
      // 忽略
    }
  }

  forward(tabId: string): void {
    const wc = this.tabs.get(tabId)?.view.webContents
    try {
      if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    } catch {
      // 忽略
    }
  }

  reload(tabId: string): void {
    try {
      this.tabs.get(tabId)?.view.webContents.reload()
    } catch {
      // 忽略
    }
  }

  stop(tabId: string): void {
    try {
      this.tabs.get(tabId)?.view.webContents.stop()
    } catch {
      // 忽略
    }
  }

  setZoom(tabId: string, op: 'in' | 'out' | 'reset' | 'set', value?: number): number {
    const entry = this.tabs.get(tabId)
    if (!entry) return 1
    const wc = entry.view.webContents
    let levels: number
    try {
      levels = wc.zoomLevel
    } catch {
      return entry.zoom
    }

    if (op === 'reset') levels = 0
    else if (op === 'in') levels = Math.min(5, levels + 0.5)
    else if (op === 'out') levels = Math.max(-4, levels - 0.5)
    else if (typeof value === 'number') {
      levels = Math.log(value) / Math.log(1.2)
    }

    try {
      wc.zoomLevel = levels
      entry.zoom = 1.2 ** levels
    } catch (err) {
      log.warn('设置缩放失败', err)
    }
    this.deps.onStateChange()
    return entry.zoom
  }

  setUa(tabId: string, mode: UaMode): string {
    const entry = this.tabs.get(tabId)
    if (!entry) return ''
    entry.uaMode = mode
    const ua = uaFor(mode)
    try {
      entry.view.webContents.setUserAgent(ua)
      // 改 UA 需要重新加载才生效
      entry.view.webContents.reload()
    } catch (err) {
      log.warn('设置 UA 失败', err)
    }
    this.deps.onStateChange()
    return ua
  }

  // ------------------------------------------------------------ 版面

  /** 主体区域变化时重新摆放所有标签页视图 */
  layoutAll(): void {
    for (const entry of this.tabs.values()) this.layoutTab(entry)
  }

  private layoutTab(entry: TabEntry): void {
    const r = this.deps.getBodyRect()
    try {
      entry.view.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    } catch (err) {
      log.warn('摆放标签页视图失败', err)
    }
  }

  // ------------------------------------------------------------ 网页全屏

  /**
   * 标签页的 webContents id。视图可能已在销毁中，取不到就当没有——
   * 要它的是全屏记账，而取不到 id 的那个标签页本来也快没了。
   */
  private webContentsId(entry: TabEntry): number | null {
    try {
      return entry.view.webContents.id
    } catch {
      return null
    }
  }

  /**
   * 记下这一刻哪个页面在全屏，并**只在跃变时**通知窗口那一侧。
   *
   * 跃变 = 集合从空变非空、或从非空变空。后台标签页进出全屏不该掀动窗口
   * （用户切走了，那个页面还留在全屏态），而「最后一个全屏的页面退出了」
   * 与「第一个页面进了全屏」正是窗口该动的两个时刻。
   */
  private setPageFullscreen(wcId: number, on: boolean): void {
    const had = this.fullscreenTabs.size > 0
    if (on) this.fullscreenTabs.add(wcId)
    else this.fullscreenTabs.delete(wcId)
    const has = this.fullscreenTabs.size > 0
    if (had === has) return
    this.deps.onPageFullscreen(has)
  }

  /**
   * 让所有停在网页全屏的标签页退出来。
   *
   * 窗口那一侧不再铺满工作区时（还原、收起成球）由它调用，见
   * WindowController.deps.onLeavePageFullscreen。
   *
   * `document.exitFullscreen()` 不要求用户手势（要手势的是 requestFullscreen），
   * 因此这里可以直接调。退出是异步的：它随后走到 leave-html-full-screen，
   * 而那条路是幂等的——集合里已经没有它了，不会再报一次跃变。
   *
   * 遍历的是标签页表而不是那个集合：退出带来的记账发生在事件到达时（异步），
   * 这一次同步遍历不会被它改到。
   */
  exitPageFullscreen(): void {
    for (const entry of this.tabs.values()) {
      const wcId = this.webContentsId(entry)
      if (wcId === null || !this.fullscreenTabs.has(wcId)) continue
      entry.view.webContents.executeJavaScript('document.exitFullscreen?.()').catch(() => {
        // 页面已经不在了、或者没允许脚本：那它也就没有全屏可退，忽略
      })
    }
  }

  // ------------------------------------------------------------ 事件

  /**
   * 给标签页注入网页样式。
   *
   * **自家页面必须跳过。** 注入的「背景透明」是 user origin 的 !important，
   * 在层叠顺序里压过作者样式表（含作者的 !important），而起始页与系统设置的
   * 底色正是写在 `html, body` 上的——于是自家页面的底板被一起抹掉，
   * 透明窗口里就露出桌面：打开系统设置时背景全透明就是这么来的。
   * 实测见 `spike/ownpage-bg.js`（注入前后各读一次 getComputedStyle）。
   *
   * 隐藏滚动条同理：自家页面 `overflow: hidden`，本来就不滚。
   */
  private applyPageStyles(entry: TabEntry): void {
    if (entry.kind !== 'guest') return
    const cfg = this.deps.getConfig()
    void injectPageStyles(entry.view.webContents, {
      hideScrollbars: cfg.browser.hideScrollbars
    })
    /*
     * 离线阅读的透明度走另一张样式表，**只有本机文件吃**。
     *
     * 判据必须在这里：pageStyler 不知道这一页是什么，而「网页永远不许淡」
     * 是这一条的硬边界（见 PRODUCT.md）。本机 PDF 与 EPUB 都是自家阅读页
     * （kind 是 'pdf' / 'book'，上面那一步就返回了），它们那一条由页面自己落下
     * 去——淡的都是那张纸，不是字（见 pdf/PdfApp.vue 与 book/BookApp.vue）。
     * 同一个配置项、几条实现，因为那两页是我们画的、这一页是 Chromium 画的。
     *
     * 排版三项与它同一道闸：也是「只有本机文件吃」，也是只对 kind === 'guest'
     * 这一种。本机 EPUB 那一页的字号由页面自己从同一份配置里读
     * （book/BookApp.vue 的 applyTypeset），本机 PDF 那一页没有字号可调
     * （字是画进画布的，要放大得改缩放）。
     *
     * 不是本机文件就**整个不碰**（早先写的是「透明度按 1 注入一遍」）。改掉它
     * 是顺带修了一处错处：`applyReaderOpacity(wc, 1)` 走的是「删掉 documentElement
     * 上那条行内 opacity」，而网页自己也可能往那儿写过东西——那一下会把它抹掉。
     * 网页本来一条都不该收到我们的样式，所以这里干脆不发。
     */
    if (!isLocalFile(entry.url)) return
    void applyReaderOpacity(entry.view.webContents, cfg.ui.readerOpacity)
    void applyReaderTypeset(entry.view.webContents, {
      fontSize: cfg.ui.readerFontSize,
      lineHeight: cfg.ui.readerLineHeight,
      margin: cfg.ui.readerMargin
    })
  }

  /**
   * 离线阅读那几项改了：把开着的本机文件**当场**重注入一遍。
   *
   * 不能等下一次导航。那几条都是会被拖着走的滑块，用户盯着眼前这本 TXT 拖，
   * 指望的就是它跟着淡、跟着变大；等下一次 reload 才生效等于它们是坏的。
   * 调用点挂在 index.ts 的配置订阅上（写配置的路不止一条，挂 store 才不漏）。
   *
   * 不判「值变了没有」：写配置的路很多，而其中大多数与这几项无关，
   * 每一次都对开着的本机文件重注入一遍，代价是一次 IPC 往返乘以本机文件的
   * 张数（一般就是一两张）；反过来判「变没变」要在这儿再存一份影子状态，
   * 两处不同步时就是一条静默失效的滑块。
   *
   * 透明度与排版三项各是一条滑块、各改一处样式，但它们的对象、时机、判据
   * 完全一样（都是「正在读的这一份本机文件」），因此合成一次刷新——分开两处
   * 写等于把同一条判据抄两遍，那两条迟早会漏掉其中一条路。
   */
  refreshReaderView(): void {
    const ui = this.deps.getConfig().ui
    for (const entry of this.tabs.values()) {
      if (entry.kind !== 'guest' || !isLocalFile(entry.url)) continue
      void applyReaderOpacity(entry.view.webContents, ui.readerOpacity)
      void applyReaderTypeset(entry.view.webContents, {
        fontSize: ui.readerFontSize,
        lineHeight: ui.readerLineHeight,
        margin: ui.readerMargin
      })
    }
  }

  private wireEvents(entry: TabEntry): void {
    const wc = entry.view.webContents

    const refresh = (): void => this.deps.onStateChange()

    wc.on('did-start-loading', () => {
      entry.isLoading = true
      refresh()
    })
    wc.on('did-stop-loading', () => {
      entry.isLoading = false
      refresh()
    })
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      log.warn(`页面加载失败 [${errorCode} ${errorDescription}] ${validatedURL}`)
    })

    wc.on('did-navigate', (_e, url) => {
      /*
       * 对外的地址（entry.url）按 kind 分开处理：
       *
       * - 网页：就是它自己；
       * - 自家那两屏：始终以自己的伪地址示人。不这样处理，did-navigate 会把真实
       *   文件路径写进 entry.url，地址栏就会显示出本机的目录结构；
       * - 本机 PDF：**一个字都不动**。它写的是那个本机文件，而视图里这次导航去的是
       *   自家阅读页（`…/pdf.html?doc=<token>`）——那串 token 是这次进程里现发的，
       *   写进历史、写进会话恢复、写进地址栏都毫无意义，还会把内部结构摊到界面上。
       */
      if (entry.kind === 'guest') entry.url = url
      else if (isScreen(entry.kind)) entry.url = OWN_PAGE[entry.kind].url
      // 页面文档已重建，样式必须重新注入
      this.applyPageStyles(entry)
      // UA 会随导航重置，需按本标签页的模式重新应用。
      // 桌面模式用的是空字符串（表示「用 Electron 默认值」），
      // 把空串交给 setUserAgent 会清掉 UA，因此只在手机模式下设置。
      const ua = uaFor(entry.uaMode)
      if (ua) {
        try {
          wc.setUserAgent(ua)
        } catch {
          // 忽略
        }
      }
      /*
       * 自家那两屏不进历史，否则「继续上次阅读」会指回起始页自身。
       * 本机文件（网页方式打开的 TXT、自家阅读页里的 PDF）要进：起始页那一栏
       * 「离线阅读」里排的就是浏览历史里的本机文件（按倒序），
       * 而记进去的是**对外的那个 file: 地址**，不是阅读页的地址。
       */
      if (isTab(entry.kind)) {
        this.deps.onNavigated({
          url: entry.url,
          title: entry.title,
          faviconUrl: entry.faviconUrl
        })
      }
      refresh()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      // 页内跳转只有网页有（#锚点、pushState 那一类）；自家页面与本机 PDF 的
      // 阅读页不会走到这儿，真走到了也不该拿它去改那个对外的地址
      if (entry.kind !== 'guest') return
      entry.url = url
      this.deps.onNavigated({ url, title: entry.title, faviconUrl: entry.faviconUrl })
      refresh()
    })
    wc.on('page-title-updated', (_e, title) => {
      /*
       * 只有网页的标题由页面自己给。自家那两屏的标题是常量、本机 PDF 的标题
       * 是那个文件名（创建时就写好了，见 create），让页面盖掉它就等于允许
       * 「标签条上那一格写着什么」由页面决定——阅读页的文档标题是它自己的事，
       * 不该跑到标签条上去。
       */
      if (entry.kind !== 'guest') return
      entry.title = title
      refresh()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      entry.faviconUrl = favicons[0]
      refresh()
    })
    wc.on('did-finish-load', () => {
      this.applyPageStyles(entry)
      refresh()
    })

    /*
     * 网页自己的全屏。视频播放器右下角那枚键走的就是这条路，
     * 用户要的是「点它，软件窗口也跟着最大化」（见 setPageFullscreen）。
     *
     * 这两个事件此前没有任何监听者——网页进全屏之后，窗口原样不动，
     * 于是视频只铺满了正文那一块，而窗口还留着顶栏与右栏。
     */
    wc.on('enter-html-full-screen', () => this.setPageFullscreen(wc.id, true))
    wc.on('leave-html-full-screen', () => this.setPageFullscreen(wc.id, false))

    // target=_blank 必须变成标签页，否则会冒出一个不受管理的野生窗口
    wc.setWindowOpenHandler(({ url }) => {
      if (this.deps.getConfig().browser.newWindowAsTab) {
        this.create({ url, activate: true })
      }
      return { action: 'deny' }
    })
  }

  /**
   * 窗口销毁时释放全部视图。
   *
   * 遍历的是视图总表而不是标签条那一份次序：自家那两屏不在 order 里，
   * 照着 order 关就会漏掉它们——漏掉视图不拆、webContents 不关，
   * 那是两个渲染进程。
   */
  destroyAll(): void {
    for (const entry of [...this.tabs.values()]) this.dispose(entry)
    this.ownIds.clear()
    this.order = []
    this.activeId = null
    this.lastTabId = null
  }
}
