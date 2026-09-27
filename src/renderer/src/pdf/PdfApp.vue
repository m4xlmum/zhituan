<script setup lang="ts">
/**
 * 本机 PDF 的阅读页：pdf.js 把每一页画进 canvas，键控把那一层纸收掉，
 * 只留下字；字的颜色取主题层里那一份基准的墨（近黑），**不跟主题换色**
 * ——这一页画的是内容，内容不该被界面的皮肤染上颜色（见下）。
 *
 * 为什么不是 Chromium 内置的那个阅读器：那一张纸是 PDFium 直接画在插件表面上的，
 * 注入的 CSS 与能算出 alpha 的 SVG 滤镜都落不到它头上（实测注入前后一个像素都不差，
 * 见 docs/spike-findings.md 的 Q51）。要「逐像素透明的窗口里只剩字」，只能自己画。
 *
 * ## 纸与字
 *
 * 键控把纸写成 alpha 0（桌面透得过纸）、字写成一份固定的近黑墨。纸并没有被扔掉
 * ——它作为**画布自己的底色**随时补得回来：右栏第三条滑块（阅读透明度）拉下去，
 * 一张白纸就垫到字下面（0% 纸全实，100% 纸全透，也就是原来那个样子）。
 * **字始终不跟着动**：要在一张花桌面上读得清，该给回来的是纸，不是把字抹淡。
 *
 * ## 阅读模型
 *
 * **一次一页**。页面宽度铺满正文区（fit-width），一页比正文区高时在页内上下滚，
 * 滚到头再滚就翻页。整本一次只留一张画布——不为相邻页留缓存、换深浅那一档就重画，
 * 内存因此是平的（一本一千页的书与一本十页的书占的一样多）。代价是翻页要等
 * 重新解析、重画、重新键控（实测一页 50–100ms），这是明写的取舍。
 *
 * 翻页与滚动的分工写在下面对应的函数里（onWheel / onKey），一句话：**能滚就滚，
 * 滚到头才翻**，于是滚轮与方向键在读长页时都还是「往下看」的意思。
 *
 * ## 缩放
 *
 * 走右栏那条缩放（它改的是这个视图的 zoomLevel）。Chromium 把 zoomLevel 实现成
 * devicePixelRatio 的变化（实测 zoomLevel 1 → dpr 从 1 变成 1.2000000476837158，
 * 同时 clientWidth 从 784 掉到 653）。因此这里的宽度写成 `clientWidth * z`，
 * 其中 `z = 现在的 dpr / 第一次画成时的 dpr`：CSS 像素上它回到未缩放时的宽度，
 * 设备像素上按 dpr 出图——放大之后字是重新排出来的，不是被拉大的。
 *
 * 一个必须说明的取舍：z 的分母是**第一次画成时**的 dpr，所以打开一本书时永远是
 * fit-width（哪怕右栏显示着 120%），第一次按 + 之后才开始真的放大。这与
 * 「一打开就先铺满宽度」是一致的：那一下说的是「我要看清这一页」，而不是
 * 「我要它比窗口宽」。
 *
 * ## 深浅
 *
 * 自动认纸的深浅（见 pdf/keying.ts），认错了可以在右下角那枚键上手动顶掉
 * ——自动 → 浅底 → 深底 循环。这一档**不落配置**：它说的是「我眼前这一页」，
 * 换一本书、重开一页就该重新自动判。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy
} from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker&inline'
import { useConfig } from '../composables/useConfig'
import { inkCanvas, inkFromCss, type Polarity } from './keying'

/**
 * pdf.js 运行时那四样资源（cMap、标准字体、wasm、色彩描述）的出处。
 *
 * 走主进程挂的那条 `zhituan-pdf://` 协议，而不是相对路径：这一页在 `file:` 下，
 * 而 `file:` 页面去 fetch 另一个 `file:` 是被挡死的（file 来源不透明，CORS 过不去）。
 * 协议与目录白名单见 src/main/services/pdfReader.ts。
 */
const ASSET = 'zhituan-pdf://asset/'

/** 右下角那条浮层：动一下出现，静一会儿自己退开 */
const HUD_IDLE_MS = 2600
/** 翻页键一次滚掉正文区高度的比例。留一成让上一行还在，读起来不会跳丢 */
const PAGE_STEP = 0.9
/** 滚轮攒到这个量才翻页：鼠标一格是 100，触控板一次滑动是几十 */
const WHEEL_STEP = 120
/** 翻页的最小间隔。一次滑动会连发几十个 wheel 事件，不隔开就会连翻好几页 */
const WHEEL_COOLDOWN_MS = 320
/** 方向键一次滚多少像素 */
const LINE_STEP = 90

/** 三档深浅。文案要说的是「纸在哪一边」，不是「我有多亮」 */
const POLARITIES: { value: Polarity; label: string; hint: string }[] = [
  {
    value: 'auto',
    label: '自动',
    hint: '纸的深浅由这一页自己说话：按整页的底色判。点一下换「浅底」'
  },
  {
    value: 'light',
    label: '浅底',
    hint: '当作白纸：只留深色的笔画（深底浅字的页面会整页变空）。点一下换「深底」'
  },
  {
    value: 'dark',
    label: '深底',
    hint: '当作黑纸：把浅色的笔画翻出来。点一下换回「自动」'
  }
]

const status = ref<'loading' | 'ready' | 'error'>('loading')
const note = ref('正在打开这本书…')
const pageNo = ref(1)
const pageCount = ref(0)
const polarity = ref<Polarity>('auto')
const hudOn = ref(true)

const stage = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
/**
 * 画布上下文。在 mounted 里就取好（那一处写了为什么要抢在前面），
 * 之后每一页都往同一个上下文里画。
 */
let ctx: CanvasRenderingContext2D | null = null

let doc: PDFDocumentProxy | null = null
/**
 * 装载任务。收摊时要关的是它，不是 doc——pdf.js 6 里 `destroy()` 长在任务上
 * （`PDFDocumentProxy` 上没有这个方法），销毁它连 worker 一起放掉。
 */
let loading: PDFDocumentLoadingTask | null = null
/** 上一次画成的那一页，换页时让它把算子表还回去（见 paintOnce 末尾） */
let lastPage: PDFPageProxy | null = null
/**
 * 第一次画成时的 devicePixelRatio，是缩放的零点（见文件头「缩放」一段）。
 * 0 表示还没画过。
 */
let baseDpr = 0
/** 每次重画 +1。画的过程中又来请求，就画完再照着最新的来一遍 */
let token = 0
let painting = false
/** 下一次画成之后落在页首还是页尾（往回翻要落在页尾，读起来才接得上） */
let edge: 'top' | 'bottom' = 'top'
/** 当前墨色，来自 --zhituan-ink。这一页不写主题，因此它是一份定值，画的时候直接取用 */
let inkColor: [number, number, number] = [231, 233, 238]

let wheelAcc = 0
let lastTurn = 0
let hudTimer: number | null = null
let resizer: ResizeObserver | null = null
let dprQuery: MediaQueryList | null = null

const { config } = useConfig()

/**
 * 垫在字下面那张纸的不透明度（配置里的 ui.readerOpacity，右栏第三条滑块）。
 *
 * 这一条量的是**纸的透明度**：100% = 纸全透（桌面直接透过来，也是这一版之前
 * 一直的样子，纸被键控写成 alpha 0 之后没有任何东西补回来），0% = 纸全实
 * （一张白纸垫在字下面）。因此它取的正好是 **1 − 值**：默认那个 1 对应
 * 「纸全透」，与 TXT 那一页「值 1 就是不淡」落在同一个点上，老配置一个数
 * 都不用迁（见 @shared/constants 的 READER_OPACITY_MIN）。
 *
 * **字不跟着动**。这一页的墨是键控一笔一笔写死的（纸写 alpha 0、墨写 1），
 * 纸只是作为画布的 CSS 底色补回来，于是滑块拖到底，字仍是那个近黑的实心
 * `#15181d`。1.5.0 那条「拖下去整本书的字一起淡」是瞄错了对象：要在一张花
 * 桌面上读得清，该给回来的是纸，不是把字抹淡。
 *
 * 用 CSS 底色，不把 alpha 乘进键控那一趟：键控要读回像素、把整页重算一遍
 * （实测一页 50–100ms），而滑块每一格都得跟手。CSS 底色由合成器做，
 * 一个像素都不改——**所以画布里的像素读数不会变**，要量它只能量合成之后的窗口
 * （探针 spike/pdf-scheme.js 的 Q9 就是这么量的）。
 */
const paperAlpha = computed(() => {
  const v = config.value?.ui.readerOpacity ?? 1
  return Math.min(1, Math.max(0, 1 - v))
})

/*
 * 墨色只读一次。
 *
 * 这一页**不写主题**（useTheme 只有起始页那一份文档调），因此它永远落在
 * themes.css 的 `:root` 那一组上——纸白那一份近黑的墨。读到的时候样式表已经
 * 应用完了：五份文档的 `themes.css` 都是 `<link>`，先把样式算好，模块脚本才跑。
 *
 * 读的是**算好的** --zhituan-ink，不是把颜色抄在这里：配色唯一的真相仍在主题层，
 * 抄一份就等于多一处「改了主题层但 PDF 里的字没跟着变」。
 *
 * 1.5.1 之前这里是跟着主题走的（磷绿下整本书的字都是荧光绿）。那是错的：
 * 这一页画的是**内容**，内容不该被界面的皮肤染上颜色——与「网页永远不受影响」
 * 是同一条边界。
 */
inkColor = inkFromCss(getComputedStyle(document.documentElement).getPropertyValue('--zhituan-ink'))

/**
 * 纸的颜色：主题层里「面」的三通道（`--zhituan-surface-rgb`，纸白那一份是
 * `255 255 255`）。
 *
 * 读它而不是把 `255, 255, 255` 抄在这里，与上面那行墨色是同一条规矩：配色
 * 唯一的真相在主题层。这一页不写主题，因此它拿到的恒是 `:root` 那一份白。
 * 兜底那句只是防「读不到」——探针 Q9 量的正是这张纸白不白。
 */
const paperRgb = (() => {
  const parts = getComputedStyle(document.documentElement)
    .getPropertyValue('--zhituan-surface-rgb')
    .trim()
    .split(/\s+/)
    .map(Number)
  return parts.length === 3 && parts.every(Number.isFinite) ? parts.join(', ') : '255, 255, 255'
})()

/**
 * 画布自己的底色就是那张纸。
 *
 * 画布位图里只有墨（纸在键控那一趟被写成 alpha 0），因此把纸画成**元素底色**
 * 正好补回它原来待的那一层：字在位图里，压在这张纸上面，两者的 alpha 各算各的
 * ——纸按滑块来，字恒是实心。
 */
const paperStyle = computed(() => `rgba(${paperRgb}, ${paperAlpha.value.toFixed(3)})`)

function fail(err: unknown): void {
  note.value = `打不开这本书：${err instanceof Error ? err.message : String(err)}`
  status.value = 'error'
  console.error('[pdf]', err)
}

/** 重画当前这一页。同时只画一张，画的过程中来的请求合并成「画完再来一遍」 */
function scheduleRender(): void {
  token++
  if (painting) return
  void paintLoop()
}

async function paintLoop(): Promise<void> {
  painting = true
  try {
    while (true) {
      const mine = token
      await paintOnce()
      if (mine === token) break
    }
  } finally {
    painting = false
  }
}

async function paintOnce(): Promise<void> {
  const box = stage.value
  const el = canvas.value
  if (!doc || !box || !el) return

  const num = Math.min(Math.max(1, pageNo.value), pageCount.value)
  let page: PDFPageProxy
  try {
    page = await doc.getPage(num)
  } catch (err) {
    fail(err)
    return
  }

  if (!baseDpr) baseDpr = window.devicePixelRatio || 1
  const dpr = window.devicePixelRatio || 1
  const z = dpr / baseDpr
  const cssW = box.clientWidth * z
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: cssW / base.width })

  // 画布按设备像素开，CSS 尺寸另给——两者相差 dpr 倍，字才是实的
  el.width = Math.round(vp.width * dpr)
  el.height = Math.round(vp.height * dpr)
  el.style.width = `${Math.round(vp.width)}px`
  el.style.height = `${Math.round(vp.height)}px`
  document.documentElement.style.setProperty('--zhituan-zoom', String(z))

  if (!ctx) return
  /*
   * 必须显式清一次。
   *
   * 改画布的 width/height 只在**尺寸真的变了**时才清空它，而「换深浅那一档」
   * 与「重新排版同一页」都是同一尺寸的重画；键控又是就地改写像素的，
   * 不清就会拿上一次的结果当地基，叠两遍之后 alpha 全糊在一起。
   */
  ctx.clearRect(0, 0, el.width, el.height)

  try {
    await page.render({
      /*
       * 必须显式给上下文，并且把 `canvas` 写成 null（pdf.js 的规矩：两者只认一个，
       * 给了 canvas 就由它自己去取上下文）。两个理由，都是必须的：
       *
       *   1. pdf.js 自己取的时候写的是 `getContext('2d', { alpha: false })`——
       *      那会开出一张**不透明**的画布，透明窗口里就成了白底，这一页的全部
       *      意义当场没了。
       *   2. 键控要 getImageData 读回来，`willReadFrequently` 得我们自己提。
       *      这个上下文是在 onMounted 里取的（那一处说明了为什么必须抢在最前面：
       *      getContext 的选项只认第一次，谁先取谁定规矩）。
       */
      canvas: null,
      canvasContext: ctx,
      viewport: vp,
      // 透明底。多数纯文字 PDF 到这一步就只剩字了，画了纸的那些交给键控
      background: 'rgba(0,0,0,0)'
    }).promise
  } catch (err) {
    fail(err)
    return
  }

  inkCanvas(ctx, inkColor, polarity.value)
  status.value = 'ready'

  box.scrollTop = edge === 'bottom' ? box.scrollHeight : 0
  edge = 'top'

  // 上一次那一页把算子表还回去：一次一页的读法不需要留着它，
  // 而一本一千页的书一路读下去，留着就是一路涨上去
  if (lastPage && lastPage !== page) lastPage.cleanup()
  lastPage = page
}

/**
 * 翻页。
 *
 * `edge` 决定新页落在哪一头：往后翻落在页首（从头读），往回翻落在**页尾**
 * （接着上一页的结尾读）——这是翻书的手感，也是读长页时最要紧的一条。
 */
function go(delta: number): void {
  const next = Math.min(Math.max(1, pageNo.value + delta), pageCount.value)
  if (!doc || next === pageNo.value) return
  edge = delta < 0 ? 'bottom' : 'top'
  pageNo.value = next
  scheduleRender()
}

/** 滚这一页。返回「滚动了没有」——没滚动就说明到边了 */
function scrollPage(dy: number): boolean {
  const box = stage.value
  if (!box) return false
  const before = box.scrollTop
  box.scrollTop = before + dy
  return Math.abs(box.scrollTop - before) > 1
}

/**
 * 滚轮：能滚就滚，滚到头才翻。
 *
 * 横向的动作（触控板的横滑、放大之后的 shift+滚轮）一概不管，还给容器自己——
 * 放大之后一页比正文区宽，横着看那一半正是它唯一看得见的办法。
 */
function onWheel(event: WheelEvent): void {
  bumpHud()
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

  // 到边了：这一下不再交给容器（它也无处可滚），攒够一格就翻页
  event.preventDefault()
  const now = performance.now()
  if (now - lastTurn < WHEEL_COOLDOWN_MS) return
  wheelAcc += event.deltaY
  if (Math.abs(wheelAcc) < WHEEL_STEP) return
  const dir = wheelAcc > 0 ? 1 : -1
  wheelAcc = 0
  lastTurn = now
  go(dir)
}

function onKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  if (status.value !== 'ready') return
  bumpHud()

  const step = Math.max(LINE_STEP * 3, Math.round((stage.value?.clientHeight ?? 600) * PAGE_STEP))
  switch (event.key) {
    case 'ArrowDown':
      if (!scrollPage(LINE_STEP)) go(1)
      break
    case 'ArrowUp':
      if (!scrollPage(-LINE_STEP)) go(-1)
      break
    case 'PageDown':
      if (!scrollPage(step)) go(1)
      break
    case 'PageUp':
      if (!scrollPage(-step)) go(-1)
      break
    case ' ':
      if (!scrollPage(event.shiftKey ? -step : step)) go(event.shiftKey ? -1 : 1)
      break
    case 'ArrowRight':
      go(1)
      break
    case 'ArrowLeft':
      go(-1)
      break
    case 'Home':
      edge = 'top'
      go(1 - pageNo.value)
      break
    case 'End':
      edge = 'top'
      go(pageCount.value - pageNo.value)
      break
    default:
      return
  }
  event.preventDefault()
}

function bumpHud(): void {
  hudOn.value = true
  if (hudTimer !== null) window.clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => {
    hudTimer = null
    hudOn.value = false
  }, HUD_IDLE_MS)
}

function cyclePolarity(event: MouseEvent): void {
  const at = POLARITIES.findIndex((p) => p.value === polarity.value)
  polarity.value = POLARITIES[(at + 1) % POLARITIES.length].value
  scheduleRender()
  // 按完之后把焦点还掉：留在这枚键上，空格会变成「再按一次它」而不是翻页
  ;(event.currentTarget as HTMLElement | null)?.blur()
}

const current = (): (typeof POLARITIES)[number] =>
  POLARITIES.find((p) => p.value === polarity.value) ?? POLARITIES[0]

/**
 * 缩放是靠 devicePixelRatio 看出来的，而它变了不会发 resize 事件
 * （实测 0 次）。标准做法是拿一条「正好等于当前 dpr」的媒体查询听变化，
 * 每变一次再重新注册一条——查询串里的数值是要跟着走的。
 */
function watchDpr(): void {
  dprQuery?.removeEventListener('change', onDprChange)
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
  dprQuery.addEventListener('change', onDprChange)
}

function onDprChange(): void {
  watchDpr()
  scheduleRender()
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  bumpHud()
  watchDpr()

  /*
   * 上下文在这里就取好，抢在**任何一次画**之前。
   *
   * `getContext` 的选项只认第一次：同一个画布上谁先取谁定规矩，后面那些带选项的
   * 调用拿到的都是同一个对象、选项一律作废。而 `willReadFrequently` 不是可有可无的
   * ——没有它 Chromium 会把画布放到 GPU 上，键控每页都要读一次全屏像素
   * （`getImageData`），那一下就成了昂贵的回读，它还会在控制台抱怨一句
   * 「getImageData 很慢」。实测就是这么发现的：探针早一步用不带选项的 `getContext('2d')`
   * 把上下文取走之后，这一页自己那次带选项的调用当场失效、警告立刻出现。
   */
  ctx = canvas.value?.getContext('2d', { willReadFrequently: true }) ?? null

  if (stage.value) {
    // fit-width 要在窗口宽度变化时重算
    resizer = new ResizeObserver(() => scheduleRender())
    resizer.observe(stage.value)
  }

  const book = new URLSearchParams(window.location.search).get('doc')
  if (!book) {
    fail(new Error('这个地址里没有带书（主进程没给 token）'))
    return
  }

  try {
    const res = await fetch(`zhituan-pdf://doc/${book}`)
    if (!res.ok) throw new Error(`取不到这本书（${res.status}）`)
    const bytes = new Uint8Array(await res.arrayBuffer())

    /*
     * worker 走 Vite 打进页面里的那一份（`?worker&inline`）。
     *
     * 必须是 inline：这一页在 `file:` 下，而 `file:` 文档去 new Worker 一个
     * `file:` 脚本会被当成跨来源挡掉（来源不透明）；inline 出来的是一个 blob，
     * 实测可用（见 docs/spike-findings.md 里那条 blob worker 的实测）。
     * 也因此 pdf.html 的 CSP 里有 `worker-src blob:`。
     */
    GlobalWorkerOptions.workerPort = new PdfWorker()

    note.value = '正在排版…'
    loading = getDocument({
      data: bytes,
      // 这四样都是运行时按需取的，走上面那条资源通道
      cMapUrl: `${ASSET}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSET}standard_fonts/`,
      wasmUrl: `${ASSET}wasm/`,
      iccUrl: `${ASSET}iccs/`
    })
    doc = await loading.promise
    pageCount.value = doc.numPages
    // 书名由主进程写在标签上，这里一个字都不画——这一页只有纸与字
  } catch (err) {
    fail(err)
    return
  }

  scheduleRender()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  resizer?.disconnect()
  dprQuery?.removeEventListener('change', onDprChange)
  if (hudTimer !== null) window.clearTimeout(hudTimer)
  // 一次一页的读法，关掉就等于把这本书整个放掉
  void loading?.destroy()
  loading = null
  doc = null
  ctx = null
})
</script>

<template>
  <div class="pdf">
    <!--
      正文区。一次一页，页比它高时在它里面滚；滚到头再由 onWheel / onKey 翻页。
      滚动条藏起来：这一页是「浮在桌面上的一叠纸」，一条灰色的槽会把它拆穿。

      画布自己的底色 = 那张纸（`paperStyle`），纸的透明度由右栏第三条滑块给。
      不给它 opacity：那会把字一起淡掉，而要淡的是纸。
    -->
    <div ref="stage" class="stage" @wheel="onWheel">
      <canvas ref="canvas" class="sheet" :style="{ backgroundColor: paperStyle }" />
    </div>

    <!-- 出错与进度都写在这一句里：这一页没有别的可说话的地方 -->
    <p v-if="status !== 'ready'" class="note">{{ note }}</p>

    <div v-else class="hud" :class="{ off: !hudOn }">
      <span class="hud__count">{{ pageNo }} / {{ pageCount }}</span>
      <button class="hud__key" :title="current().hint" @click="cyclePolarity">
        {{ current().label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pdf {
  position: absolute;
  inset: 0;
  /* 底色不画：窗口本身是逐像素透明的，这一页要让桌面透过来 */
  background: transparent;
}

.stage {
  position: absolute;
  inset: 0;
  overflow: auto;
  /* 上下留一线，页与标题栏之间不要贴死；左右必须是 0——fit-width 拿 clientWidth
     当页宽，而 clientWidth 是含内边距的 */
  padding: 10px 0;
  scrollbar-width: none;
}

.stage::-webkit-scrollbar {
  display: none;
}

.sheet {
  display: block;
  margin: 0 auto;
  /* 纸由行内那条 backgroundColor 给（透明到实心之间由滑块定），这里只是它落地
     之前的一层底：默认的 canvas 本来就是透明的，这一条是双保险 */
  background: transparent;
}

.note {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  max-width: 80%;
  color: var(--zhituan-text-dim);
  font: 13px/1.7 var(--zhituan-font);
  text-align: center;
}

/*
 * 右下角那条浮层。
 *
 * 它跟着缩放一起变大——整份文档都在缩放里，一段写死 13px 的字在 200% 下是 26px。
 * 因此每一处尺寸都按 --zhituan-zoom 除回去（由 PdfApp 在画完一页时写在文档根上，
 * 值就是那个 z），于是它在任何缩放档下都是同一副大小。
 *
 * 除法的写法是 CSS 值四则里的除法，右操作数是个数：`calc(12px / 1.2)`。
 * 不用 transform: scale() 反着缩，是因为那会把圆角与 1px 的边一起拉花。
 */
.hud {
  position: fixed;
  right: calc(12px / var(--zhituan-zoom, 1));
  bottom: calc(12px / var(--zhituan-zoom, 1));
  display: flex;
  align-items: center;
  gap: calc(4px / var(--zhituan-zoom, 1));
  padding: 0 calc(4px / var(--zhituan-zoom, 1));
  height: calc(26px / var(--zhituan-zoom, 1));
  border-radius: 999px;
  background: var(--zhituan-surface-active);
  color: var(--zhituan-text-dim);
  font-family: var(--zhituan-font);
  font-size: calc(12px / var(--zhituan-zoom, 1));
  line-height: 1;
  opacity: 1;
  transition: opacity 220ms ease-out;
  /* 它只是读数与一枚开关，底下的正文照旧要能用滚轮滚、能点 */
  pointer-events: none;
}

/* 退开之后就连点都点不到了：一片看不见的按钮比没有按钮更坏 */
.hud.off,
.hud.off .hud__key {
  opacity: 0;
  pointer-events: none;
}

.hud__count {
  padding: 0 calc(8px / var(--zhituan-zoom, 1));
  font-variant-numeric: tabular-nums;
}

.hud__key {
  pointer-events: auto;
  height: calc(20px / var(--zhituan-zoom, 1));
  padding: 0 calc(9px / var(--zhituan-zoom, 1));
  border-radius: 999px;
  color: inherit;
  font: inherit;
}

.hud__key:hover {
  background: var(--zhituan-accent-soft);
  color: var(--zhituan-accent);
}
</style>
