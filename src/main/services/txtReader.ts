/**
 * 本机 TXT：自家的阅读页，以及把那一份字节送出去的那条通道。
 *
 * 一句话与 bookReader / pdfReader 的分工：**这一边只送字节，不认编码、也不切章。**
 * 编码只有渲染进程认得出（GBK 那一档靠 `TextDecoder`，Q84），切章要用那份解开的
 * 文本——于是两条都留在阅读页（@shared/txt.ts）。主进程这一头只剩「读文件、发字节」，
 * 与 bookReader 那句「只解包、只送字节」是同一条规矩。
 *
 *   zhituan-txt://<token>/text    这一份文件的全文字节
 *
 * ## 为什么要另开一条路：TXT 原先交给 Chromium 自己渲染
 *
 * 1.6.8 之前，本机 TXT 是当成一张普通网页交给 Chromium 的文本查看器的：它自己生成
 * 一个 `pre`、自己排字。那一页我们一个控件都挂不上去，于是连字号都要从主进程往那个
 * `pre` 上写（services/pageStyler.ts）。**但真正的问题不在排版，是那一页没有「章」
 * 这个概念**：整篇文档就是一个巨大的 `pre`，读到哪里只能记「整篇的百分之几」，
 * 一万字的位置误差在换一次字号之后就落回原处——记了也白记。
 *
 * 分成章之后，位置落在「哪一章 + 章内多少」上，与 EPUB 那一页同一个语义：字号一变、
 * 窗口一换，读的还是那一段。顺带解掉的是另一件事——Q78 量的那个上限，一本 6.7MB 的
 * 小说按 `pre` 一整篇排出来，在最粗那档排版下离 Chromium 的排版上限只剩一倍余量；
 * 一次只排一章，那件事从此不必再算（最长的一章一万字）。
 *
 * ## 地址里是一串 token，与 PDF / EPUB 同一条规矩
 *
 * **路径不出主进程**：阅读页拿到的只是它手上那一份的标识，它既不知道这份文件在哪儿，
 * 也不能顺着这条协议去要别的文件（这条协议只有一个路径 `/text`）。于是那两张 token 表
 * 也只有这一个用途——「读到哪儿了」的换算也落在本文件里（路径是那份账的 key，
 * 见 services/readingStore.ts 与 rememberTxtReading）。
 *
 * ## 与 bookReader 的 token 表是两张，不是一个
 *
 * 有意分开的：两张表的 key 空间不同（一张管 ZIP 里的条目、一张只管一份字节），
 * 合成一张就得在里面再分一次「这是书还是 TXT」，而两个模块各自只管一件事读起来
 * 更清楚。代价是 IPC 那一头要问两处（registerFileIpc.ts 里那两行），可接受。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { protocol, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TXT_SCHEME } from '@shared/txt'
import { log } from './logger'
import type { ReadingStore } from './readingStore'
import { rendererUrl } from './rendererUrl'

export { TXT_SCHEME }

/**
 * 阅读位置那份账（按本机路径记，见 services/readingStore.ts）。
 *
 * 与 bookReader 一样由装配那一步挂进来，**不自己 new 一个**：userData 在哪只有
 * index.ts 知道。没挂上时一切照旧——只是不记位置、不从上次的地方开始。
 */
let reading: ReadingStore | null = null

/** 挂上那份账。在 app ready 之前的装配里调用一次 */
export function attachReadingStore(store: ReadingStore): void {
  reading = store
}

/** token → 本机路径。这就是那一份「路径不出主进程」的账 */
const pathByToken = new Map<string, string>()
/** 路径 → token：同一份文件重复打开给同一个标识，账不会越记越长 */
const tokenByPath = new Map<string, string>()

/**
 * 注册协议名。**必须在 app ready 之前调用**（特权只能在那之前声明），
 * 因此 index.ts 里它挨着 registerBookScheme()。
 */
export function registerTxtScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: TXT_SCHEME,
      privileges: {
        // standard：按 `协议://主机/路径` 解析，主机名才能当 token 用
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // 页面的来源是 `file:`（不透明来源），要它取得到这条协议就得开 CORS
        corsEnabled: true
      }
    }
  ])
}

/**
 * 把这条协议挂到实际使用的会话上。
 *
 * 挂的是**分区会话**（`persist:zhituan`），与 pdfReader / bookReader 同理：
 * 挂错了地方等于这条协议根本不存在。只能在 app ready 之后调用。
 */
export function registerTxtProtocol(ses: Session): void {
  ses.protocol.handle(TXT_SCHEME, handleTxtRequest)
}

/**
 * 一份本机 TXT 的阅读页地址（文件路径不出主进程）。
 *
 * 与 bookReaderUrl 逐条相同，包括那个「上次读到哪儿，随地址一起交给阅读页」的做法：
 * 阅读页落地的那一刻就该是对的姿势，先排第一章再跳过去，等于当着用户的面闪一下。
 * 没有记录时少两个参数，于是「第一次读这一份」与「读过好几遍的」走同一条代码路径。
 *
 * 切不出章的文件（不是小说）也走这一条路：那种文件整篇算一章，`&at=` 里记下的
 * 章名是「全文」，比例是整篇的比例——位置照样记得住。
 *
 * 万一这条 file: 地址解析不出路径（Windows 上的网络路径），由调用方退回
 * 「当普通网页打开」——Chromium 自己的文本查看器照样读得起来，只是回到旧样子。
 */
export function txtReaderUrl(fileUrl: string): string {
  const path = fileURLToPath(fileUrl)
  let token = tokenByPath.get(path)
  if (!token) {
    token = randomUUID()
    tokenByPath.set(path, token)
    pathByToken.set(token, path)
  }

  const base = `${rendererUrl('txt')}?doc=${token}`

  const mark = reading?.of(path)
  if (!mark) return base
  return `${base}&at=${encodeURIComponent(mark.chapter)}&ratio=${mark.ratio.toFixed(4)}`
}

/**
 * 阅读页报回来的位置：token 换成本机路径，记进那份账。
 *
 * **查不到 token 就什么也不做**，这是这条路上唯一的把关，而它够用：token 表里只有
 * 真正开过的文件（而且是本次进程里开的），一条凭空来的消息最多是个空操作。
 */
export function rememberTxtReading(token: string, chapter: string, ratio: number): void {
  const path = pathByToken.get(token)
  if (!path || !reading) return
  reading.remember(path, chapter, ratio)
}

/**
 * 送出去那份字节。
 *
 * **不缓存**（bookReader 缓存了它的 ZIP，理由不同）：这一份字节只在开这一页时取一次，
 * 而缓存一份 6.7MB 的字节省下的只是「页面重新加载一次」的那一次 `readFileSync`——
 * 那一次读也大多落在系统页缓存里。少一层缓存就少一处「读了旧内容」的可能。
 */
async function handleTxtRequest(request: Request): Promise<Response> {
  // 页面的来源是 `file:`，在不透明来源下这是一条不带凭据的请求，因此 `*` 是对的
  const cors = { 'Access-Control-Allow-Origin': '*' }

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return plain(400, '地址不合法', cors)
  }

  const token = url.hostname
  const path = pathByToken.get(token)
  if (!path) return plain(404, '这一份文件不在手上', cors)

  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (err) {
    log.warn(`读不出来这一份 TXT：${path}`, err)
    return plain(404, `打不开这一份文件：${err instanceof Error ? err.message : String(err)}`, cors)
  }

  /*
   * 内容类型写 `application/octet-stream`，**不写 `text/plain; charset=…`**：这一份
   * 字节的编码此刻还不知道（认编码是阅读页的活，见 @shared/txt.ts），顺手写一个
   * `charset=utf-8` 就是一句谎话。阅读页要的是 `arrayBuffer()`，内容类型它不看。
   */
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length)
    }
  })
}

/** 一句人话的错误响应。阅读页读得到它，也就把它写在屏幕上 */
function plain(status: number, message: string, cors: Record<string, string>): Response {
  log.warn(`TXT 通道 ${status}：${message}`)
  return new Response(message, {
    status,
    headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
