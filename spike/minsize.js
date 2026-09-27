/**
 * 探针：无边框透明窗口最小能缩到多大。
 *
 * 「收起成球」把窗口设成 28×28。如果 Windows 或 Electron 把它卡在某个下限上，
 * 窗口就比球大，而球是 inset:0 + 50% 圆角的，于是被拉成一个椭圆——这正是
 * 用户报的「球形扭曲」。这个脚本把窗口摆到所有显示器之外再试，
 * 屏幕上不会出现任何东西。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, screen } = require('electron')

/** 找一个所有显示器之外的落点，保证窗口永远不可见 */
function offscreenOrigin() {
  const displays = screen.getAllDisplays()
  const left = Math.min(...displays.map((d) => d.bounds.x))
  const top = Math.min(...displays.map((d) => d.bounds.y))
  return { x: left - 800, y: top - 800 }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const origin = offscreenOrigin()
  const origin2 = { x: origin.x - 400, y: origin.y }
  const report = { origin, cases: [] }

  // 与 windowController.create() 里那扇窗同参数
  const win = new BaseWindow({
    x: origin.x,
    y: origin.y,
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'zhituan-minsize-probe'
  })

  const want = [
    { width: 28, height: 28 },
    { width: 40, height: 40 },
    { width: 60, height: 60 },
    { width: 96, height: 96 },
    { width: 120, height: 36 }
  ]

  // 先按隐藏窗口试一遍
  for (const size of want) {
    win.setBounds({ x: origin.x, y: origin.y, ...size })
    await delay(80)
    report.cases.push({ phase: 'hidden', want: size, got: win.getBounds() })
  }

  // 再让它真的显示出来（在屏幕外），看可见窗口是否被另眼相待
  win.setBounds({ x: origin2.x, y: origin2.y, width: 400, height: 300 })
  win.showInactive()
  await delay(250)
  report.shownAt = win.getBounds()

  for (const size of want) {
    win.setBounds({ x: origin2.x, y: origin2.y, ...size })
    await delay(120)
    report.cases.push({ phase: 'shown', want: size, got: win.getBounds() })
  }

  // 顺带确认一下有没有 setMinimumSize 之类的隐性下限
  report.minimumSize = win.getMinimumSize()

  console.log('ZHITUAN_MINSIZE ' + JSON.stringify(report))

  win.destroy()
  app.exit(0)
})
