/**
 * 把右栏最上面那几格开关的图标**放大**画出来看一眼，顺带拍一张原样的。
 *
 * 右栏那些图标都是 15px 上下、一格一个，全部靠 24 视框里的几条路径说话；
 * 这么小的尺寸上「画得对不对」量不出来——两条路径之间空 1 个单位是分得开还是
 * 连成一团墨，只有看图。1.6.11 画「移出即收起」那一枚时就靠它抓到了问题：
 * 原来那支箭头离框壁只有 1.5 个单位（14px 上的 0.87px，比 1.6 的描边还窄），
 * 与隔壁同样是个方框的 'stop' 连成了一片，头挪到 18.5 才分开。
 *
 * 放大那几张不是另画一遍：是从真界面上把那三枚 <svg> 抠下来、改宽高再拼成一排，
 * 因此量的是**产品里真渲染出来的那份路径**，不是这一段里重写的一份。
 *
 * 跑法：/usr/bin/env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *         npx electron --no-sandbox --in-process-gpu spike/icon-shot.js
 * 产出：spike/out/icon-shot-rail.png（原样那一列，1:1）
 *       spike/out/icon-shot-big.png （同样的三枚，72px 与 14px 各一遍）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const OFF_X = -4000
const OFF_Y = -4000
const W = 1280
const H = 720

const TEMP = makeTempUserData('zhituan-iconshot-')
app.setPath('appData', TEMP)
app.setPath('userData', TEMP)

require(path.join(ROOT, 'out', 'main', 'index.js'))

const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场')
  app.exit(1)
}, 120_000)

const fileOf = (url) => (!url ? '(空)' : (url.split(/[\\/]/).pop() || url).split('?')[0])

/** 把三枚图标抠出来，放大拼一排；宽高改了、viewBox 没动，因此是按比例放大的原路径 */
const 拼放大图 = () =>
  `(() => {
    const 格 = [...document.querySelectorAll('.rail .stack > .item')].slice(0, 3)
    if (格.length < 3) return null
    const 盒 = document.createElement('div')
    盒.id = 'probe-iconshot'
    盒.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;background:#ffffff;color:#111111;' +
      'padding:20px 24px;display:flex;gap:44px;align-items:center;font:12px/1 system-ui'
    for (const b of 格) {
      const svg = b.querySelector('svg')
      if (!svg) continue
      const 列 = document.createElement('div')
      列.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px'
      const 大 = svg.cloneNode(true)
      大.setAttribute('width', '72')
      大.setAttribute('height', '72')
      列.appendChild(大)
      const 小 = svg.cloneNode(true)
      小.setAttribute('width', '14')
      小.setAttribute('height', '14')
      列.appendChild(小)
      const 字 = document.createElement('div')
      字.textContent = (b.title || '').split(' · ')[0]
      列.appendChild(字)
      盒.appendChild(列)
    }
    document.body.appendChild(盒)
    const r = 盒.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  })()`

async function main() {
  await delay(4500)
  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  win.setBounds({ x: OFF_X, y: OFF_Y, width: W, height: H })
  await delay(800)

  const chrome = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  if (!chrome) {
    throw new Error(
      `认不出界面层：场上是 ${win.contentView.children.map((v) => fileOf(v.webContents.getURL())).join('、')}`
    )
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  // 一、原样的那一列（1:1，看它在栏里挨着谁、亮不亮）
  const 栏 = await chrome.webContents.executeJavaScript(`(() => {
    const s = document.querySelector('.rail .stack')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: 140 }
  })()`)
  if (栏) {
    const img = await chrome.webContents.capturePage(栏)
    fs.writeFileSync(path.join(OUT_DIR, 'icon-shot-rail.png'), img.toPNG())
    console.log(`WROTE spike/out/icon-shot-rail.png  ${JSON.stringify(栏)}`)
  }

  // 二、放大的那三枚
  const 盒 = await chrome.webContents.executeJavaScript(拼放大图())
  if (!盒) throw new Error('抠不到右栏最上面那三格')
  await delay(300)
  const img = await chrome.webContents.capturePage(盒)
  fs.writeFileSync(path.join(OUT_DIR, 'icon-shot-big.png'), img.toPNG())
  console.log(`WROTE spike/out/icon-shot-big.png  ${JSON.stringify(盒)}`)

  clearTimeout(watchdog)
  removeTemp(TEMP)
  app.exit(0)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[FAIL] ${err?.stack ?? err}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
