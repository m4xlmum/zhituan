/**
 * 摸鱼窗口的编排者：拥有窗口、视图树与状态机。
 *
 * 隐藏策略只有两条路：
 *   - 展开：完整界面，顶栏 + 地址栏 + 正文 + 右侧功能栏
 *   - 收起：整个窗口缩小成一颗悬浮球
 *
 * 「收起」是真的把窗口缩到一颗球的尺寸，而不是把内容藏起来留一块空壳。
 * 这样屏幕上不会存在「看不见却仍占着一大块」的区域，
 * 原先那套靠裁剪命中区域实现的点击穿透因此不再需要。
 *
 * 展开态之上还有一个临时的形态：**最大化**（铺满当前显示器的工作区，不保 16:9）。
 * 它不是一次原生窗口操作（透明窗口不能最大化），而是我们自己摆的一块矩形，
 * 见 maximize()。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { BaseWindow, WebContentsView, screen } from 'electron'
import {
  ADDRESS_H,
  BALL_MARGIN,
  BALL_SIZE,
  DRAG_TICK_MS,
  MOVE_SETTLE_MS,
  NOTICE_H,
  RAIL_W,
  SIZE_PRESETS,
  TOP_BAR_H,
  type SizePreset
} from '@shared/constants'
import type { ChromePatch } from '@shared/ipc'
import type { AppConfig, Rect, ResizeEdge, WindowMode, WindowRuntime } from '@shared/types'
import type { ConfigStore } from './configStore'
import { EdgeWatcher } from './edgeWatcher'
import {
  computeLayout,
  floatBox,
  resizeRect,
  sameRect,
  type Layout,
  type ResizeLimits
} from './geometry'
import { log } from './logger'
import { WindowLeaveWatcher } from './windowLeaveWatcher'
import { WindowSurface } from './windowSurface'

/** 合法状态迁移表。未列出的迁移会被拒绝并记录，避免状态机被悄悄改坏。 */
const LEGAL_TRANSITIONS: Record<WindowMode, WindowMode[]> = {
  expanded: ['collapsed', 'trayHidden', 'minimized', 'quitting'],
  collapsed: ['expanded', 'trayHidden', 'minimized', 'quitting'],
  minimized: ['expanded', 'collapsed', 'trayHidden', 'quitting'],
  trayHidden: ['expanded', 'collapsed', 'minimized', 'quitting'],
  quitting: []
}

export interface ControllerDeps {
  config: ConfigStore
  registry: import('./windowRegistry').WindowRegistry
  preloadPath: string
  rendererUrl: string
  /** 回到展开态、或离开展开态时通知外部（用于同步标签页视图的显隐、媒体的暂停与静音） */
  onVisibilityChange: (visible: boolean) => void
  /**
   * 正文区矩形变化时通知外部，由外部重新摆放标签页视图。
   *
   * 标签页是原生视图，不跟着 CSS 走，版面一变就必须显式重摆；
   * 漏掉的话网页会停在旧位置上（换尺寸预设时表现为网页没跟着长）。
   */
  onLayoutChange: () => void
  onStateChange: () => void
  /**
   * 让停在网页全屏的标签页退出来。
   *
   * 窗口不再铺满工作区时（还原、收起成球），网页里那份全屏也留不住：
   * 一个「网页以为自己在全屏」的窗口，表现是视频在还原后的窗口里继续铺满
   * 整块正文区，用户按退出全屏又会被我们再缩一次窗口——来回打架。
   * 因此这两处都由我们自己先退出网页全屏，走回正常路径。
   *
   * 「哪些标签页在全屏」只有标签页那一侧知道，因此这里同样是交给它代劳。
   */
  onLeavePageFullscreen: () => void
}

export class WindowController {
  private win: BaseWindow | null = null
  private chrome: WebContentsView | null = null
  private surface: WindowSurface | null = null
  private watcher: WindowLeaveWatcher | null = null
  private edgeWatcher: EdgeWatcher | null = null

  private mode: WindowMode = 'expanded'
  /**
   * 展开态的窗口矩形。
   *
   * 绝不从 win.getBounds() 反推：切换状态的过程中窗口还停在旧尺寸上，
   * 反推会把「记住的展开尺寸」覆盖成球的尺寸，展开就再也长不回去了。
   * 这个值只由真实的尺寸变化维护（create / resize / move / collapse 前）。
   */
  private expandedBounds: Rect | null = null
  /**
   * 地址栏是否展开。
   *
   * 由主进程持有而不是渲染进程自己记：地址栏一展开，正文就要往下让一行，
   * 而正文是原生视图。让渲染进程先改再通知主进程，两者在时序上必然错开，
   * 网页就会有一瞬间压在地址栏上。
   */
  private addressOpen = false
  /**
   * 更新提示条是否占版面。
   *
   * 与 addressOpen 同一种东西：它要吃掉 30px，而正文是原生视图，只能由主进程
   * 重排。拨动它的是更新服务（找到新版本、被忽略、被撤销忽略），因此这里是
   * 一个被动字段，没有对应的界面意图。
   */
  private noticeVisible = false
  /**
   * 悬浮球此刻在窗口内的矩形，由渲染进程量好后上报。
   *
   * 球是 DOM 元素（排在顶栏里，或顶栏隐藏时浮在右上角），它的位置由 CSS
   * 决定；主进程若自己再算一遍「球该在哪」，等于把版面规则抄成两份。
   * 收起时窗口要缩到球身上，用的就是这个矩形。
   */
  private ballRect: Rect | null = null
  /**
   * 收起态窗口能缩到的边长下限（DIP）。
   *
   * 收起时窗口要缩到球身上，但平台不一定答应：Windows 上实测有约 32×39 的下限
   * （见 spike/minsize.js），请求 28×28 会得到 32×39。窗口一旦比球大，而球是
   * 铺满窗口画的，圆就被拉成椭圆——这就是「球形扭曲」。
   *
   * 初始值取球的直径，也就是正常情况下真正用到的那个值。真被平台卡住时
   * applyCollapsedBounds() 会把它抬到实测尺寸，之后一步到位。
   */
  private ballFloor = BALL_SIZE

  /**
   * 是否已最大化（铺满当前显示器的整个工作区）。
   *
   * 「最大化」在这个程序里不是一次原生窗口操作（透明窗口不能最大化，
   * 见 create()），而是我们自己摆的一块矩形，因此它是一个普通字段，
   * 而不是去问窗口——窗口只会告诉我们「现在多大」，说不出「是不是最大化中」：
   * 在 16:9 的显示器上，一个恰好等于屏幕宽度的 16:9 窗口与最大化的样子分不清。
   */
  private maximized = false
  /**
   * 最大化之前那块 16:9 矩形，还原时回到它。
   *
   * 与 expandedBounds 分开记：最大化期间 expandedBounds 记的是**眼前**这块
   * 铺满工作区的矩形（它要与窗口的实际尺寸一致，收起、拖动都要读它），
   * 而「回到哪里去」是另一件事，只有还原时才用得上。
   */
  private restoreBounds: Rect | null = null
  /**
   * 眼前这次最大化是不是「被网页全屏带进来的」。
   *
   * 决定退出网页全屏时要不要把窗口还原回去：用户自己按的最大化，看视频时
   * 进了全屏又退出，不该把他手动选的大窗口缩回 16:9。只有我们替他最大化的
   * 那一次才由我们替他还原。
   */
  private autoMaximized = false
  /**
   * 界面层此刻是否压在网页之上（见 syncChromeOrder）。
   *
   * 这是「我们上一次做了什么」，不是「问窗口谁在上面」——views 的叠放次序
   * 读不回来，只能自己记着。新建标签页会把视图加到最上面，那时这个记号会
   * 与事实不符，因此 TabManager 每次新建视图都会叫我们再对齐一次
   * （deps.onViewAdded → syncChromeOrder(true)）。
   */
  private chromeOnTop = false
  /** 光标此刻是否贴在窗口边框上（见 EdgeWatcher 与 setEdgeHot） */
  private edgeHot = false

  private layout: Layout = computeLayout(960, 540, TOP_BAR_H, 0, 0, RAIL_W)

  /**
   * 拖动中的锚点：按下那一刻的光标位置与窗口位置，外加「上一次请求到的位置」。
   *
   * lastX / lastY 记的是**我们自己请求过的**位置，不是从窗口读回来的。
   * 读回要过一次窗口管理器——实测单次 setPosition 就要 2.5ms 中位数、p90 6ms
   * （spike/dragTicks.js），而这一个系统时钟滴答里还要留出余量给真正的移动，
   * 每帧再多一次同步往返就是在拿流畅度换一个我们并不需要的信息。
   *
   * 位置一律按锚点**绝对**算，不做增量累加：平台若卡住过某一次
   * （窗口被顶到屏幕边缘之类），绝对算法下一帧就把误差抹掉了，增量累加会越拖越偏。
   */
  private dragAnchor: {
    cursorX: number
    cursorY: number
    winX: number
    winY: number
    lastX: number
    lastY: number
  } | null = null
  private dragTimer: NodeJS.Timeout | null = null
  /**
   * 缩放中的锚点：拖的是哪条边、按下那一刻的光标与窗口矩形、上下限。
   *
   * 与 dragAnchor 同一套道理（绝对算、不做增量累加、last 记的是我们自己请求过的
   * 矩形而不是读回来的），因此这里只留一份注释：那几条理由见 dragAnchor。
   * limits 在按下时算一次就够——拖动过程中窗口可能跨到另一块显示器上，
   * 但半路换上下限会让窗口突然跳一下，不如等下一次按下再算。
   */
  private resizeAnchor: {
    edge: ResizeEdge
    cursorX: number
    cursorY: number
    start: Rect
    last: Rect
    limits: ResizeLimits
  } | null = null
  private resizeTimer: NodeJS.Timeout | null = null
  /** 窗口移动停止的判定计时器，见 scheduleMoveSettle() */
  private moveSettleTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: ControllerDeps) {}

  // ------------------------------------------------------------ 生命周期

  create(): void {
    const cfg = this.deps.config.get()
    const w = cfg.window
    const origin = resolveInitialOrigin(w)
    const bounds: Rect = { x: origin.x, y: origin.y, width: w.width, height: w.height }

    const win = new BaseWindow({
      ...bounds,
      frame: false,
      transparent: true,
      show: false,
      alwaysOnTop: w.alwaysOnTop,
      // 透明窗口不能最大化；且 resizable:true 会让透明在某些 Windows 版本上失效。
      // 尺寸改由预设与自绘手柄承担（spike Q5 确认 resizable:false 下
      // 程序化 setBounds 仍然生效）——收起成球正是靠它。
      resizable: false,
      maximizable: false,
      minimizable: true,
      skipTaskbar: !w.showInTaskbar,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: '纸团'
    })
    this.win = win
    this.expandedBounds = bounds
    // id 必须在这里记下来：'closed' 事件是在窗口已经销毁之后才触发的，
    // 那时再读 win.id 会抛「Object has been destroyed」（实测见 spike/destroyed.js）。
    // 这个异常从 app.quit() 的关窗路径一路冒到主进程的未捕获异常处理器上，
    // 表现就是退出时弹出的那个错误框。
    const winId = win.id

    const chrome = new WebContentsView({
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // 必须显式设成全透明：WebContentsView 默认背景是不透明白色（spike Q1/Q2）。
    // 漏掉这一行，整个透明方案就不成立。
    chrome.setBackgroundColor('#00000000')
    win.contentView.addChildView(chrome)
    this.chrome = chrome

    this.surface = new WindowSurface(win, () => this.deps.config.get())

    this.watcher = new WindowLeaveWatcher({
      getWindowId: () => this.win?.id ?? null,
      getBounds: () => (this.mode === 'expanded' ? this.expandedBounds : null),
      getMode: () => this.mode,
      getConfig: () => this.deps.config.get(),
      registry: this.deps.registry,
      onCollapse: () => this.collapse()
    })

    this.edgeWatcher = new EdgeWatcher({
      /*
       * 只有展开、未最大化、且真的露在屏幕上时，窗口才有那四条可拖的边框
       * （收起态是一颗球、最大化时四边贴着屏幕、最小化与托盘里根本没有指针）。
       * 因此把这三种情况一并在这里滤掉，轮询器那一侧只管几何。
       *
       * 读的是 win.getBounds() 而不是 expandedBounds：这里问的是「窗口**此刻**
       * 在哪」，而要拿它跟屏幕上的光标比。记忆里的矩形在拖动的那几帧可能还差着
       * 一次赋值，差出来的几像素正好落在 8px 的判定带里，就会漏判。
       */
      getBounds: () =>
        this.mode === 'expanded' && !this.maximized && this.isOnScreen()
          ? (this.win?.getBounds() ?? null)
          : null,
      onHotChange: (hot) => this.setEdgeHot(hot)
    })

    this.deps.registry.add(win, { blocksAutoHide: false })

    win.on('resize', () => {
      if (this.mode === 'expanded') this.expandedBounds = win.getBounds()
      this.recomputeLayout()
    })
    win.on('move', () => {
      // 拖动窗口时每次 setPosition 都会触发本事件。这时绝不能 reassert()：
      // 它会重放整套窗口属性（置顶、焦点、任务栏、阴影、透明度），
      // 每帧来一遍就是持续闪烁。拖动只需移动位置，属性一个都不用碰。
      // 缩放时的道理相同——拖左边或上边同样每帧都在改位置，
      // 而落盘与重放由 endResize() 那一次收尾统一做。
      if (this.dragAnchor || this.resizeAnchor) return

      // 位置要立刻记住，但落盘与重放都得等窗口停下来，见 scheduleMoveSettle()。
      if (this.mode === 'expanded') this.expandedBounds = win.getBounds()
      this.scheduleMoveSettle()
    })
    win.on('blur', () => {
      // 松开鼠标那一下若没送到（界面卡了一下、指针被别的窗口截走），
      // 拖动会一直挂着：窗口从此黏在光标上，整个程序没法再用。
      // 失焦是这一类「卡住」最可靠的信号——那一刻用户已经在别处按下了。
      // 缩放挂住不会黏住光标，但窗口会一直跟着光标长，
      // 而且是同一类「松手信号丢了」，用同一个信号收掉。
      if (this.dragAnchor) this.endDrag()
      if (this.resizeAnchor) this.endResize()
    })
    win.on('restore', () => {
      if (this.mode === 'minimized') this.transitionTo('expanded')
      this.reassert()
    })
    win.on('closed', () => {
      this.deps.registry.remove(winId)
      // 窗口已经没了，剩下两样还在按时碰它的东西必须停下来：
      // 收起轮询每 50ms 读一次窗口 id，拖动定时器每个滴答挪一次窗口位置。
      // 它们各自的 try/catch 能让异常不冒出去，但会一路刷日志，
      // 而且是「对着一个不存在的窗口工作」——没有意义。
      this.watcher?.stop()
      this.edgeWatcher?.stop()
      if (this.dragTimer) {
        clearInterval(this.dragTimer)
        this.dragTimer = null
      }
      if (this.resizeTimer) {
        clearInterval(this.resizeTimer)
        this.resizeTimer = null
      }
      this.dragAnchor = null
      this.resizeAnchor = null
      this.win = null
    })

    this.loadChrome()

    // 必须显式撑开 chrome 视图。WebContentsView 默认是 0×0，
    // 不设置的话顶栏、地址栏、右侧栏与悬浮球全都不会绘制——
    // 而标签页是另一层视图，所以「网页能显示」会掩盖这个问题。
    this.recomputeLayout()
    this.watcher.start()
    this.edgeWatcher.start()
  }

  private loadChrome(): void {
    const chrome = this.chrome
    if (!chrome) return
    chrome.webContents.loadURL(this.deps.rendererUrl).catch((err) => {
      log.error('加载界面失败', err)
    })
    chrome.webContents.on('did-finish-load', () => this.applySurface())
  }

  // ------------------------------------------------------------ 版面

  getLayout(): Layout {
    return this.layout
  }

  getBodyRect(): Rect {
    return this.layout.body
  }

  getChromeView(): WebContentsView | null {
    return this.chrome
  }

  getWindow(): BaseWindow | null {
    return this.win
  }

  recomputeLayout(): void {
    const win = this.win
    if (!win) return
    const { width, height } = win.getBounds()
    // 收起态下不重算版面：那时的尺寸是球的尺寸，不是版面尺寸
    if (this.mode === 'collapsed') return

    const cfg = this.deps.config.get()
    const previous = this.layout
    /*
     * 最大化时两栏、地址栏与更新提示条一起让位：整个工作区都归网页，界面在
     * 窗口里只剩下右上角那一小块（chromeBounds）。它们都按同一个条件收起来——
     * 少收一个，正文就少一块、而那块位置又没有任何东西画在上面。
     */
    const chromeHidden = this.maximized
    this.layout = computeLayout(
      width,
      height,
      cfg.ui.topBarOpen && !chromeHidden ? TOP_BAR_H : 0,
      this.addressOpen && !chromeHidden ? ADDRESS_H : 0,
      this.noticeVisible && !chromeHidden ? NOTICE_H : 0,
      railVisible(cfg, chromeHidden) ? RAIL_W : 0
    )
    this.chrome?.setBounds(this.chromeBounds(width, height))
    this.applySurface()

    // 正文让位必须落到标签页视图上，那一层是原生视图，不跟着 CSS 走
    if (!sameRect(previous.body, this.layout.body)) this.deps.onLayoutChange()
  }

  // ------------------------------------------------------------ 状态

  getMode(): WindowMode {
    return this.mode
  }

  getRuntime(): WindowRuntime {
    const cfg = this.deps.config.get()
    return {
      mode: this.mode,
      opacity: cfg.window.opacity,
      addressOpen: this.addressOpen,
      noticeVisible: this.noticeVisible,
      topBarOpen: cfg.ui.topBarOpen,
      railVisible: railVisible(cfg, this.maximized),
      maximized: this.maximized
    }
  }

  /**
   * 展开或折叠地址栏。
   *
   * 状态只在这里改，改完立刻重排版面并广播——渲染进程按广播的结果绘制，
   * 于是地址栏出现与正文让位是同一时刻发生的，不会露出网页压在地址栏上的一帧。
   */
  setAddressOpen(open: boolean): void {
    if (this.addressOpen === open) return
    this.addressOpen = open
    this.recomputeLayout()
    this.deps.onStateChange()
  }

  /**
   * 更新提示条是否占版面。
   *
   * 与地址栏逐字同构，只是拨它的不是用户而是更新服务（见 updateService 的
   * setState：有一个已知的新版本、且没被忽略时才为真）。因此这里没有对应的
   * SEND 通道——界面只按广播的结果绘制。
   */
  setNoticeVisible(visible: boolean): void {
    if (this.noticeVisible === visible) return
    this.noticeVisible = visible
    this.recomputeLayout()
    this.deps.onStateChange()
  }

  /**
   * 顶栏 / 右侧栏的显隐。
   *
   * 与地址栏同一条路子：改完立刻重排、广播，界面按回传的结果绘制。
   * 用户的选择还要落盘——「隐藏顶部栏」是个人偏好，不该每次启动都重来一遍。
   */
  setChrome(patch: ChromePatch): void {
    const cfg = this.deps.config.get()
    const topBarOpen = patch.topBar ?? cfg.ui.topBarOpen
    const railOpen = patch.rail ?? cfg.ui.railOpen
    if (topBarOpen === cfg.ui.topBarOpen && railOpen === cfg.ui.railOpen) return

    // 顶栏藏起来时地址栏的开关也一并消失，留着它会让顶端挂着一行没来由的输入框
    if (!topBarOpen) this.addressOpen = false

    this.deps.config.set((c) => ({ ...c, ui: { ...c.ui, topBarOpen, railOpen } }))
    this.recomputeLayout()
    this.deps.onStateChange()
  }

  /** 悬浮球在窗口内的矩形变化（渲染进程量好后上报） */
  setBallRect(rect: Rect): void {
    /*
     * 渲染进程量到的是**界面层内**的矩形，而这里要的是窗口坐标系里的矩形
     * （收起时按它把窗口缩到球身上）。两者在最大化期间差着界面层的原点——
     * 那时界面层缩在右上角那一小块里。换算放在这一侧做：界面那一侧不必知道
     * 自己被摆在了哪里，它只管量自己文档里的坐标。
     */
    const c = this.chrome?.getBounds()
    this.ballRect = c ? { ...rect, x: rect.x + c.x, y: rect.y + c.y } : rect
  }

  transitionTo(next: WindowMode): void {
    if (next === this.mode) return
    if (!LEGAL_TRANSITIONS[this.mode].includes(next)) {
      log.warn(`非法状态迁移被拒绝：${this.mode} → ${next}`)
      return
    }

    const previous = this.mode
    this.mode = next
    log.info(`窗口状态：${previous} → ${next}`)

    // 标签页视图只在展开态绘制。收起时它们必须让位给悬浮球，
    // 否则球的位置会露出网页内容的一角。收起 / 托盘 / 最小化这三种「没露出来」
    // 的状态一视同仁：网页那一侧要一并暂停正在播的媒体（见 TabManager.setBodyVisible）。
    this.deps.onVisibilityChange(next === 'expanded')

    this.applySurface()
    this.deps.onStateChange()
  }

  // ------------------------------------------------------------ 收起 / 展开

  /** 收起成悬浮球。整个界面缩到屏幕角落的一颗球。 */
  collapse(): void {
    const win = this.win
    if (!win || this.mode === 'collapsed') return
    if (this.mode !== 'expanded') return

    // 记下展开时的矩形，展开时原样恢复
    this.expandedBounds = win.getBounds()
    this.persistExpandedBounds()

    // 收起时把地址栏放回去：再展开应回到默认的折叠形态，
    // 而不是带着半开的一行地址栏回来
    this.addressOpen = false

    const cfg = this.deps.config.get()

    this.transitionTo('collapsed')
    this.applyCollapsedBounds(cfg.window.opacity)
    this.syncChromeBounds()
    this.watcher?.rearm()
    /*
     * 收起成球时把网页里那份全屏也退掉：40×40 的窗里挂着一个「网页以为在
     * 全屏」的视频没有意义（它照旧铺满整块正文区——也就是那颗球里），
     * 而退出全屏这件事只有网页那一侧做得到。
     *
     * 放在最后：先把窗口收好，再让网页退全屏。反过来的话，退出全屏带来的一串
     * 状态变化会先落在一块还没收起的窗口上，多一次没有意义的版面重排。
     */
    this.deps.onLeavePageFullscreen()
  }

  /** 展开回完整界面，恢复收起前的尺寸与位置。 */
  expand(): void {
    const win = this.win
    if (!win) return
    if (this.mode === 'collapsed') this.transitionTo('expanded')

    const target = this.expandedBounds ?? defaultExpandedBounds(this.deps.config.get())
    this.surface?.apply({
      mode: 'expanded',
      windowRect: target,
      opacity: this.deps.config.get().window.opacity
    })

    this.recomputeLayout()
    this.syncChromeBounds()
    // 重新开始计时，避免刚展开就被判定为「光标在外」而立刻收起
    this.watcher?.rearm()

    win.showInactive()
    this.reassert()
  }

  // ------------------------------------------------------------ 最大化 / 还原

  /**
   * 最大化：铺满当前显示器的整个工作区，不保 16:9。
   *
   * 为什么是「自己摆一块矩形」而不是 win.maximize()：透明窗口不能最大化
   * （见 create()），这条路根本走不通。所幸本质相同——最大化本来就是
   * 「把窗口摆成工作区那块矩形」，只是顺带让平台记住还原尺寸而已，
   * 而还原尺寸我们自己记（restoreBounds）。
   *
   * 随之让位的是顶栏、地址栏与右侧栏（见 recomputeLayout）：整扇窗归网页，
   * 界面只剩右上角那一组控件。那一组之所以还看得见、点得到，靠的是把界面层
   * 抬到网页之上（syncChromeOrder）。
   */
  maximize(): void {
    // 用户自己按的：这次最大化与他有关，与网页全屏无关
    this.autoMaximized = false
    this.setMaximized(true)
  }

  /** 还原：回到最大化之前那块 16:9 矩形。 */
  restore(): void {
    this.autoMaximized = false
    const was = this.maximized
    this.setMaximized(false)
    /*
     * 还原之后网页里那份全屏也要退掉（见 deps.onLeavePageFullscreen）。
     * 只有「刚才真的最大化着」才退：还原键在不曾最大化时什么都不该做，
     * 而把一个正在看全屏视频的窗口判成「无需还原」却顺手退掉它的全屏，
     * 是另一回事。
     */
    if (was) this.deps.onLeavePageFullscreen()
  }

  /**
   * 网页进了 / 退出了全屏（视频右下角那枚键、或页面里的 requestFullscreen）。
   *
   * 用户要的就是这一条：点视频的最大化，软件窗口也跟着最大化。因此这里
   * 不另设一套「网页全屏」状态，而是直接借用窗口最大化那一套——铺满工作区、
   * 两栏让位、正文占满整窗。这样视频铺满的也确实是整块屏幕，而不是
   * 一个「窗口没变、视频被拉伸到正文区」的半吊子样子。
   *
   * autoMaximized 记的就是「这次是我们替他放的」：用户自己按的最大化，
   * 退出网页全屏时不该被缩回去。
   */
  setPageFullscreen(active: boolean): void {
    if (active) {
      /*
       * 收起态下不理它：那时窗口就是一颗球，没有「铺满工作区」可言，
       * 而 setMaximized 会照摆一块工作区大小的矩形——球会突然涨成一整屏。
       * 这条路本来就到不了（HTML 全屏要用户手势，而收起时所有标签页视图都是
       * 隐藏的，收不到点击），这里只是不让它有个荒谬的结果。
       */
      if (this.mode !== 'expanded') return
      // 已经最大化了（用户自己放的）就不动它，也不接管所有权
      if (this.maximized) return
      this.autoMaximized = true
      this.setMaximized(true)
      return
    }
    if (!this.autoMaximized) return
    this.autoMaximized = false
    this.setMaximized(false)
  }

  isMaximized(): boolean {
    return this.maximized
  }

  private setMaximized(next: boolean): void {
    const win = this.win
    if (!win || next === this.maximized) return

    if (next) {
      // 记住「从哪儿来」：此刻的展开矩形正是回去的地方
      this.restoreBounds = this.expandedBounds ?? win.getBounds()
      this.maximized = true
      this.applyBounds(this.workArea(win.getBounds()))
      // 读回实测矩形。工作区那块不一定被平台原样接受，而这个字段从此刻起
      // 代表「窗口现在在哪」，后面的收起、拖动都要按它算——
      // applyCollapsedBounds() 出于同一个理由也要读回一次。
      this.expandedBounds = win.getBounds()
    } else {
      this.maximized = false
      if (this.mode === 'expanded') {
        const target = this.restoreBounds ?? defaultExpandedBounds(this.deps.config.get())
        this.restoreBounds = null
        this.applyBounds(target)
        this.expandedBounds = win.getBounds()
      } else {
        /*
         * 收起态下还原：窗口得继续是一颗球，不能在这里长大。于是只把记忆改成
         * 「按球心反推出来的一块 16:9」——这正是 syncBoundsMemory() 在收起态下
         * 做的事（它是 collapsedBounds() 的逆运算）。球因此一动不动，
         * 而下次展开会落到一块正常的 16:9 上，而不是回到铺满工作区的那块。
         */
        this.restoreBounds = null
        this.syncBoundsMemory()
      }
    }

    this.syncChromeOrder()
    this.recomputeLayout()
    this.deps.onStateChange()
  }

  /** 某块矩形所在显示器的工作区。取所在显示器而不是主显示器：窗口在哪块屏上就该铺满哪块 */
  private workArea(bounds: Rect): Rect {
    return screen.getDisplayMatching(bounds).workArea
  }

  /**
   * 界面层此刻是否**应当**压在网页之上。
   *
   * 两件事靠它：最大化时右上角那组控件（还原键 + 悬浮球）要看得见、点得到；
   * 光标贴到窗口边框时，左边缘与下边缘的缩放手柄要收得到按下（那两处的像素
   * 本来归网页，见 EdgeWatcher）。两个条件都满足时，界面层必须留在最上面。
   */
  private chromeMustBeOnTop(): boolean {
    return this.maximized || this.edgeHot
  }

  /**
   * 把界面层的叠放次序对齐到「此刻该不该压在上面」。
   *
   * 抬上去是**重加一次子视图**：`View.addChildView` 对一个已经在场的子视图
   * 就是把它重排到最上层，不会出现两份（spike/vieworder.js Q1/Q5 验过，
   * 这里整套做法都架在那条文档上）。让回去同理，只是换个落脚点——送回**最底下**，
   * 那里本来就是界面层住的地方（create() 里第一个加进来）。
   *
   * 为什么让回去是「回最底下」，而不是「把当前那一屏抬到界面层之上」：
   * 界面层是整窗大的一层，正文区那一块在它上面是空档，那一点的像素归谁只看
   * 原生那一侧的次序。抬走一屏只救了那一屏，**其余每一屏都还沉在界面层下面**——
   * 起始页、设置页、别的标签页都整块点不动。而切屏只是翻显隐、不再抬次序
   * （TabManager.activate），于是「点顶栏那颗键回起始页之后，页面上点了没反应」
   * 只要发生过一次抬升（最大化，或光标贴到窗口边框那一下）就会一直如此，
   * 顶栏与右栏却照常好用。这一跤真摔过（spike/live-app.js 的 A9）。
   *
   * force：新建标签页的视图永远是加到最上层的，于是界面层会被盖住，
   * 而我们记的「我在上面」这一刻仍然是 true。这种情况必须无条件重抬一次，
   * 否则新开的网页会把还原键和球一起盖掉——窗口就没有出口了。
   */
  syncChromeOrder(force = false): void {
    const win = this.win
    const chrome = this.chrome
    if (!win || !chrome) return
    const want = this.chromeMustBeOnTop()
    if (want === this.chromeOnTop && !force) return

    if (want) {
      win.contentView.addChildView(chrome)
    } else {
      win.contentView.addChildView(chrome, 0)
    }
    this.chromeOnTop = want
  }

  /** 光标贴到窗口边框上了 / 离开了（EdgeWatcher 报上来的） */
  private setEdgeHot(hot: boolean): void {
    if (hot === this.edgeHot) return
    this.edgeHot = hot
    this.syncChromeOrder()
  }

  /**
   * 收起态下窗口该占的屏幕矩形：以球心为中心的正方形。
   *
   * 由「展开态的窗口矩形 + 球在窗口内的矩形」推出来，而不是另外挑一个屏幕角落：
   * 球本来就画在窗口里的那个位置上，收起只是把窗口缩到它身上。
   * 那个窗口内矩形由渲染进程量好上报，见 setBallRect()。
   *
   * 必须是严格正方形，而且不小于球本身：球在收起态是铺满整扇窗画的，
   * 窗口一旦不是正方形，圆就成了椭圆。边长取三者的最大值——球宽、球高、
   * 平台下限——再多出来的那点以球心为中心摊到四边。
   */
  private collapsedBounds(): Rect {
    const base = this.expandedBounds ?? this.win?.getBounds() ?? {
      x: 0,
      y: 0,
      width: SIZE_PRESETS.medium.width,
      height: SIZE_PRESETS.medium.height
    }
    const r = this.ballRectInWindow(base.width)
    const side = Math.round(Math.max(r.width, r.height, this.ballFloor))
    const cx = base.x + r.x + r.width / 2
    const cy = base.y + r.y + r.height / 2
    return {
      x: Math.round(cx - side / 2),
      y: Math.round(cy - side / 2),
      width: side,
      height: side
    }
  }

  /**
   * 把窗口摆成收起态，并确认它真的缩到了那个尺寸。
   *
   * 平台可能拒绝把窗口缩得那么小（Windows 实测下限约 32×39，见 spike/minsize.js），
   * 悄悄给一个更大的矩形。这里的读回就是为这件事：卡住了就把下限抬到实测值，
   * 用抬过的正方形再摆一次（一次就够，抬过的值必然满足两个方向的下限）。
   * 不读回的话，用户看到的是一颗被窗口拉长的椭圆——正是要修的那个问题。
   */
  private applyCollapsedBounds(opacity: number): void {
    const win = this.win
    if (!win) return
    const want = this.collapsedBounds()
    this.surface?.apply({ mode: 'collapsed', windowRect: want, opacity })

    const got = win.getBounds()
    if (got.width <= want.width && got.height <= want.height) return

    const floor = Math.max(got.width, got.height)
    if (floor <= this.ballFloor) return
    this.ballFloor = floor
    log.warn(
      `窗口缩不到 ${want.width}×${want.height}，被平台卡在 ${got.width}×${got.height}；` +
        `悬浮球下限抬到 ${floor}`
    )
    this.surface?.apply({ mode: 'collapsed', windowRect: this.collapsedBounds(), opacity })
    this.syncChromeBounds()
  }

  /**
   * 球在窗口内的矩形。
   *
   * 收到过上报就用上报值；还没有（界面尚未加载完）时退回右上角——
   * 这只是个「还没量到」时的占位，真要用到它的时候（用户点球收起）
   * 界面必然已经画出来并报过一次了。
   */
  private ballRectInWindow(windowWidth: number): Rect {
    if (this.ballRect) return this.ballRect
    return {
      x: windowWidth - BALL_MARGIN - BALL_SIZE,
      y: BALL_MARGIN,
      width: BALL_SIZE,
      height: BALL_SIZE
    }
  }

  /** 隐藏、展开、收起时，界面层都要按当前形态重新摆一次 */
  private syncChromeBounds(): void {
    const win = this.win
    if (!win || !this.chrome) return
    const b = win.getBounds()
    this.chrome.setBounds(this.chromeBounds(b.width, b.height))
  }

  /**
   * 界面层此刻该占的窗口内矩形。
   *
   * 三种形态：
   *   - 收起态：铺满。窗口这时就是一颗球，球是铺满窗口画的，界面层必须跟着它。
   *   - 最大化：只占右上角那一小块（floatBox）。**这是整套做法里唯一的解法**——
   *     界面层与网页叠在一起时，只有最上面那一层收得到指针事件，CSS 的
   *     pointer-events 管不着（views 的命中测试在原生那一侧，见 spike/vieworder.js），
   *     于是「既浮在网页上、又不吃掉网页的点击」只能靠把界面层**真的缩小**到
   *     那一小块，而不是铺满窗口再声明自己透明。
   *   - 其余情况：铺满。这时界面层在网页之下，它盖住哪里都不影响点击。
   */
  private chromeBounds(width: number, height: number): Rect {
    if (this.mode === 'collapsed') return { x: 0, y: 0, width, height }
    if (this.maximized) return floatBox(width, height)
    return { x: 0, y: 0, width, height }
  }

  // ------------------------------------------------------------ 动作

  /**
   * 把窗口叫回来，但不抢焦点。
   *
   * 自动唤回（第二个实例、老板键）走这条路：用 showInactive 避免抢走用户
   * 编辑器的焦点——那是最容易被发现的破绽。
   */
  show(): void {
    this.reveal(false)
  }

  /**
   * 用户主动把窗口叫到最前（单击托盘图标、托盘菜单「现形」）。
   *
   * 与 show() 只差一件事：它**激活**窗口。用户自己点了托盘就是要看窗口，
   * 不激活的话（showInactive 不会改变窗口在 z 序里的位置）窗口会停在别的
   * 窗口后面，他看到的是「点了没反应」——那就成了坏掉的功能，而不是隐蔽的功能。
   */
  showForeground(): void {
    this.reveal(true)
  }

  /**
   * 托盘菜单的「现形」：把它叫到最前，并把整扇窗恢复不透明。
   *
   * 与 showForeground() 的区别就在后半句。点这一条的人，多半正是因为窗口淡得
   * 看不清了——只提到最前等于没解决问题，窗口还在原地半透明着。
   *
   * 顺序要紧：setOpacity 在非展开态会提前返回（见下），所以必须先 reveal 把它
   * 切成展开态，再设透明度，否则这一次调用只改了配置、界面纹丝不动。
   *
   * 复用 setOpacity 而不是直接调 win.setOpacity：它是唯一合法路径
   * （见 windowSurface.ts 的文件头），而且会**落盘并广播**——右栏那条「整体」
   * 滑块与设置页那条会跟着一起回到 100%，不会留下「配置是 1、滑块还停在 40%」
   * 的两份真相。用户说的「直接调整…为 100%」就是与拖到最右端等价。
   */
  revealFully(): void {
    this.reveal(true)
    this.setOpacity(1)
  }

  /**
   * 单击托盘图标：露在外面就收回托盘，藏在托盘里就把它叫到最前。
   */
  toggleFromTray(): void {
    if (this.isOnScreen()) {
      void this.hideToTray()
      return
    }
    this.showForeground()
  }

  /**
   * 双击里的第二次点击：不切换显隐，只把窗口再提到最前一次。
   *
   * 用双击的人，第一次点击唤出了窗口，第二次点击是落在任务栏上的：
   * 那一下会把任务栏变成前台窗口，刚提到最前的窗口又退到后面。
   * 这一次正好用来把它重新提到前面，双击的结果才和单击一致。
   */
  raiseFromTray(): void {
    const win = this.win
    if (!win || !this.isOnScreen()) return
    win.moveTop()
    win.focus()
  }

  /**
   * 窗口此刻是否露在外面（收起成球也算露在外面）。
   *
   * 最小化算作「没露出」：那时点托盘应当把它叫回来，而不是再藏一次，
   * 否则用户会觉得第二次点击没反应。
   */
  isOnScreen(): boolean {
    const win = this.win
    if (!win || this.mode === 'trayHidden') return false
    if (this.mode === 'minimized' || win.isMinimized()) return false
    return win.isVisible()
  }

  private reveal(activate: boolean): void {
    const win = this.win
    if (!win) return
    if (win.isMinimized()) win.restore()
    // 若停在收起态则一并展开：用户要的是完整界面，不是一颗球
    if (this.mode !== 'expanded') this.transitionTo('expanded')

    // 从收起态或托盘回来时，版面与 chrome 视图都还停在球的尺寸上，必须重算。
    // 不能指望 setBounds 触发的 resize 兜底——那是巧合，不是保证。
    this.recomputeLayout()

    if (activate) {
      win.show()
      // show() 的激活依赖 Windows 的前台权限，权限被拒时窗口只出现、不置顶；
      // moveTop 只改 z 序、不走前台权限那条路，正好把这一档补上。
      win.moveTop()
      win.focus()
    } else {
      win.showInactive()
    }
    this.reassert()
  }

  /** 藏进托盘。先淡出再 hide()，避免出现生硬的闪断。 */
  async hideToTray(): Promise<void> {
    const win = this.win
    if (!win || this.mode === 'trayHidden') return

    // 从收起态直接进托盘时不做淡出：那时窗里只有一颗球，渐隐反而更扎眼
    if (this.mode !== 'collapsed') {
      this.surface?.apply({
        mode: this.mode,
        windowRect: win.getBounds(),
        opacity: 0
      })
      await delay(140)
    }
    this.transitionTo('trayHidden')
    win.hide()
  }

  minimize(): void {
    const win = this.win
    if (!win) return
    this.transitionTo('minimized')
    win.minimize()
  }

  setOpacity(value: number): void {
    this.deps.config.set((cfg) => ({ ...cfg, window: { ...cfg.window, opacity: value } }))
    if (this.mode !== 'expanded') return
    const win = this.win
    if (!win) return
    this.surface?.apply({ mode: 'expanded', windowRect: win.getBounds(), opacity: value })
    this.deps.onStateChange()
  }

  setSize(input: { preset: SizePreset } | { width: number; height: number }): void {
    const win = this.win
    if (!win || this.mode !== 'expanded') return
    /*
     * 选一个尺寸预设 = 「我要回到这个 16:9 大小」，因此顺手退出最大化：
     * 不退出的话，用户点了「中」却什么也没发生（窗口仍铺满工作区）。
     *
     * 这里不调 restore()：它会先把窗口摆回还原矩形，而我们紧接着就要把它摆成
     * 预设档——中间那次 setBounds 是多余的，在屏幕上就是一闪。
     * 清掉两个标记即可，界面靠下面那次 onStateChange 换回还原图标。
     */
    const wasMaximized = this.maximized
    if (wasMaximized) {
      this.maximized = false
      this.restoreBounds = null
      // 这一档是用户自己挑的尺寸，与网页全屏再无关系（见 autoMaximized）
      this.autoMaximized = false
      this.syncChromeOrder()
    }

    const { width, height } = 'preset' in input ? SIZE_PRESETS[input.preset] : input
    const b = win.getBounds()
    win.setBounds({ x: b.x, y: b.y, width, height })
    this.expandedBounds = win.getBounds()
    this.recomputeLayout()
    if (wasMaximized) this.deps.onStateChange()
  }

  reassert(): void {
    this.surface?.reassert()
  }

  /**
   * 窗口移动停下来之后再落盘位置、重放表面状态。
   *
   * 用系统拖动区拖窗口时，move 每帧来一次。落盘是写文件，重放是五次窗口级
   * Win32 调用（其中 setSkipTaskbar 在 Windows 上要隐藏再显示窗口），
   * 逐帧做既闪烁又白白写盘。因此这里只重置计时器，等窗口停稳后合并成一次。
   *
   * 重放本身仍然要留下来：窗口挪到另一块显示器或 DPI 不同的屏幕上之后，
   * Windows 会丢掉这些分层属性，正是这种时候需要补一次。
   */
  private scheduleMoveSettle(): void {
    if (this.moveSettleTimer) clearTimeout(this.moveSettleTimer)
    this.moveSettleTimer = setTimeout(() => {
      this.moveSettleTimer = null
      // 收起态下窗口就是一颗球，它的矩形不是展开尺寸，不能往配置里写
      if (this.mode === 'expanded') this.persistExpandedBounds()
      this.reassert()
    }, MOVE_SETTLE_MS)
  }

  setContentProtection(enabled: boolean): void {
    this.win?.setContentProtection(enabled)
  }

  destroy(): void {
    // 先停轮询与拖动跟踪，再拆窗口：反过来的话定时器会在窗口销毁后继续 tick
    this.watcher?.stop()
    this.edgeWatcher?.stop()
    if (this.dragTimer) {
      clearInterval(this.dragTimer)
      this.dragTimer = null
    }
    if (this.resizeTimer) {
      clearInterval(this.resizeTimer)
      this.resizeTimer = null
    }
    if (this.moveSettleTimer) {
      clearTimeout(this.moveSettleTimer)
      this.moveSettleTimer = null
    }
    this.dragAnchor = null
    this.resizeAnchor = null
    if (this.mode === 'quitting') return
    this.mode = 'quitting'
    try {
      this.chrome?.webContents.close()
    } catch {
      // 退出路径，忽略
    }
    try {
      this.win?.destroy()
    } catch {
      // 窗口可能已随进程退出被系统回收
    }
    this.win = null
  }

  // ------------------------------------------------------------ 拖动

  /**
   * 拖动窗口。
   *
   * 不用 `-webkit-app-region: drag`：那个原生拖动会吞掉点击，而悬浮球正是靠
   * 点击来切换收起与展开的，两者不能共存。因此整块界面都走这一条路——
   * 顶栏、地址栏、右侧栏、悬浮球，全是在渲染进程按下、由这里移动窗口，
   * 于是「哪儿能拖」只由界面上挂了哪个处理器决定，不受「有没有空白像素
   * 露在 no-drag 元素外面」摆布。
   *
   * 由主进程驱动而不是渲染进程自己跟：主进程读得到全局光标位置，
   * 每帧把窗口挪到「光标位移」对应的位置上。窗口跟着光标走，光标就一直停在
   * 原来那一处，松开事件也就不会丢失——这是渲染进程自己跟踪 mousemove
   * 做不到的（指针一旦离开窗口，渲染进程就收不到事件了，窗口会僵在原地，
   * 拖动当场断掉）。
   */
  beginDrag(): void {
    const win = this.win
    if (!win) return
    /*
     * 最大化状态下拖动窗口 = 先还原、再接着拖。这是 Windows 的手感，
     * 也是这一态下最自然的一个出口（最大化时整块界面都归网页，
     * 能拖的只有右上角那一组控件）。
     *
     * 还原之后才读锚点，于是拖动按「光标位移」走：窗口回到原来的 16:9 位置，
     * 再跟着光标移动。不会是「窗口跳到光标上」——拖动是位移，与窗口此刻在哪无关。
     * 收起态下拖球同样走这里：还原只改记忆，球不会跳一下。
     */
    if (this.maximized) {
      // 用户自己拖走的，与网页全屏再无关系（见 autoMaximized）
      this.autoMaximized = false
      this.setMaximized(false)
    }
    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()
    // 已经挂着一次拖动时（上一次的松开事件丢了）不忽略这一下，而是**重新锚定**：
    // 从当前窗口位置重新起算，于是用户再按一下就能把黏住的拖动接回来，
    // 不必重启程序。位置按锚点绝对算，重新锚定不会让窗口跳一下。
    this.dragAnchor = {
      cursorX: cursor.x,
      cursorY: cursor.y,
      winX: b.x,
      winY: b.y,
      lastX: b.x,
      lastY: b.y
    }
    if (!this.dragTimer) this.dragTimer = setInterval(() => this.tickDrag(), DRAG_TICK_MS)
  }

  endDrag(): void {
    if (this.dragTimer) {
      clearInterval(this.dragTimer)
      this.dragTimer = null
    }
    if (!this.dragAnchor) return
    this.dragAnchor = null
    this.syncBoundsMemory()
  }

  private tickDrag(): void {
    const win = this.win
    const anchor = this.dragAnchor
    if (!win || !anchor) return

    const cursor = screen.getCursorScreenPoint()
    const x = anchor.winX + (cursor.x - anchor.cursorX)
    const y = anchor.winY + (cursor.y - anchor.cursorY)
    if (x === anchor.lastX && y === anchor.lastY) return

    // 拖动期间光标在窗口自己身上（窗口跟着它走），但仍要清掉「离开计时」，
    // 免得自动收起在一个拖动刚结束时被触发
    this.watcher?.rearm()

    anchor.lastX = x
    anchor.lastY = y
    try {
      win.setPosition(x, y)
    } catch {
      // 窗口可能在拖动途中被销毁，忽略
    }
  }

  // ------------------------------------------------------------ 缩放

  /**
   * 拖动边缘改窗口大小。
   *
   * 与拖动窗口共用同一套机制：界面在边缘手柄上按下时报「拖的是哪条边」，
   * 之后每帧由主进程读全局光标、算出新矩形、推给窗口。不这么做的话，
   * 指针一旦离开窗口，渲染进程就收不到事件，缩放会当场断在半路。
   *
   * 界面那一侧之所以是**自绘手柄**而不是 `resizable: true`：透明窗口开原生缩放
   * 会在某些 Windows 版本上失效（见 windowSurface 与 spike Q5），而透明正是
   * 这个程序的全部——那条路根本走不通。
   */
  beginResize(edge: ResizeEdge): void {
    const win = this.win
    // 收起态下窗口就是一颗球，没有「边缘」可言；最小化 / 托盘里更谈不上。
    // 最大化时也不行：窗口铺满整个工作区，四边都贴着屏幕边，那四条手柄
    // 根本没画出来（界面按同一个条件收起 ResizeFrame），到这里只可能是
    // 一次迟到的消息（比如按下手柄与最大化赶在同一帧里）。
    if (!win || this.mode !== 'expanded' || this.maximized) return

    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()
    // 与拖动一样，挂着一次旧的（松手信号丢了）不忽略这一下，而是重新锚定，
    // 于是用户再按一下就能接回来。绝对算法下重新锚定不会让窗口跳一下。
    this.resizeAnchor = {
      edge,
      cursorX: cursor.x,
      cursorY: cursor.y,
      start: b,
      last: b,
      limits: this.resizeLimits(b)
    }
    if (!this.resizeTimer) this.resizeTimer = setInterval(() => this.tickResize(), DRAG_TICK_MS)
  }

  endResize(): void {
    if (this.resizeTimer) {
      clearInterval(this.resizeTimer)
      this.resizeTimer = null
    }
    if (!this.resizeAnchor) return
    this.resizeAnchor = null

    // 新矩形要立刻记住并落盘：用户拖出来的尺寸就是他下次启动想看到的尺寸。
    this.syncBoundsMemory()
    // 落盘与重放都不必每帧做，等窗口停稳后合并成一次（拖左 / 上边时位置也在变，
    // 期间那些 move 事件被上面的守卫挡掉了，收尾这一次正好补上）。
    this.scheduleMoveSettle()
  }

  private tickResize(): void {
    const win = this.win
    const anchor = this.resizeAnchor
    if (!win || !anchor) return

    const cursor = screen.getCursorScreenPoint()
    const next = resizeRect(
      anchor.start,
      anchor.edge,
      cursor.x - anchor.cursorX,
      cursor.y - anchor.cursorY,
      anchor.limits
    )
    if (sameRect(next, anchor.last)) return

    // 缩放期间光标在窗口的边上（手柄跟着窗口走），清掉「离开计时」，
    // 免得自动收起在一次缩放刚结束时被触发
    this.watcher?.rearm()

    anchor.last = next
    this.applyBounds(next)
  }

  /**
   * 缩放的上下限：下限是已验证过的最小版面，上限是**当前显示器**的工作区。
   *
   * 取显示器而不是主显示器：窗口挪到副屏上再拖边缘，能长到多大取决于那块屏。
   * 位置不夹紧（与拖动窗口一致）——拖出屏幕外是用户自己拖的，他能拖回来；
   * 而在这里替他挪窗口，手感就成了「拖到屏幕边缘时窗口突然自己跳走」。
   */
  private resizeLimits(b: Rect): ResizeLimits {
    const area = screen.getDisplayMatching(b).workArea
    return { min: SIZE_PRESETS.mini, max: { width: area.width, height: area.height } }
  }

  /**
   * 把当前窗口位置记进「展开态矩形」并落盘。
   *
   * 收起态下窗口就是一颗球，它的矩形不能直接当作展开尺寸，
   * 需要反推出「球停在原处时，展开的窗口该在哪」，再记下来。
   * 反推是 collapsedBounds() 的逆运算——按球心对齐，两边不会各自漂移。
   * 窗口被平台卡大时二者差着几个像素，按球心算才不会每拖一次就偏一点。
   */
  private syncBoundsMemory(): void {
    const win = this.win
    if (!win) return
    const b = win.getBounds()

    if (this.mode === 'expanded') {
      this.expandedBounds = b
    } else {
      const { width, height } = this.deps.config.get().window
      const r = this.ballRectInWindow(width)
      this.expandedBounds = {
        x: Math.round(b.x + b.width / 2 - (r.x + r.width / 2)),
        y: Math.round(b.y + b.height / 2 - (r.y + r.height / 2)),
        width,
        height
      }
    }

    this.persistExpandedBounds()
  }

  /** 把展开态矩形落盘 */
  private persistExpandedBounds(): void {
    /*
     * 最大化期间落盘的必须是**还原回去的那块 16:9**，而不是眼前铺满工作区的
     * 矩形：否则「最大化 → 收起 → 退出」会把满屏的矩形写进配置，
     * 下次启动窗口就是满屏的。最大化是一个临时的窗口状态，不该跟着退出走。
     */
    const target = this.restoreBounds ?? this.expandedBounds
    if (!target) return
    this.deps.config.set((cfg) => ({
      ...cfg,
      window: {
        ...cfg.window,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height
      }
    }))
  }

  // ------------------------------------------------------------ 内部

  private applySurface(): void {
    const win = this.win
    if (!win) return
    const windowRect =
      this.mode === 'collapsed' ? this.collapsedBounds() : (this.expandedBounds ?? win.getBounds())
    this.applyBounds(windowRect)
  }

  /**
   * 把窗口摆成某个矩形。
   *
   * 尺寸一律经这一条路出去（收展切换、拖动缩放、透明度变化都走它），
   * 于是「谁能改窗口大小」这个问题只有一个答案，而它下面只有 windowSurface
   * 一处真的碰窗口属性。缩放每帧调用它一次，与预设换尺寸走的是同一条路。
   */
  private applyBounds(rect: Rect): void {
    this.surface?.apply({
      mode: this.mode,
      windowRect: rect,
      opacity: this.deps.config.get().window.opacity
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 右侧栏此刻是否占位。
 *
 * 顶栏藏起来之后悬浮球就停在右栏顶端——那是它唯一的落脚处，
 * 而 chrome 层位于标签页视图**之下**，落在正文区里的球会被网页整个盖住，
 * 既看不见也点不到。因此这时无论用户怎么选，这一栏都必须保留。
 */
/**
 * 右侧栏此刻是否占位。
 *
 * 顶栏藏起来之后悬浮球就停在右栏顶端——那是它唯一的落脚处，
 * 而 chrome 层位于标签页视图**之下**，落在正文区里的球会被网页整个盖住，
 * 既看不见也点不到。因此这时无论用户怎么选，这一栏都必须保留。
 *
 * 最大化是这条规则的一个例外：那时整扇窗都归网页，球改停在右上角那一小块里，
 * 不靠右栏落脚，因此两栏一起收起来（界面的右上角那一组控件是铺在网页上的，
 * 不占正文位置）。
 */
function railVisible(cfg: AppConfig, maximized: boolean): boolean {
  if (maximized) return false
  return cfg.ui.railOpen || !cfg.ui.topBarOpen
}

function resolveInitialOrigin(w: { x: number | null; y: number | null }): { x: number; y: number } {
  if (w.x !== null && w.y !== null) return { x: w.x, y: w.y }
  const area = screen.getPrimaryDisplay().workArea
  const { width, height } = SIZE_PRESETS.medium
  return {
    x: area.x + area.width - width - 48,
    y: area.y + Math.round((area.height - height) / 2)
  }
}

function defaultExpandedBounds(cfg: { window: { width: number; height: number } }): Rect {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - cfg.window.width - 48,
    y: area.y + Math.round((area.height - cfg.window.height) / 2),
    width: cfg.window.width,
    height: cfg.window.height
  }
}
