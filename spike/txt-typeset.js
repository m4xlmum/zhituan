/**
 * 探针：离线阅读的排版三项，端到端走一遍。
 *
 * 问四件事，每件都得有读数：
 *
 *   1. **默认那一组有没有落上去**。本机 TXT 是 Chromium 自己排的，它的排版原先是
 *      UA 给的 `13px monospace / line-height: normal / padding-left: 0`；这一版
 *      起改由配置里那组（17px / 1.85 / 6%）说了算。量的是那个 `pre` **算出来的**
 *      font-size / line-height / padding（不是我们写进去的那串字——写进去而没生效
 *      正是这一条最可能出的坏法）。
 *   2. **顶栏那枚 Aa 键在不在、按下去面板出不出来**。它在读本机文本时可用，
 *      在网页上禁用。
 *   3. **面板里拖一下，正文当场变**。走的是真路：面板是独立子窗口，从主进程
 *      里拿它、在它里面派 `input`，配置一变由 index.ts 的订阅推回 TXT 那一页。
 *   4. **三个方向各自独立**（改字号不动留白，改留白不动字号）。
 *
 * 跑法：npx electron --no-sandbox spike/txt-typeset.js
 *      npx electron --no-sandbox spike/txt-typeset.js --txt <路径>
 * 产出：终端一份读数、spike/out/txt-typeset.json（任一条不成立就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, BrowserWindow } = require('electron')
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

const TEMP = makeTempUserData('zhituan-txttype-')

/** 抄一份用户的数据到临时目录；窗口挪出屏幕之外。排版三项**写成默认值**，好对账 */
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
      data.stealth.autoCollapse = false
      data.ui.readerFontSize = 17
      data.ui.readerLineHeight = 1.85
      data.ui.readerMargin = 6
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
const r2 = (n) => Math.round(n * 100) / 100

/**
 * 量那个 `pre`。
 *
 * 量的是**算出来的值**（`getComputedStyle`），不是写在行内的那串字：
 * 「写进去了、没生效」正是这一条最可能出的坏法——Chromium 给 text/plain 的
 * UA 规则（`pre { font: … }`）与我们的行内声明谁赢，只有算出来才算数。
 */
const 量正文 = (wc) =>
  wc.executeJavaScript(`(() => {
    const p = document.querySelector('pre')
    if (!p) return { pre: false }
    const s = getComputedStyle(p)
    const r = p.getBoundingClientRect()
    return {
      pre: true,
      行内: p.getAttribute('style') || '',
      算出来的字号: s.fontSize,
      算出来的行距: s.lineHeight,
      算出来的左内边距: s.paddingLeft,
      算出来的右内边距: s.paddingRight,
      字体系列: s.fontFamily.split(',')[0],
      盒宽: Math.round(r.width),
      文档高: document.documentElement.scrollHeight
    }
  })()`)

/** 在 chrome 里量那枚 Aa 键 */
const 量键 = (chrome) =>
  chrome.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.topbar button[aria-label="排版"]')
    if (!b) return { 有这枚键: false }
    const r = b.getBoundingClientRect()
    return {
      有这枚键: true,
      文字: b.textContent.trim(),
      禁用: b.disabled,
      矩形: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }
  })()`)

/** 在面板那扇窗里拖某一条滑块 */
const 在面板里拖 = (pop, 第几条, 值) =>
  pop.webContents.executeJavaScript(`(() => {
    const 条 = document.querySelectorAll('.trow')[${第几条}]
    if (!条) return { 找到了: false }
    const el = 条.querySelector('.trange')
    el.value = String(${值})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return { 找到了: true, 标签: 条.querySelector('.tlabel')?.textContent?.trim(), 读数: 条.querySelector('.tvalue')?.textContent?.trim() }
  })()`)

async function main() {
  await delay(4000)

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  const b = win.getBounds()
  win.setBounds({ x: OFF_X, y: OFF_Y, width: b.width, height: b.height })

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
    fs.writeFileSync(书, ('第1章 大唐\n\n    贞观九年，长安城，大街上，人声鼎沸。\n').repeat(20000), 'utf8')
  }
  const 地址 = pathToFileURL(书).href
  const 报告 = { 素材: 书, 字节: fs.statSync(书).size }

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
  await delay(1200)

  console.log(`\n================ 一、默认那组有没有落上去（${path.basename(书)}）================`)
  报告.注入前 = await 量正文(读的那一屏.webContents)
  console.log(`正文      ${JSON.stringify(报告.注入前, null, 0)}`)

  // 期望：字号 17px、行距 1.85×17=31.45px、左右内边距各 6%
  const 盒宽 = 报告.注入前.盒宽
  const 期望左 = r2(盒宽 * 0.06)
  报告.判据一 = {
    字号对: 报告.注入前.算出来的字号 === '17px',
    行距对: Math.abs(parseFloat(报告.注入前.算出来的行距) - 31.45) < 0.6,
    留白对: Math.abs(parseFloat(报告.注入前.算出来的左内边距) - 期望左) < 2
  }
  console.log(`判据一    ${JSON.stringify(报告.判据一)}   （盒宽 ${盒宽}，6% 应是 ${期望左}px）`)

  // ---- 二、顶栏那枚 Aa ----
  console.log(`\n================ 二、顶栏那枚 Aa 键 ================`)
  报告.键_读TXT时 = await 量键(chrome)
  console.log(`读 TXT    ${JSON.stringify(报告.键_读TXT时)}`)

  if (!报告.键_读TXT时.有这枚键) throw new Error('顶栏里没有那枚 Aa 键')

  // 按下去，等面板出来
  await chrome.webContents.executeJavaScript(
    `document.querySelector('.topbar button[aria-label="排版"]').click()`
  )
  let pop = null
  for (let i = 0; i < 30; i++) {
    await delay(200)
    pop = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && /kind=typeset/.test(w.webContents.getURL())
    )
    if (pop) {
      const 好了 = await pop.webContents.executeJavaScript('document.readyState').catch(() => 'loading')
      if (好了 === 'complete') break
    }
  }
  if (!pop) throw new Error('点了 Aa 之后没等到排版面板')

  报告.面板 = {
    地址: pop.webContents.getURL(),
    矩形: pop.getBounds(),
    标题: await pop.webContents.executeJavaScript(
      `document.querySelector('.title')?.textContent?.trim() ?? '(没有标题)'`
    ),
    三行: await pop.webContents.executeJavaScript(
      `[...document.querySelectorAll('.trow')].map((e) => ({
        标签: e.querySelector('.tlabel')?.textContent?.trim(),
        读数: e.querySelector('.tvalue')?.textContent?.trim(),
        值: e.querySelector('.trange')?.value
      }))`
    ),
    提示: await pop.webContents.executeJavaScript(
      `document.querySelector('.hint')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`
    )
  }
  console.log(`面板      ${JSON.stringify(报告.面板, null, 0)}`)

  // 锚点在顶栏 → 面板该摆在锚点**下方**
  const 锚 = 报告.键_读TXT时.矩形
  const 面板顶 = 报告.面板.矩形.y - win.getBounds().y
  报告.判据二 = {
    面板出得来: true,
    摆在锚点下方: 面板顶 >= 锚.y + 锚.h,
    三行齐: 报告.面板.三行.length === 3,
    读数与配置一致: 报告.面板.三行.map((r) => r.值).join(',') === '17,1.85,6'
  }
  console.log(`判据二    ${JSON.stringify(报告.判据二)}`)

  // ---- 三、拖一下，正文当场变 ----
  console.log(`\n================ 三、面板里拖一下 ================`)
  报告.拖字号 = await 在面板里拖(pop, 0, 26)
  await delay(900)
  报告.字号26后 = await 量正文(读的那一屏.webContents)
  console.log(`拖字号到 26  ${JSON.stringify(报告.拖字号)}`)
  console.log(`正文          ${JSON.stringify(报告.字号26后)}`)

  报告.拖留白 = await 在面板里拖(pop, 2, 0)
  await delay(900)
  报告.留白0后 = await 量正文(读的那一屏.webContents)
  console.log(`拖留白到 0   ${JSON.stringify(报告.拖留白)}`)
  console.log(`正文          ${JSON.stringify(报告.留白0后)}`)

  报告.拖行距 = await 在面板里拖(pop, 1, 2.4)
  await delay(900)
  报告.行距24后 = await 量正文(读的那一屏.webContents)
  console.log(`拖行距到 2.4 ${JSON.stringify(报告.拖行距)}`)
  console.log(`正文          ${JSON.stringify(报告.行距24后)}`)

  报告.判据三 = {
    字号当场变: 报告.字号26后.算出来的字号 === '26px',
    行距当场变: Math.abs(parseFloat(报告.行距24后.算出来的行距) - 62.4) < 1,
    留白当场变: parseFloat(报告.留白0后.算出来的左内边距) === 0,
    // 三条互不串门：改留白那一次，字号与行距都还该是「字号 26px 那一组」的值
    // （行距是无单位的 1.85，所以它算出来是 26 × 1.85 = 48.1）
    留白没串字号: 报告.留白0后.算出来的字号 === '26px',
    留白没串行距: Math.abs(parseFloat(报告.留白0后.算出来的行距) - 48.1) < 0.6
  }
  console.log(`判据三    ${JSON.stringify(报告.判据三)}`)

  // 面板自己有没有被裁：那三行加一句话必须整个放得下（面板是固定高度的子窗口）
  报告.面板容纳 = await pop.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.body')
    return { clientH: b.clientHeight, scrollH: b.scrollHeight, 裁掉了: b.scrollHeight - b.clientHeight }
  })()`)
  console.log(`面板容纳  ${JSON.stringify(报告.面板容纳)}`)

  // ---- 四、网页上那枚键该是禁用的 ----
  const 网页 = win.contentView.children.find(
    (v) => v !== chrome && /^https?:/.test(v.webContents.getURL())
  )
  if (网页) {
    await chrome.webContents.executeJavaScript(`(() => {
      const tabs = [...document.querySelectorAll('.tabstrip button, [data-tab]')]
      return tabs.length
    })()`).catch(() => 0)
    // 直接走桥切到那张网页（不依赖标签条上那几个 DOM）
    const 网页id = await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.list().then((s) => (s.tabs.find((t) => /^https?:/.test(t.url)) ?? {}).id ?? null)`
    )
    if (网页id) {
      await chrome.webContents.executeJavaScript(`window.zhituan.tabs.activate({ tabId: ${JSON.stringify(网页id)} })`)
      await delay(900)
      报告.键_读网页时 = await 量键(chrome)
      console.log(`\n切换看一张网页之后：${JSON.stringify(报告.键_读网页时)}`)
      报告.判据四 = { 网页上禁用: 报告.键_读网页时.禁用 === true }
      console.log(`判据四    ${JSON.stringify(报告.判据四)}`)
    }
  } else {
    报告.判据四 = { 说明: '这次没有可切换的网页标签，跳过' }
  }

  const 全过 =
    报告.判据一.字号对 &&
    报告.判据一.行距对 &&
    报告.判据一.留白对 &&
    报告.判据二.摆在锚点下方 &&
    报告.判据二.三行齐 &&
    报告.判据二.读数与配置一致 &&
    Object.entries(报告.判据三).every(([, v]) => v) &&
    报告.面板容纳.裁掉了 === 0 &&
    (报告.判据四.网页上禁用 ?? true)

  报告.结论 = 全过 ? '排版三项端到端成立' : '有判据没过，见上面几条'
  console.log(`\n结论      ${报告.结论}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'txt-typeset.json'), JSON.stringify(报告, null, 2), 'utf8')

  clearTimeout(watchdog)
  收走()
  app.exit(全过 ? 0 : 1)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[FAIL] ${err?.stack ?? err}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
