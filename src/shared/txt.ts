/**
 * 本机 TXT：把一份字节解成字，再把一整篇字切成章，以及「上次读到哪」那串记号的
 * 编码与解读。
 *
 * 三件事写在一起，是因为它们共用一套**偏移**：解出来的字、切出来的章、记下的位置
 * 说的都是同一份文本，分开三个文件就得在三个地方各抄一遍「偏移怎么算」。
 *
 * ## 为什么在渲染进程里解，而不是在送字节的那一头
 *
 * 因为要认编码，而认编码这件事只有渲染进程能**证明**：`TextDecoder` 在那儿认得
 * GBK（中文 TXT 的绝大多数），而主进程那一侧的 ICU 没有人量过。于是分工与
 * services/bookReader.ts 那句「这一边只解包、只送字节，不解析书的内容」一样：
 * 主进程把整份字节送出来（`zhituan-txt://<token>/text`），解析全在这一头。
 *
 * 认编码的次序是实测定的（Q84）：
 *
 *   1. **BOM 说了算**——UTF-8 / UTF-16LE / UTF-16BE 三种，记事本存「Unicode」就带；
 *   2. **没有 BOM 而字节里有成规律的空字节**（`00`）——那是 UTF-16 的痕迹，
 *      按空字节落在奇数位还是偶数位判前后缀。这一条**必须先于** UTF-8 试解：
 *      汉字的 UTF-16LE 字节里有大量 `00`，而那在 UTF-8 里是完全合法的字节，
 *      严格解也会「成功」——解出来是一串夹着 NUL 的乱码，而且一声不响。
 *      （它只认得出 ASCII 多的那一类；纯汉字的 UTF-16 没有 BOM 就认不出来，
 *      而那种文件几乎不存在：记事本存 UTF-16 一定写 BOM。）
 *   3. **严格的 UTF-8**（`fatal: true`）——不合法的字节序列当场抛错，于是
 *      「这不是 UTF-8」不用猜。实测 GBK 的中文一律抛 TypeError；
 *   4. **GBK**。它必须是最后一道：GBK 解码器**从不抛错**，什么字节都能解出一串字。
 *
 * **不往 Big5 上再猜。** GBK 与 Big5 都能把对方的字节解成「一串看着像字、其实不是」
 * 的汉字——不是替换字符，按替换字符的多少分不出来。猜错一次就是一整本书的乱码，
 * 比「认不出就认不出」坏得多。真要支持，该让用户自己选一项，而不是在这里赌。
 *
 * 行尾一律归一成 `\n`（CRLF 与单独一个 CR 都收掉）。下面每一处偏移都建立在
 * 「一份归一过的文本」上，于是主进程给的字节解出来是几行，切章时就是几行。
 *
 * ## 切章：一条宽判据 + 三道紧箍
 *
 * 判据是「这一行长着一个章标记」——`第<数字><章|节|回|卷|篇|部|折>`，或者
 * `序章 / 楔子 / 前言 / 后记 / 番外 / 尾声…` 这一组专门的名字（英文书那几种
 * `Chapter N / Prologue` 也顺手认了）。三道紧箍都对着**实测出来的假阳性**，样本是
 * 用户那本 6.7MB 的《带着战略仓库回大唐》（1438 章，Q84）：
 *
 *   1. **整行不超过 40 个字**。真章名最长 24（平均 13.3），而假阳性全是长句，
 *      最短的一条 44 字（「第四篇则是夸奖部分长安有志之士的商人主动捐助款项…」）；
 *   2. **不以全角句读收尾**（`。，、；！？…`）。真章名不收句号，散文收；
 *   3. 章标记要落在**行首**（行首的空白先去掉），「第」与「章」之间只许有数字。
 *
 * 三道之后仍可能错（「第一篇文章就是主要的」这种短句），但**错一条的代价只是目录里
 * 多一行**，而**漏**一条是把整章并进上一章里——那是读不下去的那一种。因此判据偏松、
 * 紧箍偏紧，方向是「宁可多切一刀」。探针把「带着章标记却被紧箍挡下的行」全数抄下来
 * （spike/txt-chapters.js），挡错了会当场看见。
 *
 * 一个章都认不出来（不是小说，是日志或说明书）：整篇当作**一章**，位置照样记
 * （记的是全文的比例）。宁可不分章，也不去硬编出「每三千字一章」这种假章。
 *
 * ## 位置记号：`<章序>:<章名>`
 *
 * 阅读页报回来的那一串要能同时回答两件事：「读的是哪一章」与「那份账上的章序是几」。
 * 章名对得上就按章名找（同一份文件、或者换了一版而这一章还在——与
 * services/readingStore.ts 里「记路径不记章号」是同一个理由），对不上才退回章序
 * （这份账按本机路径记，路径没变，章序就仍然是个靠谱的落点）。两样都写进去，
 * 于是「按哪个找」不必再猜。串形如 `128:第128章 流水线生产`，人翻 reading.json
 * 时也读得懂。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/**
 * 本机 TXT 的字节通道（见 src/main/services/txtReader.ts）。
 *
 * 这一条定义在**共享**模块里而不是主进程那一侧：阅读页要拿它拼 fetch 的地址，
 * 而两条协议名各写一遍就是「改一处漏一处」——book/pdf 那两个各写了一遍是自己
 * 的历史，新来的这一个不必跟着抄。
 */
export const TXT_SCHEME = 'zhituan-txt'

/** 一份解开的文本。`encoding` 只用来写在日志与探针读数里 */
export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'gbk'
}

/** 一章。`start` / `end` 是**正文**在整份文本里的偏移（标题那一行不在里面） */
export interface TxtChapter {
  /** 章序，0 起。位置记号里带着它，见文件头 */
  index: number
  /** 章名（标题那一行去掉首尾空白）。卷首那一章另有取法，见 preambleTitle */
  title: string
  start: number
  end: number
}

/**
 * 一行最多几个字才算章名。见文件头第 1 条紧箍。
 *
 * 40 这个数是**对着样本定的**：真章名最长 24，最短的假阳性 44。取在两者中间，
 * 两头都留了余量——真章名再长一截也还认得出，假阳性再短一截也还挡得住。
 */
const HEAD_MAX = 40

/** 行首就是章标记：`第<数字><章|节|回|卷|篇|部|折>`，后面可以跟分隔符与标题 */
const NUMBERED = /^第\s*([0-9０-９零〇一二三四五六七八九十百千万两]{1,12})\s*([章节節回卷篇部折])\s*[:：.、·,，\-—]?\s*(.*)$/

/** 不带数字的那一组章名。它们传统上就是章名，不必再要求后面跟东西 */
const NAMED =
  /^(序章|序言|序|楔子|引子|前言|后记|後記|尾声|尾聲|结局|結局|终章|終章|大结局|全文完|完本感言|番外|外传|外傳)/

/** 英文书那几种：`Chapter 1` / `CHAPTER IV` / `Prologue`。`\b` 在 CJK 上没有意义，这里只认拉丁词 */
const LATIN = /^(chapter|part|prologue|epilogue)\b\s*([0-9ivxlcdm]*)\s*[:：.\-—]?\s*(.*)$/i

/** 全角句读的收尾。见文件头第 2 条紧箍。半角的 `?` `!` 不算——样本里就有一个「莽夫?」 */
const SENTENCE_END = /[。，、；！？…]$/

/** 卷首那一章没有章名时用的名字 */
const PREAMBLE_TITLE = '卷首'

/**
 * 一个章名都没有时，整篇算一章，用它当名字。
 *
 * **导出**是给阅读页用的：那个名字是我们编的，不是文件里的一行，因此「整篇一章」时
 * 不该把它当标题排出来（见 TxtApp 的 wholeFile）。判断读的是这个名字本身而不是某个
 * 标志位——切章这一层只有这一处会造出它。
 */
export const WHOLE_TITLE = '全文'

interface Bomb {
  encoding: DecodedText['encoding']
  length: number
}

/** 头几个字节就能定下编码的那三种。返回长度是为了把 BOM 自己切掉 */
function sniffBom(bytes: Uint8Array): Bomb | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', length: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', length: 2 }
  }
  return null
}

/**
 * 没有 BOM 的 UTF-16：靠空字节的疏密与奇偶判。
 *
 * 只认「ASCII 多」的那一类（见文件头第 2 条）：汉字本身在 UTF-16 里两个字节都不为
 * 零，所以一篇纯汉字、又没有 BOM 的 UTF-16 在这里会被放过——它会一路走到 GBK
 * 那一档，解出一串夹着 NUL 的怪字。这条路刻意没有走得更远：再往下就得靠「哪一串
 * 更像人话」打分，而那种分法在 GBK 与 Big5 之间已经证明是分不开的（文件头）。
 *
 * 判据取前 512 字节里的空字节：**四分之一以上**才算，且要够多（8 个起），
 * 免得一篇正常的文本里偶然夹着几个 NUL 就被判成 UTF-16。
 */
function sniffUtf16(bytes: Uint8Array): DecodedText['encoding'] | null {
  const span = Math.min(512, bytes.length)
  if (span < 8) return null
  let nuls = 0
  let odd = 0
  for (let i = 0; i < span; i++) {
    if (bytes[i] !== 0) continue
    nuls++
    if (i % 2 === 1) odd++
  }
  if (nuls < 8 || nuls * 4 < span) return null
  // 空字节落在奇数位 = 低字节在前 = 小端
  return odd * 2 > nuls ? 'utf-16le' : 'utf-16be'
}

/** 行尾归一：CRLF 与单独一个 CR 都收成 `\n`。见文件头 */
function normalizeBreaks(text: string): string {
  return text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n')
}

/**
 * 一份字节 → 一份文本。次序见文件头，四档一路往下退。
 *
 * 认不出来时**不抛错**：末档的 GBK 从不抛错，最坏的结果是一屏乱码——而乱码是用户
 * 一眼看得见、能自己判断「这个文件不对」的东西，比一句「编码不支持」的弹窗有用。
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = sniffBom(bytes)
  if (bom) {
    const body = bytes.subarray(bom.length)
    try {
      return { text: normalizeBreaks(new TextDecoder(bom.encoding).decode(body)), encoding: bom.encoding }
    } catch {
      // BOM 说了、这个环境却不认（理论上不会）：落到下面那几档，别停在这一步
    }
  }

  const utf16 = sniffUtf16(bytes)
  if (utf16) {
    try {
      return { text: normalizeBreaks(new TextDecoder(utf16).decode(bytes)), encoding: utf16 }
    } catch {
      // 同上，往下退
    }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: normalizeBreaks(text), encoding: 'utf-8' }
  } catch {
    // 不是 UTF-8。中文 TXT 的绝大多数到这里，落到 GBK
  }

  return { text: normalizeBreaks(new TextDecoder('gbk').decode(bytes)), encoding: 'gbk' }
}

/**
 * 卷首那一章的章名。
 *
 * 第一章之前那几行（书名、作者、简介）不该丢，它们自成一章。章名取**第一句非空的
 * 话**：样本里那一行正是「《带着战略仓库回大唐》」，于是目录上第一条就是书名。
 * 第一句太长（不是书名，是一段正文）就退回「卷首」——把 200 个字的一句截成 40 个，
 * 目录上那一行会像被啃掉一口。
 */
function preambleTitle(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    return t.length <= HEAD_MAX ? t : PREAMBLE_TITLE
  }
  return PREAMBLE_TITLE
}

/** 这一行是不是一个章名。三道紧箍都在这里，见文件头 */
export function isChapterLine(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > HEAD_MAX) return false
  if (SENTENCE_END.test(t)) return false
  if (NUMBERED.test(t)) return true
  if (NAMED.test(t)) return true
  return LATIN.test(t)
}

/** 从 `from` 往后跳过换行。切出来的正文不带标题后面那一串空行 */
function skipBreaks(text: string, from: number, end: number): number {
  let at = from
  while (at < end && text.charCodeAt(at) === 10) at++
  return at
}

/** 从 `end` 往回跳过换行与行尾空白。上一章结尾那一片空行同样不该留着 */
function trimBack(text: string, from: number, end: number): number {
  let at = end
  while (at > from && (text.charCodeAt(at - 1) === 10 || text.charCodeAt(at - 1) === 32)) at--
  return at
}

/**
 * 切章。
 *
 * 一遍扫行（不切数组，6.7MB 切出来是 18 万个小字符串），认到章名就记下它的行首与
 * 正文起点；扫完再把这些标记连成章的区间。于是内存里只有一份文本与 1438 条区间，
 * 阅读页一次只 `slice` 出正在读的那一章。
 */
export function splitChapters(text: string): TxtChapter[] {
  const marks: { head: number; body: number; title: string }[] = []
  let lineStart = 0

  for (;;) {
    const nl = text.indexOf('\n', lineStart)
    const lineEnd = nl < 0 ? text.length : nl
    if (lineEnd > lineStart) {
      const raw = text.slice(lineStart, lineEnd).trim()
      if (raw && isChapterLine(raw)) {
        marks.push({ head: lineStart, body: nl < 0 ? lineEnd : nl + 1, title: raw })
      }
    }
    if (nl < 0) break
    lineStart = nl + 1
  }

  if (marks.length === 0) {
    // 一个章名都没有：整篇一章。位置照样记（记的是全文的比例）
    return [{ index: 0, title: WHOLE_TITLE, start: 0, end: text.length }]
  }

  const chapters: TxtChapter[] = []
  const first = marks[0]
  if (first.head > 0) {
    const end = trimBack(text, 0, first.head)
    if (end > 0) {
      // 卷首自成一章，一个字都不丢
      chapters.push({ index: 0, title: preambleTitle(text.slice(0, first.head)), start: 0, end })
    }
  }

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    const limit = i + 1 < marks.length ? marks[i + 1].head : text.length
    const start = skipBreaks(text, m.body, limit)
    chapters.push({
      index: chapters.length,
      title: m.title,
      start,
      end: trimBack(text, start, limit)
    })
  }

  return chapters
}

/** 阅读页切出来给界面看的那段正文。`slice` 一份，与整篇文本不共用内存 */
export function chapterText(text: string, chapter: TxtChapter): string {
  return text.slice(chapter.start, chapter.end)
}

/**
 * 一「块」正文：一段字，或者一片空行。
 *
 * 两块的差别只在**要不要在它前面垫一层段距**（见 UiConfig.readerParagraph）——
 * 空行那一片不能再垫：它自己就是原文里的间距，垫出来的会是双份。
 */
export interface TxtBlock {
  /** `p` = 一段正文，`gap` = 一片空行（连着几个空行就是一块） */
  kind: 'p' | 'gap'
  /** 这一块的字，**原样**。所有块接起来与传进来的那份文本逐字相同 */
  text: string
}

/**
 * 一段正文 → 一块块「段」与「空行」。
 *
 * 这一页的正文是一个纯文本，段落只是原文里的空行；要能一段一段地垫东西
 * （段距），就得先把它分成元素。切法只有两条：
 *
 *   · **有空行**（`trim()` 之后为空的行）：连着几个空行算**一块**间距，两片空行
 *     之间那几行算**一段**。这是中文小说最常见的样子——用户那本 6.75MB 的
 *     《带着战略仓库回大唐》就是「一段一行 + 一个空行」：184412 行整篇切出来
 *     124857 块（段 62429 + 空行块 62428）（Q85）。
 *   · **一个空行都没有**：那这份文本的段落就是**行**（每行一段）。一份日志、一份
 *     行式的清单本来就是这样，而「没有空行」这件事本身就是它给出的判据——同一份
 *     文件里既有空行分隔、又有逐行分段的写法不存在，所以不必再猜。
 *
 * **拼回去必须逐字相同**，这是这一条最要紧的性质（正文是可选中、可复制的：
 * 挑选一段拷出来不该少一个换行）。做法是让每一块**带上收尾它的那个换行**：
 * 「A\n\nB」切成 `A\n` / `\n` / `B` 三块，接起来还是「A\n\nB」；而三块各排
 * 1 / 1 / 1 个行盒，与原先那一整片 `pre-wrap` 排出来的三行**逐像素相同**
 * （换行是它自己那一行的收尾，不是下一行的开头——差别就在这儿）。
 *
 * 也正因为如此，**值为 0 时阅读页根本不必调用它**：段落之间不加料时，原先那一个
 * 文本节点排出来的就是这个结果（见 TxtApp 的 blocks）。
 */
export function splitParagraphs(text: string): TxtBlock[] {
  const blocks: TxtBlock[] = []
  if (!text) return blocks

  const lines = text.split('\n')
  const 有空行 = lines.some((l) => l.trim() === '')

  let i = 0
  while (i < lines.length) {
    const blank = 有空行 && lines[i].trim() === ''
    let j = i + 1
    // 空行那一片要连着收：连着几个空行是一块间距，不是几块
    if (有空行) while (j < lines.length && (lines[j].trim() === '') === blank) j++
    blocks.push({
      kind: blank ? 'gap' : 'p',
      text: lines.slice(i, j).join('\n') + (j < lines.length ? '\n' : '')
    })
    i = j
  }
  return blocks
}

/** 位置记号：`<章序>:<章名>`。见文件头 */
export function formatMark(index: number, title: string): string {
  return `${index}:${title}`
}

/**
 * 读回位置记号。
 *
 * 章名自己可能带冒号（「第12章 后记:时间线收束」），所以只按**头一个**冒号分，
 * 且那一段必须是纯数字；不是纯数字就整串当章名——别的写者（或者手改过的
 * reading.json）不该让我们认错。
 */
export function parseMark(mark: string): { index: number; title: string } {
  const cut = mark.indexOf(':')
  if (cut > 0) {
    const head = mark.slice(0, cut)
    if (/^\d+$/.test(head)) return { index: Number(head), title: mark.slice(cut + 1) }
  }
  return { index: -1, title: mark }
}

/**
 * 上次读到的那一章是第几章。
 *
 * 先按章名找（同一份文件一定找得到），同名有多条时取**离记下的章序最近**的那一条
 * ——目录里「番外」这类名字重复是常事，取第一条会把人送回很前面去。章名一条都对不上
 * （文件换了一版、那一章被删了）才退回章序：这份账按本机路径记，路径没变，章序就
 * 仍然是个靠谱的落点。两样都不可用（没有记号）就是第一章。
 */
export function locateChapter(chapters: TxtChapter[], mark: string): number {
  if (chapters.length === 0) return 0
  if (!mark) return 0

  const { index, title } = parseMark(mark)
  if (title) {
    let best = -1
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].title !== title) continue
      if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i
    }
    if (best >= 0) return best
  }

  if (index >= 0) return Math.min(index, chapters.length - 1)
  return 0
}
