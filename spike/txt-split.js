/**
 * 探针：本机 TXT 的**分段**（@shared/txt 的 splitParagraphs），纯 Node，不开 Electron。
 *
 * 段距（`ui.readerParagraph`）要落在「段与段之间」，而本机 TXT 的正文是一个纯文本
 * ——想垫东西就得先把它切成一块块元素。这一支问的就是那一刀切得对不对，全部在真源码
 * 上跑：`src/shared/txt.ts` 用 esbuild 现编成一份 CJS 再 require，测的就是应用里跑的
 * 那一份，不是复刻。
 *
 * 六件事：
 *
 *   1. **往返逐字相同**。这是最要紧的一条：正文可选中、可复制，切完拼回来必须与原来
 *      一个字节不差（少一个换行，拷出去的一段就串行了）。样本里既有造的边角（连续空行、
 *      以空行结尾、只有换行、空串），也有用户那本 6.75MB 真小说的整篇与逐章。
 *   2. **行盒数守恒**。每块各排几个行盒（`pre-wrap` 下就是它自己那几个换行），加起来
 *      必须等于原文在这一章里的行数——1 说的是「字一样」，这一条说的是「排出来也一样」。
 *      两条合起来才等于「段距为 0 时与不分段逐像素相同」。
 *   3. **块的形状**。「A\n\nB」是 段/空行/段 三块；连着几个空行算**一块**间距（不是几块）。
 *   4. **没有空行时每行一段**。一份日志就是这种，判据是「这份文本里一个空行都没有」。
 *   5. **真小说**。整篇与每一章各切一遍，报块数、空行行数、耗时；**逐章切一遍的总耗时**
 *      是打开一本小说时真的要付的那一点（切章是同步的，切完才画第一屏）。
 *   6. **上限（PARA_MAX_BLOCKS）**。那一档的用处是「一块一个元素」，于是整篇算一章的
 *      大文件会切出十几万块。这一条量两件事：正常一章离上限有多远（余量），
 *      以及整篇那种文件确实会被挡下。
 *
 * 跑法：node spike/txt-split.js
 *      node spike/txt-split.js --txt <路径>
 * 产出：终端一份读数、spike/out/txt-split.json（任一条不成立就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const USER_TXT = 'C:\\Users\\poem\\Desktop\\带着战略仓库回大唐.txt'

/** 现编一份共享模块出来（应用里跑的就是它） */
const BUILT = path.join(OUT_DIR, 'txt-shared.cjs')
fs.mkdirSync(OUT_DIR, { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/shared/txt.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: BUILT,
  logLevel: 'warning'
})
const { decodeText, splitChapters, chapterText, splitParagraphs } = require(BUILT)

/**
 * 上限那个数从**阅读页的源码**里读出来，不在这里抄一遍。
 *
 * 抄一遍的后果是：哪天把它调小了，这一支的读数还是照着老数报，而它正是为那个数
 * 说话的探针。读不出来的话（改名了）就当 0，判据六会当场不过。
 */
const PARA_MAX_BLOCKS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/src/txt/TxtApp.vue'), 'utf8')
  const m = src.match(/const PARA_MAX_BLOCKS = (\d+)/)
  return m ? Number(m[1]) : 0
})()

const 报告 = { 源码: 'src/shared/txt.ts', 判据: {}, 样本: {}, 上限: PARA_MAX_BLOCKS }
const 判 = (名, 值, 说明) => {
  报告.判据[名] = 值
  console.log(`${值 ? '  ok' : 'FAIL'}  ${名}${说明 ? `   ${说明}` : ''}`)
}

/** 一份文本排出来是几个行盒。`pre-wrap` 下就是它自己那几个换行 */
const 行数 = (text) =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

/** 切一遍，顺带把两条守恒算出来 */
function 切一次(text) {
  const t0 = process.hrtime.bigint()
  const blocks = splitParagraphs(text)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const 拼回来 = blocks.map((b) => b.text).join('')
  return {
    blocks,
    ms,
    块数: blocks.length,
    段数: blocks.filter((b) => b.kind === 'p').length,
    空行块数: blocks.filter((b) => b.kind === 'gap').length,
    往返相同: 拼回来 === text,
    原行数: 行数(text),
    块行数: blocks.reduce((n, b) => n + 行数(b.text), 0)
  }
}

console.log('================ 一、边角样本：往返、行数、块的形状 ================')

/** 造出来的样本。每一条都要往返相同、行数守恒 */
const 样本 = {
  空串: '',
  一个字: '甲',
  一行的收尾换行: '甲\n',
  两段夹一个空行: '甲\n\n乙',
  多行一段: '甲\n乙\n丙\n\n丁\n戊',
  连着三个空行: '甲\n\n\n\n乙',
  以空行结尾: '甲\n乙\n\n',
  只有换行: '\n',
  只有三个换行: '\n\n\n',
  段首四个半角空格: '    甲\n\n    乙',
  末行没有换行: '甲\n\n乙'
}

let 一全过 = true
for (const [名, 文] of Object.entries(样本)) {
  const r = 切一次(文)
  const 行对 = r.原行数 === r.块行数
  if (!r.往返相同 || !行对) 一全过 = false
  报告.样本[名] = {
    原文: JSON.stringify(文),
    块: r.blocks.map((b) => `${b.kind}:${JSON.stringify(b.text)}`),
    往返相同: r.往返相同,
    行数: `${r.块行数}/${r.原行数}`
  }
  console.log(
    `  ${名.padEnd(12)} ${r.blocks.map((b) => `${b.kind}(${JSON.stringify(b.text)})`).join(' ')}` +
      `   往返${r.往返相同 ? '相同' : '不同！'}  行数 ${r.块行数}/${r.原行数}`
  )
}
判('边角样本往返逐字相同且行数守恒', 一全过)

// 连着几个空行算**一块**：四块的形状是 p/gap/p，不是 p/gap/gap/gap/p
const 连空 = splitParagraphs('甲\n\n\n\n乙')
判(
  '连着几个空行算一块',
  连空.length === 3 && 连空[1].kind === 'gap' && 连空[1].text === '\n\n\n',
  `切出 ${连空.length} 块（${连空.map((b) => b.kind).join('/')}）`
)

// 一个空行都没有 → 每行一段，且全是 p
const 逐行 = splitParagraphs('甲\n乙\n丙')
判(
  '没有空行时每行一段',
  逐行.length === 3 && 逐行.every((b) => b.kind === 'p'),
  `切出 ${逐行.length} 块（${逐行.map((b) => b.kind).join('/')}）`
)

判('空串切出零块', splitParagraphs('').length === 0)

console.log('\n================ 二、真小说 ================')

const at = process.argv.indexOf('--txt')
const 指定 = at >= 0 ? process.argv[at + 1] : null
let 路径 = 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
if (!路径) {
  路径 = path.join(OUT_DIR, '探针分段用的小说.txt')
  const 行 = []
  for (let i = 1; i <= 1200; i++) {
    行.push(`第${i}章 试${i}`)
    行.push('')
    for (let j = 0; j < 20; j++) 行.push(`    这是第${i}章的第${j}段，写得长一点，好让一行排得满。`)
    行.push('')
  }
  fs.writeFileSync(路径, 行.join('\n'), 'utf8')
  console.log(`  （没找到用户那本真小说，改用造的一本：${路径}）`)
}

const 字节 = fs.readFileSync(路径)
const { text, encoding } = decodeText(new Uint8Array(字节))
const chapters = splitChapters(text)
报告.素材 = {
  路径,
  字节: 字节.length,
  编码: encoding,
  字数: text.length,
  行数: 行数(text),
  空行行数: text.split('\n').filter((l) => l.trim() === '').length,
  章数: chapters.length
}
console.log(
  `  素材  ${path.basename(路径)}  ${字节.length} 字节 / ${encoding}` +
    `  ${text.length} 字 / ${报告.素材.行数} 行（空行 ${报告.素材.空行行数}）/ ${chapters.length} 章`
)

// 整篇切一遍
const 整篇 = 切一次(text)
报告.整篇 = {
  块数: 整篇.块数,
  段数: 整篇.段数,
  空行块数: 整篇.空行块数,
  往返相同: 整篇.往返相同,
  行数: `${整篇.块行数}/${整篇.原行数}`,
  毫秒: Math.round(整篇.ms)
}
console.log(
  `  整篇  ${整篇.块数} 块（段 ${整篇.段数} + 空行 ${整篇.空行块数}）` +
    `  往返${整篇.往返相同 ? '相同' : '不同！'}  行数 ${整篇.块行数}/${整篇.原行数}` +
    `  ${Math.round(整篇.ms)}ms`
)
判('整篇往返逐字相同', 整篇.往返相同)
判('整篇行盒数守恒', 整篇.块行数 === 整篇.原行数)

/*
 * 逐章切一遍。
 *
 * 这是**用户真正会付的那一点**：打开一本小说时同步跑的就是这个（一次一章，
 * 而且只在段距大于 0 时）。
 */
const t0 = process.hrtime.bigint()
let 章块数 = []
let 逐章全对 = true
for (const c of chapters) {
  const r = 切一次(chapterText(text, c))
  if (!r.往返相同 || r.块行数 !== r.原行数) 逐章全对 = false
  章块数.push(r.块数)
}
const 逐章ms = Number(process.hrtime.bigint() - t0) / 1e6
章块数.sort((a, b) => a - b)
const 中位块数 = 章块数.length ? 章块数[Math.floor(章块数.length / 2)] : 0
const 最大块数 = 章块数.length ? 章块数[章块数.length - 1] : 0
报告.逐章 = {
  章数: chapters.length,
  中位块数,
  最大块数,
  往返相同: 逐章全对,
  总毫秒: Math.round(逐章ms),
  每章毫秒: chapters.length ? Number((逐章ms / chapters.length).toFixed(3)) : 0,
  最大块数是上限的: PARA_MAX_BLOCKS ? `${((最大块数 / PARA_MAX_BLOCKS) * 100).toFixed(1)}%` : '?'
}
console.log(
  `  逐章  ${chapters.length} 章全切一遍 ${Math.round(逐章ms)}ms（每章 ${报告.逐章.每章毫秒}ms）` +
    `  块数：中位 ${中位块数} / 最大 ${最大块数}  往返${逐章全对 ? '相同' : '不同！'}`
)
判('逐章往返逐字相同且行数守恒', 逐章全对)

console.log('\n================ 三、分段上限（PARA_MAX_BLOCKS）================')
console.log(
  `  上限 ${PARA_MAX_BLOCKS} 块；正常一章最大 ${最大块数} 块` +
    `（用掉 ${报告.逐章.最大块数是上限的}）；整篇一章（认不出章的那种文件）是 ${整篇.块数} 块`
)
判(
  '正常一章离上限有很大的余量（≥10 倍）',
  最大块数 > 0 && 最大块数 * 10 <= PARA_MAX_BLOCKS,
  `最大 ${最大块数} × 10 = ${最大块数 * 10} vs ${PARA_MAX_BLOCKS}`
)
判(
  '整篇算一章的大文件确实会被挡下',
  chapters.length === 1 ? 整篇.块数 > PARA_MAX_BLOCKS : 报告.素材.行数 > PARA_MAX_BLOCKS,
  chapters.length === 1
    ? `这份素材本来就整篇一章，${整篇.块数} 块`
    : `按行数算：${报告.素材.行数} > ${PARA_MAX_BLOCKS}（章名一个都没有时整篇就是一章）`
)

console.log('\n================ 结论 ================')
const 全过 = Object.values(报告.判据).every((v) => v === true)
报告.结论 = 全过 ? '分段这一刀切得准：往返逐字相同、行盒数守恒、上限有余量' : '有判据没过'
console.log(报告.结论)

fs.writeFileSync(path.join(OUT_DIR, 'txt-split.json'), JSON.stringify(报告, null, 2), 'utf8')
process.exit(全过 ? 0 : 1)
