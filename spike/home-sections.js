/**
 * 探针：起始页按栏目分栏、以及「离线阅读」这条路，规矩还在不在。
 *
 * 这一版把起始页从「一列混在一起的入口」改成一张按栏目分节的报纸页：顶上一条
 * 栏目线（全部 / 视频 / 阅读 / 资讯 / 刷题 / 离线阅读），点哪一栏底下换哪一摊。
 * 分栏这件事有三条容易悄悄坏掉的规矩，而它们**从截图上都看不出来**：
 *
 *   1. **归属不许猜**。哪个域名属于哪一栏，只有 @shared/presets 那张表说了算，
 *      认不出来的一律返回 null（只出现在「全部」里）。按关键词猜的代价是用户在
 *      自己的「阅读」栏里看见一个视频站，而他没有办法纠正。
 *   2. **本机路径不许露出来**。这个程序的全部意义是别人看不出你在干什么，
 *      而 `C:\Users\…\Documents\…` 把用户名和目录习惯一起摊在屏幕上。
 *      因此历史里 `file:` 的条目一律只存文件名，读盘时还要把旧记录里已经存成
 *      路径的那些就地改回来。
 *   3. **一栏里该有谁**。「全部」含所有栏的站点且按域名去重；单栏只含本栏；
 *      「离线阅读」的头一行永远是那个动作（打开文件…），它不是一本书。
 *
 * 因此这里不摆样子，验的是**真跑在界面里的那几份代码**：esbuild 把 presets.ts /
 * url.ts / useTiles.ts / historyStore.ts / registerFileIpc.ts 各打成一包再 require
 * （与 window-max.js、media-pause.js 同一条路）。分栏那一段逻辑原先长在
 * HomeApp.vue 里，而单文件组件 require 不了——探针要是在这里另抄一份，抄本会
 * 跟着源本一起漂，验出来的结论不算数。为此那一小段被搬进了 useTiles.ts，
 * 这里量的就是界面上那一份。
 *
 * 历史那两问用**临时目录**里的真 HistoryStore（JsonListStore 本来就只依赖 node，
 * 不依赖 electron），绝不碰用户自己那份 history.json。
 *
 * 「打开文件」那一问要一个假的 dialog：真的 `dialog.showOpenDialog` 会弹出系统
 * 选文件框——用户说过改代码时不要弹窗，而且没人去按它，探针会一直挂着。因此
 * 先把 `require('electron').dialog.showOpenDialog` 换掉，**并断言换成功了**
 * 才敢往下走（证据是赋值后两个引用相等）；换不掉就照实报「否」并说明是哪一条
 * 前提不成立，而不是让一个真的系统对话框弹出来。
 *
 * 跑法：npx electron spike/home-sections.js
 * 产出：终端一份 [Qn] 报告、spike/out/home-sections.json（有一问没过就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, dialog } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

const step = (what) => console.log(`  · ${what}`)

/** 把要用的几份 TS 各打成一包再 require。验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-sect-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'shared', 'presets.ts'),
      path.join(ROOT, 'src', 'shared', 'url.ts'),
      path.join(ROOT, 'src', 'renderer', 'src', 'home', 'useTiles.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'historyStore.ts'),
      path.join(ROOT, 'src', 'main', 'ipc', 'registerFileIpc.ts')
    ],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outdir,
    outbase: path.join(ROOT, 'src'),
    outExtension: { '.js': '.cjs' },
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    external: ['electron'],
    // vue 也是被 useTiles -> useRows 一路带进来的（useRows 要 computed/ref）；
    // 这里用不着它跑起来，但把它打成生产形态能省一半体积
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent'
  })
  const at = (...p) => path.join(outdir, ...p)
  return {
    presets: require(at('shared', 'presets.cjs')),
    url: require(at('shared', 'url.cjs')),
    tiles: require(at('renderer', 'src', 'home', 'useTiles.cjs')),
    history: require(at('main', 'services', 'historyStore.cjs')),
    files: require(at('main', 'ipc', 'registerFileIpc.cjs'))
  }
}

// ------------------------------------------------------------------ 假数据

/**
 * 一本本机书的名字与它的 `file:` 地址。
 *
 * 名字用中文、地址用百分号编码：真机上 TXT 十有八九落在「文档」「下载」这种
 * 中文目录里，而这一栏要显示的正是**解码回来**的文件名。假数据要是直接写中文，
 * 那条解码的路就没走过。
 */
const BOOK = '斗破苍穹.txt'
const BOOK_URL = `file:///E:/books/${encodeURIComponent(BOOK)}`
const OTHER_BOOK = '三体（全集）.pdf'
const OTHER_BOOK_PATH = `C:\\Users\\poem\\Documents\\${OTHER_BOOK}`

const ICON_ZHIHU = 'data:image/png;base64,ICON-ZHIHU'
const ICON_BLOG = 'data:image/png;base64,ICON-BLOG'

/** 用户自己固定的两个站点：一个认不出栏目、一个与预置撞同一个域名（试去重） */
const MY_SITES = [
  {
    id: 'us1',
    title: '我的博客',
    url: 'https://myblog.example.org/',
    order: 0,
    pinned: true,
    uaMode: null,
    zoom: null,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: 'us2',
    title: 'B 站',
    url: 'https://www.bilibili.com/',
    order: 1,
    pinned: false,
    uaMode: null,
    zoom: null,
    createdAt: 0,
    updatedAt: 0
  }
]

const HISTORY = [
  { id: 'h1', url: BOOK_URL, title: BOOK, visitedAt: 5, visitCount: 3 },
  {
    id: 'h2',
    url: 'https://www.zhihu.com/question/1',
    title: '知乎问题',
    faviconUrl: ICON_ZHIHU,
    visitedAt: 4,
    visitCount: 7
  },
  // 认不出栏目的那一条，与上面「我的博客」**不能同属一个注册域**：
  // registrableDomain 会把 myblog.example.org 与 foo.example.org 都收成
  // example.org，于是第二条被去重吃掉——那是它该做的事，不是毛病
  { id: 'h3', url: 'https://notes.another-place.net/x', title: '说不清是什么', visitedAt: 3, visitCount: 2 }
]

const BOOKMARKS = [
  {
    id: 'bm1',
    title: '我的博客',
    url: 'https://myblog.example.org/',
    faviconUrl: ICON_BLOG,
    order: 0,
    createdAt: 0
  }
]

/** 路径漏没漏出来：真机上这一条是「别人看不出你在干什么」的底线 */
const leaksPath = (text) => /[\\/]|file:/i.test(String(text ?? ''))

// ------------------------------------------------------------------ 跑

app.whenReady().then(async () => {
  const tempDirs = []

  /**
   * 收摊。临时目录在 app.exit 之前删掉：app.exit 是一句话之后进程就没了，
   * 排在那之后的清理代码没有机会跑（留在 %TEMP% 里的东西没人会去收）。
   */
  const finish = (code) => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 临时目录删不掉不影响结论
      }
    }
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, 'home-sections.json')
    fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
    console.log(`WROTE ${out}`)
    const bad = results.filter((r) => r.verdict !== '是')
    console.log(`\n${results.length - bad.length}/${results.length} 通过`)
    for (const r of bad) console.log(`  未通过 ${r.id}：${r.question}`)
    app.exit(code)
  }

  const tempDir = (tag) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-${tag}-`))
    tempDirs.push(dir)
    return dir
  }

  try {
    const M = await buildModules()
    const { PRESET_SITES, sectionOfUrl } = M.presets
    const { fileNameOf } = M.url
    const { tilesOf, plateRowsOf, statOf } = M.tiles
    const { HistoryStore } = M.history
    const { openLocalFiles } = M.files

    // --------------------------------------------------------------- Q0 前提
    step('先确认被测的那几份真的装起来了')
    const shape = {
      预置站点: Array.isArray(PRESET_SITES) ? PRESET_SITES.length : null,
      归栏函数: typeof sectionOfUrl,
      取文件名: typeof fileNameOf,
      编排函数: [typeof tilesOf, typeof plateRowsOf, typeof statOf],
      历史存储: typeof HistoryStore,
      打开文件: typeof openLocalFiles
    }
    const ok0 =
      shape.预置站点 > 0 &&
      shape.归栏函数 === 'function' &&
      shape.取文件名 === 'function' &&
      shape.编排函数.every((t) => t === 'function') &&
      shape.历史存储 === 'function' &&
      shape.打开文件 === 'function'
    record('Q0', '前提：五份被测模块都装起来了，形状对得上', ok0 ? '是' : '否', shape)
    if (!ok0) {
      finish(1)
      return
    }

    // ----------------------------------------------------------- Q1 栏目归属
    step('逐条对：预置站点自己声明的栏，与按域名反查出来的是不是同一栏')
    const perSection = {}
    const mismatch = []
    for (const site of PRESET_SITES) {
      const got = sectionOfUrl(site.url)
      perSection[site.section] = (perSection[site.section] ?? 0) + 1
      if (got !== site.section) mismatch.push({ 站点: site.title, 声明: site.section, 实得: got })
    }
    const fourSections = ['video', 'reading', 'news', 'quiz']
    const empty = fourSections.filter((id) => !perSection[id])
    record(
      'Q1',
      '预置站点每一栏都归对了，而且四个站点栏里都有站点（空栏是一句假话）',
      mismatch.length === 0 && empty.length === 0 ? '是' : '否',
      { 每栏: perSection, 不相符: mismatch, 空栏: empty }
    )

    // ----------------------------------------------------------- Q2 反查规矩
    step('已知域名 / 子域 / 认不出的 / 坏地址，四种各问一遍')
    const lookups = [
      ['https://www.bilibili.com/', 'video'],
      ['https://m.douyin.com/share/video/1', 'video'],
      ['https://book.qq.com/book/1', 'reading'],
      ['https://leetcode.cn/problemset/', 'quiz'],
      ['https://www.zhihu.com/question/1', 'news'],
      ['https://example.com/', null],
      // 域名里带着 video、但不在表里：不许按关键词猜，猜错用户没法纠正
      ['https://my-video-site.example.org/', null],
      [BOOK_URL, null],
      ['', null],
      ['不是网址', null]
    ]
    const wrong = lookups
      .map(([url, want]) => ({ 地址: url || '(空)', 期望: want, 实得: sectionOfUrl(url) }))
      .filter((r) => r.实得 !== r.期望)
    record(
      'Q2',
      '反查只认表里的域名（子域算同一栏），认不出返回 null，不按关键词猜',
      wrong.length === 0 ? '是' : '否',
      { 问了: lookups.length, 不相符: wrong }
    )

    // --------------------------------------------------------- Q3 取文件名
    step('file: 的地址拿到的是文件名、不是路径；http(s) 与坏地址交给它返回 null')
    const nameCases = [
      [BOOK_URL, BOOK],
      [
        'file:///C:/Users/poem/Documents/%E4%B8%89%E4%BD%93%EF%BC%88%E5%85%A8%E9%9B%86%EF%BC%89.pdf',
        OTHER_BOOK
      ],
      ['https://www.zhihu.com/question/1', null],
      ['', null],
      ['不是网址', null]
    ]
    const nameWrong = nameCases
      .map(([url, want]) => ({ 地址: url, 期望: want, 实得: fileNameOf(url) }))
      .filter((r) => r.实得 !== r.期望)
    // 断掉的百分号编码（半截 UTF-8）：宁可显示得别扭，也不能抛异常把整页带下去
    let broken = null
    try {
      broken = fileNameOf('file:///E:/books/%E6%96.txt')
    } catch (err) {
      broken = `抛了异常：${err}`
    }
    const leak = nameCases
      .map(([url]) => fileNameOf(url))
      .filter((n) => n && leaksPath(n))
    record(
      'Q3',
      'file: 只给得出文件名（名字里没有路径），http(s) 与坏地址返回 null，断掉的编码不抛异常',
      nameWrong.length === 0 && leak.length === 0 && broken === '%E6%96.txt' ? '是' : '否',
      { 问了: nameCases.length, 不相符: nameWrong, 断掉的编码: broken }
    )

    // ------------------------------------------------- Q4 落库时标题是文件名
    step('往真的 HistoryStore 里记两笔：一本标题还空着的 TXT，一条普通的网页')
    const storeDir = tempDir('hist-new')
    const store = new HistoryStore(storeDir)
    store.record({ url: BOOK_URL, title: '' })
    store.record({ url: 'https://www.zhihu.com/question/1', title: '知乎问题' })
    // 同一条再来一次，这次标题是整条路径——这是旧版本留下的形状
    store.record({ url: BOOK_URL, title: 'E:\\books\\斗破苍穹.txt' })
    store.record({ url: 'https://www.zhihu.com/question/1', title: '知乎问题' })
    store.flush()

    const items = store.list()
    const fileItem = items.find((i) => i.url === BOOK_URL)
    const httpItem = items.find((i) => i.url.startsWith('https://'))
    let onDisk = null
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(storeDir, 'history.json'), 'utf8'))
      onDisk = raw.find((i) => i.url === BOOK_URL)?.title ?? null
    } catch (err) {
      onDisk = `读不出来：${err}`
    }
    const ok4 =
      items.length === 2 &&
      fileItem?.title === BOOK &&
      !leaksPath(fileItem?.title) &&
      onDisk === BOOK &&
      httpItem?.title === '知乎问题' &&
      httpItem?.visitCount === 2
    record('Q4', '落库的标题是文件名：标题空着也好、存成整条路径也好，都改回书名；网页那条一字不动', ok4 ? '是' : '否', {
      条目数: items.length,
      本机那条: { 标题: fileItem?.title, 次数: fileItem?.visitCount },
      盘上的那一份: onDisk,
      网页那条: { 标题: httpItem?.title, 次数: httpItem?.visitCount }
    })

    // --------------------------------------------- Q5 读盘时把旧记录改回来
    step('先摆一份旧版本的 history.json（标题里装着路径），再让 HistoryStore 读它')
    const legacyDir = tempDir('hist-legacy')
    fs.writeFileSync(
      path.join(legacyDir, 'history.json'),
      JSON.stringify(
        [
          {
            id: 'old1',
            url: BOOK_URL,
            title: 'E:\\books\\斗破苍穹.txt',
            visitedAt: 2,
            visitCount: 1
          },
          {
            id: 'old2',
            url: 'https://www.zhihu.com/question/1',
            title: '知乎问题',
            visitedAt: 1,
            visitCount: 1
          }
        ],
        null,
        2
      ),
      'utf8'
    )
    const legacy = new HistoryStore(legacyDir)
    const legacyFile = legacy.list().find((i) => i.url === BOOK_URL)
    const legacyHttp = legacy.list().find((i) => i.url.startsWith('https://'))
    record(
      'Q5',
      '读盘时旧记录里存成路径的标题被就地改回文件名，网页那条一个字没变',
      legacyFile?.title === BOOK && legacyHttp?.title === '知乎问题' ? '是' : '否',
      { 本机那条: legacyFile?.title, 网页那条: legacyHttp?.title }
    )

    // -------------------------------------------------------- Q6 站点编排
    step('把假数据喂给真的 tilesOf / plateRowsOf，看「全部」里有什么')
    const tiles = tilesOf(MY_SITES, HISTORY, BOOKMARKS)
    const domains = tiles.map((t) => t.domain)
    const dupes = domains.filter((d, i) => domains.indexOf(d) !== i)
    const allRows = plateRowsOf(tiles, HISTORY, HISTORY[0], 'all')
    const resume = allRows[0]
    // 按地址找，不按域名找：注册域会把两个不同的主机收成同一个（那是它的本职）
    const blogTile = tiles.find((t) => t.url === MY_SITES[0].url)
    const zhihuTile = tiles.find((t) => t.domain === 'zhihu.com')
    const biliTile = tiles.find((t) => t.domain === 'bilibili.com')
    const ok6 =
      dupes.length === 0 &&
      allRows.length === tiles.length + 1 &&
      resume?.verb === 'resume' &&
      !leaksPath(resume?.label) &&
      !leaksPath(resume?.host) &&
      blogTile?.section === null &&
      biliTile?.name === 'B 站' &&
      zhihuTile?.icon === ICON_ZHIHU &&
      blogTile?.icon === ICON_BLOG
    record('Q6', '「全部」含所有栏的站点且按域名去重，头一行是继续上次（本机那本书只露书名）', ok6 ? '是' : '否', {
      站点数: tiles.length,
      域名: domains,
      重复: dupes,
      全部的行数: allRows.length,
      继续上次: resume ? { 动词: resume.verb, 名称: resume.label, 右端: resume.host, 本机: resume.local } : null,
      撞域名的那一个: { 名称: biliTile?.name, 栏: biliTile?.section },
      图标: { 知乎: zhihuTile?.icon, 我的博客: blogTile?.icon }
    })

    // -------------------------------------------------------- Q7 单栏只含本栏
    step('逐栏摊开：单栏只含本栏的站点，认不出栏目的只留在「全部」里')
    const plates = ['video', 'reading', 'news', 'quiz']
    const perPlate = {}
    const stray = []
    const covered = new Set()
    for (const id of plates) {
      const rows = plateRowsOf(tiles, HISTORY, HISTORY[0], id)
      const own = tiles.filter((t) => t.section === id)
      perPlate[id] = rows.length
      for (const row of rows) {
        covered.add(row.url)
        if (!own.some((t) => t.url === row.url)) {
          stray.push({ 栏: id, 名称: row.label, 地址: row.url })
        }
      }
      if (rows.some((r) => r.verb === 'resume')) stray.push({ 栏: id, 说明: '单栏里冒出了「继续上次」' })
    }
    const classified = tiles.filter((t) => t.section !== null)
    const allRowUrls = new Set(allRows.map((r) => r.url))
    const unknown = tiles.filter((t) => t.section === null)
    const ok7 =
      stray.length === 0 &&
      covered.size === classified.length &&
      unknown.length === 2 &&
      unknown.every((t) => allRowUrls.has(t.url) && !covered.has(t.url))
    record('Q7', '单栏只含本栏的站点；认不出栏目的那些只出现在「全部」里', ok7 ? '是' : '否', {
      每栏行数: perPlate,
      已归栏的站点: classified.length,
      四栏合起来盖住: covered.size,
      认不出栏目的: unknown.map((t) => t.domain),
      越栏的: stray
    })

    // ------------------------------------------------------ Q8 离线阅读那栏
    step('「离线阅读」那一栏：头一行是「打开文件…」，其后是最近读过的本机文件')
    const localRows = plateRowsOf(tiles, HISTORY, HISTORY[0], 'local')
    const head = localRows[0]
    const bookRow = localRows.find((r) => r.url === BOOK_URL)
    const ok8 =
      head?.verb === 'open-file' &&
      head.local === true &&
      bookRow?.label === '斗破苍穹' &&
      bookRow?.host === 'TXT' &&
      bookRow.local === true &&
      localRows.every((r) => !leaksPath(r.label) && !leaksPath(r.host))
    record('Q8', '「离线阅读」头一行是那个动作（打开文件…），其余是本机文件，且只露书名与格式', ok8 ? '是' : '否', {
      行数: localRows.length,
      头一行: head ? { 动词: head.verb, 名称: head.label, 本机: head.local } : null,
      那本书: bookRow ? { 名称: bookRow.label, 右端: bookRow.host, 本机: bookRow.local } : null,
      全部行: localRows.map((r) => `${r.verb}:${r.label}|${r.host}`)
    })

    // -------------------------------------------------------------- Q9 读数
    step('状态行左端那个读数：数的是什么、有多少')
    const matchRows = allRows.slice(0, 3)
    const stats = {
      全部: statOf({ tiles, history: HISTORY, plate: 'all', matchCount: null }),
      视频: statOf({ tiles, history: HISTORY, plate: 'video', matchCount: null }),
      离线: statOf({ tiles, history: HISTORY, plate: 'local', matchCount: null }),
      搜索: statOf({ tiles, history: HISTORY, plate: 'quiz', matchCount: matchRows.length })
    }
    const videoTiles = tiles.filter((t) => t.section === 'video').length
    const ok9 =
      stats.全部.kind === 'site' &&
      stats.全部.count === tiles.length &&
      stats.视频.kind === 'site' &&
      stats.视频.count === videoTiles &&
      stats.离线.kind === 'local' &&
      // 「打开文件…」那一行不是一本书，不该算进读数里
      stats.离线.count === localRows.length - 1 &&
      stats.搜索.kind === 'match' &&
      stats.搜索.count === matchRows.length
    record('Q9', '读数：站点栏数站点、离线那栏数本机文件（不把「打开文件…」算进去）、搜索时数命中的行', ok9 ? '是' : '否', stats)

    // ------------------------------------------------------ Q10 打开本机文件
    step('换掉 electron 的 dialog，看 openLocalFiles 开的是什么、回来的是什么')
    const created = []
    const ctx = {
      controller: { getWindow: () => null },
      tabs: {
        create: (input) => {
          created.push(input)
          return { tabId: `t${created.length}` }
        }
      }
    }
    const realOpen = dialog.showOpenDialog
    let names = null
    let afterCancel = null
    let patched = false
    try {
      const fake = async () => ({
        canceled: false,
        filePaths: ['E:\\books\\a.txt', OTHER_BOOK_PATH]
      })
      dialog.showOpenDialog = fake
      // 换不上就不能往下走：真的那个会弹出一个没人按的系统对话框，探针会一直挂着
      patched = dialog.showOpenDialog === fake
      if (patched) {
        names = await openLocalFiles(ctx)
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
        const before = created.length
        afterCancel = { 回来: await openLocalFiles(ctx), 新开的标签: created.length - before }
      }
    } finally {
      dialog.showOpenDialog = realOpen
    }
    const ok10 =
      patched &&
      Array.isArray(names) &&
      names.length === 2 &&
      names[0] === 'a.txt' &&
      names[1] === OTHER_BOOK &&
      names.every((n) => !leaksPath(n)) &&
      created.length === 2 &&
      created.every((c) => c.activate === true) &&
      created[0].url === pathToFileURL('E:\\books\\a.txt').href &&
      created[1].url === pathToFileURL(OTHER_BOOK_PATH).href &&
      created.every((c) => c.url.startsWith('file:///') && !c.url.includes('\\')) &&
      fileNameOf(created[1].url) === OTHER_BOOK &&
      afterCancel?.回来.length === 0 &&
      afterCancel?.新开的标签 === 0
    record(
      'Q10',
      '打开本机文件：选中的每一本开成一张 file:// 标签页、回来的是文件名；取消就什么都不开',
      ok10 ? '是' : '否',
      {
        假对话框装上了: patched,
        回来的文件名: names,
        开的标签页: created,
        取消那一次: afterCancel
      }
    )

    finish(results.some((r) => r.verdict !== '是') ? 1 : 0)
  } catch (err) {
    // 探针自己没跑完：照实报，并且**别把 electron 留在那儿**（否则没有退出的时机）
    record('QX', '探针本身跑完了', '否', { 错误: String((err && err.stack) || err) })
    finish(1)
  }
})
