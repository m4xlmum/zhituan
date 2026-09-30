/**
 * 探针：离线阅读的排版**四项**（字号 / 行距 / 左右留白 / 段距），端到端走一遍。
 *
 * 问的是 1.6.6 那一版就立起来的那件事，只是**这一版换了一页**：本机 TXT 不再交给
 * Chromium 的文本查看器渲染（那一页整篇是一个 `pre`，见 spike/txt-page.js 量的形状），
 * 而是自家那一页（`txt.html?doc=<token>`）。于是这一支量的是 `.txt__body`，不是 `pre`。
 * 段距（1.6.10 加的那一项）落的就是这一页：正文是纯文本，要一段一段垫东西就得先把
 * 它切成元素（切法在 spike/txt-split.js 里单测过，这里量的是**切完之后有没有落上去**）。
 *
 * 量的是**翻开之后往后翻到的、真有正文的那一章**，不是落地那一章：用户那本小说的第 1 章
 * 是书名页（11 个字、一个段落），而段距要的是「段与段之间」——第 1 章上量不出它来。
 * 翻章走页面自己的方向键通道，与用户按一下是同一件事（见 main() 里那一段）。
 *
 * 「面板摆在锚点下方」这一条**不判**，只记读数：主窗口被挪出屏幕之后 place() 会把两个
 * 方向都夹进工作区，夹出来的位置一样，这一条在无头跑法里量不了（见 main() 里那一段）。
 *
 * 六件事，每件都得有读数：
 *
 *   1. **默认那一组有没有落上去**。量的是正文**算出来的** font-size / line-height /
 *      padding（不是我们写进去的那串字——「写进去了、没生效」正是这一条最可能出的
 *      坏法）。段距的默认值 0 另有一条判据：**这时正文里一个 .txt__p 都不该有**，
 *      正文还是那一个文本节点（「默认值 = 这一版之前的样子」在这条路上是连 DOM 都没动）。
 *      同时量一遍外壳：这一页是自家那一页，场上**没有**哪一屏加载的是那个 `.txt` 本身
 *      （判错了 kind，Chromium 会把它当下载变成一片空白，见 book-tab 的 T1）。
 *   2. **顶栏那枚 Aa 键在不在、按下去面板出不出来**。它在读本机文本时可用，在网页上禁用。
 *      面板里是**四行**，读数是配置里那四个数（顺带判一次分类：读本机 TXT 时，
 *      段距那一行**不该**是灰的——灰了就是 paraOff 把自家这一页也当成 Chromium 那类了）。
 *   3. **面板里拖一下，正文当场变**，且四个方向各自独立（改留白不动字号……）。
 *      段距这一条量的是第二段算出来的 padding-top：它该等于字号 × 那一档的值。
 *   4. **两枚浮层键是干净的**（`.hud__key` 没有 Chromium 给按钮的原生灰底与立体边框）。
 *      这一条是跟着新页面一起补的：读者页不加载 base.css，而那两条规则原先是 UA 说了算。
 *   5. **网页上那枚键该是禁用的**。
 *   6. **面板自己没被裁**（它是固定高度的子窗口，四行加一句话得整个放得下）。
 *
 * 跑法：npx electron --no-sandbox spike/txt-typeset.js
 *      npx electron --no-sandbox spike/txt-typeset.js --txt <路径>
 * 产出：终端一份读数、spike/out/txt-typeset.json（任一条不成立就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, BrowserWindow } = require('electron')
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

const TEMP = makeTempUserData('zhituan-txttype-')

/** 抄一份用户的数据到临时目录；窗口挪出屏幕之外。排版四项**写成默认值**，好对账 */
function 抄一份(realDir) {
  for (const f of ['config.json', 'history.json', 'bookmarks.json', 'ball-icon.json']) {
    if (!realDir) break
    try {
      const text = fs.readFileSync(path.join(realDir, f), 'utf8')
      if (f !== 'config.json') {
        fs.writeFileSync(path.join(TEMP, f), text, 'utf8')
        continue
      }
      const data = JSON.parse(text)
      data.window.x = OFF_X
      data.window.y = OFF_Y
      data.stealth.autoCollapse = false
      data.ui.readerFontSize = 17
      data.ui.readerLineHeight = 1.85
      data.ui.readerMargin = 6
      data.ui.readerParagraph = 0
      fs.writeFileSync(path.join(TEMP, f), JSON.stringify(data, null, 2), 'utf8')
    } catch {
      // 没有这一份就算了
    }
  }
}

const APP_DATA = app.getPath('appData')
const REAL_USER_DATA = [path.join(APP_DATA, 'zhituan'), path.join(APP_DATA, 'moyu-reader')].find((p) =>
  fs.existsSync(p)
)
抄一份(REAL_USER_DATA)

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
const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场')
  app.exit(1)
}, 150_000)

const fileOf = (url) => (!url ? '(空)' : (url.split(/[\\/]/).pop() || url).split('?')[0])
const r2 = (n) => Math.round(n * 100) / 100

/**
 * 量正文那一层。
 *
 * 量的是**算出来的值**（`getComputedStyle`），不是写在行内的那串字：排版四项走的是
 * `--zhituan-reader-*` 那四个自定义属性，而「变量写没写进去 / 写进去了有没有人用」
 * 是两种坏法，只有算出来才算数。
 *
 * 段距那三样（`段块数` / `空行块数` / `第二段的上内边距`）就是为此加的：段距落在
 * `.txt__p ~ .txt__p` 的 padding-top 上，而**第一段不该有**（它前面不是「段之间」）、
 * 空行那一片也不该有（见 styles/txt.css）。
 *
 * 顺带量三样：读数那一句（章名 + 第几章/共几章）、那一行章名、以及浮层上那枚键的
 * 底色与边框——最后这两个是判据四要看的东西。
 */
const 量正文 = (wc) =>
  wc.executeJavaScript(`(() => {
    const b = document.querySelector('.txt__body')
    if (!b) return { 有正文: false, 场上有什么: [...document.querySelectorAll('*')].slice(0, 10).map((e) => e.className || e.tagName) }
    const s = getComputedStyle(b)
    const r = b.getBoundingClientRect()
    const 键 = document.querySelector('.hud__key')
    const 键样式 = 键 ? getComputedStyle(键) : null
    const 段 = [...b.querySelectorAll('.txt__p')]
    const 空行 = [...b.querySelectorAll('.txt__gap')]
    return {
      有正文: true,
      算出来的字号: s.fontSize,
      算出来的行距: s.lineHeight,
      算出来的左内边距: s.paddingLeft,
      算出来的右内边距: s.paddingRight,
      字体系列: s.fontFamily.split(',')[0],
      盒宽: Math.round(r.width),
      文档高: document.documentElement.scrollHeight,
      正文长: b.textContent.length,
      // 这一章排不排得出「段与段」：一段也要有两行才谈得上（判据一的那条前置）
      正文里的行数: b.textContent.split('\\n').length - 1,
      // 分段排的那条路：段距大于 0 时正文是一个个 .txt__p，等于 0 时是那一个文本节点
      段块数: 段.length,
      空行块数: 空行.length,
      第一块的上内边距: 段.length ? getComputedStyle(段[0]).paddingTop : null,
      第二块的上内边距: 段.length > 1 ? getComputedStyle(段[1]).paddingTop : null,
      章名: document.querySelector('.txt__head')?.textContent?.trim() ?? null,
      读数: document.querySelector('.hud__count')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      键底色: 键样式 ? 键样式.backgroundColor : null,
      键边框: 键样式 ? 键样式.borderTopWidth : null,
      滚动条: (() => { const st = document.querySelector('.stage'); return st ? { 高: st.clientHeight, 内容高: st.scrollHeight } : null })()
    }
  })()`)

/** 在 chrome 里量那枚 Aa 键 */
const 量键 = (chrome) =>
  chrome.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.topbar button[aria-label="排版"]')
    if (!b) return { 有这枚键: false }
    const r = b.getBoundingClientRect()
    return {
      有这枚键: true,
      文字: b.textContent.trim(),
      禁用: b.disabled,
      矩形: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }
  })()`)

/** 在面板那扇窗里拖某一条滑块 */
const 在面板里拖 = (pop, 第几条, 值) =>
  pop.webContents.executeJavaScript(`(() => {
    const 条 = document.querySelectorAll('.trow')[${第几条}]
    if (!条) return { 找到了: false }
    const el = 条.querySelector('.trange')
    el.value = String(${值})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return { 找到了: true, 标签: 条.querySelector('.tlabel')?.textContent?.trim(), 读数: 条.querySelector('.tvalue')?.textContent?.trim() }
  })()`)

async function main() {
  await delay(4000)

  const win = BaseWindow.getAllWindows()[0]
  if (!win) throw new Error('真主进程没有建出窗口')
  const b = win.getBounds()
  win.setBounds({ x: OFF_X, y: OFF_Y, width: b.width, height: b.height })

  const chrome = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'index.html')
  if (!chrome) {
    throw new Error(
      `认不出界面层：场上是 ${win.contentView.children.map((v) => fileOf(v.webContents.getURL())).join('、')}`
    )
  }

  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null
  let 书 = 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
  if (!书) {
    书 = path.join(TEMP, '探针写的大样本.txt')
    fs.writeFileSync(书, ('第1章 大唐\n\n    贞观九年，长安城，大街上，人声鼎沸。\n').repeat(20000), 'utf8')
  }
  const 地址 = pathToFileURL(书).href
  const 报告 = { 素材: 书, 字节: fs.statSync(书).size, 素材说明: '真小说是 GBK / 无 BOM' }

  console.log(`…… 开这一本：${书}（${报告.字节} 字节）`)
  await chrome.webContents.executeJavaScript(
    `window.zhituan.tabs.create({ url: ${JSON.stringify(地址)}, activate: true })`
  )

  let 读的那一屏 = null
  for (let i = 0; i < 60; i++) {
    await delay(500)
    读的那一屏 = win.contentView.children.find((v) => fileOf(v.webContents.getURL()) === 'txt.html')
    if (读的那一屏) {
      const 好了 = await 读的那一屏.webContents.executeJavaScript('document.readyState').catch(() => 'loading')
      if (好了 === 'complete') break
    }
  }
  if (!读的那一屏) {
    throw new Error(
      `没等到自家那一页：场上是 ${win.contentView.children.map((v) => fileOf(v.webContents.getURL())).join('、')}`
    )
  }
  // 正文要解码 + 切章才出来，等它有了再量
  for (let i = 0; i < 40; i++) {
    const 有 = await 读的那一屏.webContents
      .executeJavaScript(`Boolean(document.querySelector('.txt__body'))`)
      .catch(() => false)
    if (有) break
    await delay(250)
  }
  await delay(600)

  /*
   * 往后翻到**真有正文**的那一章再量。
   *
   * 用户那本小说的第 1 章是书名页（`《带着战略仓库回大唐》`，正文 11 个字、一个段落），
   * 而段距量的是 `p + p`——一章里只有一个 `<p>` 时那一行无从成立。第一跑就是这么红的：
   * 段块数 0 → 1，`第二块的上内边距` 根本没有，判据三只差这一条。
   *
   * 翻章走页面自己的方向键通道（TxtApp 的 onKey），与用户按一下是同一件事。
   * 判据取的是**这一章的长度**而不是「翻几次」：换一份素材（`--txt` 指定一份日志）
   * 时，章序里哪一章有正文并不一样。
   */
  let 这一章字数 = 0
  for (let i = 0; i < 15; i++) {
    这一章字数 = await 读的那一屏.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('.txt__body'); return b ? b.textContent.length : 0 })()`
    )
    if (这一章字数 >= 800) break
    await 读的那一屏.webContents.executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`
    )
    await delay(250)
  }
  if (这一章字数 < 800) throw new Error('翻了十几章都没翻到有正文的一章，这一份素材量不了段距')
  await delay(400)

  console.log(`\n================ 一、接线与默认那组（${path.basename(书)}）================`)
  console.log(`量的是这一章（${这一章字数} 字）：翻到有正文的一章才量得到段距`)
  报告.地址 = 读的那一屏.webContents.getURL()
  报告.掉到文件本身上了吗 = Boolean(
    win.contentView.children.find((v) => v.webContents.getURL() === 地址)
  )
  报告.注入前 = await 量正文(读的那一屏.webContents)
  console.log(`地址      ${报告.地址.slice(0, 110)}`)
  console.log(`正文      ${JSON.stringify(报告.注入前, null, 0)}`)

  // 期望：字号 17px、行距 1.85×17=31.45px、左右内边距各 6%、段距 0（= 一个 .txt__p 都没有）
  const 盒宽 = 报告.注入前.盒宽 ?? 0
  const 期望左 = r2(盒宽 * 0.06)
  报告.判据一 = {
    加载的是自家那一页: fileOf(报告.地址) === 'txt.html',
    没有掉到文件本身上: !报告.掉到文件本身上,
    字号对: 报告.注入前.算出来的字号 === '17px',
    行距对: Math.abs(parseFloat(报告.注入前.算出来的行距) - 31.45) < 0.6,
    留白对: Math.abs(parseFloat(报告.注入前.算出来的左内边距) - 期望左) < 2,
    // 这一条是判据三的前置：量到的是**有正文的那一章**（第 1 章是书名页，见上面那一段）
    这一章有不止一行: 报告.注入前.正文里的行数 >= 3,
    段距0时不切段: 报告.注入前.段块数 === 0 && 报告.注入前.空行块数 === 0,
    章名排出来了: typeof 报告.注入前.章名 === 'string' && 报告.注入前.章名.length > 0,
    读数写着第几章共几章: /·\s*\d+\/\d+$/.test(报告.注入前.读数 ?? '')
  }
  console.log(
    `判据一    ${JSON.stringify(报告.判据一)}   （盒宽 ${盒宽}，6% 应是 ${期望左}px；读数「${报告.注入前.读数}」）`
  )

  // ---- 二、顶栏那枚 Aa ----
  console.log(`\n================ 二、顶栏那枚 Aa 键 ================`)
  报告.键_读TXT时 = await 量键(chrome)
  console.log(`读 TXT    ${JSON.stringify(报告.键_读TXT时)}`)

  if (!报告.键_读TXT时.有这枚键) throw new Error('顶栏里没有那枚 Aa 键')

  // 按下去，等面板出来
  await chrome.webContents.executeJavaScript(
    `document.querySelector('.topbar button[aria-label="排版"]').click()`
  )
  let pop = null
  for (let i = 0; i < 30; i++) {
    await delay(200)
    pop = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && /kind=typeset/.test(w.webContents.getURL())
    )
    if (pop) {
      const 好了 = await pop.webContents.executeJavaScript('document.readyState').catch(() => 'loading')
      if (好了 === 'complete') break
    }
  }
  if (!pop) throw new Error('点了 Aa 之后没等到排版面板')
  /*
   * 把它挪出屏幕再量。
   *
   * `place()` 会把面板夹回工作区（摆到屏幕外就等于用户看不见它），因此只把主窗口
   * 挪到 -4000 是不够的——面板会落到主显示器左上角。挪走之后布局照常算（窗口是
   * 「可见但不在屏幕上」，不是隐藏的），量的那几个数一个都不受影响。
   * 改开发期弹窗扰民的那条规矩：见 spike/live-app.js 的文件头。
   */
  const 面板尺寸 = pop.getBounds()
  pop.setBounds({ x: OFF_X, y: OFF_Y, width: 面板尺寸.width, height: 面板尺寸.height })
  await delay(400)

  报告.面板 = {
    地址: pop.webContents.getURL(),
    矩形: pop.getBounds(),
    标题: await pop.webContents.executeJavaScript(
      `document.querySelector('.title')?.textContent?.trim() ?? '(没有标题)'`
    ),
    四行: await pop.webContents.executeJavaScript(
      `[...document.querySelectorAll('.trow')].map((e) => ({
        标签: e.querySelector('.tlabel')?.textContent?.trim(),
        读数: e.querySelector('.tvalue')?.textContent?.trim(),
        值: e.querySelector('.trange')?.value,
        禁用: e.querySelector('.trange')?.disabled,
        灰的: e.classList.contains('off')
      }))`
    ),
    提示: await pop.webContents.executeJavaScript(
      `document.querySelector('.hint')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`
    )
  }
  console.log(`面板      ${JSON.stringify(报告.面板, null, 0)}`)

  /*
   * 「面板摆在锚点下方」这一条**量不了**，只记读数。
   *
   * 锚点在顶栏，而 place() 的最后一步是把面板夹进工作区（摆到屏幕外等于用户看不见
   * 它）。主窗口被挪到 -4000 之后，锚点的**屏幕**坐标也就是负的，两个方向各夹一次，
   * 夹出来的 y 一模一样——这一条曾经「通过」过，但那是因为夹完之后的差值恰好是个
   * 大正数，不是因为它真摆对了。要量它就得让主窗口真的在屏幕上（或零不透明度地
   * 假装在），而那正是开发期不该做的事（见 spike/live-app.js 的文件头）。
   */
  const 锚 = 报告.键_读TXT时.矩形
  报告.摆位 = {
    说明: '窗口移出屏幕后量不了：place() 会把两个方向都夹进工作区，夹出来的位置一样',
    锚点: 锚,
    面板: 报告.面板.矩形,
    主窗口: win.getBounds()
  }
  const 段距那一行 = 报告.面板.四行[3] ?? {}
  报告.判据二 = {
    面板出得来: true,
    四行齐: 报告.面板.四行.length === 4,
    读数与配置一致: 报告.面板.四行.map((r) => r.值).join(',') === '17,1.85,6,0',
    // 读的是自家 TXT —— 段距在这一页有对象，那一行不该灰（灰了就是把自家这一页
    // 当成 Chromium 排的那一类了，见 PopoverApp 的 paraOff）
    段距那一行不禁用: 段距那一行.标签 === '段距' && 段距那一行.禁用 === false && 段距那一行.灰的 === false
  }
  console.log(`判据二    ${JSON.stringify(报告.判据二)}`)

  // ---- 三、拖一下，正文当场变 ----
  console.log(`\n================ 三、面板里拖一下 ================`)
  报告.拖字号 = await 在面板里拖(pop, 0, 26)
  await delay(900)
  报告.字号26后 = await 量正文(读的那一屏.webContents)
  console.log(`拖字号到 26  ${JSON.stringify(报告.拖字号)}`)
  console.log(`正文          ${JSON.stringify(报告.字号26后)}`)

  报告.拖留白 = await 在面板里拖(pop, 2, 0)
  await delay(900)
  报告.留白0后 = await 量正文(读的那一屏.webContents)
  console.log(`拖留白到 0   ${JSON.stringify(报告.拖留白)}`)
  console.log(`正文          ${JSON.stringify(报告.留白0后)}`)

  报告.拖行距 = await 在面板里拖(pop, 1, 2.4)
  await delay(900)
  报告.行距24后 = await 量正文(读的那一屏.webContents)
  console.log(`拖行距到 2.4 ${JSON.stringify(报告.拖行距)}`)
  console.log(`正文          ${JSON.stringify(报告.行距24后)}`)

  /*
   * 段距拖到最后，因为它是唯一会**换掉正文 DOM**的一项（0 → 1 让正文从
   * 「一个文本节点」变成「一段一个 .txt__p」），前三项量的是同一个正文。
   * 此刻字号是 26px，于是 1em 的段距算出来该是 26px。
   */
  报告.拖段距 = await 在面板里拖(pop, 3, 1)
  await delay(900)
  报告.段距1后 = await 量正文(读的那一屏.webContents)
  console.log(`拖段距到 1   ${JSON.stringify(报告.拖段距)}`)
  console.log(`正文          ${JSON.stringify(报告.段距1后)}`)

  报告.判据三 = {
    字号当场变: 报告.字号26后.算出来的字号 === '26px',
    行距当场变: Math.abs(parseFloat(报告.行距24后.算出来的行距) - 62.4) < 1,
    留白当场变: parseFloat(报告.留白0后.算出来的左内边距) === 0,
    段距当场变:
      报告.段距1后.段块数 > 1 &&
      Math.abs(parseFloat(报告.段距1后.第二块的上内边距) - 26) < 0.6 &&
      报告.段距1后.第一块的上内边距 === '0px',
    // 四条互不串门：改段距那一次，前三项都还该是「字号 26px 那一组」的值
    段距没串字号: 报告.段距1后.算出来的字号 === '26px',
    段距没串行距: Math.abs(parseFloat(报告.段距1后.算出来的行距) - 62.4) < 1,
    段距没串留白: parseFloat(报告.段距1后.算出来的左内边距) === 0,
    /*
     * 切段不许动到一个字。量的是长度而不是内容：这一页的正文是几万字，
     * 而切段只是把它挪进几十个盒子里。逐字的往返在 spike/txt-split.js 里
     * 单测过（那一条才是「少一个换行」的判据），这里量的是**真到了屏幕上**的那一份。
     */
    段距没改正文长: 报告.段距1后.正文长 === 报告.注入前.正文长
  }
  console.log(`判据三    ${JSON.stringify(报告.判据三)}`)

  // 面板自己有没有被裁：那四行加一句话必须整个放得下（面板是固定高度的子窗口）
  报告.面板容纳 = await pop.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.body')
    return { clientH: b.clientHeight, scrollH: b.scrollHeight, 裁掉了: b.scrollHeight - b.clientHeight }
  })()`)
  console.log(`面板容纳  ${JSON.stringify(报告.面板容纳)}`)

  // ---- 四、浮层那两枚键干不干净（读者页不加载 base.css，这一条原先是 UA 说了算）----
  console.log(`\n================ 四、浮层那两枚键 ================`)
  报告.判据四 = {
    键底色透明: 报告.注入前.键底色 === 'rgba(0, 0, 0, 0)',
    键没有原生边框: parseFloat(报告.注入前.键边框 ?? '1') === 0
  }
  console.log(
    `判据四    ${JSON.stringify(报告.判据四)}   （底色 ${报告.注入前.键底色}，边框 ${报告.注入前.键边框}）`
  )

  // ---- 五、网页上那枚键该是禁用的 ----
  const 网页 = win.contentView.children.find(
    (v) => v !== chrome && /^https?:/.test(v.webContents.getURL())
  )
  if (网页) {
    // 直接走桥切到那张网页（不依赖标签条上那几个 DOM）
    const 网页id = await chrome.webContents.executeJavaScript(
      `window.zhituan.tabs.list().then((s) => (s.tabs.find((t) => /^https?:/.test(t.url)) ?? {}).id ?? null)`
    )
    if (网页id) {
      await chrome.webContents.executeJavaScript(
        `window.zhituan.tabs.activate({ tabId: ${JSON.stringify(网页id)} })`
      )
      await delay(900)
      报告.键_读网页时 = await 量键(chrome)
      console.log(`\n切换看一张网页之后：${JSON.stringify(报告.键_读网页时)}`)
      报告.判据五 = { 网页上禁用: 报告.键_读网页时.禁用 === true }
      console.log(`判据五    ${JSON.stringify(报告.判据五)}`)
    }
  } else {
    报告.判据五 = { 说明: '这次没有可切换的网页标签，跳过' }
  }

  const 全过 =
    Object.entries(报告.判据一).every(([, v]) => v === true) &&
    Object.entries(报告.判据二).every(([, v]) => v === true) &&
    Object.entries(报告.判据三).every(([, v]) => v) &&
    Object.entries(报告.判据四).every(([, v]) => v) &&
    报告.面板容纳.裁掉了 === 0 &&
    (报告.判据五.网页上禁用 ?? true)

  报告.结论 = 全过 ? '排版四项端到端成立（自家 TXT 页）' : '有判据没过，见上面几条'
  console.log(`\n结论      ${报告.结论}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'txt-typeset.json'), JSON.stringify(报告, null, 2), 'utf8')

  clearTimeout(watchdog)
  收走()
  app.exit(全过 ? 0 : 1)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error(`[FAIL] ${err?.stack ?? err}`)
    clearTimeout(watchdog)
    app.exit(1)
  })
})
