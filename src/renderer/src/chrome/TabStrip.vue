<script setup lang="ts">
/**
 * 顶栏上的标签条：各个**网页**各占一格，点一下就切过去。
 *
 * 起始页与系统设置不在这里：它们不是标签页，而是窗口里的两「屏」，
 * 各有各的入口（顶栏最左并排的那两颗键：起始页、设置），
 * 停在它们上面时这一条里没有哪一格是高亮的。
 *
 * 为什么又把它拿回来：只有下拉清单时，「我现在开着哪些页」这件事在界面上
 * 完全看不见——清单要主动点开才知道，切换一个标签页得先点开、再找到、再点。
 * 标签条把这一层状态摆回明面上。
 *
 * 但仍要防着它把顶栏挤爆：窗口窄到放不下**全部**标签（迷你档尤其）时，
 * 这一条整体让位给原来的下拉清单——宁可不显示，也不显示一条被截断、
 * 需要横向滚动才能找到想去的那个的标签条。**判断依据是量出来的宽度**，
 * 不是窗口宽度：顶栏里还有导航、地址栏开关、新建按钮，留给标签条的
 * 是它们分剩下的那一块，只有量了才知道有多少。
 *
 * 让位那一枚是**分了两块**的：身子写着这一条代表的那张网页，按它进到那张网页里；
 * 右端那枚箭头才是「展开清单」。停在起始页 / 系统设置上时标签格看不见，
 * 这一枚因此是回到网页的唯一入口——按一下就得回去，不该先弹清单让人再找一遍。
 *
 * 量法：标签条始终挂着。放不下时给它 `position: absolute; visibility: hidden`
 * ——离开流（不占宽度、不把后面的按钮挤走），但照样能量出自己的自然宽度。
 * 因此「容量」这个数在两态下都算得出来，不会出现
 * 「一藏起来就显得放得下 → 又显示 → 又放不下」的来回抖。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { TabState } from '@shared/types'
import Icon from './Icon.vue'

const props = defineProps<{
  tabs: TabState[]
  activeTabId: string | null
  /**
   * 上一次看着的那张网页。
   *
   * 停在起始页 / 系统设置上时，让位后那一枚按钮代表的就是它——见 shownTab。
   * 与顶栏那个地址栏开关同一条规矩（见 TopBar 的 siteLabel）。
   */
  lastTabId: string | null
}>()

/** 标签之间的间距，与 .zone 的 gap 一致；算容量时要用到 */
const GAP = 4

/**
 * 标签条需要的宽度之外，再留一点余量。
 *
 * 上面那套算法是拿容器宽度减去同排控件的实测宽度得到的，取整与边框
 * 会有几个像素的出入。差这一两个像素的后果是最后一个标签被啃掉一条边，
 * 所以宁可早一点让位。
 */
const SLACK = 8

const zone = useTemplateRef<HTMLElement>('zone')
const strip = useTemplateRef<HTMLElement>('strip')
/** 让位时那一枚按钮。面板要按它的位置摆，因此整枚要能被拿到，不只是箭头那 16px */
const fallback = useTemplateRef<HTMLElement>('fallback')

/**
 * 是否给标签条腾出了位置。
 *
 * 初值为 true：标签条是这一栏的常态，先按常态排一帧，量完再决定要不要让位。
 * 反过来初值给 false 的话，每次开窗都要先闪一条下拉按钮出来。
 */
const fits = ref(true)

/**
 * 让位后那一枚按钮代表的那张网页。
 *
 * 看着网页时是当前那张；停在起始页 / 系统设置上时是**刚才那张**
 * （lastTabId，也就是左上角那两颗键再点一次会回到的那一张）。
 *
 * 于是切进切出自家那两屏时，这一枚**一个字都不变**——它写的是「一张网页」，
 * 而「此刻停在哪一屏」由那两颗键各自的高亮说（用户要求：点设置的时候这一块
 * 完全不变，好让他按一下就能回到原来那张网页里去）。这与顶栏那个地址栏开关
 * 同一条规矩（见 TopBar 的 siteLabel）。
 */
const shownTab = computed(() => {
  const id = props.activeTabId ?? props.lastTabId
  return props.tabs.find((t) => t.id === id) ?? null
})

/**
 * 按钮上写的字。
 *
 * 停在自家那两屏上时写的仍是刚才那张网页的标题，**不写那一屏的名字**：
 * 这一条是标签条，上面写的每一个词都该是「一张网页」。那两屏不是标签页，
 * 名字出现在这里，读起来就是一个叫「系统设置」的标签——正是先前那一版
 * 从标签条里清掉的东西。一张网页可指都没有时（全关光了）它是一格中性的
 * 「标签页」，数一数右边那枚小牌就知道开着几张。
 */
const shownTitle = computed(() => shownTab.value?.title || '标签页')

/** 按钮自己的提示语。写的是那张网页的名（与标签格同一条规矩：没有标题就用地址） */
const shownTip = computed(() => shownTab.value?.title || shownTab.value?.url || '标签页')

function measure(): void {
  const z = zone.value
  const s = strip.value
  if (!z || !s) return

  // 与标签条同排的还有别的控件（新建按钮），它们占掉的宽度得先扣出去。
  // 让位给下拉清单时，清单本身不算——它占的正是标签条的位置，
  // 算进去就等于「越窄越显得放不下」，标签条再也回不来。
  let used = 0
  let others = 0
  for (const child of Array.from(z.children)) {
    const el = child as HTMLElement
    if (el === s || el.classList.contains('rest') || el.classList.contains('fallback')) continue
    used += el.offsetWidth
    others += 1
  }

  // 在流里的东西：标签条、扣掉的那些、末尾那个弹性占位，间距因此是 others + 1 段
  const avail = z.clientWidth - used - (others + 1) * GAP
  fits.value = s.scrollWidth + SLACK <= avail
}

let ro: ResizeObserver | null = null

onMounted(() => {
  // 同步量一次：标签条按常态排完这一帧就该定下来，不必等下一帧
  measure()
  ro = new ResizeObserver(measure)
  if (zone.value) ro.observe(zone.value)
  // 字体的度量在首帧之后才落定，再量一次收口
  void document.fonts?.ready.then(() => measure())
})

onUnmounted(() => ro?.disconnect())

watch(
  () => props.tabs,
  () => void nextTick(measure)
)

function activate(tabId: string): void {
  if (tabId === props.activeTabId) return
  void window.zhituan.tabs.activate({ tabId })
}

function close(tabId: string): void {
  void window.zhituan.tabs.close({ tabId })
}

/**
 * 打开标签页清单。**只有那一枚箭头走这条**。
 *
 * 做成独立面板而不是 CSS 下拉：面板是另一个窗口，可以盖在网页上；
 * 顶栏里的 DOM 只要画到顶栏下沿以外就会被标签页视图整个盖住。
 * 锚点取**整枚按钮**的位置而不是箭头那十几像素：主进程按它把面板摆在
 * 按钮正下方，挂在箭头上会让整块面板跟着右移，看着像从按钮右边缘长出来的。
 */
function openList(): void {
  const el = fallback.value
  if (!el) return
  const r = el.getBoundingClientRect()
  void window.zhituan.ui.openPopover({
    kind: 'tabs',
    anchorRect: {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height)
    }
  })
}

/**
 * 按这一枚的**身子**：进到它写着的那张网页里去。
 *
 * 停在起始页 / 系统设置上时，这一枚是回到网页的唯一入口（那一档下标签格
 * 看不见），因此按一下就该回去，而不是弹一份清单让人再找一遍（用户要求：
 * 点设置的时候这一块完全不变，好按一下回到那个标签页里）。
 *
 * 一张网页都指不出来时（全关光了，它写的是中性的「标签页」）没地方可去，
 * 于是退成打开清单——清单那时也空着，但这条退路比按下去什么都不发生好懂。
 */
function enterShown(): void {
  const id = shownTab.value?.id
  if (id) activate(id)
  else openList()
}

function hideBrokenIcon(event: Event): void {
  ;(event.target as HTMLImageElement).style.display = 'none'
}
</script>

<template>
  <!--
    标签格自己声明 data-drag-ignore：按住一格拖动是「这一格的事」，
    不该顺手把窗口拖走。格子以外的空白（右端那一大块、格子之间的缝）
    仍然可以拖窗口——而且它正是顶栏里最大的一块可拖区域。
  -->
  <div ref="zone" class="zone">
    <div ref="strip" class="strip" data-drag-ignore :data-fits="fits" role="tablist" aria-label="标签页">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        role="tab"
        :class="{ on: tab.id === activeTabId }"
        :aria-selected="tab.id === activeTabId"
        :tabindex="tab.id === activeTabId ? 0 : -1"
        :title="tab.title || tab.url"
        @click="activate(tab.id)"
        @keydown.enter="activate(tab.id)"
        @keydown.space.prevent="activate(tab.id)"
        @mousedown.middle.prevent="close(tab.id)"
      >
        <span class="glyph" aria-hidden="true">
          <img v-if="tab.faviconUrl" :src="tab.faviconUrl" alt="" @error="hideBrokenIcon" />
          <span v-else class="dot" />
        </span>
        <span class="title">{{ tab.title || '新标签页' }}</span>
        <!--
          关闭键是 role="tab" 里的一个 <button>：外层用 div 而不是 button，
          按钮里套按钮在 HTML 里是错的，点击行为也会打架。
        -->
        <button class="x" title="关闭标签页" @click.stop="close(tab.id)">
          <Icon name="close" :size="10" />
        </button>
      </div>
    </div>

    <!--
      让位时的下拉清单。它是一枚**分了两块**的按钮：
      身子（写着这一条代表的那张网页）按下去进到那张网页里，
      只有右端那枚箭头展开清单——因此箭头是一枚真的 <button>，
      身子是一个 role="button" 的盒子（<button> 里套 <button> 在 HTML 里是错的，
      与上面标签格里那枚 ✕ 同一个理由）。身子自己也收键盘：Tab 走得到，
      回车 / 空格与点它是一回事。
    -->
    <div
      v-if="!fits"
      ref="fallback"
      class="fallback"
      data-drag-ignore
      role="button"
      tabindex="0"
      :title="shownTip"
      @click="enterShown"
      @keydown.enter="enterShown"
      @keydown.space.prevent="enterShown"
    >
      <span class="title">{{ shownTitle }}</span>
      <span v-if="tabs.length > 1" class="count">{{ tabs.length }}</span>
      <button class="caret" title="展开标签页清单" @click.stop="openList">
        <Icon name="chevron-down" :size="12" />
      </button>
    </div>

    <!-- 新建标签页跟在标签条（或那个下拉）后面，浏览器就是这么摆的。由顶栏塞进来 -->
    <slot />

    <!-- 吃掉剩余宽度，把窗口操作那组推到最右。它自己不是控件，算容量时跳过 -->
    <span class="rest" aria-hidden="true" />
  </div>
</template>

<style scoped>
.zone {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  /* 让位后的标签条是绝对定位的，锚在这个盒子的左端 */
  position: relative;
  overflow: hidden;
}

.strip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

/*
 * 放不下：离开流，但仍挂着——量宽度得靠它自己。
 * 用 visibility 而不是 display: none，后者量出来是 0，两态之间就会来回抖。
 */
.strip[data-fits='false'] {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  pointer-events: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 下限保证每格都还认得出是个标签，上限防着一篇长标题把整条吃光 */
  min-width: 84px;
  max-width: 180px;
  height: 26px;
  padding: 0 3px 0 8px;
  border-radius: var(--zhituan-radius);
  color: var(--zhituan-text-dim);
  white-space: nowrap;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.tab:hover {
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-ink);
}

/* 当前这一格：与地址栏开关的「展开中」同一套说法——底色抬起，文字压深 */
.tab.on {
  background: var(--zhituan-surface-active);
  color: var(--zhituan-ink);
}

.glyph {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  color: var(--zhituan-text-faint);
}

.tab.on .glyph {
  color: var(--zhituan-accent);
}

.glyph img {
  width: 14px;
  height: 14px;
  object-fit: contain;
}

/* 没有图标也不换过图标的站点：一个灰点，比留空整齐 */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
 * 关闭键平时不画。用 visibility 而不是 display: none——它得一直占着那 18px，
 * 否则鼠标扫过标签时文字会随着按钮出现而缩一截，看着像在抖。
 */
.x {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: var(--zhituan-radius-sm);
  color: var(--zhituan-text-faint);
  visibility: hidden;
}

/*
 * 只在标签条真的在显示时才露出来。
 *
 * `visibility` 是可继承的，但后代能把它改回去——上面那条让位规则隐藏了整条标签条，
 * 而 `.tab.on .x` 会把当前那一格的关闭键重新点亮，于是在下拉按钮旁边、
 * 标签条本该不在的地方留下一个孤零零的 ✕（还能被 Tab 键选中）。
 * 因此这两条必须挂在「显示中」这一态上。
 */
.strip[data-fits='true'] .tab:hover .x,
.strip[data-fits='true'] .tab.on .x {
  visibility: visible;
}

.x:hover {
  background: var(--zhituan-surface);
  color: var(--zhituan-danger);
}

/*
 * 让位时的下拉清单：形状沿用地址栏开关那一套，宽度由容器给。
 *
 * 它是 div 而不是 button（身体里还要放一枚真的箭头按钮），因此
 * `cursor` 要自己写——那片全局重置是挂在 button 上的。它也一样声明
 * data-drag-ignore：按住这一枚是「点它」，不该顺手把窗口拖走。
 */
.fallback {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 190px;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--zhituan-radius-pill);
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-text-dim);
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.fallback:hover {
  background: var(--zhituan-surface-active);
  color: var(--zhituan-ink);
}

/* 窄到只剩几十像素时先舍标题，标签数那枚小牌与箭头要留住 */
.fallback .title {
  flex: 0 1 auto;
}

/*
 * 箭头：这一枚展开清单，身子那一块进网页，两块得分得出来。
 *
 * 分隔线用伪元素而不是 border-left：整高的一道线会顶到胶囊的上下边缘，
 * 看着像把按钮劈成了两半；14px 居中那一小段才读得出「这里是个把手」。
 * 颜色跟 currentColor 走而不是 hairline——悬停时整枚的字会压深，
 * 线跟着压深才像同一枚按钮的一部分。
 */
.caret {
  flex: 0 0 auto;
  position: relative;
  width: 16px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: var(--zhituan-radius-sm);
}

.caret::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 50%;
  height: 14px;
  transform: translateY(-50%);
  border-left: 1px solid currentColor;
  opacity: 0.35;
}

/* 与标签格那枚 ✕ 同一套悬停说法：抬起底色，字压深 */
.caret:hover {
  background: var(--zhituan-surface);
  color: var(--zhituan-ink);
}

.count {
  flex: 0 0 auto;
  min-width: 16px;
  padding: 0 4px;
  border-radius: var(--zhituan-radius-tag);
  background: var(--zhituan-surface-active);
  color: var(--zhituan-text-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.rest {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
