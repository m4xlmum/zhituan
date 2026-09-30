/**
 * 探针：三条阅读协议的特权，**必须一次交上去**。
 *
 * ## 它守的是哪一件
 *
 * `protocol.registerSchemesAsPrivileged()`（无会话参数的那一个）**只认最后一次调用**
 * ——分开调几次，前几次当场作废。量出来的样子是：前几条协议的 `fetch` 全抛
 * `TypeError: Failed to fetch`，只有最后交上去的那一条取得到。
 *
 * 这个坑真出过：1.6.9 把本机 TXT 那条协议加在末尾时，PDF 与 EPUB 的特权一起被
 * 顶掉了——点开一本本机 EPUB 就是一句「打不开这本书：Failed to fetch」，而 PDF 那
 * 一页的 cMap / 标准字体 / wasm 全是 pdf.js 运行时 fetch 回来的，也一样取不到。
 * 症状与「这本书/这个文件是坏的」一模一样，主进程那两条 warn（`打开 EPUB 失败` /
 * `书籍通道 404`）一条都不出现——请求根本没走到 handler。抓到它的那一支是
 * `spike/book-tab.js` 的 T1。
 *
 * ## 四面
 *
 * - **S1 源码里只有一处调用**：扫 `src/main` 底下所有 `.ts`，`registerSchemesAsPrivileged(`
 *   必须**恰好出现一次**（在 index.ts 里），且那一次把三条协议的名字都交上去了。
 *   这一条与运行无关，是唯一能挡住「下一个人又在自己模块里加一句」的东西。
 * - **S2 一次交三条，三条都取得到**：交的是产品代码里那三份声明
 *   （`XXX_SCHEME_PRIVILEGED`，esbuild 现打现用），页面是 `file:` 载的——
 *   与真阅读页一样是不透明来源，因此顺带把 `corsEnabled` / `supportFetchAPI`
 *   也量在里面。**对照**：一条没交过特权的协议必须抛，否则这一问根本没有分辨力。
 * - **S3 分开交三次：只有最后一条活着**（`--face=split` 那一跑）：这是 index.ts
 *   那段注释的原始证据，也是这一支探针与它量的那件事之间的对照——S2 报「都取得到」
 *   是不是因为**量具本来就不会红**，看它就知道了。
 * - **S4 三份特权形状相同**：合成一次调用之所以等价，靠的就是这一条。它变了不
 *   （也不该）让产品坏，只是把「为什么可以合」这句话的根据换掉了。
 *
 * ## 跑法（两个环境坑见 spike/env-pitfalls.js）
 *
 *   /usr/bin/env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     npx electron --no-sandbox --in-process-gpu spike/reader-schemes.js
 *
 * 默认把 S1/S2/S4 与反面那一跑（S3）**都跑一遍**（S3 是自己重开一个进程跑的，
 * 特权是进程级的东西，两件事在一个进程里做不成）。只想跑正面那一半就加
 * `--face=once`，只跑反面就 `--face=split`。
 *
 * 产出：终端一份 [Sn] 报告、spike/out/reader-schemes.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const STAGE = path.join(OUT_DIR, 'reader-schemes-stage')

const FACES = ['once', 'split']

/** 里层的那个进程：`--face=` 决定跑哪一面 */
const faceArg = (process.argv.slice(2).find((a) => a.startsWith('--face=')) ?? '').split('=')[1]
const INNER = Boolean(process.env.READER_SCHEMES_INNER)

const results = []
let 看门狗 = null
/** 这一跑自己的临时 userData（见 INNER 分支那一段），收尾时尽力收走 */
let TEMP = null
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

/**
 * 把三份真声明打进一个台面目录。
 *
 * 与 pdf-scheme.js 同一条路子：esbuild 现打现用，`electron` 留着不打包（里层那个
 * 进程 require 到的是真实现）。打的是**三个模块自己**，因此 `XXX_SCHEME_PRIVILEGED`
 * 导出没了、或者里面的权限被改掉一笔，这里当场就知道。
 */
function buildStage() {
  fs.mkdirSync(STAGE, { recursive: true })
  esbuild.buildSync({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'pdfReader.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'bookReader.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'txtReader.ts')
    ],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outdir: STAGE,
    outbase: path.join(ROOT, 'src'),
    outExtension: { '.js': '.cjs' },
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    external: ['electron'],
    logLevel: 'silent'
  })
}

/** 三份声明，按 PDF / EPUB / TXT 的次序（与 index.ts 那一次调用同序） */
function loadDeclarations() {
  const pdf = require(path.join(STAGE, 'main', 'services', 'pdfReader.cjs'))
  const book = require(path.join(STAGE, 'main', 'services', 'bookReader.cjs'))
  const txt = require(path.join(STAGE, 'main', 'services', 'txtReader.cjs'))
  return [
    { 名字: 'PDF', 声明: pdf.PDF_SCHEME_PRIVILEGED },
    { 名字: 'EPUB', 声明: book.BOOK_SCHEME_PRIVILEGED },
    { 名字: 'TXT', 声明: txt.TXT_SCHEME_PRIVILEGED }
  ]
}

// ------------------------------------------------------------------ S1 静态

/**
 * 扫源码：`src/main` 底下 `registerSchemesAsPrivileged(` 只能出现一次。
 *
 * 说的是**不带会话参数**的那一个重载——`ses.protocol.registerSchemesAsPrivileged`
 * 不长这样（它前面挂着 `session.`），因此这里按整串字面量数就够：
 * `protocol.registerSchemesAsPrivileged(` 这个写法只有全局那一句会用。
 */
function 数调用处() {
  const 命中 = []
  const 递归 = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        递归(p)
        continue
      }
      if (!/\.(ts|mts)$/.test(e.name)) continue
      const 文 = fs.readFileSync(p, 'utf8')
      文.split('\n').forEach((line, i) => {
        if (line.includes('protocol.registerSchemesAsPrivileged(')) {
          // 注释里提到这个写法的地方不算——源码里那一段注释恰好写着它
          命中.push({ 文件: path.relative(ROOT, p), 行: i + 1, 原文: line.trim() })
        }
      })
    }
  }
  递归(path.join(ROOT, 'src', 'main'))
  return 命中
}

function S1() {
  const 命中 = 数调用处()
  // 注释行会一起命中：真正要判的是「**代码**里有几处」，于是把注释行挑掉再看
  const 代码 = 命中.filter((h) => !h.原文.startsWith('*') && !h.原文.startsWith('//'))
  const 那一次 = 代码.length === 1 ? 代码[0] : null
  const 三份都在 =
    那一次 !== null &&
    ['PDF_SCHEME_PRIVILEGED', 'BOOK_SCHEME_PRIVILEGED', 'TXT_SCHEME_PRIVILEGED'].every((n) =>
      读那一段(那一次).includes(n)
    )

  record(
    'S1',
    'src/main 里带特权的协议名只有一处调用，且那一次把三条都交上去了吗',
    代码.length === 1 && 三份都在 ? '是' : '不是',
    {
      说明: 'registerSchemesAsPrivileged 只认最后一次调用，多一处就等于把前面几条顶掉',
      代码里的调用处: 代码,
      提到这个写法的注释行: 命中.filter((h) => !代码.includes(h)).map((h) => `${h.文件}:${h.行}`),
      那一次交的三份: 三份都在 ? '都在' : '缺名字'
    }
  )
}

/** 那一次调用的原文：它后面那十来行足够看出交了哪三份 */
function 读那一段(处) {
  const 全 = fs.readFileSync(path.join(ROOT, 处.文件), 'utf8').split('\n')
  return 全.slice(处.行 - 1, 处.行 + 12).join('\n')
}

// ------------------------------------------------------------------ 里层：真跑

/** 一次空转、什么都不做的收尾——这一支没有 handler，只需要一条能应声的协议 */
const 应声 = (名) => () => new Response(`我是 ${名}`, { status: 200 })

async function 正面() {
  const { app, BrowserWindow, protocol, session } = require('electron')
  const 三份 = loadDeclarations()
  const 名 = 三份.map((d) => d.声明.scheme)

  // ---- 与产品同一句：一次交三条 ----
  protocol.registerSchemesAsPrivileged(三份.map((d) => d.声明))

  await app.whenReady()
  const ses = session.fromPartition('persist:zhituan')
  for (const s of 名) ses.protocol.handle(s, 应声(s))

  // 页面用 file: 载——与真阅读页一样是不透明来源（corsEnabled 就是为它开的）
  const 页 = path.join(OUT_DIR, 'reader-schemes-page.html')
  fs.writeFileSync(页, '<title>reader-schemes</title>ok', 'utf8')

  const win = new BrowserWindow({
    show: false,
    x: -4000,
    y: -4000,
    webPreferences: { partition: 'persist:zhituan', contextIsolation: true, sandbox: true }
  })
  await win.loadFile(页)
  console.log(`      页面的来源 = ${new URL(win.webContents.getURL()).protocol}`)

  const 取 = (目标) =>
    win.webContents.executeJavaScript(`(async () => {
      const 出 = []
      for (const u of ${JSON.stringify(目标)}) {
        try {
          const r = await fetch(u)
          出.push({ 地址: u, 成了: r.ok, 状态: r.status, 正文: await r.text() })
        } catch (err) {
          出.push({ 地址: u, 抛了: String(err) })
        }
      }
      return 出
    })()`)

  // ---- S2：三条都取得到 ----
  const 三条 = await 取(名.map((s) => `${s}://probe/x`))
  // ---- 对照：一条从没交过特权的协议必须抛，否则这一问量不出别的 ----
  const 对照 = await 取(['zhituan-bingwu://probe/x'])
  const 没交过特权的取不到 = typeof 对照[0].抛了 === 'string'

  record(
    'S2',
    '一次交三条之后，三条协议的 fetch 都通得过吗（页面在 file: 下）',
    三条.every((r) => r.成了 && r.正文 === `我是 ${r.地址.split(':')[0]}`) && 没交过特权的取不到
      ? '是'
      : '不是',
    { 三条的读数: 三条, 没交过特权的对照: 对照[0], 对照必须抛: 没交过特权的取不到 }
  )

  // ---- S4：三份特权形状相同（合成一次之所以等价的根据）----
  const 形状 = 三份.map((d) => JSON.stringify(d.声明.privileges ?? {}))
  record(
    'S4',
    '三条协议的特权形状一样吗（一样才谈得上「合起来交一次等于各交一次」）',
    形状.every((s) => s === 形状[0]) ? '是' : '不是',
    { 三条: 三份.map((d, i) => ({ 谁: d.名字, 协议: d.声明.scheme, 特权: 形状[i] })) }
  )

  await 收尾('once')
  app.exit(判定())
}

/** 反面那一跑：照 1.6.9 的形状分开调三次 */
async function 反面() {
  const { app, BrowserWindow, protocol, session } = require('electron')
  const 三份 = loadDeclarations()
  const 名 = 三份.map((d) => d.声明.scheme)

  for (const d of 三份) protocol.registerSchemesAsPrivileged([d.声明])

  await app.whenReady()
  const ses = session.fromPartition('persist:zhituan')
  for (const s of 名) ses.protocol.handle(s, 应声(s))

  const 页 = path.join(OUT_DIR, 'reader-schemes-page.html')
  fs.writeFileSync(页, '<title>reader-schemes</title>ok', 'utf8')
  const win = new BrowserWindow({
    show: false,
    x: -4000,
    y: -4000,
    webPreferences: { partition: 'persist:zhituan', contextIsolation: true, sandbox: true }
  })
  await win.loadFile(页)

  const 读数 = JSON.parse(
    await win.webContents.executeJavaScript(`(async () => {
      const 出 = []
      for (const u of ${JSON.stringify(名.map((s) => `${s}://probe/x`))}) {
        try {
          const r = await fetch(u)
          出.push({ 地址: u, 成了: r.ok, 状态: r.status })
        } catch (err) {
          出.push({ 地址: u, 抛了: String(err) })
        }
      }
      return JSON.stringify(出)
    })()`)
  )

  const 只有最后一条活着 =
    typeof 读数[0].抛了 === 'string' &&
    typeof 读数[1].抛了 === 'string' &&
    读数[2].成了 === true

  record(
    'S3',
    '分开交三次的话，是不是只有最后一条活着（这是 index.ts 那段注释的原始证据）',
    只有最后一条活着 ? '是' : '不是',
    {
      这一跑的形状: 'PDF / EPUB / TXT 各调一次 registerSchemesAsPrivileged（1.6.9 的写法）',
      读数,
      读法:
        '前两条抛 = 只有最后一次算数（也就是 1.6.9 里 PDF 与 EPUB 一起哑掉的原因）；三条都成 = Electron 的脾气变了，index.ts 那段注释该重写'
    }
  )

  await 收尾('split')
  app.exit(判定())
}

// ------------------------------------------------------------------ 收尾

function 判定() {
  return results.some((r) => r.verdict === '不是') ? 1 : 0
}

async function 收尾(face) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, `reader-schemes-${face}.json`),
    JSON.stringify({ 面: face, 结果: results }, null, 2),
    'utf8'
  )
  console.log(`WROTE spike/out/reader-schemes-${face}.json`)
  const 坏 = results.filter((r) => r.verdict === '不是')
  console.log(`\n${results.length - 坏.length}/${results.length} 通过`)
  for (const b of 坏) console.log(`  破了 ${b.id}：${b.question}`)
  if (看门狗) clearTimeout(看门狗)
  // 临时 userData 尽力收走（Windows 上删不掉是常态，下一次开工时按前缀扫掉）
  if (TEMP) require('./probe-temp.cjs').removeTemp(TEMP)
}

if (INNER) {
  /*
   * 两道隔离，与 book-tab.js / pdf-tab.js 同一套：这一支要开一扇真窗口、还要用
   * `persist:zhituan` 那个分区，不隔离的话它落在**用户自己那份数据目录**里——用户
   * 的应用正开着时两边还会抢同一把缓存锁（`preview.js` 当年就是这么撞的，见 Q79）。
   * 这一支不读也不写用户的配置，因此不必抄一份进来，建个空的就够。
   */
  const { makeTempUserData, removeTemp } = require('./probe-temp.cjs')
  const { app: electronApp } = require('electron')
  TEMP = makeTempUserData('zhituan-reader-schemes-')
  electronApp.setPath('appData', TEMP)
  electronApp.setPath('userData', TEMP)

  // 看门狗：主进程里抛出来的异常不会让 Electron 退出，只会变成一个不结束的进程
  看门狗 = setTimeout(() => {
    console.error('[FAIL] 探针超时未收场')
    process.exit(1)
  }, 60_000)
  process.on('unhandledRejection', (err) => {
    console.error(`[FAIL] 探针自己出错了：${err?.stack ?? err}`)
    process.exit(1)
  })

  const 面 = process.env.READER_SCHEMES_INNER
  // S1 是静态的，但只有这一头能看到三份声明到底导得出来没有——因此它放在这儿
  S1()
  if (面 === 'split') 反面()
  else 正面()
} else {
  /*
   * 外层的活儿只有两件：把台面摆好（顺带当一次「三份声明导得出来吗」的体检），
   * 再把自己重开成 `electron <这一支> --face=…`。
   *
   * 两件事**必须分进程**：特权是进程一级的东西，一次绑定终身有效，S2 与 S3
   * 要在同一个进程里都做完是不可能的。
   */
  try {
    buildStage()
    loadDeclarations()
  } catch (err) {
    console.error(`[FAIL] 摆台面：${err?.stack ?? err}`)
    process.exit(1)
  }

  const 要跑 = faceArg ? [faceArg] : FACES
  let 坏了 = 0
  for (const face of 要跑) {
    console.log(
      `\n======== ${face === 'split' ? '反面：分开交三次（S3）' : '正面：一次交三条（S1/S2/S4）'} ========`
    )
    const child = spawnSync(
      process.execPath,
      ['--no-sandbox', '--in-process-gpu', __filename, `--face=${face}`],
      { stdio: 'inherit', env: { ...process.env, READER_SCHEMES_INNER: face } }
    )
    if (child.status !== 0) 坏了++
  }
  console.log(坏了 ? `\n有 ${坏了} 面没过` : '\n两面都过')
  process.exit(坏了 ? 1 : 0)
}
