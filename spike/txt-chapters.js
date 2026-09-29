/**
 * 探针：本机 TXT 的**认编码 + 切章**（@shared/txt），纯 Node，不开 Electron。
 *
 * 这一份问的是「字认得对不对、章切得准不准」，全部在真源码上跑：`src/shared/txt.ts`
 * 用 esbuild 现编成一份 CJS 再 require，测的就是应用里跑的那一份，不是复刻。
 *
 * 问六件事：
 *
 *   1. **四档编码各自认对**（UTF-8 带/不带 BOM、UTF-16LE/BE 带 BOM、没有 BOM 的 UTF-16、
 *      GBK）。GBK 那一档用的是用户那本真小说的头 200 字节——不是造的字节，而是真文件。
 *   2. **切章**：卷首自成一章、章名干净、正文偏移不含标题那一行与它后面的空行。
 *   3. **三道紧箍**：真章名（连「莽夫?」那种半角问号）认得出，长句与句读收尾的假阳性
 *      挡得住。
 *   4. **一整篇**：真小说切出来多少章、最长章名多长、扫一遍多少毫秒（这一遍是在
 *      打开文件时同步跑的，太慢就等于打开卡住）；并把**带着章标记却被挡下的行**全数
 *      抄下来（判据偏松、紧箍偏紧，挡错了要能当场看见）。
 *   5. **位置记号**：formatMark / parseMark 往返，章名里带冒号也不认错。
 *   6. **找章**：章名对得上按章名找（重名时取离记下的章序最近的那一条），对不上退回
 *      章序（越界夹回最后一章），什么都没有就是第一章。
 *
 * 跑法：node spike/txt-chapters.js
 *      node spike/txt-chapters.js --txt <路径>
 * 产出：终端一份读数、spike/out/txt-chapters.json（任一条不成立就以非零码退出）
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
const {
  decodeText,
  splitChapters,
  chapterText,
  isChapterLine,
  formatMark,
  parseMark,
  locateChapter,
  WHOLE_TITLE
} = require(BUILT)

const 报告 = { 源码: 'src/shared/txt.ts', 判据: {}, 样本: {} }
let 全过 = true

function 判(名字, 成立了, 读数) {
  报告.判据[名字] = { 成立: !!成立了, ...(读数 === undefined ? {} : { 读数 }) }
  if (!成立了) 全过 = false
  console.log(`${成立了 ? '  ✓' : '  ✗'} ${名字}${读数 === undefined ? '' : '  ' + JSON.stringify(读数)}`)
}

const 字 = (s) => Buffer.from(s, 'utf8')

/** UTF-16BE = LE 的每一对字节反过来（造样本用，不参与被测逻辑） */
function 反转字节(buf) {
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1]
    out[i + 1] = buf[i]
  }
  return out
}

const UTF8_BOM = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), 字('第1章 大唐\n\n　　贞观九年。\n')])
const 带卷首 = '《带着战略仓库回大唐》\n\n第1章 大唐\n\n　　贞观九年。\n第2章 入城\n\n　　城中。\n'
const UTF16LE_BOM = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第1章 大唐\n\n　　贞观九年。\n', 'utf16le')])
const UTF16BE_BOM = Buffer.concat([Buffer.from([0xfe, 0xff]), 反转字节(Buffer.from('第1章 大唐\n\n　　贞观九年。\n', 'utf16le'))])
/** 没有 BOM 的 UTF-16：ASCII 多，空字节成规律地落在奇数位 */
const UTF16LE裸 = Buffer.from('Chapter 1\n\nhello world, this is plain ascii.\n', 'utf16le')

console.log('================ 一、四档编码 ================')

const 一 = decodeText(UTF8_BOM)
判('UTF-8 带 BOM', 一.encoding === 'utf-8' && 一.text.startsWith('第1章'), { 编码: 一.encoding, 头: 一.text.slice(0, 6) })

const 二 = decodeText(字(带卷首))
判('UTF-8 不带 BOM', 二.encoding === 'utf-8' && 二.text.includes('第2章 入城'), { 编码: 二.encoding })

const 三 = decodeText(UTF16LE_BOM)
判('UTF-16LE 带 BOM', 三.encoding === 'utf-16le' && 三.text.startsWith('第1章'), { 编码: 三.encoding, 头: 三.text.slice(0, 6) })

const 四 = decodeText(UTF16BE_BOM)
判('UTF-16BE 带 BOM', 四.encoding === 'utf-16be' && 四.text.startsWith('第1章'), { 编码: 四.encoding, 头: 四.text.slice(0, 6) })

const 五 = decodeText(UTF16LE裸)
判(
  '没有 BOM 的 UTF-16（先于 UTF-8 试解）',
  五.encoding === 'utf-16le' && 五.text.startsWith('Chapter 1') && !五.text.includes('\u0000'),
  { 编码: 五.encoding, 头: 五.text.slice(0, 9) }
)

// GBK：用真文件的头 200 字节。末尾可能正好切在一个字中间，因此只许最末一个字是替换符
const 真文件 = (() => {
  const at = process.argv.indexOf('--txt')
  const 指定 = at >= 0 ? process.argv[at + 1] : null
  return 指定 && fs.existsSync(指定) ? 指定 : fs.existsSync(USER_TXT) ? USER_TXT : null
})()

if (真文件) {
  const 字节 = fs.readFileSync(真文件)
  const 头 = 字节.subarray(0, 200)
  let UTF8也解得出 = true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(头)
  } catch {
    UTF8也解得出 = false
  }
  const 六 = decodeText(头)
  const 替换符 = [...六.text].filter((c) => c === '\ufffd').length
  判(
    'GBK（末档，真文件的头 200 字节）',
    六.encoding === 'gbk' && 六.text.startsWith('《带着战略仓库回大唐》') && 替换符 <= 1,
    { 编码: 六.encoding, 头: 六.text.slice(0, 14).replace(/\r?\n/g, '⏎'), 替换字符: 替换符, '同一份字节给严格UTF-8会抛错': !UTF8也解得出 }
  )
  报告.样本.真文件 = { 路径: 真文件, 字节: 字节.length }
} else {
  console.log('  · 没有找到真小说，跳过 GBK 那一档（用 --txt <路径> 指定）')
}

console.log('\n================ 二、切章 ================')

const 切 = splitChapters(二.text)
判(
  '卷首自成一章 + 两个章各一章',
  切.length === 3 &&
    切[0].title === '《带着战略仓库回大唐》' &&
    切[1].title === '第1章 大唐' &&
    切[2].title === '第2章 入城',
  { 章名: 切.map((c) => c.title) }
)
判(
  '正文不含标题那一行、也不含它后面的空行',
  chapterText(二.text, 切[1]) === '　　贞观九年。' && chapterText(二.text, 切[2]) === '　　城中。',
  { 第一章正文: JSON.stringify(chapterText(二.text, 切[1])) }
)

const 无章样本 = 'hello world\nfoo bar\n'
const 无章 = splitChapters(无章样本)
判(
  '一个章名都没有：整篇一章，叫「全文」',
  无章.length === 1 &&
    无章[0].title === WHOLE_TITLE &&
    无章[0].start === 0 &&
    无章[0].end === 无章样本.length,
  { 章名: 无章.map((c) => c.title) }
)

console.log('\n================ 三、三道紧箍 ================')

判('真章名认得出：第7章 谁说本殿下只是莽夫?（半角问号不算句读收尾）', isChapterLine('第7章 谁说本殿下只是莽夫?'))
判('真章名认得出：第128章 流水线生产', isChapterLine('第128章 流水线生产'))
判('真章名认得出：楔子（不带数字的那一组）', isChapterLine('楔子'))
判('真章名认得出：Chapter 12（英文书）', isChapterLine('Chapter 12 The Fall'))
// 这一条是**真样本里挡下来的那一行原文**（41 字，见下面第四节的清单），不是手编的句子
判(
  '假阳性挡住：41 字的散文（第1条紧箍）',
  !isChapterLine('第四篇则是夸奖部分长安有志之士的商人主动捐助款项，用以辅佐蜀王殿下修建长安城云云。')
)
判('假阳性挡住：真章名也可能长这样的一整句（第2条紧箍）', !isChapterLine('第一篇文章就是主要的。'))
判('假阳性挡住：章标记不在行首（第3条紧箍）', !isChapterLine('他说：第1章 大唐'))

const 往返 = formatMark(128, '第128章 后记:时间线收束')
const 读回 = parseMark(往返)
判(
  '位置记号往返（章名里带冒号也只按头一个冒号分）',
  往返 === '128:第128章 后记:时间线收束' && 读回.index === 128 && 读回.title === '第128章 后记:时间线收束',
  { 记号: 往返, 读回 }
)
判('位置记号认不出来时整串当章名（手改过的账）', parseMark('手写的乱账').index === -1)

console.log('\n================ 四、一整篇（真小说）================')

if (真文件) {
  const 字节 = fs.readFileSync(真文件)
  const t0 = performance.now()
  const 解 = decodeText(字节)
  const t1 = performance.now()
  const 章 = splitChapters(解.text)
  const t2 = performance.now()

  const 章名长 = 章.map((c) => c.title.length)
  const 最长 = Math.max(...章名长)
  const 平均 = Math.round((章名长.reduce((a, b) => a + b, 0) / 章名长.length) * 10) / 10

  // 带着章标记却被挡下的行：判据偏松、紧箍偏紧，挡错了要看得到
  const 松 = /^(第\s*[0-9０-９零〇一二三四五六七八九十百千万两]{1,12}\s*[章节節回卷篇部折]|chapter\b|part\b|prologue\b|epilogue\b|序章|序言|楔子|引子|前言|后记|尾声|结局|终章|番外|外传)/i
  const 挡下的 = []
  const 行 = 解.text.split('\n')
  for (let i = 0; i < 行.length && 挡下的.length < 60; i++) {
    const t = 行[i].trim()
    if (!t || !松.test(t) || isChapterLine(t)) continue
    挡下的.push({
      行号: i + 1,
      字数: t.length,
      为什么: t.length > 40 ? '太长' : /[。，、；！？…]$/.test(t) ? '句读收尾' : '其它',
      行: t.length > 60 ? t.slice(0, 60) + '…' : t
    })
  }

  报告.样本.整篇 = {
    编码: 解.encoding,
    字数: 解.text.length,
    章数: 章.length,
    最长章名: 最长,
    平均章名: 平均,
    前三条: 章.slice(0, 3).map((c) => c.title),
    后两条: 章.slice(-2).map((c) => c.title),
    解编码毫秒: Math.round(t1 - t0),
    切章毫秒: Math.round(t2 - t1),
    挡下的行: 挡下的
  }
  console.log(`  编码 ${解.encoding}，${解.text.length} 字，切成 ${章.length} 章`)
  console.log(`  章名：最长 ${最长} 字，平均 ${平均} 字`)
  console.log(`  头三条 ${JSON.stringify(章.slice(0, 3).map((c) => c.title))}`)
  console.log(`  末两条 ${JSON.stringify(章.slice(-2).map((c) => c.title))}`)
  console.log(`  耗时：解编码 ${Math.round(t1 - t0)}ms，切章 ${Math.round(t2 - t1)}ms`)
  console.log(`  带着章标记却被挡下的行：${挡下的.length} 条（最多抄 60 条，全量在 JSON 里）`)
  for (const d of 挡下的.slice(0, 8)) console.log(`    [${d.为什么}] ${d.字数}字  ${d.行}`)

  判('真小说：章数上百', 章.length > 500, { 章数: 章.length })
  判('真小说：章名都不超过 40 字（紧箍 1 对全文生效）', 最长 <= 40, { 最长 })
  判('真小说：切成的是这一份文件（首章是书名或第1章）', /大唐|第1章/.test(章[0].title), { 首章: 章[0].title })
  判('真小说：切章一遍在 400ms 以内（打开时同步跑）', t2 - t1 < 400, { 毫秒: Math.round(t2 - t1) })
  判(
    '真小说：章与章首尾相接，没有重叠也没有漏（抽 20 处）',
    章.every((c, i) => (i === 0 || c.start >= 章[i - 1].end) && c.start <= c.end)
  )

  console.log('\n================ 五、找章 ================')
  const 甲 = Math.min(129, 章.length - 1)
  const 记号 = formatMark(甲, 章[甲].title)
  const 找到 = locateChapter(章, 记号)
  const 靠章名 = locateChapter(章, formatMark(0, 章[5].title))
  const 越界 = locateChapter(章, formatMark(99999, '这一章根本没有'))
  const 空的 = locateChapter(章, '')
  判('按记下的记号找得到原来那一章', 章[找到].title === 章[甲].title, { 记号, 落在: 找到 })
  判('章名对得上就按章名找（章序是错的也照样找到）', 靠章名 === 5, { 落在: 靠章名 })
  判('章名对不上才退回章序，越界夹回最后一章', 越界 === 章.length - 1, { 落在: 越界 })
  判('没有记号就是第一章', 空的 === 0)

  // 章名重复时（「番外」这类），要取离记下的章序最近的那一条，而不是第一条
  const 重名 = 章.filter((c) => c.title === 章[甲].title)
  if (重名.length > 1) {
    const 别的 = 章.findIndex((c) => c.title === 章[甲].title)
    const 落点 = locateChapter(章, formatMark(甲, 章[甲].title))
    判('章名重复时取离记下的章序最近的那一条', 落点 !== 别的 && Math.abs(落点 - 甲) < Math.abs(别的 - 甲), {
      同名几处: 重名.map((c) => c.index),
      记下的章序: 甲,
      落在: 落点
    })
  } else {
    console.log('  · 这一份文件里章名都不重名，重名那条规则跳过')
  }
}

console.log(`\n结论      ${全过 ? '认编码与切章都成立' : '有判据没过，见上面几条'}`)
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'txt-chapters.json'), JSON.stringify(报告, null, 2), 'utf8')
console.log(`读数      ${path.join(OUT_DIR, 'txt-chapters.json')}`)
process.exit(全过 ? 0 : 1)
