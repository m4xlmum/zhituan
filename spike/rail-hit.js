/**
 * 探针：**用户那个窗口尺寸下**，右栏第三条「阅读」滑块到底被谁接着。
 *
 * ## 为什么要有这一支
 *
 * 用户报「读 TXT 时拖那条『阅读』滑块，拖了一点变化都没有」。已经查清的两件事：
 *
 *   1. 机制是活的（`live-app.js` 的 A12 在小书上、`txt-big-opacity.js` 在用户那本
 *      6.4MB 小说上都量到像素跟着动：幅 255 → 102 → 255）；
 *   2. `preview.js` 的 RAIL_STACK 量到**右栏在 903×508 下溢出 26px**——
 *      而 903×508 正是用户 `config.json` 里记着的窗口尺寸。
 *
 * 「机制对 + 底部 26px 被裁」还解释不了「拖了一点变化都没有」。这一支上去量三件
 * 前面没量过的事：
 *
 *   - **右栏的账**：`.stack` 的 clientHeight / scrollHeight / scrollTop，
 *     三条滑块各自**旋转之后**真正占的那块矩形（布局盒是横的，转完才是竖的）；
 *   - **命中**：沿着第三条往下打一串 `elementFromPoint`，看每一段像素归谁——
 *     被裁掉的那 26px 是还归滑块，还是漏给了 `.rail`（漏给 `.rail` 就等于
 *     「按下去变成拖窗口」，那正好是「拖了没反应」）；
 *   - **真拖一次**：不用合成事件（合成事件绕过了命中与裁剪，A12 走的就是那条路，
 *     所以它证明不了用户那一下），改用 `sendInputEvent` 派**真鼠标输入**，
 *     从拇指位置往下拖，然后读配置里那一项有没有变。
 *
 * 跑法：npx electron --no-sandbox spike/rail-hit.js
 *      npx electron --no-sandbox spike/rail-hit.js --w 960 --h 540
 * 产出：终端一份读数、spike/out/rail-hit.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const USER_TXT = 'C:\\Users\\poem\\Desktop\\带着战略仓库回大唐.txt'
const OFF_X = -4000
const OFF_Y = -4000

const 参数 = (名, 默认) => {
  const i = process.argv.indexOf(名)
  return i >= 0 ? Number(process.argv[i + 1]) : 默认
}
/** 默认就是用户 config.json 里记着的那一对；另一档给 960×540 做对照 */
const W = 参数('--w', 903)
const H = 参数('--h', 508)

const TEMP = makeTempUserData('zhituan-railhit-')

function 抄一份(realDir) {
  for (const f of ['config.json', 'history.json', 'bookmarks.json', 'ball-icon.json']) {
    if (!realDir) break
    try {
      const text = fs.readFileSync(path.join(realDir, f), 'utf8')
      if (f !== 'config.json') {
        fs.writeFileSync(path.join(TEMP, f), text, 'utf8')
        continue
      }
      const data = JSON.parse(text)
      data.window.x = OFF_X
      data.window.y = OFF_Y
      data.window.width = W
      data.window.height = H
      data.stealth.autoCollapse = false
      // 从一个确定的值起步：这样「拖完还是 100」和「拖完变成别的」区分得开
      data.ui.readerOpacity = 1
      fs.writeFileSync(path.join(TEMP, f), JSON.stringify(data, null, 2), 'utf8')
    } catch {
      // 没有这一份就算了
    }
  }
}

const APP_DATA = app.getPath('appData')
const REAL_USER_DATA = [path.join(APP_DATA, 'zhituan'), path.join(APP_DATA, 'moyu-reader')].find((p) =>
  fs.existsSync(p)
)
抄一份(REAL_USER_DATA)

app.setPath('appData', TEMP)
app.setPath('userData', TEMP)

require(path.join(ROOT, 'out', 'main', 'index.js'))

const 落点 = path.resolve(app.getPath('userData'))
if (落点 !== path.resolve(TEMP)) {
  console.error(`[FAIL] userData 没落到临时目录（落在 ${落点}），就此退出，绝不动用户那份`)
  app.exit(1)
}

const 收走 = () => removeTemp(TEMP)
for (const 信号 of ['SIGTERM', 'SIGINT']) {
  process.on(信号, () => {
    收走()
    app.exit(0)
  })
}
const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场')
  app.exit(1)
}, 150_000)

const fileOf = (url) => (!url ? '(空)' : (url.split(/[\\/]/).pop() || url).split('?')[0])

/**
 * 打在界面层里的一段脚本：把右栏的账与命中逐条量出来。
 *
 * 两个细节：
 *   - **旋转之后的矩形要自己算**。`getBoundingClientRect()` 给的是**变换之后**的
 *     矩形，所以滑块那一条直接读它就对了（布局盒是 56×14 的横条，转完是 14×56）。
 *     但 `.track-wrap` 是布局盒，量它是为了对照「槽」在哪；
 *   - `elementFromPoint` 用的是**视口坐标**，与 `getBoundingClientRect()` 同一套，
 *     因此可以直接把 rect 的中点喂进去。
 */
const 量脚本 = `(() => {
  // 这一段是在**渲染进程**里跑的，Node 那边的东西一个都拿不到——四舍五入自己带一份
  const r1 = (n) => Math.round(n * 10) / 10
  const rect = (e) => {
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }
  }
  const rail = document.querySelector('.rail')
  const stack = document.querySelector('.rail .stack')
  const 三条 = [...document.querySelectorAll('.rail .opacity')].map((box) => {
    const wrap = box.querySelector('.track-wrap')
    const el = box.querySelector('.slider')
    const r = el.getBoundingClientRect()
    return {
      标签: box.querySelector('.label')?.textContent?.trim(),
      读数: box.querySelector('.value')?.textContent?.trim(),
      禁用: el.disabled,
      格rect: rect(box),
      槽rect: rect(wrap),
      滑块rect: { x: r1(r.left), y: r1(r.top), w: r1(r.width), h: r1(r.height), bottom: r1(r.bottom) },
      滑块的transform: getComputedStyle(el).transform,
      // 拇指在 0–100 里的位置：min 在「旋转后的下端」，max 在上端
      拇指中点y: r1(r.top + 7 + (1 - Number(el.value) / 100) * (r.height - 14))
    }
  })
  // 沿第三条的滑块矩形从上到下打一排点，看每一段归谁
  const 三 = 三条[2]
  const 命中 = []
  if (三) {
    const x = Math.round(三.滑块rect.x + 三.滑块rect.w / 2)
    for (let y = 三.滑块rect.y; y <= 三.滑块rect.bottom; y += 4) {
      const e = document.elementFromPoint(x, y)
      命中.push({
        y,
        归: e ? (e.classList?.contains('slider') ? '滑块' : e.className || e.tagName) : '(null)',
        在可视区内: y < (stack ? stack.getBoundingClientRect().bottom : Infinity)
      })
    }
  }
  // 另打一条：沿整条右栏从上到下的每一格，看最底下还有什么
  const 栏内 = []
  if (stack) {
    const sr = stack.getBoundingClientRect()
    const x = Math.round(sr.left + sr.width / 2)
    for (let y = Math.round(sr.top) + 2; y <= Math.round(sr.bottom) + 8; y += 6) {
      const e = document.elementFromPoint(x, y)
      栏内.push({ y, 归: e ? (e.className || e.tagName) : '(null)' })
    }
  }
  return {
    界面: { 宽: window.innerWidth, 高: window.innerHeight, 缩放: window.devicePixelRatio },
    栏rect: rect(rail),
    栈: stack ? {
      rect: rect(stack),
      clientHeight: stack.clientHeight,
      scrollHeight: stack.scrollHeight,
      scrollTop: stack.scrollTop,
      溢出: stack.scrollHeight - stack.clientHeight
    } : null,
    三条,
    命中,
    栏内
  }
})()`

/** 读活配置里那一项 */
const 读配置 = (chrome) =>
  chrome.webContents.executeJavaScript(
    `window.zhituan.config.get().then((c) => c.ui.readerOpacity).catch(() => '(读不到)')`
  )

async function main() {
  await delay(4000)

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  win.setBounds({ x: OFF_X, y: OFF_Y, width: W, height: H })
  await delay(600)

  const chrome = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  if (!chrome) {
    throw new Error(
      `认不出界面层：场上是 ${win.contentView.children.map((v) => fileOf(v.webContents.getURL())).join('、')}`
    )
  }

  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null
  let 书 = 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
  if (!书) {
    书 = path.join(TEMP, '探针写的大样本.txt')
    fs.writeFileSync(书, ('第1章 大唐\n\n    贞观九年，长安城，大街上，人声鼎沸。\n').repeat(120000), 'utf8')
  }
  const 地址 = pathToFileURL(书).href
  const 报告 = { 素材: 书, 字节: fs.statSync(书).size, 窗口: { 宽: W, 高: H } }

  console.log(`…… 开这一本：${书}（${报告.字节} 字节）`)
  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
  )

  let 读的那一屏 = null
  for (let i = 0; i < 60; i++) {
    await delay(500)
    读的那一屏 = win.contentView.children.find((v) => v.webContents.getURL() === 地址)
    if (读的那一屏) {
      const 好了 = await 读的那一屏.webContents.executeJavaScript('document.readyState').catch(() => 'loading')
      if (好了 === 'complete') break
    }
  }
  if (!读的那一屏) throw new Error('没等到那一屏：按地址找不到那个视图')
  await delay(800)

  报告.右栏 = await chrome.webContents.executeJavaScript(量脚本)

  console.log(`\n================ 右栏几何（窗口 ${W}×${H}）================`)
  console.log(`界面      ${JSON.stringify(报告.右栏.界面)}`)
  console.log(`栈        ${JSON.stringify(报告.右栏.栈)}`)
  for (const 条 of 报告.右栏.三条) {
    console.log(
      `  ${条.标签}\t禁用=${条.禁用}\t读数=${条.读数}\t格=${JSON.stringify(条.格rect)}\t滑块(转后)=${JSON.stringify(条.滑块rect)}`
    )
  }

  // 命中的那条竖线：把「归谁」压成若干段，读起来才不像天书
  const 段 = []
  for (const p of 报告.右栏.命中) {
    const 末 = 段[段.length - 1]
    if (末 && 末.归 === p.归) 末.到 = p.y
    else 段.push({ 归: p.归, 从: p.y, 到: p.y, 在可视区内: p.在可视区内 })
  }
  console.log(`\n第三条滑块那条竖线上的命中（从 y=${报告.右栏.命中[0]?.y} 往下）：`)
  for (const s of 段) console.log(`  ${String(s.从).padStart(4)}–${String(s.到).padStart(4)}  ${s.归}`)
  报告.命中分段 = 段

  // ---- 真拖一次 ----------------------------------------------------------
  const 三 = 报告.右栏.三条[2]
  if (!三) throw new Error('右栏里没有第三条滑块')

  const 前 = await 读配置(chrome)
  const 起点 = { x: Math.round(三.滑块rect.x + 三.滑块rect.w / 2), y: Math.round(三.拇指中点y) }

  console.log(`\n================ 真拖一次（sendInputEvent）================`)
  console.log(`起点      (${起点.x}, ${起点.y})  那是拇指的中心`)

  const 归谁 = await chrome.webContents.executeJavaScript(
    `(() => {
      const e = document.elementFromPoint(${起点.x}, ${起点.y})
      return e ? { 类名: e.className || e.tagName, 是滑块: e.classList?.contains('slider') ?? false, 是栏: e.classList?.contains('rail') ?? false } : null
    })()`
  )
  console.log(`起点归谁  ${JSON.stringify(归谁)}`)

  try {
    win.focus()
  } catch {
    // 屏幕外的窗口拿不到焦点也无妨
  }
  chrome.webContents.focus()
  await delay(300)

  const 输入 = (type, x, y) =>
    chrome.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: [] })

  输入('mouseDown', 起点.x, 起点.y)
  await delay(60)
  // 往下拖 30px：1 落在滑块上、途中会越过栈底那 26px 的裁剪线
  for (let d = 5; d <= 30; d += 5) {
    输入('mouseMove', 起点.x, 起点.y + d)
    await delay(70)
  }
  输入('mouseUp', 起点.x, 起点.y + 30)
  await delay(700)

  const 后 = await 读配置(chrome)
  const 拖后界面 = await chrome.webContents.executeJavaScript(`(() => {
    const box = [...document.querySelectorAll('.rail .opacity')].find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
    const el = box?.querySelector('.slider')
    return { 读数: box?.querySelector('.value')?.textContent?.trim(), el值: el?.value, 栈scrollTop: document.querySelector('.rail .stack')?.scrollTop }
  })()`)

  报告.起点 = 起点
  报告.起点归谁 = 归谁
  报告.真拖 = { 拖之前配置: 前, 拖之后配置: 后, 拖之后界面: 拖后界面 }

  const 变了吗 = typeof 前 === 'number' && typeof 后 === 'number' && Math.abs(前 - 后) > 0.01
  console.log(`拖之前配置 ${前}`)
  console.log(`拖之后配置 ${后}`)
  console.log(`拖之后界面 ${JSON.stringify(拖后界面)}`)
  console.log(`结论      ${变了吗 ? `真鼠标拖动能改到配置（${前} → ${后}）` : '真鼠标拖动改不到配置：这一下没落到滑块上，或落到滑块上也没被处理'}`)
  报告.结论 = 变了吗 ? '真鼠标拖动能改到配置' : '真鼠标拖动改不到配置'

  // 再从别的几个 y 上各试一次，看是不是只有某几段能拖
  const 逐段 = []
  for (const 比例 of [0.15, 0.35, 0.55, 0.75, 0.95]) {
    const y = Math.round(三.滑块rect.y + 三.滑块rect.h * 比例)
    const x = Math.round(三.滑块rect.x + 三.滑块rect.w / 2)
    输入('mouseDown', x, y)
    await delay(60)
    输入('mouseMove', x, Math.min(y + 24, Math.round(三.滑块rect.bottom)))
    await delay(80)
    输入('mouseUp', x, Math.min(y + 24, Math.round(三.滑块rect.bottom)))
    await delay(400)
    const 值 = await chrome.webContents.executeJavaScript(
      `(() => { const box = [...document.querySelectorAll('.rail .opacity')].find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读'); return box?.querySelector('.slider')?.value })()`
    )
    逐段.push({ 比例, y, 拖后el值: 值 })
  }
  报告.逐段 = 逐段
  console.log(`\n沿第三条从上往下按下并拖 24px，逐段看滑块值：`)
  for (const s of 逐段) console.log(`  y 比例 ${s.比例}\ty=${String(s.y).padStart(4)}\t拖后值=${s.拖后el值}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'rail-hit.json'), JSON.stringify(报告, null, 2), 'utf8')

  clearTimeout(watchdog)
  收走()
  app.exit(0)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[FAIL] ${err?.stack ?? err}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
