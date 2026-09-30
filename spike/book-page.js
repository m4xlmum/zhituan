/**
 * 「书页」模型探针：章节不住在自己的文档里，而是住进**我们自己的阅读页**
 * （方案 A）。量四件事，每一件都决定实现里要不要多写一段代码：
 *
 *   1. 章节当**顶层文档**加载时，相对地址（`../images/x.svg`、`../styles/main.css`）
 *      由谁解析 —— 这是对照组，用来确认「换到自家页里之后必须自己改写地址」。
 *   2. 章节注入 Shadow DOM 之后，书自己的 `html { }` / `body { }` 规则还命中吗？
 *      命中的话，那两条最常见的排版规则不用管；不命中就得在容器上补一组默认值。
 *   3. 经自定义协议取回来的图片（绝对地址）加不加载得了 —— 协议 + CSP 那条路通不通。
 *   4. 纸归我们画时的**透明像素占比**：纸全透一档该接近 Q63 的 0.97，
 *      纸半透一档该几乎没有 alpha 0 的像素而平均 alpha 掉到一半左右。
 *
 * 对照 docs/spike-findings.md 的 Q63（章节当独立文档加载，占比 0.97）。
 *
 * 跑法（两个环境坑见 spike/env-pitfalls.js）：
 *   /usr/bin/env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     npx electron --no-sandbox --in-process-gpu spike/book-page.js
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const OUT = path.join(__dirname, 'out', 'book-page')
const SCHEME = 'zhituan-book'

/* 探针自己的兜底：没人接的 promise 拒绝不会带走进程，外层如果又用了管道，
 * 缓冲还会被 SIGTERM 一起吞掉——所以一律打印到日志文件（Q64 记过这一课）。 */
const 看门狗 = setTimeout(() => {
  console.error('!! 看门狗：90 秒还没跑完，强退')
  app.exit(2)
}, 90000)

process.on('uncaughtException', (e) => {
  console.error('!! 未捕获的异常：', e)
  app.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error('!! 没人接的拒绝：', e)
  app.exit(1)
})

/*
 * 必须在 app ready 之前声明特权，理由与 pdfReader.ts 同。
 * 这一条是探针里唯一与产品代码「复刻」的部分（真实现里它就是
 * services/bookReader.ts 的那一段）。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

/* ── 造一本「解开的书」：目录结构照 EPUB 的样子摆 ──────────────────────────── */

const CHAPTER_HTML = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>第一章</title>
  <link rel="stylesheet" type="text/css" href="../styles/main.css"/>
</head>
<body>
  <h1>第一章</h1>
  <p>这是一段正文，用来量尺寸与颜色。</p>
  <p><img src="../images/dot.svg" alt="点"/></p>
</body>
</html>
`

/* 书自己的样式表：故意把 html 与 body 都写上，好量「注入 Shadow DOM 之后还命不命中」 */
const BOOK_CSS = `html { background: #ffffff; }
body { margin-top: 48px; background: #ffffff; font-size: 20px; }
p { color: #112233; }
`

/* 1×1 的 PNG 要现成的 base64 才敢用；SVG 是纯文本，顺手还量了 image/svg+xml 这条 MIME */
const DOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#3366ff"/></svg>
`

function buildBook() {
  const root = path.join(OUT, 'book')
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.join(root, 'OEBPS', 'text'), { recursive: true })
  fs.mkdirSync(path.join(root, 'OEBPS', 'styles'), { recursive: true })
  fs.mkdirSync(path.join(root, 'OEBPS', 'images'), { recursive: true })
  fs.writeFileSync(path.join(root, 'OEBPS', 'text', 'ch1.xhtml'), CHAPTER_HTML, 'utf8')
  fs.writeFileSync(path.join(root, 'OEBPS', 'styles', 'main.css'), BOOK_CSS, 'utf8')
  fs.writeFileSync(path.join(root, 'OEBPS', 'images', 'dot.svg'), DOT_SVG, 'utf8')
  return root
}

/* ── 探针页：注入 + 测量都写在页里，主进程只负责问它 ──────────────────────── */

const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>book probe</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  #paper { position: absolute; inset: 0; background: rgba(255,255,255,0); }
  #host { position: absolute; inset: 0; }
</style></head>
<body>
  <div id="paper"></div>
  <div id="host"></div>
<script>
const CHAPTER = '${SCHEME}://book1/OEBPS/text/ch1.xhtml'
const paper = document.getElementById('paper')
const shadow = document.getElementById('host').attachShadow({ mode: 'open' })

window.setPaper = (a) => { paper.style.background = 'rgba(255,255,255,' + a + ')' }

window.__run = async () => {
  const out = {}

  const res = await fetch(CHAPTER)
  out.取回状态 = res.status + ' ' + res.headers.get('content-type')
  const html = await res.text()

  const doc = new DOMParser().parseFromString(html, 'text/html')
  out.顶层解析器 = doc.querySelector('parsererror') ? '出错' : '正常'

  /* 清洗：脚本与 on* 一律不留（EPUB 里合法地可以带脚本） */
  let 去掉脚本 = 0
  for (const el of doc.querySelectorAll('script, iframe, object, embed')) { el.remove(); 去掉脚本++ }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) { el.removeAttribute(attr.name); 去掉脚本++ }
    }
  }
  out.清洗掉的节点或属性 = 去掉脚本

  /* 改写相对地址：注入我们自己的文档之后，相对路径的基准是 book.html，不是书里的位置 */
  let 改写 = 0
  for (const el of doc.querySelectorAll('[src],[href],[poster]')) {
    for (const name of ['src', 'href', 'poster']) {
      const v = el.getAttribute(name)
      if (!v || v.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(v)) continue
      el.setAttribute(name, new URL(v, CHAPTER).href)
      改写++
    }
  }
  out.改写掉的地址 = 改写
  out.改写样例 = (doc.querySelector('link[rel]') || {}).getAttribute
    ? doc.querySelector('link[rel]').getAttribute('href') : '(无)'

  /*
   * 书的样式表：按改写过后的绝对地址注入 Shadow DOM。
   *
   * **必须等它 load 完再往下量。** 第一版直接 appendChild 就量，读到的是 UA 默认值
   * （body 的 margin-top 是 8px 而不是书里写的 48px），差点据此得出「书里的 body
   * 规则命中不了 Shadow DOM，得改写选择器」这个错的结论——而真相相反（第 4 条里
   * 正文上边距就是 48px）。link 是异步的，这是量测时机的问题，不是模型的问题。
   */
  const 样式表 = [...doc.querySelectorAll('link[rel~="stylesheet" i]')].map((l) =>
    document.importNode(l, true)
  )
  const 等 = 样式表.map(
    (l) =>
      new Promise((res) => {
        l.addEventListener('load', res, { once: true })
        l.addEventListener('error', res, { once: true })
        shadow.appendChild(l)
        setTimeout(res, 1500)
      })
  )
  await Promise.all(等)
  out.样式表加载完 = 样式表.length

  /*
   * 我们自己的两条规则，放在书的样式表**之后**（同分量时后来者胜）：
   * 把书自己的纸收掉——纸归我们画，滑块才管得住它。
   */
  const own = document.createElement('style')
  own.textContent = 'html, body { background-color: transparent !important; }'
  shadow.appendChild(own)

  /*
   * 关键一问：用 createElement('body') 造出来的元素摆进 Shadow DOM 之后，
   * 书里那条 body { margin-top: 48px } 还命不命中？
   * 命中 → 零改写；不命中 → 要在容器上补一组阅读默认值。
   */
  const 试验 = {}
  for (const tag of ['body', 'html', 'div']) {
    try {
      const el = document.createElement(tag)
      el.appendChild(document.createTextNode('量我'))
      const probe = document.createElement('div')
      probe.style.cssText = 'position:absolute;left:-9999px;top:0'
      probe.appendChild(el)
      shadow.appendChild(probe)
      const cs = getComputedStyle(el)
      试验[tag] = { 命中: cs.marginTop, 底色: cs.backgroundColor, 字号: cs.fontSize }
      probe.remove()
    } catch (err) {
      试验[tag] = { 出错: String(err) }
    }
  }
  out.三种容器 = 试验

  /* 真正注入：body 的子节点装进一个 body 元素（见上面的量测结论） */
  const box = document.createElement('body')
  for (const child of [...doc.body.childNodes]) box.appendChild(document.importNode(child, true))
  shadow.appendChild(box)

  /* 等图片与样式表就位 */
  await new Promise((r) => setTimeout(r, 1200))

  const img = shadow.querySelector('img')
  out.图片 = img
    ? { 完成: img.complete, 原始宽: img.naturalWidth, 实际地址: img.currentSrc || img.src }
    : '(书里没有图片)'
  const p = shadow.querySelector('p')
  out.正文色 = p ? getComputedStyle(p).color : '(没有 p)'
  out.正文列宽 = p ? p.getBoundingClientRect().width : 0
  out.正文上边距 = box ? getComputedStyle(box).marginTop : '(没有 box)'
  out.正文字号 = box ? getComputedStyle(box).fontSize : '(没有 box)'
  out.书的纸是否已收 = box ? getComputedStyle(box).backgroundColor : '(没有 box)'

  return out
}
</script>
</body></html>
`

/* ── 协议：把「书」当作一棵解开的目录树送出去 ─────────────────────────────── */

const MIME = {
  '.xhtml': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

let bookRoot = ''

async function handle(request) {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const url = new URL(request.url)
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const file = path.resolve(bookRoot, rel)
  if (file !== bookRoot && !file.startsWith(bookRoot + path.sep)) {
    return new Response('越界', { status: 400, headers: cors })
  }
  try {
    const buf = fs.readFileSync(file)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(buf.length)
      }
    })
  } catch {
    return new Response('没有这个条目', { status: 404, headers: cors })
  }
}

/* ── 量像素：透明占比与平均 alpha，判据与 live-app.js 同（BGRA） ──────────── */

async function measure(win) {
  /*
   * capturePage 在这个环境里会偶发 UnknownVizError（合成器那边还没把这一帧准备好），
   * 一次就放弃等于把「偶发」记成「量不到」。退避重试三次。
   */
  let image
  for (let i = 1; i <= 3; i++) {
    try {
      image = await win.webContents.capturePage()
      break
    } catch (err) {
      if (i === 3) throw err
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  const { width, height } = image.getSize()
  const buf = image.toBitmap()
  let 全透 = 0
  let 总和 = 0
  let 不透明 = 0
  const 总数 = width * height
  for (let i = 3; i < buf.length; i += 4) {
    const a = buf[i]
    if (a === 0) 全透++
    if (a === 255) 不透明++
    总和 += a
  }
  return {
    尺寸: `${width}×${height}`,
    全透占比: +(全透 / 总数).toFixed(4),
    不透明占比: +(不透明 / 总数).toFixed(4),
    平均alpha: +(总和 / 总数).toFixed(1)
  }
}

const show = (label, obj) => console.log(`${label} ${JSON.stringify(obj)}`)

app.on('window-all-closed', () => {
  /* Q64 记的坑：不挂这一条，destroy 一扇窗之后进程就进入退出流程，
   * 后面每一次 loadURL 都会 ERR_FAILED，看起来像「格式不支持」。 */
})

app.whenReady().then(async () => {
  clearTimeout(看门狗)
  fs.mkdirSync(OUT, { recursive: true })
  bookRoot = buildBook()

  const pageFile = path.join(OUT, 'page.html')
  fs.writeFileSync(pageFile, PAGE, 'utf8')

  protocol.handle(SCHEME, handle)

  /* ── 对照组：章节当**顶层文档**加载，相对地址由谁解析 ─────────────────── */
  const winA = new BrowserWindow({ width: 640, height: 480, show: false })
  const chapterUrl = `${SCHEME}://book1/OEBPS/text/ch1.xhtml`
  let 顶层 = {}
  try {
    await winA.loadURL(chapterUrl)
    await new Promise((r) => setTimeout(r, 900))
    顶层 = await winA.webContents.executeJavaScript(`(() => {
      const img = document.querySelector('img')
      const p = document.querySelector('p')
      return {
        contentType: document.contentType,
        parserError: !!document.querySelector('parsererror'),
        图片完成: img ? img.complete : null,
        图片原始宽: img ? img.naturalWidth : null,
        正文色: p ? getComputedStyle(p).color : null,
        正文上边距: getComputedStyle(document.body).marginTop
      }
    })()`)
    顶层['加载结果'] = '进了渲染器'
  } catch (err) {
    顶层['加载结果'] = `没进渲染器：${String(err)}`
  }
  show('【1】章节当顶层文档', 顶层)

  /* ── 主题：章节注入自家页的 Shadow DOM，纸归我们画 ─────────────────────── */
  /*
   * winA 留着不销毁，等下一扇窗起来再说。反过来（把唯一一扇窗 destroy 掉再建下一扇）
   * 会踩到 Q64 记的那个坑：窗口全关的那一瞬 Electron 已经开始走退出流程，之后新建的
   * 窗口虽然建得出来，capturePage 却一直回 UnknownVizError——读起来像「透明窗口量不了」，
   * 实际是探针自己的顺序错了。
   */
  const winB = new BrowserWindow({
    width: 640,
    height: 480,
    show: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false
  })
  await winB.loadURL(pathToFileURL(pageFile).href)

  const 注入 = await winB.webContents.executeJavaScript('window.__run()')
  show('【2】注入 Shadow DOM', {
    取回: 注入.取回状态,
    顶层解析器: 注入.顶层解析器,
    清洗掉的节点或属性: 注入.清洗掉的节点或属性,
    改写掉的地址: 注入.改写掉的地址,
    改写样例: 注入.改写样例
  })
  show('【3】书的 html/body/div 三种容器在 Shadow DOM 里', 注入.三种容器)
  show('【4】图片与正文', {
    图片: 注入.图片,
    正文色: 注入.正文色,
    正文列宽: 注入.正文列宽,
    正文上边距: 注入.正文上边距,
    书的纸是否已收: 注入.书的纸是否已收
  })

  /* 纸全透（右栏那个滑块拉到头） */
  await winB.webContents.executeJavaScript('window.setPaper(0)')
  await new Promise((r) => setTimeout(r, 400))
  show('【5】纸全透', await measure(winB))

  /* 纸半透 */
  await winB.webContents.executeJavaScript('window.setPaper(0.5)')
  await new Promise((r) => setTimeout(r, 400))
  show('【6】纸半透', await measure(winB))

  console.log('\n· 第 1 条问的是「章节当独立文档时相对地址由谁管」——若它在那里就能加载图片，')
  console.log('  说明注入自家页之后那次地址改写是必须的（基准换成了我们的页面）。')
  console.log('· 第 3 条若 body 命中 margin-top: 48px，则零改写；否则实现里要在容器上补默认排版。')
  console.log('· 第 5 条与 Q63 的 0.97 对照；第 6 条说明「纸归我们画」之后滑块真的作用在纸上。')

  app.exit(0)
})
