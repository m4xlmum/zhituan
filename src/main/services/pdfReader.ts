/**
 * 本机 PDF：自家的阅读页，以及它要的两条资源通道。
 *
 * 为什么要换掉 Chromium 内置的阅读器：那一张纸是 PDFium 直接画在插件表面上的，
 * 注入的 CSS（连 user origin 的 `!important`）与能算出 alpha 的 SVG 滤镜都落不到
 * 它头上——实测 0/120000 个透明像素，注入前后一个像素都不差（见
 * docs/spike-findings.md 的 Q51）。想在逐像素透明的窗口里只留下字、把那张纸去掉，
 * 只能自己画：pdf.js 把页面画进 canvas，纸要么根本没画（`background: transparent`），
 * 要么被逐像素键掉——同一份量具量到 563362 个透明像素。
 *
 *   zhituan-pdf://doc/<token>           一份本机 PDF 的字节（支持 Range）
 *   zhituan-pdf://asset/<目录>/<文件>   pdf.js 运行时按需取的四样资源
 *
 * 为什么要另开一条协议，而不是让页面直接 `fetch('file:///…')`：`file:` 页面去
 * fetch 另一个 `file:` 是被挡死的（file 来源是不透明的，CORS 过不去），而 pdf.js
 * 的 cMap / 标准字体 / wasm 全是运行时的 fetch 取回来的。这条协议注册成
 * standard + secure + corsEnabled，页面与它拉起的 worker 才取得到。
 *
 * 为什么地址里是一串 token 而不是文件路径：**路径不出主进程**。阅读页拿到的是
 * 一次性标识，它既不知道这本书在哪儿，也不能顺着这条协议去要别的文件——它手上的
 * 能力只有「我这一本」那么大。README 里那条「本机文件在界面上只显示文件名」
 * 说的是显示；这里是连内部也不外传。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { app, protocol, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './logger'
import { rendererUrl } from './rendererUrl'

export const PDF_SCHEME = 'zhituan-pdf'

/** 协议里的两个「主机名」：一份文档、一份资源 */
const DOC_HOST = 'doc'
const ASSET_HOST = 'asset'

/** pdf.js 运行时会来取的四个目录，各自是 pdfjs-dist 包里的一层 */
const ASSET_DIRS = new Set(['cmaps', 'standard_fonts', 'wasm', 'iccs'])

/**
 * 资源的内容类型。
 *
 * wasm 那一条是必须写对的：pdf.js 走 `WebAssembly.instantiateStreaming`，
 * 内容类型不是 `application/wasm` 会当场拒收（它有条退回 arrayBuffer 的路，
 * 但那是给旧浏览器留的，没必要走到那儿去）。
 */
const MIME: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream'
}

/** token → 本机路径。这就是那本「路径不出主进程」的账 */
const pathsByToken = new Map<string, string>()
/** 路径 → token：同一本书重复打开时给同一个标识，账不会越记越长 */
const tokensByPath = new Map<string, string>()

/**
 * 注册协议名。
 *
 * **必须在 app ready 之前调用**（Electron 的规矩：特权只能在那之前声明）。
 * 因此 index.ts 里它挨着 hardenWebContents()，都在 bootstrap 的模块体里。
 */
export function registerPdfScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PDF_SCHEME,
      privileges: {
        // standard：按 `协议://主机/路径` 解析，URL 才有 hostname 可用
        standard: true,
        // secure：算安全上下文（pdf.js 与 wasm 都假定自己在安全上下文里）
        secure: true,
        // supportFetchAPI：页面用 fetch 取，而不是只能当文档导航过去
        supportFetchAPI: true,
        // stream / corsEnabled：大文件按段取、跨来源取都要它
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/**
 * 把这条协议挂到实际使用的会话上。
 *
 * 挂的是**分区会话**而不是默认会话：本程序所有页面都跑在 `persist:zhituan`
 * 那个分区里（见 sessionSetup），挂错了地方等于这条协议根本不存在。
 * 只能在 app ready 之后调用——`session.fromPartition` 就是那时的东西。
 */
export function registerPdfProtocol(ses: Session): void {
  ses.protocol.handle(PDF_SCHEME, handlePdfRequest)
}

/**
 * 一本本机 PDF 的阅读页地址（文件路径不出主进程）。
 *
 * 地址里只带 token。阅读页据此去 `zhituan-pdf://doc/<token>` 取字节，自己既不知道
 * 这本书在哪儿，也拿不到别的路径。
 *
 * 万一这条 file: 地址解析不出路径（Windows 上的网络路径 `file://主机/共享/…`
 * 就是这样，Node 的 fileURLToPath 不吃非本机主机名），由调用方退回「当普通
 * 网页打开」——那是这一版之前的行为，比开出一张空白页强。
 */
export function pdfReaderUrl(fileUrl: string): string {
  const path = fileURLToPath(fileUrl)
  let token = tokensByPath.get(path)
  if (!token) {
    token = randomUUID()
    tokensByPath.set(path, token)
    pathsByToken.set(token, path)
  }
  return `${rendererUrl('pdf')}?doc=${token}`
}

async function handlePdfRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return plain(400, '地址不合法')
  }

  // 页面（与它拉起的 worker）的来源是 `file:`，在不透明来源下这是一条
  // 不带凭据的请求，因此 `*` 是对的——这里没有会话可言，也没有什么可泄露的
  const cors = { 'Access-Control-Allow-Origin': '*' }

  let path: string
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return plain(400, '地址不合法', cors)
  }

  if (url.hostname === DOC_HOST) return serveDoc(path, request.headers.get('Range'), cors)
  if (url.hostname === ASSET_HOST) return serveAsset(path, cors)
  return plain(404, '没有这条通道', cors)
}

/** 一份文档的字节。带 Range 就回那一段，不带就整份 */
function serveDoc(token: string, range: string | null, cors: Record<string, string>): Response {
  const path = pathsByToken.get(token)
  if (!path) return plain(404, '这本书不在手上', cors)

  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch (err) {
    // 文件被删了、被移走了、或者没有读权限——原样告诉阅读页，它会写在屏幕上
    log.warn(`读取本机 PDF 失败：${path}`, err)
    return plain(404, '读不到这个文件', cors)
  }

  const total = buf.length
  const base = { ...cors, 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes' }
  const part = parseRange(range, total)

  if (!part) {
    return new Response(copy(buf), {
      status: 200,
      headers: { ...base, 'Content-Length': String(total) }
    })
  }

  const slice = buf.subarray(part.start, part.end + 1)
  return new Response(copy(slice), {
    status: 206,
    headers: {
      ...base,
      'Content-Length': String(slice.length),
      'Content-Range': `bytes ${part.start}-${part.end}/${total}`
    }
  })
}

/**
 * 解析 `bytes=0-1023` / `bytes=500-` / `bytes=-500`。
 *
 * 只认这三种写法（RFC 7233 里合法的就这三种形态，多段 Range 用不上）；
 * 认不出、或者起点已经越过文件末尾，一律当「没带 Range」整份回。
 * 严格按规范该回 416，但 pdf.js 对一整份 200 的处理是现成的（它据此判定
 * 「这个来源不支持分段」并整份读下去），比让它撞一个 416 更稳。
 */
function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null

  const [, rawStart, rawEnd] = m
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const len = Number(rawEnd)
    if (len <= 0 || total === 0) return null
    return { start: Math.max(0, total - len), end: total - 1 }
  }

  const start = Number(rawStart)
  if (start >= total) return null
  const end = rawEnd ? Math.min(Number(rawEnd), total - 1) : total - 1
  if (end < start) return null
  return { start, end }
}

/** 一份运行时资源（cMap、标准字体、wasm、icc 色彩描述） */
function serveAsset(rest: string, cors: Record<string, string>): Response {
  /*
   * 两道都留着：先按名字判目录在不在名单里，拼出来的路径**再核一次**
   * 落在那个目录之内。这条协议的输入来自页面，而页面不算可信——
   * 少一道，`zhituan-pdf://asset/cmaps/../../../../Users/…` 就成了一个
   * 「读任意文件」的接口。
   */
  const cut = rest.indexOf('/')
  if (cut < 0) return plain(400, '资源地址不合法', cors)
  const dir = rest.slice(0, cut)
  const rel = rest.slice(cut + 1)
  if (!ASSET_DIRS.has(dir)) return plain(404, '没有这个资源目录', cors)
  if (!rel || rel.includes('..')) return plain(400, '资源地址不合法', cors)

  const root = resolve(assetRoot(), dir)
  const file = resolve(root, rel)
  if (file !== root && !file.startsWith(root + sep)) return plain(400, '资源地址不合法', cors)

  let buf: Buffer
  try {
    buf = readFileSync(file)
  } catch (err) {
    log.warn(`读取 pdf.js 资源失败：${file}`, err)
    return plain(404, '没有这个资源', cors)
  }

  return new Response(copy(buf), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(buf.length)
    }
  })
}

/**
 * 交给 `Response` 的那一份字节。
 *
 * 两件事一起办：Node 的 `readFileSync` 对不大的文件会从**共享的池**里切一段出来
 * （`buffer.buffer` 是那口池，不是这一段），所以不能直接把 `buf.buffer` 递出去；
 * 而 TypeScript 的 `BodyInit` 只认 ArrayBuffer 撑着的视图，`Buffer` 那种
 * `Uint8Array<ArrayBufferLike>` 过不了检查。`new Uint8Array(view)` 正好两头都满足
 * ——它按视图的内容抄一份到自己的 ArrayBuffer 上。
 *
 * 抄这一份不亏：`Response` 内部本来就会把字节收进自己的 body 流。
 */
function copy(view: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(view)
}

/**
 * pdf.js 的资源目录。
 *
 * 直接从 pdfjs-dist 这个包自己的目录里取：开发期在仓库的 node_modules 下，
 * 打包后在 app.asar 里（它是运行时依赖，electron-builder 会把它收进去），
 * 两边是同一条路径写法。**不必**在构建时把这几兆资源抄一份到 resources/——
 * 抄一份就多一处「抄漏了一个目录、只有打包后才看得出来」的病。
 *
 * 用不上的那几层（`legacy/`、`web/`、`types/`、12M 的构建产物与 sourcemap、
 * 还有 pdfjs-dist 那条 37MB 的可选依赖 @napi-rs/canvas）由
 * electron-builder.yml 的 files 挡在外面。
 */
function assetRoot(): string {
  return join(app.getAppPath(), 'node_modules', 'pdfjs-dist')
}

/** 一句人话的错误响应。pdf.js 只读状态码，这几行是给调试的人看的 */
function plain(status: number, message: string, cors: Record<string, string> = {}): Response {
  log.warn(`PDF 资源通道 ${status}：${message}`)
  return new Response(message, {
    status,
    headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
