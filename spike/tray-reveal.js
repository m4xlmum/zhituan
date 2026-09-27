/**
 * 探针：托盘菜单里的「现形」，到底有没有把那扇半透明的窗恢复成不透明。
 *
 * 用户报的是这一条：把界面调到 40% 之后，从托盘右键点「现形」，窗口**仍然淡得
 * 看不清**。原先这条菜单只走了 showForeground()——提到最前，仅此而已，透明度
 * 原封不动。要它做的就是「直接调整窗口透明度为 100%」。
 *
 * 这里起的是**真的** WindowController（配置写在临时目录、绝不碰用户的那一份），
 * 接线与 src/main/index.ts 对齐，测的就是托盘菜单那一条调用：
 *
 *     TrayService 的「现形」→ onReveal() → controller.revealFully()
 *                                      = reveal(true) + setOpacity(1)
 *
 * ## 为什么先验「病」，再验「好」
 *
 * Q1 走的是**旧路径**（showForeground），断言它回来仍然是 0.4——先把病钉死，
 * 后面那条断言才有意义。否则「revealFully 之后是 1」可能只是因为窗口本来就是
 * 不透明的（比如 setOpacity 压根没生效），探针会假通过。
 *
 * ## 为什么断言「落盘」而不只是内存里的配置
 *
 * 点一次「现形」如果只改了内存，下次启动窗口又是淡的——用户会觉得这条菜单
 * 时灵时不灵。因此 Q3 关掉这一个 ConfigStore 的写入器、**换一个新的实例读同
 * 一个目录**：读到 1 才算数。落盘是排队的（DebouncedWriter），所以读之前要
 * flush()，这与 app 退出时走的是同一条路。
 *
 * 窗口摆在所有显示器之外，并且 show / showInactive / focus / moveTop 全换成
 * 空操作：用户说过改代码时不要弹窗，而 reveal() 里那几个调用会把窗口真的推到
 * 眼前（focus 还会抢走他正在用的编辑器的焦点）。透明度是窗口属性，与显不显示
 * 无关——Q0 先证明这一点成立，后面的读数才作数。
 *
 * 跑法：npx electron spike/tray-reveal.js
 * 产出：终端一份 [Qn] 报告、spike/out/tray-reveal.json（有一问没过就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, screen, ipcMain } = require('electron')
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
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-tray-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'windowController.ts'),
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
    configStore: require(at('main', 'services', 'configStore.cjs')),
    registry: require(at('main', 'services', 'windowRegistry.cjs'))
  }
}

// 探针自己出错了要立刻现形，而不是挂在那里等超时（theme-chrome.js 吃过这个亏）
process.on('unhandledRejection', (error) => {
  console.error('[FAIL] 探针自己出错了：', error)
  app.exit(1)
})

app.whenReady().then(async () => {
  const mods = await buildModules()
  const { WindowController } = mods.controller
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-tray-config-'))
  const config = new ConfigStore(dir)

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

  // chrome 那一层要有个假桥才画得出来（与其它探针同一条 preview-preload）
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

  const controller = new WindowController({
    config,
    registry: new WindowRegistry(),
    preloadPath: path.join(__dirname, 'preview-preload.js'),
    rendererUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).toString(),
    onVisibilityChange: () => {},
    onLayoutChange: () => {},
    onStateChange: () => {},
    onLeavePageFullscreen: () => {}
  })

  controller.create()
  const win = controller.getWindow()
  // 不弹窗、不抢焦点。透明度是窗口属性，与显不显示无关（Q0 先验这一条）
  win.show = () => {}
  win.showInactive = () => {}
  win.focus = () => {}
  win.moveTop = () => {}

  const finish = (code) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, 'tray-reveal.json')
    fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
    console.log(`WROTE ${out}`)
    const bad = results.filter((r) => r.verdict !== '是')
    console.log(`\n${results.length - bad.length}/${results.length} 通过`)
    for (const r of bad) console.log(`  未通过 ${r.id}：${r.question}`)
    try {
      config.flush()
      controller.destroy()
    } catch {
      // 已经在销毁了
    }
    app.exit(code)
  }

  /* 三个读数一起取：配置里写的是多少、窗口上真的是多少、此刻是什么状态。
     三者分开报，是为了让「没通过」能看出是哪一段断了——
     配置没写进去、还是写了但没推到窗口上、还是状态压根没回到展开态。 */
  const now = () => ({
    配置里的: config.get().window.opacity,
    窗口上的: win.getOpacity(),
    状态: controller.getMode()
  })

  // ------------------------------------------------------------------ Q0 前提
  step('展开态下调到 40%')
  controller.setOpacity(0.4)
  await delay(120)
  const base = now()
  record(
    'Q0',
    '前提：窗口没露出来的情况下，透明度照样读得到，并且 40% 真的落到了窗口上',
    base.配置里的 === 0.4 && base.窗口上的 === 0.4 && base.状态 === 'expanded' ? '是' : '否',
    base
  )
  if (base.窗口上的 !== 0.4) {
    step('窗口上的透明度读不回来，后面几问都没有意义，就此打住')
    finish(1)
    return
  }

  // ------------------------------------------------------- Q1 「现形」修之前
  step('藏进托盘，然后用旧路径（只提到最前）把它叫回来')
  await controller.hideToTray()
  await delay(120)
  const inTray = now()
  controller.showForeground()
  await delay(120)
  const afterOld = now()
  record(
    'Q1',
    '病：只「提到最前」的那条旧路径，回来之后窗口仍然是 40%——点它的人正是嫌淡',
    inTray.窗口上的 === 0 &&
      afterOld.状态 === 'expanded' &&
      afterOld.窗口上的 === 0.4 &&
      afterOld.配置里的 === 0.4
      ? '是'
      : '否',
    { 藏在托盘里时: inTray, 只提到最前之后: afterOld }
  )

  // ------------------------------------------------------- Q2 「现形」修之后
  step('再藏进托盘，走托盘菜单那条路（revealFully）')
  await controller.hideToTray()
  await delay(120)
  // 订阅要挂在动作之前：这一问验的是「界面跟着回到 100%」靠的那条广播
  const heard = []
  const unsubscribe = config.subscribe((next) => heard.push(next.window.opacity))
  controller.revealFully()
  await delay(120)
  const afterFix = now()
  record(
    'Q2',
    '修完：托盘「现形」之后，配置里与窗口上都是 100%',
    afterFix.配置里的 === 1 && afterFix.窗口上的 === 1 && afterFix.状态 === 'expanded' ? '是' : '否',
    { 之前: inTray, 现形之后: afterFix }
  )

  // ------------------------------------------------------------------ Q3 落盘
  step('冲刷写入队列，换一个新的 ConfigStore 读同一个目录')
  config.flush()
  const reopened = new ConfigStore(dir)
  const onDisk = reopened.get().window.opacity
  record(
    'Q3',
    '落盘：换一个实例读回来，配置里的透明度就是 100%（不是只改了内存）',
    onDisk === 1 ? '是' : '否',
    { 读回来的: onDisk, 配置文件: path.join(dir, 'config.json') }
  )

  // ------------------------------------------------------------------ Q4 广播
  unsubscribe()
  const heardLast = heard.length ? heard[heard.length - 1] : null
  record(
    'Q4',
    '广播：订阅者收到的那份配置里透明度是 100%（右栏与设置页的滑块跟着回到最右的依据）',
    heardLast === 1 ? '是' : '否',
    { 收到几次: heard.length, 最后一次: heardLast }
  )

  // ------------------------------------------------- Q5 收起态：球不跟着淡
  step('展开态调到 40%，再收起成球')
  controller.setOpacity(0.4)
  await delay(80)
  controller.collapse()
  await delay(120)
  const collapsed = now()
  controller.setOpacity(0.6)
  await delay(120)
  const collapsedAfterSet = now()
  record(
    'Q5',
    '收起成球时窗口恒为不透明（球是唯一能把他带回来的东西），收起态调透明度只写配置、不动窗口',
    collapsed.窗口上的 === 1 &&
      collapsed.配置里的 === 0.4 &&
      collapsedAfterSet.窗口上的 === 1 &&
      collapsedAfterSet.配置里的 === 0.6
      ? '是'
      : '否',
    {
      收到球时: collapsed,
      在收起态把配置改成0点6之后: collapsedAfterSet,
      注: '这正是 revealFully 里「先 reveal 再 setOpacity」的顺序要紧的原因：非展开态 setOpacity 会提前返回'
    }
  )

  // ------------------------------------------------- Q6 收起态下调 revealFully
  step('收起态下走一遍托盘菜单那条路')
  let collapsedThrew = null
  try {
    controller.revealFully()
  } catch (err) {
    collapsedThrew = String(err?.message ?? err)
  }
  await delay(120)
  const fromCollapsed = now()
  record(
    'Q6',
    '收起态下调它：不抛错，窗口回到展开态，透明度 100%（从收起态直接点托盘不会出事）',
    collapsedThrew === null &&
      fromCollapsed.状态 === 'expanded' &&
      fromCollapsed.配置里的 === 1 &&
      fromCollapsed.窗口上的 === 1
      ? '是'
      : '否',
    { 抛了没: collapsedThrew, 之后: fromCollapsed }
  )

  // ------------------------------------------------- Q7 托盘隐藏态下调它
  step('调到 35%，藏进托盘（会先淡到 0 再藏），再走一遍那条路')
  controller.setOpacity(0.35)
  await delay(80)
  await controller.hideToTray()
  await delay(120)
  const hidden = now()
  let trayThrew = null
  try {
    controller.revealFully()
  } catch (err) {
    trayThrew = String(err?.message ?? err)
  }
  await delay(120)
  const fromTray = now()
  record(
    'Q7',
    '藏在托盘里时调它：不抛错，回到展开态，并且把淡到 0 的那扇窗重新带到 100%',
    trayThrew === null &&
      hidden.状态 === 'trayHidden' &&
      hidden.窗口上的 === 0 &&
      fromTray.状态 === 'expanded' &&
      fromTray.配置里的 === 1 &&
      fromTray.窗口上的 === 1
      ? '是'
      : '否',
    { 藏在托盘里: hidden, 现形之后: fromTray, 抛了没: trayThrew }
  )

  // --------------------------------------------- Q8 修完之后「调淡」还照常
  step('现形之后再把整体透明度拖到 45%')
  controller.setOpacity(0.45)
  await delay(120)
  const afterFade = now()
  record(
    'Q8',
    '修完之后，正常调淡仍然照常（这一条没有被新路径弄坏）',
    afterFade.配置里的 === 0.45 && afterFade.窗口上的 === 0.45 ? '是' : '否',
    afterFade
  )

  // --------------------------------------------------------- Q9 托盘那一头接线
  // 上面几问都是直接调控制器。这一问回到起点：菜单上的「现形」是不是真的连着它。
  step('读一眼 src/main/index.ts 里托盘菜单的接线')
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.ts'), 'utf8')
  const wired = /onReveal:\s*\(\)\s*=>\s*controller\.revealFully\(\)/.test(main)
  record(
    'Q9',
    '接线：托盘菜单的 onReveal 连的就是 revealFully（不是旧的 showForeground）',
    wired ? '是' : '否',
    { 文件: 'src/main/index.ts' }
  )

  finish(results.some((r) => r.verdict !== '是') ? 1 : 0)
})
