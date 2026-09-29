/**
 * 探针：**大 TXT**（几百万像素高的那一本）上，右栏第三条滑块还成不成立。
 *
 * ## 为什么要有这一支
 *
 * 用户报「读 TXT 时那条『阅读』滑块拖了一点变化都没有」。`live-app.js` 的 A12
 * 在**探针现写的一本小书**上量到它是活的（幅 255 → 102 → 255），而用户读的那本
 * 是 6.4MB / 354 万字 / 文档高 **308 万像素**的整本小说——`spike/txt-page.js` 先把
 * 这一页的形状量清楚了：354 万字全在一个 `<pre>` 里，`documentElement.scrollHeight`
 * 是 3 089 261。
 *
 * 这一支因此只问一件事：**把 `opacity` 写在一个三百万像素高的合成层上，合成器
 * 到底照不照做。** 只读 CSS 值是分不出来的（`spike/txt-page.js` 已经证明行内
 * `opacity: 0.4 !important` 写得进去、`getComputedStyle` 也回 0.4），只有把
 * **合成之后的像素**量一遍才有答案——这一条正是 A12 对小书验过的同一件事。
 *
 * ## 与 live-app 的分工
 *
 * 它不重复 live-app 那一整套（起始页、标签、托盘、面板…），只借它的**起跑方式**：
 * 抄一份 userData 到临时目录、把窗口摆到屏幕外、require 真主进程、走真桥开标签。
 * 量法（明暗幅）与 A12 逐字相同，因此两边读数可以直接对看。
 *
 * 素材：默认拿用户机器上那本真的（只读，绝不改动它）；找不到就现写一本等大的。
 * 想换一本：`npx electron spike/txt-big-opacity.js --txt <路径>`
 *
 * 跑法：npx electron spike/txt-big-opacity.js
 * 产出：终端一份读数、spike/out/txt-big-opacity.json（像素没跟着动就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const USER_TXT = 'C:\\Users\\poem\\Desktop\\带着战略仓库回大唐.txt'
/** 与 live-app 同一个屏幕外坐标 */
const OFF_X = -4000
const OFF_Y = -4000

const TEMP = makeTempUserData('zhituan-txtbig-')

/** 抄一份用户的数据到临时目录；config 里把窗口挪出屏幕、关掉自动收起 */
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

/*
 * 两道隔离，与 live-app 逐字同理（见那个文件里那段注释）：userData 管「东西放哪儿」，
 * 而主进程里那句改名搬迁判的是 appData——只改前者会在用户的真目录上做整目录搬运。
 */
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
 * 一张截图里的明暗分布。**与 live-app 的 A12 逐字相同**，两边读数才对得上。
 *
 * 这一屏的纸是透明的（本机文件那条注入的样式表把白底收掉了），因此两种底各算一份：
 *   「在黑上」= 亮度 × alpha（贴在黑桌面上看到的样子）
 *   「在白上」= 亮度 × alpha + 255 × (1 − alpha)（贴在白纸上的样子）
 * 判据用**幅**（最深与最浅之差）：整体乘一个数，幅就按同一个数缩。
 */
function 明暗(img) {
  const { width, height } = img.getSize()
  const bgra = img.toBitmap()
  let 黑上最深 = 255
  let 黑上最浅 = 0
  let 白上最深 = 255
  let 白上最浅 = 0
  let 透的 = 0
  let 数了 = 0
  for (let i = 0; i + 3 < bgra.length; i += 16) {
    const b = bgra[i]
    const g = bgra[i + 1]
    const r = bgra[i + 2]
    const a = bgra[i + 3]
    数了++
    if (a === 0) 透的++
    const 亮度 = 0.114 * b + 0.587 * g + 0.299 * r
    const 黑上 = (亮度 * a) / 255
    const 白上 = (亮度 * a) / 255 + (255 * (255 - a)) / 255
    if (黑上 < 黑上最深) 黑上最深 = 黑上
    if (黑上 > 黑上最浅) 黑上最浅 = 黑上
    if (白上 < 白上最深) 白上最深 = 白上
    if (白上 > 白上最浅) 白上最浅 = 白上
  }
  const r0 = (n) => Math.round(n)
  return {
    尺寸: `${width}×${height}`,
    采样: 数了,
    透明像素占比: Number((透的 / 数了).toFixed(3)),
    黑上: { 最深: r0(黑上最深), 最浅: r0(黑上最浅), 幅: r0(黑上最浅 - 黑上最深) },
    白上: { 最深: r0(白上最深), 最浅: r0(白上最浅), 幅: r0(白上最浅 - 白上最深) }
  }
}

async function main() {
  await delay(4000)

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  const b = win.getBounds()
  win.setBounds({ x: OFF_X, y: OFF_Y, width: b.width, height: b.height })

  const chrome = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  if (!chrome) {
    throw new Error(`认不出界面层：场上是 ${win.contentView.children.map((v) => fileOf(v.webContents.getURL())).join('、')}`)
  }

  // 素材：先看命令行，再看用户那本，最后现写一本等大的
  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null
  let 书 = 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
  if (!书) {
    书 = path.join(TEMP, '探针写的大样本.txt')
    fs.writeFileSync(书, ('第1章 大唐\n\n    贞观九年，长安城，大街上，人声鼎沸。\n').repeat(120000), 'utf8')
  }
  const 地址 = pathToFileURL(书).href
  const 报告 = { 素材: 书, 字节: fs.statSync(书).size }

  console.log(`…… 开这一本：${书}（${报告.字节} 字节）`)
  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
  )

  // 那一屏要等它建出来、还要等 354 万字排完版；按地址逐字认，不按 file: 前缀
  let 读的那一屏 = null
  for (let i = 0; i < 60; i++) {
    await delay(500)
    读的那一屏 = win.contentView.children.find((v) => v.webContents.getURL() === 地址)
    if (读的那一屏) {
      const 好了 = await 读的那一屏.webContents
        .executeJavaScript('document.readyState')
        .catch(() => 'loading')
      if (好了 === 'complete') break
    }
  }
  if (!读的那一屏) throw new Error('没等到那一屏：按地址找不到那个视图')

  报告.形状 = await 读的那一屏.webContents.executeJavaScript(`(() => ({
    characterSet: document.characterSet,
    pre字数: document.querySelector('pre')?.textContent.length ?? 0,
    文档高: document.documentElement.scrollHeight
  }))()`)
  console.log(`…… 这一页：${JSON.stringify(报告.形状)}`)

  const 读样式 = () =>
    读的那一屏.webContents
      .executeJavaScript('getComputedStyle(document.documentElement).opacity')
      .catch(() => '(读不到)')
  const 拍 = async () => {
    await delay(600)
    return 明暗(await 读的那一屏.webContents.capturePage({ x: 0, y: 0, width: 800, height: 460 }))
  }
  /** 走真路：拖那条滑块（合成事件，与 A10 / A12 同一套） */
  const 拖到 = (值) =>
    chrome.webContents.executeJavaScript(`(() => {
      const box = [...document.querySelectorAll('.rail .opacity')]
        .find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
      if (!box) return '没有那一条滑块'
      const el = box.querySelector('.slider')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.value = String(${值})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      return { 禁用: el.disabled, 值: el.value }
    })()`)

  报告.淡之前 = await 拍()
  报告.淡之前样式 = await 读样式()
  报告.拖动结果 = await 拖到(40)
  console.log(`…… 拖动那条滑块：${JSON.stringify(报告.拖动结果)}`)
  报告.淡到04 = await 拍()
  报告.淡到04样式 = await 读样式()
  await 拖到(100)
  报告.拉回100 = await 拍()
  报告.拉回100样式 = await 读样式()

  // 判据：样式算出来是 0.4，而且**合成之后的像素幅也跟着缩到四成上下**
  const 前 = 报告.淡之前.白上.幅
  const 后 = 报告.淡到04.白上.幅
  const 回 = 报告.拉回100.白上.幅
  报告.幅缩到 = { 淡到04: 前 ? Number((后 / 前).toFixed(3)) : null, 拉回之后: 前 ? Number((回 / 前).toFixed(3)) : null }
  报告.结论 =
    报告.淡到04样式 === '0.4' && 后 < 前 * 0.75 && 回 > 前 * 0.9
      ? '像素跟着动了：这一条在大 TXT 上也成立'
      : '像素没跟着动：写进去了、合成器没照做（或没重画）'

  console.log(`\n================ 大 TXT 上的阅读透明度 ================`)
  console.log(`素材      ${报告.素材}（${报告.字节} 字节）`)
  console.log(`形状      ${JSON.stringify(报告.形状)}`)
  console.log(`拖动      ${JSON.stringify(报告.拖动结果)}`)
  console.log(`淡之前    ${JSON.stringify(报告.淡之前)}   算出 ${报告.淡之前样式}`)
  console.log(`淡到 04   ${JSON.stringify(报告.淡到04)}   算出 ${报告.淡到04样式}`)
  console.log(`拉回 100  ${JSON.stringify(报告.拉回100)}   算出 ${报告.拉回100样式}`)
  console.log(`幅缩到    ${JSON.stringify(报告.幅缩到)}`)
  console.log(`结论      ${报告.结论}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'txt-big-opacity.json'), JSON.stringify(报告, null, 2), 'utf8')

  clearTimeout(watchdog)
  收走()
  app.exit(报告.结论.startsWith('像素跟着动了') ? 0 : 1)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[FAIL] ${err?.stack ?? err}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
