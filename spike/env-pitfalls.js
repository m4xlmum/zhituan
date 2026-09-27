/**
 * 探针环境自身的几条脾气（见 docs/spike-findings.md 的 Q29 / Q31 / Q32）。
 *
 * 这个脚本不验产品，验的是**写下一个探针时反复踩到的三件事**：
 *
 *   1. `show: false` 的窗口里 `requestAnimationFrame` 到底跑不跑（跑，但慢），
 *      以及同窗口里 `setInterval(16)` 的真实频率——两者都是「等一帧」这件事的地基；
 *   2. 带透明通道的像素在 canvas 里往返一趟还剩什么：`putImageData` 写进去的
 *      全透明像素颜色当场就没了，PNG 保得住，**WebP 会把 alpha 低的像素颜色吃掉**；
 *   3. 构建产物里那几份样式表叫**什么名字**——源文件名在产物里一个都找不到。
 *
 * 跑法：npx electron spike/env-pitfalls.js
 *
 * 第 4 条（没人接的 promise 拒绝不会带走进程）没法在这个进程里顺手验，
 * 单独一支：npx electron spike/swallow.js
 *
 * **第 5 条只改 `userData` 挡不住改名搬迁**也没法在这里验（它要起重真主进程），
 * 但那一条比上面四条都贵：一次跑动就可能在用户的真目录上留下半个数据目录，
 * 而那个半成品会**永久挡掉**用户自己的数据。凡是要 `require` 真主进程的探针
 * （`live-app.js` / `book-tab.js`），必须**同时**把 `appData` 与 `userData`
 * 指到临时目录，理由与现场见 docs/spike-findings.md 的 Q68。
 *
 * **第 6 条：临时 userData 得自己收走——而在 Windows 上，「退出时自己删」做不到。**
 * 这一条是第 5 条那份「给真主进程用的临时目录」的附带代价：探针跑完不删，
 * 跑一趟留一份（2026-09-27 本机一天攒下 6 份、约 350MB），而被 `timeout` 收走
 * 的跑法又占多数（探针跑完不会自己退出，Electron 主进程还在）。**在退出前
 * `rmSync` 会失败**：进程还活着时它自己那些 `Cache` / `Code Cache` 目录动不了
 * （`EBUSY` / `EPERM`），而**同一个目录在进程退出之后从外面一次就删干净了**
 * ——不是权限问题，是「自己删自己」在 Windows 上不成立。
 *
 * 因此改在**开工前清旧的**：`spike/probe-temp.cjs` 的 `makeTempUserData()` 扫出
 * 同前缀、且早于 1 小时的目录删掉（1 小时这道门槛保证碰不到正在跑的那一份：
 * 本项目最长的一支探针三分半），并且**只认自己那个前缀**——`%TEMP%` 里别人写的
 * 东西一个都不动。退出时那次 `removeTemp()` 仍然留着（Linux / macOS 上它是真能
 * 删掉的），只是不再指望它。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_RENDERER = path.join(ROOT, 'out', 'renderer')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false })
  await win.loadURL('data:text/html,<body style="background:%23222">hi</body>')
  console.log('窗口 show =', win.isVisible(), '（下面几条都在隐藏窗口里量）\n')

  // ---------------------------------------------------------------- 1) 帧与定时器
  const raf = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let n = 0
      const t0 = Date.now()
      const tick = () => { n++; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      setTimeout(() => resolve({ frames: n, ms: Date.now() - t0 }), 1000)
    })
  `)
  console.log(
    `[1] 隐藏窗口里 rAF：${raf.frames} 帧 / ${raf.ms}ms ≈ ${(raf.frames / (raf.ms / 1000)).toFixed(0)}Hz`
  )
  console.log('    结论：**它一直在跑**（这里约 50Hz 而不是 60Hz），所以「等两帧」可用；')
  console.log('    但快慢不由我们定，等帧一律 race 一个定时器兜底。\n')

  const ticks = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let n = 0
      const id = setInterval(() => n++, 16)
      setTimeout(() => { clearInterval(id); resolve(n) }, 500)
    })
  `)
  console.log(`[1] 同窗口 setInterval(16)：500ms 触发 ${ticks} 次（偏慢，理由见 Q14）\n`)

  // ------------------------------------------------------------ 2) canvas 与 alpha
  const canvas = await win.webContents.executeJavaScript(`
    (() => {
      const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 4; return c }
      const a = mk(); const ga = a.getContext('2d')
      const d = ga.createImageData(4, 4)
      // 四个像素，颜色一样、alpha 依次是 0 / 1 / 128 / 255
      const put = (i, al) => { d.data[i*4]=255; d.data[i*4+1]=0; d.data[i*4+2]=0; d.data[i*4+3]=al }
      ;[0, 1, 128, 255].forEach((al, i) => put(i, al))
      ga.putImageData(d, 0, 0)
      const 写进去再读回来 = [0,1,2,3].map((i) => Array.from(ga.getImageData(i, 0, 1, 1).data))

      const 经一轮 = (mime) => new Promise((resolve) => {
        const b = mk(); const gb = b.getContext('2d')
        const img = new Image()
        img.onload = () => {
          gb.drawImage(img, 0, 0)
          resolve([0,1,2,3].map((i) => Array.from(gb.getImageData(i, 0, 1, 1).data)))
        }
        img.src = mime
      })
      const png = a.toDataURL('image/png')
      return 经一轮(png).then((pngOut) => {
        const c = mk()
        c.getContext('2d').drawImage(a, 0, 0)
        return 经一轮(c.toDataURL('image/webp')).then((webpOut) => ({
          写进去再读回来, 经PNG往返: pngOut, 经WebP往返: webpOut
        }))
      })
    })()
  `)
  const line = (label, rows) =>
    console.log(
      `[2] ${label}  ` +
        rows.map((r, i) => `alpha=${[0, 1, 128, 255][i]} → [${r.join(',')}]`).join('  ')
    )
  line('写进去再读回来 ', canvas.写进去再读回来)
  line('经 PNG 往返   ', canvas.经PNG往返)
  line('经 WebP 往返  ', canvas.经WebP往返)
  console.log('    结论：**全透明像素的颜色进 canvas 就没了**（预乘存储），PNG 保得住这个结果，')
  console.log('    WebP 连 alpha=1 那种近乎透明的像素也一并吃掉色。带 alpha 的素材走 PNG。\n')

  // ------------------------------------------------- 3) 产物里的样式表叫什么名字
  if (!fs.existsSync(OUT_RENDERER)) {
    console.log('[3] out/renderer 还没有——先跑一次 npx electron-vite build')
    app.exit(0)
    return
  }
  const heads = []
  for (const f of fs.readdirSync(path.join(OUT_RENDERER, 'assets'))) {
    if (!f.endsWith('.css')) continue
    const body = fs.readFileSync(path.join(OUT_RENDERER, 'assets', f), 'utf8')
    // 用各份样式表头部那句注释的第一行认它（源文件名在产物里已经没有了）
    const m = body.match(/\/\*\s*\n?\s*\*\s*([^\n*]{4,40})/)
    heads.push({ 产物: f, 开头: m ? m[1].trim() : body.slice(0, 30).replace(/\s+/g, ' ') })
  }
  const bySource = (kw) => heads.filter((h) => h.开头.includes(kw)).map((h) => h.产物)
  console.log('[3] 产物里的样式表：')
  for (const [源, kw] of [
    ['themes.css', '主题层'],
    ['tokens.css', '设计令牌'],
    ['base.css', '基础样式'],
    ['home.css', '起始页。'], // 带句号：不带的话会误命中 themes.css 里那句「起始页、界面、…」
    ['settings.css', '系统设置的样式。']
  ]) {
    const hit = bySource(kw)
    console.log(`    ${源.padEnd(13)} → ${hit.length ? hit.join('、') : '（没认出来，看下面的清单）'}`)
  }
  for (const h of heads) console.log(`      ${h.产物.padEnd(30)} ${h.开头}`)
  const indexHtml = path.join(OUT_RENDERER, 'index.html')
  if (fs.existsSync(indexHtml)) {
    const links = fs
      .readFileSync(indexHtml, 'utf8')
      .match(/assets\/[A-Za-z0-9_-]+\.css/g)
    console.log(`    index.html 的 <link> 顺序：${(links || []).join(' ')}`)
  }
  console.log('    结论：名字来自「把它拉进依赖图的那个模块」+ 内容哈希，**按源文件名 grep 一条都找不到**；')
  console.log('    要判「这份文档拿到了哪几条样式表」，读产物 HTML 的 <link> 顺序。')

  app.exit(0)
})
