/**
 * 探针：视图的叠放次序能不能改，改了之后谁在上面。
 *
 * 这一版的「最大化」要在右上角浮出一枚还原键与那颗球，而 chrome 层原本画在
 * 标签页视图**之下**——不把它抬上来，那一组控件就会被网页整个盖住。
 * Electron 的 `View.addChildView` 文档写着：把一个已经在场的子视图再加一次，
 * 它会被重排到最上层。整套做法就架在这一句话上，因此先单独验它一遍：
 *
 *   Q1 重排到底有没有发生（顺序真的变了吗）
 *   Q2 隐藏窗口里读不读得到视图快照（决定了「能不能顺便报个像素」）
 *   Q3 真实形状：chrome 缩成右上角一个小方块、网页铺满整窗时，
 *      那一小块归谁（这就是最大化时的版面）
 *   Q4 让回去：把网页重新加回最上层，顺序是否翻回来
 *   Q5 来回交替十次，顺序与子视图个数都不漂
 *
 * 跑法：npx electron spike/vieworder.js
 * 产出：终端一份 [Qn] 报告，spike/out/vieworder.json
 *
 * 知道验不到的部分：**命中测试验不了**。进程里没有任何东西能移动系统光标，
 * 而 views 之间的命中测试发生在原生那一侧，`sendInputEvent` 是直接投给某个
 * webContents 的，绕过了它。因此这里只断言顺序——顺序正是「谁在上面」的定义
 * （见上引文档），截图与真实点击留在真机上人工确认。
 * 同时，BaseWindow 里隐藏窗口的视图**取不到快照**（capturePage 抛
 * UnknownVizError，本文件 Q2 记下了这件事），所以连像素都读不到：
 * 「重叠处画的是上面那一格」这句话在本探针里只能由顺序去代表。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, WebContentsView, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

/** 一扇涂满单色的视图。颜色用来在快照里认出「这一格是谁画的」 */
async function solidView(color) {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  view.setBackgroundColor('#00000000')
  const html = `<body style="margin:0;height:100vh;background:${color}"></body>`
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(html))
  return view
}

/** 视图自己的快照（不是合成帧，见文件头）。读中心那一个像素，回成 #rrggbb */
async function ownPixel(view) {
  const img = await view.webContents.capturePage()
  const size = img.getSize()
  if (!size.width || !size.height) return null
  const bmp = img.toBitmap() // BGRA
  const at = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
  const hex = (n) => n.toString(16).padStart(2, '0')
  return `#${hex(bmp[at + 2])}${hex(bmp[at + 1])}${hex(bmp[at])}`
}

/** 当前 contentView 的子视图顺序，用名字报出来 */
const order = (win, names) =>
  win.contentView.children.map((v) => names.get(v) ?? '?')

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays()
  const origin = {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 800,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 800
  }

  const W = 400
  const H = 300
  const win = new BaseWindow({
    x: origin.x,
    y: origin.y,
    width: W,
    height: H,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'zhituan-vieworder-probe'
  })

  const chrome = await solidView('#ff0000')
  const page = await solidView('#0000ff')
  const names = new Map([
    [chrome, 'chrome'],
    [page, 'page']
  ])

  // 与真实窗口同一个加法：chrome 先加（因此在最下面），网页后加
  win.contentView.addChildView(chrome)
  win.contentView.addChildView(page)
  chrome.setBounds({ x: 0, y: 0, width: W, height: H })
  page.setBounds({ x: 0, y: 0, width: W, height: H })
  await delay(120)

  const before = order(win, names)

  // ---- Q1：把 chrome 再加一次，它应当被重排到最上层 ----
  win.contentView.addChildView(chrome)
  await delay(120)
  const after = order(win, names)

  record(
    'Q1',
    '把一个已经在场的子视图重新 addChildView，它会被重排到最上层',
    after[after.length - 1] === 'chrome' && before[before.length - 1] === 'page'
      ? '是'
      : '否',
    { 重排前: before, 重排后: after, 子视图个数: win.contentView.children.length }
  )

  // ---- Q2：为什么只能靠顺序断言（这一条记的是「读不到」，不是「读到了什么」） ----
  /*
   * 合成结果本该用一张快照来证：重叠处画的是上面那一格的颜色。
   * 但隐藏窗口里的 WebContentsView 拿不到快照——capturePage 抛 UnknownVizError
   * （没有 viz 合成面）。所以这里把这件事本身记下来：结论是「探针里无从读像素」，
   * 而不是「读到了、看着没问题」。真机上那一小块归谁，仍需人眼确认一次。
   */
  let pixelError = null
  try {
    await ownPixel(chrome)
  } catch (err) {
    pixelError = String(err && err.message ? err.message : err)
  }
  record(
    'Q2',
    '隐藏窗口里取不到视图快照（UnknownVizError），因此本探针只断言顺序、不报像素',
    pixelError ? '是' : '否（竟然读到了，那么这里该改成读像素）',
    { 报错: pixelError }
  )

  // ---- Q3：最大化时的真实形状 ----
  /*
   * chrome 缩到右上角那一小块（还原键 + 球），网页铺满整窗。
   * 此时 chrome 的矩形与网页的矩形**重叠**，重叠处归谁只由顺序决定——
   * 这正是「浮在网页右上角的那组控件」能不能看见、能不能点到的全部依据。
   *
   * 尺寸抄自 src/shared/constants 的 FLOAT_W / FLOAT_H。这里是 CJS 直跑的探针，
   * 没有构建步骤，import 不进 TS 常量，只能手抄一份——但本探针断言的是**顺序**，
   * 尺寸对不上不影响结论，抄过来只是免得读的人以为两处本来就不一致。
   */
  const FLOAT = { x: W - 80, y: 0, width: 80, height: 48 }
  page.setBounds({ x: 0, y: 0, width: W, height: H })
  chrome.setBounds(FLOAT)
  await delay(150)
  const floatOrder = order(win, names)
  const chromeGot = chrome.getBounds()
  record(
    'Q3',
    'chrome 缩成右上角一小块、网页铺满整窗时，那一小块仍压在最上面',
    floatOrder[floatOrder.length - 1] === 'chrome' &&
      chromeGot.x === FLOAT.x &&
      chromeGot.width === FLOAT.width &&
      chromeGot.height === FLOAT.height
      ? '是'
      : '否',
    { 顺序: floatOrder, chrome: chromeGot, page: page.getBounds() }
  )

  // ---- Q4：让回去——把网页重新加回最上层 ----
  win.contentView.addChildView(page)
  await delay(120)
  const restored = order(win, names)
  record(
    'Q4',
    '把网页重新 addChildView 回来，顺序翻回「网页在上」',
    restored[restored.length - 1] === 'page' ? '是' : '否',
    { 顺序: restored }
  )

  // ---- Q5：来回切十次，顺序不漂 ----
  /*
   * 抬上来 / 让回去这件事每次贴边都会发生一遍（见 edgeWatcher），
   * 顺序若会随着次数漂掉，用户就会遇上「有时点得到有时点不到」。
   */
  let stable = true
  for (let i = 0; i < 10; i++) {
    win.contentView.addChildView(chrome)
    const up = order(win, names)
    win.contentView.addChildView(page)
    const down = order(win, names)
    if (up[up.length - 1] !== 'chrome' || down[down.length - 1] !== 'page') stable = false
    if (win.contentView.children.length !== 2) stable = false
  }
  record('Q5', '抬上 / 让回交替十次，子视图个数与顺序都不漂', stable ? '是' : '否', {
    最终: order(win, names),
    个数: win.contentView.children.length
  })

  /*
   * ---- Q6：第二个参数给 0，能不能把一个已经在场的视图送回最底下 ----
   *
   * 文档只写了「不传 index 就是加到末尾」，没说**已经在场的**子视图再给一个
   * index 会怎样——而「界面层让回去」正需要这一条：让回时若只把它抬到第二
   * （把当前那一屏顶上去），其余每一屏都还沉在它下面，切到哪一屏哪一屏点不动
   * （用户报的那条毛病）。截图与真机点击都验不到这一步，只能在这里问清楚。
   */
  win.contentView.addChildView(chrome)
  await delay(120)
  const beforeIndex0 = order(win, names)
  win.contentView.addChildView(chrome, 0)
  await delay(120)
  const afterIndex0 = order(win, names)
  record(
    'Q6a',
    'addChildView(view, 0) 把已经在场的视图送回最底下',
    afterIndex0[0] === 'chrome' ? '是' : '否',
    { '给 0 之前': beforeIndex0, '给 0 之后': afterIndex0, 子视图个数: win.contentView.children.length }
  )

  // ---- Q6b：三格在场时同样成立吗（真的场上不止两格：起始页 + 好几个标签页） ----
  const extra = await solidView('#00ff00')
  win.contentView.addChildView(extra)
  names.set(extra, 'extra')
  extra.setBounds({ x: 0, y: 0, width: W, height: H })
  await delay(120)
  win.contentView.addChildView(chrome) // 先抬到最上面
  const threeUp = order(win, names)
  win.contentView.addChildView(chrome, 0)
  await delay(120)
  const threeDown = order(win, names)
  record(
    'Q6b',
    '三格在场时，addChildView(view, 0) 同样把它送回最底下（其余三格的相对次序不动）',
    threeDown[0] === 'chrome' &&
      JSON.stringify(threeDown.slice(1)) === JSON.stringify(['page', 'extra']) &&
      JSON.stringify(threeUp) === JSON.stringify(['page', 'extra', 'chrome'])
      ? '是'
      : '否',
    { 抬上去: threeUp, 送回底部: threeDown }
  )

  // ---- Q7：越界的 index 会不会抛（探针与产品都不该踩这个坑） ----
  let indexError = null
  try {
    win.contentView.addChildView(chrome, 99)
  } catch (err) {
    indexError = String(err && err.message ? err.message : err)
  }
  record(
    'Q7',
    'index 越界（99）时 addChildView 抛不抛',
    indexError ? '抛' : '不抛',
    { 报错: indexError, 之后的顺序: order(win, names) }
  )

  win.destroy()

  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'vieworder.json'),
    JSON.stringify({ before, after, floatOrder, restored, floatRect: FLOAT, results }, null, 2),
    'utf8'
  )

  app.exit(0)
})

app.on('window-all-closed', () => app.quit())
