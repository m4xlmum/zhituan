/**
 * 探针：本机 TXT 的**章区分 + 接着上次读**，在真身上端到端走一遍。
 *
 * 用户要的三件事：读 TXT 记不住位置、要章、要「打开同一个文件直接回到上次那里」。
 * 前两件在 `spike/txt-chapters.js` 里量过（认编码、切章、找章，纯逻辑），这一支量的是
 * **接线之后还成不成立**：真主进程、真标签页、真 `tabs.create`、真那份账
 * （`reading.json`）、真输入事件。
 *
 * T1 接线与章：加载的**是**自家那一页（`txt.html`），场上**没有**哪一屏加载的是
 *    那个 `.txt` 本身；页面上切出来的章数、章名与探针自己切的一致（交叉核对——
 *    否则「章区分」可能只是页面上凑出来的一个数）。
 * T2 翻章：方向键、滚轮到章末再滚一下、目录里点一条。三条都是真输入通道
 *    （滚轮那一格的两处：电子送进去的 `deltaY` 正负与页面上收到的**反着**，
 *    量出来的，见下面那一段）。
 * T3 记账：在章内滚到六成，等它落盘，读 `reading.json`——key 是**本机路径**
 *    （不是 token），值是 `<章序>:<章名>` 与章内比例。
 * T4 关掉再打开（同一份文件、就在旁边再开一屏）：地址里带上 `at` 与 `ratio`，
 *    新开的那一屏落在同一章、同一个位置。这是用户那句「打开这个相同文件的时候
 *    直接返回到上次阅读到的位置」的字面意思。
 * T5 大跨度：把这一屏切到眼前、跳到很靠后的一章，再开一屏——续读不是「只能回到
 *    附近」，而且**旁边那一屏自己再报一次位置也不该把这一笔盖掉**（那一屏还停在
 *    开屏时那一章，见 ipc/registerFileIpc.ts 的 bookReading）。
 *
 * 跑法（**不要**包 `timeout`：Git Bash 的 timeout 起不动 GUI 进程，会静默什么都不跑）：
 *   ./node_modules/electron/dist/electron.exe --no-sandbox spike/txt-resume.js
 *     给一本别的：--txt <路径>
 * 产出：终端一份 [Tn] 报告、spike/out/txt-resume.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, webContents: wcModule, screen, ipcMain } = require('electron')
const { spawnSync } = require('node:child_process')
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

/**
 * 切章那一套从**真源码**里现编一份出来（`src/shared/txt.ts`），不在这里复刻。
 *
 * 不走 `require('esbuild')` 的 JS API：它在主进程里会拿 `process.execPath` 去起
 * 自己的服务进程，而 Electron 里那个 execPath 是 electron.exe，起出来的不是 esbuild。
 * 命令行那一支是一个**原生 exe**，从哪儿起都行。
 */
const 共享 = path.join(OUT_DIR, 'txt-shared.cjs')
fs.mkdirSync(OUT_DIR, { recursive: true })
{
  const esbuildExe = [
    path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(ROOT, 'node_modules', '.bin', 'esbuild.cmd')
  ].find((p) => fs.existsSync(p))
  if (!esbuildExe) throw new Error('找不到 esbuild，无法从真源码里编出切章那一套')
  const 编 = spawnSync(
    esbuildExe,
    [
      path.join(ROOT, 'src', 'shared', 'txt.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${共享}`
    ],
    { encoding: 'utf8' }
  )
  if (编.status !== 0) throw new Error(`编 src/shared/txt.ts 失败：${编.stderr || 编.stdout}`)
}
const { decodeText, splitChapters, formatMark, parseMark } = require(共享)

// ------------------------------------------------------------ 抄一份 userData

const TEMP = makeTempUserData('zhituan-txtresume-')
const APP_DATA = app.getPath('appData')
const REAL_USER_DATA = [path.join(APP_DATA, 'zhituan'), path.join(APP_DATA, 'moyu-reader')].find((p) =>
  fs.existsSync(p)
)

/*
 * 只抄配置与书签那几份：**`reading.json` 不抄**。这一支要看的正是「从零开始读，
 * 它记得住吗」，带着用户自己那份账进来就分不清哪一条是这一跑记下的。
 */
for (const f of ['config.json', 'history.json', 'bookmarks.json', 'ball-icon.json']) {
  if (!REAL_USER_DATA) break
  try {
    const text = fs.readFileSync(path.join(REAL_USER_DATA, f), 'utf8')
    if (f === 'config.json') {
      const data = JSON.parse(text)
      data.window.x = OFF_X
      data.window.y = OFF_Y
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
/**
 * 收场的看门狗。
 *
 * 不走 `timeout`（见文件头），因此这一条就是唯一的时间上限；它比整套动作宽一倍以上，
 * 只在「哪儿卡住了」时才响。
 */
const watchdog = setTimeout(() => {
  console.error(`[FAIL] 探针超时未收场，此刻停在：${CURRENT}`)
  app.exit(1)
}, 200_000)

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

const results = []
const consoleLines = []

/**
 * 阅读页报回来的每一笔位置，都在这里留一份底。
 *
 * 主进程自己那一份处理照跑（探针只是**又挂了一个听众**，不动它）：有了这条轨迹，
 * 「账没更新」就能当场分成两半——是页面上根本没报，还是报了、主进程没收下。
 */
const 上报 = []
/** 各屏的生死与重载（见「开」里挂的那两条）。读数解释不通时看它 */
const 生死 = []
ipcMain.on('book:reading', (event, input) => {  const from = wcModule.fromId(event.sender.id)
  上报.push({
    id: event.sender.id,
    谁: from ? fileOf(from.getURL()) : '(认不出)',
    chapter: input?.chapter ?? null,
    ratio: typeof input?.ratio === 'number' ? Number(input.ratio.toFixed(3)) : null
  })
})

function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  /*
   * 判词常常在这一句**之后**才算得出来（要先把读数摆上去），于是这里只在已经有判词时
   * 才印它——不然每一问都会先印一行 `[T1] undefined — …`，读日志的人得往下找一行
   * 才知道成没成。没有判词时那一行由随后那句 `→ 是 / 不是` 收尾。
   */
  console.log(verdict === undefined ? `[${id}] — ${question}` : `[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

let CURRENT = '模块体'
const mark = (what) => {
  CURRENT = what
  process.stdout.write(`…… ${what}\n`)
}

const fileOf = (url) => {
  if (!url) return '(空)'
  return (url.split(/[\\/]/).pop() || url).split('?')[0]
}
const 参数 = (url, 名) => new URL(url).searchParams.get(名)

/** 从某一屏页面上读：章名、序号、正文头、章内滚动位置 */
const 读页 = async (view) => {
  if (!view) return null
  return JSON.parse(
    await view.webContents.executeJavaScript(`(() => {
      const body = document.querySelector('.txt__body')
      const stage = document.querySelector('.stage')
      const hud = document.querySelector('.hud__count')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null
      const m = hud ? /(\\d+)\\/(\\d+)$/.exec(hud) : null
      return JSON.stringify({
        章名: document.querySelector('.txt__head')?.textContent?.trim() ?? null,
        序号: m ? Number(m[1]) : null,
        章数: m ? Number(m[2]) : null,
        正文头: body ? (body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26) : null,
        正文长: body ? body.textContent.length : 0,
        滚动: stage ? [stage.scrollTop, stage.scrollHeight, stage.clientHeight] : null,
        地址: location.href
      })
    })()`)
  )
}

/** 章内比例。`滚动` 是 [top, 内容高, 视口高] */
const 比例 = (r) => {
  if (!r || !r.滚动) return null
  const max = r.滚动[1] - r.滚动[2]
  return max > 0 ? Number((r.滚动[0] / max).toFixed(3)) : 0
}

/** 场上各屏都是谁（带着 webContents 的号——认得出「这一笔是谁报的」要用它） */
const 各屏 = (win) =>
  win.contentView.children.map((v) => ({ 谁: fileOf(v.webContents.getURL()), id: v.webContents.id }))

async function main() {
  await delay(3500)

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

  // ------------------------------------------------------------ 素材

  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null
  let 书 = 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
  if (!书) {
    书 = path.join(TEMP, '探针写的一本.txt')
    // 每章都够长，章内才滚得动
    fs.writeFileSync(
      书,
      Array.from({ length: 60 }, (_, i) => `第${i + 1}章 第${i + 1}回\n\n${'    贞观九年，长安城，大街上，人声鼎沸。\n'.repeat(60)}`).join('\n'),
      'utf8'
    )
  }
  const 地址 = pathToFileURL(书).href

  // 探针自己切一遍（与页面上那一遍对账）
  const 字节 = fs.readFileSync(书)
  const 解 = decodeText(字节)
  const 真章 = splitChapters(解.text)
  console.log(
    `…… 素材 ${书}（${字节.length} 字节，认成 ${解.encoding}）\n   探针自己切成 ${真章.length} 章，第一章「${真章[0].title}」`
  )

  const 开 = async () => {
    const 之前 = win.contentView.children.filter((v) => fileOf(v.webContents.getURL()) === 'txt.html')
    await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
    )
    for (let i = 0; i < 60; i++) {
      await delay(250)
      const 新的 = win.contentView.children.find(
        (v) => fileOf(v.webContents.getURL()) === 'txt.html' && !之前.includes(v)
      )
      if (新的) {
        const 好了 = await 新的.webContents
          .executeJavaScript(`Boolean(document.querySelector('.txt__body'))`)
          .catch(() => false)
        if (好了) {
          /*
           * 盯住这一屏的生死与重载。开出来的那一屏如果**后来被销毁或重新加载**过，
           * 这一支量的东西就换了一个对象——那正是「账被谁改回去了」这类读数的分水岭，
           * 因此留一条轨迹。
           */
          新的.webContents.on('destroyed', () => 生死.push(`${新的.webContents.id} 没了`))
          新的.webContents.on('did-start-loading', () => 生死.push(`${新的.webContents.id} 开始加载`))
          return 新的
        }
      }
    }
    throw new Error('没等到新开的那一屏 TXT 阅读页')
  }

  // ------------------------------------------------------------ T1

  mark('T1 接线与章')
  const 页 = await 开()
  const 第一眼 = await 读页(页)
  const 掉到文件上 = win.contentView.children.find((v) => v.webContents.getURL() === 地址) ?? null
  record('T1', '加载的是自家那一页吗；章与探针自己切的一致吗', undefined, {
    地址: String(页.webContents.getURL()).slice(0, 120),
    场上各屏: win.contentView.children.map((v) => fileOf(v.webContents.getURL())),
    第一眼: 第一眼,
    探针切的章数: 真章.length,
    探针切的第一章: 真章[0].title
  })
  results[results.length - 1].verdict =
    fileOf(页.webContents.getURL()) === 'txt.html' &&
    !掉到文件上 &&
    第一眼?.章数 === 真章.length &&
    第一眼?.章名 === 真章[0].title
      ? '是'
      : '不是'
  console.log(`      → ${results[results.length - 1].verdict}`)

  // ------------------------------------------------------------ T2

  mark('T2 翻章的三条通道')
  const 序0 = 第一眼.序号
  const wc = 页.webContents
  // 方向键
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  wc.sendInputEvent({ type: 'char', keyCode: 'ArrowRight' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await delay(900)
  const 方向键后 = await 读页(页)

  /*
   * 滚轮：先把这一章滚到底（`scrollTop` 直接写到底，省掉几十次真滚动），再真送几格
   * 滚轮——要验的是**章末那一格会不会翻章**，不是「滚得动滚不动」。
   *
   * 两处读数都是量出来的，不是猜的：
   *   · 送之前先在页面上挂一个只数数的听众（`window.__wheels`）：滚轮走的是**合成器**
   *     那条路，「没送到页面」与「送到了但没翻章」是两种坏法，数得零就分得开。
   *   · `deltaY` 给的是**负**的：电子那边送进去的正负与页面上 `event.deltaY` 的正负
   *     是反的（这一支先按正的送过一遍，读数里章内位置不升反降，说明页面收到的是
   *     往上滚）。负着送，页面上才是「往下滚」，与真鼠标一致。
   */
  const 滚到底 = await wc.executeJavaScript(`(() => {
    const st = document.querySelector('.stage')
    window.__wheels = 0
    st.addEventListener('wheel', () => { window.__wheels++ }, { capture: true })
    st.scrollTop = st.scrollHeight
    return { top: st.scrollTop, 内容高: st.scrollHeight, 视口高: st.clientHeight }
  })()`)
  await delay(500)
  for (let i = 0; i < 3; i++) {
    wc.sendInputEvent({ type: 'mouseWheel', x: 500, y: 300, deltaX: 0, deltaY: -400, canScroll: true })
    await delay(200)
  }
  await delay(900)
  const 滚轮后 = await 读页(页)
  const 滚轮收到几个 = await wc.executeJavaScript('window.__wheels ?? null')

  // 目录里点一条：跳到第 12 章（序号 12 = 下标 11）
  const 目标 = Math.min(11, 真章.length - 1)
  await wc.executeJavaScript(`(() => {
    const 目录键 = [...document.querySelectorAll('.hud__key')].find((b) => b.textContent.trim() === '目录')
    目录键.click()
    return true
  })()`)
  await delay(400)
  const 目录 = JSON.parse(
    await wc.executeJavaScript(`(() => {
      const 条 = [...document.querySelectorAll('.toc__item')]
      return JSON.stringify({
        条数: 条.length,
        高亮的是第几条: 条.findIndex((e) => e.classList.contains('on')) + 1,
        第一条文字: 条[0]?.textContent?.trim() ?? null,
        面板滚动到的位置: document.querySelector('.toc')?.scrollTop ?? null
      })
    })()`)
  )
  await wc.executeJavaScript(`document.querySelectorAll('.toc__item')[${目标}].click()`)
  await delay(900)
  const 目录后 = await 读页(页)

  record('T2', '方向键 / 滚轮到章末 / 目录里点一条，三条都能翻章吗', undefined, {
    起始序号: 序0,
    方向键后: { 序号: 方向键后?.序号, 章名: 方向键后?.章名 },
    滚到底的读数: 滚到底,
    滚轮后: { 序号: 滚轮后?.序号, 章名: 滚轮后?.章名, 滚动: 滚轮后?.滚动 },
    滚轮送到页面几个: 滚轮收到几个,
    目录: 目录,
    目录点第几条: 目标,
    目录后: { 序号: 目录后?.序号, 章名: 目录后?.章名, 正文头: 目录后?.正文头 },
    对着探针切的: 真章[目标].title,
    各屏: 各屏(win),
    这一段页面上报回来的位置: 上报.slice()
  })
  results[results.length - 1].verdict =
    方向键后?.序号 === 序0 + 1 &&
    滚轮后?.序号 === 序0 + 2 &&
    目录后?.序号 === 目标 + 1 &&
    目录后?.章名 === 真章[目标].title &&
    目录.条数 === 真章.length &&
    目录.高亮的是第几条 === 滚轮后?.序号
      ? '是'
      : '不是'
  console.log(`      → ${results[results.length - 1].verdict}`)

  // ------------------------------------------------------------ T3

  mark('T3 记账：滚到六成，看那份账')
  await wc.executeJavaScript(`(() => {
    const st = document.querySelector('.stage')
    const max = st.scrollHeight - st.clientHeight
    st.scrollTop = Math.round(max * 0.6)
    return st.scrollTop
  })()`)
  // 滚动停下 600ms 之后才报（去抖），报完 1500ms 才落盘（见 readingStore）
  await delay(2600)
  const 离开前 = await 读页(页)
  const 账 = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(TEMP, 'reading.json'), 'utf8'))
    } catch (err) {
      return { 读不出来: String(err?.message ?? err) }
    }
  })()
  const 这一条 = 账[书] ?? null
  const 记号 = 这一条 ? parseMark(这一条.chapter) : null
  record('T3', 'reading.json 里记的是这一份文件、这一章、这个位置吗', undefined, {
    账文件: path.join(TEMP, 'reading.json'),
    '账的 key（应当是本机路径）': Object.keys(账),
    这一条: 这一条,
    页面上: { 序号: 离开前?.序号, 章名: 离开前?.章名, 章内比例: 比例(离开前) }
  })
  results[results.length - 1].verdict =
    这一条 &&
    记号 &&
    记号.index === (离开前?.序号 ?? 0) - 1 &&
    记号.title === 离开前?.章名 &&
    Math.abs((这一条.ratio ?? -1) - (比例(离开前) ?? 0)) <= 0.05
      ? '是'
      : '不是'
  console.log(`      → ${results[results.length - 1].verdict}`)

  // ------------------------------------------------------------ T4

  mark('T4 就在旁边再开一屏同一份文件')
  const 第二屏 = await 开()
  const 回来 = await 读页(第二屏)
  record('T4', '新开的一屏落在同一章、同一个位置吗（地址里带 at 与 ratio）', undefined, {
    第二屏地址: String(第二屏.webContents.getURL()).slice(-90),
    地址里的at: 参数(第二屏.webContents.getURL(), 'at'),
    地址里的ratio: 参数(第二屏.webContents.getURL(), 'ratio'),
    离开前: { 序号: 离开前?.序号, 章名: 离开前?.章名, 章内比例: 比例(离开前) },
    回来: { 序号: 回来?.序号, 章名: 回来?.章名, 章内比例: 比例(回来) }
  })
  results[results.length - 1].verdict =
    回来?.序号 === 离开前?.序号 &&
    回来?.章名 === 离开前?.章名 &&
    Math.abs((比例(回来) ?? -1) - (比例(离开前) ?? 0)) <= 0.08
      ? '是'
      : '不是'
  console.log(`      → ${results[results.length - 1].verdict}`)

  // ------------------------------------------------------------ T5

  mark('T5 大跨度：跳到很靠后的一章，再开一屏')
  const 远 = Math.max(0, Math.min(真章.length - 200, 200))
  /*
   * 先把第一屏切到眼前再翻——用户就是这么做的，而这一条也是 1.6.9 那处修正的判据：
   * 只有**眼前这一屏**报回来的位置算数（见 ipc/registerFileIpc.ts 的 bookReading）。
   * 此刻 T4 开的第二屏在上面，它停在开屏时的第 11 章，并且会在几秒后自己再报一次
   * ——那一笔不该盖掉这里翻到的第 200 章。
   */
  const 第一屏id = await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.list().then((s) => {
      const 命中 = s.tabs.filter((t) => t.url === ${JSON.stringify(地址)})
      return 命中.length ? 命中[0].id : null
    })`
  )
  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.activate({ tabId: ${JSON.stringify(第一屏id)} })`
  )
  await delay(700)
  await wc.executeJavaScript(`(() => {
    const 目录键 = [...document.querySelectorAll('.hud__key')].find((b) => b.textContent.trim() === '目录')
    目录键.click()
    return true
  })()`)
  await delay(400)
  await wc.executeJavaScript(`document.querySelectorAll('.toc__item')[${远}].click()`)
  await delay(2600)
  const 远处 = await 读页(页)
  const 账_远处 = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(TEMP, 'reading.json'), 'utf8'))[书] ?? null
    } catch (err) {
      return { 读不出来: String(err?.message ?? err) }
    }
  })()
  const 第三屏 = await 开()
  const 远处回来 = await 读页(第三屏)
  record('T5', `跳到第 ${远 + 1} 章之后再开一屏，还回得到那一章吗`, undefined, {
    第一屏的id: 第一屏id,
    远处: { 序号: 远处?.序号, 章名: 远处?.章名, 章内比例: 比例(远处) },
    探针切的第若干章: 真章[远].title,
    跳到远处之后账里那一笔: 账_远处,
    第三屏: { 序号: 远处回来?.序号, 章名: 远处回来?.章名 },
    第三屏地址里的at: 参数(第三屏.webContents.getURL(), 'at'),
    各屏: 各屏(win),
    这一段页面上报回来的位置: 上报.slice(-6)
  })
  results[results.length - 1].verdict =
    远处?.序号 === 远 + 1 &&
    账_远处?.chapter === formatMark(远, 真章[远].title) &&
    远处回来?.序号 === 远 + 1 &&
    远处回来?.章名 === 真章[远].title
      ? '是'
      : '不是'
  console.log(`      → ${results[results.length - 1].verdict}`)

  // ------------------------------------------------------------ 收尾

  mark('收尾，写文件')
  const out = path.join(OUT_DIR, 'txt-resume.json')
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        结果: results,
        素材: { 路径: 书, 字节: 字节.length, 编码: 解.encoding, 章数: 真章.length },
        页面上报回来的位置: 上报,
        各屏的生死: 生死,
        渲染进程的告警: consoleLines,
        渲染进程数: wcModule.getAllWebContents().length,
        临时userData: 落点
      },
      null,
      2
    ),
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
  收走()
  app.exit(bad.length ? 1 : 0)
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
