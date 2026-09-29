<script setup lang="ts">
/**
 * 本机 EPUB 的阅读页：**章节注入 Shadow DOM，纸归我们画**。
 *
 * ## 为什么不是把整本书交给一个现成的引擎
 *
 * epub.js 与 foliate-js 都是把章节渲染进一个 iframe。那与本程序的核心做法冲突：
 * 主进程的注入只到主框架，够不进 iframe，于是「拉一条透明度滑块，纸跟着淡」
 * 这件事就得另起一套。而这一页要的是与 PDF 那一页同一句话：**纸是我们的，
 * 字是实心的**。因此章节进我们自己的文档，布局与纸都归我们。
 *
 * 代价是书的 CSS 真的会生效（PDF 那边只有一张 canvas，书里的东西到不了界面层），
 * 所以隔离靠 Shadow DOM：书的样式出不来，我们外面的样式也进不去。
 *
 * ## 三条实测出来的做法（spike/book-page.js）
 *
 *   1. **容器用书自己的那个 `body` 元素。** 书里最常写的第一条规则就是
 *      `body { margin-top: … }`，它按标签名匹配；实测 `createElement('body')` 摆进
 *      Shadow DOM 之后照样命中（读回来就是 48px），换成 div 就只剩 UA 的默认值。
 *      于是一整类选择器都不必改写。
 *   2. **纸压在字的下面，不是给字加 opacity。** 纸全透一档量到全程透明占比 0.98
 *      （Q63 是 0.97），纸 0.5 时平均 alpha 129，而**不透明像素占比一次都没变**
 *      （0.0055 → 0.0055）——字确实没跟着淡。
 *   3. **书任何一处链接都不许让这一页导航走。** 点一下脚注，若任它跳过去，我们的
 *      阅读页就被换成一份裸的章节文档，纸与浮层全没了。见 onClick。
 *
 * ## 阅读透明度这一条与另外两页的关系
 *
 * 取的是 **1 − 值**，与 PdfApp 完全一致：100% = 纸全透（默认，老配置一个数都不用
 * 迁），0% = 一张白纸垫在字下面。三页（TXT / PDF / EPUB）因此落在同一个语义上：
 * **滑块淡的是纸，不是字。**
 *
 * ## 另外两组东西，各有一条自己的规矩
 *
 *   · **排版三项**（字号 / 行距 / 左右留白，右下角那颗「Aa」）落在书的样式表**之后**，
 *     并且带 `!important`——书里动不动就写死 `body { font-size: 20px }`，而用户拉一下
 *     字号就该看见字变了，被书锁住会让控件看起来是坏的。同一处还写了为什么
 *     **不动上下留白、也不动 margin**（那是书的版式）。
 *   · **续读**（读到哪一章、章内的百分之几）由主进程写成地址里的两个参数带进来，
 *     翻页与停滚时再凭 token 报回去。用**比例**而不是像素：排版一变（用户拉字号、
 *     窗口换个宽度），同一段的像素高度就不同，记下的像素值会落在半页之外。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_LINE,
  DEFAULT_READER_MARGIN
} from '@shared/constants'
import { loadChapter, openBook, type Book, type TocItem } from './epub'
import TypesetPanel from '../reader/TypesetPanel.vue'
import { useConfig } from '../composables/useConfig'

/** 浮动读数静这么久就自己退开 */
const HUD_IDLE_MS = 2600
/** 滚轮攒到这个量才翻章：鼠标一格是 100，触控板一次滑动是几十 */
const WHEEL_STEP = 120
/** 翻章的最小间隔。一次滑动会连发几十个 wheel 事件，不隔开就会连翻好几章 */
const WHEEL_COOLDOWN_MS = 320
/** 方向键一次滚多少像素 */
const LINE_STEP = 90
/** 翻页键一次滚掉正文区高度的比例。留一成让上一行还在，读起来不会跳丢 */
const PAGE_STEP = 0.9

/**
 * 我们给的一组阅读默认值。
 *
 * 位置很要紧：它排在书的样式表**之前**，于是书自己写了什么就以书为准（同分量、
 * 靠后的赢），只在书没说的地方兜底。`--zhituan-*` 这些自定义属性是从宿主元素
 * 继承进来的——自定义属性是可继承属性，继承**穿得过** shadow 边界，因此这一层
 * 读得到主题，而书的样式读不到。
 */
const DEFAULTS = `
:host { display: block; }
body {
  margin: 0;
  padding: 2.4em 6% 4em;
  font-family: var(--zhituan-font);
  font-size: 17px;
  line-height: 1.85;
  color: var(--zhituan-text);
  overflow-wrap: break-word;
  word-wrap: break-word;
  text-align: justify;
}
img, svg, video, table, pre { max-width: 100%; }
img, svg, video { height: auto; }
pre { white-space: pre-wrap; overflow-wrap: break-word; }
table { border-collapse: collapse; }
a { color: var(--zhituan-accent); }
`

/**
 * 用户调的那三项排版（字号 / 行距 / 左右留白）。
 *
 * **位置与 `!important` 都是必需的**，两者缺一就压不住书：
 *
 *   · 书里动不动就是 `body { font-size: 20px; line-height: 1.2 }`（Q66 那份样本里
 *     就有）。这一层排在书的样式表**之后**，同分量时后来者胜；
 *   · 而书里写 `!important` 的也不是没有，所以这三条自己也带 `!important`。
 *
 * 值从 `--zhituan-reader-*` 继承进来（自定义属性穿得过 shadow 边界，见文件头），
 * 于是拉一下滑块这一页当场重排，不必重新注入样式表、也不必重新加载这一章。
 *
 * **`var()` 里那个兜底值不是装饰**：取不到值的自定义属性会让整条声明作废
 * （invalid at computed-value time），而这几条带 `!important`——于是它连书里
 * 写死的 `font-size: 20px` 一起压掉，正文最后退回 UA 的 16px / `normal`。
 * 配置到达之前正好是这种情况（`config` 是异步取回来的，见 onMounted）。
 * 兜底值直接引 constants 里那三个默认值，与配置那一边同源。
 *
 * **只管左右留白，不动上下，也不动 margin。** 上下那两段留白是书自己的版式
 * （标题页、诗歌、封面都靠它），收掉会毁掉那些页；而 `body { margin-top: 48px }`
 * 正是书的选择器命中这一层的证据（见文件头第 1 条），它没有理由被我们归零。
 */
const READER = `
body {
  font-size: var(--zhituan-reader-size, ${DEFAULT_READER_FONT}px) !important;
  line-height: var(--zhituan-reader-leading, ${DEFAULT_READER_LINE}) !important;
  padding-left: var(--zhituan-reader-margin, ${DEFAULT_READER_MARGIN}%) !important;
  padding-right: var(--zhituan-reader-margin, ${DEFAULT_READER_MARGIN}%) !important;
}
`

/**
 * 把书自己的那张纸收掉。
 *
 * 必须排在书的样式表**之后**：书的正文动不动就写 `body { background: #fff }`，
 * 同分量时后来者胜，而 `!important` 更是压得住书里任何一条普通规则。
 *
 * 这一条**是有意做粗的**：书在 body 上铺的底纹、护眼色调、仿古纸一律收掉，因为纸
 * 归我们画——那条滑块要能管得住眼前这张纸，它就不能有一半是书说了算。书给内层
 * 元素（引用块、代码块）上的底色仍然留着，那本来就该在。
 */
const CLEAR = `
body { background-color: transparent !important; background-image: none !important; }
`

const status = ref<'loading' | 'ready' | 'error'>('loading')
const note = ref('正在打开这本书…')
const book = shallowRef<Book | null>(null)
const index = ref(0)
const tocOpen = ref(false)
/** 排版面板开着没有。与目录同一规矩：开着就别把浮层淡掉 */
const typesetOpen = ref(false)
const hudOn = ref(true)

const stage = ref<HTMLDivElement | null>(null)
const sheet = ref<HTMLDivElement | null>(null)

/** 章节各自的 Shadow DOM 挂在同一个宿主上，这里只 attach 一次 */
let shadow: ShadowRoot | null = null
/** 每次切章 +1。切得快时，前一次的结果到了就丢掉，避免两章互相覆盖 */
let shownToken = 0
let wheelAcc = 0
let lastTurn = 0
let hudTimer: number | null = null
let baseDpr = 0
let dprQuery: MediaQueryList | null = null
/**
 * 用户自己动过没有（滚过、按过键）。
 *
 * 续读那三次补正（applyRatio）里最晚的一次在 240ms 之后，而那时用户可能已经
 * 开始往下读了——把他拉回原处比不恢复更难受。于是动过就一次都不再补。
 */
let userMoved = false
/** 位置上报的去抖计时器 */
let reportTimer: number | null = null

const { config } = useConfig()

/**
 * 主进程给的起点：上次读到哪儿。
 *
 * 它随地址一起来（`book.html?doc=…&at=<章>&ratio=<比例>`，见 services/bookReader.ts），
 * 于是打开的那一刻就是对的姿势——先排第一章再跳过去，等于当着用户的面闪一下。
 * 没有记录时两个参数都不在，于是「第一次读这本书」与「读过的书」走同一条路。
 */
const startAt = (() => {
  const q = new URLSearchParams(window.location.search)
  const ratio = Number(q.get('ratio') ?? '')
  return { chapter: q.get('at') ?? '', ratio: Number.isFinite(ratio) ? ratio : 0 }
})()

/**
 * 垫在字下面那张纸的不透明度（配置里的 ui.readerOpacity，右栏第三条滑块）。
 * 取 1 − 值，与 PdfApp 同一条语义，理由见文件头。
 */
const paperAlpha = computed(() => {
  const v = config.value?.ui.readerOpacity ?? 1
  return Math.min(1, Math.max(0, 1 - v))
})

/**
 * 纸的颜色：主题层里「面」的三通道（`--zhituan-surface-rgb`）。
 * 读它而不是把 255, 255, 255 抄在这里——配色唯一的真相仍在主题层。
 */
const paperRgb = (() => {
  const parts = getComputedStyle(document.documentElement)
    .getPropertyValue('--zhituan-surface-rgb')
    .trim()
    .split(/\s+/)
    .map(Number)
  return parts.length === 3 && parts.every(Number.isFinite) ? parts.join(', ') : '255, 255, 255'
})()

const paperStyle = computed(() => `rgba(${paperRgb}, ${paperAlpha.value.toFixed(3)})`)

const total = computed(() => book.value?.chapters.length ?? 0)

/** 去掉 `#锚点`。比较「这是不是同一章」时要用它 */
const stripHash = (url: string): string => url.split('#')[0]

/** 当前这一章的目录标题。目录里对不上就退回序号 */
const currentLabel = computed(() => {
  const b = book.value
  if (!b) return ''
  const target = stripHash(b.chapters[index.value]?.url ?? '')
  return b.toc.find((t) => stripHash(t.url) === target)?.label ?? `第 ${index.value + 1} 节`
})

function style(css: string): HTMLStyleElement {
  const el = document.createElement('style')
  el.textContent = css
  return el
}

function fail(err: unknown): void {
  note.value = `打不开这本书：${err instanceof Error ? err.message : String(err)}`
  status.value = 'error'
  console.error('[book]', err)
}

/** 跳到当前文档里的一个锚点（脚注、目录里的页内跳转都走它） */
function jumpTo(hash: string): void {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id || !shadow) return
  let target: Element | null = shadow.getElementById(id)
  if (!target) {
    for (const el of shadow.querySelectorAll('[id], [name]')) {
      if (el.getAttribute('id') === id || el.getAttribute('name') === id) {
        target = el
        break
      }
    }
  }
  if (target) (target as HTMLElement).scrollIntoView({ block: 'start' })
}

/**
 * 把第 at 章排出来。
 *
 * 顺序不能动：默认值 → 书的样式表 → 收纸 → 正文。前三条是层叠顺序，最后一条
 * 是那个 `body` 元素（见文件头第 1 条）。
 */
async function show(at: number, hash = '', restoreRatio = 0): Promise<void> {
  const b = book.value
  const host = sheet.value
  if (!b || !host) return

  const next = Math.min(Math.max(0, at), b.chapters.length - 1)
  const mine = ++shownToken
  index.value = next
  status.value = 'loading'
  note.value = '正在排版…'

  let loaded: Awaited<ReturnType<typeof loadChapter>>
  try {
    loaded = await loadChapter(b.chapters[next].url)
  } catch (err) {
    if (mine === shownToken) fail(err)
    return
  }
  // 等这一章回来的路上用户又翻了页：这一次的结果丢掉
  if (mine !== shownToken) return

  shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  shadow.replaceChildren(
    style(DEFAULTS),
    ...loaded.styles.map((l) => document.importNode(l, true)),
    style(READER),
    style(CLEAR),
    document.importNode(loaded.body, true)
  )

  if (stage.value) stage.value.scrollTop = 0
  status.value = 'ready'
  if (hash) jumpTo(hash)
  // 续读：落在「上次读到这里」的位置，而不是这一章的开头
  else if (restoreRatio > 0) applyRatio(restoreRatio)
  reportNow()
}

/**
 * 按比例把正文滚到章内某个位置。
 *
 * 用**比例**而不是像素：排版一变（用户拉字号、窗口换个宽度），同一段的像素高度
 * 就不同，记下的像素值会落在半页之外。而重排是**异步**的——书里那些图要等它加载
 * 完高度才定下来，于是这里补两次：先立刻放一次（字体与样式就位就够准），
 * 下一帧再一次（图还没到时算出来的 max 偏小），240ms 后再兜一次。
 *
 * 三次都只在**用户还没自己动过**时才动（`userMoved`）：晚到的那一次若把正在读
 * 的人拉走，比不恢复更难受。
 */
function applyRatio(ratio: number): void {
  const box = stage.value
  if (!box || ratio <= 0) return
  const put = (): void => {
    if (userMoved) return
    const max = box.scrollHeight - box.clientHeight
    if (max > 0) box.scrollTop = Math.round(max * Math.min(1, ratio))
  }
  put()
  requestAnimationFrame(put)
  window.setTimeout(put, 240)
}

/** 报一次当前位置。翻章、停滚、离开这一页时各一次 */
function reportNow(): void {
  const b = book.value
  const box = stage.value
  if (!b || !box || status.value !== 'ready') return
  const chapter = b.chapters[index.value]?.path
  if (!chapter) return
  const max = box.scrollHeight - box.clientHeight
  const ratio = max > 0 ? Math.min(1, Math.max(0, box.scrollTop / max)) : 0
  window.zhituan.book.remember({ token: b.token, chapter, ratio })
}

/**
 * 滚动时不必每像素都报：一次滚动会发几十个事件，而这份账的价值只在「下次打开」
 * 时兑现一次。于是等它停下来再报——600ms 是「手停下来左顾右盼」与「还在滚」
 * 之间的那一条线。
 */
function reportSoon(): void {
  if (reportTimer !== null) window.clearTimeout(reportTimer)
  reportTimer = window.setTimeout(() => {
    reportTimer = null
    reportNow()
  }, 600)
}

/**
 * 把三项排版交给 Shadow DOM 里的正文。
 *
 * 写在 `:root` 上：自定义属性是可继承属性，而从 `html` 一路继承到阴影里的 body
 * 正是这条路（`--zhituan-zoom`、`--zhituan-surface-rgb` 走的也是它）。于是配置一变
 * 只需改三个变量，书页当场重排——不必重新注入样式表，也不必重新加载这一章。
 */
function applyTypeset(): void {
  const ui = config.value?.ui
  if (!ui) return
  const root = document.documentElement.style
  root.setProperty('--zhituan-reader-size', `${ui.readerFontSize}px`)
  root.setProperty('--zhituan-reader-leading', String(ui.readerLineHeight))
  root.setProperty('--zhituan-reader-margin', `${ui.readerMargin}%`)
}

/** 面板与目录一样，开着就别把浮层淡掉（不然拖到一半控件跑了） */
function toggleTypeset(event: MouseEvent): void {
  typesetOpen.value = !typesetOpen.value
  if (typesetOpen.value) tocOpen.value = false
  bumpHud()
  ;(event.currentTarget as HTMLElement | null)?.blur()
}

/** 翻章。到两头就不动——不像 PDF 那样回绕，读到末尾是个交代 */
function turn(delta: number): void {
  const b = book.value
  if (!b) return
  const next = index.value + delta
  if (next < 0 || next >= b.chapters.length) return
  void show(next)
}

/** 滚这一页。返回「滚动了没有」——没滚动就说明到边了 */
function scrollPage(dy: number): boolean {
  const box = stage.value
  if (!box) return false
  const before = box.scrollTop
  box.scrollTop = before + dy
  return Math.abs(box.scrollTop - before) > 1
}

/** 滚轮：能滚就滚，滚到头才翻章。与 PDF 那一页同一套手感 */
function onWheel(event: WheelEvent): void {
  bumpHud()
  // 用户开始自己往下读了：续读那几次补正从此不再生效（见 applyRatio）
  userMoved = true
  tocOpen.value = false
  const box = stage.value
  if (status.value !== 'ready' || !box) return
  if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

  const down = event.deltaY > 0
  const atTop = box.scrollTop <= 1
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1
  if (down ? !atBottom : !atTop) {
    wheelAcc = 0
    return
  }

  event.preventDefault()
  const now = performance.now()
  if (now - lastTurn < WHEEL_COOLDOWN_MS) return
  wheelAcc += event.deltaY
  if (Math.abs(wheelAcc) < WHEEL_STEP) return
  const dir = wheelAcc > 0 ? 1 : -1
  wheelAcc = 0
  lastTurn = now
  turn(dir)
}

function onKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (status.value !== 'ready') return
  bumpHud()
  userMoved = true

  const step = Math.max(LINE_STEP * 3, Math.round((stage.value?.clientHeight ?? 600) * PAGE_STEP))
  switch (event.key) {
    case 'ArrowDown':
      if (!scrollPage(lineStep())) turn(1)
      break
    case 'ArrowUp':
      if (!scrollPage(-lineStep())) turn(-1)
      break
    case 'PageDown':
      if (!scrollPage(step)) turn(1)
      break
    case 'PageUp':
      if (!scrollPage(-step)) turn(-1)
      break
    case ' ':
      if (!scrollPage(event.shiftKey ? -step : step)) turn(event.shiftKey ? -1 : 1)
      break
    case 'ArrowRight':
      turn(1)
      break
    case 'ArrowLeft':
      turn(-1)
      break
    case 'Home':
      if (stage.value) stage.value.scrollTop = 0
      break
    case 'End':
      // 走到最后一章。用 show 而不是 turn：turn 到不了头就什么也不做
      void show(total.value - 1)
      break
    case 'Escape':
      tocOpen.value = false
      typesetOpen.value = false
      return
    default:
      return
  }
  tocOpen.value = false
  event.preventDefault()
}

/**
 * 方向键一次滚一行。
 *
 * 用**当前的行高**而不是写死一个像素值：书的行距是它自己定的（我们那份默认值也
 * 只是兜底），写死的话读行距大的书时，一下方向键只挪了半行，看起来像没动。
 */
function lineStep(): number {
  const line = parseFloat(
    shadow ? getComputedStyle(shadow.querySelector('body') ?? document.body).lineHeight : ''
  )
  if (Number.isFinite(line) && line > 4) return line * 3
  return LINE_STEP
}

function bumpHud(): void {
  hudOn.value = true
  if (hudTimer !== null) window.clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => {
    hudTimer = null
    hudOn.value = false
  }, HUD_IDLE_MS)
}

function toggleToc(event: MouseEvent): void {
  tocOpen.value = !tocOpen.value
  // 两块面板都盖在正文上，同时开着只会互相压住——开一个就收另一个
  if (tocOpen.value) typesetOpen.value = false
  bumpHud()
  ;(event.currentTarget as HTMLElement | null)?.blur()
}

/** 目录里点一条：跳到它指的那一章（可能还带一个页内锚点） */
function goTo(item: TocItem): void {
  const b = book.value
  if (!b) return
  const target = stripHash(item.url)
  const at = b.chapters.findIndex((c) => stripHash(c.url) === target)
  if (at < 0) return
  tocOpen.value = false
  const cut = item.url.indexOf('#')
  void show(at, cut >= 0 ? item.url.slice(cut) : '')
}

/**
 * 书里的链接一律拦下来。
 *
 * 头一条理由不是安全，是**这一页不能被换掉**：书里一个指向下一章的 `<a>`，若任它
 * 跳过去，Chromium 就把我们的阅读页整份换成那份裸的章节文档——纸、透明度、浮层
 * 全没了，而且地址栏对外那个本机文件也被盖成了内部地址。所以先 preventDefault，
 * 书内的自己接（找得到是哪一章就翻过去），书外的一律不动：这一页没有地址栏，
 * 也不该替用户开新标签。
 */
function onClick(event: MouseEvent): void {
  const b = book.value
  if (!b) return
  const link = event.composedPath().find((n) => (n as Element).nodeName === 'A') as
    | HTMLAnchorElement
    | undefined
  if (!link) return

  event.preventDefault()
  const href = link.getAttribute('href') ?? ''
  if (!href) return
  if (href.startsWith('#')) {
    jumpTo(href)
    return
  }

  let abs: string
  try {
    abs = new URL(href, b.chapters[index.value].url).href
  } catch {
    return
  }
  if (!abs.startsWith(b.base)) return

  const target = stripHash(abs)
  const at = b.chapters.findIndex((c) => stripHash(c.url) === target)
  if (at < 0) return
  const cut = abs.indexOf('#')
  void show(at, cut >= 0 ? abs.slice(cut) : '')
}

/**
 * 缩放是靠 devicePixelRatio 看出来的，而它变了不会发 resize 事件。
 * 与 PdfApp 同一套：拿一条「正好等于当前 dpr」的媒体查询听变化，每变一次再注册一条。
 */
function applyZoom(): void {
  const dpr = window.devicePixelRatio || 1
  if (!baseDpr) baseDpr = dpr
  document.documentElement.style.setProperty('--zhituan-zoom', String(dpr / baseDpr))
}

function onDprChange(): void {
  watchDpr()
  applyZoom()
}

function watchDpr(): void {
  dprQuery?.removeEventListener('change', onDprChange)
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprQuery.addEventListener('change', onDprChange)
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  sheet.value?.addEventListener('click', onClick)
  applyZoom()
  applyTypeset()
  /*
   * 配置一变就重排。听的是**配置广播**（useConfig 那份镜像）而不是面板本身——
   * 于是从别处改这三项，这一页也跟得上，与起始页换主题听的是同一条广播。
   * 只改三个自定义属性就够了：浏览器自己会把这一章重排一遍。
   */
  watch(
    () => [
      config.value?.ui.readerFontSize,
      config.value?.ui.readerLineHeight,
      config.value?.ui.readerMargin
    ],
    () => applyTypeset()
  )
  watchDpr()
  bumpHud()

  const token = new URLSearchParams(window.location.search).get('doc')
  if (!token) {
    fail(new Error('这个地址里没有带书（主进程没给 token）'))
    return
  }

  try {
    book.value = await openBook(token)
  } catch (err) {
    fail(err)
    return
  }

  /*
   * 从上次读的那一章开始。对上的是**书内路径**而不是章号：书换一版、序多一篇，
   * 章号会整体挪一格，路径不会（与 readingStore 里记的是同一个道理）。
   * 对不上（书换版本了、那条记录指向的章没了）就从第一章开始，不装作找到了。
   */
  const at = startAt.chapter
    ? Math.max(
        0,
        book.value.chapters.findIndex((c) => c.path === startAt.chapter)
      )
    : 0
  await show(at, '', startAt.ratio)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  sheet.value?.removeEventListener('click', onClick)
  dprQuery?.removeEventListener('change', onDprChange)
  if (hudTimer !== null) window.clearTimeout(hudTimer)
  // 走之前把最后那一次位置报出去：去抖那颗计时器等不到了
  if (reportTimer !== null) window.clearTimeout(reportTimer)
  reportTimer = null
  reportNow()
  shownToken++
})
</script>

<template>
  <div class="reader">
    <!--
      纸。它铺满整个视图、压在字的**下面**（不跟正文一起滚），透明度由右栏第三条
      滑块给。不给容器加 opacity：那会把字一起淡掉，而要淡的是纸。
    -->
    <div class="paper" :style="{ backgroundColor: paperStyle }" />

    <!-- 正文区。章节挂在 #sheet 这个宿主的 Shadow DOM 里，书自己的样式出不来 -->
    <div ref="stage" class="stage" @wheel="onWheel" @scroll="reportSoon">
      <div ref="sheet" class="sheet" />
    </div>

    <!-- 出错与进度都写在这一句里：这一页没有别的可说话的地方 -->
    <p v-if="status !== 'ready'" class="note">{{ note }}</p>

    <template v-else>
      <!-- 目录面板：盖在正文上，不从左边推栏（这一页的宽度就是窗口宽度） -->
      <nav v-if="tocOpen" class="toc">
        <button
          v-for="(item, i) in book?.toc ?? []"
          :key="i"
          class="toc__item"
          :class="{ on: stripHash(item.url) === stripHash(book?.chapters[index]?.url ?? '') }"
          :style="{ paddingLeft: `${8 + item.depth * 14}px` }"
          @click="goTo(item)"
        >
          {{ item.label }}
        </button>
        <p v-if="!book?.toc?.length" class="toc__empty">这本书里没有目录</p>
      </nav>

      <!--
        排版面板。三项都只作用在**正在读的这一页**上，所以它长在这一页里，
        而不是右栏：栏宽只够一排按钮，而这一组要三个滑块加三个读数。
        与目录同一规矩——盖在正文上、开着就不淡出（见 toggleTypeset）。
        面板本身与 TXT 那一页共用一份（see reader/TypesetPanel.vue）。
      -->
      <TypesetPanel v-if="typesetOpen" />

      <div class="hud" :class="{ off: !hudOn && !tocOpen && !typesetOpen }">
        <span class="hud__count">{{ currentLabel }} · {{ index + 1 }}/{{ total }}</span>
        <button
          class="hud__key"
          :class="{ on: typesetOpen }"
          title="排版：字号、行距、左右留白（Esc 收起）"
          @click="toggleTypeset"
        >
          Aa
        </button>
        <button class="hud__key" :class="{ on: tocOpen }" title="目录（Esc 收起）" @click="toggleToc">
          目录
        </button>
      </div>
    </template>
  </div>
</template>
