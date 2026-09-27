/**
 * 一本 EPUB 的目录结构：容器 → OPF → spine / nav。
 *
 * ## 为什么解析在渲染进程
 *
 * 因为这里才有 `DOMParser`。主进程只管解 ZIP 与送字节（services/bookReader.ts），
 * 一个字都不解析——不自己手写 XML 解析器，就少一整类「属性顺序、命名空间前缀、
 * 自闭合、实体引用」的暗坑。
 *
 * ## 三条实测出来的规矩
 *
 * 全部来自 spike/book-page.js：
 *
 *   · **相对地址必须自己改写。** 章节不是当独立文档加载的，它被插进我们自己的
 *     `book.html`，于是页面的基准地址成了 `book.html` 而不是它在书里的位置——
 *     书里写的 `../images/x.png` 会解析到我们自己的目录去。所以这里把每一个
 *     `src` / `href` / `poster` 都换成绝对地址（点段归一化由 URL 自己做）。
 *     书自己的样式表**不用**改里面的 `url(../…)`：那些相对的是样式表自己的地址。
 *   · **章节的 body 保留成本真的 body 元素。** 书里最常写的第一条规则就是
 *     `body { margin: … }`，而它是按标签名匹配的；实测把 `createElement('body')`
 *     摆进 Shadow DOM 之后，书那条 `body { margin-top: 48px }` 照样命中
 *     （读回来就是 48px）。换成 div 就只剩 UA 的默认值——于是少改写一整类选择器。
 *   · **`.xhtml` 按 `text/html` 解析。** 主进程就是以这个 MIME 送出来的（那里的
 *     文件头写了为什么：走 XML 解析器的话，一处不闭合就是整页消失）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

export const BOOK_SCHEME = 'zhituan-book'

/** 书里的一章：地址已经解成绝对的 */
export interface Chapter {
  id: string
  /** 绝对地址，供 fetch 与导航 */
  url: string
  /** 在书里的相对路径，只用来对上目录里的 href */
  path: string
}

export interface TocItem {
  label: string
  /** 绝对地址；可能带 `#锚点` */
  url: string
  /** 嵌套层级，0 起。目录里的缩进按它来 */
  depth: number
}

export interface Book {
  token: string
  /** 书的根地址，形如 `zhituan-book://<token>/`。判断「这个链接是不是书里的」用它 */
  base: string
  /** 元数据里的书名。读不到就给空串，界面上不显示 */
  title: string
  chapters: Chapter[]
  toc: TocItem[]
}

export interface LoadedChapter {
  /**
   * 书里那个 body 元素**本身**。
   *
   * 不是它的子节点，也不是一个包着它们的 div——理由见文件头第二条实测：
   * 书的 `body { }` 规则命中它，换成别的容器就命中不上。
   */
  body: HTMLElement
  /** 书自己的样式表，地址已改成绝对 */
  styles: HTMLLinkElement[]
}

const XML_MEDIA = /xhtml|html/i

/** 书的根地址 */
function baseOf(token: string): string {
  return `${BOOK_SCHEME}://${token}/`
}

/** 一段文本里的相对地址 → 绝对地址。已经是绝对的（http:、data:、#锚点）原样返回 */
function absolutize(value: string, from: string): string {
  if (!value) return value
  if (value.startsWith('#')) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  try {
    return new URL(value, from).href
  } catch {
    return value
  }
}

/** 取一个条目。路径或绝对地址都收（绝对地址要跨协议判断，少数书里有） */
async function grab(token: string, target: string): Promise<string> {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(target)
    ? target
    : new URL(target, baseOf(token)).href
  const res = await fetch(url)
  if (!res.ok) throw new Error(`取不到 ${target}（${res.status} ${res.statusText}）`)
  return res.text()
}

/**
 * 按 XML 解析。
 *
 * container.xml / OPF / NCX 这三份都**必须**走 XML：拿 HTML 解析器去读的话，
 * `<item a="1"/><item b="2"/>` 会被当成「item 开着没关」，后一个变成前一个的子元素
 * ——`querySelectorAll('item')` 于是只回一条，spine 与 manifest 当场全错。
 * 反过来章节正文走 HTML（宽松），这是两件事，不能混。
 */
function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error(`${what} 不是良构的 XML，读不了`)
  return doc
}

/** 打开一本书：把它的章次表与目录取全 */
export async function openBook(token: string): Promise<Book> {
  const base = baseOf(token)

  /*
   * 第一步是容器文件。它是一份固定的、只回答一个问题（OPF 在哪儿）的小文件，
   * 因此不猜路径——猜 `OEBPS/content.opf` 猜错的概率不低（也有书放在根目录的）。
   */
  const container = parseXml(await grab(token, 'META-INF/container.xml'), '容器文件')
  const rootfile = container.querySelector('rootfile')
  const opfPath = rootfile?.getAttribute('full-path')
  if (!opfPath) throw new Error('这本 EPUB 的容器文件里没有写 OPF 在哪')
  const opfUrl = new URL(opfPath, base).href

  const opf = parseXml(await grab(token, opfUrl), 'OPF')

  /*
   * 书名。`dc:title` 带命名空间前缀，而 CSS 的类型选择器在不声明默认命名空间时
   * 是「匹配任何命名空间」的，所以这里直接按标签名取就够。
   */
  const title = (opf.querySelector('title')?.textContent ?? '').trim()

  /* manifest：id → 条目。spine 里只有 idref，得靠它翻回 href */
  interface Item {
    href: string
    mediaType: string
    properties: string
  }
  const manifest = new Map<string, Item>()
  for (const el of opf.querySelectorAll('item')) {
    const id = el.getAttribute('id')
    const href = el.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      href,
      mediaType: el.getAttribute('media-type') ?? '',
      properties: el.getAttribute('properties') ?? ''
    })
  }
  if (manifest.size === 0) throw new Error('这本 EPUB 的 OPF 里没有 manifest')

  /* spine：读的顺序。`linear="no"` 是附录那一类，不进正读序列 */
  const chapters: Chapter[] = []
  const spine = opf.querySelector('spine')
  for (const ref of opf.querySelectorAll('itemref')) {
    if ((ref.getAttribute('linear') ?? 'yes').toLowerCase() === 'no') continue
    const idref = ref.getAttribute('idref')
    const item = idref ? manifest.get(idref) : null
    if (!item) continue
    // 兜底再按媒体类型滤一道：有的书会把封面图也挂进 spine
    if (item.mediaType && !XML_MEDIA.test(item.mediaType)) continue
    const url = new URL(item.href, opfUrl).href
    chapters.push({ id: idref ?? item.href, url, path: item.href })
  }
  if (chapters.length === 0) throw new Error('这本 EPUB 的 spine 里没有可读的章节')

  const toc = await readToc({ token, opfUrl, spine, manifest, chapters })

  return { token, base, title, chapters, toc }
}

/**
 * 目录。
 *
 * 两套格式都要认：EPUB 3 是 manifest 里 `properties` 含 `nav` 的那一份 XHTML，
 * EPUB 2 是 spine 的 `toc` 属性指向的 NCX。老书只有后者，新书常常两者都有。
 * 两个都读不到（真见过）就退回「按章次生成」，宁可有目录，也别给一个空面板。
 */
async function readToc(input: {
  token: string
  opfUrl: string
  spine: Element | null
  manifest: Map<string, { href: string; mediaType: string; properties: string }>
  chapters: Chapter[]
}): Promise<TocItem[]> {
  const { token, opfUrl, spine, manifest, chapters } = input

  /* EPUB 3：nav */
  for (const item of manifest.values()) {
    if (!/(^|\s)nav(\s|$)/.test(item.properties)) continue
    try {
      const navUrl = new URL(item.href, opfUrl).href
      const doc = new DOMParser().parseFromString(await grab(token, navUrl), 'text/html')
      const navs = [...doc.querySelectorAll('nav')]
      const target = navs.find((n) => (n.getAttribute('epub:type') ?? '').includes('toc')) ?? navs[0]
      const items: TocItem[] = []
      if (target) {
        for (const a of target.querySelectorAll('a[href]')) {
          const label = (a.textContent ?? '').trim()
          if (!label) continue
          items.push({ label, url: absolutize(a.getAttribute('href') ?? '', navUrl), depth: depthOf(a, target) })
        }
      }
      if (items.length) return items
    } catch {
      // 这一份读不出来就往下走，还有 NCX 那条路
    }
  }

  /* EPUB 2：NCX */
  const ncxId = spine?.getAttribute('toc')
  const ncx = ncxId ? manifest.get(ncxId) : null
  if (ncx) {
    try {
      const ncxUrl = new URL(ncx.href, opfUrl).href
      const doc = parseXml(await grab(token, ncxUrl), 'NCX')
      const items: TocItem[] = []
      for (const point of doc.querySelectorAll('navPoint')) {
        const label = (point.querySelector('text')?.textContent ?? '').trim()
        const src = point.querySelector('content')?.getAttribute('src')
        if (!label || !src) continue
        items.push({ label, url: absolutize(src, ncxUrl), depth: depthOf(point, doc) })
      }
      if (items.length) return items
    } catch {
      // 同样往下走
    }
  }

  /* 什么都没有：按章次生成一个有页码的目录，比空面板强 */
  return chapters.map((c, i) => ({ label: `第 ${i + 1} 节`, url: c.url, depth: 0 }))
}

/** 数一个节点上面有几层同名祖先，用作目录的缩进层级 */
function depthOf(node: Element, root: Document | Element): number {
  let depth = 0
  let at: Element | null = node.parentElement
  while (at && at !== root && at !== (root as Document).documentElement) {
    if (at.tagName.toLowerCase() === 'ol' || at.tagName.toLowerCase() === 'navpoint') depth++
    at = at.parentElement
  }
  return Math.min(depth, 4)
}

/**
 * 取一章，清洗干净，把地址改成绝对。
 *
 * ## 为什么必须清洗
 *
 * EPUB 里塞脚本是**合法**的，而这一页会把书的内容放进 DOM。三道闸各自独立：
 * 这里的清洗、book.html 的 CSP（script-src 里没有 `zhituan-book:`）、以及
 * bookReader 的 MIME 表里不列 `.js`。多留两道不是因为不信第一道，而是因为
 * 「书的正文进 DOM」这件事一旦漏一次就是任人执行。
 *
 * 只删不报：书里有没有脚本这件事对读者毫无意义，对着一张「已拦下 3 个脚本」的
 * 提示反而要多想一层。
 */
export async function loadChapter(url: string): Promise<LoadedChapter> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`取不到这一章（${res.status} ${res.statusText}）`)
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')

  // 能自己再开一层文档或执行代码的东西，一律不留
  for (const el of doc.querySelectorAll('script, iframe, frame, object, embed, noscript')) el.remove()

  // <base> 会把我们自己的相对地址也带走，<link> 除了样式表都只是拖慢加载
  for (const el of doc.querySelectorAll('base, meta')) el.remove()
  for (const el of doc.querySelectorAll('link')) {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    if (!rel.split(/\s+/).includes('stylesheet')) el.remove()
  }

  // on* 事件属性：innerHTML / importNode 都不会执行 <script>，但 onerror= 这类会
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
    }
  }

  /*
   * 地址改写。**这一步不能省**：章节插进我们自己的文档之后，相对路径的基准是
   * `book.html`。`#锚点` 留着不动（它在同一份文档内跳转）。
   */
  for (const el of doc.querySelectorAll('[src], [href], [poster]')) {
    for (const name of ['src', 'href', 'poster']) {
      const value = el.getAttribute(name)
      if (!value) continue
      if (name === 'href' && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(name)
        continue
      }
      el.setAttribute(name, absolutize(value, url))
    }
  }

  const styles = [...doc.querySelectorAll('link[rel~="stylesheet" i]')] as HTMLLinkElement[]

  /*
   * 书里那个 body 元素本身就是容器（见文件头第 2 条实测）。
   * 取不到 body（书里写得极简）时造一个空的——后面照常注入，只是没有内容。
   */
  const body = doc.body ?? doc.createElement('body')

  return { body, styles }
}
