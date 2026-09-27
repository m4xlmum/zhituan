/**
 * 探针：点网页里视频的全屏键，软件窗口跟不跟着最大化。
 *
 * 用户要的是这一条：**点视频的最大化，直接把软件页面也最大化**。它跨了三层——
 * 网页的 requestFullscreen → TabManager 的两个 html-full-screen 事件 →
 * WindowController 的 setMaximized。中间任何一处没接上，表现都是「视频只铺满了
 * 正文那一块，窗口还留着顶栏与右栏」：不报错、不崩，就是不对。
 *
 * 因此这里把**真的** WindowController 与**真的** TabManager 一起起起来
 * （配置写在临时目录，会话用内存分区，绝不碰用户的那一份），
 * 界面的那一页用 spike/preview-preload.js 的假桥喂着，让真窗口走一遍。
 *
 * ## 一条前提：窗口得真的被合成（以及「一问一个进程」这个跑法）
 *
 * 本来是想在一个进程里从头问到尾的。实测不行，而且是这个环境的脾气，不是
 * 产品的问题——失败的样子很能说明问题，值得写下来：
 *
 *   一扇**从未显示过**的窗口（`show: false` 且谁也没 show）：第一趟全屏进出
 *   完全正常；从第二趟起，`requestFullscreen()` 会把
 *   `document.fullscreenElement` 置上，但 enter-html-full-screen 再也不来，
 *   `exitFullscreen()` 之后那个值也退不回去。于是第二问以后的每一问都在量一页
 *   卡住不动的页面，读出来的全是假否。
 *
 * 一路切下来（用 spike/tmp-fs-cycle.js 那类最小用例，一样一样地试）：不是窗口
 * 配置（透明 / 不可缩放 / 无边框都试过），不是 `disableHtmlFullscreenWindowResize`，
 * 不是重排子视图次序，**也不是同一个进程只容得下几趟**——最小的一扇窗连着走
 * 三趟，趟趟都齐。能把第二趟弄坏的是这样两件事，而且都指向同一个前提：
 *   一、在进出全屏的那个回调里 `view.setBounds()` 改页面视图的尺寸
 *       （而产品代码必然要做这一下：窗口尺寸变了，正文矩形就得跟着变，
 *       否则视频停在旧矩形上）；
 *   二、窗口没有被真正合成——藏起来时第二趟就坏，显示之后能撑到第三趟。
 *
 * 于是把跑法改成**一问一个进程**，每支只走它那一问的第一趟：
 *
 *     for s in enter exit ownership restore roundtrip collapse control; do
 *       npx electron spike/fullscreen.js $s
 *     done
 *
 * 加 `--shown`（窗口真的显示出来，位置仍在显示器之外，但最大化那一档会让
 * 应用界面短暂地出现在屏幕上——要跑先跟用户打招呼）则结果干净得多：
 * Q1、Q1b、Q2、Q3、Q4、Q7 全部通过，只剩 Q5 那一处，而那一处的窗口最后落在
 * 屏幕之外，正是上面第二条说的那件事。Q5 的读数也摆明了它是哪一类：窗口还原了、
 * leave 事件也到了，只有网页那一侧的 `fullscreenElement` 没退——我们该做的都做到了。
 *
 * **真机上要确认的两条**（这一环境验不了，已列进交付说明）：
 *   · 连点两次视频全屏键，第二次仍然管用；
 *   · 网页全屏时按还原键，网页那边确实退出了全屏（不留一页「以为自己在全屏」）。
 *
 * 各问如下（Q6 那一问要求跨进程比，注释里写明了）：
 *
 *   Q1 页面进全屏 → 窗口铺满所在显示器的工作区、两栏与地址栏让位、正文占满整窗，
 *      且界面层缩成右上角那一小块。**全程没有谁在探针里直接调 maximize()**——
 *      窗口是被页面的那一串事件推着变的，这才叫接线通了
 *   Q1b 同时界面层缩成右上角那一小块（还原键与球还在，窗口有出口）
 *   Q2 跃变语义：同一页在全屏时再按一次全屏键，不产生新的通知
 *   Q3 退全屏 → 回到进全屏之前那块 16:9（位置与尺寸都回来）
 *   Q4 用户自己按的最大化，再退视频全屏不该被缩回去（autoMaximized 的所有权）
 *   Q5 用户在网页全屏时按还原键 → 网页那边真的退出全屏了
 *      （否则留下一个「网页以为自己在全屏」的窗口，来回打架）
 *   Q6 一趟往返的两个落点；**三趟三支进程**，逐趟比对是否漂
 *   Q7 收起成球时网页全屏也退掉：40×40 的球里不该挂着一个全屏的视频
 *   Q8 对照组：不带 disableHtmlFullscreenWindowResize 的隐藏窗口进全屏，
 *      窗口动不动。**这一问在本机量得出差别，而且正是我们要的理由**——
 *      不带它，Chromium 把窗口铺到整块显示器（1920×1080，连任务栏一起盖），
 *      工作区是 1920×1032，那 48px 就是要接管的原因
 *
 * 窗口摆在哪：起手在所有显示器之外，两档都是。默认那一档从不显示（show 与
 * showInactive 都换成空操作，两层保险）；`--shown` 那一档见上面的说明。
 *
 * 产出：终端一份 [Qn] 报告，spike/out/fullscreen-<scenario>.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, WebContentsView, ipcMain, screen, session } = require('electron')
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
 * 打点。
 *
 * 这套探针里最贵的失败方式是「挂住」——窗口在屏幕外，终端上什么也看不见，
 * 只知道某个 await 再也没回来。因此每一次涉及网页全屏的动作前后各打一句：
 * 下一次真挂住时，最后一行就是卡在哪一步。
 */
const step = (what) => console.log(`  · ${what}`)

/** 把要用的几份 TS 各打成一包再 require。理由与 window-max.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-fs-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'windowController.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'tabManager.ts'),
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
    external: ['electron'],
    logLevel: 'silent'
  })
  const at = (...p) => path.join(outdir, ...p)
  return {
    controller: require(at('main', 'services', 'windowController.cjs')),
    tabs: require(at('main', 'services', 'tabManager.cjs')),
    configStore: require(at('main', 'services', 'configStore.cjs')),
    registry: require(at('main', 'services', 'windowRegistry.cjs')),
    constants: require(at('shared', 'constants.cjs'))
  }
}

const rectEq = (a, b) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * 一页「带视频的网页」。
 *
 * 真的视频播放器那枚全屏键做的也就是 `element.requestFullscreen()`，
 * 因此这里放一个方块替身：探针要验的是这条 API 走到窗口那一侧之后的事，
 * 不是播放器本身。写成本地文件再 file:// 打开，而不是 data: URL——
 * data: 是不透明源，全屏要不要放行是另一件与本题无关的事。
 */
function writePage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-fs-page-'))
  const file = path.join(dir, 'player.html')
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>探针页面</title>
<body style="margin:0;background:#0b1220">
  <div id="player" style="width:320px;height:180px;background:#2a7d6f"></div>
  <script>
    /*
     * 视频全屏键的替身。
     *
     * **不把 Promise 返回给主进程**：隐藏窗口里那两个 Promise 会一直悬着
     * （exitFullscreen 的那个尤其——它要等一次窗口级的全屏恢复被确认，
     * 而没人显示过的窗口永远不确认），而 executeJavaScript 会等返回值里的
     * Promise，于是「退出全屏」这一步每次都卡死在那里。
     * 失败原因记在 window.zhituanErr 里，要看的时候再读，一样查得出来。
     */
    window.zhituanErr = null
    window.zhituanPlay = () => {
      window.zhituanErr = null
      document.getElementById('player').requestFullscreen().catch((e) => {
        window.zhituanErr = String(e)
      })
    }
    window.zhituanStop = () => {
      window.zhituanErr = null
      document.exitFullscreen().catch((e) => {
        window.zhituanErr = String(e)
      })
    }
  </script>
</body>`,
    'utf8'
  )
  return pathToFileURL(file).toString()
}

/**
 * 让探针页面做一件事，带打点与超时。
 *
 * 退出全屏那一下挂住过：Chromium 正在把窗口从全屏态还回来时，我们若同时在改
 * 窗口，两边会僵在那里——整个主进程一起停住，终端上只剩「没跑完」四个字。
 * 因此每一次页面动作都配一句打点与一个上限：超时就算它没做到，
 * 报告里那一问写成「否」，而不是把探针吊死。
 */
async function runInPage(page, code, label, ms = 4000) {
  step(`${label}：${code}`)
  const r = await Promise.race([
    page.executeJavaScript(code, true).then(
      () => 'ok',
      (err) => `err:${err?.message ?? err}`
    ),
    new Promise((res) => setTimeout(() => res('timeout'), ms))
  ])
  if (r !== 'ok') step(`${label} → ${r}`)
  return r === 'ok'
}

/**
 * 等一件事成真，最多等 ms 毫秒。
 *
 * 全屏的进出是异步的，而在无头窗口里它比真机慢——「我们叫网页退全屏」之后
 * 需要等多少毫秒才开始见效，没有可靠的数字。因此不猜一个固定延迟，
 * 而是轮询到它真的变了为止；等不到就是没做到，报告里照实写成「否」。
 */
async function waitUntil(probe, ms = 3000, every = 120) {
  const until = Date.now() + ms
  for (;;) {
    if (await probe()) return true
    if (Date.now() >= until) return false
    await delay(every)
  }
}

/** 页面此刻是否停在全屏（读的是网页那一侧的事实，不是我们的记账）。同样带超时 */
async function isPageFullscreen(page) {
  const r = await Promise.race([
    page.executeJavaScript('document.fullscreenElement !== null'),
    new Promise((res) => setTimeout(() => res('timeout'), 4000))
  ])
  return r === 'timeout' ? '读不到（超时）' : r
}

/** 页面自己在全屏时，等它进 / 等它退；返回是否等到 */
const waitPageIn = (page) => waitUntil(async () => (await isPageFullscreen(page)) === true)
const waitPageOut = (page) => waitUntil(async () => (await isPageFullscreen(page)) === false)

// ---------------------------------------------------------------- 场子

/**
 * 起一扇真窗口、一张真标签页，接到真 WindowController 上。
 *
 * 接线与 index.ts 里那份一字不差地对齐，连「controller 与 tabs 互相引用」
 * 这个死结的解法都一样（用可变的 tabsRef 打破声明顺序）。差别只有这里不广播。
 */
async function stage(scenario, mods) {
  const { WindowController } = mods.controller
  const { TabManager } = mods.tabs
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry
  const { TOP_BAR_H, RAIL_W, FLOAT_W, FLOAT_H } = mods.constants

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-fs-config-'))
  const config = new ConfigStore(configDir)

  const displays = screen.getAllDisplays()
  const origin = {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 1200,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 900
  }
  const START = { width: 1280, height: 720 }
  config.set((c) => ({ ...c, window: { ...c.window, x: origin.x, y: origin.y, ...START } }))

  // 内存会话：不给用户数据目录里留下任何东西。分区带上情景名，
  // 免得同一台机器上同时跑着的两支探针共用一份会话状态
  const ses = session.fromPartition(`zhituan-fullscreen-probe-${scenario}`)

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
  /** 窗口那一侧收到的每一次网页全屏通知，按顺序记下来（Q2 要问的就是它的条数） */
  const notifyLog = []
  let tabsRef = null

  const controller = new WindowController({
    config,
    registry,
    preloadPath: path.join(__dirname, 'preview-preload.js'),
    rendererUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).toString(),
    onVisibilityChange: () => {},
    onLayoutChange: () => tabsRef?.layoutAll(),
    onStateChange: () => {},
    onLeavePageFullscreen: () => tabsRef?.exitPageFullscreen()
  })

  const tabs = new TabManager({
    getWindow: () => controller.getWindow(),
    getBodyRect: () => controller.getBodyRect(),
    getSession: () => ses,
    getPreloadPath: () => path.join(__dirname, 'preview-preload.js'),
    getConfig: () => config.get(),
    onStateChange: () => {},
    onNavigated: () => {},
    onViewAdded: () => controller.syncChromeOrder(true),
    onPageFullscreen: (active) => {
      notifyLog.push(active)
      controller.setPageFullscreen(active)
    }
  })
  tabsRef = tabs

  controller.create()
  const win = controller.getWindow()
  if (!SHOWN) {
    win.show = () => {}
    win.showInactive = () => {}
  }

  const pageUrl = writePage()
  tabs.create({ url: pageUrl, activate: true })
  if (SHOWN) win.showInactive()
  // 页面加载完再动手：没加载完的文档里 requestFullscreen 无从谈起
  await delay(900)

  /*
   * 探针页面的 webContents。
   *
   * TabManager 不对外暴露视图（真实程序里也没有这个需要），而这里场上只有
   * 界面层与一张标签页视图，于是从窗口的子视图里把「不是界面层的那一个」认出来。
   */
  const page = win.contentView.children.find((v) => v !== controller.getChromeView())?.webContents
  if (!page) throw new Error('没拿到探针页面的 webContents')
  console.log(`PAGE ${JSON.stringify({ fullscreenEnabled: await page.executeJavaScript('document.fullscreenEnabled') })}`)

  const workArea = screen.getDisplayMatching(win.getBounds()).workArea
  const beforeFullscreen = win.getBounds()

  return {
    controller,
    tabs,
    win,
    page,
    notifyLog,
    workArea,
    beforeFullscreen,
    origin,
    START,
    shape: { TOP_BAR_H, RAIL_W, FLOAT_W, FLOAT_H }
  }
}

// ---------------------------------------------------------------- 各问

const SCENARIOS = {
  /** Q1 / Q1b / Q2：进全屏这一路，外加跃变语义 */
  async enter(mods) {
    const s = await stage('enter', mods)
    const { win, page, controller, workArea, beforeFullscreen, shape } = s

    step('页面进全屏')
    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    // 等窗口真的铺上去：事件是异步的，读早了只会读到进全屏前那一格
    const reached = await waitUntil(() => Promise.resolve(rectEq(win.getBounds(), workArea)), 3000)
    if (!reached) step('窗口没在 3s 内铺满工作区，下面按当下实测记')

    const maxBounds = win.getBounds()
    const maxRuntime = controller.getRuntime()
    const maxBody = controller.getBodyRect()
    record(
      'Q1',
      '页面进全屏 → 窗口铺满所在显示器的工作区，两栏与地址栏让位、正文占满整窗（全过程没有谁直接调 maximize()）',
      rectEq(maxBounds, workArea) &&
        maxRuntime.maximized === true &&
        maxRuntime.railVisible === false &&
        rectEq(maxBody, { x: 0, y: 0, width: workArea.width, height: workArea.height })
        ? '是'
        : '否',
      { 进全屏前: beforeFullscreen, 实测: maxBounds, 工作区: workArea, runtime: maxRuntime, 正文矩形: maxBody }
    )

    const chrome = controller.getChromeView().getBounds()
    record(
      'Q1b',
      '同时界面层缩成右上角那一小块（还原键与球还在，窗口有出口）',
      rectEq(chrome, { x: workArea.width - shape.FLOAT_W, y: 0, width: shape.FLOAT_W, height: shape.FLOAT_H })
        ? '是'
        : '否',
      { 界面层: chrome }
    )

    /*
     * Q2 量到的是什么，说清楚：页面**已经**在全屏时再按一次全屏键，Chromium
     * 大概率连事件都不再发（元素本来就全屏着），因此这一问在真机上多半是
     * 「没有新通知」——它守着的是「不许因为一次重复的按键就再掀动一次窗口」，
     * 而不足以证明集合的判据在真重入下也对。真要造出重入得再开一个页面，
     * 而这一问按「一问一个进程」跑，页面只此一张。因此如实记下网页当时是不是
     * 真的在全屏。
     */
    const before = s.notifyLog.length
    await runInPage(page, 'window.zhituanPlay()', '再按一次全屏键')
    await delay(250)
    const stillInFs = await isPageFullscreen(page)
    record(
      'Q2',
      '同一页在全屏时再按一次全屏键：不产生新的通知（不重复掀动窗口）',
      s.notifyLog.length === before && s.notifyLog.length >= 1 && s.notifyLog[0] === true ? '是' : '否',
      { 通知序列: s.notifyLog, 重按之后新增: s.notifyLog.length - before, 网页当时在全屏: stillInFs }
    )
    return s
  },

  /** Q3：退全屏这一路 */
  async exit(mods) {
    const s = await stage('exit', mods)
    const { controller, win, page, workArea, beforeFullscreen, shape } = s

    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    await waitUntil(() => Promise.resolve(rectEq(win.getBounds(), workArea)), 3000)
    await runInPage(page, 'window.zhituanStop()', '退全屏')
    const back = await waitUntil(() => Promise.resolve(rectEq(win.getBounds(), beforeFullscreen)), 3000)

    const backBounds = win.getBounds()
    const backBody = controller.getBodyRect()
    record(
      'Q3',
      '退全屏 → 回到进全屏之前那块 16:9（位置与尺寸都回来），正文让回两条栏',
      back &&
        controller.getRuntime().maximized === false &&
        rectEq(backBounds, beforeFullscreen) &&
        rectEq(backBody, {
          x: 0,
          y: shape.TOP_BAR_H,
          width: s.START.width - shape.RAIL_W,
          height: s.START.height - shape.TOP_BAR_H
        })
        ? '是'
        : '否',
      { 实测: backBounds, 期望: beforeFullscreen, 正文矩形: backBody, 通知序列: s.notifyLog }
    )
    return s
  },

  /** Q4：所有权——用户自己按的最大化，不该被「退视频全屏」缩回去 */
  async ownership(mods) {
    const s = await stage('ownership', mods)
    const { controller, win, page } = s

    controller.maximize()
    await delay(200)
    const manualMax = win.getBounds()

    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    const entered = await waitPageIn(page)
    if (!entered) step('网页没进到全屏，这一问的结论要打折看')
    const stillManual = win.getBounds()

    await runInPage(page, 'window.zhituanStop()', '退全屏')
    await waitPageOut(page)
    const afterLeave = win.getBounds()

    record(
      'Q4',
      '用户自己按的最大化：看视频进出全屏之后窗口仍是最大化的（autoMaximized 的所有权）',
      entered && rectEq(stillManual, manualMax) && rectEq(afterLeave, manualMax) && controller.isMaximized() === true
        ? '是'
        : '否',
      { 自己最大化: manualMax, 进视频全屏后: stillManual, 退视频全屏后: afterLeave, 网页真的进了全屏: entered }
    )
    return s
  },

  /** Q5：网页全屏时按还原键，网页那边也要退出来 */
  async restore(mods) {
    const s = await stage('restore', mods)
    const { controller, win, page, beforeFullscreen } = s

    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    const entered = await waitPageIn(page)
    if (!entered) step('网页没进到全屏，这一问的结论要打折看')

    const notifyBefore = s.notifyLog.length
    controller.restore()
    /*
     * 退出是异步的：executeJavaScript 过去之后要等 Chromium 那边真的把全屏
     * 收掉。无头窗口里这一步比真机慢，等多久没有可靠数字，因此轮询而不是睡
     * 固定时长——睡短了会把「已经退了但还没反映出来」记成「没退」，那是假否。
     */
    const pageLeft = await waitPageOut(page)
    const afterRestore = win.getBounds()
    /*
     * 这一问要分开记三样，因为它们在失败时指向完全不同的东西：
     *   窗口还原了没有（我们的账）
     *   leave 事件到了没有（我们那次 exitFullscreen 有没有被 Chromium 接住）
     *   网页那一侧的 fullscreenElement 退干净了没有（Chromium 自己的账）
     * 本机实测是「前两样都成、第三样不成」——也就是我们该做的都做到了，
     * 剩下那一格卡在窗口当时落在屏幕外（见文件头）。只记一个总的「否」，
     * 读的人会以为是我们没接线。
     */
    const leaveArrived = s.notifyLog.length > notifyBefore && s.notifyLog[s.notifyLog.length - 1] === false
    if (!pageLeft && leaveArrived) {
      step('窗口还原了、leave 事件也到了，只有网页那一侧的 fullscreenElement 没退——见文件头那段')
    }
    record(
      'Q5',
      '网页全屏时按还原键：窗口回到 16:9，且网页那边真的退出了全屏（不留一个「网页以为在全屏」的窗口）',
      pageLeft && controller.isMaximized() === false && rectEq(afterRestore, beforeFullscreen) ? '是' : '否',
      {
        窗口还原: { 实测: afterRestore, 期望: beforeFullscreen, 一致: rectEq(afterRestore, beforeFullscreen) },
        我们的账清干净了: controller.isMaximized() === false,
        leave事件到了: leaveArrived,
        网页退净: pageLeft,
        通知序列: s.notifyLog,
        网页最后的报错: await page.executeJavaScript('window.zhituanErr').catch(() => '读不到')
      }
    )
    return s
  },

  /**
   * Q6：一趟往返的两个落点。
   *
   * 「来回三趟不漂」在这一问里拆成三支进程各走一趟，由跑探针的人逐趟比对
   * （见文件头那段：同一进程里的第二趟起，这个环境就走不完了）。
   * 因此这里只记一趟的两个落点，三支进程的 JSON 摆在一起看才是完整的 Q6。
   */
  async roundtrip(mods) {
    const s = await stage('roundtrip', mods)
    const { win, page, workArea, beforeFullscreen } = s

    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    const up = await waitUntil(() => Promise.resolve(rectEq(win.getBounds(), workArea)), 3000)
    const atMax = win.getBounds()

    await runInPage(page, 'window.zhituanStop()', '退全屏')
    const down = await waitUntil(() => Promise.resolve(rectEq(win.getBounds(), beforeFullscreen)), 3000)
    const atBack = win.getBounds()

    record(
      'Q6',
      '一趟往返的两个落点：铺满时正好是工作区，还原时正好是原来那块 16:9（本支只走一趟，三支进程的读数摆在一起比）',
      up && down ? '是' : '否',
      { 铺满: atMax, 还原: atBack, 期望工作区: workArea, 期望还原: beforeFullscreen, 落稳: { up, down } }
    )
    return s
  },

  /** Q7：收起成球时，网页那份全屏也退掉 */
  async collapse(mods) {
    const s = await stage('collapse', mods)
    const { controller, win, page } = s

    await runInPage(page, 'window.zhituanPlay()', '进全屏')
    const beforeCollapse = await waitPageIn(page)
    if (!beforeCollapse) step('网页没进到全屏，这一问的结论要打折看')

    controller.collapse()
    // 收起之后要等网页那边退完；球本身是同步摆好的，因此判据取网页那一侧
    const goneAfterCollapse = await waitPageOut(page)
    const ballBounds = win.getBounds()

    record(
      'Q7',
      '收起成球时网页全屏一起退掉：40×40 的球里不该挂着一个「网页以为在全屏」的视频',
      beforeCollapse && goneAfterCollapse && ballBounds.width === ballBounds.height ? '是' : '否',
      { 收起前网页在全屏: beforeCollapse, 收起后网页退净: goneAfterCollapse, 窗口: ballBounds }
    )
    return s
  },

  /**
   * Q8：对照组（不带 disableHtmlFullscreenWindowResize）。
   *
   * 这一支里没有 WindowController——量的是「Chromium 自己会不会动这扇窗」，
   * 因此窗口就是裸的一扇。本机上它**量得出差别，而且差别正是我们要接管的原因**：
   * 不带开关时 Chromium 把窗口铺到整块显示器（连任务栏一起盖住），
   * 而我们要的是工作区。带上开关的那一遍在 spike/tmp-fs-cycle.js 里量过，
   * 窗口一动不动。
   */
  async control() {
    const displays = screen.getAllDisplays()
    const origin = {
      x: Math.min(...displays.map((d) => d.bounds.x)) - 1200,
      y: Math.min(...displays.map((d) => d.bounds.y)) - 900
    }
    const win = new BaseWindow({ show: false, x: origin.x, y: origin.y, width: 600, height: 400 })
    if (!SHOWN) {
      win.show = () => {}
      win.showInactive = () => {}
    }
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 600, height: 400 })
    await view.webContents.loadURL(writePage())
    if (SHOWN) win.showInactive()
    await delay(600)

    const workArea = screen.getDisplayMatching(win.getBounds()).workArea
    const before = win.getBounds()
    await view.webContents.executeJavaScript('window.zhituanPlay()', true).catch(() => {})
    await delay(700)
    const after = win.getBounds()
    const inFs = await isPageFullscreen(view.webContents)

    record(
      'Q8',
      '对照组（不带那个开关）：隐藏窗口进全屏时窗口动不动',
      rectEq(before, after) ? '量不出差别' : '量得出差别',
      { 前: before, 后: after, 工作区: workArea, 页面在全屏: inFs }
    )
    win.destroy()
    return null
  }
}

// ---------------------------------------------------------------- 跑

const SCENARIO = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? ''
/*
 * 窗口显不显示。两档，各有各的用处，**默认是藏起来那一档**。
 *
 *   默认（藏）：窗口起手在屏幕之外，show / showInactive 换成空操作。
 *              用户明确要求过改代码的过程中不要弹窗，这一档任何时候都能跑，
 *              屏幕上不会出现任何东西。
 *   --shown：  窗口真的显示出来，位置仍在所有显示器之外。它更接近真机
 *              （见上面「窗口得真的被合成」那段），代价是**最大化那一档会把
 *              窗口摆到工作区上**——于是应用界面会短暂地出现在屏幕上。
 *              要跑它请先跟用户打招呼。
 */
const SHOWN = process.argv.includes('--shown')

app.whenReady().then(async () => {
  if (!SCENARIOS[SCENARIO]) {
    console.log(`给一支：${Object.keys(SCENARIOS).join(' / ')}`)
    console.log('（一问一个进程，见本文件头部那段说明）')
    app.exit(1)
    return
  }

  let s = null
  if (SCENARIO !== 'control') {
    const mods = await buildModules()
    s = await SCENARIOS[SCENARIO](mods)
  } else {
    s = await SCENARIOS.control()
  }

  // 先关标签页再关窗口：视图的 webContents 不会随窗口一起销毁（必然泄漏）
  if (s) {
    s.tabs.destroyAll()
    s.controller.destroy()
  }

  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, `fullscreen-${SCENARIO}.json`),
    JSON.stringify({ scenario: SCENARIO, ...(s ? { workArea: s.workArea, beforeFullscreen: s.beforeFullscreen, notifyLog: s.notifyLog } : {}), results }, null, 2),
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
