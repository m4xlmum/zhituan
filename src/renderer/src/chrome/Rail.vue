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
 * 1.6.11 反着加了一格回来：「移出即收起」。它与系统设置 → 隐蔽 里那个 checkbox
 * 是同一份配置的第二个入口——这与上面那条「两处入口做同一件事」并不矛盾：
 * 去掉「站点」是因为它在两处**各做了一整套编辑器**，而这里两处都只有一个布尔值，
 * 同一个 `patch` 写同一个字段，没有第二份能各自漂移的逻辑。
 *
 * 1.6.12 又加了一格「显形并居中」：把整扇窗恢复成默认 16:9、摆到屏幕正中，
 * 并关掉「防截屏 / 防共享」（见 WindowController.revealCentered 与
 * ipc/registerWindowIpc）。它在一栏「开关」里是唯一一个**一次性动作**，
 * 因此没有高亮态——理由写在模板那一格上。
 *
 * 真正要它上来的是可达性：**要让光标移出就收起，得先把它打开**，而打开它的路
 * 只有系统设置那一屏——偏偏**那一屏自己也不受保护**：它不是一个独立窗口，而是
 * 窗内的一屏（见 tabManager.openSettings），要求挂起自动收起的那份名单里只有
 * 弹出面板那扇小窗（见 windowRegistry.hasAutoHideBlocker）。于是「进设置去打开它」
 * 这件事本身就要冒着窗口在中途收走的险，而它收走之后，展开只由点击悬浮球决定。
 * 摆在右栏就不是了：勾上，手一离开就能看见效果。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed } from 'vue'
import {
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  HIDE_DELAY_MS,
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
 * 鼠标移出时是否自动收起成球。
 *
 * 与下面那两格一样，系统设置里也有它（隐蔽 → 鼠标移出时自动收起），两处改的是
 * 同一份配置，靠配置广播对齐——因此在设置里改完，这里那一格的高亮会跟着变。
 *
 * 它排在**栈的最上面**，比那两格暂停开关还高：它管的是这扇窗什么时候自己收起来，
 * 是「收起」这件事本身；那两格管的是收起来之后网页怎么办，是它的后果。
 * 从上往下读正好是「什么时候收 → 收起时怎么办 → 切走时怎么办」。
 * 位置也照那两格的规矩挑过：小窗口下这条栈是**会滚的**，排在下面的等于藏起来了。
 *
 * 关掉它时若正停着一颗球，主进程会把界面展开（见 ipc/registerDataIpc.ts）——
 * 否则用户会以为设置没生效，球还在那儿。
 */
const autoCollapse = computed(() => props.config?.stealth.autoCollapse ?? false)

/**
 * 提示里那个秒数是**当前配置里真正生效的那一个**，不写死。
 *
 * 延迟只在系统设置里调（右栏放不下第二排控件，一格就是一个状态），因此这里
 * 必须把值报出来：否则用户看到的只是一个亮着的图标，说不清它到底多快会收。
 */
const collapseHint = computed(() => {
  const 秒 = ((props.config?.stealth.hideDelayMs ?? HIDE_DELAY_MS) / 1000).toFixed(1)
  return autoCollapse.value
    ? `鼠标移出时自动收起 · 开：光标离开窗口约 ${秒} 秒后收起成球。延迟在「系统设置 → 隐蔽」里改`
    : '鼠标移出时自动收起 · 关：光标移开窗口不会收起。开启后光标离开约一秒也会自动收起'
})

function toggleAutoCollapse(): void {
  emit('patch', { stealth: { autoCollapse: !autoCollapse.value } })
}

/**
 * 收起时是否暂停网页里正在播的媒体。
 *
 * 这一项在系统设置里也有（隐蔽 → 收起时暂停音视频），两处改的是同一份配置，
 * 靠配置广播对齐——因此在设置里改完，这里那一格的高亮会跟着变。
 * 摆在本栏上面那几行：小窗口下这条功能栈是**会滚的**（实测溢出：
 * 迷你档 480×270 是 214px、小档 800×450 是 34px；用户那档 903×508 与默认档
 * 960×540 都是 0px），排在下面的东西等于藏起来了，而这一枚本来就是嫌设置里
 * 不好找才搬上来的。
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

/**
 * 显形并居中。
 *
 * 与上面三格不同，它是**一次性的动作**而不是一个状态开关：把整扇窗恢复成
 * 默认的 16:9 尺寸、摆到当前显示器正中，收起 / 托盘 / 最小化时一并回到展开态，
 * 并把整体透明度恢复到 100%（与托盘菜单那句「现形」是同一条规矩）。
 * 同一趟里主进程还会**关掉「防截屏 / 防共享」**（见 ipc/registerWindowIpc）——
 * 点这一格的人多半正是要把它截下来或共享出去，而开着那一项时窗口截出来是一片黑，
 * 点了没反应看着就像坏了。因此它不做成开关：用户要的是「看见」，不是「切一个档」。
 */
function centerReveal(): void {
  void window.zhituan.win.centerReveal()
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
        最上面这三格是「开关」——按下去就地切一个状态，高亮即当前状态（.item.on）。
        全栏只有它们是这样；下面那些要么打开面板、要么是滑块，而紧接着这组末尾的
        「显形并居中」是一次性动作（见下）。

        从上往下：**移出即收起 → 收起时暂停 → 切走时暂停**。这不是随手排的，
        它们是同一件事的三段：什么时候把窗口收起来、收起来之后网页怎么办、
        切走之后网页怎么办。头一格（1.6.11 加的）管的是「收起」本身，
        后两格是它的后果，因此它排在最上面。

        三格各自独占一行。后两格（1.6.7 之前并排挤在一行里）说的是同一件事
        （什么时候让网页停下来）的两个场合，一头一尾摆开等于让人去两处找，
        因此它们之间**不留分隔线**，紧挨着排；头一格与它们说的是两件事，
        但同属「开关」这一族，也不插分隔线——插了就变成「一格孤零零 + 两格一对」，
        反而不像一组。分隔线留给下面那些「打开面板」「滑块」。

        顺序与它们在系统设置 → 隐蔽 里那一栏的顺序一致。

        这一栏的高度是量着配的（见 .stack 那条注释）：1.6.11 这一格是**新占**的
        26px，不像 1.6.7 那次有一格「站点」腾出来，因此 --zhituan-rail-track
        里那笔账从 366px 改成了 394px。1.6.12 那格「显形并居中」又是新占的一格，
        394 已经改成了 422（那笔账与受影响的窗口高度都写在 .stack 的注释里）。
      -->
      <button
        class="item"
        :class="{ on: autoCollapse }"
        :title="collapseHint"
        @click="toggleAutoCollapse"
      >
        <Icon name="auto-collapse" :size="14" />
      </button>
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

      <!--
        显形并居中（1.6.12 加的）。它排在开关组之后、第一条分隔线之前：
        与上面三格同属「这扇窗现在怎么了」，但它与那三格不一样——**它是一次性动作**，
        按下去不改任何「开 / 关」状态（因此不挂 .on），做完就把窗口摆回默认档并居中。
        因此「按一下就地切一个状态」这句从此只对上面那三格成立，这一格除外。
      -->
      <button
        class="item"
        title="显形并居中：恢复默认 16:9 尺寸、居中到屏幕、透明度回 100%，并关闭防截屏 / 防共享"
        @click="centerReveal"
      >
        <Icon name="center" :size="14" />
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
   *   283px = 栈里那 9 个固定高度的格子（26px 一个，含最上面那三格开关与
   *           后加的那格「显形并居中」）与 3 条分隔线（1px 高 + 上下各 3px
   *           外边距）＝255px，加上 15 个子项之间的 14 条 2px 缝＝28px；
   *   87px  = 每个滑块自己那两行小字与内边距（12+1+12+1+2+1＝29px）乘三条。
   * 合计 422px，于是三条轨道一共能拿到「100vh − 422px」，每条再除以三。
   * 加了这几项、或改了格子的高度，这个数就要跟着改一次——它是量出来的，
   * 不是推出来的。1.6.7 去掉「站点」那格、把并排的两格开关拆成两行，
   * 格子数与子项数都没有变，因此当时这几个数一个都没动；1.6.11 加了
   * 「移出即收起」那格是本栏头一次真的多占高度，227 → 255、366 → 394。
   * 1.6.12 右栏那一格「显形并居中」又是**新占**的一格（不是顶替谁），
   * 255 → 283、394 → 422，那条「不再溢出」的线也从 484px 抬到了 512px。
   *
   * **这条公式管不到的地方**（实测，spike/rail-hit.js）：
   * 轨道有 30px 的下限，因此「不再溢出」的那条线是 422 + 3×30 = 512px，
   * 矮过 512px 就轮到整条栈自己滚。加「显形并居中」这一格把这条线从 484px
   * 抬到了 512px，于是**两档受了影响**：小档 800×450 的溢出由 34px 变成 62px
   * （**那条轨道整条落到折叠线以下，不滚就拖不到**），用户那档 903×508 也从
   * 0px 变成了溢出 4px——只差一点点，滚一下即可。这是新加一格真实的代价，
   * 不是量错了：450px 高的时候，就算轨道压到下限，9 格 + 3 分隔线 + 3 条滑块
   * 也要 460px，比那里的 398px 多了 62px。想让它回到 0，只能动那 422px 的固定
   * 开销（挪走一格、或整体收紧间距），那是另一件事。默认档 960×540 仍是 0px，
   * 480×270（迷你）本来就要滚。
   */
  --zhituan-rail-track: clamp(30px, calc((100vh - 422px) / 3), 56px);
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
    calc((100vh - 422px - var(--zhituan-ball-size) - var(--zhituan-ball-margin) * 2) / 3),
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
     窗口高到 512px 以上就不再溢出了（加「显形并居中」这一格之后；
     加「移出即收起」时是 484px，再往前是 456px，那一笔账写在
     --zhituan-rail-track 里）；再矮才轮到这一列自己滚。 */
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
