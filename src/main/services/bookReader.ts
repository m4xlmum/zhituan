/**
 * 本机 EPUB：自家的阅读页，以及把一本书当作**一棵目录树**送出去的那条通道。
 *
 * 一句话概括它与 pdfReader 的分工：**这一边只解包、只送字节，不解析书的内容。**
 * 容器的目录结构（`META-INF/container.xml` → OPF → spine / nav）留给阅读页，
 * 因为那边有 `DOMParser`——主进程里没有。不自己手写一个 XML 解析器，就少一整类
 * 「属性顺序、命名空间前缀、自闭合、实体引用」的暗坑；而解 ZIP 是纯算术，
 * 40 行中央目录解析就够（Q63 已实测），没有可争议的地方。
 *
 *   zhituan-book://<token>/<书内路径>   书里那一个条目
 *
 * 为什么地址里是一串 token 而不是文件路径：与 pdfReader 同一条规矩——**路径不出
 * 主进程**。阅读页拿到的是它手上那一本的标识，它既不知道这本书在哪儿，也不能顺着
 * 这条协议去要别的文件。
 *
 * 为什么按**书内真实路径**送，而不是摊成 `doc/<token>` 一节一节给：这样书里的相对
 * 地址（`../images/x.png`、`../styles/main.css`）由 URL 自己那套点段归一化解决，
 * 我们一条都不用改写（已实测：`zhituan-book://tok/OEBPS/text/` + `../images/dot.svg`
 * → `zhituan-book://tok/OEBPS/images/dot.svg`）。CSS 里的 `url(../…)` 更是自动就对，
 * 因为它相对的是样式表自己的地址。
 *
 * 为什么要另开一条协议，而不是让页面直接读文件：`file:` 页面去 fetch 另一个
 * `file:` 被挡死（file 来源不透明，CORS 过不去），而这本书的每一张图、每一份样式表
 * 都要取。这条协议因此注册成 standard + secure + corsEnabled。
 *
 * **`.xhtml` 一律以 `text/html` 送出**，这是踩过坑之后刻意选的（Q63 第 4 条）：
 * Chromium 按扩展名把 `.xhtml` 交给 XML 解析器，正文里只要有一处不闭合，整页当场
 * 变成一个解析错误（实测只剩 4 个字）；而 EPUB 世界里非良构的 XHTML 满地都是。
 * 以 `text/html` 送，页面用容错的那套 HTML 解析器读——代价是 XHTML 里自闭合的
 * 非空元素（`<div/>`）会当成开标签，这比整页消失好得多（见 spike/book-page.js：
 * contentType 是 text/html、parserError 为假）。
 *
 * ## 「读到哪儿了」也从这条通道上过一遍
 *
 * 阅读页手里只有一个 token，而那份账按**本机路径**记（services/readingStore.ts）。
 * 两张表都在本文件里，于是换算留在一处：开这一页时把上次的位置拼进地址
 * （`&at=<章>&ratio=<比例>`），阅读页翻页时凭 token 报回来（rememberReading）。
 * 于是阅读页从头到尾不知道自己读的是哪个文件——「路径不出主进程」这条规矩
 * 在这一组新功能上一个口子也没开。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { log } from './logger'
import type { ReadingStore } from './readingStore'
import { rendererUrl } from './rendererUrl'

export const BOOK_SCHEME = 'zhituan-book'

/** ZIP 的三条签名。解包这件事只有它们三个要认 */
const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/** ZIP 末尾那段注释最长 65535 字节，EOCD 因此不会离末尾更远 */
const MAX_COMMENT = 0xffff
/** EOCD 自身固定 22 字节 */
const EOCD_SIZE = 22

/**
 * 内容类型。
 *
 * `.xhtml` 那三条的理由写在文件头上。反过来，**`.js` 刻意不列**：书的正文里塞脚本
 * 是合法的，而这一页的 CSP 里没有 `zhituan-book:` 的 script-src——于是「不列出它」
 * 与「CSP 不放行」是两道独立的闸，任一道都够。
 */
const MIME: Record<string, string> = {
  '.xhtml': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // 容器、OPF、NCX 这三份是 XML。阅读页一律 fetch().text() 去读，因此内容类型
  // 写错也不影响功能；写对是为了让抓包与调试时一眼看得出这是什么。
  '.xml': 'application/xml; charset=utf-8',
  '.opf': 'application/oebps-package+xml; charset=utf-8',
  '.ncx': 'application/x-dtbncx+xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

/** 中央目录里的一个条目 */
interface ZipEntry {
  /** 0 = 直接存，8 = deflate。EPUB 只许这两种 */
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

/** 一本打开着的书：整份字节 + 它的条目表 */
interface Archive {
  bytes: Buffer
  entries: Map<string, ZipEntry>
  /**
   * 小写名 → 真名。
   *
   * 真实 EPUB 里 `href` 与 ZIP 内实际名字大小写不一致的不少（工具链的历史包袱），
   * 按字面找不到时兜这一层，比让用户看见一张破图强。真名优先，它只是退路。
   */
  lower: Map<string, string>
}

/**
 * 阅读位置那份账（按本机路径记，见 services/readingStore.ts）。
 *
 * 由装配那一步挂进来（`attachReadingStore`），本模块**不自己 new 一个**：
 * userData 在哪只有 index.ts 知道，而这里只该管 token 与字节。没挂上时一切照旧
 * ——只是不记位置、不从上次的地方开始，读这件事一点不受影响。
 */
let reading: ReadingStore | null = null

/** 挂上那份账。在 app ready 之前的装配里调用一次 */
export function attachReadingStore(store: ReadingStore): void {
  reading = store
}

/** token → 本机路径。这就是那本「路径不出主进程」的账 */
const pathByToken = new Map<string, string>()
/** 路径 → token：同一本书重复打开给同一个标识，账不会越记越长 */
const tokenByPath = new Map<string, string>()
/** token → 解开的书。**惰性**打开，见 openArchive */
const archiveByToken = new Map<string, Archive>()

/**
 * 同时留几本书的字节在内存里。
 *
 * 一本 EPUB 通常几兆、偶尔几十兆，而阅读页一次只读一章；读过的书留着能让翻章与
 * 翻图都是纯内存操作。上限是按「同时读几本」设的，超出就把最早打开的那本放掉
 * （Map 的迭代顺序就是插入顺序）。
 *
 * 刻意**不**挂到标签页的关闭事件上：那要跨模块加一个生命周期回调，而这条路一旦
 * 漏掉一次，账就永远收不回来；一个固定上限不依赖任何人的自觉。
 */
const MAX_HELD_ARCHIVES = 4

/**
 * 这条协议的特权声明。
 *
 * **这里只交名字，不负责注册**：`protocol.registerSchemesAsPrivileged()` 只认
 * **最后一次调用**，而 1.6.9 加进第三条（TXT）时，前两条就是这么一起哑掉的
 * ——三条一起交的写法与读数见 index.ts 的 registerReaderSchemes。
 */
export const BOOK_SCHEME_PRIVILEGED: Electron.CustomScheme = {
  scheme: BOOK_SCHEME,
  privileges: {
    // standard：按 `协议://主机/路径` 解析，主机名才能当 token 用，
    // 而且 `..` 会被 URL 自己归一化掉（书里的相对地址全靠这一条）
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true
  }
}

/**
 * 把这条协议挂到实际使用的会话上。
 *
 * 挂的是**分区会话**（`persist:zhituan`），与 pdfReader 同理：挂错了地方等于这条
 * 协议根本不存在。只能在 app ready 之后调用。
 */
export function registerBookProtocol(ses: Session): void {
  ses.protocol.handle(BOOK_SCHEME, handleBookRequest)
}

/**
 * 一本本机 EPUB 的阅读页地址（文件路径不出主进程）。
 *
 * 这里**只发一个 token，不碰磁盘**：一是 create() 是同步的，几十兆的书在那儿读会
 * 卡住界面；二是「这本打不开」这件事该在阅读页上说给用户听，而不是在开标签页的
 * 路上静默失败。真正拆包发生在页面来取第一个条目的那一刻。
 *
 * 万一这条 file: 地址解析不出路径（Windows 上的网络路径），由调用方退回
 * 「当普通网页打开」——比开出一张空白页强，与 pdfReader 的退路一致。
 */
export function bookReaderUrl(fileUrl: string): string {
  const path = fileURLToPath(fileUrl)
  let token = tokenByPath.get(path)
  if (!token) {
    token = randomUUID()
    tokenByPath.set(path, token)
    pathByToken.set(token, path)
  }

  const base = `${rendererUrl('book')}?doc=${token}`

  /*
   * 上次读到哪儿，随地址一起交给阅读页。
   *
   * 放在地址里而不是「打开之后再来一次 IPC 问」：阅读页落地的那一刻就该是对的位置，
   * 先排第一章再跳过去，等于当着用户的面闪一下。没有记录时少两个参数，于是
   * 「第一次读这本书」与「读过的书」走的是同一条代码路径。
   */
  const mark = reading?.of(path)
  if (!mark) return base
  return `${base}&at=${encodeURIComponent(mark.chapter)}&ratio=${mark.ratio.toFixed(4)}`
}

/**
 * 阅读页报回来的位置：token 换成本机路径，记进那份账。
 *
 * **查不到 token 就什么也不做**，这是这条路上唯一的把关，而它够用：token 表里
 * 只有真正开过的书（而且是本次进程里开的），一条凭空来的消息最多是个空操作。
 */
export function rememberReading(token: string, chapter: string, ratio: number): void {
  const path = pathByToken.get(token)
  if (!path || !reading) return
  reading.remember(path, chapter, ratio)
}

/** 惰性打开并缓存。第一次来取条目时才真的读盘、拆包 */
function openArchive(token: string): Archive {
  const cached = archiveByToken.get(token)
  if (cached) return cached

  const path = pathByToken.get(token)
  if (!path) throw new Error('这本书不在手上')

  const bytes = readFileSync(path)
  const archive = parseArchive(bytes)

  while (archiveByToken.size >= MAX_HELD_ARCHIVES) {
    const oldest = archiveByToken.keys().next().value
    if (oldest === undefined) break
    archiveByToken.delete(oldest)
  }
  archiveByToken.set(token, archive)
  log.info(`打开 EPUB：${path}（${archive.entries.size} 个条目）`)
  return archive
}

/**
 * 读中央目录。
 *
 * 从末尾往回找 EOCD，再顺着它给的偏移把条目表读完。表在文件尾、每条的本地头在
 * 文件头，这是 ZIP 的设计——所以**不能**顺序读，必须先把表拿全。
 */
function parseArchive(bytes: Buffer): Archive {
  if (bytes.length < EOCD_SIZE) throw new Error('这个文件太小，不是一个 ZIP')

  const from = Math.max(0, bytes.length - MAX_COMMENT - EOCD_SIZE)
  let eocd = -1
  for (let i = bytes.length - EOCD_SIZE; i >= from; i--) {
    if (bytes.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 的中央目录，这个文件不是一本 EPUB')

  const count = bytes.readUInt16LE(eocd + 10)
  const cdOffset = bytes.readUInt32LE(eocd + 16)

  /*
   * ZIP64：条目数或偏移写满 32 位时，真值被挪到一份 ZIP64 扩展记录里，这里读到的
   * 就是全 F。EPUB 几乎不会用到它（一本电子书到不了 4GB / 6.5 万条目），
   * 但撞上时要说清是「不支持 ZIP64」，而不是让用户对着一句「文件坏了」发愣。
   */
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('这本 EPUB 用了 ZIP64，这一版还不支持')
  }
  if (cdOffset + 4 > bytes.length) throw new Error('中央目录的位置越过了文件末尾')

  const entries = new Map<string, ZipEntry>()
  const lower = new Map<string, string>()
  let at = cdOffset

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== SIG_CENTRAL) break
    const method = bytes.readUInt16LE(at + 10)
    const compressedSize = bytes.readUInt32LE(at + 20)
    const size = bytes.readUInt32LE(at + 24)
    const nameLen = bytes.readUInt16LE(at + 28)
    const extraLen = bytes.readUInt16LE(at + 30)
    const commentLen = bytes.readUInt16LE(at + 32)
    const localOffset = bytes.readUInt32LE(at + 42)
    // EPUB 规定文件名是 UTF-8（ZIP 规范那个 CP437 的老默认值在这里不适用）
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLen)

    if (name && !name.endsWith('/')) {
      entries.set(name, { method, compressedSize, size, localOffset })
      const key = name.toLowerCase()
      if (!lower.has(key)) lower.set(key, name)
    }
    at += 46 + nameLen + extraLen + commentLen
  }

  if (entries.size === 0) throw new Error('这本 EPUB 是空的（一个条目都没有）')
  return { bytes, entries, lower }
}

/**
 * 取出一个条目的内容。
 *
 * 偏移取的是**本地头**里那一份 nameLen / extraLen，不是中央目录里那一份：
 * 两者可以合法地不同（本地头常带一段中央目录里没有的扩展字段），照中央目录那份算
 * 就会差几个字节——出来的是解压失败的乱码，而不是一眼看得出的错。
 */
function readEntry(archive: Archive, name: string): Buffer | null {
  const real = archive.entries.has(name) ? name : archive.lower.get(name.toLowerCase())
  if (!real) return null
  const entry = archive.entries.get(real)
  if (!entry) return null

  const { bytes } = archive
  if (entry.localOffset + 30 > bytes.length) return null
  if (bytes.readUInt32LE(entry.localOffset) !== SIG_LOCAL) return null

  const nameLen = bytes.readUInt16LE(entry.localOffset + 26)
  const extraLen = bytes.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLen + extraLen
  if (start + entry.compressedSize > bytes.length) return null

  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw)
    } catch (err) {
      log.warn(`EPUB 条目解压失败：${real}`, err)
      return null
    }
  }
  // 别的压缩法 EPUB 规范里不许出现；真出现了就当作读不到
  log.warn(`EPUB 条目用了不支持的压缩法 ${entry.method}：${real}`)
  return null
}

async function handleBookRequest(request: Request): Promise<Response> {
  // 页面的来源是 `file:`，在不透明来源下这是一条不带凭据的请求，因此 `*` 是对的
  const cors = { 'Access-Control-Allow-Origin': '*' }

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return plain(400, '地址不合法', cors)
  }

  const token = url.hostname
  let name: string
  try {
    name = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return plain(400, '地址不合法', cors)
  }

  /*
   * 两道都留着。URL 那一层已经把点段归一化过了（standard 特权给的），所以正常
   * 情况下这里根本见不到 `..`；但这条协议的输入来自页面，而页面不算可信，
   * 多一道就少一个「顺着 `../../…` 去读别的文件」的口子。
   */
  if (!name || name.includes('..') || name.startsWith('/')) {
    return plain(400, '条目地址不合法', cors)
  }

  let archive: Archive
  try {
    archive = openArchive(token)
  } catch (err) {
    log.warn(`打开 EPUB 失败：${String(err)}`)
    return plain(404, `打不开这本书：${err instanceof Error ? err.message : String(err)}`, cors)
  }

  const buf = readEntry(archive, name)
  if (!buf) return plain(404, `书里没有这个条目：${name}`, cors)

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(buf.length)
    }
  })
}

/** 一句人话的错误响应。阅读页读得到它，也就把它写在屏幕上 */
function plain(status: number, message: string, cors: Record<string, string>): Response {
  log.warn(`书籍通道 ${status}：${message}`)
  return new Response(message, {
    status,
    headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
