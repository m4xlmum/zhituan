/**
 * EPUB / MOBI / AZW3 这类格式到底能不能「导入」（见 docs/spike-findings.md 的 Q63）。
 *
 * 这个问题其实是**四个互相独立的门槛**，一支脚本各量一遍：
 *
 *   1. 把一个 `file:///…/sample.epub` 直接交给视图，Chromium 是**渲染**它，还是
 *      把它变成**一次下载**？选文件框里不列这三种格式，就是照这一条定的——
 *      但「Chromium 不认它们」这句话本身得先量出来，不能只当成常识写进注释。
 *
 *   2. **这两件事我们自己做不做得了**：EPUB 本质是一个 ZIP，正文是 XHTML。
 *      若只靠 `node:zlib`（内置）就能把它解出来，那么「读 EPUB」就不必新增依赖
 *      ——本项目的运行时依赖一直是 3 个（@electron-toolkit/preload、utils、pdfjs-dist），
 *      这一点值是值钱的，别为了一个格式把它破了。
 *
 *   3. 把解出来的正文当一页加载，**现有那两条注入落不落得下去**：
 *      「注入透明底」走 `insertCSS`（user 来源），「阅读透明度」走 CSSOM 上的行内
 *      `opacity`。判据不读计算样式，而是量**合成之后的像素**——「纸在不在」只有
 *      透明像素占比答得了（计算样式里 `body` 的底色是 transparent 时，画布上的
 *      白纸照样还在）。这一条要在一份**带 CSP** 的 XHTML 上也量一遍（真实 EPUB 会带），
 *      并与一页 `.txt` 并排比——两者是同一类文档，读数该一致。
 *
 *   4. `.xhtml` 在 Chromium 里走 **XML 解析器**（EPUB 3 要求正文良构）。不是良构的
 *      那一份会怎样？这一条决定「要不要自己先洗一遍正文」。
 *
 * 顺带把一句容易被忽略的话验掉：`file:` 在 @shared/url 的 HAS_SCHEME 白名单里，
 * 于是地址栏可以直接粘一个本机 EPUB 的路径——**选文件框不列它，不等于用户走不到它**。
 *
 * MOBI / AZW3 不在这里量：它们既不是 ZIP 也不是 XHTML，没有一条能共用的路。
 *
 * 跑法：npx electron spike/epub-import.js
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { pathToFileURL } = require('node:url')

const OUT = path.join(__dirname, 'out', 'epub-import')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/* ─────────────────────────────── ZIP 的两个最小实现 ───────────────────────────────
 * 一个写、一个读。都只用 node:zlib 与 Buffer——**这就是第 2 条要证明的事**：
 * 这一趟不需要任何新依赖。真实 EPUB 内部是 DEFLATE，因此写的时候除了 `mimetype`
 * （规范要求它必须 STORE 且是第一条）之外都用 method 8，让读的那一边真的走一遍
 * inflate，而不是在一个只存不压的玩具包上自证。
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function zipWrite(entries) {
  const parts = []
  const dirs = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data)
      ? e.data
      : Buffer.from(e.text ?? e.data, 'utf8')
    const method = e.store ? 0 : 8
    const body = method === 0 ? raw : zlib.deflateRawSync(raw)
    const name = Buffer.from(e.name, 'utf8')
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(0, 10)
    lh.writeUInt16LE(0x0021, 12) // 1980-01-01，随便一个合法值
    lh.writeUInt32LE(crc32(raw), 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28)
    parts.push(lh, name, body)
    dirs.push({ name, method, crc: crc32(raw), comp: body.length, raw: raw.length, offset })
    offset += 30 + name.length + body.length
  }
  const cdParts = []
  for (const d of dirs) {
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0, 8)
    ch.writeUInt16LE(d.method, 10)
    ch.writeUInt16LE(0, 12)
    ch.writeUInt16LE(0x0021, 14)
    ch.writeUInt32LE(d.crc, 16)
    ch.writeUInt32LE(d.comp, 20)
    ch.writeUInt32LE(d.raw, 24)
    ch.writeUInt16LE(d.name.length, 28)
    ch.writeUInt16LE(0, 30)
    ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34)
    ch.writeUInt16LE(0, 36)
    ch.writeUInt32LE(0, 38)
    ch.writeUInt32LE(d.offset, 42)
    cdParts.push(ch, d.name)
  }
  const cd = Buffer.concat(cdParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(dirs.length, 8)
  eocd.writeUInt16LE(dirs.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...parts, cd, eocd])
}

function zipRead(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 EOCD——这不是一个 ZIP')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`第 ${i} 条中央目录签名不对`)
    const method = buf.readUInt16LE(p + 10)
    const comp = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    // 本地头里的名字/扩展区长度**可能与中央目录不同**（中央目录允许改过名），
    // 因此寻址一律以本地头为准——照中央目录那两长度算，遇到带 extra 的包会错位。
    const dataStart =
      localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28)
    const body = buf.subarray(dataStart, dataStart + comp)
    out.push({ name, method, size, data: method === 0 ? body : zlib.inflateRawSync(body) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/* ────────────────────────────────── 一份最小但真实的 EPUB ────────────────────────────────── */

const 段落 =
  '桌面上一张白纸，写着字。要把它藏起来，先得决定藏的是纸还是字——这两件事在像素上并不相同。' +
  '把纸键掉的写法有许多种，成本却差得很远：有的要整页重算，有的只动一层底色。'

const CSS = `body { background: #ffffff; color: #111111; font-family: serif; margin: 48px; line-height: 1.9; }
h1 { font-size: 1.5em; margin: 0 0 1.2em; }
p { text-indent: 2em; margin: 0 0 0.9em; }
`

const 正文 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>第一章</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
<h1>第一章 · 纸与墨</h1>
<p>${段落}</p>
</body>
</html>`

/** 同一份正文，但带一条 CSP——真实 EPUB 常常带，而两条注入走的都不是它管的那条路 */
const 带CSP = 正文.replace(
  '<meta charset="utf-8" />',
  '<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'" />'
)

/** 故意不是良构 XML：`&nbsp;` 是 HTML 实体（XML 里没定义），`<p>` 也没闭合 */
const 非良构 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><meta charset="utf-8" /><title>坏的一章</title></head>
<body>
<h1>坏的一章</h1>
<p>这里有一个 HTML 实体：&nbsp; 而它在本页里没有定义
</body>
</html>`

function buildEpub() {
  return zipWrite([
    { name: 'mimetype', text: 'application/epub+zip', store: true }, // 规范：必须 STORE 且第一条
    {
      name: 'META-INF/container.xml',
      text: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`
    },
    {
      name: 'OEBPS/content.opf',
      text: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:zhituan-spike-0001</dc:identifier>
<dc:title>纸团探针样本</dc:title><dc:language>zh-CN</dc:language>
</metadata>
<manifest>
<item id="css" href="style.css" media-type="text/css" />
<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml" />
</manifest>
<spine><itemref idref="c1" /></spine>
</package>`
    },
    { name: 'OEBPS/style.css', text: CSS },
    { name: 'OEBPS/chapter1.xhtml', text: 正文 }
  ])
}

const fileUrl = (p) => pathToFileURL(p).href

/*
 * 本项目的读像素惯例（见 spike/live-app.js 的「明暗」）：`toBitmap()` 给的是 BGRA，
 * 而「纸在不在」的判据是**透明像素占比**——不是计算样式。原因很简单：`body` 的
 * 底色读成 `transparent` 时，画布上那张白纸照样还在，只有合成之后的像素答得了。
 */
function 像素(img) {
  const { width, height } = img.getSize()
  const bgra = img.toBitmap()
  let 透的 = 0
  let 数了 = 0
  let 最深 = 255
  let 最浅 = 0
  for (let i = 0; i + 3 < bgra.length; i += 16) {
    const b = bgra[i]
    const g = bgra[i + 1]
    const r = bgra[i + 2]
    const a = bgra[i + 3]
    数了++
    if (a === 0) 透的++
    // 「贴在黑上」看到的亮度：整体乘一个数时它按同一个数缩
    const 亮度 = (0.114 * b + 0.587 * g + 0.299 * r) * (a / 255)
    if (亮度 < 最深) 最深 = 亮度
    if (亮度 > 最浅) 最浅 = 亮度
  }
  return {
    尺寸: `${width}×${height}`,
    透明像素占比: Number((透的 / 数了).toFixed(3)),
    在黑上的幅: Math.round(最浅 - 最深)
  }
}

async function 读一屏(win) {
  const css = await win.webContents.executeJavaScript(`(() => {
    const b = getComputedStyle(document.body)
    return {
      contentType: document.contentType,
      XML被拒: !!document.querySelector('parsererror'),
      文字: (document.body.innerText || '').replace(/\\s+/g, '').length,
      正文底色: b.backgroundColor,
      正文上边距: b.marginTop,
      html不透明度: getComputedStyle(document.documentElement).opacity
    }
  })()`)
  await delay(400) // 注入与重画都在下一个合成帧里才看得见
  return { ...css, ...像素(await win.webContents.capturePage()) }
}

const show = (label, obj) => console.log(`${label} ${JSON.stringify(obj)}`)

/*
 * 这一趟摔过两次，兜底因此写在最外面：`app.whenReady().then(async () => …)` 里抛出的
 * 异常**不会带走进程**——它是没人接的拒绝，进程就那么挂着，终端上一片空白，
 * 读起来像「探针跑得慢」而不是「探针错了」（这是本项目记过的坑，Q29 同一族）。
 * 而且当时外面套了一层 `| grep`，管道按块缓冲，被 timeout 杀掉时缓冲全丢，
 * 于是连「跑到哪儿了」都看不到。所以：**日志落文件，另加一道看门狗。**
 */
process.on('unhandledRejection', (e) => {
  console.error('\n!! 没人接的拒绝：', e)
  app.exit(1)
})
process.on('uncaughtException', (e) => {
  console.error('\n!! 未捕获的异常：', e)
  app.exit(1)
})
const 看门狗 = setTimeout(() => {
  console.error('\n!! 看门狗：90 秒还没跑完，强退（上面最后一次打印就是卡住的位置）')
  app.exit(2)
}, 90000)

/*
 * 这一支里摔的第三跤，也是**最像产品 bug 的一条**：量完第 1 条就把那扇窗 `destroy()`
 * 掉，而此刻第二扇窗还没建——Electron 一看「窗口全关了」就走进退出流程（默认行为，
 * 不订阅 `window-all-closed` 就会 quit）。于是紧接着的每一次 `loadURL` 都返回
 * `ERR_FAILED`，读起来像「`.xhtml` 加载不了」，其实和那个文件毫无关系。
 * 一条空的订阅就够：订了，默认行为就不发生。
 */
app.on('window-all-closed', () => {})

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  /* ── 1) Chromium 拿到 .epub 会怎样（单独一扇窗，量完就销毁）──────────────────── */
  const epubPath = path.join(OUT, 'sample.epub')
  fs.writeFileSync(epubPath, buildEpub())
  const epubUrl = fileUrl(epubPath)

  console.log('===== 1) 视图直接加载一个本机 .epub =====')
  console.log(`文件 ${epubPath}（${fs.statSync(epubPath).size} 字节）`)

  const winA = new BrowserWindow({ width: 720, height: 520, show: false })
  const 事件 = []
  const s = winA.webContents.session
  s.on('will-download', (_e, item) => {
    事件.push({
      事件: 'will-download',
      mime: item.getMimeType(),
      存成: item.getFilename(),
      字节: item.getTotalBytes()
    })
    item.cancel() // 别真往磁盘上落东西
  })
  winA.webContents.on('did-finish-load', () => 事件.push({ 事件: 'did-finish-load' }))
  winA.webContents.on('did-fail-load', (_e, code, 说明) =>
    事件.push({ 事件: 'did-fail-load', code, 说明 })
  )

  const loadURL结果 = await winA
    .loadURL(epubUrl)
    .then(() => '完成')
    .catch((e) => `抛错 ${String(e).split('\n')[0].slice(0, 60)}`)
  /*
   * 这里必须等：`loadURL` 因为「这不是个可渲染的文档」当场就拒绝了，而
   * `will-download` 是**之后**才到的。第一版把拒绝当成结论、立刻往下走，于是
   * 那一次下载事件被记到了下一张导航头上（读起来像「加载 .xhtml 变成了下载」）。
   */
  await delay(2500)
  console.log(`loadURL：${loadURL结果}`)
  for (const e of 事件) show('  事件', e)
  console.log('    判据：`will-download` 先于 `did-finish-load` 到场，就说明它没进渲染器。\n')
  winA.destroy()

  /* ── 2) 只靠内置 zlib 能不能把它解开 ─────────────────────────────────────────── */
  console.log('===== 2) 只用 node:zlib 解开它 =====')
  const t0 = Date.now()
  const entries = zipRead(fs.readFileSync(epubPath))
  console.log(`解开用时 ${Date.now() - t0}ms，共 ${entries.length} 条：`)
  for (const e of entries) {
    console.log(
      `    ${(e.method === 0 ? 'STORE' : 'DEFLATE').padEnd(8)} ${String(e.data.length).padStart(6)}  ${e.name}`
    )
  }

  // 解出来的树按原路径落盘——**必须落在原路径上**：`chapter1.xhtml` 里那条
  // `<link href="style.css">` 是相对的，落到别处就静默失效（第一版就是这么错的，
  // 读出来的「正文上边距」是 8px 的 UA 默认值，而不是样式表里的 48px）。
  for (const e of entries) {
    const target = path.join(OUT, e.name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, e.data)
  }
  fs.writeFileSync(
    path.join(OUT, 'OEBPS', 'chapter-csp.xhtml'),
    带CSP
  )
  fs.writeFileSync(path.join(OUT, 'OEBPS', 'chapter-broken.xhtml'), 非良构)
  fs.writeFileSync(path.join(OUT, 'same-text.txt'), `第一章 · 纸与墨\n\n${段落}\n`, 'utf8')

  // OPF 里 <spine> 那一串就是「正文按什么次序读」——目录与进度都从它来
  const opf = entries.find((e) => e.name.endsWith('content.opf')).data.toString('utf8')
  const spine = [...opf.matchAll(/idref="([^"]+)"/g)].map((m) => m[1])
  const manifest = Object.fromEntries(
    [...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]])
  )
  show('【2】阅读次序（spine）', { idref: spine, 对应文件: spine.map((id) => manifest[id]) })
  console.log('    一个依赖都不用加——zlib 是 Node 内置的。\n')

  /* ── 3) 解出来的正文：能不能渲染、那两条注入落不落得下去 ─────────────────────── */
  /*
   * 这一扇窗**必须真的显示出来、而且带透明通道**——这是量「纸在不在」的前提：
   * 第一版用的是 `show: false` 的普通窗口，`capturePage()` 给回来的图 alpha 全是 255，
   * 于是连确定会透明的那一页 `.txt` 都读成「透明像素占比 0」，看上去像「注入没生效」。
   * 隐藏窗口里取不到带 alpha 的合成结果（Q20 同一族），这一条不是可选的讲究。
   */
  const winB = new BrowserWindow({
    width: 720,
    height: 520,
    show: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false
  })
  const 打开 = (rel) => winB.loadURL(fileUrl(path.join(OUT, rel)))

  console.log('===== 3) 把解出来的正文当一页加载（带 CSP 的那一份）=====')
  await 打开('OEBPS/chapter-csp.xhtml')
  show('【3a】注入前      ', await 读一屏(winB))

  const key = await winB.webContents.insertCSS(
    'html, body { background: transparent !important; }',
    { cssOrigin: 'user' } // 与 src/main/services/pageStyler.ts 逐字一致
  )
  show('【3b】注入透明底后', await 读一屏(winB))

  const 往返 = await winB.webContents.executeJavaScript(`(() => {
    const 行内 = document.documentElement.style
    行内.setProperty('opacity', '0.4000', 'important')
    const 淡 = getComputedStyle(document.documentElement).opacity
    行内.removeProperty('opacity')
    return { 写0_4之后: 淡, 撤掉之后: getComputedStyle(document.documentElement).opacity }
  })()`)
  show('【3c】CSSOM opacity 往返', 往返)
  await winB.webContents.removeInsertedCSS(key)
  show('【3d】移除注入后  ', await 读一屏(winB))

  console.log('\n===== 3-对照）同一段文字存成 .txt =====')
  await 打开('same-text.txt')
  show('【3e】.txt 原始   ', await 读一屏(winB))

  /* ── 4) 不是良构 XML 的那一份 ───────────────────────────────────────────────── */
  console.log('\n===== 4) 不是良构 XML 的 XHTML =====')
  await 打开('OEBPS/chapter-broken.xhtml')
  show('【4】', await 读一屏(winB))

  console.log('\n===== 结论 =====')
  console.log('· 第 1 条：Chromium **不渲染** `.epub`，它进的是下载那一路（`will-download` 到场，')
  console.log('  而 `loadURL` 直接以失败结束）。注释里那句话是量出来的，不是常识。')
  console.log('· 第 2 条：EPUB 就是个 ZIP、正文就是 XHTML，**node:zlib 一把解完，零新依赖**。')
  console.log('· 第 3 条：解出来的正文是一份普通文档，现有两条注入原样落得下去（含 CSP 那一份），')
  console.log('  且与 `.txt` 同类——**也就是说"能读"与"能透明"在技术上都已经通了**。')
  console.log('· 第 4 条：`.xhtml` 走 XML 解析器，**非良构就整页变解析错误**。要读 EPUB，')
  console.log('  得先把每一章洗成良构（或改扩展名用 HTML 解析器加载，但那会丢掉 EPUB 的语义）。')
  console.log('· 真正没做的是第 5 件事，它不在这一支里：**分章、目录、进度、字号**——')
  console.log('  那些是产品工作，不是平台限制。')

  clearTimeout(看门狗)
  app.exit(0)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('\n!! 探针中途抛错：', e)
    app.exit(1)
  })
)
