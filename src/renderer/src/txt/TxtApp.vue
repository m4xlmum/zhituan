<script setup lang="ts">
/**
 * 本机 TXT 的阅读页：**一份纯文本，我们自己切章、自己排。**
 *
 * ## 这一页在解决什么
 *
 * 1.6.8 之前，本机 TXT 是交给 Chromium 的文本查看器渲染的一张普通网页：整篇文档是
 * 一个巨大的 `pre`，**没有「章」这个概念**。于是「读到哪儿了」只能记整篇的百分之几，
 * 而整篇的百分之几在换一次字号、换一次窗口宽度之后就落回原处——一万个字的位置误差
 * 比不记还坏。这一页把那份文本切成章，位置落在**哪一章 + 章内多少**上，与 EPUB 那一页
 * 同一个语义（见 services/readingStore.ts）：排版怎么变，读的还是那一段。
 *
 * 顺带解掉的是 Q78 量的那个上限：一本 6.7MB 的小说按一整篇 `pre` 排出来，在最粗那档
 * 排版下离 Chromium 的排版上限只剩一倍余量；一次只排一章，那件事从此不必再算。
 * （**认不出章的文件整篇算一章**，那一条路与 1.6.8 一样重——而那就是它的本来面目，
 * 一份没有章可切的日志本来就该整篇排。）
 *
 * ## 三件事的分工
 *
 *   · **字节 → 字**：`decodeText`（@shared/txt.ts）。认编码的次序与为什么在渲染进程里
 *     认，都写在那一份文件头里。
 *   · **字 → 章**：`splitChapters`。判据与三道紧箍同样在那一份文件头，实测依据是
 *     Q84（用户那本 1438 章的小说）。
 *   · **章 → 屏幕**：就是这一页。一次只把**正在读的那一章**放进 DOM：`pre-wrap` 保住
 *     原文的换行与段首空格（见 styles/txt.css），翻章就是换一次 `slice`。
 *
 * ## 与 BookApp 逐条对齐的几处
 *
 *   · 续读的起点随地址一起来（`at=<章序>:<章名>&ratio=<比例>`），于是落地那一刻就是对的
 *     姿势，不会先闪一下第一章；
 *   · 位置用**比例**记而不是像素，理由是排版会变；
 *   · 续读那几次补正只在**用户还没自己动过**时生效（`userMoved`）；
 *   · 滚轮先滚、滚到头才翻章，方向键一次滚三行（行高按**当前**行距算，不是写死的）。
 *
 * 下面那几个常量与 BookApp 里那一组相同值——手感是同一套。抽成共享模块的时机是第三个
 * 页面出现时：两个页面还看不出哪一部分真的一样。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_LINE,
  DEFAULT_READER_MARGIN
} from '@shared/constants'
import {
  TXT_SCHEME,
  WHOLE_TITLE,
  chapterText,
  decodeText,
  formatMark,
  locateChapter,
  splitChapters,
  type TxtChapter
} from '@shared/txt'
import TypesetPanel from '../reader/TypesetPanel.vue'
import { useConfig } from '../composables/useConfig'

/** 浮动读数静这么久就自己退开 */
const HUD_IDLE_MS = 2600
/** 滚轮攒到这个量才翻章：鼠标一格是 100，触控板一次滑动是几十 */
const WHEEL_STEP = 120
/** 翻章的最小间隔。一次滑动会连发几十个 wheel 事件，不隔开就会连翻好几章 */
const WHEEL_COOLDOWN_MS = 320
/** 方向键一次滚多少像素（量不到行高时的兜底值） */
const LINE_STEP = 90
/** 翻页键一次滚掉正文区高度的比例。留一成让上一行还在，读起来不会跳丢 */
const PAGE_STEP = 0.9

const status = ref<'loading' | 'ready' | 'error'>('loading')
const note = ref('正在打开这一份文件…')
/** 整篇文本。6.7MB 也是它，因此用 shallowRef：一个字符串没有任何值得深层代理的东西 */
const text = shallowRef('')
/** 切出来的章。只有章序、章名与两个偏移，正文在 bodyText 里按需 slice */
const chapters = shallowRef<TxtChapter[]>([])
const index = ref(0)
const tocOpen = ref(false)
/** 排版面板开着没有。与目录同一规矩：开着就别把浮层淡掉 */
const typesetOpen = ref(false)
const hudOn = ref(true)

const stage = ref<HTMLDivElement | null>(null)
const bodyEl = ref<HTMLDivElement | null>(null)
const tocEl = ref<HTMLElement | null>(null)

let wheelAcc = 0
let lastTurn = 0
let hudTimer: number | null = null
let baseDpr = 0
let dprQuery: MediaQueryList | null = null
/**
 * 用户自己动过没有（滚过、按过键）。
 *
 * 续读那三次补正（applyRatio）里最晚的一次在 240ms 之后，而那时用户可能已经开始往下
 * 读了——把他拉回原处比不恢复更难受。于是动过就一次都不再补。
 */
let userMoved = false
/** 位置上报的去抖计时器 */
let reportTimer: number | null = null

const { config } = useConfig()

/**
 * 这一份文件的标识（主进程给的 token）。地址里是它，不是路径——**路径不出主进程**
 * （见 services/txtReader.ts）：取字节与报位置都要用它，因此只读一次地址。
 */
const docToken = new URLSearchParams(window.location.search).get('doc') ?? ''

/**
 * 主进程给的起点：上次读到哪儿。
 *
 * 与书页那一份逐条相同（见 services/txtReader.ts）：章是 `at=<章序>:<章名>`，比例是
 * `ratio=<章内比例>`。没有记录时两个参数都不在，于是「第一次读这一份」与「读过好几遍的」
 * 走同一条路。
 */
const startAt = (() => {
  const q = new URLSearchParams(window.location.search)
  const ratio = Number(q.get('ratio') ?? '')
  return { chapter: q.get('at') ?? '', ratio: Number.isFinite(ratio) ? ratio : 0 }
})()

/**
 * 垫在字下面那张纸的不透明度（配置里的 ui.readerOpacity）。
 * 取 1 − 值，与 PdfApp / BookApp 同一条语义：**滑块淡的是纸，不是字。**
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

const total = computed(() => chapters.value.length)
const current = computed(() => chapters.value[index.value] ?? null)
const currentTitle = computed(() => current.value?.title ?? '')

/**
 * 整篇一章吗（这份文件里一个章名都没有）。
 *
 * 那一个「全文」是我们编的名字，不是文件里的一行——于是**不把它当标题排出来**：
 * 一份没有章名的文件不该在开头凭空多出一行大字。目录里仍然有它，否则目录是空的。
 */
const wholeFile = computed(
  () => chapters.value.length === 1 && chapters.value[0].title === WHOLE_TITLE
)

/** 正在读的这一章。`slice` 一份新的字符串出来，与整篇文本不共用内存 */
const bodyText = computed(() => (current.value ? chapterText(text.value, current.value) : ''))

function fail(err: unknown): void {
  note.value = `打不开这一份文件：${err instanceof Error ? err.message : String(err)}`
  status.value = 'error'
  console.error('[txt]', err)
}

/**
 * 显示第 at 章。
 *
 * **不必等异步**：正文就在手里（text 是整篇），换章只是换一次 slice 与一次渲染。
 * 唯一要等的是 Vue 把 DOM 换掉——`nextTick` 之后才量得到这一章的高度，因此
 * 「归零 / 按比例落位 / 报一次位置」三件事都排在它后面。
 */
async function show(at: number, restoreRatio = 0): Promise<void> {
  const list = chapters.value
  if (!list.length) return
  index.value = Math.min(Math.max(0, at), list.length - 1)
  status.value = 'ready'
  await nextTick()

  const box = stage.value
  if (box) box.scrollTop = 0
  // 续读：落在「上次读到这里」的位置，而不是这一章的开头
  if (restoreRatio > 0) applyRatio(restoreRatio)
  reportNow()
}

/**
 * 按比例把正文滚到章内某个位置。
 *
 * 用**比例**而不是像素：排版一变（用户拉字号、窗口换个宽度），同一段的像素高度就不同，
 * 记下的像素值会落在半页之外。而重排是**异步**的——字体的度量要等一等，于是这里补两次：
 * 先立刻放一次，下一帧再一次，240ms 后再兜一次（长章那一万字的排版会跟着这次补正
 * 重新算一遍，晚到的那一次才准）。
 *
 * 三次都只在**用户还没自己动过**时才动（`userMoved`）。
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

/**
 * 报一次当前位置：哪一章 + 章内百分之几。
 *
 * 章那一串写成 `<章序>:<章名>`（@shared/txt 的 formatMark）：**章名对得上就按章名找**，
 * 这一份文件换了一版也一样找得到；对不上才退回章序。两样都写进去，「按哪个找」就不必猜。
 */
function reportNow(): void {
  const chapter = current.value
  const box = stage.value
  if (!chapter || !box || status.value !== 'ready') return
  const max = box.scrollHeight - box.clientHeight
  const ratio = max > 0 ? Math.min(1, Math.max(0, box.scrollTop / max)) : 0
  window.zhituan.book.remember({
    token: docToken,
    chapter: formatMark(chapter.index, chapter.title),
    ratio
  })
}

/**
 * 滚动时不必每像素都报：一次滚动会发几十个事件，而这份账的价值只在「下次打开」时兑现
 * 一次。于是等它停下来再报——600ms 是「手停下来左顾右盼」与「还在滚」之间的那一条线。
 */
function reportSoon(): void {
  if (reportTimer !== null) window.clearTimeout(reportTimer)
  reportTimer = window.setTimeout(() => {
    reportTimer = null
    reportNow()
  }, 600)
}

/**
 * 把三项排版交给正文。
 *
 * 写在 `:root` 上的自定义属性，styles/txt.css 里那两条规则直接引用它们（书页那一份走的是
 * 继承穿进 Shadow DOM 的路，见 BookApp）。于是配置一变只需改三个变量，这一章当场重排——
 * 不必重新解码，也不必重新渲染。
 *
 * 与书页**同源同值**：配置里只有一份字号（ui.readerFontSize / readerLineHeight /
 * readerMargin），两页读的是它。配置还没取回来时按 constants 里那三个默认值写一遍
 * （配置是异步的，而正文可能已经排好了），于是「默认值」这件事在本仓库仍只有一处。
 */
function applyTypeset(): void {
  const ui = config.value?.ui
  const root = document.documentElement.style
  root.setProperty('--zhituan-reader-size', `${ui?.readerFontSize ?? DEFAULT_READER_FONT}px`)
  root.setProperty('--zhituan-reader-leading', String(ui?.readerLineHeight ?? DEFAULT_READER_LINE))
  root.setProperty('--zhituan-reader-margin', `${ui?.readerMargin ?? DEFAULT_READER_MARGIN}%`)
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
  const next = index.value + delta
  if (next < 0 || next >= chapters.value.length) return
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

/** 滚轮：能滚就滚，滚到头才翻章。与另外两页同一套手感 */
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
 * 用**当前的行高**而不是写死一个像素值：行距是用户拉出来的（1.4 到 2.4 差着七成），
 * 写死的话行距拉大之后一下方向键只挪了半行，看起来像没动。行高的真相在正文那一层，
 * 于是量它（书页那一页量的是书里那个 body，同一个道理）。
 */
function lineStep(): number {
  const el = bodyEl.value
  const line = el ? parseFloat(getComputedStyle(el).lineHeight) : NaN
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
  if (tocOpen.value) {
    typesetOpen.value = false
    void scrollTocToCurrent()
  }
  bumpHud()
  ;(event.currentTarget as HTMLElement | null)?.blur()
}

/**
 * 把目录里正在读的那一条挪到眼前。
 *
 * 这一条对 TXT 比对书更要紧：一本小说一千四百多章是常事（Q84 那本 1438 章），
 * 目录一打开若永远从第一章开始，找「我在哪儿」就得自己滚半天。
 *
 * 不去用 `scrollIntoView`：它会把**所有**可滚的祖先一起动一遍，而这一页外面那个
 * `.stage` 绝对不能动（正文会跟着跳）。自己算一次 scrollTop，只动面板自己。
 */
async function scrollTocToCurrent(): Promise<void> {
  await nextTick()
  const panel = tocEl.value
  const on = panel?.querySelector<HTMLElement>('.toc__item.on')
  if (!panel || !on) return
  panel.scrollTop = Math.max(0, on.offsetTop - panel.clientHeight / 2 + on.offsetHeight / 2)
}

/** 目录里点一条：跳到那一章 */
function goTo(at: number): void {
  tocOpen.value = false
  void show(at)
}

/**
 * 缩放是靠 devicePixelRatio 看出来的，而它变了不会发 resize 事件。
 * 与另外两页同一套：拿一条「正好等于当前 dpr」的媒体查询听变化，每变一次再注册一条。
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
  applyZoom()
  applyTypeset()
  /*
   * 配置一变就重排。听的是**配置广播**（useConfig 那份镜像）而不是面板本身——
   * 于是从别处改这三项（顶栏那枚 Aa 开的正是同一组控件），这一页也跟得上。
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

  if (!docToken) {
    fail(new Error('这个地址里没有带文件（主进程没给 token）'))
    return
  }

  /*
   * 取回那份字节。地址里是 token 不是路径——**路径不出主进程**（见 txtReader.ts）。
   * 出错时那条协议给的是一句人话的响应体（「打不开这一份文件：…」），把它原样写出来，
   * 比自己编一句「读取失败」有用。
   */
  let decoded: ReturnType<typeof decodeText>
  try {
    const res = await fetch(`${TXT_SCHEME}://${docToken}/text`)
    if (!res.ok) throw new Error((await res.text()) || `读取失败（${res.status}）`)
    decoded = decodeText(new Uint8Array(await res.arrayBuffer()))
  } catch (err) {
    fail(err)
    return
  }

  /*
   * 认到的编码写进控制台。它不上界面（读者不关心），但「这本书打开是乱码」这类反馈
   * 头一句话就是问它——四档里猜错了哪一档，看这一行就知道。
   */
  console.info('[txt] 认到的编码：', decoded.encoding)

  if (!decoded.text.trim()) {
    fail(new Error('这一份文件是空的'))
    return
  }

  text.value = decoded.text
  chapters.value = splitChapters(decoded.text)
  console.info('[txt] 切出章数：', chapters.value.length)

  /*
   * 从上次读的那一章开始。先按章名找（这一份文件换了一版也还找得到），对不上才退回
   * 章序（这份账按本机路径记，路径没变，章序就仍然靠谱）；一样都对不上就是第一章
   * （见 @shared/txt 的 locateChapter）。
   */
  await show(locateChapter(chapters.value, startAt.chapter), startAt.ratio)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  dprQuery?.removeEventListener('change', onDprChange)
  if (hudTimer !== null) window.clearTimeout(hudTimer)
  // 走之前把最后那一次位置报出去：去抖那颗计时器等不到了
  if (reportTimer !== null) window.clearTimeout(reportTimer)
  reportTimer = null
  reportNow()
})
</script>

<template>
  <div class="reader txt">
    <!--
      纸。它铺满整个视图、压在字的**下面**（不跟正文一起滚），透明度由右栏第三条
      滑块给。不给容器加 opacity：那会把字一起淡掉，而要淡的是纸。
    -->
    <div class="paper" :style="{ backgroundColor: paperStyle }" />

    <!-- 正文区。一次只排一章 -->
    <div ref="stage" class="stage" @wheel="onWheel" @scroll="reportSoon">
      <!-- 章名那一行。整篇一章时（文件里没有章名）不排它，理由见 wholeFile -->
      <h1 v-if="status === 'ready' && !wholeFile" class="txt__head">{{ currentTitle }}</h1>
      <!--
        正文。**一个标签都不是别人给的**：这一句文本原样放进来，换行与段首那两个全角
        空格靠 styles/txt.css 的 `white-space: pre-wrap` 保住。
      -->
      <div v-if="status === 'ready'" ref="bodyEl" class="txt__body">{{ bodyText }}</div>
    </div>

    <!-- 出错与进度都写在这一句里：这一页没有别的可说话的地方 -->
    <p v-if="status !== 'ready'" class="note">{{ note }}</p>

    <template v-else>
      <!-- 目录面板：盖在正文上，不从左边推栏（这一页的宽度就是窗口宽度） -->
      <nav v-if="tocOpen" ref="tocEl" class="toc">
        <button
          v-for="c in chapters"
          :key="c.index"
          class="toc__item"
          :class="{ on: c.index === index }"
          @click="goTo(c.index)"
        >
          {{ c.title }}
        </button>
      </nav>

      <!--
        排版面板。三项都只作用在**这一章**上，所以它长在这一页里，而不是右栏：
        栏宽只够一排按钮，而这一组要三个滑块加三个读数。面板本身与书页共用一份
        （see reader/TypesetPanel.vue）。
      -->
      <TypesetPanel v-if="typesetOpen" />

      <div class="hud" :class="{ off: !hudOn && !tocOpen && !typesetOpen }">
        <!-- 章名可以很长，浮层是个胶囊：截断（styles/txt.css），悬停仍看得到全文 -->
        <span class="hud__count" :title="currentTitle">
          {{ currentTitle }} · {{ index + 1 }}/{{ total }}
        </span>
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
