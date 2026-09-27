/**
 * 探针：PDF 自己渲染这条路，量的是「白纸到底有没有变成透明、字还在不在」。
 *
 * 内置阅读器那条路已经量过（见 docs/spike-findings.md 的 Q51）：那张纸由 PDFium
 * 直接画在插件表面上，注入的 CSS 一个像素都动不了，能算出 alpha 的 SVG 滤镜也
 * 落不到它头上。因此这一版把 PDF 换成 pdf.js 自己画进 canvas，本探针就是它的量具：
 *
 *   1. fixtures —— 造六份素材（纯文字 / 显式白底块 / 彩色插图 / 中文 / 深底浅字 /
 *      带页边距的深底）。不手写 PDF 字节：用 Chromium 自己的 printToPDF 把一段 HTML
 *      印成 PDF，零依赖，而且「自带白底矩形」这种最难的素材反倒只有它造得出来。
 *   2. render —— 把一份素材放进**离屏窗口**（不上屏、不抢焦点）渲染一遍，
 *      逐级量像素：白纸默认值 / 透明背景 / 再键控 / 键控 + 上色 / 自动判深浅。
 *
 * 一问一个进程：本仓库的探针在同一个进程里开第二扇窗加载 file:// 会 ERR_FAILED
 * （Q24 记过的那条环境的脾气，本轮又碰了三次），因此 run-all 是一串子进程。
 *
 * 一条提醒：这一支里的键控是**产品那份的一个副本**（下面 PAGE_SCRIPT 里），刻意停在
 * 更早的形态——它给出的是「某一档参数下这一页长什么样」，用来给 keying.ts 里的常数
 * 量出前后两个数（Q52 那条界线就是这么定的）。产品改了键控，这里**不跟**，
 * 除非要重新量那个数；真正「产品页面跑起来是什么样」由 spike/pdf-scheme.js 量。
 *
 * 跑法：
 *   npx electron spike/pdf-render.js fixtures
 *   for f in plain panel photo cjk dark slab; do npx electron spike/pdf-render.js render $f auto; done
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(__dirname, 'out')
const FIX = path.join(OUT, 'fixtures')
const PDFJS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** 页面尺寸：全部素材印成同一张 A4，读数才可比 */
const PAGE = { width: 8.27, height: 11.69 }
const WIN = { width: 640, height: 920 }
/** 上色用的墨色：本项目的强调色（纸白主题那支金的起点 d6b274 的深色版） */
const INK = [58, 48, 32]

// ------------------------------------------------------------------ 素材

const CSS = `
  * { box-sizing: border-box }
  body { margin: 0; padding: 40px; font: 16px/1.7 "Segoe UI", "Microsoft YaHei", serif; color: #111 }
  h1 { font-size: 26px; margin: 0 0 18px }
  p { margin: 0 0 14px }
`

const FIXTURES = {
  /** 1. 纯文字：最普通的一份，正文是黑的、纸是「没有画」 */
  plain: `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>The Quick Brown Fox</h1>
    ${'<p>Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump. ' +
      'The five boxing wizards jump quickly, and the public was amazed.</p>'.repeat(6)}`,

  /** 2. 显式白底块：纸是**画出来的**，透明背景这一档对它没用，要靠键控 */
  panel: `<!doctype html><meta charset="utf-8"><style>${CSS}
      .paper { background: #ffffff; padding: 24px; border: 1px solid #dddddd }</style>
    <div class="paper"><h1>Painted White Paper</h1>
    ${'<p>This paragraph sits on a rectangle that the PDF actually paints white. ' +
      'A transparent canvas background cannot remove it — only keying can.</p>'.repeat(6)}</div>`,

  /** 3. 彩色插图：键控会把颜色压成灰阶 alpha，这一份量的是那个代价有多大 */
  photo: `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>Colour Plate</h1>
    <div style="height:220px;background:linear-gradient(120deg,#2b6cb0,#e53e3e 45%,#38a169 75%,#d69e2e)"></div>
    <p style="color:#c53030">Red text on white paper.</p>
    ${'<p>Colour that is not black has to be given up when the paper is keyed out.</p>'.repeat(5)}`,

  /** 4. 中文：量字形（字体子集、CID 编码、要不要 cMap） */
  cjk: `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
    <h1>纸团：中文排版</h1>
    ${'<p>窗口是逐像素透明的，网页画在另一层里。这一份素材用来量中文的字形有没有画对：' +
      '笔画多的字（譬如「藏」「囊」「懿」）糊没糊、行距对不对、标点是不是全角。</p>'.repeat(6)}`,

  /** 5. 深底浅字：键控的最大反例——纸是黑的、字是白的，直接键控会整页抹平 */
  dark: `<!doctype html><meta charset="utf-8"><style>${CSS}
      body { background: #111111; color: #f2f2f2 }
      h1 { color: #ffffff }</style>
    <h1>Light On Dark</h1>
    ${'<p>A page designed dark has its ink where the paper usually is. Keying it as-is ' +
      'erases the text and keeps the background, so it has to be inverted first.</p>'.repeat(6)}`,

  /**
   * 6. 带页边距的深底：**「画满没画满」那条界线就是为它量的**。
   * 与 5 号的区别只在一点：深色的正文块**没有铺满整页**（四周是没画过的空白，
   * 不是另一种颜色的纸）。于是它落在「纯文字（2–4%）」与「整页铺满（85%）」
   * 之间的空档里。界线贴着 0.8 时这一页会被判成「没有纸」，按浅纸的算法走：
   * 整块深底留成一块实心墨、浅色的字全被抹掉。
   *
   * 四周**不能**再涂一层别的颜色：那样一页上就有两张深浅相反的纸，
   * 而单张纸的键控只认一个零点（实测：浅灰底 + 深色块那一版，浅灰那圈被翻成墨）。
   */
  slab: `<!doctype html><meta charset="utf-8"><style>${CSS}
      .slab { background: #111111; color: #ededed; padding: 40px 40px 90px }
      .slab h1 { color: #ffffff }</style>
    <div class="slab"><h1>Dark Slab With Margins</h1>
    ${'<p>This page is dark where it is painted, but it does not paint the whole page. ' +
      'A threshold that sits too close to a full page calls this text-only and keeps the slab.</p>'.repeat(6)}</div>`
}

async function makeFixtures() {
  fs.mkdirSync(FIX, { recursive: true })
  const win = new BrowserWindow({ show: false, width: 900, height: 1200 })
  for (const [name, html] of Object.entries(FIXTURES)) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await delay(250)
    const buf = await win.webContents.printToPDF({
      pageSize: PAGE,
      printBackground: true,
      margins: { marginType: 'default' }
    })
    const file = path.join(FIX, `${name}.pdf`)
    fs.writeFileSync(file, buf)
    console.log(`[fixtures] ${name}.pdf ${buf.length} 字节`)
  }
  win.destroy()
  console.log(`[fixtures] 落在 ${path.relative(ROOT, FIX)}（已 gitignore）`)
}

// ------------------------------------------------------------------ 跑台

/**
 * 页面侧的脚本。刻意与将来的阅读器页同构：
 * 同一套渲染参数、同一套键控、同一套「先判深浅再决定翻不翻」。
 */
const PAGE_SCRIPT = `
const $ = (id) => document.getElementById(id)
let worker = null
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 整页基本被画满 = 有一张真的纸；否则「画上的像素」只是字本身。同 keying.ts 的 PAPER_SHARE */
const hasPaper = (median, paintedShare) => paintedShare > 0.35

function inkCanvas(ctx, w, h, ink, mode) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const t0 = performance.now()
  // 先认纸：**只有整页都被画满了**才谈得上「哪一边是纸」；纯文字页的「画上的像素」
  // 只有字本身，它的中位数必然是暗的，拿它当判据会把正文整个抹掉
  // （本轮实测：median 16 被当成深底 → 只剩 7321 个像素）。
  let n = 0
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    hist[L]++
    n++
  }
  let acc = 0, median = 0
  for (let L = 0; L < 256; L++) { acc += hist[L]; if (acc >= n / 2) { median = L; break } }
  const paintedShare = n / (d.length / 4)

  /*
   * 纸的亮度就是那个中位数（占面积最大的一层必然是纸），键控要**以纸为零点**：
   *   keep = (纸 - 字) / 纸        （浅纸）
   *   keep = (字 - 纸) / (1 - 纸)  （深纸）
   * 直接写 1 - 亮度 的话，#111 那种「不是纯黑」的深纸会留下一层 6.7% 的灰雾
   * （本轮实测 meanAlpha 18.5、整页只透出 11%），灰色的纸更糟——那是 50% 的一层纱。
   */
  const P = hasPaper(median, paintedShare) ? median / 255 : null
  const polarity = P === null ? 'none' : (P >= 0.5 ? 'light' : 'dark')
  // auto 之外的两档不自己判深浅，一律当浅纸——用户按的那一下说了算
  const useDark = P !== null && (mode === 'auto' ? polarity === 'dark' : false)

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    let keep
    if (P === null) keep = a * (1 - L)
    else if (useDark) keep = a * clamp01((L - P) / Math.max(1 - P, 1e-3))
    else keep = a * clamp01((P - L) / Math.max(P, 1e-3))
    if (mode === 'key') { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0 }
    else { d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2] }
    d[i + 3] = Math.max(0, Math.min(255, Math.round(keep * 255)))
  }
  ctx.putImageData(img, 0, 0)
  return {
    ms: performance.now() - t0, median, invert: useDark, polarity,
    paintedShare: +(paintedShare * 100).toFixed(1)
  }
}

function stats(canvas, ink) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let transparent = 0, white = 0, dark = 0, mid = 0, inked = 0, aSum = 0
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    aSum += a
    if (a < 8) { transparent++; continue }
    if (Math.abs(d[i] - ink[0]) < 24 && Math.abs(d[i + 1] - ink[1]) < 24 && Math.abs(d[i + 2] - ink[2]) < 24) inked++
    if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245 && a > 245) white++
    else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60 && a > 245) dark++
    else mid++
  }
  const total = canvas.width * canvas.height
  return {
    w: canvas.width, h: canvas.height, total,
    transparent, white, dark, mid, inked,
    meanAlpha: +(aSum / total).toFixed(1)
  }
}

window.__run = async (b64, opts) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

  if (!worker) {
    const src = $('ws').textContent
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    pdfjsLib.GlobalWorkerOptions.workerPort = worker
  }

  const t0 = performance.now()
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise
  const tLoad = performance.now() - t0
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  // 页面宽度铺满窗口：五份素材的纸大小不一，只有按同一把尺铺开，读数才横向可比
  const scale = opts.fitWidth ? opts.fitWidth / base.width : opts.scale
  const vp = page.getViewport({ scale })

  const canvas = $('c')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const t1 = performance.now()
  await page.render({ canvasContext: ctx, viewport: vp, background: opts.background }).promise
  const tRender = performance.now() - t1

  let key = { ms: 0, median: -1, invert: false, paintedShare: -1 }
  if (opts.mode !== 'clear') key = inkCanvas(ctx, canvas.width, canvas.height, opts.ink, opts.mode)

  return {
    page: { w: Math.round(base.width), h: Math.round(base.height), scale },
    tLoad: +tLoad.toFixed(1), tRender: +tRender.toFixed(1), tKey: +key.ms.toFixed(1),
    pageMedian: key.median, paintedShare: key.paintedShare, inverted: key.invert,
    canvas: stats(canvas, opts.ink)
  }
}
`

function harnessHtml(workerSrc) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent }
    #c { display: block }
  </style></head><body>
  <canvas id="c"></canvas>
  <script type="text/plain" id="ws">${workerSrc}</script>
  <script src="./pdf.bundle.js"></script>
  <script>${PAGE_SCRIPT}</script>
  </body></html>`
}

async function ensureBundle() {
  fs.mkdirSync(OUT, { recursive: true })
  const bundle = path.join(OUT, 'pdf.bundle.js')
  const worker = path.join(OUT, 'pdf.worker.js')
  if (!fs.existsSync(bundle)) {
    await esbuild.build({
      entryPoints: [path.join(PDFJS, 'pdf.mjs')],
      bundle: true, format: 'iife', globalName: 'pdfjsLib',
      define: { 'import.meta.url': '"file:///pdf.bundle.js"' },
      outfile: bundle, logLevel: 'warning'
    })
  }
  if (!fs.existsSync(worker)) {
    await esbuild.build({
      entryPoints: [path.join(PDFJS, 'pdf.worker.mjs')],
      bundle: true, format: 'iife', outfile: worker, logLevel: 'warning'
    })
  }
  fs.writeFileSync(path.join(OUT, 'pdf-harness.html'), harnessHtml(fs.readFileSync(worker, 'utf8')))
  return path.join(OUT, 'pdf-harness.html')
}

// ------------------------------------------------------------------ 量一档

const MODES = {
  /** 白纸：pdf.js 的默认值，今天内置阅读器长这样 */
  white: { background: 'rgb(255,255,255)', key: false },
  /** 透明背景：多数纯文字 PDF 到这一步就只剩字了 */
  clear: { background: 'rgba(0,0,0,0)', key: false },
  /** 再键控：连 PDF 自己画的白纸一起收掉，字上成纯黑 */
  key: { background: 'rgba(0,0,0,0)', key: true, ink: [0, 0, 0] },
  /** 键控 + 上色：墨色由主题给（这里用强调色，方便一眼看出上没上） */
  ink: { background: 'rgba(0,0,0,0)', key: true, ink: INK },
  /** 自动：先看这一页的墨压在哪儿，深底浅字先翻过来再键控 */
  auto: { background: 'rgba(0,0,0,0)', key: true, ink: INK, auto: true }
}

function count(buf, w, h) {
  let transparent = 0, white = 0, dark = 0, mid = 0, inked = 0
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i], g = buf[i + 1], r = buf[i + 2], a = buf[i + 3]
    if (a < 8) { transparent++; continue }
    if (Math.abs(r - INK[0]) < 24 && Math.abs(g - INK[1]) < 24 && Math.abs(b - INK[2]) < 24) inked++
    if (r > 245 && g > 245 && b > 245 && a > 245) white++
    else if (r < 60 && g < 60 && b < 60 && a > 245) dark++
    else mid++
  }
  return { w, h, total: w * h, transparent, white, dark, mid, inked }
}

async function render(name, mode) {
  const harness = await ensureBundle()
  const file = path.join(FIX, `${name}.pdf`)
  if (!fs.existsSync(file)) throw new Error(`没有这份素材：${name}（先跑 fixtures）`)
  const conf = MODES[mode]
  if (!conf) throw new Error(`没有这一档：${mode}（有 ${Object.keys(MODES).join(' / ')}）`)

  const win = new BrowserWindow({
    show: false,
    width: WIN.width,
    height: WIN.height,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: false, contextIsolation: false }
  })
  win.setBackgroundColor('#00000000')
  await win.webContents.loadURL(require('node:url').pathToFileURL(harness).href)
  await delay(300)

  // 页面宽度铺满窗口（留 0 边），这一档所有读数才与窗口同一尺度
  const b64 = fs.readFileSync(file).toString('base64')
  const asked = {
    fitWidth: WIN.width,
    background: conf.background,
    mode: conf.key ? (conf.auto ? 'auto' : 'key') : 'clear',
    ink: conf.ink ?? INK
  }
  const got = await win.webContents.executeJavaScript(
    `window.__run(${JSON.stringify(b64)}, ${JSON.stringify(asked)})`,
    true
  )

  await delay(200)
  const img = await win.webContents.capturePage()
  const size = img.getSize()
  const shot = count(img.toBitmap(), size.width, size.height)

  console.log(`[${name}/${mode}] 画布 ${got.canvas.w}×${got.canvas.h}（原页 ${got.page.w}×${got.page.h}）`)
  console.log(
    `  页面读数 透明 ${got.canvas.transparent} / 白 ${got.canvas.white} / 深 ${got.canvas.dark} / 中间 ${got.canvas.mid} / 墨色 ${got.canvas.inked}，均 alpha ${got.canvas.meanAlpha}`
  )
  console.log(
    `  窗口读数 透明 ${shot.transparent} / 白 ${shot.white} / 深 ${shot.dark} / 中间 ${shot.mid} / 墨色 ${shot.inked}（共 ${shot.total}）`
  )
  console.log(
    `  耗时 解析 ${got.tLoad}ms · 渲染 ${got.tRender}ms · 键控 ${got.tKey}ms${got.pageMedian >= 0 ? ` · 画满 ${got.paintedShare}% · 亮度中位数 ${got.pageMedian}${got.inverted ? '（判为深底浅字，先翻了）' : ''}` : ''}`
  )
  fs.writeFileSync(path.join(OUT, `pdf-shot-${name}-${mode}.png`), img.toPNG())
  win.destroy()
  app.exit(0)
}

// ------------------------------------------------------------------ 入口

const [cmd, a1, a2] = process.argv.slice(2)

app.whenReady().then(async () => {
  try {
    if (cmd === 'fixtures') {
      await makeFixtures()
      app.exit(0)
    } else if (cmd === 'render') {
      await render(a1, a2 ?? 'auto')
    } else {
      console.log('用法：fixtures | render <plain|panel|photo|cjk|dark> <white|clear|key|ink|auto>')
      app.exit(1)
    }
  } catch (e) {
    console.error('FAIL', e)
    app.exit(1)
  }
})
