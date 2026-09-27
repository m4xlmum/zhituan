/**
 * 探针：起始页与系统设置到底还是不是「标签页」。
 *
 * 用户报的是这一条：**这两屏和网页混在一条标签条里**——各占一格、各带一枚 ✕，
 * 点进设置之后想出来只能去点标签条上那一格，而关掉最后一个网页标签会在正文区
 * 留下一块透出桌面的空档。这一版把它们从「标签」改成「屏」：各有各的入口
 * （起始页与设置是顶栏最左并排的那两颗键），不进标签条，
 * 再点一次原路返回。
 *
 * 因此这里起的是**真的** TabManager（配置写在临时目录、会话用内存分区，
 * 绝不碰用户的那一份），接线与 src/main/index.ts 对齐。要盯住的是几条不变量：
 *
 * - 标签条的内容（`list()`）里**没有**这两屏，停在其中一屏上时也没有哪一格是高亮的
 *   （`getActiveId()` 为 null，`getScreen()` 说明停在哪）；
 * - 两屏各只建一份视图、常驻不关，`openHome()` / `openSettings()` 重复调用不叠视图；
 * - `leaveScreen()` 回到进来之前那张网页，那张没了就落回起始页；
 * - 正文区**永远有东西**：关掉最后一张网页标签之后落到起始页，而不是空着；
 * - `goto(null, …)`（停在自家屏上时地址栏回车 / 点书签 / 点历史）与
 *   `goto(自家屏的 id, …)` 都新开一张网页标签——自家那两屏带着 preload，
 *   绝不能在里面装访客内容；
 * - `+` 新建标签页开的是配置里那一格（`browser.newTabUrl`），空值回落 google.com。
 *
 * ## 怎么问「哪个视图在场」
 *
 * `window.contentView.children` 是公开 API，逐个 `webContents.getURL()` 就知道
 * 场上有哪几份文档；「画没画出来」用 `View.getVisible()`——原生视图自己的显隐位，
 * 与窗口显不显示无关（隐藏窗口里读渲染进程的 document.visibilityState 读不准，
 * 见 docs/spike-findings.md 的 Q20）。
 *
 * 有一处是**故意读私表**的：`tabs.tabs`（视图总表）与 `entry.kind`。
 * 自家那两屏的 id 对外刻意不给（界面拿到它只会想切它、关它），而这一问要验的
 * 正是「自家屏的 id 传给 goto 会怎样」，只好从里面把那个 id 取出来。
 * 这是探针的特权，产品代码那条路上没有这条通道。
 *
 * 窗口摆在所有显示器之外、并且从不显示（show / showInactive 换成空操作）：
 * 用户说过改代码时不要弹窗。这一问与窗口显不显示无关，这正是它的前提。
 *
 * 跑法：npx electron spike/own-screens.js
 * 产出：终端一份 [Qn] 报告、spike/out/own-screens.json（有一问没过就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, screen, session, ipcMain } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

const step = (what) => console.log(`  · ${what}`)

/**
 * 每份 webContents 第一发主框架导航的地址，按 webContents.id 记着。
 *
 * 挂在 webContents 出生那一刻，而不是等 `tabs.create()` 返回之后——
 * `create()` 里是同步 loadURL 的，等它返回再挂监听，头一发
 * `did-start-navigation` 已经过去了。真跑下来漏掉头一发就会量到**重定向
 * 之后**的那一发（douyin.com 量成 www.douyin.com），或者什么都量不到
 * （google.com 只有那一发，四秒后 getURL() 还是空串）。
 *
 * 记的是「交给 Chromium 的那个地址」，不是落定之后的地址：这一问要核的是
 * 那颗 + 交出去的是什么，不是网络能不能到。
 */
const firstNav = new Map()
app.on('web-contents-created', (_event, wc) => {
  wc.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
    // 主框架的导航才算数；about:blank 是视图的初始状态，不是这一问要看的
    if (!isMainFrame || url === 'about:blank') return
    if (!firstNav.has(wc.id)) firstNav.set(wc.id, url)
  })
})

/** 把要用的几份 TS 各打成一包再 require。理由与 window-max.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-screens-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'windowController.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'tabManager.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'configStore.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'windowRegistry.ts')
    ],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outdir,
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
    registry: require(at('main', 'services', 'windowRegistry.cjs'))
  }
}

/** 一页本地网页，tag 用来在场上的几份文档里认出它 */
function writePage(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-screen-${tag}-`))
  const file = path.join(dir, 'page.html')
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>${tag}</title><body style="margin:0">${tag}</body>`,
    'utf8'
  )
  return pathToFileURL(file).toString()
}

/** 等一件事成真；自家那两屏是本地文档，快慢不定，不猜固定延迟 */
async function waitUntil(probe, ms = 4000, every = 100) {
  const until = Date.now() + ms
  for (;;) {
    if (await probe()) return true
    if (Date.now() >= until) return false
    await delay(every)
  }
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
    clearTimeout(watchdog)
    app.exit(1)
  }
})

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场——看门狗把它收了')
  app.exit(1)
}, 180_000)

async function main() {
  const mods = await buildModules()
  const { WindowController } = mods.controller
  const { TabManager } = mods.tabs
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry

  const config = new ConfigStore(fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-screens-config-')))
  const displays = screen.getAllDisplays()
  config.set((c) => ({
    ...c,
    window: {
      ...c.window,
      x: Math.min(...displays.map((d) => d.bounds.x)) - 1200,
      y: Math.min(...displays.map((d) => d.bounds.y)) - 900,
      width: 900,
      height: 520
    }
  }))

  const ses = session.fromPartition('zhituan-screens-probe')
  // 自家那两屏带着 preview-preload 进来（它们的真身就是界面那两个文档），
  // 那份假桥要问主进程要一组「预览参数」，不问就会在渲染进程里干等
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

  let tabsRef = null
  const controller = new WindowController({
    config,
    registry: new WindowRegistry(),
    preloadPath: path.join(__dirname, 'preview-preload.js'),
    rendererUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).toString(),
    onVisibilityChange: (visible) => {
      tabsRef?.setBodyVisible(visible, config.get().stealth.muteMediaOnCollapse)
    },
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
    onPageFullscreen: (active) => controller.setPageFullscreen(active)
  })
  tabsRef = tabs

  controller.create()
  const win = controller.getWindow()
  win.show = () => {}
  win.showInactive = () => {}

  // ------------------------------------------------------------ 认视图
  const chromeView = controller.getChromeView()
  const pageViews = () => win.contentView.children.filter((v) => v !== chromeView)
  const urlsOf = () => pageViews().map((v) => v.webContents.getURL())
  const viewsOf = (needle) =>
    pageViews().filter((v) => v.webContents.getURL().includes(needle))
  const oneView = (needle) => viewsOf(needle)[0] ?? null
  const visibleOf = (view) => {
    try {
      return view ? view.getVisible() : null
    } catch {
      return null
    }
  }
  /** 场上各视图的显隐，报错时给 null（视图可能正在销毁） */
  const visibles = () =>
    pageViews().map((v) => {
      const url = v.webContents.getURL().split('/').pop()
      return `${url}=${String(visibleOf(v))}`
    })
  /** 故意读私表：自家那两屏的 id 对外不给，见文件头 */
  const ownIdOf = (kind) => {
    for (const [id, entry] of tabs.tabs) if (entry.kind === kind) return id
    return null
  }
  const kindOf = (id) => tabs.tabs.get(id)?.kind ?? null
  const wcOf = (id) => tabs.tabs.get(id)?.view.webContents ?? null

  const finish = (code) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, 'own-screens.json')
    fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
    console.log(`WROTE ${out}`)
    const bad = results.filter((r) => r.verdict !== '是')
    console.log(`\n${results.length - bad.length}/${results.length} 通过`)
    for (const r of bad) console.log(`  未通过 ${r.id}：${r.question}`)
    clearTimeout(watchdog)
    try {
      controller.destroy()
    } catch {
      // 已经在销毁了
    }
    app.exit(code)
  }

  // ------------------------------------------------------------ Q0 前提
  const pageA = writePage('A')
  const pageB = writePage('B')
  const pageC = writePage('C')
  const pageD = writePage('D')

  step('先开两张网页（后面各问的底色）')
  const aId = tabs.create({ url: pageA, activate: true })
  await delay(300)
  const bId = tabs.create({ url: pageB, activate: true })
  const loaded = await waitUntil(
    () =>
      viewsOf('zhituan-screen-A-').length === 1 &&
      viewsOf('zhituan-screen-B-').length === 1 &&
      tabs.list().length === 2
  )
  record(
    'Q0',
    '前提：两张网页都开出来了，当前是后开的那一张',
    loaded && tabs.getActiveId() === bId && tabs.getScreen() === null ? '是' : '否',
    { 标签条: tabs.list().map((t) => t.url), 当前: tabs.getActiveId(), 场上的文档: urlsOf() }
  )
  if (!loaded) {
    finish(1)
    return
  }

  // ------------------------------------------------------------ Q1 进起始页
  step('进起始页')
  tabs.openHome()
  const homeUp = await waitUntil(() => oneView('home.html') !== null)
  await delay(200)
  const snapHome = tabs.snapshot()
  const homeView = oneView('home.html')
  record(
    'Q1',
    '进起始页之后：它不在标签条里、没有哪一格是高亮的、场上正好一份起始页视图且只有它画着',
    snapHome.tabs.length === 2 &&
      snapHome.activeTabId === null &&
      snapHome.screen === 'home' &&
      viewsOf('home.html').length === 1 &&
      homeUp &&
      visibleOf(homeView) === true &&
      viewsOf('zhituan-screen-').every((v) => visibleOf(v) === false)
      ? '是'
      : '否',
    {
      标签条: snapHome.tabs.length,
      activeTabId: snapHome.activeTabId,
      screen: snapHome.screen,
      场上的文档: urlsOf(),
      显隐: visibles()
    }
  )

  // ------------------------------------------------------------ Q2 进设置
  step('进系统设置')
  tabs.openSettings()
  const settingsUp = await waitUntil(() => oneView('settings.html') !== null)
  await delay(200)
  const snapSettings = tabs.snapshot()
  const settingsView = oneView('settings.html')
  record(
    'Q2',
    '进设置之后：标签条还是那两张网页、没有哪一格高亮、画着的是设置那一份文档',
    settingsUp &&
      snapSettings.tabs.length === 2 &&
      snapSettings.activeTabId === null &&
      snapSettings.screen === 'settings' &&
      viewsOf('settings.html').length === 1 &&
      visibleOf(settingsView) === true &&
      visibleOf(homeView) === false
      ? '是'
      : '否',
    { 标签条: snapSettings.tabs.length, screen: snapSettings.screen, 显隐: visibles() }
  )

  /*
   * 停在自家屏上时，快照里还得记着「刚才那张网页」。
   *
   * 顶栏那个地址栏开关靠它才不跟着写成屏名（用户报的毛病：切到起始页 / 设置之后，
   * 那一格写起了「起始页」「系统设置」，读起来像顶栏上多了一个叫「系统设置」的标签页）。
   * 这条事实**唯一的主人**在主进程：界面拿不到它，就只能自己攒一份「上一次是什么」的
   * 副本，而那正是这一版要避免的东西（状态只有一份，界面只是它的投影）。
   *
   * 与 Q4 是一对：那一问验的是「原路返回回到谁」，这一问验的是「同一份记忆也有外发的路」。
   */
  record(
    'Q2b',
    '停在自家那两屏上时，快照里仍记着刚才那张网页（顶栏那个开关靠它才不跟着变成屏名）',
    snapHome.lastTabId === bId && snapSettings.lastTabId === bId ? '是' : '否',
    { 起始页上的: snapHome.lastTabId, 设置上的: snapSettings.lastTabId, 刚才那张: bId }
  )

  // ------------------------------------------------------------ Q3 不叠视图
  step('再点一次「设置」')
  const settingsWcId = settingsView.webContents.id
  tabs.openSettings()
  await delay(400)
  record(
    'Q3',
    '自家那两屏各只建一份视图：重复进入不叠出第二份',
    viewsOf('settings.html').length === 1 &&
      oneView('settings.html').webContents.id === settingsWcId &&
      viewsOf('home.html').length === 1
      ? '是'
      : '否',
    { 设置视图: viewsOf('settings.html').length, 起始页视图: viewsOf('home.html').length }
  )

  // ------------------------------------------------------------ Q4 原路返回
  step('切到 A（记下它），进起始页，再点一次那颗键')
  tabs.activate(aId)
  await delay(200)
  tabs.openHome()
  await delay(300)
  tabs.leaveScreen()
  await delay(300)
  const backToA = { 当前: tabs.getActiveId(), screen: tabs.getScreen() }

  step('切到 B，进设置，再点一次那一格')
  tabs.activate(bId)
  await delay(200)
  tabs.openSettings()
  await delay(300)
  tabs.leaveScreen()
  await delay(300)
  const backToB = { 当前: tabs.getActiveId(), screen: tabs.getScreen() }
  record(
    'Q4',
    '原路返回：回到进来之前那张网页（两次进出都对上，不是「最后一张」的巧合）',
    backToA.当前 === aId && backToA.screen === null && backToB.当前 === bId && backToB.screen === null
      ? '是'
      : '否',
    { 从起始页返回: backToA, 从设置返回: backToB, A: aId, B: bId }
  )

  // -------------------------------------------- Q6 停在设置上关掉一张网页
  step('停在设置上，关掉另一张网页标签')
  tabs.activate(bId)
  await delay(200)
  tabs.openSettings()
  await delay(300)
  let closeThrew = null
  try {
    tabs.close(aId)
  } catch (err) {
    closeThrew = String(err?.message ?? err)
  }
  await delay(300)
  const afterClose = tabs.snapshot()
  record(
    'Q6',
    '停在设置上关掉一张网页标签：不崩、仍然停在设置上、标签条少一格',
    closeThrew === null &&
      afterClose.screen === 'settings' &&
      afterClose.activeTabId === null &&
      afterClose.tabs.length === 1
      ? '是'
      : '否',
    { 抛没抛: closeThrew, screen: afterClose.screen, 标签条: afterClose.tabs.length }
  )

  // ------------------------------------------------ Q5 该回的那张没了
  step('关掉刚看过的那张网页，再原路返回')
  tabs.close(bId)
  await delay(300)
  tabs.leaveScreen()
  await delay(400)
  const fellBack = tabs.snapshot()
  record(
    'Q5',
    '「原路返回」要回的那张已经不在了：落回起始页，而不是空着',
    fellBack.screen === 'home' &&
      fellBack.activeTabId === null &&
      fellBack.tabs.length === 0 &&
      visibleOf(oneView('home.html')) === true
      ? '是'
      : '否',
    { screen: fellBack.screen, 标签条: fellBack.tabs.length, 显隐: visibles() }
  )

  // ------------------------------------------------ Q7 关掉最后一张网页
  step('开一张网页，再把它关掉（正文区不能空着）')
  const cId = tabs.create({ url: pageC, activate: true })
  await delay(500)
  const beforeLast = tabs.snapshot().screen
  tabs.close(cId)
  await delay(500)
  const afterLast = tabs.snapshot()
  record(
    'Q7',
    '关掉最后一张网页标签：正文区落到起始页（透明窗口里空着就是一块透出桌面的空档）',
    beforeLast === null &&
      afterLast.screen === 'home' &&
      afterLast.tabs.length === 0 &&
      visibleOf(oneView('home.html')) === true
      ? '是'
      : '否',
    { 关之前: beforeLast, 关之后: afterLast.screen, 标签条: afterLast.tabs.length, 显隐: visibles() }
  )

  // ------------------------------------ Q8 goto(null) / goto(自家屏)
  step('goto(null, C) —— 停在起始页上按地址栏回车')
  tabs.goto(null, pageC)
  await delay(600)
  const afterNull = tabs.snapshot()
  const nullTab = afterNull.tabs[afterNull.tabs.length - 1]
  record(
    'Q8a',
    '停在自家屏上时打开一个地址：新开一张网页标签并切过去（而不是静默无反应）',
    afterNull.tabs.length === 1 &&
      nullTab?.url.startsWith('file:') &&
      nullTab.url.includes('zhituan-screen-C-') &&
      afterNull.activeTabId === nullTab.id &&
      afterNull.screen === null &&
      kindOf(nullTab.id) === 'guest'
      ? '是'
      : '否',
    { 标签条: afterNull.tabs.map((t) => t.url), 当前: afterNull.activeTabId, screen: afterNull.screen }
  )

  const homeOwnId = ownIdOf('home')
  step('goto(起始页的 id, D) —— 把自家屏的 id 递给导航')
  tabs.goto(homeOwnId, pageD)
  await delay(600)
  const afterOwn = tabs.snapshot()
  const ownTab = afterOwn.tabs[afterOwn.tabs.length - 1]
  record(
    'Q8b',
    '拿自家那一屏的 id 去导航：一样新开一张网页标签（自家屏带着 preload，不能装访客内容）',
    homeOwnId !== null &&
      afterOwn.tabs.length === 2 &&
      ownTab?.url.includes('zhituan-screen-D-') &&
      afterOwn.activeTabId === ownTab.id &&
      kindOf(homeOwnId) === 'home'
      ? '是'
      : '否',
    { 起始页的id: homeOwnId, 标签条: afterOwn.tabs.map((t) => t.url), 当前: afterOwn.activeTabId }
  )

  // ------------------------------------------- Q9 新标签页那个地址
  /**
   * 读出这一页被要求打开的那个地址。
   *
   * 来源是文件头那份 `firstNav`（webContents 出生时就挂上了监听，
   * 见那里的注释：等 create() 返回再挂就晚了）。真没记到才读一次 getURL()，
   * 把来路一并留在结果里，好分清「量到了」和「没量到」。
   */
  const observeUrl = async (id) => {
    const wc = wcOf(id)
    if (!wc) return { 来路: null, 地址: null, 说明: '取不到 webContents' }
    const got = await waitUntil(() => firstNav.has(wc.id), 6000, 80)
    return got
      ? { 来路: 'did-start-navigation', 地址: firstNav.get(wc.id) }
      : { 来路: 'getURL()', 地址: wc.isDestroyed() ? null : wc.getURL() }
  }

  step('把 browser.newTabUrl 改成 douyin.com，点那颗 +')
  config.set((c) => ({ ...c, browser: { ...c.browser, newTabUrl: 'douyin.com' } }))
  const dId = tabs.create({ activate: true })
  const bare = await observeUrl(dId)
  record(
    'Q9a',
    '新建标签页打开的是配置里那一格，且照地址栏的规矩解析（douyin.com → https://douyin.com）',
    typeof bare.地址 === 'string' && bare.地址.startsWith('https://douyin.com')
      ? '是'
      : '否',
    bare
  )

  step('把那一格清成空白（只剩空格），再点一次 +')
  config.set((c) => ({ ...c, browser: { ...c.browser, newTabUrl: '   ' } }))
  const eId = tabs.create({ activate: true })
  const fallback = await observeUrl(eId)
  record(
    'Q9b',
    '那一格是空白时回落到默认的 google.com（兜底只有一处，界面不必各自再判一次空）',
    typeof fallback.地址 === 'string' && fallback.地址.startsWith('https://www.google.com')
      ? '是'
      : '否',
    fallback
  )

  // ------------------------------------------- Q10 收起时自家屏也不可见
  step('回到起始页，把主体藏起来（收起成球那一下）')
  tabs.openHome()
  await delay(400)
  const shownBefore = visibles()
  tabs.setBodyVisible(false, false)
  await delay(300)
  const hidden = visibles()
  const allHidden = pageViews().every((v) => visibleOf(v) === false)
  tabs.setBodyVisible(true, false)
  await delay(300)
  const restored = visibles()
  record(
    'Q10',
    '收起成球时自家那两屏的视图也不画（不能从球后面透出一页设置），展开再画回来',
    allHidden && restored.some((s) => s.endsWith('=true'))
      ? '是'
      : '否',
    { 收起前: shownBefore, 收起后: hidden, 展开后: restored }
  )

  // ------------------------------------------- Q11 退出时一并拆掉
  step('destroyAll()')
  const ownViewHome = oneView('home.html')
  const ownViewSettings = oneView('settings.html')
  if (!ownViewHome || !ownViewSettings) {
    record('Q11', '退出时把自家那两屏的 webContents 也关掉', '否', {
      说明: '前提不成立：场上没同时认到两份自家视图',
      场上的文档: urlsOf()
    })
    finish(1)
    return
  }
  const homeWc = ownViewHome.webContents
  const settingsWc = ownViewSettings.webContents
  tabs.destroyAll()
  const gone = await waitUntil(
    () => homeWc.isDestroyed() && settingsWc.isDestroyed(),
    4000,
    150
  )
  record(
    'Q11',
    'destroyAll() 把自家那两屏的 webContents 也关掉（照标签条那份次序关就会漏掉它们）',
    gone && tabs.list().length === 0 && pageViews().length === 0 ? '是' : '否',
    {
      起始页那个: homeWc.isDestroyed(),
      设置那个: settingsWc.isDestroyed(),
      剩下的视图: pageViews().length
    }
  )

  finish(results.some((r) => r.verdict !== '是') ? 1 : 0)
}
