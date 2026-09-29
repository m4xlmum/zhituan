<script setup lang="ts">
/**
 * 起始页：一副骨架，两套世界，一条栏目线。
 *
 * 这一页要回答的是「今天摸哪条鱼」，所以它是一次**分类**：页眉下面是输入行与
 * 一行栏目键（视频 / 阅读 / 资讯 / 刷题 / 离线阅读 / 全部），点哪个，
 * 底下换哪一摊。分类这件事是页面的主角，不是站点图标墙。
 *
 * 划分自上而下五段，两套世界逐段对齐：
 *   页眉（标识 + 标签数） → 输入行 → 栏目线 → 内容行 → 状态行（读数 + 主题）
 * 骨架只有这一份（原先 modern 与 terminal 各是一个组件、各写一遍同一副骨架，
 * 见 useRows.ts 开头那段账）。世界决定的是**观感**，因此这里的差别只剩几处
 * 用 `terminal` 判的分支：字体与圆角（themes.css）、动词列印什么、
 * 提示符与块状光标、读数用哪种写法。用户换主题时换掉的是皮，不是这一页怎么用。
 *
 * 行数按实测高度算出来再渲染，放不下的不渲染：正文区最窄只有 432×226，
 * 裁出来的半行比没有这一行更难看。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import ThemeMenu from './ThemeMenu.vue'
import SiteEditor from './SiteEditor.vue'
import Icon from '../chrome/Icon.vue'
import { useBox } from './useBox'
import { filterRows, useRowList, type HomeRow } from './useRows'
import type { HomeTile } from './types'
import {
  HOME_VIEWS,
  SECTIONS,
  type HomeTheme,
  type HomeView,
  type HomeWorld,
  type SectionId
} from '@shared/constants'

const props = defineProps<{
  rows: HomeRow[]
  /** 此刻停在哪一栏。输入框里有字时它不高亮（那时搜的是全部板块） */
  plate: SectionId
  /** 状态行左端那个读数：这一栏里数的是什么、有多少，由 HomeApp 定 */
  stat: { kind: 'site' | 'local' | 'match'; count: number }
  tabCount: number
  query: string
  theme: HomeTheme
  /** 这一列站点怎么排：列表 / 小图标 / 图标，见 @shared/constants 的 HomeView */
  view: HomeView
  world: HomeWorld
  compact: boolean
  /** 「离线阅读」那一栏的格式说明。别的栏目没有 */
  note: string | null
}>()

const emit = defineEmits<{
  open: [url: string]
  resume: []
  openFile: []
  submit: [text: string]
  pick: [theme: HomeTheme]
  pickView: [view: HomeView]
  pickPlate: [id: SectionId]
  movePlate: [delta: number]
  /** 编辑器里按了保存。`tile` 为 null 是新增；改的是哪一行由它认出来 */
  saveSite: [draft: { tile: HomeTile | null; title: string; url: string }]
  /** 某一行上按了移除 */
  removeSite: [tile: HomeTile]
  'update:query': [value: string]
}>()

const terminal = computed(() => props.world === 'terminal')

/**
 * 输入框里有字的时候，栏目线不高亮任何一栏。
 *
 * 那时过滤的是**全部板块**（在「视频」栏里搜「起点」得搜得到），
 * 而高亮着某一栏会让人以为只搜了那一栏——搜不到时尤其难解释。
 */
const searching = computed(() => props.query.trim() !== '')

/** 行高（px）。这个数是唯一的：行高与「放得下几行」都由它推出来，见 --row-h */
const ROW_H = computed(() => {
  if (props.compact) return terminal.value ? 20 : 24
  return terminal.value ? 22 : 28
})

/**
 * 网格那两档的格子尺寸（px）。
 *
 * 两档差的就是这个数：小图标一屏放得下更多站点，图标那一档图标才看得清。
 * 尺寸写在这里而不是 CSS 里，是因为**一屏放得下几格**要先算出来再渲染
 * （这一页从不滚动，放不下的不渲染，见文件头），而算它与画它必须是同一个数。
 *
 * 小图标 96×52：图标 22px，名字在它下面一行，11px 的字放得下四五个汉字。
 * 图标 132×78：图标 34px，名字下面还能再排一行域名。
 */
const CELL = computed(() =>
  props.view === 'icons'
    ? { w: 132, h: 78, gap: 10 }
    : { w: 96, h: 52, gap: 8 }
)

/** 是不是网格式的两档（列表以外都是） */
const grid = computed(() => props.view !== 'list')

const filtered = computed(() => filterRows(props.rows, props.query))

const area = useTemplateRef<HTMLElement>('area')
const { w: areaW, h: areaH } = useBox(area)

/**
 * 一屏放几列。
 *
 * 按实测宽度算，与「放几行」同一个道理：这一页有多宽取决于右栏开着没有、
 * 窗口被拖到多窄。`+ gap` 是首尾那两条不留间隙——n 列要 n-1 条缝，
 * 而 (W + gap) / (col + gap) 取整正好是「连最后一条缝也算得进去」的那个 n。
 */
const cols = computed(() =>
  grid.value ? Math.max(1, Math.floor((areaW.value + CELL.value.gap) / (CELL.value.w + CELL.value.gap))) : 1
)

/**
 * 一屏放得下几格（行）。至少留一格——能放一格也比空着强。
 *
 * 列表与网格只差这个算式：列表按行高，网格按「(高 + 缝) / (格高 + 缝) 取整
 * 再乘列数」。两处都按整格算，因此排在最后那一格永远是完整的一格，
 * 不会出现半格——半行比没有这一行更难看（文件头那段账）。
 */
const limit = computed(() => {
  if (!grid.value) return Math.max(1, Math.floor(areaH.value / ROW_H.value))
  const cell = CELL.value
  const rows = Math.max(1, Math.floor((areaH.value + cell.gap) / (cell.h + cell.gap)))
  return Math.max(1, cols.value * rows)
})

/**
 * 上下键一步走几格。
 *
 * 网格里是**一整行**（列数）：屏幕上就是把光标往上/下挪一格位置。
 * 列表里是 1。左右键的归属也由它决定（见 useRowList 的 onKeydown）：
 * 网格里左右各走一格，列表里左右不归行列表管——那是换板块，或者输入框里的插入点。
 */
const step = computed(() => (grid.value ? cols.value : 1))

const { visible, sel, pick, reset, onKeydown, onSubmit } = useRowList(filtered, limit, {
  open: (url) => emit('open', url),
  resume: () => emit('resume'),
  openFile: () => emit('openFile'),
  submit: (text) => emit('submit', text),
  clearQuery: () => emit('update:query', '')
}, step)

/**
 * 这一栏是不是**真的**到底了。
 *
 * 只有整栏都渲染出来时才算：行数被上限截掉时，收尾那条线就成了「后面还有」
 * 的反话。相等（正好铺满）也不算——那时列底下没有留白，不需要收尾。
 */
const closed = computed(() => visible.value.length > 0 && visible.value.length < limit.value)

/**
 * 这一列的身份。栏变了、进出搜索了，都是**另一列**；打字本身不是。
 *
 * 拿它当模板里的 key，换栏时那一棵子树被整块换掉，动画也就跟着走一遍。
 */
const columnKey = computed(() => `${props.plate}${searching.value ? ':q' : ''}`)

/*
 * 换栏那一下要不要播。
 *
 * 第一帧**不播**：页面刚出现时那一列已经在它该在的位置上，让它从 0.55 落定下来
 * 说的是一件没发生过的事——「换了一栏」是句假话。因此那条动画挂在 `.settle`
 * 上，而这个类只有真的换过一栏之后才有。
 *
 * 判据就是 `columnKey`：它一共只在换栏与进出搜索时变，打字本身不变，
 * 于是这个开关与「底下那一列换了一棵树」是同一件事，两者不会说岔。
 * 上一轮的取证正是在这里说岔了：探针那一跑从没换过栏，量到的那两条
 * 其实是挂载那一次的，而它据以声称的却是「换栏会动」。
 */
const settling = ref(false)
watch(columnKey, () => {
  settling.value = true
})


// 换一栏，光标回到第一行：新一栏的行与上一栏没有任何关系
watch(() => props.plate, reset)

// ---------------------------------------------------------------- 栏目线

/**
 * 栏目线放不下时退回两字缩写。
 *
 * 按**实测宽度**分档而不是媒体查询：这一页有多宽取决于右侧栏开着没有、
 * 窗口被拖到多窄，只有量出来才知道。界取 560：再窄下去六栏连缩写带间距
 * 就快顶到边了，而 800 那一档还有富余。
 */
const root = useTemplateRef<HTMLElement>('root')
const { w: rootW } = useBox(root)
const narrow = computed(() => rootW.value > 0 && rootW.value < 560)

const sections = SECTIONS

/** 站点排布的三档，状态行那枚分段控件照它排 */
const views = HOME_VIEWS

/**
 * 按栏目键。
 *
 * 用 mousedown.prevent 而不是只挂 click：输入框一失焦就没人接键盘了，
 * 而用户点栏目线时多半正准备接着往下打字（顶栏那颗地址栏开关用的是同一手）。
 */
function pickPlate(id: SectionId): void {
  emit('pickPlate', id)
}

/**
 * 输入框里的左右键。
 *
 * 三种归属，按顺序判断：
 *
 *   · 网格那两档 —— 交给行列表，← → 各走一格。网格里左右本来**就是**这一列的
 *     方向，换栏因此让给了鼠标（见 keysHint 那段）。这一条排在换栏之前：
 *     网格里「右」几乎总是「往右边那一格」，而不是「换到下一栏」。
 *   · 栏目线空着 —— 换栏。用户点栏目线时多半正准备接着往下打字。
 *   · 其余 —— 移动插入点。输入框里有字时必须留在这一手，
 *     否则改一个网址中间的那个字母就会莫名其妙地跳栏。
 */
function onInputKeydown(event: KeyboardEvent): void {
  if (!grid.value) {
    const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (dir && !props.query.trim()) {
      event.preventDefault()
      emit('movePlate', dir)
      return
    }
  }
  onKeydown(event)
}

// ---------------------------------------------------------------- 文案

/** 动词列：现代世界只有「继续」「打开」两个字，终端世界直接印动词 */
function verbOf(row: HomeRow): string {
  if (terminal.value) return row.verb
  if (row.verb === 'resume') return '继续'
  return row.verb === 'open-file' ? '打开' : ''
}

const placeholder = computed(() => {
  if (terminal.value) return ''
  return props.compact ? '输入网址或关键词' : '输入网址，或输入关键词搜索'
})

/**
 * 状态行左端的读数。
 *
 * 两套世界各自的写法在这里合流：终端世界把那一格写成 `SITES 16` 这样的键值对，
 * 现代世界写成「站点 16」。数的是什么由栏目决定——「站点 0」摆在离线阅读那一栏里
 * 是句错话；而正在搜索时底下列的是命中的那几行，读数也就该说着同一件事。
 */
const statText = computed(() => {
  const word =
    props.stat.kind === 'local' ? '本机' : props.stat.kind === 'match' ? '匹配' : '站点'
  return terminal.value
    ? `${({ local: 'LOCAL', match: 'HITS', site: 'SITES' } as const)[props.stat.kind]} ${props.stat.count}`
    : `${word} ${props.stat.count}`
})

const emptyText = computed(() =>
  terminal.value ? '无匹配项，回车按关键词搜索' : '没有匹配的站点，回车按关键词搜索'
)

/**
 * 状态行右端的按键提示。
 *
 * 网格那两档里 ← → 归行列表（走格子），换栏因此只剩鼠标——所以这一句必须跟着
 * 变。写死一句「← → 换板块」在网格里就是句假话，而且是最坏的那种假话：
 * 用户按了，屏幕上动的不是那一栏，是光标。
 */
const keysHint = computed(() => {
  const tail = terminal.value
    ? 'ALT+Z 最小化 · ALT+X 藏进托盘'
    : 'Alt+Z 最小化 · Alt+X 藏进托盘'
  if (grid.value) {
    return terminal.value ? `回车打开 · ↑↓←→ 移动 · ${tail}` : `↑ ↓ ← → 移动 · ${tail}`
  }
  return terminal.value ? `回车打开 · ←→ 换板块 · ${tail}` : `← → 换板块 · ${tail}`
})

function initialOf(name: string): string {
  return [...name.trim()][0] ?? '·'
}

// ---------------------------------------------------------------- 增删改

/**
 * 此刻开着的那一格编辑器；null 就是没开。
 *
 * `tile` 为 null 是「新增」，否则是在改那一行——整块状态就这两格，
 * 因为编辑器只有这两种用法（见 SiteEditor）。改的是哪一行由 `tile` 认出来，
 * 而不是由「选中的是第几行」认：那一列会随过滤变短，位置靠不住。
 *
 * 删不在这里：删除没有第二格（没有要重命名的东西），按下去就该发生，
 * 中间再问一句「确定吗」反而把一次点击变成两步——而这一页上「移除」
 * 是可逆的（站点还在历史里，再添一次就回来了），不值得拦一道。
 */
const editing = ref<{ mode: 'add' | 'edit'; tile: HomeTile | null } | null>(null)

function openAdd(): void {
  editing.value = { mode: 'add', tile: null }
}

function openEdit(tile: HomeTile): void {
  editing.value = { mode: 'edit', tile }
}

/** 编辑器那两格的初值。编辑时是这一行现在的名字与网址，新增时两格都空着 */
function editorInitial(): { name: string; url: string } {
  const tile = editing.value?.tile
  return tile ? { name: tile.name, url: tile.url } : { name: '', url: '' }
}

function onEditorSave(draft: { title: string; url: string }): void {
  const tile = editing.value?.tile ?? null
  editing.value = null
  emit('saveSite', { tile, title: draft.title, url: draft.url })
  // 收起来之后焦点没有去处，键盘就断了——这一页的键盘整副都挂在输入行上
  focusPrompt()
}

function closeEditor(): void {
  editing.value = null
  focusPrompt()
}

/*
 * 行上那两枚按键收的是**整行**，认得出站点条目的那一步在这里做。
 *
 * 让模板去判 `row.tile` 有没有值也能写（v-if 认得出来），但那样一来
 * 「这一行能不能改」就成了模板里的一个条件，而不是一个说得出口的判据；
 * 收在这里，两枚按键与那一格字段是同一件事。
 */
function editRow(row: HomeRow): void {
  if (row.tile) openEdit(row.tile)
}

function removeRow(row: HomeRow): void {
  if (row.tile) emit('removeSite', row.tile)
}

// ---------------------------------------------------------------- 焦点

const promptEl = useTemplateRef<HTMLInputElement>('promptEl')
const focused = ref(false)

/*
 * 一进这一页就把光标放进输入行。
 *
 * 这一页的键盘**整副都挂在输入行上**（`onInputKeydown` 是唯一的 keydown，
 * ← → 换板块、↑ ↓ 选行、↵ 开当前行都在它里面），因此光标不在这儿的时候，
 * 状态行第一帧就写着的那句「← → 换板块」是句空话。上一轮评审是照像素抓到的：
 * 输入行底下那道线取的是 --divider-strong 而不是强调色，终端世界的方块光标
 * 也没点亮——两处都在说「这里没被选上」。
 *
 * 窗口重新获得焦点时再给一次。这一半管的是「从网页切回这一页」：正文区里
 * 这一页与网页各是一份文档，只有当前那份的 window 会收到 focus，因此
 * 切回来时点着的网页不会来抢、切走时这一页也不会去抢它。用户自己点到栏目键
 * 或某一行上时这份文档并没有失焦，也就不会被打断。
 *
 * 编辑器开着的时候**不抢**：那会儿光标正在它那两格里，这一手要是照给，
 * 用户切出去查个网址再切回来，正在填的那一格就被夺走了。
 */
function focusPrompt(): void {
  if (editing.value) return
  promptEl.value?.focus()
}

onMounted(() => {
  focusPrompt()
  window.addEventListener('focus', focusPrompt)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', focusPrompt)
})

/** 点空白处就把光标交回输入行：这一页整块都可以开始打字 */
function onRootClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  // 编辑器整块都算「空白之外」：它自己有输入框与按键，点它哪儿都不该回输入行
  if (target?.closest('button, input, a, .theme-menu, .site-editor')) return
  focusPrompt()
}
</script>

<template>
  <div
    ref="root"
    :class="[terminal ? 'term' : 'modern', { compact, narrow }]"
    :data-view="view"
    :style="{
      '--row-h': ROW_H + 'px',
      '--cols': cols,
      '--cell-w': CELL.w + 'px',
      '--cell-h': CELL.h + 'px',
      '--cell-gap': CELL.gap + 'px'
    }"
    @click="onRootClick"
  >
    <header class="bar">
      <span :class="terminal ? 'ident' : 'wordmark'">{{
        terminal ? 'ZHITUAN' : '纸团'
      }}</span>
      <span class="bar-right">
        <!--
          添加。摆在页眉右端，而不是那一列行的末尾：列里的行是按实测高度量出来的
          （见文件头那一笔账），在末尾吊一行按钮，那一笔账处处都要多留一格；
          页眉是固定的一档，添一枚按键不动那一笔账。
          终端世界印 `ADD`：那一套世界的读数用的是英文键（SITES / TABS），
          控制项的文案仍是中文——这一枚说的是动作，因此跟着读数那一套走。
        -->
        <button
          class="add"
          type="button"
          :title="terminal ? 'add site' : '添加一个站点'"
          @mousedown.prevent
          @click="openAdd"
        >
          <Icon v-if="!terminal" name="plus" :size="compact ? 11 : 12" />
          <span>{{ terminal ? 'ADD' : '添加' }}</span>
        </button>
        <span class="meta tnum">
          {{ terminal ? `TABS ${tabCount}` : `标签 ${tabCount}` }}
        </span>
      </span>
    </header>

    <!--
      输入行。现代世界是一条下划线上放着放大镜与占位提示，终端世界是提示符
      后面那一格加块状光标——两边的骨架是同一段，因此高度与位置一样。
    -->
    <form class="prompt" :class="{ empty: !query }" @submit.prevent="onSubmit(query)">
      <span class="lead" aria-hidden="true">
        <Icon v-if="!terminal" name="search" :size="compact ? 13 : 15" />
        <template v-else>&gt;</template>
      </span>
      <span class="field">
        <input
          ref="promptEl"
          :value="query"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="placeholder"
          :aria-label="terminal ? '命令或搜索' : '网址或关键词'"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown="onInputKeydown"
          @focus="focused = true"
          @blur="focused = false"
        />
        <!--
          块状光标只在提示行空着的时候画（两套世界只有终端有它）。
          它画不了「文字中间」那个位置：块要跟到插入点，就得实时量出光标前那截
          文字的宽度，而那点宽度一旦算错，光标就指着一个不是插入点的地方闪——
          改一个网址中间的字时尤其气人。因此空行时给方块（这是终端的样子），
          一旦有字就交回系统那根细光标（它永远说的是真话）。
        -->
        <span v-if="terminal && !query" class="cursor" :class="{ lit: focused }" aria-hidden="true" />
      </span>
    </form>

    <!--
      栏目线。当前那一栏的字大、其余的字小，一行共用同一条基线——
      报纸的刊头就是这么排的。底下那根细线把「栏目」与「这一栏的内容」分开。

      语义上是六个「按下去了没有」的键（aria-pressed），不是一组 tab：
      tab 那一套要求左右键在**键之间移动焦点**，而这里按左右键换的是底下那摊内容，
      焦点始终留在输入行上（用户多半正准备接着打字）。
    -->
    <nav class="plates" aria-label="板块">
      <button
        v-for="s in sections"
        :key="s.id"
        class="plate"
        :class="{ on: s.id === plate && !searching, settle: settling }"
        :data-plate="s.id"
        :aria-pressed="s.id === plate && !searching"
        :title="s.label"
        @mousedown.prevent
        @click="pickPlate(s.id)"
      >
        <span class="plate-text">{{ narrow ? s.short : s.label }}</span>
      </button>
    </nav>

    <div ref="area" class="lines">
      <!--
        一列行。换栏时整块重排，因此这一格带 key：栏变了就是新的一列，
        Vue 换掉这棵子树，下面那条动画跟着走一遍。打字过滤时**不**重放——
        那是同一个动作的延续，不是新的一栏；key 只看栏目与「在不在搜索」，
        不看输入框里那几个字。
      -->
      <div class="rows" :class="{ settle: settling }" :key="columnKey">
        <!--
          一行。外面是 div 而不是 button：这一行里面还要再放两枚按键
          （编辑 / 移除），而 button 里嵌 button 是非法结构——浏览器会把内层那个
          拆出去，于是点「移除」时外层那条也会跟着走一遍，两件事一起发生。
          可点的那一整块因此收成里面那个 button.open，键盘与读屏认的仍是它。

          `row.tile` 有值才露那两枚按键：「继续上次」与本机文件那几行不是站点，
          删掉一行「继续上次」并不等于那个站点没了（见 HomeRow.tile）。
        -->
        <div
          v-for="(row, i) in visible"
          :key="row.key"
          class="line"
          :class="{ sel: i === sel, resume: row.verb === 'resume', file: row.verb === 'open-file' }"
          @mouseenter="sel = i"
        >
          <button
            class="open"
            type="button"
            :title="row.local ? undefined : row.url"
            @click="pick(row)"
          >
            <!--
              动词列固定宽度，两套世界共用。站点名称因此永远对齐在同一列上，
              而「继续」「打开文件」这两行的话也是从这一列说出来的。
              网格那两档里它让位给图标（见样式里那条 .verb 的规矩）。
            -->
            <span class="verb">{{ verbOf(row) }}</span>
            <!--
              图标是这一套世界的皮：终端那边只有字。
              本机文件的那些行（以及「打开文件…」）画文件，站点画图标，
              两边都没有的落到首字母那一格上——每一格都填满 18px，后面的名称才对得齐。
            -->
            <span v-if="!terminal" class="favicon">
              <Icon v-if="row.local" name="file" :size="14" />
              <template v-else-if="row.icon">
                <img
                  :src="row.icon"
                  alt=""
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
              </template>
              <span v-else class="initial">{{ initialOf(row.label) }}</span>
            </span>
            <span class="label">{{ row.label }}</span>
            <span class="host">{{ row.host }}</span>
          </button>

          <span v-if="row.tile" class="acts">
            <!--
              data-act 只是给探针认的（与 .view 上的 data-view 同一个用处）：
              这两枚的文案随世界变（现代世界「编辑 / 移除」、终端世界
              edit/del），按文字去认会在换皮时认错人。
            -->
            <button
              type="button"
              class="act"
              data-act="edit"
              :title="terminal ? 'edit site' : '改这一行的名字或网址'"
              @click="editRow(row)"
            >{{ terminal ? 'edit' : '编辑' }}</button>
            <button
              type="button"
              class="act"
              data-act="del"
              :title="terminal ? 'remove site' : '从这一列移除'"
              @click="removeRow(row)"
            >{{ terminal ? 'del' : '移除' }}</button>
          </span>
        </div>
        <p v-if="!visible.length" class="none">
          <span v-if="terminal" class="verb">--</span>
          <span class="label">{{ emptyText }}</span>
        </p>
      </div>

      <!--
        收尾线：这一栏**真的**到底了才画。行被上限截掉时它就是在说谎——
        而这一页从不滚动，截掉的那些只能靠输入框找回来。
      -->
      <span v-if="closed" class="end" aria-hidden="true" />
    </div>

    <!--
      这一栏的格式说明。它排在内容行之外、状态行之上：内容行那一格是量出来的，
      说明条自己占掉多少高度，可容纳的行数就少几行——不必两处各算一次。
    -->
    <p v-if="note" class="note">{{ note }}</p>

    <footer class="status">
      <span class="stat tnum">{{ statText }}</span>
      <span class="keys">{{ keysHint }}</span>
      <!--
        排布三档。分段控件而不是一枚循环切换的按键：三档是**同时存在**的三个
        选项，看得见现在在哪一档、也看得见还有另外两档——而这一页上「现在是什么
        状态」正好是它最要紧的一件事（与状态行那句读数同一个道理）。
        按左右键换板块的提示就写在旁边那一句里，两者不会说岔（见 keysHint）。
      -->
      <span class="views" role="group" aria-label="站点排布">
        <button
          v-for="v in views"
          :key="v.id"
          class="view"
          type="button"
          :class="{ on: v.id === view }"
          :data-view="v.id"
          :aria-pressed="v.id === view"
          :title="v.hint"
          @mousedown.prevent
          @click="emit('pickView', v.id)"
        >{{ v.label }}</button>
      </span>
      <ThemeMenu :variant="terminal ? 'terminal' : 'modern'" :theme="theme" @pick="emit('pick', $event)" />
    </footer>

    <!--
      站点编辑器：盖在整页之上（它是这一页唯一一个浮层，理由见 SiteEditor 开头
      那一段）。摆在这里而不是嵌进某一行的位置，是因为嵌进去会让整列重排一次，
      而正在改的就是那一列里的一行——行会跳。

      初值只在打开那一刻取一次：v-if 每次都重新挂载，于是换一行编辑时那两格
      是那一行现在的内容，而不是上一行的残留。
    -->
    <SiteEditor
      v-if="editing"
      :mode="editing.mode"
      :initial="editorInitial()"
      :terminal="terminal"
      :compact="compact"
      @save="onEditorSave"
      @close="closeEditor"
    />
  </div>
</template>

<style scoped>
.modern,
.term {
  width: 100%;
  height: 100%;
  background: var(--ground);
  display: flex;
  flex-direction: column;
  padding: 18px 22px 12px;
  overflow: hidden;
  font-size: 13px;
  /* 站点编辑器是盖在整页上的一层（position: absolute; inset: 0），
     参照的就是这一格 */
  position: relative;
}

.modern.compact,
.term.compact {
  padding: 10px 14px 8px;
  font-size: 12px;
}

/* ---------------------------------------------------------------- 页眉 */

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--text-tertiary);
}

.wordmark {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text);
  /* 标识折行就不是标识了；挤不下时宁可挤旁边的读数 */
  flex: 0 0 auto;
  white-space: nowrap;
}

.modern.compact .wordmark {
  font-size: 13px;
}

.ident {
  color: var(--accent);
  /* 比正文更亮一点的余辉：屏幕上的亮字，只有型号名与提示符够得上这个待遇 */
  text-shadow: 0 0 5px color-mix(in srgb, currentColor 50%, transparent);
  white-space: nowrap;
  overflow: hidden;
}

.bar .meta {
  flex: 0 0 auto;
}

.modern.compact .bar .meta,
.term.compact .bar .meta {
  display: none;
}

/*
 * 页眉右端那一组：添加 + 标签数。
 * 分成一组是因为 .bar 是 space-between——三件东西直接排进去，
 * 「添加」会被推到这一行的正中间去。
 */
.bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  /* 页眉是固定的一档：这一组挤不下时，挤的是左边的标识 */
  white-space: nowrap;
}

/*
 * 添加。现代世界是一枚加号加两个字，终端世界只有 `ADD`。
 *
 * 为什么不是一枚光秃秃的加号：这一页上「添加一个站点」「改这一行」「移除这一行」
 * 是同一族动作，而后两者印的只能是字——这两个动作都是对**这一行**做的，
 * 一枚图标画不清是哪一行，更画不清「移除」与「清空」的差别。
 * 一族动作两种长相，读起来就散成两件事。加号于是只当那一枚前缀。
 *
 * 终端世界的写法跟着读数那一套（SITES / TABS 都是英文键），只是它带按下的
 * 状态，因此用强调色——那一套世界里的亮色一共只给三处：
 * 标识、提示符、当前栏那一枚光标。
 */
.add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--text-tertiary);
  transition: color 100ms ease-out, background 100ms ease-out;
}

.add:hover {
  color: var(--accent);
  background: var(--ground-hover);
}

.term .add {
  color: var(--accent);
  letter-spacing: 0.14em;
}

.term .add:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

/* ---------------------------------------------------------------- 输入行 */

/* 一条下划线，不做成一枚胶囊：与终端世界的提示行是同一段划分，
   换个主题不该让这一行的高度和位置跟着变 */
.prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--divider-strong);
  color: var(--text-tertiary);
}

.term .prompt {
  border-bottom-color: var(--divider);
}

.modern.compact .prompt,
.term.compact .prompt {
  margin-top: 6px;
}

.prompt:focus-within {
  border-color: var(--accent);
  color: var(--accent);
}

.lead {
  flex: 0 0 auto;
  display: inline-flex;
}

/* 终端世界的提示符与标题行同一个待遇：屏幕上最亮的一点 */
.term .lead {
  color: var(--accent);
  text-shadow: 0 0 5px color-mix(in srgb, currentColor 50%, transparent);
}

/* 输入框与块状光标叠在一起：输入框收字，光标只是行首那一格 */
.field {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 20px;
  overflow: hidden;
}

.field input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}

.field input::placeholder {
  color: var(--text-tertiary);
}

/* 焦点环画在整条输入行上，输入框自身不画第二道 */
.field input:focus-visible {
  outline: none;
}

/* 空行时方块光标占着行首，系统那根细光标就不要了，否则是两根 */
.term .prompt.empty .field input {
  caret-color: transparent;
}

.cursor {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 15px;
  background: var(--accent);
  opacity: 0.5;
}

/* 有焦点时它才是「等你打字」的那一格，才闪 */
.cursor.lit {
  opacity: 1;
  animation: blink 1.1s step-end infinite;
}

.term.compact .cursor {
  height: 13px;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* ---------------------------------------------------------------- 栏目线 */

/*
 * 一行栏目键。当前那一栏的字比其余大一个数量级（报纸的刊头就是这么排的），
 * 两者共用同一条基线，因此这一行的高度由大字决定，小字吊在它的基线上。
 *
 * 底下那根细线用绝对定位的 ::before 画，不用 border-bottom：当前栏的强调色
 * 短线要正好压在这根细线上（它自己的下沿就是这一行的下沿），
 * 而 ::before 排在所有按钮之前，压不住它。
 */
.plates {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 18px;
  margin-top: 12px;
  flex: 0 0 auto;
}

.plates::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--divider);
}

.plate {
  position: relative;
  padding-bottom: 6px;
  /* 栏目线是这一页报头的一部分，因此整条都用展示字：
     它是一行**排出来的字**，不是一排控件。字大小的差别承担层级，
     字面从头到尾是同一个 */
  font-family: var(--font-display);
  font-size: 12px;
  line-height: 1.15;
  color: var(--text-tertiary);
  white-space: nowrap;
  transition: color 120ms ease-out;
}

.plate:hover {
  color: var(--text-secondary);
}

.plate.on {
  font-size: 26px;
  color: var(--text);
}

/* 当前那一栏的强调色短线，正好压在下划线上。
   它从左边画出来（而不是直接出现）：换栏这一下与底下那一列的落定是同一个
   动作的两半，因此同一个时长、同一条缓动。
   和那一列一样，只在真的换过一栏之后才画一遍（见 .rows.settle）。 */
.plate.on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  transform-origin: left center;
}

.plate.on.settle::after {
  animation: rule-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes rule-in {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* 终端世界不画下划线：它用块光标。直角那一组里多一条 2px 的横杠，
   读起来像半截下划线而不是光标 */
.term .plate.on::after {
  display: none;
}

.term .plate.on .plate-text::before {
  content: '▌';
  color: var(--accent);
}

.compact .plate.on {
  font-size: 18px;
}

.compact .plate {
  font-size: 11px;
  gap: 12px;
}

.compact .plates {
  gap: 12px;
  margin-top: 8px;
}

/* ---------------------------------------------------------------- 内容行 */

.lines {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/*
 * 一列行。换栏时整块重排（见模板里那个 key），因此它是这一页唯一一个
 * 被安排过的动作：新的一列从**已经看得见**的那一档（0.55）落定下来，
 * 不是从无到有。指数缓出，180ms，一次就完。
 *
 * 挂在 `.settle` 上而不是 `.rows` 上：那个类只有真的换过一栏之后才有，
 * 于是首帧不会走一遍（见脚本里 settling 那一段）。
 */
.rows {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
}

.rows.settle {
  animation: settle 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes settle {
  from {
    opacity: 0.55;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/*
 * 收尾线：这一栏到底了（行都在，没有被上限截掉），压在列的最下面、
 * 居中一条短线。报纸收尾画的就是这个——不是「更多」，是「完了」。
 */
.end {
  flex: 0 0 auto;
  margin: auto auto 0;
  width: 56px;
  height: 1px;
  background: var(--divider-strong);
}

.line,
.none {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  /* 一列行不缩：行高是量出来的一档，被挤扁就不是那一档了 */
  flex: 0 0 auto;
  height: var(--row-h);
  padding: 0 8px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
}

/*
 * 行的底、圆角与悬停都留在**外格**上，里面那个 button.open 只负责接鼠标与键盘：
 * 高亮要是画在内层，右端那两枚按键就落在高亮之外，看着像贴上去的补丁。
 */
.line {
  position: relative;
  border-radius: var(--radius-sm);
  transition: background 100ms ease-out;
}

.term .line,
.term .none {
  gap: 12px;
  border-radius: 0;
}

/*
 * 可点的那一整块。它是一枚原生 button，因此浏览器给的边框、底、字体都归零，
 * 只留「按得下去」这件事——看起来是这一行在响应，而不是行里嵌了一枚按键。
 */
.open {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  outline: none;
}

.term .open {
  gap: 12px;
}

/* 焦点环画在整行上：内外两圈环会打架，而这一页的焦点本来就整副在输入行上 */
.open:focus-visible {
  outline: none;
}

.line:focus-within {
  background: var(--ground-hover);
}

/*
 * 编辑 / 移除。
 *
 * 绝对定位盖在行的右端，而不是排在名字后面：常驻的话每一行都要给它让出
 * 小半行名字的宽度，而这一页上大多数时候没人要改东西——一列站点首先是用来点的。
 * 盖住的是左边那截内容（列表里是域名，网格里是名字的尾巴），因此底要跟行一样：
 * 只在悬停或选中时露出来，而这两种情形下行的底正好都是 --ground-hover，
 * 压在左邻上就看不见接缝。终端世界行的底也是同一个变量，因此两边共用这一条。
 *
 * 网格那两档改挂到右上角：那里的内容居中，右下角是名字，压上去会挡住要看的字。
 */
.acts {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  align-items: center;
  gap: 2px;
  padding-left: 6px;
  background: var(--ground-hover);
  border-radius: var(--radius-sm);
}

.line:hover .acts,
.line.sel .acts {
  display: flex;
}

.act {
  height: 18px;
  padding: 0 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  font-size: 11px;
  color: var(--text-secondary);
  transition: color 100ms ease-out, background 100ms ease-out;
}

.act:hover {
  color: var(--accent);
  background: var(--ground-active);
}

.term .act {
  letter-spacing: 0.06em;
}

.line:hover,
.line.sel {
  background: var(--ground-hover);
}

.line.sel .label {
  color: var(--text);
}

/* 动词列固定宽度。两套世界都用它，站点名称才对得齐 */
.verb {
  flex: 0 0 auto;
  width: 2.4em;
  font-size: 12px;
  color: var(--text-tertiary);
}

.term .verb {
  /* 终端世界印的是完整的动词（`open-file` 是最长的一个），列要够宽 */
  width: 6.5em;
  font-size: inherit;
}

.line.resume .verb,
.line.file .verb {
  color: var(--accent);
}

.term .line.sel .verb {
  color: var(--accent);
}

.none .label {
  color: var(--text-tertiary);
}

/* 图标是这一套世界的皮：终端那边只有字。
   这一格本身不画底：它有 18px 宽，是用来把后面的名称对齐到同一列的，
   底下那圈「图标底」只给首字母垫——没有图标也没有首字母时它就是个洞，
   在深色主题上尤其像掉了一格。 */
.favicon {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.favicon img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

.initial {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  /* 直角那一套世界里没有圆：这一格是方的，跟着 --radius-sm 走，
     换到终端世界（全部归零）它就是正方的 */
  border-radius: var(--radius-sm);
  background: var(--tile);
  font-size: 11px;
  color: var(--text-secondary);
}

.label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.host {
  flex: 0 0 auto;
  max-width: 34%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--text-tertiary);
}

.modern.compact .host,
.term.compact .host {
  display: none;
}

/* ---------------------------------------------------------------- 网格式排布 */

/*
 * 站点那一列的另外两档：小图标与图标。
 *
 * 三档共用同一份行数据、同一副键盘、同一条选中逻辑（见 useRows），差别全在这里。
 * 于是「换一档排布」不动这一页的任何行为——它动的是格子多大、图标多大、
 * 哪几列字还留着。
 *
 * 格子的尺寸与列数都是算出来的（见脚本里的 CELL 与 cols），这里只负责画：
 * 高度写死成 --cell-h，因为「一屏放得下几格」正是按它算的——让格子被内容
 * 撑高，那一笔账当场就错了。宽度用 1fr 摊满一行：算出来的列数是「至少放得下
 * 这么多格」，摊满之后每格比设计宽度略宽一点点，右边因此不留一条参差的白边。
 */
[data-view='grid'] .rows,
[data-view='icons'] .rows {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: var(--cell-gap);
  align-content: start;
}

/* 一格：图标在上面，名字在下面，居中。名字太长就自己截断，不缩字号 */
[data-view='grid'] .line,
[data-view='icons'] .line {
  height: var(--cell-h);
  padding: 0 6px;
}

[data-view='grid'] .open,
[data-view='icons'] .open {
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

/* 动词列与域名那一列在网格里没有位置：一格就这么大，字要留给名字 */
[data-view='grid'] .verb,
[data-view='grid'] .host,
[data-view='icons'] .verb,
[data-view='icons'] .host {
  display: none;
}

/*
 * 「继续上次」那一格是唯一的例外：列表里它靠动词列那两个字认出来，
 * 网格里没有那一列，于是把「继续」挪到名字底下——否则这一格与一个普通站点
 * 长得一模一样，点下去才知道是「回上次那个地方」。
 * order 排在域名之后（10 比 9 大）：那两个字是这一格的**状态**，永远在最后一行。
 */
[data-view='grid'] .line.resume .verb,
[data-view='icons'] .line.resume .verb {
  display: block;
  order: 10;
  width: auto;
  font-size: 10px;
  line-height: 1;
  color: var(--accent);
}

/* 域名那一行只在大格里有位置；迷你档整组不留它（与列表里那笔账同一个道理） */
[data-view='icons'] .host {
  display: block;
  order: 9;
  max-width: 100%;
  font-size: 10px;
  line-height: 1;
}

.compact[data-view='icons'] .host {
  display: none;
}

[data-view='grid'] .label,
[data-view='icons'] .label {
  flex: 0 0 auto;
  max-width: 100%;
  font-size: 11px;
  line-height: 1.25;
}

[data-view='icons'] .label {
  font-size: 12px;
}

/* 图标那一格：网格里它是主角，因此放大到与格子相称的分量上 */
[data-view='grid'] .favicon,
[data-view='grid'] .initial {
  width: 22px;
  height: 22px;
}

[data-view='grid'] .favicon img {
  width: 22px;
  height: 22px;
}

[data-view='grid'] .initial {
  font-size: 12px;
}

[data-view='icons'] .favicon,
[data-view='icons'] .initial {
  width: 34px;
  height: 34px;
}

[data-view='icons'] .favicon img {
  width: 34px;
  height: 34px;
}

[data-view='icons'] .initial {
  font-size: 16px;
}

/* 网格里那两枚按键挂到右上角（理由见 .acts 那一段） */
[data-view='grid'] .acts,
[data-view='icons'] .acts {
  top: 4px;
  transform: none;
}

/* 空列那句提示铺满整行，别缩进第一格里去 */
[data-view='grid'] .none,
[data-view='icons'] .none {
  grid-column: 1 / -1;
}

/* ---------------------------------------------------------------- 格式说明 */

.note {
  flex: 0 0 auto;
  margin: 6px 0 0;
  padding: 6px 8px 0;
  border-top: 1px solid var(--divider);
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-tertiary);
}

.compact .note {
  font-size: 11px;
  padding-top: 4px;
}

/* ---------------------------------------------------------------- 状态行 */

.status {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--divider);
  font-size: 11px;
  color: var(--text-tertiary);
}

/* 迷你档整组降一档，但读数与主题键**不降到 11px 以下**：
   它们是这一页上唯一两处「现在是什么状态」，而这一页的全部意义是
   在别人看过来之前让人自己知道现在是什么状态 */
.modern.compact .status,
.term.compact .status {
  font-size: 11px;
}

.status .stat {
  flex: 0 0 auto;
  color: var(--accent);
}

.status .keys {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-align: right;
}

.modern.compact .status .keys,
.term.compact .status .keys {
  visibility: hidden;
}

/*
 * 站点排布那三档。
 *
 * 排成一段（分段控件）而不是一枚循环切换的按键：三档是同时存在的三个选项，
 * 这样一眼看得见现在在哪一档、也看得见还有另外两档——而「现在是什么状态」
 * 正好是这一页最要紧的一件事（与左边那句读数是同一个道理）。
 *
 * 字号跟着状态行，不再往下缩：这一行是那一页上两处「现在是什么状态」之一。
 */
.views {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-pill);
  background: var(--tile);
}

.view {
  height: 18px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-pill);
  background: none;
  font: inherit;
  font-size: 11px;
  color: var(--text-tertiary);
  transition: color 100ms ease-out, background 100ms ease-out;
}

.view:hover {
  color: var(--text-secondary);
}

/* 选中那一枚：底是强调色、字是页底那个颜色——与编辑器里那枚「保存」同一条
   反转的规矩（写死白色的话，暗夜与磷绿那两套配色里等于白压亮，见 SiteEditor） */
.view.on,
.view.on:hover {
  background: var(--accent);
  color: var(--ground);
}

.view.on:hover {
  background: var(--accent-hover);
}

/* 主题菜单自己带 flex 布局，这里只把它钉在右端 */
.status :deep(.theme-menu) {
  flex: 0 0 auto;
}

/*
 * 撤掉动画的位置在整份样式的最后：这几条与上面那几条**同等特异**，
 * 只有排在后面才压得住它们。
 *
 * 撤掉的是动画，不是结果——换栏那一下仍然是换了一栏，只是当场换完；
 * 方块光标仍然是「等你打字」的那一格，只是不闪。
 */
@media (prefers-reduced-motion: reduce) {
  .cursor.lit,
  .rows.settle,
  .plate.on.settle::after {
    animation: none;
  }
}
</style>
