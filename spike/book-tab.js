/**
 * 探针：**在真身上**开一本 EPUB，只问这一条线。
 *
 * ## 它补的是哪一块
 *
 * `book-open.js`（Q66）走的是「真的 `bookReader.ts` + 真的 `book.html`」，但它
 * **自己拼好阅读页地址再喂给窗口**——`TabManager.create()` 里那一步被跳过了。
 * 而恰恰是那一步会坏：`kind` 判成 `'book'` 与「视图里加载自家书页」是两件事，
 * 少了后一件，视图会去加载那个 `.epub` 本身，Chromium 只会把它变成一次下载（Q63）。
 * 症状与「这本书是坏的」一模一样。
 *
 * `live-app.js` 的 A13 也走真 `tabs.create`，但它前面压着 A1–A12（约两分半），
 * 而这一条线（书的接线、翻章、滚轮、方向键）本来就该能单独跑。于是这一支做减法：
 * 起重、开书、问完收场。
 *
 * ## 三问
 *
 * - **T1 接线**：视图里加载的**是**自家书页，且场上**没有**哪一屏加载的正是那个
 *   `.epub`。只判前者不够：两个都在（多开一屏）同样是错的。
 * - **T2 读数按时间走一遍**：每 300ms 读一次「第几章 / 共几章」，连着读 15 次。
 *   这一串是为「读数怎么会是 2/2」这类问题用的：只看终值分不清它是**一开始就在
 *   第二章**（装书那一步的问题），还是**读着读着被谁翻过去了**（谁在给这一页送
 *   事件）——两者的修法完全不同，终值却一模一样。
 * - **T3 翻章的两条真通道**：滚轮到章末再滚一下、方向键 `ArrowRight`。这两条都用
 *   `sendInputEvent` 送（走 Chromium 的输入通道），因此顺带把「这一页收不收得到
 *   真实输入」也量了——T2 里那个「被谁翻过去了」的怀疑，正是从这一头否掉的。
 *
 * 跑法（两个环境坑见 spike/env-pitfalls.js）：
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     npx electron --no-sandbox --in-process-gpu spike/book-tab.js
 *
 * 产出：终端一份 [Tn] 报告、spike/out/book-tab.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, webContents: wcModule, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { probeBook } = require('./zip-store.cjs')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * 抄的是**用户自己那一份**数据（只读），因此两个名字都要看。
 *
 * `%APPDATA%\zhituan` 是改名之后的名字，但它只有「用户真跑过一次新版」才会存在；
 * 在那之前数据还躺在 `%APPDATA%\moyu-reader` 下。只看前者的话，这一跑会**静默地**
 * 变成「用默认配置跑」——探针自己不会说，读数照样好看。
 */
const APP_DATA = app.getPath('appData')
const REAL_USER_DATA = [path.join(APP_DATA, 'zhituan'), path.join(APP_DATA, 'moyu-reader')].find((p) =>
  fs.existsSync(p)
)

const results = []
const consoleLines = []
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

/**
 * 这一跑用的临时 userData。
 *
 * 顺手清掉**上次没来得及收走**的那几份：跑法一律是 `timeout N npx electron …`，
 * 探针跑完不会自己退出（Electron 主进程在），因此被 `timeout` 收走是常态——
 * 而在 Windows 上，进程还活着时那几份目录是删不掉的（见 probe-temp.cjs 的文件头）。
 */
const TEMP = makeTempUserData('zhituan-booktab-')
const OFF_X = -4000
const OFF_Y = -4000

for (const f of ['config.json', 'history.json', 'bookmarks.json', 'ball-icon.json']) {
  if (!REAL_USER_DATA) break
  try {
    const text = fs.readFileSync(path.join(REAL_USER_DATA, f), 'utf8')
    if (f === 'config.json') {
      const data = JSON.parse(text)
      data.window.x = OFF_X
      data.window.y = OFF_Y
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

/*
 * 两道隔离，缺一不可——**第二条是踩出来的**。
 *
 * `userData` 管的是「这个 app 把配置、缓存、登录态放哪儿」；而主进程里那句
 * 改名搬迁（`migrateLegacyUserData()`）判的是 **`app.getPath('appData')`** 底下的
 * 两个目录，它读的**不是** userData。只改 userData 的话，探针每跑一次都会在用户
 * 的真目录上做一次 `moyu-reader → zhituan` 的整目录搬运。
 *
 * 而那个搬运会拷到一半失败（真实用户目录里总有文件被别的进程拿着），于是
 * `%APPDATA%\zhituan` 建起来了、内容却是半份——搬迁的条件是「新目录还没建起来」，
 * 一旦它存在就**再也不重试**，用户下次真启动会以为配置全丢了。这不是推演：
 * 2026-09-27 本机就被这么留下过一个只有 4 个条目的 `zhituan`（详见
 * docs/spike-findings.md 的 Q68）。因此 appData 也必须指到临时目录里去。
 */
app.setPath('appData', TEMP)
app.setPath('userData', TEMP)

mark('require 真主进程')
require(path.join(ROOT, 'out', 'main', 'index.js'))

const landed = path.resolve(app.getPath('userData'))
if (landed !== path.resolve(TEMP)) {
  console.error(`[FAIL] userData 没落到临时目录（落在 ${landed}），就此退出，绝不动用户那份`)
  app.exit(1)
}

/**
 * 收走自己建的那份临时 userData。
 *
 * Chromium 在里面开着缓存与锁文件，删不干净是常事，因此只尽力而为、失败不报错——
 * 剩下的那点东西在系统的 %TEMP% 里，比留一个「跑一趟多一份」的无底洞强。
 *
 * 这一步是补上的：先前探针从不清理，而 `app.exit()` **不走 `will-quit`**，
 * 于是每跑一趟就多留一份（2026-09-27 本机一天攒下 6 份、约 350MB）。
 */
const 收走临时目录 = () => {
  /*
   * 尽力而为。**Windows 上多半删不掉**——进程还活着时那一堆 Cache 文件动不了，
   * 而收尾动作不能因为删不干净就把探针弄挂。留下来的那份由**下一次跑动**开头
   * 那个 makeTempUserData 清掉（见 probe-temp.cjs 的文件头：为什么不是「退出时
   * 自己删」而是「下次开工前清旧的」）。
   */
  removeTemp(TEMP)
}

// 被 `timeout` 收走时走这一条（Windows 上不一定送得到，因此正常退出那条更要紧）
for (const 信号 of ['SIGTERM', 'SIGINT']) {
  process.on(信号, () => {
    收走临时目录()
    app.exit(0)
  })
}

const watchdog = setTimeout(() => {
  console.error(`[FAIL] 探针超时未收场，此刻停在：${CURRENT}`)
  app.exit(1)
}, 90_000)

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

app.whenReady().then(async () => {
  mark('whenReady 到了，进 main()')
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

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')

  // 回头核对：窗口真的不在屏幕上吗（ready 之前碰不得 screen）
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

  // 所有渲染进程的告警都收着——书页那一侧若报错，这里是唯一看得见的地方
  for (const view of children) {
    const tag = fileOf(view.webContents.getURL())
    view.webContents.on('console-message', (...args) => {
      const [, a, b, level, message, where, line] = args
      const lv = typeof a === 'object' && a ? a.level : level
      const msg = typeof a === 'object' && a ? a.message : message
      const src = typeof a === 'object' && a ? a.sourceId : where
      const ln = typeof a === 'object' && a ? a.lineNumber : line
      if (lv === 'error' || lv === 'warning' || lv === 3 || lv === 2) {
        consoleLines.push(`${tag} [${lv}] ${msg} @${fileOf(src)}:${ln}`)
      }
    })
  }

  // ------------------------------------------------------------ 开书

  mark('现造一本 EPUB 并开成标签页')
  const 书 = path.join(TEMP, '探针写的书（EPUB）.epub')
  fs.writeFileSync(书, probeBook(), 'binary')
  const 地址 = pathToFileURL(书).href

  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
  )
  await delay(900)

  const 书页 = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'book.html')
  const 掉了下去 = win.contentView.children.find((v) => v.webContents.getURL() === 地址)

  /**
   * 从某一屏书页上读：正文、读数、书的底、书自己的那 48px，以及**压在上面的排版**。
   *
   * 带参数是因为 T5 会再开一屏同一本书（续读要「关掉再打开」），读的要分成两屏看。
   */
  const 读页 = async (view) => {
    if (!view) return null
    return JSON.parse(
      await view.webContents.executeJavaScript(`(() => {
        const sheet = document.querySelector('.sheet')
        const root = sheet ? sheet.shadowRoot : null
        const body = root ? root.querySelector('body') : null
        const css = body ? getComputedStyle(body) : null
        const stage = document.querySelector('.stage')
        return JSON.stringify({
          读数: document.querySelector('.hud__count')?.textContent?.trim() ?? null,
          正文: body ? (body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 44) : null,
          份数: root ? root.querySelectorAll('body').length : 0,
          书的底色: css ? css.backgroundColor : null,
          书的上边距: css ? css.marginTop : null,
          书的样式表: root ? root.querySelectorAll('link[rel=stylesheet]').length : 0,
          字号: css ? css.fontSize : null,
          行距: css ? css.lineHeight : null,
          左留白: css ? css.paddingLeft : null,
          // 留白是百分比，而计算样式给的是 px——要判它，就得知道那个百分比相对于谁
          正文宽: stage ? stage.clientWidth : null,
          滚动: stage ? [stage.scrollTop, stage.scrollHeight, stage.clientHeight] : null,
          目录根数: root ? root.querySelectorAll('a').length : 0,
          写在屏幕上的一句话: document.querySelector('.note')?.textContent?.trim() ?? null
        })
      })()`)
    )
  }

  const 读 = () => 读页(书页)

  // ------------------------------------------------------------ T1 接线

  mark('T1 接线')
  {
    const 一 = await 读()
    const ok = 书页 !== undefined && 掉了下去 === undefined && 一 !== null && !一.写在屏幕上的一句话
    record('T1', '开一本 EPUB：视图里加载的是自家书页，而不是那个 .epub 本身吗', ok ? '是' : '不是', {
      书的地址: 地址,
      加载的地址: 书页 ? String(书页.webContents.getURL()) : '(没有这一屏)',
      有没有哪一屏加载的正是那个epub: 掉了下去 ? String(掉了下去.webContents.getURL()) : '没有',
      场上画着的屏: win.contentView.children
        .filter((v) => {
          try {
            return v.getVisible() === true && v !== chrome
          } catch {
            return false
          }
        })
        .map((v) => fileOf(v.webContents.getURL())),
      刚开出来时的读数: 一
    })
  }

  // ------------------------------------------------------------ T2 读数按时间走一遍

  mark('T2 读数按时间走一遍')
  {
    const 轨迹 = []
    for (let i = 0; i < 15; i++) {
      const r = await 读()
      轨迹.push({ 第几次: i + 1, 读数: r?.读数 ?? null, 滚动: r?.滚动 ?? null })
      if (r?.写在屏幕上的一句话) break
      await delay(300)
    }
    const 起 = 轨迹[0]?.读数
    const 终 = 轨迹[轨迹.length - 1]?.读数
    const 中途变过 = 轨迹.some((t) => t.读数 !== 起)
    record('T2', '刚开出来的那几秒里，读数是自己变的，还是从第一次读就停在某个值上', '记一笔', {
      起: 起,
      终: 终,
      中途变过: 中途变过,
      轨迹
    })
  }

  // ------------------------------------------------------------ T3 两条真通道翻章

  mark('T3 滚轮与方向键')
  {
    const 翻之前 = await 读()

    /*
     * 滚轮：先滚到底，到底之后再滚一下才翻章（与 PDF 那一页同一套手感）。
     * `mouseWheel` 事件要带 `deltaY`，而 Chromium 那一侧收到的 `deltaY` 还要乘
     * 一档倍数——因此这里给一个明显大于 WHEEL_STEP(120) 的值。
     */
    const wc = 书页?.webContents
    const box = 书页 ? 书页.getBounds() : null
    if (wc && box) {
      const x = Math.floor(box.width / 2)
      const y = Math.floor(box.height / 2)
      for (let i = 0; i < 12; i++) {
        wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: 400, canScroll: true })
        await delay(120)
      }
    }
    await delay(600)
    const 滚轮之后 = await 读()

    /*
     * 方向键：`ArrowDown` 先滚一屏，滚不动了才翻章；`ArrowRight` 直接翻章。
     * 用 `keyDown` + `keyUp` 成对送，`keyCode` 也要给——Chromium 靠它认键。
     */
    if (wc) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      wc.sendInputEvent({ type: 'char', keyCode: 'ArrowRight' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
    }
    await delay(900)
    const 方向键之后 = await 读()

    record(
      'T3',
      '这一页收不收得到真实输入：滚轮到章末再滚、方向键 → 各翻不翻章',
      '记一笔',
      {
        翻之前: { 读数: 翻之前?.读数 ?? null, 滚动: 翻之前?.滚动 ?? null },
        滚轮之后: { 读数: 滚轮之后?.读数 ?? null, 滚动: 滚轮之后?.滚动 ?? null },
        方向键之后: { 读数: 方向键之后?.读数 ?? null, 滚动: 方向键之后?.滚动 ?? null }
      }
    )
  }

  // ------------------------------------------------------------ T4 排版三项压过书

  mark('T4 排版三项')
  {
    const 默认 = await 读()
    /*
     * 走**书页自己那座桥**改配置——与右下角那颗「Aa」里拉一下滑块是同一条路
     * （`config.patch` → 广播回来 → 三个自定义属性跟着变）。
     */
    await 书页.webContents.executeJavaScript(
      `window.zhituan.config.patch({ ui: { readerFontSize: 22, readerLineHeight: 2.1, readerMargin: 10 } })`
    )
    await delay(700)
    const 调过 = await 读()

    const num = (v) => Number.parseFloat(String(v ?? ''))
    /*
     * 比的是**比例**，不是 `getComputedStyle` 回来的那几个数——它把无单位的
     * `line-height: 1.85` 与 `padding-left: 6%` 都折算成 px（used value）返回：
     * 17px 那一档读回来的是 `31.45px` / `60.1719px`。照字面值判，一个**完全正确**
     * 的实现会被判成红的（这一版第一跑就是这么红的）。
     */
    const 行距倍 = (r) => num(r?.行距) / (num(r?.字号) || 1)
    const 留白比 = (r) => num(r?.左留白) / (num(r?.正文宽) || 1)

    // 书里写死的是 20px / 1.2：读回来若还是它们，说明我们那一层没压住
    const 压住了 =
      Math.abs(num(默认?.字号) - 17) < 0.5 &&
      Math.abs(行距倍(默认) - 1.85) < 0.03 &&
      Math.abs(留白比(默认) - 0.06) < 0.005
    // 而改完配置它得**当场**跟上，不必重新加载这一章
    const 跟得上 =
      Math.abs(num(调过?.字号) - 22) < 0.5 &&
      Math.abs(行距倍(调过) - 2.1) < 0.03 &&
      Math.abs(留白比(调过) - 0.1) < 0.005

    record(
      'T4',
      '书里写死 20px / 1.2，用户那三项压得过它吗；改一下配置这一页跟不跟得上（不重载章节）',
      压住了 && 跟得上 ? '是' : '不是',
      {
        书里style写的: 'body { font-size: 20px; line-height: 1.2 }',
        比的是比例: '行距 ÷ 字号、左留白 ÷ 正文宽（计算样式给的是 px）',
        默认那一档: {
          读数: 默认,
          行距倍: 行距倍(默认),
          留白比: 留白比(默认)
        },
        改成22px_2_1_10之后: {
          读数: 调过,
          行距倍: 行距倍(调过),
          留白比: 留白比(调过)
        }
      }
    )
  }

  // ------------------------------------------------------------ T5 接着上次读

  mark('T5 接着上次读')
  {
    // 停在第二章（T3 最后一按翻过来的），在里面滚到六成
    await 书页.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('.stage')
      const max = stage.scrollHeight - stage.clientHeight
      stage.scrollTop = Math.round(max * 0.6)
      return String(stage.scrollTop)
    })()`)
    // 滚动停下 600ms 之后书页才把位置报出去（去抖），因此这里等久一点
    await delay(1400)
    const 离开前 = await 读()

    // 再开一屏**同一本书**。主进程那本账按本机路径记，于是这一次的地址里应当
    // 已经带上 `at` 与 `ratio`——续读的答案就在那一行地址上
    const 之前 = win.contentView.children.filter((v) => fileOf(v.webContents.getURL()) === 'book.html')
    await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
    )
    await delay(1800)
    const 新的 = win.contentView.children.find(
      (v) => fileOf(v.webContents.getURL()) === 'book.html' && !之前.includes(v)
    )
    const 回来 = await 读页(新的)

    const 比例 = (r) => {
      if (!r || !r.滚动) return null
      const max = r.滚动[1] - r.滚动[2]
      return max > 0 ? Number((r.滚动[0] / max).toFixed(3)) : 0
    }
    const 同章 = Boolean(回来) && 回来.读数 === 离开前?.读数
    // 排版可能重排，因此比的是**比例**（0.08 是「同一眼」的容差），不是像素
    const 同处 = Math.abs((比例(回来) ?? -1) - (比例(离开前) ?? 0)) <= 0.08

    record('T5', '关掉再打开：回不回得到上次那一章、章内那个位置', 同章 && 同处 ? '是' : '不是', {
      离开前: 离开前 ? { 读数: 离开前.读数, 滚动: 离开前.滚动, 章内比例: 比例(离开前) } : null,
      重开的那一屏地址: 新的 ? String(新的.webContents.getURL()).slice(0, 150) : '(没找到新开的那一屏)',
      回来: 回来 ? { 读数: 回来.读数, 滚动: 回来.滚动, 章内比例: 比例(回来) } : null
    })
    // 多开的那一屏不关：这一跑已经到收尾，清点里多一屏不影响任何一条读数
  }

  // ------------------------------------------------------------ 收尾

  mark('收尾，写文件')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'book-tab.json')
  fs.writeFileSync(
    out,
    JSON.stringify({ 结果: results, 渲染进程的告警: consoleLines, 临时userData: landed, 渲染进程数: wcModule.getAllWebContents().length }, null, 2),
    'utf8'
  )
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
