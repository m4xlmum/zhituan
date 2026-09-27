/**
 * 探针：最大化 / 还原这条往返，在真窗口上究竟摆出了什么。
 *
 * 「最大化」是这一版里唯一一处没人兜底的状态机：它在 WindowController 里
 * （restoreBounds / maximized / chromeBounds / 落盘），算错一点也不会报错——
 * 窗口照样是个窗口，只是还原不回去、或者下次启动是满屏的。
 * 因此这里把**真的** WindowController 起起来（配置写在临时目录里，
 * 绝不碰用户的配置文件），照真窗口跑一遍往返，逐条读回实测值：
 *
 *   Q1 起手：窗口就是配置里那块 16:9
 *   Q2 最大化：窗口 == 所在显示器的工作区；顶栏、地址栏与右栏一起让位、
 *      正文占满整窗；界面层缩成右上角那一小块（floatBox），并被抬到正文之上
 *   Q3 还原：回到最大化之前那块 16:9；正文让回、界面层让回——次序回到起手那样
 *      （界面层在最底下），**后来才出现的那一屏**也在它之上（Q3d）
 *   Q4 最大化 → 收起 → 展开：球照常缩成正方形落在球心上，展开回到工作区；
 *      而且**落盘写的是那块 16:9，不是工作区**（「最大化着退出」不该下次满屏）
 *   Q5 最大化时选尺寸预设：退出最大化并落到那一档
 *   Q6 最大化时拖动窗口：先还原、再读锚点（Windows 的手感）
 *
 * 窗口摆在哪：所有显示器之外，并且把 show / showInactive 换成了空操作——
 * 展开那一档会调 win.showInactive()，而窗口一露出来就是一块铺满屏幕的东西，
 * 用户明确要求过改代码的过程中不要弹窗。同理，Q6 只在同一个同步块里
 * 按下又松开，中间不给定时器任何一次滴答的机会（拖动每 8ms 挪一次窗口）。
 *
 * 跑法：npx electron spike/window-max.js
 * 产出：终端一份 [Qn] 报告，spike/out/window-max.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, WebContentsView, ipcMain, screen } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

/**
 * 把要用的几份 TS 各打成一包再 require。
 *
 * 不在这里另抄一份常量、也不另写一个假的控制器：那样验的是抄本，
 * 而抄本永远是对的。esbuild 本来就在依赖树里（vite 带进来的），
 * 给它一个 @shared 别名、把 electron 留成外部依赖即可。
 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-max-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'windowController.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'configStore.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'windowRegistry.ts'),
      path.join(ROOT, 'src', 'shared', 'constants.ts')
    ],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outdir,
    // 几个入口不同目录，不给 outbase 的话 esbuild 会按它们的公共祖先铺一层 src/
    outbase: path.join(ROOT, 'src'),
    outExtension: { '.js': '.cjs' },
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    // 真的 electron 由本进程提供；打进来的话就是两份 Electron 了
    external: ['electron'],
    logLevel: 'silent'
  })
  const at = (...p) => path.join(outdir, ...p)
  return {
    controller: require(at('main', 'services', 'windowController.cjs')),
    configStore: require(at('main', 'services', 'configStore.cjs')),
    registry: require(at('main', 'services', 'windowRegistry.cjs')),
    constants: require(at('shared', 'constants.cjs'))
  }
}

/** 两个矩形是否逐字段相等（DIP 都是整数，不必给容差） */
const rectEq = (a, b) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** 尺寸是否一致（位置另说：平台可能把窗口挪几像素） */
const sizeEq = (a, b) => !!a && !!b && a.width === b.width && a.height === b.height

app.whenReady().then(async () => {
  const mods = await buildModules()
  const { WindowController } = mods.controller
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry
  const { SIZE_PRESETS, FLOAT_W, FLOAT_H, TOP_BAR_H, RAIL_W } = mods.constants

  // 配置写在临时目录：本探针会把尺寸写进它，绝不能写进用户真正的那一份
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-max-config-'))
  const config = new ConfigStore(configDir)

  /** 所有显示器之外的一个落点，保证窗口永远不出现在屏幕上 */
  const displays = screen.getAllDisplays()
  const origin = {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 1200,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 900
  }
  const START = { width: 1280, height: 720 }
  // x/y 给了值，create() 就不会再用「主显示器右下角」那套默认落点
  config.set((c) => ({ ...c, window: { ...c.window, x: origin.x, y: origin.y, ...START } }))

  // 界面那一页走 spike 的假桥：它要 sendSync 问一次选项，这里照答一份
  ipcMain.on('preview:options', (event) => {
    event.returnValue = {
      mode: 'default',
      maximized: false,
      theme: 'paper',
      tabs: 0,
      bgAlpha: 1,
      ballIcon: 'book',
      ballFit: 'cover',
      ballImage: null
    }
  })

  const registry = new WindowRegistry()
  let layoutCalls = 0
  let pageView = null
  /**
   * 还原时会被叫一次（见 WindowController.restore 的注释）：网页里那份全屏
   * 只有网页自己退得掉，因此这个回调是真的要有的——本探针里没有网页全屏，
   * 给个空操作，但**数着次数**：它该在「刚才真的最大化着」时叫，且只叫一次。
   */
  let leaveFullscreenCalls = 0

  const controller = new WindowController({
    config,
    registry,
    preloadPath: path.join(__dirname, 'preview-preload.js'),
    rendererUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).toString(),
    onVisibilityChange: () => {},
    // 与真的 TabManager 一样：正文矩形一变就把视图重摆一次
    onLayoutChange: () => {
      layoutCalls += 1
      pageView?.setBounds(controller.getBodyRect())
    },
    onStateChange: () => {},
    onLeavePageFullscreen: () => {
      leaveFullscreenCalls += 1
    }
  })

  controller.create()
  const win = controller.getWindow()

  // 窗口会停在屏幕外，而这两次调用会把它显示出来——用户要求过不弹窗
  win.show = () => {}
  win.showInactive = () => {}

  // 一扇假的正文视图，只为看叠放次序：真的那一层归 TabManager，
  // 这里的要点是「界面层抬上去 / 让回来」有没有真的发生
  pageView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  pageView.setBackgroundColor('#00000000')
  win.contentView.addChildView(pageView)
  pageView.setBounds(controller.getBodyRect())
  await pageView.webContents.loadURL('data:text/html,<body style="margin:0"></body>')
  await delay(200)

  /** 当前子视图的次序，用名字报出来 */
  const order = () =>
    win.contentView.children.map((v) => (v === controller.getChromeView() ? 'chrome' : v === pageView ? 'page' : '?'))
  /** 最上面那一格是谁 */
  const topName = () => {
    const names = order()
    return names[names.length - 1] ?? null
  }

  // ---- Q1：起手就是配置里那块 16:9 ----
  const start = win.getBounds()
  record(
    'Q1',
    'create 之后窗口就是配置里那块 16:9',
    rectEq(start, { x: origin.x, y: origin.y, ...START }) ? '是' : '否',
    { 实测: start, 期望: { x: origin.x, y: origin.y, ...START } }
  )

  // ---- Q2：最大化 ----
  const workArea = screen.getDisplayMatching(start).workArea
  controller.maximize()
  await delay(150)

  const maxBounds = win.getBounds()
  const maxRuntime = controller.getRuntime()
  const maxChrome = controller.getChromeView().getBounds()
  const maxBody = controller.getBodyRect()
  const maxTop = topName()

  record(
    'Q2a',
    '最大化：窗口 == 所在显示器的工作区（整块，不保 16:9）',
    rectEq(maxBounds, workArea) ? '是' : '否',
    { 实测: maxBounds, 工作区: workArea }
  )
  record(
    'Q2b',
    '最大化：runtime 报 maximized，两栏与地址栏一起让位，正文占满整窗',
    maxRuntime.maximized === true &&
      maxRuntime.railVisible === false &&
      maxRuntime.addressOpen === false &&
      rectEq(maxBody, { x: 0, y: 0, width: workArea.width, height: workArea.height })
      ? '是'
      : '否',
    { runtime: maxRuntime, 正文矩形: maxBody, 整窗: { width: workArea.width, height: workArea.height } }
  )
  record(
    'Q2c',
    '最大化：界面层缩成右上角那一小块（floatBox），这一小块才是它真机上的地盘',
    rectEq(maxChrome, { x: workArea.width - FLOAT_W, y: 0, width: FLOAT_W, height: FLOAT_H })
      ? '是'
      : '否',
    { 实测: maxChrome, 期望: { x: workArea.width - FLOAT_W, y: 0, width: FLOAT_W, height: FLOAT_H } }
  )
  record(
    'Q2d',
    '最大化：界面层被抬到正文之上（否则还原键与球会被网页盖住，窗口就没有出口了）',
    maxTop === 'chrome' ? '是' : '否',
    { 次序: order() }
  )

  // ---- Q3：还原 ----
  controller.restore()
  await delay(150)

  const backBounds = win.getBounds()
  const backRuntime = controller.getRuntime()
  const backChrome = controller.getChromeView().getBounds()
  const backBody = controller.getBodyRect()

  record(
    'Q3a',
    '还原：回到最大化之前那块 16:9（位置与尺寸都要回来）',
    rectEq(backBounds, { x: origin.x, y: origin.y, ...START }) ? '是' : '否',
    { 实测: backBounds, 期望: { x: origin.x, y: origin.y, ...START } }
  )
  record(
    'Q3b',
    '还原：两栏与地址栏回来，正文让回它们该占的那一条',
    backRuntime.maximized === false &&
      backRuntime.railVisible === true &&
      rectEq(backBody, {
        x: 0,
        y: TOP_BAR_H,
        width: START.width - RAIL_W,
        height: START.height - TOP_BAR_H
      })
      ? '是'
      : '否',
    { runtime: backRuntime, 正文矩形: backBody }
  )
  record(
    'Q3c',
    '还原：界面层铺回整窗，并让回网页之下——次序回到起手那样（界面层在最底下）',
    rectEq(backChrome, { x: 0, y: 0, width: START.width, height: START.height }) &&
      JSON.stringify(order()) === JSON.stringify(['chrome', 'page'])
      ? '是'
      : '否',
    { 界面层: backChrome, 次序: order() }
  )

  /*
   * Q3d：让回之后**后来才出现的那一屏**也得在界面层之上。
   *
   * 这是用户报的那条毛病本身：界面层是整窗大的一层，正文区那一块在它上面是空档。
   * 让回若只把「当前那一屏」抬上去，其余每一屏都沉在界面层下面——切屏只是翻显隐、
   * 不再抬次序，于是点顶栏那颗键回起始页之后，页面上怎么点都没反应，
   * 而顶栏与右栏照常好用（它们就在界面层里）。中间那一屏在这里扮演起始页。
   */
  const laterView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  laterView.setBackgroundColor('#00000000')
  win.contentView.addChildView(laterView)
  laterView.setBounds(controller.getBodyRect())
  await laterView.webContents.loadURL('data:text/html,<body style="margin:0">later</body>')
  await delay(200)
  const laterNames = win.contentView.children.map((v) =>
    v === controller.getChromeView() ? 'chrome' : v === pageView ? 'page' : 'later'
  )
  record(
    'Q3d',
    '还原之后再出现一屏（回起始页那种情形）：它也在界面层之上，正文区那一点归它',
    laterNames.indexOf('chrome') === 0 && laterNames[laterNames.length - 1] === 'later' ? '是' : '否',
    { 次序: laterNames }
  )
  win.contentView.removeChildView(laterView)

  /*
   * Q3e：还原要叫一次「退网页全屏」。
   *
   * 网页里那份全屏（视频右下角那枚键按下去之后的那个）只有网页自己退得掉，
   * 窗口还原而网页还挂着一层全屏，正文区就会停在一块「铺满整屏」的矩形上。
   * 判据是**恰好一次**：还原键在不曾最大化时什么都不该做。
   */
  record(
    'Q3e',
    '还原时叫了一次「退网页全屏」（网页里那份全屏只有网页自己退得掉）',
    leaveFullscreenCalls === 1 ? '是' : '否',
    { 叫了几次: leaveFullscreenCalls }
  )

  // ---- Q4：最大化 → 收起 → 展开 ----
  controller.maximize()
  await delay(120)
  /*
   * 球此刻在界面层里的矩形。界面上报的就是这一份（渲染进程量的是自己文档里的
   * 坐标），主进程要按界面层的原点换算成窗口坐标——最大化时两者差着那一小块
   * 的位置，正是这一档最容易算错的地方。
   */
  const ballInLayer = { x: FLOAT_W - 4 - 40, y: (FLOAT_H - 40) / 2, width: 40, height: 40 }
  controller.setBallRect(ballInLayer)
  controller.collapse()
  await delay(200)

  const collapsed = win.getBounds()
  const ballCentre = {
    x: workArea.x + (workArea.width - FLOAT_W) + ballInLayer.x + ballInLayer.width / 2,
    y: workArea.y + ballInLayer.y + ballInLayer.height / 2
  }
  const collapsedCentre = {
    x: collapsed.x + collapsed.width / 2,
    y: collapsed.y + collapsed.height / 2
  }
  record(
    'Q4a',
    '最大化态下收起：窗口缩成正方形，圆心正落在球心上（球心按界面层的原点换算）',
    collapsed.width === collapsed.height &&
      collapsedCentre.x === ballCentre.x &&
      collapsedCentre.y === ballCentre.y
      ? '是'
      : '否',
    { 收起后: collapsed, 圆心: collapsedCentre, 球心: ballCentre }
  )

  const persistedWhileMax = { width: config.get().window.width, height: config.get().window.height }
  record(
    'Q4b',
    '最大化期间落盘的是那块 16:9，不是铺满工作区的矩形（否则下次启动就是满屏的）',
    persistedWhileMax.width === START.width && persistedWhileMax.height === START.height ? '是' : '否',
    { 配置里: persistedWhileMax, 期望: START, 工作区: { width: workArea.width, height: workArea.height } }
  )

  controller.expand()
  await delay(250)
  const reExpanded = win.getBounds()
  record(
    'Q4c',
    '收起后再展开：回到工作区那块（最大化还在），界面层又缩回右上角',
    rectEq(reExpanded, workArea) &&
      rectEq(controller.getChromeView().getBounds(), {
        x: workArea.width - FLOAT_W,
        y: 0,
        width: FLOAT_W,
        height: FLOAT_H
      }) &&
      controller.isMaximized() === true
      ? '是'
      : '否',
    {
      实测: reExpanded,
      界面层: controller.getChromeView().getBounds(),
      maximized: controller.isMaximized()
    }
  )

  // ---- Q5：最大化时选尺寸预设 ----
  controller.setSize({ preset: 'medium' })
  await delay(150)
  const presetBounds = win.getBounds()
  record(
    'Q5',
    '最大化时选尺寸预设 = 退出最大化，并落到那一档（用户点了要有反应）',
    controller.isMaximized() === false && sizeEq(presetBounds, SIZE_PRESETS.medium) ? '是' : '否',
    { 实测: presetBounds, 预设: SIZE_PRESETS.medium, maximized: controller.isMaximized() }
  )

  // ---- Q6：最大化时拖动窗口 ----
  /*
   * 按下与松开必须在同一个同步块里：拖动每 DRAG_TICK_MS（8ms）挪一次窗口，
   * 而这个窗口此刻停在屏幕外——中间只要有一次滴答，它就会朝着真实光标飞过去，
   * 在屏幕上露一脸。同一轮 JS 里做完，定时器根本没有机会跑。
   */
  const preMax = win.getBounds()
  controller.maximize()
  await delay(120)
  controller.beginDrag()
  const afterBegin = { maximized: controller.isMaximized(), bounds: win.getBounds() }
  controller.endDrag()
  record(
    'Q6',
    '最大化时按下拖动 = 先还原回最大化之前那块，再按光标位移接着拖',
    afterBegin.maximized === false && rectEq(afterBegin.bounds, preMax) ? '是' : '否',
    { 按下后: afterBegin, 期望: preMax }
  )

  controller.destroy()

  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'window-max.json'),
    JSON.stringify(
      {
        origin,
        START,
        workArea,
        maxBounds,
        maxChrome,
        maxBody,
        maxRuntime,
        backBounds,
        backBody,
        backChrome,
        collapsed,
        reExpanded,
        presetBounds,
        persistedWhileMax,
        layoutCalls,
        leaveFullscreenCalls,
        results
      },
      null,
      2
    ),
    'utf8'
  )

  app.exit(0)
})
  /*
   * 出错要立刻退出：本脚本里的窗口停在屏幕外，挂住时屏幕上什么都看不到，
   * 终端也只有一句 UnhandledPromiseRejection，看不出是哪一步。
   */
  .catch((err) => {
    console.error('探针没能跑完：', err)
    app.exit(1)
  })

app.on('window-all-closed', () => app.quit())
