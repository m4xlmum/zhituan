/**
 * 探针：**在真身上**开一份本机 PDF，只问这一条线。
 *
 * ## 它补的是哪一块
 *
 * PDF 这条路的量具原来有两支，都够不着这里：
 *
 * - `spike/pdf-scheme.js`（Q54）走的是真的 `pdfReader.ts` 与真的 `pdf.html`，但**它
 *   自己把那条协议的特权交上去**（一次调用，只交 PDF 一条），主进程那一层是它自己
 *   摆的台面；
 * - `spike/pdf-render.js` 连页面都是自己那一份副本（它量的是键控参数）。
 *
 * 于是「**真主进程**打开一份本机 PDF 会怎么样」一直没人量过。2026-09-30 那条
 * 「`registerSchemesAsPrivileged()` 只认最后一次调用」的坑就是从这里进去的：
 * 主进程里三次调用各交一条，前两条被顶掉，而 PDF 恰好是第一条——它的特权形状、
 * 它的 `ses.protocol.handle` 都还在，唯独**渲染进程取不到它的字节**。
 * 症状与「这份 PDF 是坏的」一模一样：这一页只显示一句「打不开这本书：Failed to
 * fetch」，主进程那几条 warn（`PDF 资源通道 404` 之类）一条都不出现。
 *
 * ## 三问
 *
 * - **P1 接线**：视图里加载的**是**自家阅读页，且场上**没有**哪一屏加载的正是那个
 *   `.pdf` 本身。
 * - **P2 页面取得到字节**：阅读页自己 `fetch('zhituan-pdf://doc/<token>')`——字节数
 *   要与磁盘上那份一模一样、头四个字节要是 `%PDF`。这一问就是这整支探针存在的理由。
 * - **P3 pdf.js 要的四样资源取得到**：`cmaps` / `wasm` 各取一份（内容类型与魔术字
 *   一并记下）。这几份资源是 pdf.js **运行时**按需 fetch 的，与 P2 走的是同一条
 *   特权，但走的是另一条主机名（`asset`）——两条都通才算这一页真的能用。
 *
 * 跑法（两个环境坑见 spike/env-pitfalls.js）：
 *   /usr/bin/env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     npx electron --no-sandbox --in-process-gpu spike/pdf-tab.js
 *
 * 素材取自 `spike/out/fixtures/`（`npx electron spike/pdf-render.js fixtures` 造）。
 *
 * 产出：终端一份 [Pn] 报告、spike/out/pdf-tab.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const FIX = path.join(OUT_DIR, 'fixtures')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

let CURRENT = '模块体'
const mark = (what) => {
  CURRENT = what
  process.stdout.write(`…… ${what}\n`)
}

// ------------------------------------------------------------ 抄一份 userData

const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')

/*
 * 与 book-tab.js 同一套两道隔离：`userData` 与 `appData` 都要指到临时目录里去。
 * 只改后者会把用户的真配置写坏；只改前者，主进程里那句改名搬迁会在用户的真目录
 * 上再搬一次整目录（见 book-tab.js 里那一段，以及 docs/spike-findings.md 的 Q68）。
 */
const TEMP = makeTempUserData('zhituan-pdftab-')
const OFF = -4000

const APP_DATA = app.getPath('appData')
const REAL_USER_DATA = [path.join(APP_DATA, 'zhituan'), path.join(APP_DATA, 'moyu-reader')].find(
  (p) => fs.existsSync(p)
)

for (const f of ['config.json', 'history.json', 'bookmarks.json', 'ball-icon.json']) {
  if (!REAL_USER_DATA) break
  try {
    const text = fs.readFileSync(path.join(REAL_USER_DATA, f), 'utf8')
    if (f === 'config.json') {
      const data = JSON.parse(text)
      data.window.x = OFF
      data.window.y = OFF
      // 自动收起会让窗口几秒内缩成球，正文一没就什么都测不成
      data.stealth.autoCollapse = false
      fs.writeFileSync(path.join(TEMP, f), JSON.stringify(data, null, 2), 'utf8')
    } else {
      fs.writeFileSync(path.join(TEMP, f), text, 'utf8')
    }
  } catch {
    // 没有这一份就算了
  }
}

app.setPath('appData', TEMP)
app.setPath('userData', TEMP)

/*
 * 让 `app.getAppPath()` 指回仓库根。
 *
 * pdf.js 那四样资源是主进程按这个值找的（pdfReader.ts 的 assetRoot：`<appPath>/node_modules/pdfjs-dist`），
 * 而 `electron <一支探针>` 起的进程里 appPath 是**那支探针所在的目录**——也就是
 * `spike/`，照这么找会去 `spike/node_modules` 里翻，两份资源都是 404。pdf-scheme.js
 * 为此专门摆了一个有 package.json、有 node_modules 的台面目录；这里一句 setAppPath
 * 就够了（这一支不开 pdf.js 的资源以外的任何东西）。
 */
app.setAppPath(ROOT)

mark('require 真主进程')
require(path.join(ROOT, 'out', 'main', 'index.js'))

if (path.resolve(app.getPath('userData')) !== path.resolve(TEMP)) {
  console.error(`[FAIL] userData 没落到临时目录（落在 ${app.getPath('userData')}），就此退出`)
  app.exit(1)
}

const 收走临时目录 = () => removeTemp(TEMP)

const watchdog = setTimeout(() => {
  console.error(`[FAIL] 探针超时未收场，此刻停在：${CURRENT}`)
  app.exit(1)
}, 90_000)

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
    clearTimeout(watchdog)
    app.exit(1)
  }
})

const fileOf = (url) => {
  if (!url) return '(空)'
  return (url.split(/[\\/]/).pop() || url).split('?')[0]
}

async function main() {
  await delay(3000)

  const 素材 = path.join(FIX, 'panel.pdf')
  if (!fs.existsSync(素材)) {
    throw new Error(`没有这份素材：${素材}（先跑 npx electron spike/pdf-render.js fixtures）`)
  }
  const 字节数 = fs.statSync(素材).size
  const 地址 = pathToFileURL(素材).href

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  {
    const b = win.getBounds()
    const onScreen = screen.getAllDisplays().some((d) => {
      const r = d.bounds
      return b.x < r.x + r.width && r.x < b.x + b.width && b.y < r.y + r.height && r.y < b.y + b.height
    })
    if (onScreen) {
      const xs = screen.getAllDisplays().map((d) => d.bounds.x)
      const ys = screen.getAllDisplays().map((d) => d.bounds.y)
      win.setBounds({ x: Math.min(...xs) - 1400, y: Math.min(...ys) - 1000, width: b.width, height: b.height })
      console.log('[探针] 窗口起在了屏幕上，已当场挪走')
    }
  }

  const children = win.contentView.children
  const chrome = children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  if (!chrome) {
    throw new Error(`认不出界面层：场上是 ${children.map((v) => fileOf(v.webContents.getURL())).join('、')}`)
  }

  // 渲染进程的告警都收着——这一页若被 CSP 或网络层挡住，这里是唯一看得见的地方
  const consoleLines = []
  for (const view of children) {
    const tag = fileOf(view.webContents.getURL())
    view.webContents.on('console-message', (...args) => {
      const [, a, level, message, where, line] = args
      const lv = typeof a === 'object' && a ? a.level : level
      const msg = typeof a === 'object' && a ? a.message : message
      const src = typeof a === 'object' && a ? a.sourceId : where
      const ln = typeof a === 'object' && a ? a.lineNumber : line
      if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) {
        consoleLines.push(`${tag} [${lv}] ${msg} @${fileOf(src)}:${ln}`)
      }
    })
  }

  // ------------------------------------------------------------ 打开这份 PDF

  mark('在真身上把这份 PDF 开成标签页')
  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
  )
  await delay(1200)

  const 这一屏 = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'pdf.html')
  const 掉下去了 = win.contentView.children.find((v) => v.webContents.getURL() === 地址)

  const 读页 = async () => {
    if (!这一屏) return null
    return JSON.parse(
      await 这一屏.webContents.executeJavaScript(`(() => {
        const 画布 = document.querySelector('canvas.sheet')
        return JSON.stringify({
          读数: document.querySelector('.hud__count')?.textContent?.trim() ?? null,
          画布: 画布 ? { 宽: 画布.width, 高: 画布.height, 屏幕宽: 画布.clientWidth } : null,
          写在屏幕上的一句话: document.querySelector('.note')?.textContent?.trim() ?? null
        })
      })()`)
    )
  }

  // ------------------------------------------------------------ P1 接线

  mark('P1 接线')
  {
    const 一 = await 读页()
    /*
     * 等一会儿再读一次：pdf.js 要把 worker 起来、把第一页排完，HUD 才出现。
     * 只读一次的话，一个**好的**实现也会因为「还没排完」被判红。
     */
    let 稳定 = 一
    for (let i = 0; i < 20 && !稳定?.读数; i++) {
      await delay(500)
      稳定 = await 读页()
    }
    const ok = 这一屏 !== undefined && 掉下去了 === undefined && !稳定?.写在屏幕上的一句话
    record('P1', '开一份本机 PDF：视图里加载的是自家阅读页，而不是那个 .pdf 本身吗', ok ? '是' : '不是', {
      素材: { 路径: 素材, 字节数 },
      加载的地址: 这一屏 ? String(这一屏.webContents.getURL()).slice(0, 120) : '(没有这一屏)',
      有没有哪一屏加载的正是那个pdf: 掉下去了 ? String(掉下去了.webContents.getURL()) : '没有',
      稳住之后: 稳定
    })
  }

  // ------------------------------------------------------------ P2 页面取得到字节

  mark('P2 页面自己取一次字节')
  {
    const token = 这一屏 ? (new URL(这一屏.webContents.getURL()).searchParams.get('doc') ?? '') : ''
    /*
     * 从**这一页**里取，不是从主进程取。这正是当初哑掉的那一层：主进程那本账、
     * 那条 handler、`isProtocolHandled` 全都是好的，坏的是渲染进程这一头取不到。
     */
    const 取 = 这一屏
      ? JSON.parse(
          await 这一屏.webContents.executeJavaScript(`(async () => {
        try {
          const r = await fetch('zhituan-pdf://doc/' + ${JSON.stringify(token)})
          const buf = new Uint8Array(await r.arrayBuffer())
          const 头 = String.fromCharCode(...buf.slice(0, 4))
          return JSON.stringify({ 成了: r.ok, 状态: r.status, 类型: r.headers.get('content-type'), 字节数: buf.length, 头四个字节: 头 })
        } catch (err) {
          return JSON.stringify({ 抛了: String(err) })
        }
      })()`)
        )
      : null

    record(
      'P2',
      '阅读页自己 fetch 那份字节取得到吗（字节数与磁盘上那份一样吗）',
      取?.成了 === true && 取?.字节数 === 字节数 && 取?.头四个字节 === '%PDF' ? '是' : '不是',
      {
        token: token ? `${token.slice(0, 8)}…` : '(地址里没有 token)',
        磁盘上那份: { 字节数, 头四个字节: fs.readFileSync(素材).subarray(0, 4).toString('latin1') },
        页面取回来的: 取,
        取不到时该看什么: '主进程那几条 warn（PDF 资源通道 …）若一条都没有，说明请求没走到 handler——那是特权那一层的事'
      }
    )
  }

  // ------------------------------------------------------------ P3 pdf.js 要的四样资源

  mark('P3 pdf.js 运行时那四样资源')
  {
    const 取 = 这一屏
      ? JSON.parse(
          await 这一屏.webContents.executeJavaScript(`(async () => {
        const 出 = []
        for (const u of ['zhituan-pdf://asset/cmaps/UniGB-UCS2-H.bcmap', 'zhituan-pdf://asset/wasm/jbig2.wasm']) {
          try {
            const r = await fetch(u)
            const buf = new Uint8Array(await r.arrayBuffer())
            const 魔术字 = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('')
            出.push({ 地址: u, 成了: r.ok, 状态: r.status, 类型: r.headers.get('content-type'), 字节数: buf.length, 魔术字 })
          } catch (err) {
            出.push({ 地址: u, 抛了: String(err) })
          }
        }
        return JSON.stringify(出)
      })()`)
        )
      : null

    const cmap = 取?.[0] ?? {}
    const wasm = 取?.[1] ?? {}
    record(
      'P3',
      'pdf.js 运行时按需取的那几样资源（cmap / wasm）取得到吗，内容类型对不对',
      cmap.成了 === true && cmap.字节数 > 1000 && wasm.成了 === true && wasm.类型 === 'application/wasm' && wasm.魔术字 === '0061736d'
        ? '是'
        : '不是',
      { 读数: 取, wasm该有的魔术字: '0061736d（pdf.js 走 instantiateStreaming，类型写错会当场拒收）' }
    )
  }

  // ------------------------------------------------------------ 收尾

  mark('收尾，写文件')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'pdf-tab.json')
  fs.writeFileSync(out, JSON.stringify({ 结果: results, 渲染进程的告警: consoleLines }, null, 2), 'utf8')
  console.log(`WROTE ${out}`)
  if (consoleLines.length) {
    console.log('渲染进程的告警：')
    for (const line of consoleLines.slice(0, 25)) console.log(`  ${line}`)
  }
  const bad = results.filter((r) => r.verdict === '不是')
  console.log(`\n${results.length - bad.length}/${results.length} 通过`)
  for (const b of bad) console.log(`  破了 ${b.id}：${b.question}`)
  clearTimeout(watchdog)
  收走临时目录()
  app.exit(0)
}
