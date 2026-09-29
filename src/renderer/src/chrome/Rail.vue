<script setup lang="ts">
/**
 * 右侧功能栏。
 *
 * 历史、书签、缩放、三条透明度滑块这些原本摊在底栏的功能都收在这里。
 * 横屏下纵向空间最贵，而底栏那条横带子要吃掉整个宽度；换成一条竖栏，
 * 代价只是正文窄了 48px。
 *
 * 手机与置顶原本也是这里的两个按钮（写着汉字，一格一个），现在搬去了顶栏的图标组：
 * 它们改的是「这一页怎么显示」，与阅读本身无关，占着功能位不如让给滑块。
 *
 * 栏底那格「设置」也搬走了——用户要它挪到界面左上角并换成图标，现在它与起始页
 * 那颗键并排待在顶栏最左（见 TopBar.vue）。于是这一栏不再有「固定在栏底、
 * 滚不掉」的那一格：整条栈都能滚，最下面一条滑块不会被谁挤掉。
 *
 * 「站点」那一格也去了（1.6.7）：起始页自己就能添加、编辑、移除站点，
 * 那一格打开的面板做的正是同一件事——两处入口做同一件事，迟早会有一处先改。
 * 那一格空出来的高度给了下面那两格暂停开关，见模板里那段注释。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed } from 'vue'
import {
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  OPACITY_MAX,
  OPACITY_MIN,
  READER_OPACITY_MAX,
  READER_OPACITY_MIN
} from '@shared/constants'
import type { ConfigPatch } from '@shared/ipc'
import type { AppConfig, TabState } from '@shared/types'
import { isLocalFile } from '@shared/url'
import Icon from './Icon.vue'
import OpacitySlider from './OpacitySlider.vue'
import { openPopoverAt } from '../composables/usePopover'
import { useWindowDrag } from '../composables/useWindowDrag'

const props = defineProps<{
  config: AppConfig | null
  activeTab: TabState | null
  /** 顶栏已隐藏，球浮在本栏顶端，需要给它让出一段空白 */
  ballGapTop: boolean
}>()

const emit = defineEmits<{ patch: [patch: ConfigPatch] }>()

/** 整条栏可拖动。按在按钮与滑块上是操作，其余地方（格子之间、分隔线、栏内空白）都是拖窗口 */
const drag = useWindowDrag()

const zoomPercent = computed(() => Math.round((props.activeTab?.zoom ?? 1) * 100))

/**
 * 缩放这三格。它们作用在**某一页**上，因此停在起始页 / 设置上时没有可作用的对象
 * ——那三格显示的是默认值，点了也不会发生什么，于是干脆禁掉，而不是装作能点。
 */
function zoom(op: 'in' | 'out' | 'reset'): void {
  const tabId = props.activeTab?.id
  if (!tabId) return
  void window.zhituan.page.setZoom({ tabId, op })
}

/** 整扇窗的透明度，含网页 */
function setOpacity(value: number): void {
  void window.zhituan.win.setOpacity({ value })
}

/** 界面底板（顶栏、本栏、弹出面板）的透明度，网页不受影响 */
function setBackgroundOpacity(value: number): void {
  emit('patch', { ui: { backgroundOpacity: value } })
}

/**
 * 离线阅读透明度，界面与网页都不受影响。
 *
 * 同一个值在两处落点不一样（见 @shared/constants 的 READER_OPACITY_MIN）：
 * **PDF 阅读页**上它调的是那张纸——拉下去，一张白纸垫到字下面，字始终实心；
 * **本机 TXT** 上调的是正文本身——那一页是 Chromium 自己渲染的，我们碰不到
 * 它的底，只能整页淡（见 services/pageStyler.ts）。
 *
 * 判据是「此刻这张网页是不是本机文件」——本机 TXT 与自家 PDF 阅读页都对外的
 * 地址是 `file:`（见 @shared/url 的 isLocalFile），因此一个谓词两处通用。
 * 与上面两条不一样的是：**那两条任何时候都管得着**（窗与界面一直在），
 * 这一条只在读一本本机文件时才有对象。于是它按右栏那三格缩放的规矩来——
 * 没有对象就禁掉，而不是装作能点。
 */
function setReaderOpacity(value: number): void {
  emit('patch', { ui: { readerOpacity: value } })
}

const offlineReading = computed(() => isLocalFile(props.activeTab?.url))

const readerHint = computed(() =>
  offlineReading.value
    ? 'PDF 调的是垫在字下面那张纸（拉到底纸全实），TXT 调的是正文本身（那一页的底由 Chromium 画，碰不到）。界面与网页不受影响'
    : '离线阅读透明度——此刻没有正在读的本机文件。先打开一本：起始页 → 离线阅读 → 打开文件…'
)

/**
 * 收起时是否暂停网页里正在播的媒体。
 *
 * 这一项在系统设置里也有（隐蔽 → 收起时暂停音视频），两处改的是同一份配置，
 * 靠配置广播对齐——因此在设置里改完，这里那一格的高亮会跟着变。
 * 摆在本栏最上面那一行：小窗口下这条功能栈是**会滚的**（迷你档
 * 480×270 实测溢出 264px，默认档 960×540 刚好放满、溢出 0px），
 * 排在下面的东西等于藏起来了，而这一枚本来就是嫌设置里不好找才搬上来的。
 */
const pauseOnCollapse = computed(() => props.config?.stealth.muteMediaOnCollapse ?? false)

const pauseHint = computed(() =>
  pauseOnCollapse.value
    ? '收起时暂停播放 · 开：收起成球、藏进托盘、最小化都会暂停网页里正在播的媒体'
    : '收起时暂停播放 · 关：收起时网页继续在后台播放'
)

function togglePauseOnCollapse(): void {
  emit('patch', { stealth: { muteMediaOnCollapse: !pauseOnCollapse.value } })
}

/**
 * 切走时是否暂停那一页的媒体。
 *
 * 与上一格是两条独立的规矩（见 @shared/types 的 pauseMediaOnSwitch）：收起是
 * 「不能出声」，切走只是「不该在这儿播」——因此切走那一张只暂停、**不闭麦**。
 * 它不与上一格分开放：它们说的是同一件事（什么时候让网页停下来）的两个场合，
 * 一头一尾摆开等于让人去两处找，而这一栏本来就是嫌设置里不好找才长出来的。
 * 紧挨着排在上一格下面（1.6.7 之前是并排），高度账见模板里那段注释。
 */
const pauseOnSwitch = computed(() => props.config?.stealth.pauseMediaOnSwitch ?? false)

const switchHint = computed(() =>
  pauseOnSwitch.value
    ? '切走时暂停播放 · 开：切到别的标签、进起始页 / 设置都会暂停那一页，切回来接着放'
    : '切走时暂停播放 · 关：切走之后网页继续在后台播放'
)

function togglePauseOnSwitch(): void {
  emit('patch', { stealth: { pauseMediaOnSwitch: !pauseOnSwitch.value } })
}
</script>

<template>
  <aside
    class="rail"
    :class="{ 'ball-top': ballGapTop }"
    @pointerdown="drag.onPointerDown"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerCancel"
  >
    <div class="stack">
      <!--
        最上面这两格是「开关」——全栏只有这两格按下去就地切一个状态，其余要么
        打开面板、要么是滑块，高亮即当前状态（.item.on）。

        上下排，一格一行，各自独占一格（1.6.7 之前这两格并排挤在一行里）。
        顺序就是上面那格「收起时暂停」、下面那格「切走时暂停」，
        与它们在系统设置里那一栏的顺序一致。

        这一栏的高度是量着配的（默认档 960×540 刚好放满、溢出 0px，见 .stack 那条
        注释），因此这一改**一格都没多占**：原先那 7 个格子里有一格是这两格合挤的
        一行，现在少掉了「站点」那一格、多出来这两格，格子数前后都是 7，
        366px 那一笔账一个数都不用改（见 --zhituan-rail-track）。

        两格之间不留分隔线，紧挨着排：它们说的是同一件事（什么时候让网页停下来）的
        两个场合，一头一尾摆开等于让人去两处找。
      -->
      <button
        class="item"
        :class="{ on: pauseOnCollapse }"
        :title="pauseHint"
        @click="togglePauseOnCollapse"
      >
        <Icon name="pause" :size="14" />
      </button>
      <button
        class="item"
        :class="{ on: pauseOnSwitch }"
        :title="switchHint"
        @click="togglePauseOnSwitch"
      >
        <Icon name="stop" :size="14" />
      </button>

      <div class="sep" />

      <button class="item" title="历史记录" @click="openPopoverAt('history', $event)">历史</button>
      <button class="item" title="书签" @click="openPopoverAt('bookmarks', $event)">书签</button>

      <div class="sep" />

      <button
        class="item"
        :disabled="!activeTab"
        title="放大"
        @click="zoom('in')"
      >
        <Icon name="plus" :size="13" />
      </button>
      <button
        class="item percent"
        :disabled="!activeTab"
        title="重置缩放"
        @click="zoom('reset')"
      >
        {{ zoomPercent }}%
      </button>
      <button
        class="item"
        :disabled="!activeTab"
        title="缩小"
        @click="zoom('out')"
      >
        <Icon name="minus" :size="13" />
      </button>

      <div class="sep" />

      <OpacitySlider
        label="整体"
        hint="整扇窗，含网页"
        :model-value="config?.window.opacity ?? 1"
        :min="OPACITY_MIN"
        :max="OPACITY_MAX"
        @update:model-value="setOpacity"
      />

      <OpacitySlider
        label="背景"
        hint="只影响界面底板，网页不受影响"
        :model-value="config?.ui.backgroundOpacity ?? 1"
        :min="BACKGROUND_OPACITY_MIN"
        :max="BACKGROUND_OPACITY_MAX"
        @update:model-value="setBackgroundOpacity"
      />

      <!--
        第三条：离线阅读。前两条管窗口，这一条管「我正在读的那一份」——
        PDF 上是垫在字下面那张纸，TXT 上是正文本身——因此它们可以各走各的
        （界面 100% + 一张实心白纸是常用的一种搭配）。
        只在读本机文件时是活的（见 offlineReading）。
      -->
      <OpacitySlider
        label="阅读"
        :hint="readerHint"
        :model-value="config?.ui.readerOpacity ?? 1"
        :min="READER_OPACITY_MIN"
        :max="READER_OPACITY_MAX"
        :disabled="!offlineReading"
        @update:model-value="setReaderOpacity"
      />
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex: 0 0 var(--zhituan-rail-w);
  width: var(--zhituan-rail-w);
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: var(--zhituan-surface);
  border-left: 1px solid var(--zhituan-hairline);

  /*
   * 三条透明度滑块的轨道长度**按窗口高度算**，而不是写死 56px。
   *
   * 写死时的账（实测，spike/rail-hit.js 与 preview.js 的 RAIL_STACK）：
   * 默认档 960×540 下留给功能栈的正好是 488px，内容也是 488px，一格不多
   * 一格不少；可**窗口只要矮一点，最底下那条「阅读」滑块就被推到折叠线以下**。
   * 用户在 903×508 上量到的溢出是 26px——那条滑块（横条转 90° 画的，整条 56px）
   * 只剩上面 31px 露在外面，而折叠线以下先是窗口缩放下边手柄、再往下是空白。
   * 于是**它的拇指在约 60% 以下就整颗消失在裁剪线外**：低值那半条轨道既看不见
   * 也按不到，拖到那儿读数就不再跟手。用户报的「拖了一点变化都没有」正是这个。
   *
   * 因此轨道改成「有多少地方就画多长」：本栏的纵向开销是固定的（下面那串
   * 数字就是它），把剩下的按三条均分，再夹在 30px（还拖得动的下限）与 56px
   * （默认档的那个长度）之间。窗口够高时它就是 56px，与从前一模一样；
   * 变矮时三条一起缩，谁也不会被裁掉。
   *
   * 那几个常数是怎么来的（全部是实测出来的固定开销）：
   *   52px  = 顶栏 44 + 本栏上下内边距 4×2；
   *   227px = 栈里那 7 个固定高度的格子（26px 一个，含最上面那两格暂停开关）
   *           与 3 条分隔线（1px 高 + 上下各 3px 外边距）＝203px，加上 13 个子项
   *           之间的 12 条 2px 缝＝24px；
   *   87px  = 每个滑块自己那两行小字与内边距（12+1+12+1+2+1＝29px）乘三条。
   * 合计 366px，于是三条轨道一共能拿到「100vh − 366px」，每条再除以三。
   * 加了这几项、或改了格子的高度，这个数就要跟着改一次——它是量出来的，
   * 不是推出来的。1.6.7 去掉「站点」那格、把并排的两格开关拆成两行，
   * 格子数与子项数都没有变，因此这几个数一个都没动。
   */
  --zhituan-rail-track: clamp(30px, calc((100vh - 366px) / 3), 56px);
}

/*
 * 顶栏藏起来之后，球浮在本栏顶端。
 * 不给它让位的话，第一个按钮就被压在球底下了。
 *
 * 让位吃掉的高度必须从轨道预算里扣掉——否则那 26px 的老毛病会以同样的方式
 * 回来（顶栏藏起来 = 少了 48px 可用高度，三条轨道一起缩才补得上）。
 * 扣的就是上面刚加的那一段内边距，因此这里按那几个变量写，不另抄一个数字。
 */
.rail.ball-top {
  padding-top: calc(4px + var(--zhituan-ball-size) + var(--zhituan-ball-margin) * 2);
  --zhituan-rail-track: clamp(
    30px,
    calc((100vh - 366px - var(--zhituan-ball-size) - var(--zhituan-ball-margin) * 2) / 3),
    56px
  );
}

.stack {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 窗口矮的时候这一列放不下，允许纵向滚动；横向必须裁掉——
     透明度滑块是横条转 90° 画出来的，它的布局盒比栏宽得多。
     上面那条 --zhituan-rail-track 把三条滑块按窗口高度缩过一遍之后，
     窗口高到 456px 以上就不再溢出了；再矮才轮到这一列自己滚。 */
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.stack::-webkit-scrollbar {
  width: 0;
  display: none;
}

.sep {
  flex: 0 0 auto;
  height: 1px;
  margin: 3px 4px;
  background: var(--zhituan-hairline);
}

/*
 * 两格开关从并排改成上下排之后（1.6.7），它们就是两格普通的 .item——
 * 各占一行、各 26px 高，不再需要 .pair 那一层壳（那一层当初的全部作用
 * 是让两格在一行里平分宽度）。
 *
 * 于是高度账回到「数格子」这件事上：栈里的固定格子从 7 个还是 7 个
 * （少掉「站点」，多出第二格开关），下面 --zhituan-rail-track 里那个 366px
 * 一个数都不用动。
 */

.item {
  flex: 0 0 auto;
  width: 100%;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--zhituan-radius-sm);
  color: var(--zhituan-text-dim);
  white-space: nowrap;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.item:hover:not(:disabled) {
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-ink);
}

/* 没有当前网页时缩放那三格是禁用的：默认值摆在那里，但点了什么都不会发生 */
.item:disabled {
  color: var(--zhituan-text-faint);
}

.item.on {
  color: var(--zhituan-accent);
  background: var(--zhituan-accent-soft);
}

.item.percent {
  font-variant-numeric: tabular-nums;
}
</style>
