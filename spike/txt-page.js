/**
 * 探针：本机 TXT 那一屏——DOM 长什么样、注入的样式落不落得下去、透明度写不写得进。
 *
 * 用户报的是「读 TXT 时右栏那条『阅读』滑块拖了一点变化都没有」。`live-app.js` 的
 * A12 在**探针现写的一本小 TXT**上量到它是活的（幅 255 → 102 → 255），因此这一支
 * 要回答的是另一半：**换一本真的、大的、GBK 的 TXT，这条链还成不成立。**
 *
 * 素材默认拿用户机器上那本（`C:\Users\poem\Desktop\带着战略仓库回大唐.txt`，
 * 6.4MB / GBK / 无 BOM），给一个路径参数可以换成别的。另有一本探针现写的小 TXT
 * 作对照——两本跑同一套步骤，读数不同就说明差别在**这一本**上，不在代码里。
 *
 * ## 这一支量的是 1.6.8 及以前的形状
 *
 * 下面这四条读数是 **Chromium 的文本查看器**排出来的那一页上的。1.6.9 起本机 `.txt`
 * 不走那一条路了：它现在是自家的一页（`txt.html?doc=<token>`，形状见
 * spike/txt-typeset.js，续读见 spike/txt-resume.js），于是 `<pre>`、`characterSet`
 * 认成什么、往那一页注样式这套办法，**在 `.txt` 上都已经不成立**。
 *
 * 留着它是因为那条路还在：别的本机文本（`.md`、`.log` 这一类）照样交给 Chromium 排，
 * 换一个后缀就还是这一支要量的东西。
 *
 * 量的四件事，一件都不能省：
 *
 *   1. **DOM 形状**：Chromium 把 text/plain 排成什么（有没有 `<pre>`、内容挂在谁
 *      身上、`document.characterSet` 认成了什么编码）。后面所有注入都建在这上面。
 *   2. **透明底那张表**（`injectPageStyles` 的 `html, body { background: transparent
 *      !important }`，user origin）注进去之后，html / body 的实测底色是不是透了。
 *   3. **阅读透明度**（`applyReaderOpacity` 的 CSSOM 行内声明）写进去之后，行内
 *      `cssText` 与 `getComputedStyle(...).opacity` 各是多少——「没写进去」与
 *      「写进去了但引擎没照做」是两种坏法，修的地方完全不同。
 *   4. **合成之后的像素**：`capturePage` 的 alpha 分布。前三条都在页面自己的
 *      世界观里，只有这一条是这个程序对外的主张（桌面透不透过字）。
 *
 * 跑法：npx electron spike/txt-page.js [TXT 路径]
 * 产出：终端一份报告、spike/out/txt-page.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, WebContentsView } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const USER_TXT = 'C:\\Users\\poem\\Desktop\\带着战略仓库回大唐.txt'

/** 摘自 src/main/services/pageStyler.ts */
const TRANSPARENT_BACKGROUND = 'html, body { background: transparent !important; }'
const HIDE_SCROLLBARS =
  '::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }\n' +
  'html { scrollbar-width: none !important; -ms-overflow-style: none !important; }'

/** 摘自 pageStyler.applyReaderOpacity 的那几行（照抄，免得探针量的是另一份实现） */
const APPLY_OPACITY = (v) => `(() => {
  const 行内 = document.documentElement.style
  if (${v >= 1}) 行内.removeProperty('opacity')
  else 行内.setProperty('opacity', '${v.toFixed(4)}', 'important')
  return 行内.cssText
})()`

/** 尺寸、DOM 形状、编码、以及页面自己算出来的那几个值 */
const SHAPE = `(() => {
  const pre = document.querySelector('pre')
  const cs = pre ? getComputedStyle(pre) : null
  return {
    characterSet: document.characterSet,
    contentType: document.contentType,
    readyState: document.readyState,
    bodyChildren: [...document.body.children].map((e) => e.tagName).slice(0, 8),
    preCount: document.querySelectorAll('pre').length,
    preTextLength: pre ? pre.textContent.length : 0,
    textLength: document.body.textContent.length,
    scrollHeight: document.documentElement.scrollHeight,
    pre: cs && {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      whiteSpace: cs.whiteSpace,
      wordWrap: cs.wordWrap,
      fontFamily: cs.fontFamily,
      color: cs.color,
      paddingLeft: cs.paddingLeft,
      maxWidth: cs.maxWidth
    },
    html: {
      bg: getComputedStyle(document.documentElement).backgroundColor,
      opacity: getComputedStyle(document.documentElement).opacity,
      inline: document.documentElement.style.cssText
    },
    body: {
      bg: getComputedStyle(document.body).backgroundColor,
      opacity: getComputedStyle(document.body).opacity
    }
  }
})()`

/** 一张位图的 alpha 分布：非透明像素占多少、平均 alpha 多少 */
function alphaStats(image) {
  const size = image.getSize()
  const bmp = image.toBitmap() // BGRA
  let opaque = 0
  let sum = 0
  let peak = 0
  let n = 0
  for (let i = 3; i < bmp.length; i += 4) {
    const a = bmp[i]
    n++
    sum += a
    if (a > 8) opaque++
    if (a > peak) peak = a
  }
  return {
    尺寸: `${size.width}×${size.height}`,
    采样: n,
    非透明占比: Number((opaque / n).toFixed(4)),
    平均alpha: n ? Number((sum / n).toFixed(1)) : 0,
    最深: peak
  }
}

async function measure(label, file) {
  const url = pathToFileURL(file).href
  const win = new BaseWindow({
    x: -2000,
    y: -2000,
    width: 900,
    height: 500,
    frame: false,
    transparent: true,
    // 不显示：起在屏幕外又显出来的窗不合成、抓不到图（pdf-scheme 也是 show:false）。
    // 这一页有 3 百万像素高，抓整页是自找麻烦——每次都只抓视口那一块（见 抓图）。
    show: false,
    resizable: false,
    backgroundColor: '#00000000'
  })
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      disableHtmlFullscreenWindowResize: true
    }
  })
  view.setBackgroundColor('#00000000')
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 900, height: 500 })

  const wc = view.webContents
  const 报告 = { 素材: label, 地址: url, 文件字节: fs.statSync(file).size }

  /**
   * 抓视口那一块。
   *
   * **不能抓整页**：这本 TXT 的文档高 308 万像素，整页交给 capturePage 会当场抛
   * UnknownVizError（pdf-scheme 也记过这一跤）。视口那一块才是「用户此刻看到的」。
   */
  const 抓图 = async (note) => {
    try {
      return alphaStats(await wc.capturePage({ x: 0, y: 0, width: 860, height: 470 }))
    } catch (err) {
      return `抓图失败：${err && err.message ? err.message : String(err)}`
    }
  }

  try {
    const t0 = Date.now()
    await wc.loadURL(url)
    报告.加载耗时ms = Date.now() - t0
    await delay(300)

    // executeJavaScript 把返回值**直接**交回来（对象就是对象），不经过 JSON
    const t1 = Date.now()
    报告.样式注入前 = await wc.executeJavaScript(SHAPE)
    报告.读取DOM耗时ms = Date.now() - t1

    await wc.insertCSS(TRANSPARENT_BACKGROUND + '\n' + HIDE_SCROLLBARS, { cssOrigin: 'user' })
    await delay(120)
    报告.样式注入后 = await wc.executeJavaScript(SHAPE)

    // 还没上透明度时那一屏长什么样（应当在飞）
    报告.像素_淡之前 = await 抓图('淡之前')

    const target = 0.4
    const t2 = Date.now()
    const 行内1 = await wc.executeJavaScript(APPLY_OPACITY(target))
    报告.写透明度耗时ms = Date.now() - t2
    await delay(200)
    报告.淡到04_行内 = 行内1
    报告.淡到04 = await wc.executeJavaScript(SHAPE)
    报告.像素_淡到04 = await 抓图('淡到04')

    await wc.executeJavaScript(APPLY_OPACITY(1))
    await delay(200)
    报告.拉回100 = await wc.executeJavaScript(SHAPE)
    报告.像素_拉回100 = await 抓图('拉回来')
  } catch (err) {
    报告.出错 = String(err && err.message ? err.message : err)
  } finally {
    try {
      wc.close()
    } catch {
      /* 已销毁 */
    }
    win.destroy()
  }
  return 报告
}

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const 小样本 = path.join(os.tmpdir(), 'zt-txt-page-探针.txt')
  fs.writeFileSync(小样本, '纸团\n\n' + '这是一行用来量透明度的字，写得长一点好占满一整行。\n'.repeat(24), 'utf8')

  // argv 里混着 electron 自己的开关（--no-sandbox 之类），因此按名字找
  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null

  const 素材 = [
    ['小样本（探针现写）', 小样本],
    ['用户那本', 指定 && fs.existsSync(指定) ? 指定 : USER_TXT]
  ]

  const out = []
  for (const [label, file] of 素材) {
    if (!fs.existsSync(file)) {
      console.log(`\n--- ${label}：找不到 ${file}`)
      continue
    }
    const r = await measure(label, file)
    out.push(r)
    console.log(`\n================ ${label} ================`)
    console.log(`地址      ${r.地址}`)
    console.log(`字节      ${r.文件字节}   加载 ${r.加载耗时ms}ms   读 DOM ${r.读取DOM耗时ms}ms   写透明度 ${r.写透明度耗时ms}ms`)
    const s = r.样式注入前 ?? {}
    console.log(`编码      characterSet=${s.characterSet}  contentType=${s.contentType}  readyState=${s.readyState}`)
    console.log(`DOM       body 的孩子=[${(s.bodyChildren ?? []).join(', ')}]  pre=${s.preCount} 个  pre 文本 ${s.preTextLength} 字  body 文本 ${s.textLength} 字  文档高 ${s.scrollHeight}`)
    console.log(`pre 排版  ${JSON.stringify(s.pre)}`)
    console.log(`注入前    html.bg=${s.html?.bg}  body.bg=${s.body?.bg}`)
    const a = r.样式注入后 ?? {}
    console.log(`注入后    html.bg=${a.html?.bg}  body.bg=${a.body?.bg}`)
    console.log(`淡到 04   行内="${r.淡到04_行内}"`)
    console.log(`          html opacity=${r.淡到04?.html?.opacity}  body opacity=${r.淡到04?.body?.opacity}`)
    console.log(`拉回 100  html opacity=${r.拉回100?.html?.opacity}  行内="${r.拉回100?.html?.inline}"`)
    console.log(`像素      淡之前 ${JSON.stringify(r.像素_淡之前)}`)
    console.log(`          淡到04 ${JSON.stringify(r.像素_淡到04)}`)
    console.log(`          拉回来 ${JSON.stringify(r.像素_拉回100)}`)
    if (r.出错) console.log(`!! 出错   ${r.出错}`)
  }

  fs.writeFileSync(path.join(OUT_DIR, 'txt-page.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log(`\n…… 读数落在 spike/out/txt-page.json`)
  app.exit(0)
})
