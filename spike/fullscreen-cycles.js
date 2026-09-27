/**
 * 探针：全屏进出在什么条件下才走得完——以及 disableHtmlFullscreenWindowResize 到底管不管用。
 *
 * 这份是 spike/fullscreen.js 的伴生探针。那个探针验「点视频全屏键，窗口跟不跟着
 * 最大化」，跑的时候撞上一堆「第一趟好好的，第二趟起页面就卡在全屏态」的现象，
 * 都是**这个环境的脾气**而不是产品的问题。要分清「环境的脾气」与「产品的毛病」，
 * 就得有一扇最小、可控的窗口，一样一样地把变量摘出来——那就是这一份。
 *
 * 结论（2026-09-24，本机 Windows 11 / Electron 44）：
 *
 *   一、同一个进程里连着走三趟全屏进出，**本来是可以的**：最小的一扇窗
 *       （plain）三趟 enter / leave 都齐。所以「一个进程只容得下一趟」不成立。
 *
 *   二、能把第二趟弄坏的是这样两件事：**在进出全屏的那个回调里
 *       `view.setBounds()` 改页面视图的尺寸**（relayout），以及**窗口没有被
 *       真正合成**（藏起来时第二趟就坏，显示之后能撑到第三趟）。两件事都指向
 *       同一个前提：Chromium 的全屏进出要等窗口那一侧确认，而没被合成的窗口
 *       等不到那个确认。产品代码必然要做那一下 `view.setBounds`（窗口尺寸变了，
 *       正文矩形就得跟着变，否则视频停在旧矩形上），因此这不是改探针能绕开的。
 *
 *   三、透明的窗口配置、不可缩放、无边框、在回调里重排子视图次序（reorder）、
 *       把回调里的动作推迟一个 tick（surgeryDefer）——**都不是**原因。
 *
 *   四、`disableHtmlFullscreenWindowResize: true` **量得出差别，而且差别正是
 *       我们要接管的理由**：不带它时 Chromium 自己把窗口铺到**整块显示器**
 *       （本机 1920×1080，连任务栏一起盖住），工作区是 1920×1032；带上它，
 *       窗口一动不动。那 48px 就是「两边同时动手」会跳的那一下。
 *
 * 跑法（一次一支，各自起一个新进程；不带参数打印这一行）：
 *
 *     for v in plain real surgery surgeryDefer relayout reorder shown; do
 *       npx electron spike/fullscreen-cycles.js $v
 *     done
 *     npx electron spike/fullscreen-cycles.js plain --no-flag      # 第四条那半
 *
 * 窗口都摆在所有显示器之外，`shown` 那一支才真的显示（位置仍在屏幕之外，
 * 屏幕上不会出现任何东西——量「合成」这条前提非它不可）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, WebContentsView, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 一页极简的「带视频的网页」——只有 `requestFullscreen()` / `exitFullscreen()`
 * 两个入口，和 spike/fullscreen.js 里那份同源。写成文件再 file:// 打开而不是
 * data: URL：data: 是不透明源，全屏放不放行是另一件与本题无关的事。
 */
function writePage(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-fscyc-${tag}-`))
  const file = path.join(dir, 'p.html')
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><body style="margin:0">
     <div id="p" style="width:320px;height:180px;background:#2a7"></div>
     <script>
       window.err = null
       window.go = () => { window.err = null
         document.getElementById('p').requestFullscreen().catch((e) => { window.err = String(e) }) }
       window.stop = () => { window.err = null
         document.exitFullscreen().catch((e) => { window.err = String(e) }) }
     </script></body>`,
    'utf8'
  )
  return pathToFileURL(file).toString()
}

/** 真实窗口配置：透明、不可缩放、无边框——WindowController 建出来的就是这样 */
const REAL_WINDOW = { transparent: true, resizable: false, maximizable: false, frame: false }

const VARIANTS = {
  /** 最小的一扇窗，基线：三趟都该齐 */
  plain: { window: { frame: true } },
  /** 只换成真实窗口配置，不做任何窗口操作 */
  real: { window: REAL_WINDOW },
  /** 真实配置 + 进全屏时我们自己同步 setBounds（模拟 WindowController 改窗口） */
  surgery: { window: REAL_WINDOW, surgery: true },
  /** 上一样，但那次 setBounds 挪到事件之后一个 tick（试「推迟一下就没事了？」） */
  surgeryDefer: { window: REAL_WINDOW, surgery: true, defer: true },
  /**
   * 真实配置 + 连**页面视图一起**重摆（WindowController 会经
   * onLayoutChange → tabs.layoutAll() → view.setBounds 做这一下）。
   * 这一支就是那个能把第二趟弄坏的东西。
   */
  relayout: { window: REAL_WINDOW, surgery: true, relayout: true },
  /**
   * 真实配置 + 在回调里**重排子视图次序**（syncChromeOrder 靠 addChildView
   * 把一个已在场的子视图提到最上层，最大化时必走）。单独看它是无害的。
   */
  reorder: { window: REAL_WINDOW, reorder: true },
  /** 与 relayout 一样，但窗口**真的显示出来**（仍在所有显示器之外）：量「合成」那条前提 */
  shown: { window: REAL_WINDOW, surgery: true, relayout: true, shown: true }
}

app.whenReady().then(async () => {
  const pick = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? ''
  const v = VARIANTS[pick]
  if (!v) {
    console.log(`给一支：${Object.keys(VARIANTS).join(' / ')}`)
    console.log('  另加 --no-flag：不带 disableHtmlFullscreenWindowResize（见文件头第四条）')
    app.exit(1)
    return
  }
  const useFlag = !process.argv.includes('--no-flag')

  const displays = screen.getAllDisplays()
  const origin = {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 1400,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 1000
  }
  const START = { x: origin.x, y: origin.y, width: 900, height: 520 }

  const win = new BaseWindow({ show: false, ...START, ...v.window })
  // shown 那一支要用真的 showInactive；其余换成空操作，屏幕上不会出现任何东西
  win.show = () => {}
  if (!v.shown) win.showInactive = () => {}

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      disableHtmlFullscreenWindowResize: useFlag
    }
  })
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 900, height: 520 })
  const wc = view.webContents

  /*
   * 回调里那两样「窗口手术」，各配一个开关，好一样一样地试。
   * 每一样都照 WindowController 的做法摆：重摆尺寸是窗口与页面视图两层，
   * 重排次序是把一个已在场的子视图再 addChildView 一次。
   */
  const surgeryFor = (fullscreen) => () => {
    if (win.isDestroyed()) return
    try {
      if (v.reorder) win.contentView.addChildView(view)
      if (!v.surgery) return
      const r = fullscreen
        ? screen.getDisplayMatching(win.getBounds()).workArea
        : { x: START.x, y: START.y, width: START.width, height: START.height }
      win.setBounds(r)
      if (v.relayout) view.setBounds({ x: 0, y: 0, width: r.width, height: r.height })
    } catch (err) {
      console.log(`  窗口手术失败：${err.message}`)
    }
  }

  const events = []
  wc.on('enter-html-full-screen', () => {
    events.push('enter')
    const doIt = surgeryFor(true)
    if (v.defer) setImmediate(doIt)
    else doIt()
  })
  wc.on('leave-html-full-screen', () => {
    events.push('leave')
    const doIt = surgeryFor(false)
    if (v.defer) setImmediate(doIt)
    else doIt()
  })

  await wc.loadURL(writePage(pick))
  if (v.shown) win.showInactive()
  await delay(400)

  const workArea = screen.getDisplayMatching(win.getBounds()).workArea
  const state = async () => {
    const fullscreen = await wc
      .executeJavaScript('document.fullscreenElement !== null')
      .catch((e) => `?${e.message?.slice(0, 40)}`)
    const err = await wc.executeJavaScript('window.err').catch(() => '?')
    return `${fullscreen ? '全屏' : '不在'}/报错=${err}`
  }

  console.log(
    `[${pick}${useFlag ? '' : ' --no-flag'}] 工作区=${JSON.stringify(workArea)} 起手=${JSON.stringify(win.getBounds())}`
  )
  /*
   * 三趟。判据看着两条：每一趟的 enter / leave 事件都到，且每一趟进出之后
   * `document.fullscreenElement` 都跟着变。第二趟起坏掉的样子很特别——
   * 值置上了、事件不来，或者事件来了、值退不回去。
   */
  for (let i = 1; i <= 3; i += 1) {
    await wc.executeJavaScript('window.go()', true).catch(() => {})
    await delay(800)
    console.log(`  第 ${i} 趟 进 → ${await state()} 事件=${JSON.stringify(events)} 窗口=${JSON.stringify(win.getBounds())}`)
    await wc.executeJavaScript('window.stop()', true).catch(() => {})
    await delay(800)
    console.log(`  第 ${i} 趟 退 → ${await state()} 事件=${JSON.stringify(events)} 窗口=${JSON.stringify(win.getBounds())}`)
  }

  win.destroy()
  app.exit(0)
})
