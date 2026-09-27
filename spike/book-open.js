/**
 * 方案 A 的端到端探针：**真的主进程模块 + 真的渲染产物 + 真的 EPUB**。
 *
 * 与它旁边那支 book-page.js 的分工：那一支量的是「模型」——章节注入 Shadow DOM
 * 之后书的 CSS 还命不命中、纸归我们画时透明占比多少，用的是探针自己搭的一页。
 * 这一支量的是**这条链路真的接通了没有**：
 *
 *   真 EPUB（spike/make-test-epub.py 用 zipfile 造的）
 *     → 真的 services/bookReader.ts（用 esbuild 打进探针，electron 转发真实现）
 *       → 真的 out/renderer/book.html（electron-vite 构建产物）
 *         → 真的 BookApp / epub.ts 走完打开、解析、注入、翻章
 *
 * 中途一处替身都没有，唯一的例外是配置那座桥（spike/book-probe-preload.cjs）——
 * 真 preload 要校验来源，探针这一页是 file: 加载的，走不通。
 *
 * 跑法（先 python spike/make-test-epub.py，两个环境坑见 spike/env-pitfalls.js）：
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     npx electron --no-sandbox --in-process-gpu spike/book-open.js
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const OUT = path.join(__dirname, 'out', 'book-open')
const EPUB = path.join(OUT, 'sample.epub')
const RENDERER = path.join(__dirname, '..', 'out', 'renderer')
const PARTITION = 'persist:zhituan'

/*
 * 先摆好两件事，再 require 那个包：
 *   1. ELECTRON_RENDERER_URL —— bookReaderUrl() 靠它拼出阅读页的地址（rendererUrl
 *      走的是同一条规矩）。不设的话它会按打包后的 __dirname 推算，落到探针目录里去。
 *   2. global.__electron —— 打进包里的 electron 门面（spike/electron-stub.cjs）从
 *      这里取真实现。
 */
process.env.ELECTRON_RENDERER_URL = pathToFileURL(RENDERER).href
global.__electron = require('electron')

const { bookReaderUrl, registerBookProtocol, registerBookScheme } = require('./out/bookReader.cjs')

const 看门狗 = setTimeout(() => {
  console.error('!! 看门狗：120 秒还没跑完，强退')
  app.exit(2)
}, 120000)

process.on('uncaughtException', (e) => {
  console.error('!! 未捕获的异常：', e)
  app.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error('!! 没人接的拒绝：', e)
  app.exit(1)
})

/* 特权必须在 app ready 之前声明（这里调用的就是产品代码那一个函数） */
registerBookScheme()

const show = (label, obj) => console.log(`${label} ${JSON.stringify(obj)}`)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** 等阅读页把一章排完（.hud 出现就是 ready），或等它报错 */
async function waitReady(win, ms = 20000) {
  const started = Date.now()
  while (Date.now() - started < ms) {
    const state = await win.webContents.executeJavaScript(
      '(() => { const n = document.querySelector(".note"); const h = document.querySelector(".hud__count"); return { note: n ? n.textContent : null, hud: h ? h.textContent : "" } })()'
    )
    if (state.note && state.note.indexOf('打不开') === 0) return state
    if (state.hud) return state
    await delay(250)
  }
  return { note: '(超时)', hud: '' }
}

/** 读这一页此刻的全部结论。**注入的代码里一个反引号都不用**（外面那层是模板串） */
const READ = `(() => {
  const host = document.querySelector('.sheet')
  const root = host && host.shadowRoot
  const body = root && root.querySelector('body')
  const imgs = root ? [...root.querySelectorAll('img')] : []
  const withHandler = root
    ? [...root.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^on/i.test(a.name))
      ).length
    : -1
  const first = root && root.querySelector('p')
  return {
    章节标题: root && root.querySelector('h1') ? root.querySelector('h1').textContent : null,
    正文长度: body ? body.textContent.trim().length : 0,
    书的body上边距: body ? getComputedStyle(body).marginTop : null,
    书的body字号: body ? getComputedStyle(body).fontSize : null,
    书的body底色: body ? getComputedStyle(body).backgroundColor : null,
    正文段色: first ? getComputedStyle(first).color : null,
    图片: imgs.map((i) => ({ 完成: i.complete, 原始宽: i.naturalWidth, 地址: i.currentSrc || i.src })),
    阴影里的script数: root ? root.querySelectorAll('script').length : -1,
    阴影里的iframe数: root ? root.querySelectorAll('iframe').length : -1,
    残留的事件属性数: withHandler,
    脚本有没有真跑过: typeof window.__should_not_run,
    window上有没有onload留下的记号: typeof window.__also_should_not_run,
    纸的计算底色: getComputedStyle(document.querySelector('.paper')).backgroundColor,
    读数: document.querySelector('.hud__count') ? document.querySelector('.hud__count').textContent : ''
  }
})()`

/** 量合成之后的像素。判据与 live-app.js 同（BGRA），Q64 记过为什么必须真显示出来 */
async function measure(win) {
  let image
  for (let i = 1; i <= 3; i++) {
    try {
      image = await win.webContents.capturePage()
      break
    } catch (err) {
      if (i === 3) throw err
      await delay(600)
    }
  }
  const { width, height } = image.getSize()
  const buf = image.toBitmap()
  let 全透 = 0
  let 不透明 = 0
  let 总和 = 0
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

app.on('window-all-closed', () => {
  /* Q64：不挂这一条，destroy 一扇窗之后进程就开始走退出流程 */
})

app.whenReady().then(async () => {
  clearTimeout(看门狗)

  if (!fs.existsSync(EPUB)) {
    console.error(`!! 没有样本：${EPUB}\n   先跑 python spike/make-test-epub.py`)
    app.exit(1)
    return
  }

  /* 与 product 一样挂在分区会话上（挂错了地方等于这条协议不存在） */
  const ses = session.fromPartition(PARTITION)
  registerBookProtocol(ses)

  const pageUrl = bookReaderUrl(pathToFileURL(EPUB).href)
  const token = new URL(pageUrl).searchParams.get('doc')
  const base = `zhituan-book://${token}/`

  show('【0】入口', {
    阅读页: pageUrl.replace(/^file:\/\/\//, ''),
    书: path.basename(EPUB),
    字节: fs.statSync(EPUB).size,
    协议根: base
  })

  const win = new BrowserWindow({
    width: 640,
    height: 480,
    show: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'book-probe-preload.cjs'),
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  await win.loadURL(pageUrl)

  /* ── 1) 协议通道本身：那几个条目分别回什么 ───────────────────────────────── */
  const 通道 = await win.webContents.executeJavaScript(
    `(async () => {
      const base = '${base}'
      const out = {}
      const names = [
        'mimetype',
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/nav.xhtml',
        'OEBPS/text/ch1.xhtml',
        'OEBPS/text/ch2.xhtml',
        'OEBPS/styles/main.css',
        'OEBPS/images/dot.svg',
        'OEBPS/images/' + encodeURIComponent('我 的.svg')
      ]
      for (const n of names) {
        const r = await fetch(base + n)
        out[n] = r.status + ' ' + (r.headers.get('content-type') || '')
      }
      const missing = await fetch(base + 'OEBPS/nope.png')
      out['书里没有的条目'] = missing.status
      const escape = await fetch(base + '../../../../etc/hosts')
      out['试着往上跳一层'] = escape.status
      return out
    })()`
  )
  show('【1】协议通道', 通道)

  /* ── 2) 页面打开这本书 ───────────────────────────────────────────────────── */
  const ready = await waitReady(win)
  show('【2】页面就绪', ready)

  const 首章 = await win.webContents.executeJavaScript(READ)
  show('【3】第一章（清洗 / 书的 CSS / 图片）', {
    章节标题: 首章.章节标题,
    正文长度: 首章.正文长度,
    书的body上边距: 首章.书的body上边距,
    书的body字号: 首章.书的body字号,
    书的body底色: 首章.书的body底色,
    正文段色: 首章.正文段色,
    图片: 首章.图片,
    阴影里的script数: 首章.阴影里的script数,
    残留的事件属性数: 首章.残留的事件属性数,
    脚本有没有真跑过: 首章.脚本有没有真跑过,
    window上有没有onload留下的记号: 首章.window上有没有onload留下的记号,
    纸的计算底色: 首章.纸的计算底色,
    读数: 首章.读数
  })

  /* ── 3) 目录：点开它，再按文字找到「第二章」那一跳 ────────────────────────── */
  /*
   * 点完必须**等一拍再读**：Vue 的 DOM 更新在下一个 tick，synchronously 读回来是空的。
   * 第一版就是这么错的（【4】读到 `[]`），而紧接着那句 `items[1]` 顺手点到了第一章
   * 底下那个嵌套锚点（nav 里第三条 a 才是第二章），于是【5】读到的还是第一章——
   * 两处都是探针的错，看起来却像「目录没做出来」。
   */
  await win.webContents.executeJavaScript(
    `(() => { const k = document.querySelector('.hud__key'); if (k) k.click() })()`
  )
  await delay(300)
  const 目录 = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.toc__item')].map((b) => ({
      文字: b.textContent.trim(),
      缩进: b.style.paddingLeft
    }))`
  )
  show('【4】目录', 目录)

  await win.webContents.executeJavaScript(
    `(() => {
      const hit = [...document.querySelectorAll('.toc__item')].find((b) => b.textContent.includes('第二章'))
      if (hit) hit.click()
    })()`
  )
  await delay(900)

  const 次章 = await win.webContents.executeJavaScript(READ)
  show('【5】第二章（**故意不是良构的 XHTML**，量那条逃生口）', {
    章节标题: 次章.章节标题,
    正文长度: 次章.正文长度,
    残留的事件属性数: 次章.残留的事件属性数,
    读数: 次章.读数
  })

  /* ── 3b) 用方向键往回翻一章：量 turn() 这条路 ─────────────────────────────── */
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' })
  await delay(900)
  const 回章 = await win.webContents.executeJavaScript(READ)
  show('【5b】左方向键回第一章', { 章节标题: 回章.章节标题, 读数: 回章.读数 })

  await delay(600)

  /* ── 4) 纸：滑块两头各量一次 ─────────────────────────────────────────────── */
  await win.webContents.executeJavaScript('window.zhituan.__probeSetOpacity(1)')
  await delay(500)
  show('【6】纸全透（滑块 100%）', await measure(win))

  await win.webContents.executeJavaScript('window.zhituan.__probeSetOpacity(0.5)')
  await delay(500)
  show('【7】纸半透（滑块 50%）', await measure(win))

  console.log('\n· 【1】里 ch1/ch2 的 content-type 该是 text/html——不是 application/xhtml+xml，')
  console.log('  那正是为了绕开「.xhtml 走 XML 解析器、正文不闭合就整页消失」那个坑。')
  console.log('· 【3】的文档里带着 <script> 与 onload=，字号 20px 来自书的 CSS，')
  console.log('  两个图片都该加载成功（其中一个是带空格与中文名的条目）。')
  console.log('· 【5】是那份故意不闭合的 XHTML：它照样要读出正文，而不该变成解析错误。')
  console.log('· 【6】【7】与 Q63 的 0.97 对照；不透明占比在两次之间应当**一个像素都不变**。')

  app.exit(0)
})
