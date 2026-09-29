/**
 * 地址栏输入的解析与域名工具。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/**
 * 自家页面用的伪协议。
 *
 * 起始页与系统设置对外都只以 zhituan:// 示人，真实的 file:// 路径既不显示，
 * 也不该显示——那会暴露本机目录结构。
 */
const OWN_SCHEME = 'zhituan://'

/** 这个地址是不是自家页面（起始页、系统设置） */
export function isOwnUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(OWN_SCHEME)
}

/** 形如 example.com、www.example.com:8080/path 的裸域名 */
const BARE_HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/
/**
 * 带协议的绝对地址。
 *
 * 不能用「必须含 ://」来判断：about:blank、data:、view-source: 这些
 * 都是合法的、不带双斜杠的地址，按 :// 判断会把它们误当成搜索词。
 * 同时也不能只看「有没有冒号」——example.com:8080 会被错认成协议。
 * 因此这里列白名单。
 */
const HAS_SCHEME = /^(https?|about|file|data|blob|chrome|view-source|ftp|mailto):/i
/** 可以安全当作站内搜索的输入：含中文，或含空格 */
const LIKELY_SEARCH = /[一-鿿\s]/

/**
 * 判断地址栏输入是否应该被当成网址。
 * 规则保守：只有明确像域名的才当网址，其余一律走搜索，
 * 避免把「红楼梦 在线阅读」这类查询拼成一个不存在的域名。
 */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim()
  if (!s) return false
  if (HAS_SCHEME.test(s)) return true
  if (s.startsWith('localhost')) return true
  if (LIKELY_SEARCH.test(s)) return false
  return BARE_HOST.test(s)
}

/** 把地址栏输入解析为最终要加载的 URL */
export function resolveInput(input: string, searchTemplate: string): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (HAS_SCHEME.test(s)) return s
  if (looksLikeUrl(s)) return `https://${s}`
  return searchTemplate.replace('%s', encodeURIComponent(s))
}

/** 从 URL 中取出主机名，失败返回 null */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** 常见的二级后缀，用于粗略求出 eTLD+1 */
const MULTI_PART_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.uk', 'org.uk', 'ac.uk', 'co.jp', 'ne.jp', 'or.jp',
  'com.hk', 'com.tw', 'com.au', 'co.kr'
])

/**
 * 粗略求「可注册域名」（eTLD+1），用于按站点记住 UA、缩放等偏好。
 *
 * 需要它而不是直接用 hostname，是因为 weread.qq.com 与 qq.com
 * 应当被视作同一站点，否则用户在两者之间的偏好会不一致。
 * 这里不引入公共后缀列表（体积大且需更新），用一份够用的后缀集近似。
 */
export function registrableDomain(host: string): string {
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

/** 同一站点判断，用于按站点存偏好 */
export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a)
  const hb = hostOf(b)
  if (!ha || !hb) return false
  return registrableDomain(ha) === registrableDomain(hb)
}

/**
 * 用户填的一格地址 → 一条真能打开的网址。
 *
 * 与 resolveInput 分工不同：那个管的是**地址栏**——认不出网址就当关键词搜；
 * 这个管的是**「我的站点」里那一格**，那里的东西按定义是一个站点，
 * 因此绝不落到搜索上去，缺的只会是协议头：用户填 `bilibili.com` 是常态，
 * 而 `new URL('bilibili.com')` 会抛，起始页拿不到域名就会把这**整条**静默丢掉
 * （见 useTiles 的 domainOf）——存进去一个打不开、也看不见的站点，比拒绝它更糟。
 *
 * 判据保守：只有明摆着带协议的才原样留着（`http://` `https://` `file://`
 * 这一类带 `//` 的，以及 about: / file: / data: 这些不带斜杠的），其余一律补
 * `https://`。`localhost:8080` 因此会被补成 `https://localhost:8080`
 * ——本机的东西本来就不该进起始页那一列站点，补成 https 至少是一条合法的网址。
 *
 * 空串回空串：那是「还没填」，由调用方去说，不在这里编一个网址出来。
 */
export function asSiteUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^(about|file|data|blob|view-source|chrome):/i.test(s)) return s
  return `https://${s}`
}

/**
 * 网址 → 可注册域名（`https://weread.qq.com/x` → `qq.com`）。
 *
 * 认不出就是 null：不是网址、没有主机名、或者本机文件那种没有域名的地址。
 * **「认不出」必须是一条干净的路**，不能拿整条 URL 顶上——起始页拿它去重、
 * 拿它归栏（见 renderer/src/home/useTiles.ts），而「被移除的站点域名」那份名单
 * （services/hiddenSiteStore.ts）也是按同一把尺子写的。两处必须同源：
 * 一边记 qq.com、另一边拿 weread.qq.com 去比，一条也中不了，删了等于没删。
 */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  const host = hostOf(url)
  return host ? registrableDomain(host) : null
}

/**
 * 本机文件的名字：`file:///C:/书/斗破苍穹.txt` 得到 `斗破苍穹.txt`。
 *
 * 只给 `file:` 用，而且**只有它**能给出一件可以显示的东西——本机路径
 * （`C:\Users\…\Documents\…`）是这台机器的目录结构，显示它等于把用户名
 * 和目录习惯摊在屏幕上，而这个程序的全部意义是别人看不出你在干什么。
 * 因此凡是 `file:` 的条目要写要给人看时，一律走这里取名字。
 *
 * 不是 `file:` 的地址返回 null（`hostOf` 对 file: 返回空串，不能用它兜）。
 * 浏览器的 file: URL 会把路径逐段百分号编码（空格是 %20），所以认得出
 * 编码就解回来；断掉的编码（半截 UTF-8）原样返回，宁可显示得别扭，
 * 也不要抛异常把整页带下去。
 */
export function fileNameOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:') return null
  const raw = parsed.pathname.split('/').filter(Boolean).pop()
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 本机 PDF：`file:` 协议、且文件名以 `.pdf` 结尾。
 *
 * 判据只有一条，判的地方也只有一处（TabManager.create）——本机 PDF 不进
 * Chromium 内置的那个阅读器，而是开成自家的阅读页（见 services/pdfReader.ts）。
 * 内置阅读器把纸直接画在插件表面上，注入的样式与滤镜一个像素都动不了，
 * 白底因此永远去不掉；自家阅读页用 pdf.js 画进 canvas，纸才是可透明的。
 *
 * 其余本机文件（TXT）照旧交给 Chromium 自己渲染——它本来就把纸留白、
 * 只画字，不必再动。
 */
export function isLocalPdf(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false
  return fileNameOf(url)?.toLowerCase().endsWith('.pdf') ?? false
}

/**
 * 本机 EPUB：`file:` 协议、且文件名以 `.epub` 结尾。
 *
 * 与 isLocalPdf 是同一族的判据，理由也一样：Chromium 不认这个格式（`will-download`
 * 到场、`loadURL` 当场以 ERR_FAILED 结束，实测见 docs/spike-findings.md 的 Q63），
 * 所以它不能当普通网页交给 Chromium，得开成自家的阅读页（services/bookReader.ts）。
 *
 * 地址栏那条路也归这里管：`file:` 在 HAS_SCHEME 白名单里，用户把
 * `file:///C:/书/xxx.epub` 粘进地址栏时同样会经过 TabManager.create 的这一处判定，
 * 于是粘贴进来的书与选文件框选中的书走的是同一条路。
 */
export function isLocalEpub(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false
  return fileNameOf(url)?.toLowerCase().endsWith('.epub') ?? false
}

/**
 * 本机文件：`file:` 协议。**离线阅读读的就是它。**
 *
 * 与 isLocalPdf 分工不同：那个回答「谁来排这一页」（自家阅读页 vs 交给
 * Chromium），只管 PDF；这个回答「界面上的阅读透明度此刻管不管得着」，
 * 本机 TXT 与自家 PDF 阅读页都算，而网页（http/https，以及自家那两屏的
 * `zhituan://` 伪地址）一律不算——`ui.readerOpacity` 永远不许落到网页头上。
 *
 * 因此判据只有「协议是不是 file:」这一条：本机 PDF 在**界面这一侧**对外
 * 露的正是那个 `file:///…/book.pdf` 地址（阅读页的地址只属于视图内部，
 * 见 TabManager.wireEvents 的 did-navigate），于是同一个谓词在
 * 主进程（注入哪一页）与渲染进程（那条滑块此刻是不是活的）说的是同一件事。
 */
export function isLocalFile(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false
  try {
    return new URL(url).protocol === 'file:'
  } catch {
    return false
  }
}

/**
 * 本机文本：`file:` 协议，**且不是 PDF**。
 *
 * 它回答的是「顶栏那枚『Aa』此刻管不管得着」——也就是「这一页的正文是不是
 * 一份能改字号的东西」。管得着的有两种：
 *
 *   · **TXT 这一类**（Chromium 自己渲染的纯文本）：整篇文档就是个 `pre`，
 *     字号行距都由 UA 样式表定，我们只能往那个 `pre` 上写样式
 *     （见 services/pageStyler.ts 的 applyReaderTypeset）；
 *   · **自家 EPUB 阅读页**：它从同一份配置里读那三项，右下角也长着一枚 Aa
 *     （见 book/BookApp.vue）。这里把它一并算进来，是因为改的是同一个配置项，
 *     从顶栏改和从书页里改结果一样——两处入口说的是同一件事，没必要在那儿
 *     装作不管。
 *
 * PDF 不算：那一页的字是画进 canvas 的，没有字号可调，想放大得改缩放
 * （它是另一条路，见 Rail.vue 那三格缩放）。
 *
 * 与 isLocalFile 分工不同：那个回答「界面上那条阅读透明度此刻管不管得着」
 * （PDF 也算，淡的是那张纸）；这个回答「能不能改字」。两张判据因此差一个
 * isLocalPdf。
 */
export function isLocalText(url: string | null | undefined): boolean {
  return isLocalFile(url) && !isLocalPdf(url)
}
