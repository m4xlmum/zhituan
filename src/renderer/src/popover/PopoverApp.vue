<script setup lang="ts">
/**
 * 弹出面板。五种面板共用这一个组件，由 URL 的 ?kind= 决定内容。
 *
 * 「站点」那一种在 1.6.7 去掉了：起始页自己就能添加、编辑、移除站点，
 * 而那一栏的「站点」键是它唯一的人口——两份面板做同一件事，迟早有一处先改。
 * 这一种一并删干净，而不是留着让它没人打得开（见 shared/ipc.ts 的
 * OpenPopoverRequest.kind）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_LINE,
  DEFAULT_READER_MARGIN,
  DEFAULT_READER_PARA,
  READER_FONT_MAX,
  READER_FONT_MIN,
  READER_LINE_MAX,
  READER_LINE_MIN,
  READER_MARGIN_MAX,
  READER_MARGIN_MIN,
  READER_PARA_MAX,
  READER_PARA_MIN
} from '@shared/constants'
import type { Bookmark, HistoryEntry, TabState } from '@shared/types'
import { isLocalEpub, isLocalText, isLocalTxt } from '@shared/url'
import { useConfig } from '../composables/useConfig'
import { useBackgroundAlpha } from '../composables/useBackgroundAlpha'

type Kind = 'history' | 'bookmarks' | 'uaZoom' | 'tabs' | 'typeset'

const kind = (new URLSearchParams(location.search).get('kind') ?? 'history') as Kind

/**
 * 面板是另一扇窗、另一份文档，顶栏那棵树上写的 --zhituan-alpha 传不过来，
 * 因此这里自己把背景透明度读一遍。面板窗口是透明的，底板变淡就真的透出桌面。
 * 写在哪一层有讲究，见 useBackgroundAlpha。
 */
const { config } = useConfig()
useBackgroundAlpha(config)
// 面板不写主题：它属于「工具」那一层，固定用 :root 那一组（纸白），见 ChromeApp

const history = ref<HistoryEntry[]>([])
const bookmarks = ref<Bookmark[]>([])
const tabList = ref<TabState[]>([])
const query = ref('')
const activeTabId = ref<string | null>(null)
const uaMode = ref<'desktop' | 'mobile'>('desktop')

const title = computed(
  () =>
    ({
      history: '历史记录',
      bookmarks: '书签',
      uaZoom: '显示',
      tabs: '标签页',
      typeset: '排版'
    })[kind]
)

let unsubscribeTabs: (() => void) | null = null

/**
 * Esc 收起面板。
 *
 * 面板一打开就把焦点拿到手了（见 popoverWindow 里 show() 那一段），
 * 键盘此刻在面板这儿——那么「按 Esc 退出」这条人人都有的手势就得接住，
 * 不然它什么都不做。走的还是那条「用户自己收」的路，焦点跟着回主窗口。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') void window.zhituan.ui.closePopover()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  const tabsState = await window.zhituan.tabs.list()
  activeTabId.value = tabsState.activeTabId
  tabList.value = tabsState.tabs
  const current = tabsState.tabs.find((t) => t.id === tabsState.activeTabId)
  uaMode.value = current?.uaMode ?? 'desktop'

  // 标签页清单打开期间标题、顺序都可能变，跟着主进程的推送走
  unsubscribeTabs = window.zhituan.tabs.onState((payload) => {
    tabList.value = payload.tabs
    activeTabId.value = payload.activeTabId
  })

  await refreshAll()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubscribeTabs?.()
})

async function refreshAll(): Promise<void> {
  if (kind === 'history') {
    history.value = await window.zhituan.history.list({ query: query.value, limit: 200 })
  } else if (kind === 'bookmarks') {
    bookmarks.value = await window.zhituan.bookmarks.list({ query: query.value })
  }
}

/**
 * 打开一个网址（站点、历史、书签三处都是它）。
 *
 * `tabId` 可以为 null：正文区正停在起始页或系统设置上时就是它。那两屏不承载
 * 访客内容，主进程会另开一张网页标签并切过去——用户点了一条书签，
 * 要的当然是看到那一页，而不是「什么也没发生」。
 */
function open(url: string): void {
  void window.zhituan.nav.goto({ tabId: activeTabId.value, input: url })
  void window.zhituan.ui.closePopover()
}

/** 切到某个标签页。面板随即收起，用户的注意力该回到网页上 */
function selectTab(tabId: string): void {
  void window.zhituan.tabs.activate({ tabId })
  void window.zhituan.ui.closePopover()
}

function closeTab(tabId: string, event: MouseEvent): void {
  event.stopPropagation()
  void window.zhituan.tabs.close({ tabId })
}

async function removeBookmark(id: string, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  bookmarks.value = await window.zhituan.bookmarks.remove({ id })
}

async function clearHistory(): Promise<void> {
  await window.zhituan.history.clear()
  history.value = []
}

/*
 * 这两条要作用在**某一页**上（改它的 UA、改它的缩放），而停在起始页 /
 * 系统设置上时没有那一页——面板还把上一次读到的那一页的状态显示着，
 * 因此必须挡住，不能拿它去改别的页面。
 */
function setUa(mode: 'desktop' | 'mobile'): void {
  const tabId = activeTabId.value
  if (!tabId) return
  uaMode.value = mode
  void window.zhituan.page.setUa({ tabId, mode })
}

function zoom(op: 'in' | 'out' | 'reset'): void {
  const tabId = activeTabId.value
  if (!tabId) return
  void window.zhituan.page.setZoom({ tabId, op })
}

/*
 * 离线阅读的排版四项。
 *
 * 与上面两条不一样的是：它**不作用在「某一页」上，而是作用在「离线阅读」这件事
 * 上**。写的是 ui 里那四个字段，落款由三边各自去办——自家那两页阅读器自己从同一份
 * 配置里读（book/BookApp.vue 与 txt/TxtApp.vue 的 applyTypeset），Chromium 排出来的
 * 本机文本由主进程写进它那个 pre（TabManager 的 applyPageStyles / refreshReaderView）。
 * 因此这里不必传 tabId，也不必判有没有当前网页：值与对象都由落款那一侧对上号。
 * 于是**不必收面板**：用户要连着拖四条，拖完自己点别处收起。
 *
 * 与两页阅读器右下角那枚 Aa 打开的是同一组控件、同一份配置，三处改完的结果一致
 * ——这是「一份配置、多处落点」这条规矩在界面上的样子（右栏第三条滑块与
 * 它同源，见 Rail.vue）。
 */
function setTypeset(key: 'font' | 'line' | 'margin' | 'para', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  const ui =
    key === 'font'
      ? { readerFontSize: value }
      : key === 'line'
        ? { readerLineHeight: value }
        : key === 'margin'
          ? { readerMargin: value }
          : { readerParagraph: value }
  void window.zhituan.config.patch({ ui })
}

/** 正在看的那一页。judge 段距有没有对象要用它的地址（见 paraOff） */
const activeTabUrl = computed(
  () => tabList.value.find((t) => t.id === activeTabId.value)?.url ?? null
)

/**
 * 段距那一行不能用时的一句话（空串 = 能用，也就没有 title）。
 *
 * 四行里只有这一行会没对象：另外三项对任何正文都成立，而段距要正文里分得出「段」。
 * 需要判的只有一种——**Chromium 排出来的本机文本**（`.md`、`.log` 这一类）：那一页
 * 整篇是一个 `<pre>`，一个标签都不是它自己的，没有段与段之间可言（见
 * services/pageStyler.ts 的 applyReaderTypeset，那三项写的就是这个 pre）。
 *
 * 自家那两页阅读器（本机 TXT 与本机 EPUB）不在这里判：它们的正文有段落结构，
 * 而「这一章切不切得动」只有那一页自己知道，于是由它们各自在页内那枚 Aa 的面板上
 * 灰掉（见 reader/TypesetPanel.vue 的 paraOff）。两处判据各管各的落点，合起来才是
 * 「能用的时候一定能用，不能用的时候一定看得见为什么」。
 *
 * 停在网页或起始页上时**不禁**：那时这一组控件谈的仍然是「离线阅读那份配置」，
 * 三项旧的一样不禁，第四项跟着旧规矩走。
 */
const paraOff = computed(() => {
  const url = activeTabUrl.value
  return isLocalText(url) && !isLocalEpub(url) && !isLocalTxt(url)
    ? '这一份文档整篇是一块（Chromium 排出来的纯文本），没有段与段之间，段距对它不生效'
    : ''
})
</script>

<template>
  <div class="panel">
    <header class="head">
      <span class="title">{{ title }}</span>
      <input
        v-if="kind === 'history' || kind === 'bookmarks'"
        v-model="query"
        class="search"
        type="text"
        placeholder="搜索"
        @input="refreshAll"
      />
      <button v-if="kind === 'history' && history.length" class="mini" @click="clearHistory">
        清空
      </button>
    </header>

    <div class="body">
      <!-- 历史 -->
      <template v-if="kind === 'history'">
        <div v-if="!history.length" class="empty">暂无记录</div>
        <div v-for="item in history" :key="item.id" class="row" @click="open(item.url)">
          <span class="row-title">{{ item.title }}</span>
          <span v-if="item.visitCount > 1" class="tag">{{ item.visitCount }} 次</span>
        </div>
      </template>

      <!-- 书签 -->
      <template v-else-if="kind === 'bookmarks'">
        <div v-if="!bookmarks.length" class="empty">暂无书签</div>
        <div v-for="item in bookmarks" :key="item.id" class="row" @click="open(item.url)">
          <span class="row-title">{{ item.title }}</span>
          <button class="mini" title="移除" @click="removeBookmark(item.id, $event)">✕</button>
        </div>
      </template>

      <!-- 标签页 -->
      <template v-else-if="kind === 'tabs'">
        <div v-if="!tabList.length" class="empty">暂无标签页</div>
        <div
          v-for="tab in tabList"
          :key="tab.id"
          class="row"
          :class="{ active: tab.id === activeTabId }"
          :title="tab.title"
          @click="selectTab(tab.id)"
        >
          <span class="row-title">{{ tab.title || '新标签页' }}</span>
          <button class="mini" title="关闭标签页" @click="closeTab(tab.id, $event)">✕</button>
        </div>
      </template>

      <!--
        排版。离线阅读的正文那四项（字号 / 行距 / 左右留白 / 段距）。
        顶栏那枚 Aa 打开的是它，自家那两页阅读器（本机 EPUB 与本机 TXT）右下角
        也各有一枚同样的 Aa、开着同一组控件——那两枚长在页里，因为那两页是我们
        自己画的；而 Chromium 自己渲染的那一类（.md、.log）页面上没有一处能挂
        控件，所以只好长到顶栏上（见 shared/ipc.ts 的 OpenPopoverRequest.kind）。
      -->
      <template v-else-if="kind === 'typeset'">
        <div class="section">正文</div>
        <label class="trow">
          <span class="tlabel">字号</span>
          <input
            class="trange"
            type="range"
            :min="READER_FONT_MIN"
            :max="READER_FONT_MAX"
            step="1"
            :value="config?.ui.readerFontSize ?? DEFAULT_READER_FONT"
            @input="setTypeset('font', $event)"
          />
          <span class="tvalue">{{ config?.ui.readerFontSize ?? DEFAULT_READER_FONT }}px</span>
        </label>
        <label class="trow">
          <span class="tlabel">行距</span>
          <input
            class="trange"
            type="range"
            :min="READER_LINE_MIN"
            :max="READER_LINE_MAX"
            step="0.05"
            :value="config?.ui.readerLineHeight ?? DEFAULT_READER_LINE"
            @input="setTypeset('line', $event)"
          />
          <span class="tvalue">{{
            (config?.ui.readerLineHeight ?? DEFAULT_READER_LINE).toFixed(2)
          }}</span>
        </label>
        <label class="trow">
          <span class="tlabel">留白</span>
          <input
            class="trange"
            type="range"
            :min="READER_MARGIN_MIN"
            :max="READER_MARGIN_MAX"
            step="1"
            :value="config?.ui.readerMargin ?? DEFAULT_READER_MARGIN"
            @input="setTypeset('margin', $event)"
          />
          <span class="tvalue">{{ config?.ui.readerMargin ?? DEFAULT_READER_MARGIN }}%</span>
        </label>
        <!--
          段距。0（默认）到 2em，相对于这一段自己的字号（理由见 @shared/constants
          的 READER_PARA_MIN）。paraOff 有值时这一行灰掉，见它那一段。
        -->
        <label class="trow" :class="{ off: !!paraOff }" :title="paraOff">
          <span class="tlabel">段距</span>
          <input
            class="trange"
            type="range"
            :min="READER_PARA_MIN"
            :max="READER_PARA_MAX"
            step="0.05"
            :disabled="!!paraOff"
            :value="config?.ui.readerParagraph ?? DEFAULT_READER_PARA"
            @input="setTypeset('para', $event)"
          />
          <span class="tvalue"
            >{{ (config?.ui.readerParagraph ?? DEFAULT_READER_PARA).toFixed(2) }}em</span
          >
        </label>
        <!--
          这一句必须写成**一行**：`<p>` 里那些换行会被折成一个空格，而这一句是中文
          ——「页面上 也各有一枚」那种缝就是这么来的（探针量到的原文里就有）。
        -->
        <p class="hint">只作用于正在读的这一份本机文本：自家那两页阅读器（本机 TXT 与本机 EPUB，页面上也各有一枚同样的 Aa），以及 Chromium 排出来的本机文本（.md、.log 这一类）。网页不受影响。</p>
      </template>

      <!-- 显示 -->
      <template v-else>
        <div class="section">访问方式</div>
        <div class="segmented">
          <button :class="{ on: uaMode === 'desktop' }" @click="setUa('desktop')">电脑模式</button>
          <button :class="{ on: uaMode === 'mobile' }" @click="setUa('mobile')">手机模式</button>
        </div>
        <p class="hint">切换后会重新加载页面。窄窗口下部分站点用手机版排版更合适。</p>
        <div class="section">页面缩放</div>
        <div class="segmented">
          <button @click="zoom('out')">缩小</button>
          <button @click="zoom('reset')">重置</button>
          <button @click="zoom('in')">放大</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--zhituan-surface);
  border: 1px solid var(--zhituan-border);
  border-radius: var(--zhituan-radius);
  overflow: hidden;
  color: var(--zhituan-text);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--zhituan-border);
}

.title {
  flex: 0 0 auto;
  font-weight: 600;
}

.search {
  flex: 1 1 auto;
  min-width: 40px;
  height: 22px;
  padding: 0 7px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--zhituan-border);
  border-radius: var(--zhituan-radius-sm);
  color: var(--zhituan-text);
  outline: none;
}

.body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px;
}

.section {
  padding: 8px 6px 4px;
  color: var(--zhituan-text-faint);
  font-size: 11px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--zhituan-radius-sm);
  cursor: pointer;
}

.row:hover {
  background: var(--zhituan-surface-hover);
}

/* 当前正在看的那个标签页，一眼看得出来是它 */
.row.active {
  background: var(--zhituan-surface-active);
  color: var(--zhituan-ink);
}

.row-title {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  flex: 0 0 auto;
  color: var(--zhituan-text-faint);
  font-size: 11px;
}

.mini {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: var(--zhituan-radius-sm);
  color: var(--zhituan-text-faint);
}

.mini:hover {
  color: var(--zhituan-danger);
}

.segmented {
  display: flex;
  gap: 4px;
  padding: 0 6px;
}

.segmented button {
  flex: 1 1 0;
  height: 26px;
  border-radius: var(--zhituan-radius-sm);
  background: rgba(0, 0, 0, 0.24);
  color: var(--zhituan-text-dim);
}

.segmented button:hover {
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-text);
}

.segmented button.on {
  background: var(--zhituan-surface-active);
  color: var(--zhituan-accent);
}

.hint {
  margin: 6px 8px 0;
  color: var(--zhituan-text-faint);
  font-size: 11px;
  line-height: 1.5;
}

/*
 * 排版面板那四行：小标题 + 横条 + 读数。
 *
 * 与自家阅读页里那组（styles/book.css 的 .typeset__row）是同一套材料，
 * 只是换了宽度——那一组的面板是自己画的、宽 300px，这一组在 320px 的弹出面板里。
 * 不共用一个组件：那一边用的是全局样式表、这一边是 scoped，而两边的行高、
 * 内边距都要跟着各自的容器走（书页那份底下还压着正文，要一点点半透明）。
 * 段距那一行没有对象时灰掉（见 paraOff），两处的写法也一样。
 *
 * range 的轨道与圆点依然得自己画：`appearance: none` 之后浏览器不再给它们样式，
 * 而各平台的默认外观在这一套配色里都不成立。轨道画在 runnable-track 上
 * （不是 input 的背景），圆点靠负 margin 挪到轨道中央。
 */
.trow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 6px;
}

/* 段距那一行不能用时：整行连读数一起退成灰的，让「拖不动」看得出来 */
.trow.off {
  opacity: 0.45;
}

.tlabel {
  flex: 0 0 auto;
  width: 2.6em;
  color: var(--zhituan-text-dim);
  font-size: 12.5px;
}

.trange {
  flex: 1 1 auto;
  min-width: 0;
  height: 16px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
}

.trange::-webkit-slider-runnable-track {
  height: 3px;
  border-radius: 999px;
  background: var(--zhituan-border);
}

.trange::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  margin-top: -4.5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--zhituan-accent);
}

.tvalue {
  flex: 0 0 auto;
  min-width: 3.2em;
  color: var(--zhituan-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--zhituan-text-faint);
}
</style>
