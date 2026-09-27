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
import Icon from '../chrome/Icon.vue'
import { useBox } from './useBox'
import { filterRows, useRowList, type HomeRow } from './useRows'
import { SECTIONS, type HomeTheme, type HomeWorld, type SectionId } from '@shared/constants'

const props = defineProps<{
  rows: HomeRow[]
  /** 此刻停在哪一栏。输入框里有字时它不高亮（那时搜的是全部板块） */
  plate: SectionId
  /** 状态行左端那个读数：这一栏里数的是什么、有多少，由 HomeApp 定 */
  stat: { kind: 'site' | 'local' | 'match'; count: number }
  tabCount: number
  query: string
  theme: HomeTheme
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
  pickPlate: [id: SectionId]
  movePlate: [delta: number]
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

const filtered = computed(() => filterRows(props.rows, props.query))

const area = useTemplateRef<HTMLElement>('area')
const { h: areaH } = useBox(area)

/** 一屏放得下的行数。至少留一行——能放一行也比空着强 */
const limit = computed(() => Math.max(1, Math.floor(areaH.value / ROW_H.value)))

const { visible, sel, pick, reset, onKeydown, onSubmit } = useRowList(filtered, limit, {
  open: (url) => emit('open', url),
  resume: () => emit('resume'),
  openFile: () => emit('openFile'),
  submit: (text) => emit('submit', text),
  clearQuery: () => emit('update:query', '')
})

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
 * 输入框里的左右键：栏目线空着的时候换栏。
 *
 * 只在这一种情况下让出左右键——输入框里有字时它们必须还是「移动插入点」，
 * 否则改一个网址中间的那个字母就会莫名其妙地跳栏。
 */
function onInputKeydown(event: KeyboardEvent): void {
  const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
  if (dir && !props.query.trim()) {
    event.preventDefault()
    emit('movePlate', dir)
    return
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

const keysHint = computed(() =>
  terminal.value
    ? '回车打开 · ←→ 换板块 · ALT+Z 最小化 · ALT+X 藏进托盘'
    : '← → 换板块 · Alt+Z 最小化 · Alt+X 藏进托盘'
)

function initialOf(name: string): string {
  return [...name.trim()][0] ?? '·'
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
 */
function focusPrompt(): void {
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
  if (target?.closest('button, input, a, .theme-menu')) return
  focusPrompt()
}
</script>

<template>
  <div
    ref="root"
    :class="[terminal ? 'term' : 'modern', { compact, narrow }]"
    :style="{ '--row-h': ROW_H + 'px' }"
    @click="onRootClick"
  >
    <header class="bar">
      <span :class="terminal ? 'ident' : 'wordmark'">{{
        terminal ? 'ZHITUAN' : '纸团'
      }}</span>
      <span class="meta tnum">
        {{ terminal ? `TABS ${tabCount}` : `标签 ${tabCount}` }}
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
        <button
          v-for="(row, i) in visible"
          :key="row.key"
          class="line"
          :class="{ sel: i === sel, resume: row.verb === 'resume', file: row.verb === 'open-file' }"
          :title="row.local ? undefined : row.url"
          @click="pick(row)"
          @mouseenter="sel = i"
        >
          <!--
            动词列固定宽度，两套世界共用。站点名称因此永远对齐在同一列上，
            而「继续」「打开文件」这两行的话也是从这一列说出来的。
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
      <ThemeMenu :variant="terminal ? 'terminal' : 'modern'" :theme="theme" @pick="emit('pick', $event)" />
    </footer>
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

.line {
  border-radius: var(--radius-sm);
  transition: background 100ms ease-out;
}

.term .line,
.term .none {
  gap: 12px;
  border-radius: 0;
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
