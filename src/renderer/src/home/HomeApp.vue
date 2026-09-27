<script setup lang="ts">
/**
 * 起始页：一份数据，一副骨架。
 *
 * 主题决定披哪一层皮（见 @shared/constants 的 HOME_THEMES 与 worldOfTheme）：
 * - modern   行式列表，纸白与暗夜
 * - terminal 命令行，磷绿
 *
 * 两套世界的**划分与交互是同一套**（页眉 / 输入行 / 栏目线 / 内容行 / 状态行，
 * 见 StartPage 与 useRows）：换主题换的是观感，不是这一页怎么用。
 *
 * 这一层只管数据与动作：栏目停在哪一栏、那一栏有哪些行、点「打开文件…」弹谁、
 * 回车去哪、主题怎么落盘。至于画成什么样、一屏放得下几行，交给 StartPage 按实测尺寸算。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import {
  DEFAULT_HOME_THEME,
  DEFAULT_SECTION,
  LOCAL_FORMATS_NOTE,
  SECTIONS,
  worldOfTheme,
  type HomeTheme,
  type SectionId
} from '@shared/constants'
import { resolveInput } from '@shared/url'
import type { AppConfig, Bookmark, HistoryEntry, SiteRecord, TabState } from '@shared/types'
import StartPage from './StartPage.vue'
import { useBox } from './useBox'
import type { HomeRow } from './useRows'
import { plateRowsOf, statOf, tilesOf } from './useTiles'
import { applyThemeToDocument } from '../composables/useTheme'
import type { HomeTile } from './types'

const mySites = ref<SiteRecord[]>([])
const history = ref<HistoryEntry[]>([])
const bookmarks = ref<Bookmark[]>([])
const config = ref<AppConfig | null>(null)
const query = ref('')
/** 此刻停在哪一栏 */
const plate = ref<SectionId>(DEFAULT_SECTION)
/** 起始页的主题，见 config.ui.homeTheme。**只这一页**跟着它换，界面那几份不动 */
const theme = ref<HomeTheme>(DEFAULT_HOME_THEME)
/** 开着几张标签页。页眉要报这个数 */
const tabCount = ref(0)

let offConfig: (() => void) | null = null
let offTabs: (() => void) | null = null

const world = computed(() => worldOfTheme(theme.value))

const page = useTemplateRef<HTMLElement>('page')
const { h: pageH } = useBox(page)
/**
 * 紧凑形态。
 *
 * 用实测高度分档，而不是媒体查询：这一页在窗口里占多高，取决于顶栏与地址栏
 * 开着没有，只有量出来才知道。360 这个界：迷你档的正文区只有 226 高，必须收；
 * 小号档有 406，还宽裕。
 */
const compact = computed(() => pageH.value < 360)

onMounted(async () => {
  config.value = await window.zhituan.config.get()
  applyTheme(config.value.ui.homeTheme)
  offConfig = window.zhituan.config.onChanged((next) => {
    config.value = next
    // 主题也可能是在系统设置里改的，那条路上只有这条广播会通知到这里
    applyTheme(next.ui.homeTheme)
  })

  /**
   * 标签页一变就把历史重读一遍。
   *
   * 起始页是一屏「自家页面」，回到它上面时**不会重新挂载**——不重读的话，
   * 刚读完的那本书不会出现在「离线阅读」里，「继续上次」也还指着再上一次。
   * 一次本地 IPC 而已，而主进程那边的广播本身就是去抖过的。
   *
   * 挂载时那第一次不算：紧接着的 reload() 本来就要读一次。
   */
  let tabsSeen = false
  const applyTabs = (payload: { tabs: TabState[]; activeTabId: string | null }): void => {
    tabCount.value = payload.tabs.length
    if (tabsSeen) void refreshHistory()
    tabsSeen = true
  }
  await reload()
  applyTabs(await window.zhituan.tabs.list())
  offTabs = window.zhituan.tabs.onState(applyTabs)
})

onUnmounted(() => {
  offConfig?.()
  offTabs?.()
})

async function refreshHistory(): Promise<void> {
  history.value = await window.zhituan.history.list({ limit: 200 })
}

async function reload(): Promise<void> {
  const [sites, marks] = await Promise.all([
    window.zhituan.sites.list(),
    window.zhituan.bookmarks.list()
  ])
  mySites.value = sites
  bookmarks.value = marks
  await refreshHistory()
}

// ---------------------------------------------------------------- 站点编排

/*
 * 站点怎么挑、一栏里该有谁、读数数的是什么，全在 useTiles 里——那边不引 vue，
 * 是纯数据，因此可以被 spike/home-sections.js 直接 require 到真跑的这一份。
 * 这里只剩「把这些喂给它们」以及「量出这一页有多高」。
 */

const tiles = computed<HomeTile[]>(() =>
  tilesOf(mySites.value, history.value, bookmarks.value)
)

const lastRead = computed<HistoryEntry | null>(() => history.value[0] ?? null)

/** 搜索时要搜的是**全部板块**：在「视频」栏里搜「起点」得搜得到 */
const searching = computed(() => query.value.trim() !== '')

/** 「全部」那一栏。搜索时底下列的也是它（外加本机文件那一栏） */
const allRows = computed(() => plateRowsOf(tiles.value, history.value, lastRead.value, 'all'))

/** 「离线阅读」那一栏：打开文件…在最前，其后是最近读过的本机文件 */
const localRows = computed(() => plateRowsOf(tiles.value, history.value, lastRead.value, 'local'))

const rows = computed<HomeRow[]>(() =>
  searching.value
    ? [...allRows.value, ...localRows.value]
    : plateRowsOf(tiles.value, history.value, lastRead.value, plate.value)
)

const stat = computed(() =>
  statOf({
    tiles: tiles.value,
    history: history.value,
    plate: plate.value,
    matchCount: searching.value ? rows.value.length : null
  })
)

/** 格式说明只挂在离线阅读那一栏上，别的栏目没有 */
const note = computed(() =>
  plate.value === 'local' && !searching.value ? LOCAL_FORMATS_NOTE : null
)

// ---------------------------------------------------------------- 栏目

/**
 * 换一栏。
 *
 * 顺手把输入框清空：正在搜索时底下列的是全部板块的行，不清掉的话点了「视频」
 * 底下一动不动，看着像没点着。清掉才是「我这就去看视频」。
 */
function pickPlate(id: SectionId): void {
  plate.value = id
  query.value = ''
}

/**
 * 左右键换栏。到头就停住，不绕回另一端。
 *
 * 栏不是环：从左端再往左没有「上一栏」，而绕回最右端会让人以为按错了。
 */
function movePlate(delta: number): void {
  const index = SECTIONS.findIndex((s) => s.id === plate.value)
  const next = SECTIONS[Math.max(0, Math.min(index + delta, SECTIONS.length - 1))]
  if (next && next.id !== plate.value) plate.value = next.id
}

// ---------------------------------------------------------------- 动作

/**
 * 打开一个站点。
 *
 * 起始页始终留在原处，新站点另开一张标签页。
 */
function open(url: string): void {
  void window.zhituan.tabs.create({ url, activate: true })
}

/**
 * 把输入框里的东西交出去。
 *
 * 是网址就打开它，是别的话就按搜索引擎搜——这层判断在主进程那边统一做
 * （resolveInput），两套世界因此都不必自己认网址。
 */
function submit(text: string): void {
  const value = text.trim()
  if (!value) return
  open(resolveInput(value, config.value?.browser.searchTemplate ?? ''))
  query.value = ''
}

function resume(): void {
  const last = lastRead.value
  if (!last) return
  open(last.url)
}

/**
 * 打开本机的一本书。
 *
 * 选文件与开标签页都在主进程那边做（见 ipc/registerFileIpc）：那边才知道窗口是谁、
 * 才知道路径要不要转成 `file://`。这里只负责把结果接住——回来的是**文件名**，
 * 不是路径，这一页也从不需要路径。
 *
 * 主进程开完标签页会广播一次标签页状态，历史跟着也就重读了；这里再读一次是为了
 * 让「离线阅读」那一栏立刻多出这一本，而不是等下一趟广播。
 */
async function openFile(): Promise<void> {
  const names = await window.zhituan.files.openLocal()
  if (!names.length) return
  await refreshHistory()
}

// ---------------------------------------------------------------- 主题

/**
 * 主题与形态都写在 html 的属性上，样式表按属性挑变量组（见 styles/themes.css）。
 *
 * **只有这一份文档写它**——界面、面板、设置页、PDF 阅读页那四份都不写，
 * 于是它们永远落在 `:root` 那一组（纸白）。主题是起始页这一屏的事，
 * 工具与内容不跟着换皮，理由写在 composables/useTheme.ts 的文件头。
 *
 * 这里只额外留一个 theme ref 给主题菜单用。
 */
function applyTheme(next: HomeTheme): void {
  theme.value = next
  applyThemeToDocument(next)
}

/**
 * 选一个主题。
 *
 * 先落地再持久化：换主题是一次视觉反馈，不该等一趟 IPC 往返才看到效果。
 * 配置更新后主进程会广播回来，那条路也会再调一次 applyTheme——幂等，不冲突。
 */
function pickTheme(next: HomeTheme): void {
  applyTheme(next)
  void window.zhituan.config.patch({ ui: { homeTheme: next } })
}
</script>

<template>
  <div ref="page" class="page">
    <StartPage
      :rows="rows"
      :plate="plate"
      :stat="stat"
      :tab-count="tabCount"
      :query="query"
      :theme="theme"
      :world="world"
      :compact="compact"
      :note="note"
      @open="open"
      @resume="resume"
      @open-file="openFile"
      @submit="submit"
      @pick="pickTheme"
      @pick-plate="pickPlate"
      @move-plate="movePlate"
      @update:query="query = $event"
    />
  </div>
</template>

<style scoped>
/*
 * 这一层是两套世界共同的地。
 *
 * 主题切换只换这里的颜色，StartPage 自己也画一层底（理由见 styles/settings.css
 * 开头：自家页面的底板要画在自己身上，不能只挂在 html/body 上）。
 */
.page {
  width: 100%;
  height: 100%;
  background: var(--ground);
  overflow: hidden;
}
</style>
