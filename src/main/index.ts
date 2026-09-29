/**
 * 主进程入口。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { app, BrowserWindow, type Session } from 'electron'
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { BROADCAST } from '@shared/ipc'
import type { OpenPopoverRequest } from '@shared/ipc'
import { APP_ID, QUIT_WATCHDOG_MS, UPDATE_CHECK_DELAY_MS, UPDATE_FEED_BASE } from '@shared/constants'
import type { Rect } from '@shared/types'
import type { AppContext } from './context'
import { registerBrowserIpc } from './ipc/registerBrowserIpc'
import { registerDataIpc } from './ipc/registerDataIpc'
import { registerFileIpc } from './ipc/registerFileIpc'
import { registerUpdateIpc } from './ipc/registerUpdateIpc'
import { registerWindowIpc } from './ipc/registerWindowIpc'
import { BookmarkStore } from './services/bookmarkStore'
import { BallIconStore } from './services/ballIconStore'
import { BossKeyService } from './services/bossKeyService'
import { ConfigStore } from './services/configStore'
import { HistoryStore } from './services/historyStore'
import { detectMixedInstall } from './services/installRegistry'
import { initLogger, log } from './services/logger'
import { PopoverWindowService } from './services/popoverWindow'
import {
  attachReadingStore,
  registerBookProtocol,
  registerBookScheme
} from './services/bookReader'
import { registerPdfProtocol, registerPdfScheme } from './services/pdfReader'
import { ReadingStore } from './services/readingStore'
import { rendererUrl } from './services/rendererUrl'
import { hardenWebContents, setupSession } from './services/sessionSetup'
import { SiteStore } from './services/siteStore'
import { HiddenSiteStore } from './services/hiddenSiteStore'
import { TabManager } from './services/tabManager'
import { TrayService } from './services/trayService'
import { UpdateService } from './services/updateService'
import { WindowController } from './services/windowController'
import { WindowRegistry } from './services/windowRegistry'

// 必须是模块体的第一条语句。
// 注意 import 声明会被提升到它之前执行，所以上面那些模块都不能在
// 被导入时读取 userData —— 它们只接收目录作为构造参数，正是为此。
// Electron 的 userData 目录取自 app.getName()。这里刻意用 ASCII 名，而不是
// productName（纸团）：中文目录会破坏 Chromium 的缓存与分区目录，
// 且数据一旦落在 %APPDATA%\纸团 里就很难迁回。
app.setName('zhituan')

// 更名之前那一版把数据写在 %APPDATA%\moyu-reader 下。setName 一改，userData
// 就指向 %APPDATA%\zhituan，老配置、书签、站点与登录态会像凭空消失。因此做
// 一次整目录搬运，条件卡得很死：**老目录还在、新目录还没建起来**——搬过一次
// 之后这个条件再也不成立，不会重复搬，也就不需要另存一个版本号来记它。
migrateLegacyUserData()

// 窗口是置顶且透明的。Chromium 的原生遮挡检测可能判定它被遮挡而停止合成，
// 表现为画面空白或闪烁，因此关闭该检测。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const userDataDir = app.getPath('userData')

if (!app.requestSingleInstanceLock()) {
  // 第二个实例的唯一作用是把已有窗口叫出来
  app.quit()
} else {
  bootstrap()
}

/**
 * 更名（moyu-reader → zhituan）带来的一次性数据搬迁。
 *
 * 只在「老目录还在、新目录还没建起来」时动手——那是「第一次以新名字启动」
 * 的唯一特征。路径用 appData 拼而不是 userData：后者此刻已经指向新目录，
 * 拿它当判据等于自己把自己的条件废掉。
 *
 * ## 两步走：先拷到旁边，再改名过去
 *
 * 直接 `cpSync(legacy, current)` 有一个安静得可怕的坏法：**拷到一半失败时，
 * 新目录已经建起来了**，而上面那句「新目录还没建起来」从此再也不成立——
 * 于是下一次启动不重试，用户看到的是「配置、书签、登录态全没了」，而且再也不会
 * 自己回来。这不是假想：一次探针启动（它只改了 userData，没改 appData）就留下过
 * 一个只有 4 个条目的 `%APPDATA%\zhituan`——`ball-icon.json` 与 `bookmarks.json`
 * 是完整副本，`config.json` 与 `history.json` 一个都没有，**而这足以把真正的搬迁
 * 永久挡在门外**（见 docs/spike-findings.md 的 Q68）。
 *
 * 因此先拷进 `zhituan.migrating`：拷完才改名到正式名字。改名是原子的，于是
 * 「新目录存在」这件事重新等于「搬迁已经完整做完」——失败就什么都不留，
 * 下一次启动自动重试。
 *
 * 搬不动就按新装处理：丢的是配置与登录态，不是应用本身，因此这里一律不抛。
 */
function migrateLegacyUserData(): void {
  try {
    const appData = app.getPath('appData')
    const legacy = join(appData, 'moyu-reader')
    const current = join(appData, 'zhituan')
    const staging = join(appData, 'zhituan.migrating')

    if (!existsSync(legacy) || existsSync(current)) return

    // 上一次也失败在改名之前，留下的那一份半成品要先清掉（否则 renameSync 会失败）
    rmSync(staging, { recursive: true, force: true })
    cpSync(legacy, staging, { recursive: true })
    renameSync(staging, current)
    log.info(`已将旧数据目录搬到新名字下：${legacy} → ${current}`)
  } catch (error) {
    log.warn(`旧数据目录迁移失败，按新装处理：${String(error)}`)
  }
}

function bootstrap(): void {
  initLogger(userDataDir)
  log.info(`userData 目录：${userDataDir}`)

  const preloadPath = join(__dirname, '../preload/index.js')
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.ico')
    : join(__dirname, '../../resources/tray.ico')

  const config = new ConfigStore(userDataDir)
  const registry = new WindowRegistry()
  const sites = new SiteStore(userDataDir)
  // 起始页上被移除的域名。单独一份文件：它会越删越长，而配置一变就全量广播
  const hidden = new HiddenSiteStore(userDataDir)
  const history = new HistoryStore(userDataDir)
  const bookmarks = new BookmarkStore(userDataDir)
  const reading = new ReadingStore(userDataDir)
  /*
   * 阅读位置这份账按**本机路径**记，而阅读页手里只有一个 token——两张表都在
   * services/bookReader.ts 里，于是换算也交给它一处做完（见 rememberReading）。
   * 换成别处再算一遍，等于把那两张表的作用域扩出去，迟早有人顺着它读路径。
   */
  attachReadingStore(reading)
  const ballIcon = new BallIconStore(userDataDir)
  const bossKeys = new BossKeyService()

  // session.fromPartition 只能在 app ready 之后调用，
  // 因此这里只留一个占位，真正的创建放在 whenReady 内。
  let ses: Session | null = null
  hardenWebContents()
  // 特权协议名只能在 app ready 之前声明；处理程序挂到分区会话上，见 whenReady。
  // 这两条是同一件事的两半：「自家的阅读页怎么拿到一本书的字节」——一个给 PDF，
  // 一个给 EPUB。放在这里而不是各自模块的初始化里，是因为时机是 Electron 定的。
  registerPdfScheme()
  registerBookScheme()

  function broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
    const chrome = controller.getChromeView()
    if (chrome && !chrome.webContents.isDestroyed()) {
      chrome.webContents.send(channel, payload)
    }
    // 自家页面（首页、系统设置）也是渲染进程，只是住在标签页那一层视图里，
    // 不在上面两个集合中。起始页换主题靠的就是这条配置广播。
    tabsRef?.broadcastToOwnPages(channel, payload)
  }

  // tabs 与 controller 互相引用，用可变引用打破声明顺序上的死结
  let tabsRef: TabManager | null = null
  /**
   * 弹出面板服务，供窗口状态变化时回头叫它。
   *
   * 面板是与主窗口并列的另一扇窗，主窗口收起 / 进托盘 / 最小化都不会带上它——
   * 不管的话，按下老板键之后桌面上会孤零零留着一块列着站点名或历史的面板，
   * 正是这个软件最不该露出来的东西。声明在 controller 之前是因为
   * onVisibilityChange 里要用（那里 controller 自己还没构造完）。
   */
  let popoverRef: PopoverWindowService | null = null

  const controller = new WindowController({
    config,
    registry,
    preloadPath,
    rendererUrl: rendererUrl('index'),
    onVisibilityChange: (visible) => {
      // 隐藏（收起成球 / 进托盘 / 最小化）时网页那一侧要暂停正在播的媒体并静音，
      // 回到展开态再恢复。哪些该恢复不在这里判：窗口这一侧只知道「露没露出来」，
      // 后台那张标签还归「切走时暂停」那条规矩管（见 TabManager.applyMediaState）。
      tabsRef?.setBodyVisible(visible)
      // 面板不跟着窗口走，窗口一没就得自己收掉（见 popoverRef 的注释）
      if (!visible) popoverRef?.close()
    },
    // 正文区是原生视图，版面一变就得显式重摆——它不跟着 CSS 走
    onLayoutChange: () => {
      tabsRef?.layoutAll()
    },
    onStateChange: () => {
      broadcast(BROADCAST.windowState, controller.getRuntime())
    },
    // 网页退出全屏（还原、收起成球这两种情况），见 setPageFullscreen 的注释
    onLeavePageFullscreen: () => tabsRef?.exitPageFullscreen()
  })

  const tabs = new TabManager({
    getWindow: () => controller.getWindow(),
    getBodyRect: () => controller.getBodyRect(),
    getSession: () => {
      if (!ses) throw new Error('会话尚未就绪，标签页只能在 app ready 之后创建')
      return ses
    },
    getPreloadPath: () => preloadPath,
    getConfig: () => config.get(),
    onStateChange: () => {
      // 标签条的内容、当前那张网页、以及正文区停在哪一屏，是三件不同的事，
      // 但只有一处算得出来——快照是同一个，界面拿到手就不必自己拼
      broadcast(BROADCAST.tabsState, tabs.snapshot())
    },
    onNavigated: (entry) => history.record(entry),
    // 新视图永远加在最上层，界面层若正需要待在上面就得重新抬一次
    onViewAdded: () => controller.syncChromeOrder(true),
    /*
     * 用户点了视频的全屏键（或页面自己 requestFullscreen）→ 软件窗口也最大化。
     * 反向不在这里：用户自己按了还原键时，由 controller 那边叫回来退网页全屏
     * （deps.onLeavePageFullscreen），否则「谁先动」会绕成一个圈。
     */
    onPageFullscreen: (active) => controller.setPageFullscreen(active)
  })
  tabsRef = tabs

  /*
   * 配置一改就广播出去，**不问是谁改的**。
   *
   * 挂在这里而不是挂在某个 IPC 处理器里，是因为写配置的路不止一条：设置页走
   * configPatch、右栏那条整体透明度滑块走 win.setOpacity → controller.setOpacity、
   * 托盘与悬浮球菜单里显隐顶栏 / 右栏走 controller.setChrome、更新提示上那个
   * 「忽略此版本」走 updateService、清掉自定义球图标时回落默认图标走
   * ballIconSet——而 ConfigStore 本身不认识窗口。挂在 store 的订阅上，
   * 谁写的都算数，也不必每加一条写路径就回来补一句广播。
   *
   * 从前只有 configPatch 那一条路广播，于是「不经过设置页」的改动只落在主进程
   * 里：最典型的是整体透明度——右栏那条滑块的依据是渲染进程手里这份配置镜像，
   * 它一直停在挂载时读到的旧值（默认 100%）上，用户每调小一次、一松手
   * 滑块就跳回 100%。
   *
   * 同一处还要接第二条线：**已经开着的**本机文件（离线阅读的 TXT）拿不到广播——
   * 它们不是自家页面，没有那座桥，正文的透明度与排版三项只能由主进程往它们的
   * 视图里注入。而这件事同样「写配置的路不止一条」，因此也挂在这里，与广播同一处。
   * 那两项合在 TabManager.refreshReaderView 里（对象、时机、判据完全一样）。
   *
   * 第三条线同理：媒体那两条规矩（收起时暂停 / 切走时暂停）改完也要当场重算，
   * 否则用户关了开关，后台那张还得等到下一次切标签才被放起来——见
   * TabManager.refreshMediaState。
   */
  config.subscribe((next) => {
    broadcast(BROADCAST.configChanged, next)
    tabs.refreshReaderView()
    tabs.refreshMediaState()
  })

  const popover = new PopoverWindowService(
    registry,
    preloadPath,
    (): Rect | null => controller.getWindow()?.getBounds() ?? null,
    // 面板收起时把焦点还回主窗口（不展开、不显形——它本来就在场）
    (): void => controller.getWindow()?.focus()
  )
  popoverRef = popover

  /**
   * 打开系统设置。
   *
   * 它是窗口内的一屏（与起始页一样是自家的视图，**不是标签页**），
   * 不是一扇独立窗口——独立窗口会出现在任务栏与 Alt+Tab 里，等于把
   * 「我在摸鱼」写在脸上。窗口若正缩成球或藏在托盘里，先叫回来：
   * 用户要的是看到设置。托盘菜单与悬浮球菜单里那一项走的就是它，**永远进去**。
   */
  function showSettings(): void {
    tabs.openSettings()
    controller.showForeground()
  }

  /**
   * 回到起始页。
   *
   * 与 showSettings 同一套：界面上的出口（同一条键再点一次）不叫它，
   * 那条走 leaveScreen——这里只管「今天就要看起始页」这件事。
   */
  function showHome(): void {
    tabs.openHome()
    controller.showForeground()
  }

  /**
   * 从起始页 / 设置原路返回到刚才那张网页。
   *
   * 回哪一张由 TabManager 记（lastTabId），这里只负责把窗口叫到眼前：
   * 收起成球或藏在托盘里时，「返回」这个词里就包含着「让我看见」。
   */
  function backToPage(): void {
    tabs.leaveScreen()
    controller.showForeground()
  }

  /**
   * 退出看门狗：退出流程的最长时间预算。
   *
   * 正常路径是 app.quit() → before-quit 落盘 → will-quit 里 app.exit(0)，
   * 毫秒级的事。但 before-quit 要同步写六份文件，其中任何一次被拖住，
   * 整条退出链就停在半路、进程迟迟不退——见 QUIT_WATCHDOG_MS 那段注释。
   *
   * 更新流程里这一步的代价最大：应用内「更新并重启」是先起安装程序、
   * 宽限期过后才退出（updateService.spawnInstaller），安装程序正等在外面
   * 替换文件。退出卡住，用户看到的就是「应用关了，然后什么都没有」。
   *
   * will-quit 会负责清掉它，所以正常退出不会因此多等哪怕一毫秒。
   */
  let quitWatchdog: NodeJS.Timeout | null = null

  function quit(): void {
    if (!quitWatchdog) {
      quitWatchdog = setTimeout(() => {
        log.warn(`退出在 ${QUIT_WATCHDOG_MS}ms 内没有走完，强制终止进程`)
        app.exit(0)
      }, QUIT_WATCHDOG_MS)
    }
    app.quit()
  }

  const tray = new TrayService({
    // 单击图标是在「现形」与「收回托盘」之间切换，判据由窗口控制器持有
    onClickIcon: () => controller.toggleFromTray(),
    // 双击的第二次点击不切换，只补一次「提到最前」
    onRepeatedClick: () => controller.raiseFromTray(),
    // 菜单里的「现形」意图明确：提到最前，并且把整扇窗恢复不透明
    onReveal: () => controller.revealFully(),
    onOpenSettings: () => showSettings(),
    onQuit: () => quit()
  })

  /**
   * 检查更新。
   *
   * 版本号与「是不是打包版」由外面传进去：服务本身不读 app.*，探针才能直接
   * 构造它（spike/update-check.js 走的就是这条路）。
   *
   * 开发模式（app.isPackaged 为假）下不联网：那时版本号是 0.0.0、界面来自
   * vite 的开发服务器，查到的更新对当前这个进程没有任何意义。
   * 安装包落在系统临时目录下的一个子目录里——它是可以丢的，别占用户的
   * userData；而且那个目录会被系统定期清理，正好符合「下完就该被用掉」。
   */
  const updateEnabled = app.isPackaged
  /** 启动后那一次静默检查的定时器，见 whenReady 末尾 */
  let updateTimer: NodeJS.Timeout | null = null
  /**
   * 正在跑的这个 exe 在哪个目录 / 版本号是多少。两处都要用：更新服务拿版本号去
   * 比对发布页，mixedInstall 那条拿目录去跟注册表里登记的安装位置对齐。
   */
  const runningExe = app.getPath('exe')
  const update = new UpdateService({
    config,
    feedBase: UPDATE_FEED_BASE,
    currentVersion: app.getVersion(),
    enabled: updateEnabled,
    downloadDir: join(app.getPath('temp'), 'zhituan-update'),
    onState: (state) => broadcast(BROADCAST.updateState, state),
    setNoticeVisible: (visible) => controller.setNoticeVisible(visible),
    quit: () => quit(),
    // 读注册表问「上一次的更新到底落地了没有」（见 installRegistry）。
    // enabled 为假（开发模式）时服务自己不会问，这里不必再判一次
    mixedInstall: () =>
      detectMixedInstall({
        appId: APP_ID,
        runningVersion: app.getVersion(),
        runningDir: dirname(runningExe)
      })
  })

  const ctx: AppContext = {
    userDataDir,
    config,
    registry,
    sites,
    hidden,
    history,
    bookmarks,
    reading,
    ballIcon,
    controller,
    tabs,
    bossKeys,
    tray,
    update,
    broadcast,
    openHome: () => showHome(),
    openSettings: () => showSettings(),
    leaveScreen: () => backToPage(),
    openPopover: (req: OpenPopoverRequest) => popover.open(req),
    // 用户在面板里选完东西（切标签、点书签、点历史）→ 走 dismiss：连焦点一起收尾
    closePopover: () => popover.dismiss(),
    quit
  }

  function registerBossKeys(): void {
    const cfg = config.get()

    const minResult = bossKeys.register('bossMinimize', cfg.hotkeys.bossMinimize, () => {
      const win = controller.getWindow()
      if (!win) return
      if (controller.getMode() === 'minimized' || win.isMinimized()) controller.show()
      else controller.minimize()
    })
    if (!minResult.ok) log.warn(`老板键 1（${cfg.hotkeys.bossMinimize}）注册失败，用户需在设置中更换`)

    const hideResult = bossKeys.register('bossHideToTray', cfg.hotkeys.bossHideToTray, () => {
      void controller.hideToTray()
    })
    if (!hideResult.ok) log.warn(`老板键 2（${cfg.hotkeys.bossHideToTray}）注册失败，用户需在设置中更换`)
  }

  app.whenReady().then(() => {
    // 持久化会话必须在这里创建：app ready 之前 session 模块不可用
    ses = setupSession()
    // 本机 PDF 与本机 EPUB 的资源通道都挂在这个分区会话上（页面全都在它里面）
    registerPdfProtocol(ses)
    registerBookProtocol(ses)

    electronApp.setAppUserModelId('com.m4xlmum.zhituan')
    app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

    registerDataIpc(ctx)
    registerBrowserIpc(ctx)
    registerFileIpc(ctx)
    registerWindowIpc(ctx)
    registerUpdateIpc(ctx)

    controller.create()
    tray.create(trayIconPath)
    registerBossKeys()

    // 首页常驻：它是「回到起点」的落点，也是启动后的第一屏
    tabs.openHome()

    // 恢复上次的访客标签页
    const restored = config.get().lastSession.openUrls
    if (restored.length > 0) {
      for (const url of restored) tabs.create({ url, activate: false })
      const list = tabs.list()
      const index = Math.min(config.get().lastSession.activeIndex, list.length - 1)
      if (list[index]) tabs.activate(list[index].id)
    }

    controller.show()

    /*
     * 启动后静默查一次更新。
     *
     * 拖二十秒再查有两条理由：别跟启动那一堆活抢网络与主线程；以及——一个刚打开
     * 的窗口立刻变出一条提示，比二十秒后悄悄多出一行更容易被旁边的人注意到。
     * 查到什么都不弹东西：提示条只是窗口内的一行，见 UpdateNotice.vue。
     *
     * 开关（update.autoCheck）管的是这一次自动检查，设置页里那个手动按钮不受它管。
     */
    if (updateEnabled && config.get().update.autoCheck) {
      updateTimer = setTimeout(() => {
        updateTimer = null
        void update.check()
      }, UPDATE_CHECK_DELAY_MS)
    }

    /*
     * 另一件事，不走上面那个开关、也不等那二十秒：本机**登记**的安装版本是不是
     * 比正在跑的这一份新（见 updateService.refreshMixedInstall）。
     *
     * 它是本地的一个事实，不联网、也跟「要不要自动检查」无关——上一次更新没落地
     * 的时候，用户最需要看到的就是这一句，而它必须在他打开窗口的那一下就说得出来。
     */
    void update.refreshMixedInstall()

    // explorer.exe 重启会带走托盘图标，而 Electron 没有任务栏重建事件。
    // 在每次显示窗口时重建一次，成本很低；托盘没了用户可能再也找不回窗口。
    //
    // 重建挪到下一个事件循环：这条路径经常是从托盘自己的 click 处理器里走过来的
    // （点图标 → 现形 → show 事件），在托盘事件的分发过程中把 Tray 对象销毁掉
    // 会动到当时还在执行的那段原生回调。
    controller.getWindow()?.on('show', () => {
      setImmediate(() => tray.rebuild(trayIconPath))
    })
  })

  app.on('second-instance', () => {
    controller.show()
  })

  // 托盘应用：窗口全关也不退出，退出只走托盘菜单。
  // 这里必须什么都不做——若在此处再调 app.quit()，而 app.quit() 本身就会
  // 关闭窗口并触发本事件，就会递归调用自己，把退出的状态机搅住，
  // 表现为所有退出钩子都跑完了、进程却一直不退。
  app.on('window-all-closed', () => {
    // 有意留空
  })

  app.on('before-quit', () => {
    // 关窗之后仍要把这次的会话记下来，供下次启动恢复
    config.set((cfg) => ({
      ...cfg,
      lastSession: { openUrls: tabs.getOpenUrls(), activeIndex: 0 }
    }))
    config.flush()
    sites.flush()
    // 起始页上「移除站点」那一条也是去抖写入的，同样要走之前落盘
    hidden.flush()
    history.flush()
    bookmarks.flush()
    // 阅读位置是去抖写入的：最后那一次翻页多半还没落盘，走之前把它写下去
    reading.flush()
  })

  app.on('will-quit', () => {
    // 走到这里说明退出链没卡住，那把看门狗撤掉——它只是「走不到这里」的保险
    if (quitWatchdog) {
      clearTimeout(quitWatchdog)
      quitWatchdog = null
    }
    // 顺序有讲究：先停掉还在轮询的定时器，再拆窗口。
    // 反过来的话，定时器会在窗口销毁后继续 tick，撞上已销毁的对象，
    // 异常会冒到主进程的未捕获异常处理器上，弹框把退出流程卡住。
    controller.destroy()
    // 启动那次静默检查若还没到点，就别让它醒过来了
    if (updateTimer) {
      clearTimeout(updateTimer)
      updateTimer = null
    }
    // 不注销的话，退出后这些组合键仍被本进程占用，别的程序用不了
    bossKeys.unregisterAll()
    tabs.destroyAll()
    tray.destroy()

    // 收尾全部由我们自己完成，因此由我们负责终止进程，不再依赖
    // Electron 的默认退出：实测在这台机器上 will-quit 之后主进程的事件
    // 循环会被卡住四十多秒，进程迟迟不退，用户看到的是「点了退出但没反应」。
    app.exit(0)
  })
}
