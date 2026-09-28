/**
 * 探针：窗口没露出来的时候，网页里正在播的音视频会不会停。
 *
 * 用户报的毛病是这一条：**播放视频时收起成球（或藏进托盘），视频还在后台继续播**。
 * 代码里原先只做了 `setAudioMuted(!visible)`——听不见了，但片子照放，等回到展开态
 * 进度已经跑掉一截。要的是「暂停」，回来再接着放。
 *
 * 因此这里起的是**真的** WindowController 与**真的** TabManager（配置写在临时目录、
 * 会话用内存分区，绝不碰用户的那一份），接线与 src/main/index.ts 一字不差地对齐，
 * 连 onVisibilityChange 与 config.subscribe 那两条都照抄——这一问验的就是这两条线：
 *
 *     ① 收起：collapse() / hideToTray() / minimize()
 *          → transitionTo('…') → onVisibilityChange(false)
 *          → tabs.setBodyVisible(false) → applyMediaState()
 *          → 逐帧 PAUSE_PLAYING_MEDIA / RESUME_PAUSED_MEDIA
 *     ② 切走：activate()（切标签、进起始页 / 设置都从它过）
 *          → applyMediaState() → 同上
 *
 * 两条线在 applyMediaState 一处合成同一条判据（「谁该出声」），所以两类都要问：
 * 收起那一组是原先就有的行为，**切走那一组**是这一版新加的——它反过来还改了收起
 * 那一组的预期：展开时不再「两页一起恢复」，后台那张仍然停着（Q3）。
 *
 * ## 页面是真的在播，不是摆样子
 *
 * 一页只声明「我在播」是验不出东西的（fullscreen.js 就吃过这个亏：有一问因为前提
 * 没成立而假通过）。这里有真媒体在跑：探针在 Node 里现生成一段 8kHz 单声道 PCM 的
 * WAV（无编码器依赖，Chromium 原生就认），塞进页面当 src，`loop` 起来，所以
 * `paused === false` 是真的。每一问动手之前先断言「确实在播」，前提不成立就照实报
 * 「否」并写明是哪一条前提，而不是给一个好看的通过。
 *
 * 三个元素各有各的用处：
 *   #v     正在播的主媒体（被测的主角）
 *   #u     先播一下、再**由用户自己**按暂停（验「我们自己没按过的，展开时不动」）
 *   iframe 里另有一份正在播的。用 data: 而不是第二个 file://：data: 是不透明源，
 *          顶层脚本一定够不着它，只有主进程按帧走才够得着——各家网站的嵌入播放器
 *          就是这个样子。它的状态也不由主进程去读（用被测的那条路验被测的东西，
 *          读出来不算数），而是它对父页面的 message 回复，探针只读父页面收到的那份。
 *
 * 还有一张**后台标签页**同样在播：收起时它也该停——只停当前那一页的话，
 * 声音还在响，毛病照旧。它同时是「切走时暂停」那一组问题里的另一边。
 *
 * 窗口摆在所有显示器之外，并且从不显示（show / showInactive 都换成空操作）：
 * 用户说过改代码时不要弹窗。媒体播不播与窗口显不显示无关，这正是本题的前提。
 *
 * 跑法：npx electron spike/media-pause.js
 * 产出：终端一份 [Qn] 报告、spike/out/media-pause.json（有一问没过就以非零码退出）
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

/** 把要用的几份 TS 各打成一包再 require。理由与 window-max.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-media-'))
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

/**
 * 现做一段 WAV：8kHz 单声道 16bit PCM，0.4 秒，一个很轻的 440Hz。
 *
 * 不用真视频文件：`<video>` 装一段纯音频的 WAV 照样播（只是没有画面），
 * 而 WAV/PCM 是 Chromium 原生就认的，不依赖任何编解码器，
 * 于是这一问不会因为「本机的 Electron 没带某个编解码器」而变成假否。
 */
function wavDataUrl() {
  const rate = 8000
  const samples = Math.round(rate * 0.4)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.05 * 32767), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return `data:audio/wav;base64,${Buffer.concat([head, data]).toString('base64')}`
}

/**
 * 一页「正在播视频的网页」，三个元素见文件头。
 *
 * iframe 里的状态靠一问一答：父页面 `postMessage({ask:'state'})` 问，它答。
 * 不用定时上报——隐藏的页面里定时器会被 Chromium 节流，问一句要等一秒以上，
 * 而「等不到」会伪装成「没暂停」。消息投递不受节流影响。
 */
function writePage(tag, wav) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-media-${tag}-`))
  const file = path.join(dir, 'page.html')
  const frame = `<!doctype html><meta charset="utf-8"><body style="margin:0">
    <audio id="f" loop src="${wav}"></audio>
    <script>
      const el = document.getElementById('f')
      el.play().catch(() => {})
      addEventListener('message', (e) => {
        if (!e.data || e.data.ask !== 'state') return
        parent.postMessage({
          paused: el.paused,
          marked: el.__zhituanPaused === true,
          readyState: el.readyState
        }, '*')
      })
    </script></body>`
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>探针页面</title>
<body style="margin:0;background:#0b1220">
  <video id="v" loop src="${wav}"></video>
  <audio id="u" loop src="${wav}"></audio>
  <iframe id="fr" src="data:text/html;charset=utf-8,${encodeURIComponent(frame)}"></iframe>
  <script>
    window.zhituanFrame = null
    addEventListener('message', (e) => { window.zhituanFrame = e.data })

    const v = document.getElementById('v')
    const u = document.getElementById('u')
    const fr = document.getElementById('fr')

    // 主动播起来，然后把 #u 停掉——那一下算「用户自己按的暂停」，
    // 展开时不该被我们放起来（脚本里那枚记号就是为这一条设的）
    window.zhituanStart = () => {
      v.play().catch(() => {})
      u.play().catch(() => {})
      setTimeout(() => u.pause(), 250)
    }
    window.zhituanAskFrame = () => {
      window.zhituanFrame = null
      fr.contentWindow.postMessage({ ask: 'state' }, '*')
    }
    window.zhituanMedia = () => {
      const of = (el) => ({
        id: el.id,
        paused: el.paused,
        marked: el.__zhituanPaused === true,
        readyState: el.readyState,
        error: el.error ? el.error.code : null
      })
      return { v: of(v), u: of(u), frame: window.zhituanFrame }
    }
  </script>
</body>`,
    'utf8'
  )
  return pathToFileURL(file).toString()
}

/** 读一页的现状：先问 iframe 一句（跨源，只能这么问），再读父页面记下的那一份 */
async function media(page) {
  const evaluate = (code) =>
    Promise.race([
      page.executeJavaScript(code),
      new Promise((res) => setTimeout(() => res('timeout'), 4000))
    ]).catch((err) => `err:${err?.message ?? err}`)
  const asked = await evaluate('window.zhituanAskFrame(), true')
  if (asked !== true) return `问不到：${asked}`
  await delay(150)
  return evaluate('window.zhituanMedia()')
}

const reading = (m) => (m && typeof m === 'object' && m.v ? m : null)
/** 主媒体与 iframe 里那一份都在播 / 都停了。#u 不参与——它本来就该是停着的 */
const playing = (m) => {
  const r = reading(m)
  return !!r && r.v.paused === false && r.frame && r.frame.paused === false
}
const stopped = (m) => {
  const r = reading(m)
  return !!r && r.v.paused === true && r.frame && r.frame.paused === true
}

/** 等一件事成真；暂停与恢复在各家页面里快慢不一，不猜固定延迟 */
async function waitUntil(probe, ms = 4000, every = 150) {
  const until = Date.now() + ms
  for (;;) {
    if (await probe()) return true
    if (Date.now() >= until) return false
    await delay(every)
  }
}
const waitStopped = (page) => waitUntil(async () => stopped(await media(page)))
const waitPlaying = (page) => waitUntil(async () => playing(await media(page)))

app.whenReady().then(async () => {
  const mods = await buildModules()
  const { WindowController } = mods.controller
  const { TabManager } = mods.tabs
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry

  const config = new ConfigStore(fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-media-config-')))
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

  const ses = session.fromPartition('zhituan-media-probe')
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
    // 这一条就是被测的接线：与 src/main/index.ts 里那份一字不差
    onVisibilityChange: (visible) => {
      tabsRef?.setBodyVisible(visible)
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

  // 另一条接线也照抄：改配置就当场重算媒体状态（见 index.ts 的 config.subscribe）
  config.subscribe(() => {
    tabs.refreshMediaState()
  })

  controller.create()
  const win = controller.getWindow()
  win.show = () => {}
  win.showInactive = () => {}

  const finish = (code) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, 'media-pause.json')
    fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
    console.log(`WROTE ${out}`)
    const bad = results.filter((r) => r.verdict !== '是')
    console.log(`\n${results.length - bad.length}/${results.length} 通过`)
    for (const r of bad) console.log(`  未通过 ${r.id}：${r.question}`)
    try {
      controller.destroy()
    } catch {
      // 已经在销毁了
    }
    app.exit(code)
  }

  const wav = wavDataUrl()
  const frontId = tabs.create({ url: writePage('front', wav), activate: true })
  await delay(700)
  // 后台那一张：正在播的媒体不该因为「不是当前标签页」就被漏掉
  const backId = tabs.create({ url: writePage('back', wav), activate: false })
  /*
   * create 末尾那句 `view.setVisible(this.bodyVisible)` 会把**新建**的视图画出来，
   * 不管它是不是当前那一张（应用里 activate:false 只出现在会话恢复那条路上，随后
   * 那一次 activate 会把次序理顺）。这里紧跟一句 activate(frontId)，把场上摆成
   * 应用里真实的样子——当前那张露着、另一张藏着，否则「后台标签页」只是个名义。
   */
  tabs.activate(frontId)
  await delay(1000)

  // 按 URL 认页，不按子视图次序：次序会随「谁在最上层」变（syncChromeOrder 会重排）
  const chrome = controller.getChromeView()
  const views = win.contentView.children.filter((v) => v !== chrome).map((v) => v.webContents)
  const page = views.find((wc) => wc.getURL().includes('zhituan-media-front-'))
  const back = views.find((wc) => wc.getURL().includes('zhituan-media-back-'))
  if (views.length !== 2 || !page || !back) {
    record('Q0', '前提：场上正好两页（前台 + 后台），都能认出来', '否', {
      视图数: views.length,
      URL: views.map((wc) => wc.getURL())
    })
    finish(1)
    return
  }

  // 让两页的媒体都真的播起来（#u 各自被页面自己停掉）
  for (const p of [page, back]) {
    await p.executeJavaScript('window.zhituanStart()').catch(() => {})
  }
  const alive = await waitPlaying(page)
  record(
    'Q0',
    '前提：前台那一页的媒体确实在播（不是摆样子）',
    alive ? '是' : '否',
    await media(page)
  )
  if (!alive) {
    finish(1)
    return
  }

  // ------------------------------------------------------------------ Q1 收起
  step('收起成球')
  controller.collapse()
  const stoppedOnCollapse = await waitStopped(page)
  const collapsed = await media(page)
  const backCollapsed = await media(back)
  record(
    'Q1',
    '收起成球后，正在播的媒体被暂停（主媒体与 iframe 里的都算）',
    stoppedOnCollapse ? '是' : '否',
    { 主媒体: collapsed.v, iframe里的: collapsed.frame, 用户自己暂停的那个: collapsed.u }
  )
  record(
    'Q2',
    '后台标签页里正在播的也一样停了（不是只管当前那一页）',
    stopped(backCollapsed) ? '是' : '否',
    { 主媒体: backCollapsed.v, iframe里的: backCollapsed.frame }
  )

  step('展开')
  controller.expand()
  const resumed = await waitPlaying(page)
  const shown = await media(page)
  const backShown = await media(back)
  /*
   * 这一问的预期在「切走时暂停」进来之后**反过来了**：展开不再把两页一起放起来。
   * 正在看的那张恢复，后台那张仍然停着——它归另一条规矩管（见下面 Q11 起那几条）。
   * 原先这里问的是「两页都接着放」，而那种写法正是两条规矩合成一条判据要修掉的洞：
   * 窗口一展开就顺手把后台那张也放响了。
   */
  record(
    'Q3',
    '展开后：正在看的那一张恢复，后台那一张仍然停着（不是「两页一起放起来」）',
    resumed && stopped(backShown) ? '是' : '否',
    {
      前台: { 主媒体: shown.v, iframe里的: shown.frame },
      后台: { 主媒体: backShown.v, iframe里的: backShown.frame }
    }
  )
  // 这一条比 Q3 更要紧：恢复错了（把用户自己暂停的也放起来）比不恢复还烦
  record(
    'Q4',
    '展开后，用户自己按过暂停的那一个仍然是暂停的，而且没被我们打上记号',
    shown.u && shown.u.paused === true && shown.u.marked === false ? '是' : '否',
    shown.u
  )

  // ------------------------------------------------------------------ Q5 托盘
  step('藏进托盘')
  await controller.hideToTray()
  const stoppedInTray = await waitStopped(page)
  record('Q5', '藏进托盘后也一样暂停（前台与后台两页）', stoppedInTray && stopped(await media(back)) ? '是' : '否', {
    前台: await media(page),
    后台: await media(back)
  })

  step('单击托盘图标把它叫回来')
  controller.toggleFromTray()
  const backFromTray = await waitPlaying(page)
  record('Q6', '从托盘现形后，正在看的那一张又接着放', backFromTray ? '是' : '否', await media(page))

  // ------------------------------------------------------------ Q7 最小化
  step('最小化')
  try {
    controller.minimize()
  } catch (err) {
    step(`最小化那一下抛了（隐藏窗口上 win.minimize() 未必被受理）：${err.message}`)
  }
  const stoppedMinimized = await waitStopped(page)
  record('Q7', '最小化后也一样暂停', stoppedMinimized ? '是' : '否', await media(page))

  step('从最小化回到展开')
  try {
    controller.showForeground()
  } catch (err) {
    step(`叫回来那一下抛了：${err.message}`)
    controller.transitionTo('expanded')
  }
  const backFromMin = await waitPlaying(page)
  record('Q8', '从最小化回来后也接着放', backFromMin ? '是' : '否', await media(page))

  // ------------------------------------------------------- Q9 静音那一半
  // 原先就有的行为，一并盯住：光暂停不够，Web Audio 之类暂停不到的还得靠静音
  controller.collapse()
  await delay(500)
  const mutedHidden = { 前台: page.isAudioMuted(), 后台: back.isAudioMuted() }
  controller.expand()
  await delay(500)
  const mutedShown = { 前台: page.isAudioMuted(), 后台: back.isAudioMuted() }
  record(
    'Q9',
    '静音那一半仍然在：隐藏时静音、回来时取消静音',
    mutedHidden.前台 === true && mutedHidden.后台 === true && mutedShown.前台 === false
      ? '是'
      : '否',
    { 隐藏时: mutedHidden, 展开后: mutedShown }
  )

  // ------------------------------------------------- Q10 关掉开关
  step('把 stealth.muteMediaOnCollapse 关掉，再收起一次')
  config.set((c) => ({ ...c, stealth: { ...c.stealth, muteMediaOnCollapse: false } }))
  await waitPlaying(page)
  controller.collapse()
  await delay(700)
  const offState = await media(page)
  const offMuted = page.isAudioMuted()
  controller.expand()
  record(
    'Q10',
    '关掉这个开关之后，收起时不再动网页里的媒体（用户自己的选择要被尊重）',
    reading(offState) && offState.v.paused === false && offMuted === false ? '是' : '否',
    { 收起后的主媒体: reading(offState)?.v, 收起后是不是静音: offMuted }
  )

  // ------------------------------------------------- Q11–Q16 切走时暂停
  /*
   * 第二条规矩：窗口露着的时候，只有正在看的那一张出声。
   *
   * Q10 把「收起时暂停」那条开关关掉了，这里先恢复回来——两条规矩各自独立，但这一组
   * 要在默认配置下问，否则量到的是两条规矩叠在一起的结果。恢复那一下会触发
   * refreshMediaState（照抄了 index.ts 的 config.subscribe），后台那张会被按下去，
   * 因此紧接着把两页重新起播。
   */
  step('切走时暂停：恢复开关，然后切过去')
  config.set((c) => ({ ...c, stealth: { ...c.stealth, muteMediaOnCollapse: true } }))
  /*
   * 这里**不**再调一次 `zhituanStart()`。
   *
   * 到此为止两页的状态正好就是这一组要的：这一页在播（上一问刚验过）、另一页停着
   * 而且带着我们打下的记号（收起那一段留下的）。再播一遍反而会踩到探针自己的时序
   * ——`zhituanStart` 会把「用户自己按停」的那个也播起来、250ms 之后再由页面自己
   * 按停，而**隐藏页面里的定时器会被 Chromium 节流到约一秒一次**。赶在那个 pause
   * 之前切走，我们就会把它当成「正在播的」一起按下去、并给它打上记号，于是 Q13
   * 问的已经不是「用户自己暂停的那一个」了。那不是产品行为，是探针自己造的时序。
   */
  const pagePlaying = await waitPlaying(page)
  record(
    'Q11-前提',
    '前提：切走之前这一页确实在播（否则「切走后它停了」是白送的）',
    pagePlaying ? '是' : '否',
    await media(page)
  )

  tabs.activate(backId)
  const switchedToBack = await waitPlaying(back)
  const frontAfterSwitch = await waitStopped(page)
  record(
    'Q11',
    '切到另一张之后：切过去的那张接着放，切走的那张停了（iframe 里的也算）',
    switchedToBack && frontAfterSwitch ? '是' : '否',
    { 切过去那张: await media(back), 切走那张: await media(page) }
  )

  tabs.activate(frontId)
  const backToFront = await waitPlaying(page)
  const backAfterReturn = await waitStopped(back)
  record(
    'Q12',
    '再切回来：那一张恢复播放，刚切走的那张停',
    backToFront && backAfterReturn ? '是' : '否',
    { 切过去那张: await media(page), 切走那张: await media(back) }
  )
  // 与 Q4 同一条道理，换到这一条规矩上再问一遍：恢复的只是我们按下去的那些
  /*
   * 前提：「用户自己按停的那一个」得真的处在暂停态，这一问才问得成。只等这一页
   * ——读的就是它（另一页的同一个元素与这一问无关）。页面里那个「250ms 后自己按停」
   * 的定时器在隐藏页会被节流，慢一拍是常事，等一下就稳了。
   */
  const uSeated = await waitUntil(async () => {
    const m = await media(page)
    return !!reading(m) && m.u.paused === true && m.u.marked === false
  }, 6000)
  const afterReturn = await media(page)
  record(
    'Q13',
    '切回来之后，用户自己按过暂停的那一个仍然是暂停的（恢复只认我们自己的记号）',
    uSeated && afterReturn.u && afterReturn.u.paused === true && afterReturn.u.marked === false
      ? '是'
      : '否',
    { 前提_那一个先得真的处于暂停态: uSeated, 切回来之后: afterReturn.u }
  )

  // ---------------------------------- Q14/Q15 起始页与设置同样占着正文区
  step('进起始页')
  tabs.openHome()
  const stoppedOnHome = await waitStopped(page)
  record(
    'Q14',
    '进起始页时刚才那张网页也停（起始页 / 设置不是标签页，但同样占着正文区）',
    stoppedOnHome ? '是' : '否',
    await media(page)
  )
  step('从起始页原路返回')
  tabs.leaveScreen()
  const resumedFromHome = await waitPlaying(page)
  record('Q15', '从起始页原路返回后又接着放', resumedFromHome ? '是' : '否', await media(page))

  // ------------------------------------------------- Q16 关掉第二条开关
  step('把 stealth.pauseMediaOnSwitch 关掉，再切走一次')
  config.set((c) => ({ ...c, stealth: { ...c.stealth, pauseMediaOnSwitch: false } }))
  await waitPlaying(page)
  tabs.activate(backId)
  await delay(700)
  const leaked = await media(page)
  record(
    'Q16',
    '关掉「切走时暂停」之后，切走的那张继续在后台放（用户自己的选择要被尊重）',
    reading(leaked) && leaked.v.paused === false ? '是' : '否',
    reading(leaked)?.v
  )

  finish(results.some((r) => r.verdict !== '是') ? 1 : 0)
})
