/**
 * 探针：弹出面板该在什么时候自己收起。
 *
 * 用户报的是这一条：**「标签页点击之后的弹框是分离的，当我再次点击其他内容
 * 失去焦点的时候，这个标签页的弹框并不会随之关闭」**。根子在一行上——面板
 * 原先用 `showInactive()` 摆出来，焦点一直留在主窗口里，于是「用户点了别处」
 * 这件事面板根本收不到：`blur` 永不触发，面板就一直飘在桌面上。
 *
 * 因此这里起的是**真的** PopoverWindowService（接线与 src/main/index.ts 一致），
 * 要盯住的是它的收尾那一套：
 *
 * - 面板摆出来走的是 `show()`（拿到焦点）；`showInactive()` 一个字都不该调——
 *   这是整条 blur 链子的前提，也是这次改动的核心；
 * - 面板在场期间自动收起被挂起（`registry.hasAutoHideBlocker`），收起后放开；
 * - **失焦即收起**，而且**不抢焦点**（用户多半正点着别的应用）；
 * - 「同一次点击的第二半」被吃掉：失焦收起后紧接着同一种面板再 open 一次，
 *   不该又开回来（否则那颗键读起来像点了没反应）；
 * - 换一种面板照旧放行；迟到的那一次 blur 不许误关新面板（认窗不认事件）；
 * - 用户自己在面板里选完东西那条路（dismiss）才把焦点还回主窗口。
 *
 * ## 这一问不动用户的桌面
 *
 * 用户说过改代码时不要弹窗。这里每建一扇面板窗口，立刻把它挪到所有显示器之外、
 * 并设成不可聚焦——于是它既不出现、也不抢焦点。**唯一被替换掉的恰是
 * 「show() 会不会拿到焦点」这个 OS 行为**，而那一条正是探针要问的：改从调用记录上问
 * （面板窗口的 show 被换成一个记账的壳），比在别人的桌面上试焦点
 * 更准也更稳。焦点那一步的实物确认留给真机（见 README 的验证一节）。
 *
 * 跑法：npx electron spike/popover-focus.js
 * 产出：终端一份 [Qn] 报告、spike/out/popover-focus.json（有一问没过就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, screen } = require('electron')
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

/** 把要用的几份 TS 各打成一包再 require。理由与 media-pause.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-popover-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'popoverWindow.ts'),
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
    popover: require(at('main', 'services', 'popoverWindow.cjs')),
    registry: require(at('main', 'services', 'windowRegistry.cjs'))
  }
}

/**
 * 所有显示器之外的落点：面板窗口一建出来就挪到那儿去，屏幕上不会出现任何东西。
 *
 * 位置不是「挪走再挪回来」——挪走就再也不动它，这一问没有一处需要它真的可见。
 */
function offscreenOrigin() {
  const displays = screen.getAllDisplays()
  return {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 4000,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 4000
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

/*
 * 窗口全关也不许退出。
 *
 * 这一问的主角就是「面板自己关掉」，而面板在探针里往往是场上的**唯一**一扇窗；
 * Electron 的默认行为是最后一扇窗关掉就退出进程——于是第一问刚过，
 * 失焦那一步一收面板，整个探针就悄没声地退了（退出码还是 0）。
 */
app.on('window-all-closed', () => {
  // 有意留空
})

const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场——看门狗把它收了')
  app.exit(1)
}, 120_000)

async function main() {
  const mods = await buildModules()
  const { PopoverWindowService } = mods.popover
  const { WindowRegistry } = mods.registry

  // 面板文档要真的加载得起来：打包产物就在 out/renderer 下（先跑一次 electron-vite build）。
  // 不指这一条时 rendererUrl 会按打包后那条路去拼，探针的临时目录里没有那些 HTML。
  process.env.ELECTRON_RENDERER_URL = pathToFileURL(path.join(ROOT, 'out', 'renderer')).toString()

  /** 建出来的每一扇面板窗口，以及 show / showInactive 各自的调用次数 */
  const created = []
  const shown = { show: 0, showInactive: 0 }
  const origin = offscreenOrigin()

  app.on('browser-window-created', (_event, win) => {
    created.push(win)
    win.setPosition(origin.x, origin.y)
    win.setFocusable(false)
  })

  const origShow = BrowserWindow.prototype.show
  const origShowInactive = BrowserWindow.prototype.showInactive
  BrowserWindow.prototype.show = function patchedShow(...args) {
    shown.show += 1
    return origShow.apply(this, args)
  }
  BrowserWindow.prototype.showInactive = function patchedShowInactive(...args) {
    shown.showInactive += 1
    return origShowInactive.apply(this, args)
  }

  const registry = new WindowRegistry()
  let focusParentCalls = 0
  const popover = new PopoverWindowService(
    registry,
    // 面板窗口带着 preload 起来；这一问问的是主进程这边的收尾，preload 指哪儿都一样
    path.join(ROOT, 'out', 'preload', 'index.js'),
    () => ({ x: 100, y: 100, width: 900, height: 520 }),
    () => {
      focusParentCalls += 1
    }
  )

  const alive = (win) => Boolean(win && !win.isDestroyed())
  const anchor = { x: 40, y: 40, width: 120, height: 26 }

  // ------------------------------------------------- Q1 摆出来时拿的是 show()
  step('open(tabs)')
  popover.open({ kind: 'tabs', anchorRect: anchor })
  await delay(1500)
  const winA = created[0]
  const loaded = await waitUntil(() => alive(winA) && winA.webContents.getURL().includes('popover.html'))
  record(
    'Q1',
    '面板摆出来走的是 show()（拿焦点）——showInactive() 会让焦点留在主窗口，blur 那条链子整条落空',
    shown.show === 1 && shown.showInactive === 0 && loaded ? '是' : '否',
    {
      show次数: shown.show,
      showInactive次数: shown.showInactive,
      建了几扇窗: created.length,
      文档: alive(winA) ? winA.webContents.getURL().split('/').pop() : '(已销毁)'
    }
  )

  if (!loaded) {
    record('Q2', '面板在场期间挂起自动收起，收起后放开', '否', { 说明: '前提不成立：面板那扇窗没起来，后面几问无从问起' })
    finish(1)
    return
  }

  // ------------------------------------- Q2 在场期间挂起自动收起（否则光标一移开就缩成球）
  const blockedWhileOpen = registry.hasAutoHideBlocker(-1)
  record(
    'Q2',
    '面板在场期间自动收起被挂起（光标移开界面也不会缩成球，把面板孤零零留在桌面上）',
    blockedWhileOpen && popover.getKind() === 'tabs' ? '是' : '否',
    { 挂起: blockedWhileOpen, 当前面板: popover.getKind() }
  )

  // ------------------------------------------- Q3 失焦即收起，且不抢焦点
  //
  // 失焦与「同一次点击的第二半」之间**不许等**：那两半之间只隔着一次 IPC 往返
  // （几十毫秒），而认下它的时限是 300ms。这里若为了看一眼状态先睡上半秒，
  // 问的就不是那条判据了（上一版正是这么写，白报了一次「否」）。
  step('失焦（用户点到了面板外面），紧接着那一下点击的另一半落在锚点那颗键上')
  const focusCallsBefore = focusParentCalls
  winA.emit('blur')
  const afterBlur = {
    kind: popover.getKind(),
    blocker: registry.hasAutoHideBlocker(-1),
    focusCalls: focusParentCalls
  }
  const windowsBeforeSecondHalf = created.length
  popover.open({ kind: 'tabs', anchorRect: anchor })
  await delay(500)

  record(
    'Q3',
    '失焦即收起：用户点了面板外面，面板自己关掉、账也销了（registry 不再挂着它）',
    !alive(winA) && afterBlur.kind === null && !afterBlur.blocker && !registry.hasAutoHideBlocker(-1)
      ? '是'
      : '否',
    {
      窗口已关: !alive(winA),
      失焦那一刻的当前面板: afterBlur.kind,
      失焦那一刻还挂着自动收起的挂起: afterBlur.blocker,
      现在: { 当前面板: popover.getKind(), 挂起: registry.hasAutoHideBlocker(-1) }
    }
  )
  record(
    'Q4',
    '失焦收起**不碰焦点**：用户多半正点着别的应用，抢回来就成了「点一下别处，摸鱼窗口自己跳到最前」',
    afterBlur.focusCalls === focusCallsBefore ? '是' : '否',
    { 还焦点次数: afterBlur.focusCalls - focusCallsBefore }
  )

  // ------------------------------- Q5 同一次点击的第二半被吃掉（那颗键仍旧是开关）
  record(
    'Q5',
    '失焦收起后紧接着的**同一种**面板不重开：那一下点击的另一半落在锚点那颗键上，认出来才不会「关掉又立刻开回来」',
    created.length === windowsBeforeSecondHalf && popover.getKind() === null ? '是' : '否',
    { 新建了几扇: created.length - windowsBeforeSecondHalf, 当前面板: popover.getKind() }
  )

  // --------------------------------------- Q6 换一种面板照旧放行
  step('马上点另一颗键（换一种面板）')
  popover.open({ kind: 'history', anchorRect: anchor })
  await delay(800)
  const winB = created[created.length - 1]
  record(
    'Q6',
    '换了**另一种**面板照旧放行（点了另一颗键是「换一个面板看」，不该被上面那条吃掉）',
    created.length === windowsBeforeSecondHalf + 1 &&
      popover.getKind() === 'history' &&
      alive(winB)
      ? '是'
      : '否',
    { 新建了几扇: created.length - windowsBeforeSecondHalf, 当前面板: popover.getKind() }
  )

  // --------------------------- Q7 迟到的那一次 blur 不许误关新面板（认窗不认事件）
  //
  // 上一边那块面板（winA）关掉时也会发一次 blur，而 'closed' 那条也是异步到的：
  // 新面板接手之后它们才到，两条都得认明「是这一扇」。
  step('上一边那块面板迟到的 blur / closed')
  winA.emit('blur')
  await delay(400)
  record(
    'Q7',
    '认窗不认事件：上一边那块面板关掉时也会发一次 blur，此时新面板已接手，不许把它误关掉、也不许把它的账抹掉',
    alive(winB) && popover.getKind() === 'history' ? '是' : '否',
    { 新面板还在: alive(winB), 当前面板: popover.getKind() }
  )

  // -------------------------------------------- Q8 用户自己选完东西 → 收起并还焦点
  step('dismiss()（用户在面板里切标签 / 点书签）')
  const focusCallsBeforeDismiss = focusParentCalls
  popover.dismiss()
  await delay(400)
  record(
    'Q8',
    '用户自己在面板里选完东西（dismiss）：面板收起**并**把焦点还回主窗口——不然接下来的键盘敲在一扇已经没了的窗口上',
    !alive(winB) && popover.getKind() === null && focusParentCalls === focusCallsBeforeDismiss + 1 ? '是' : '否',
    {
      窗口已关: !alive(winB),
      当前面板: popover.getKind(),
      还焦点次数: focusParentCalls - focusCallsBeforeDismiss
    }
  )

  // -------------------------------------------- Q9 收场：账本干净，没有窗口漏下来
  const leaked = created.filter(alive).length
  record('Q9', '收场后不剩一扇面板窗口（一扇都没漏在桌面上）', leaked === 0 ? '是' : '否', { 还在的窗口: leaked })

  finish(results.some((r) => r.verdict !== '是') ? 1 : 0)
}

async function waitUntil(probe, ms = 6000, every = 100) {
  const until = Date.now() + ms
  for (;;) {
    if (await probe()) return true
    if (Date.now() >= until) return false
    await delay(every)
  }
}

function finish(code) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'popover-focus.json'),
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8'
  )
  clearTimeout(watchdog)
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {
      // 已经在销毁了
    }
  }
  app.exit(code)
}
