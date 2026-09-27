/**
 * 探针：**在真身上**问那几件事——真主进程（out/main/index.js）、真 preload、
 * 真的站点 / 历史 / 书签、真的那一份配置。窗口挪到屏幕外，也从不显示。
 *
 * ## 与 home-layer.js 的分工
 *
 * home-layer.js 验的是视图层次那条不变量，用的是探针自己拼的服务与假桥。
 * 这一跑验的是**另外两半**，两半都是以前的探针照不到的：
 *
 *   1. index.ts 亲手装配的那一整套在场时（托盘、老板键、面板、更新服务……），
 *      点顶栏那颗「起始页」键之后，正文区那一点到底归谁——这正是用户那一刻的处境；
 *   2. 起始页那一份文档在**真桥**上活着没有：拿不拿得到 window.zhituan、点栏目换不换栏、
 *      点行开不开标签页。以前那些探针全用假桥喂 `window.zhituan`，若毛病出在真桥上，
 *      它们一个都照不出来，而用户报的正是「点了没反应」；
 *   3. 配置写进口袋之后，界面手里那份镜像跟不跟得上（A10 / A11）。这条线由
 *      index.ts 亲手接（ConfigStore 的订阅 → 广播），别的探针都够不着——它们
 *      要么自己拼服务、要么用假桥。整体透明度那条滑块跳回 100% 就是这么来的。
 *   4. 本机 TXT 那一屏上的**像素**（A12）。离线阅读的透明度，在这一屏上是主进程
 *      往那一页注入的一条 CSS——界面侧看不见、DOM 也不变，只有把那一屏合成之后的
 *      像素量一遍，才知道「淡下去」是真的发生了。（同一个滑块在 PDF 那一页上落的是
 *      另一处：我们的画布自己画的纸，由 pdf-scheme.js 的 Q9 量。）
 *
 * ## 为什么要抄一份 userData
 *
 * 行是按真数据算出来的，而假桥喂的那几笔与真数据不一样。抄到临时目录、
 * 把窗口挪到屏幕外（那里从没有光标，用户什么也看不见），跑完即弃。
 * `app.setPath('userData', …)` 必须在 require 真主进程**之前**——index.ts
 * 在模块体里就把 userData 读走了（第 47 行）。抄完之后立刻回头确认真的落在
 * 临时目录，没落到就当场退出：绝不碰用户那一份。
 *
 * ## 点击怎么送
 *
 * `webContents.sendInputEvent` 走的是 Chromium 的输入通道：按下、松开、click
 * 整套都是真的，与用户那一下只差**跨视图的原生命中测试**。那一层由第 1 条
 * 按原生规矩算出来（矩形含这一点、画着的孩子里层次最大的那个），两半分开验。
 *
 * ## 两道防卡死的闸
 *
 * 第一次跑它挂住了，而且**挂过了看门狗**——那不是某一步慢，是主进程那一根线
 * 被谁按住了（定时器也跟着不响）。于是加了两样：
 *
 *   - **心跳**：每 3 秒往 stdout 打一行「此刻停在哪」，从模块体就开始打。
 *     日志停在哪个字上，就是哪一步把主进程按住了。
 *   - **每一问都带上时限**：渲染进程若某一问不答，别的问不能跟着一起陪葬。
 *
 * 跑法：npx electron spike/live-app.js  （终端只显示 [An] 与心跳，心跳可忽略）
 * 产出：终端一份 [An] 报告、spike/out/live-app.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, webContents: wcModule, screen } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

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

// A13 要一本真的 EPUB，而**不能去读用户机器上任何真实文件**（与 A12 那一本同一条规矩）：
// 那本书由 zip-store.cjs 现造，实现与理由都在那个文件头里
const { probeBook } = require('./zip-store.cjs')

const results = []
const consoleLines = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

// ------------------------------------------------------------ 心跳
//
// 心跳的作用只有一个：**它一停，就说明主进程那一根线被按住了**。
// 因此它从模块体就开始打，比真主进程还早一步。

let CURRENT = '模块体'
let beats = 0
const beat = setInterval(() => {
  beats++
  process.stdout.write(`[心跳 ${beats}] 停在：${CURRENT}\n`)
}, 3000)

const mark = (what) => {
  CURRENT = what
  process.stdout.write(`…… ${what}\n`)
}

/** 一question一答，答不上来也不能把整跑拖住 */
const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`等太久了（${ms}ms）：${what}`)), ms))
  ])

// ------------------------------------------------------------ 抄一份 userData

const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')

/**
 * 这一跑用的临时 userData。顺手清掉上次没收走的那几份，理由见 probe-temp.cjs。
 */
const TEMP = makeTempUserData('zhituan-live-')

/*
 * 屏幕之外的那个位置**必须写死**。
 *
 * 抄配置这一步得赶在 require 真主进程之前（它的 whenReady 一进来就按配置开窗），
 * 而 ready 之前**碰不得 screen**——碰了会当场抛
 * 「The 'screen' module can't be used before the app 'ready' event」，
 * 探针就停在模块体里，看起来是「挂住了」，实则是加载时那一行抛了。
 * 这一跤已经摔过一次。
 *
 * 于是取一个任何排布都不可能落在屏幕上的坐标；真起来之后再回头用 screen
 * 核对一遍（见 main() 里那一段：若窗口真的压在屏幕上，立刻挪走并记一笔）。
 */
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
      /*
       * 自动收起会让窗口几秒内缩成球（这台机器上的光标不在屏幕外那个位置），
       * 正文一没就什么都测不成。它管的是「鼠标离开就藏起来」，与这一跑要问的
       * 「点得动点不动」不是同一条线，因此这里把它关掉。
       */
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
mark('真主进程已载入，等 whenReady')

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
}, 150_000)

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

// 真主进程的 whenReady 先跑（它在 require 时就挂上了），这一句排在它后面
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

// ------------------------------------------------------------ 认场上的东西

const fileOf = (url) => {
  if (!url) return '(空)'
  return (url.split(/[\\/]/).pop() || url).split('?')[0]
}
const hostOf = (url) => {
  try {
    return new URL(url).host || fileOf(url)
  } catch {
    return fileOf(url)
  }
}

async function main() {
  await delay(4000)

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')

  /*
   * 回头核对：窗口真的不在屏幕上吗。
   *
   * 抄配置里的坐标是写死的（ready 之前碰不得 screen），万一这台机器的排布恰好
   * 落在那里，这一句会发现，并且**当场把它挪出去**——用户说过改代码时不要弹窗。
   */
  {
    const b = win.getBounds()
    const onScreen = screen.getAllDisplays().some((d) => {
      const r = d.bounds
      return b.x < r.x + r.width && r.x < b.x + b.width && b.y < r.y + r.height && r.y < b.y + b.height
    })
    if (onScreen) {
      const xs = screen.getAllDisplays().map((d) => d.bounds.x)
      const ys = screen.getAllDisplays().map((d) => d.bounds.y)
      const offX = Math.min(...xs) - 1400
      const offY = Math.min(...ys) - 1000
      win.setBounds({ x: offX, y: offY, width: b.width, height: b.height })
      consoleLines.push(`[探针] 窗口起在了屏幕上（${JSON.stringify(b)}），已当场挪到 ${offX},${offY}`)
    }
  }
  const children = win.contentView.children
  const chrome = children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  const home = children.find((v) => fileOf(v.webContents.getURL()) === 'home.html')
  if (!chrome || !home) {
    throw new Error(
      `认不出界面层 / 起始页：场上是 ${children.map((v) => fileOf(v.webContents.getURL())).join('、')}`
    )
  }

  /*
   * 每一问都带上时限：直接改这两个 webContents 身上的 executeJavaScript。
   * 放在这里而不是改每一处调用，是为了让下面那一段读起来仍是一份「问题的清单」。
   */
  for (const [who, view] of [['界面层', chrome], ['起始页', home]]) {
    const raw = view.webContents.executeJavaScript.bind(view.webContents)
    view.webContents.executeJavaScript = (code) =>
      withTimeout(raw(code), 10_000, `${who}上的 ${String(code).replace(/\s+/g, ' ').slice(0, 50)}`)
  }

  // 每次界面层被动一次次序时记一笔——顺手记下是谁叫的
  //
  // 注意**第二个参数必须原样转交**：让回那一步是 `addChildView(chrome, 0)`，
  // 转交时把它丢了就等于换成「抬到最上面」，于是探针亲手把被测的那一步改成
  // 它的反面，报出来的还是「没修好」。这一跤也摔过一次。
  const moves = []
  const rawAdd = win.contentView.addChildView.bind(win.contentView)
  win.contentView.addChildView = (view, index) => {
    if (view === chrome) {
      const stack = (new Error().stack || '')
        .split('\n')
        .slice(2, 5)
        .map((s) => s.trim().replace(ROOT, '.'))
      moves.push({ 序号: moves.length + 1, 去处: index === 0 ? '回最底下' : '到最上面', 栈: stack })
    }
    return rawAdd(view, index)
  }

  for (const view of children) {
    const tag = fileOf(view.webContents.getURL())
    view.webContents.on('console-message', (...args) => {
      const [, a, b, c, d] = args
      const level = typeof a === 'object' && a ? a.level : a
      const message = typeof a === 'object' && a ? a.message : b
      const where = typeof a === 'object' && a ? a.sourceId : d
      const line = typeof a === 'object' && a ? a.lineNumber : c
      if (level === 'error' || level === 'warning' || level === 3 || level === 2) {
        consoleLines.push(`${tag} [${level}] ${message} @${fileOf(where)}:${line}`)
      }
    })
  }

  const nameOf = (v) => (v === chrome ? '界面层' : fileOf(v.webContents.getURL()))
  const vis = (v) => {
    try {
      return v.getVisible()
    } catch {
      return null
    }
  }
  const box = (v) => {
    try {
      const r = v.getBounds()
      return [r.x, r.y, r.width, r.height]
    } catch {
      return null
    }
  }
  const layers = () =>
    win.contentView.children.map((v, i) => ({ 层: i, 谁: nameOf(v), 画着: vis(v), 矩形: box(v) }))

  /** 原生那一侧的规矩：矩形含这一点、**画着**的孩子里层次最大的那个 */
  const whoTakesPoint = (x, y) => {
    const hits = win.contentView.children.filter((v) => {
      if (vis(v) !== true) return false
      const r = box(v)
      return r && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]
    })
    return {
      归谁: hits[hits.length - 1] ?? null,
      叠着: hits.map(nameOf)
    }
  }

  /** 正文区正中间那一点。正文的矩形由起始页那一层自己说出来 */
  const bodyPoint = () => {
    const r = box(home)
    return { x: r[0] + Math.floor(r[2] / 2), y: r[1] + Math.floor(r[3] / 2) }
  }

  /**
   * 问「正文区正中间那一点归谁」，以及它**该**归谁。
   *
   * want 有两种给法：一份具体的视图（起始页），或者 'page'——归**某一屏网页**就行，
   * 别是界面层。后者用在「此刻停在哪一屏随流程走」的那几步上（点行开出来的那一页）。
   */
  const invariant = (id, question, want, note = {}) => {
    const p = bodyPoint()
    const who = whoTakesPoint(p.x, p.y)
    const ok = want === 'page' ? !!who.归谁 && who.归谁 !== chrome : who.归谁 === want
    const active = win.contentView.children.filter((v) => vis(v) === true && v !== chrome)
    record(id, question, ok ? '是' : '不是', {
      点: [p.x, p.y],
      该归谁: want === 'page' ? '(某一屏网页)' : nameOf(want),
      画着的屏: active.map(nameOf),
      那一点归谁: who.归谁 ? nameOf(who.归谁) : '(没人)',
      叠着: who.叠着,
      层序: layers(),
      ...note
    })
    return ok
  }

  const press = async (wc, x, y) => {
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    await delay(60)
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await delay(60)
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(350)
  }
  const centerOf = async (wc, selector) =>
    JSON.parse(
      await wc.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return 'null'
        const r = el.getBoundingClientRect()
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
      })()`)
    )

  // ------------------------------------------------------------ A0 启动之后

  mark('A0 记一笔启动之后的场')
  {
    const p = bodyPoint()
    const who = whoTakesPoint(p.x, p.y)
    record('A0', '（底色）真 app 启动完之后，场上是什么、正文区那一点归谁', '记一笔', {
      点: [p.x, p.y],
      停在哪: children.filter((v) => vis(v) === true && v !== chrome).map(nameOf),
      那一点归谁: who.归谁 ? nameOf(who.归谁) : '(没人)',
      叠着: who.叠着,
      层序: layers()
    })
  }

  // ------------------------------------------------------------ A1 点顶栏那颗「起始页」键
  //
  // 用户报的那一下就是这个处境：他先看到的是恢复回来的网页，点顶栏那颗键回起始页，
  // 然后在起始页上点点点——没反应。

  mark('A1 点界面层上那颗「起始页」键')
  {
    const at = await centerOf(chrome.webContents, 'button[aria-label="起始页"]')
    await press(chrome.webContents, at.x, at.y)
    await delay(900)
    invariant('A1', '点顶栏「起始页」键回起始页之后，正文区那一点归起始页吗', home, {
      点的是界面层上的: [at.x, at.y]
    })
  }

  // ------------------------------------------------------------ A2 这一份文档

  mark('A2 问起始页那一份文档')
  {
    const state = JSON.parse(
      await home.webContents.executeJavaScript(`JSON.stringify({
        加载到: document.readyState,
        桥: typeof window.zhituan,
        桥上的键: window.zhituan ? Object.keys(window.zhituan).sort() : [],
        栏目: [...document.querySelectorAll('.plates .plate')].map((e) => e.dataset.plate),
        行数: document.querySelectorAll('.lines .line').length,
        当前栏: document.querySelector('.plate.on')?.dataset.plate ?? null,
        头一行: document.querySelector('.lines .line .label')?.textContent?.trim() ?? null,
        开头几个字: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 70)
      })`)
    )
    const ok = state.桥 === 'object' && state.加载到 === 'complete'
    record('A2', '起始页在真桥上活着吗（拿得到 window.zhituan、行是按真数据算出来的吗）', ok ? '是' : '不是', state)
  }

  // ------------------------------------------------------------ A3 点栏目换不换栏

  mark('A3 点「刷题」那一栏')
  {
    const at = await centerOf(home.webContents, '.plates .plate[data-plate="quiz"]')
    const before = await home.webContents.executeJavaScript(
      `document.querySelector('.plate.on')?.dataset.plate ?? null`
    )
    await press(home.webContents, at.x, at.y)
    const after = await home.webContents.executeJavaScript(
      `document.querySelector('.plate.on')?.dataset.plate ?? null`
    )
    record('A3', '在真身上点「刷题」那一栏，栏换了吗', after === 'quiz' ? '是' : '不是', {
      点: [at.x, at.y],
      换栏前: before,
      换栏后: after,
      行数: await home.webContents.executeJavaScript(`document.querySelectorAll('.lines .line').length`)
    })
  }

  // ------------------------------------------------------------ A4 点行开不开标签页

  mark('A4 点第一行')
  {
    const before = wcModule.getAllWebContents().length
    const at = await centerOf(home.webContents, '.lines .line')
    const label = await home.webContents.executeJavaScript(
      `document.querySelector('.lines .line .label')?.textContent?.trim() ?? null`
    )
    await press(home.webContents, at.x, at.y)
    await delay(1400)
    const after = wcModule.getAllWebContents().length
    const tabs = JSON.parse(
      await chrome.webContents.executeJavaScript(
        `window.zhituan.tabs.list().then((s) => JSON.stringify(s.tabs.map((t) => t.url)))`
      )
    )
    record('A4', '在真身上点第一行，开出一张新标签页了吗', after > before ? '是' : '不是', {
      点的是: label,
      点: [at.x, at.y],
      渲染进程数: `${before} → ${after}`,
      现在开着的标签: tabs.map(hostOf)
    })
  }

  // ------------------------------------------------------------ A5 收起再展开

  mark('A5 收起成球再展开')
  {
    await chrome.webContents.executeJavaScript(`window.zhituan.win.collapse()`)
    await delay(600)
    const collapsed = JSON.parse(
      await chrome.webContents.executeJavaScript(
        `window.zhituan.win.getState().then((s) => JSON.stringify({ mode: s.mode }))`
      )
    )
    const gone = win.contentView.children.filter((v) => vis(v) === true && v !== chrome).length
    await chrome.webContents.executeJavaScript(`window.zhituan.win.expand()`)
    await delay(800)
    const back = JSON.parse(
      await chrome.webContents.executeJavaScript(
        `window.zhituan.win.getState().then((s) => JSON.stringify({ mode: s.mode }))`
      )
    )
    invariant('A5', '收起成球再展开之后，正文区那一点还归网页吗', 'page', {
      收起时: collapsed,
      收起时画着的屏: gone,
      回来后: back
    })
  }

  // ------------------------------------------------------------ A6 最大化再还原

  mark('A6 最大化')
  {
    await chrome.webContents.executeJavaScript(`window.zhituan.win.maximize()`)
    await delay(800)
    invariant('A6', '最大化之后，正文区那一点归网页吗（界面层这时只占右上角一小块）', 'page', {
      最大化: JSON.parse(
        await chrome.webContents.executeJavaScript(
          `window.zhituan.win.getState().then((s) => JSON.stringify({ maximized: s.maximized }))`
        )
      )
    })
    mark('A7 从最大化还原')
    await chrome.webContents.executeJavaScript(`window.zhituan.win.restore()`)
    await delay(800)
    invariant('A7', '从最大化还原之后，正文区那一点归网页吗', 'page')
  }

  // ------------------------------------------------------------ A8 回起始页收尾

  mark('A8 回起始页再点一栏')
  {
    await chrome.webContents.executeJavaScript(`window.zhituan.ui.openHome()`)
    await delay(700)
    const at = await centerOf(home.webContents, '.plates .plate[data-plate="reading"]')
    await press(home.webContents, at.x, at.y)
    const after = await home.webContents.executeJavaScript(
      `document.querySelector('.plate.on')?.dataset.plate ?? null`
    )
    record('A8', '走完一整套之后回到起始页，还能换栏吗（用户报的那一条）', after === 'reading' ? '是' : '不是', {
      点: [at.x, at.y],
      换栏后: after
    })
    invariant('A9', '这时正文区那一点仍归起始页吗', home)
  }

  // ------------------------------------------------------------ A10 整体透明度那条滑块
  //
  // 用户报的那一条：把整体透明度调小，右侧栏那条滑块一松手就跳回 100%。
  //
  // 根子在一条**没接上的广播**上。配置写进去之后要广播给界面——界面手里那份
  // 配置镜像才是那一格显示值的依据；而从前只有设置页那条 configPatch 会广播。
  // 这条滑块走的是 win.setOpacity → controller.setOpacity：值写进去了、盘也落了，
  // 就是没人广播，于是镜像一直停在挂载时读到的那个数（默认 100%），一松手
  // 显示就回落到它，再也不回来。
  //
  // 因此这一问盯的是**三个数对不对得上**：界面上显示的、主进程里的配置、
  // 窗口实际的透明度。只问「配置改了没有」照不出这个毛病——配置一直是改了的。
  //
  // 拖动用合成事件（pointerdown → 写值 → input → pointerup）。原生那一下也顺手
  // 发一遍，记在 detail 里，但它**不作判据**：这一问要问的是「写进去之后广播
  // 跟不跟得上」，不是原生命中测试；合成事件派给 DOM 的那一串，与浏览器真拖动时
  // 做的事一样（onInput 读的就是 target.value）。
  mark('A10 拖右栏那条「整体」透明度滑块')
  {
    const 读取 = async () =>
      JSON.parse(
        await chrome.webContents.executeJavaScript(`(() => {
          const box = [...document.querySelectorAll('.rail .opacity')]
            .find((e) => e.querySelector('.label')?.textContent?.trim() === '整体')
          if (!box) return 'null'
          const el = box.querySelector('.slider')
          const r = el.getBoundingClientRect()
          return JSON.stringify({
            显示: box.querySelector('.value')?.textContent?.trim() ?? null,
            值: Number(el.value),
            矩形: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
          })
        })()`)
      )
    const 主进程这边 = async () =>
      JSON.parse(
        await chrome.webContents.executeJavaScript(`(async () => {
          const cfg = await window.zhituan.config.get()
          const st = await window.zhituan.win.getState()
          return JSON.stringify({ 配置: cfg.window.opacity, 窗口: st.opacity })
        })()`)
      )

    const 拖之前 = await 读取()

    /*
     * 原生拖一下（顺带量一件事：屏幕之外的窗口里，旋转过的 range 收不收得到拖动）。
     * 轨道竖着放：右端 = 上限在**上面**（rotate(-90deg) 把 +x 转到了上方），
     * 因此值越大越靠上；上下各留 7px 是滑块的半径。
     */
    if (拖之前?.矩形) {
      const [rx, ry, rw, rh] = 拖之前.矩形
      const x = Math.round(rx + rw / 2)
      const yOf = (v) => Math.round(ry + 7 + (1 - (v - 5) / 95) * (rh - 14))
      const wc = chrome.webContents
      wc.sendInputEvent({ type: 'mouseMove', x, y: yOf(100) })
      await delay(60)
      wc.sendInputEvent({ type: 'mouseDown', x, y: yOf(100), button: 'left', clickCount: 1 })
      await delay(60)
      for (const v of [80, 60, 40]) {
        wc.sendInputEvent({ type: 'mouseMove', x, y: yOf(v), button: 'left' })
        await delay(80)
      }
      wc.sendInputEvent({ type: 'mouseUp', x, y: yOf(40), button: 'left', clickCount: 1 })
      await delay(400)
    }
    const 原生拖完之后 = await 主进程这边()

    // 目标定在 40%：一处一眼看得出「不是 100%」的值
    const 目标 = 40
    const 写值 = (v) =>
      chrome.webContents.executeJavaScript(`(() => {
        const box = [...document.querySelectorAll('.rail .opacity')]
          .find((e) => e.querySelector('.label')?.textContent?.trim() === '整体')
        if (!box) return false
        const el = box.querySelector('.slider')
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
        el.value = String(${v})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
    await 写值(目标)
    const 拖动中 = await 读取()
    /*
     * 松手那一帧（广播还没回来）：单看它不作判据，但它正是用户看见「跳回去」的那一刻。
     * 读显示必须与派事件分成两次 executeJavaScript——Vue 的重画在微任务里，同一个任务
     * 里读到的是上一次画出来的那一帧，那样读出来的「没问题」是假的。
     */
    await chrome.webContents.executeJavaScript(`(() => {
      const box = [...document.querySelectorAll('.rail .opacity')]
        .find((e) => e.querySelector('.label')?.textContent?.trim() === '整体')
      box
        ?.querySelector('.slider')
        .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    })()`)
    const 松手那一帧 = await 读取()
    await delay(800)
    const 稳定之后 = await 读取()
    const 主进程 = await 主进程这边()

    const 该显示 = `${Math.round(主进程.配置 * 100)}%`
    const ok =
      稳定之后 !== null &&
      稳定之后.显示 === 该显示 &&
      主进程.配置 < 1 &&
      Math.abs(主进程.窗口 - 主进程.配置) < 0.001
    record('A10', '把整体透明度拖小之后，右栏那条滑块显示的是刚拖到的值吗（而不是跳回 100%）', ok ? '是' : '不是', {
      原生拖动在屏幕外收不收得到: 原生拖完之后,
      拖之前,
      拖动中,
      松手那一帧,
      稳定之后,
      主进程里的两个数: 主进程,
      该显示: 该显示
    })
  }

  // ------------------------------------------------------------ A11 没人碰界面时改配置
  //
  // A10 里若原生那一下没生效，改动就全来自合成事件——为了分清「广播通了」与
  // 「合成事件恰好把 DOM 摆对了」，这里再问一次干净的：**完全不碰界面**，
  // 直接调滑块背后那一个 IPC（win.setOpacity），只问那一格显示跟不跟得上。
  // 这一问只有「配置广播」这一条线在起作用，是 A10 的对照组。

  mark('A11 不碰界面，直接调 win.setOpacity')
  {
    const 目标 = 0.55
    await chrome.webContents.executeJavaScript(`window.zhituan.win.setOpacity({ value: ${目标} })`)
    await delay(700)
    const 状态 = JSON.parse(
      await chrome.webContents.executeJavaScript(`(async () => {
        const box = [...document.querySelectorAll('.rail .opacity')]
          .find((e) => e.querySelector('.label')?.textContent?.trim() === '整体')
        const cfg = await window.zhituan.config.get()
        return JSON.stringify({
          显示: box?.querySelector('.value')?.textContent?.trim() ?? null,
          值: box ? Number(box.querySelector('.slider').value) : null,
          配置: cfg.window.opacity
        })
      })()`)
    )
    record('A11', '没人碰界面、只改配置（win.setOpacity）时，那一条滑块显示的值跟着改吗', 状态.显示 === `${Math.round(目标 * 100)}%` ? '是' : '不是', 状态)
  }

  // ------------------------------------------------------------ A12 离线阅读的透明度（TXT 那一半）
  //
  // 右栏第三条滑块（ui.readerOpacity）。它管的是**正在读的那一份**，而本机 TXT
  // 与自家 PDF 阅读页在这一条上落点不同（原因见 @shared/constants 的
  // READER_OPACITY_MIN）：**PDF 那一页淡的是纸**（我们自己画的画布，纸补得回来，
  // 由 pdf-scheme.js 的 Q9 量），**这一页淡的是正文本身**（Chromium 自己渲染，
  // 碰不到它的底）。这一问管的是后一半，网页永远不吃这一条。
  //
  // 四件事，缺一条这条滑块就只是「界面上多了一个能拖的东西」：
  //
  //   1. 开一本本机 TXT 之后它**活过来**（停在网页上时它按规矩是禁用的）；
  //   2. 拖动真的写进了配置（ui.readerOpacity 变成 0.4）；
  //   3. **正文真的淡下去了**——这一条只有量像素才算验过。它是 CSS opacity，
  //      由合成器做，页面里的 DOM 一个字都没变（`html { opacity: .4 }` 那条
  //      注入的样式表是主进程塞进去的，界面侧读不到，圈里也就量不出东西来）；
  //   4. 拉回 100% 之后**恢复原样**——只验「淡了」不验「回得来」，
  //      就成了一个只管往一个方向去的开关。
  //
  // 书是探针现写的一本，不碰用户机器上任何真实文件（名字里带括号，顺带把
  // file: 那条「非 ASCII 百分号编码」的路也走一遍）。
  mark('A12 打开一本本机 TXT，拖右栏第三条滑块')
  {
    const 书 = path.join(TEMP, '摸鱼样本（探针）.txt')
    fs.writeFileSync(
      书,
      '纸团\n\n' + '这是一行用来量透明度的字，写得长一点好占满一整行。\n'.repeat(24),
      'utf8'
    )
    const 地址 = pathToFileURL(书).href

    /** 三条滑块里「阅读」那一条此刻是什么样（禁用着的那一档也要看得见） */
    const 读滑块 = async () =>
      JSON.parse(
        await chrome.webContents.executeJavaScript(`(() => {
          const box = [...document.querySelectorAll('.rail .opacity')]
            .find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
          if (!box) return 'null'
          const el = box.querySelector('.slider')
          return JSON.stringify({
            显示: box.querySelector('.value')?.textContent?.trim() ?? null,
            值: Number(el.value),
            禁用: el.disabled
          })
        })()`)
      )

    /*
     * 开书**之前**先读一眼那条滑块：此刻正文区底下是一张网页（A8 换到了「视频」
     * 那一栏，正文区还是起始页——两种都不是本机文件），它按规矩该是禁用的。
     * 这一读必须在开书之前，否则量到的是「开了书之后」那一态，这一问就成了
     * 自己问自己。
     */
    const 停在网页上 = await 读滑块()

    await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
    )
    await delay(1500)

    /*
     * 认那一格新开的视图：**按地址逐字认**，不按 `file:` 前缀。
     *
     * 这一跤摔过一次：界面层自己（index.html）与起始页、设置页、pdf.html 都是
     * `file:` 开头的地址（未打包时它们都由 loadFile 从磁盘取），因此
     * 「找到第一个 file: 开头的孩子」量到的是**界面层**——一整扇窗那么大、
     * 三个读数一模一样，看上去像「淡了也没淡」，其实一次都没量到那本书。
     */
    const 读的那一屏 = win.contentView.children.find(
      (v) => v.webContents.getURL() === 地址
    )

    /**
     * 一张截图里的明暗分布。
     *
     * 量的是**合成之后**的像素，因此两种底都要算出来：这一屏的纸是透明的
     * （本机文件那条注入的样式表把白底收掉了），而 capturePage 给回来的图
     * 到底带不带 alpha 通道，不是我们说了算——于是
     *   「在黑上」= 亮度 × alpha（贴在黑桌面上看到的样子）
     *   「在白上」= 亮度 × alpha + 255 × (1 − alpha)（贴在白纸上的样子）
     * 两条各报一份，哪一条在淡下去，一眼看得出来。判据用**幅**（最深与最浅
     * 之差）：整体乘一个数，幅就按同一个数缩，与底是什么颜色无关。
     */
    const 明暗 = (img) => {
      const { width, height } = img.getSize()
      const bgra = img.toBitmap()
      let 黑上最深 = 255
      let 黑上最浅 = 0
      let 白上最深 = 255
      let 白上最浅 = 0
      let 透的 = 0
      let 数了 = 0
      // 隔几个像素取一个：量的是分布，几万个样本已经足够，不必把整张图走完
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
      return {
        尺寸: `${width}×${height}`,
        采样: 数了,
        透明像素占比: Number((透的 / 数了).toFixed(3)),
        黑上: { 最深: Math.round(黑上最深), 最浅: Math.round(黑上最浅), 幅: Math.round(黑上最浅 - 黑上最深) },
        白上: { 最深: Math.round(白上最深), 最浅: Math.round(白上最浅), 幅: Math.round(白上最浅 - 白上最深) }
      }
    }

    const 拍 = async () => {
      if (!读的那一屏) return null
      // 连等两帧：透明度的注入与重画都在下一个合成帧里才看得见
      await delay(600)
      return 明暗(await 读的那一屏.webContents.capturePage())
    }

    /**
     * 这一页**自己算出来**的 html opacity。
     *
     * 与上面那份像素读数合起来看，才能分清是哪种坏法：
     *   · 算出 0.4、像素也是 0.4 —— 那张样式表还在（主进程没撤掉）；
     *   · 算出 1、像素还是 0.4 —— 样式表撤掉了，可这一屏**没重画**
     *     （未显示的窗口里，合成器何时出新帧不由我们说了算）。
     * 两种坏法要修的地方完全不同，因此两个数缺一不可。
     */
    const 读样式 = async () => {
      if (!读的那一屏) return null
      try {
        return await 读的那一屏.webContents.executeJavaScript(
          'getComputedStyle(document.documentElement).opacity'
        )
      } catch {
        return '(读不到)'
      }
    }

    const 淡之前 = await 拍()
    const 淡之前样式 = await 读样式()

    // 走真路：拖那条滑块（与 A10 同一套合成事件，onInput 读的就是 target.value）
    const 目标 = 40
    await chrome.webContents.executeJavaScript(`(() => {
      const box = [...document.querySelectorAll('.rail .opacity')]
        .find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
      if (!box) return false
      const el = box.querySelector('.slider')
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.value = String(${目标})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      return true
    })()`)
    await delay(900)
    const 淡之后 = await 拍()
    const 淡之后样式 = await 读样式()
    const 配置里 = JSON.parse(
      await chrome.webContents.executeJavaScript(`(async () => {
        const cfg = await window.zhituan.config.get()
        return JSON.stringify({ 阅读: cfg.ui.readerOpacity })
      })()`)
    )

    // 拉回 100%：只验「淡得下去」不验「回得来」，这开关就只管一个方向
    await chrome.webContents.executeJavaScript(`(() => {
      const box = [...document.querySelectorAll('.rail .opacity')]
        .find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
      const el = box?.querySelector('.slider')
      if (!el) return false
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el.value = '100'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      return true
    })()`)
    await delay(900)
    const 拉回来 = await 拍()
    const 拉回来样式 = await 读样式()
    /*
     * 拉回那一半也要读一眼**配置与滑块**，不能只量像素。
     *
     * 「淡还是没淡」是一个数，而它可能坏在两处：滑块那一下没写进配置（界面这一半），
     * 或者写进去了、注入的样式表没被撤掉（主进程那一半）。只看像素分不清是哪一处，
     * 于是把这两个数一起记下来——下一跑读 detail 就知道该往哪边查。
     */
    const 恢复之后 = JSON.parse(
      await chrome.webContents.executeJavaScript(`(async () => {
        const box = [...document.querySelectorAll('.rail .opacity')]
          .find((e) => e.querySelector('.label')?.textContent?.trim() === '阅读')
        const cfg = await window.zhituan.config.get()
        return JSON.stringify({
          显示: box?.querySelector('.value')?.textContent?.trim() ?? null,
          配置: cfg.ui.readerOpacity,
          禁用: box?.querySelector('.slider')?.disabled ?? null
        })
      })()`)
    )

    const 幅 = (m, 底) => m?.[底]?.幅 ?? null
    const 缩到 = (之前, 之后, 底) => {
      const a = 幅(之前, 底)
      const b = 幅(之后, 底)
      return a ? Number((b / a).toFixed(3)) : null
    }
    /*
     * 判据：
     *   · 停在网页上时那一条必须是禁用的（它没有可作用的对象）；
     *   · 开了本机 TXT 之后它得是活的，且显示/配置都是刚拖到的那个值；
     *   · 幅按透明度缩——0.4 就该缩到 0.4 上下（两种底都算，取量得出来的那一条：
     *     带 alpha 的那张图「黑上」缩得准，「白上」会因为底被补成白而偏大）；
     *   · 拉回 100% 之后幅回到原样（±8% 内）。
     */
    const 缩黑 = 缩到(淡之前, 淡之后, '黑上')
    const 缩白 = 缩到(淡之前, 淡之后, '白上')
    const 缩回黑 = 缩到(淡之前, 拉回来, '黑上')
    const 缩回白 = 缩到(淡之前, 拉回来, '白上')
    const 淡下去的 = [缩黑, 缩白].filter((v) => v !== null)
    const 判淡 =
      淡下去的.length > 0 &&
      淡下去的.some((v) => Math.abs(v - 目标 / 100) < 0.12) &&
      淡下去的.every((v) => v < 0.75)
    const 判回 =
      [缩回黑, 缩回白].filter((v) => v !== null).length > 0 &&
      [缩回黑, 缩回白].filter((v) => v !== null).every((v) => Math.abs(v - 1) < 0.08)
    const ok =
      停在网页上?.禁用 === true &&
      淡之前 !== null &&
      淡之后 !== null &&
      拉回来 !== null &&
      恢复之后.配置 === 1 &&
      判回 &&
      (await 读滑块())?.禁用 === false &&
      配置里.阅读 === 目标 / 100 &&
      判淡 &&
      判回
    record('A12', '读一本本机 TXT 时，右栏第三条滑块活着、拖下去正文真的淡了、拉回来又恢复吗', ok ? '是' : '不是', {
      书的地址: 地址,
      认出来的那一屏: 读的那一屏 ? String(读的那一屏.webContents.getURL()).slice(0, 60) : '(没认出来)',
      停在网页上时那一条: 停在网页上,
      淡之前,
      淡之后,
      拉回来,
      算出来的opacity: { 淡之前: 淡之前样式, 淡之后: 淡之后样式, 拉回来: 拉回来样式 },
      恢复之后,
      配置里: 配置里.阅读,
      幅缩到: { 黑上: 缩黑, 白上: 缩白, 拉回之后黑上: 缩回黑, 拉回之后白上: 缩回白 }
    })
  }

  // ------------------------------------------------------------ A13 开一本 EPUB
  //
  // A12 走的是 TXT（Chromium 自己渲染那一屏）。这一问走 EPUB，也就是**自家书页**
  // 那一路——而它要问的第一件事不是「书排版好不好看」，是**那条接线接没接上**。
  //
  // 起因是一处漏判：`kind` 判成 'book' 只是第一步，真正决定「读得起来读不起来」
  // 的是 create() 有没有把 viewUrl 换成自家书页（与 pdf 那条并列的一条分支）。
  // 少了那一条，视图里加载的仍是那个 `.epub` 文件本身，而 Chromium 对这种格式
  // 只会把它变成一次下载（Q63 量过：`will-download` 到场、loadURL 以 ERR_FAILED 收场）。
  // 症状与「这本 EPUB 是坏的」一模一样，因此**必须按地址逐字认这一屏**，
  // 不能只看「有没有开出一张新标签页」。
  //
  // 后面四条是接着问「接上之后活没活」：正文有没有画出来（要从 Shadow DOM 里读）、
  // 书的 `body { margin-top: 48px }` 命不命中（Q65 那条实测的现场复核）、
  // 书的底色有没有被我们收掉（纸归我们画的前提）、以及目录点得动不动。
  mark('A13 打开一本 EPUB')
  {
    const 书 = path.join(TEMP, '探针写的书（EPUB）.epub')
    // 书由 zip-store.cjs 现造（两章、带 48px 上边距与一张白底，理由见那个文件头）
    fs.writeFileSync(书, probeBook(), 'binary')
    const 地址 = pathToFileURL(书).href

    await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
    )
    // 拆包 + 解析 OPF + 取第一章 + 注入，全在页面这一侧
    await delay(900)

    /*
     * 按地址逐字认这一屏。两条都要看：
     *   · 书页在不在（book.html?doc=…）；
     *   · 有没有一屏加载的正是那个 `.epub` —— 那正是「少了 viewUrl 那一条」的症状。
     * 只判前者是不够的：万一两个都在（多开了一屏），那也是错的。
     */
    const 书页 = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'book.html')
    const 掉了下去 = win.contentView.children.find((v) => v.webContents.getURL() === 地址)

    /** 从书页上读：正文、读数、书的底、以及书自己的那 48px */
    const 读 = async () => {
      if (!书页) return null
      return JSON.parse(
        await 书页.webContents.executeJavaScript(`(() => {
          const sheet = document.querySelector('.sheet')
          const root = sheet ? sheet.shadowRoot : null
          const body = root ? root.querySelector('body') : null
          const css = body ? getComputedStyle(body) : null
          return JSON.stringify({
            读数: document.querySelector('.hud__count')?.textContent?.trim() ?? null,
            正文: body ? (body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 50) : null,
            份数: root ? root.querySelectorAll('body').length : 0,
            书的底色: css ? css.backgroundColor : null,
            书的上边距: css ? css.marginTop : null,
            书的样式表: root ? root.querySelectorAll('link[rel=stylesheet]').length : 0,
            写在屏幕上的一句话: document.querySelector('.note')?.textContent?.trim() ?? null
          })
        })()`)
      )
    }

    /*
     * 先把读数**按时间走一遍**，再问别的。
     *
     * 这一串是给「读数怎么会是 2/2」这类问题用的：只看最终值分不清它是**一开始就
     * 在第二章**（装书那一步的问题），还是**读着读着被谁翻过去了**（谁在给这一页
     * 送事件）。两者的修法完全不同，而它们的终值一模一样。
     */
    const 轨迹 = []
    for (let i = 0; i < 10; i++) {
      const r = await 读()
      轨迹.push({ 第几次: i + 1, 读数: r?.读数 ?? null })
      if (r?.写在屏幕上的一句话) break
      await delay(300)
    }
    const 一 = await 读()

    // 点「目录」，再点「第二章」——目录是书里给的，不是按章次编的
    //
    // 按**文字**找那颗键，不按位置：HUD 里现在有两颗（「Aa」与「目录」），而这个
    // 位置本来就会随着新控件变——照 `.hud__key` 取第一颗，加一颗键就会点到别处，
    // 症状看起来像「目录没做出来」（2026-09-27 真的这么红过一次）。
    const 目录 = JSON.parse(
      await 书页.webContents.executeJavaScript(`(() => {
        const key = [...document.querySelectorAll('.hud__key')].find(
          (b) => b.textContent.trim() === '目录'
        )
        if (!key) return '"没有那颗「目录」键"'
        key.click()
        return '"点了那颗「目录」键"'
      })()`)
    )
    await delay(500)
    const 目录项 = JSON.parse(
      await 书页.webContents.executeJavaScript(
        `JSON.stringify({
          开着: !!document.querySelector('.toc'),
          项: [...document.querySelectorAll('.toc__item')].map((e) => e.textContent.trim())
        })`
      )
    )
    const 点第二章 = JSON.parse(
      await 书页.webContents.executeJavaScript(`(() => {
        const hit = [...document.querySelectorAll('.toc__item')].find((e) => e.textContent.trim() === '第二章')
        if (!hit) return '"没有第二章"'
        hit.click()
        return '"点了"'
      })()`)
    )
    await delay(1600)
    const 二 = await 读()

    const ok =
      书页 !== undefined &&
      掉了下去 === undefined &&
      一 !== null &&
      一.读数 === '第一章 · 1/2' &&
      一.正文.includes('探针写的第一章') &&
      一.份数 === 1 &&
      一.书的底色 === 'rgba(0, 0, 0, 0)' && // CLEAR 生效：书那张纸被我们收掉了
      一.书的上边距 === '48px' && // 书的 body{} 规则照样命中 Shadow DOM 里的正文
      一.书的样式表 === 1 &&
      目录项.项.length === 2 &&
      点第二章 === '点了' &&
      二 !== null &&
      二.读数 === '第二章 · 2/2' &&
      二.正文.includes('第二章')

    record(
      'A13',
      '开一本 EPUB：视图里加载的是自家书页吗（而不是那个 .epub 本身）；正文画出来了吗、目录点得动吗',
      ok ? '是' : '不是',
      {
        书的地址: 地址,
        加载的地址: 书页 ? String(书页.webContents.getURL()).slice(0, 90) : '(没有这一屏)',
        有没有哪一屏加载的正是那个epub: 掉了下去 ? String(掉了下去.webContents.getURL()).slice(0, 60) : '没有',
        场上画着的屏: win.contentView.children
          .filter((v) => vis(v) === true && v !== chrome)
          .map(nameOf),
        轨迹,
        第一章: 一,
        点目录: 目录,
        目录项,
        点第二章: 点第二章,
        第二章: 二
      }
    )
  }

  // ------------------------------------------------------------ 收尾

  mark('收尾，写文件')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'live-app.json')
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        结果: results,
        界面层的次序被动过的记录: moves,
        渲染进程的告警: consoleLines,
        最后的层序: layers(),
        临时userData: landed
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(`WROTE ${out}`)
  for (const m of moves) console.log(`界面层第 ${m.序号} 次移位：${m.去处}（${m.栈[1] ?? '?'}）`)
  if (consoleLines.length) {
    console.log('渲染进程的告警：')
    for (const line of consoleLines.slice(0, 20)) console.log(`  ${line}`)
  }
  const bad = results.filter((r) => r.verdict === '不是')
  console.log(`\n${results.length - bad.length}/${results.length} 通过`)
  for (const b of bad) console.log(`  破了 ${b.id}：${b.question}`)
  clearInterval(beat)
  clearTimeout(watchdog)
  收走临时目录()
  app.exit(0)
}
