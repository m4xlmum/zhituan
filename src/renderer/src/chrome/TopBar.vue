<script setup lang="ts">
/**
 * 顶部功能栏：两屏入口、导航、地址栏开关、标签页、手机 / 置顶、窗口操作。
 *
 * 地址栏本身不在这里——它默认折叠，展开时是顶栏下方独立的一行。
 * 这里只留一个开关，它写的是**当前这张网页**（停在自家那两屏上时写「刚才那张」，
 * 理由见 siteLabel）：顶栏里只有它跟着网页走，「在哪一屏」由左上角那两颗键的高亮说。
 *
 * 起始页与系统设置这两屏**不是标签页**，各自在栏左占一枚键（见下），
 * 因此它们不出现在标签条里，也不跟着标签页一起被关掉。
 *
 * 标签条与它的让位（窗口窄时退回下拉清单）都在 TabStrip 里，
 * 那一条要按实测宽度决定自己让不让位，是顶栏里唯一需要知道自己有多宽的东西。
 *
 * 整条可拖动，按在控件上是操作。判据在 useWindowDrag 里，这里不必逐个标记。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed } from 'vue'
import type { ConfigPatch } from '@shared/ipc'
import type { OwnScreen, TabState } from '@shared/types'
import { fileNameOf, isLocalText } from '@shared/url'
import Icon from './Icon.vue'
import Ball from './Ball.vue'
import TabStrip from './TabStrip.vue'
import { openPopoverAt } from '../composables/usePopover'
import { useWindowDrag } from '../composables/useWindowDrag'

const props = defineProps<{
  tabs: TabState[]
  activeTabId: string | null
  activeTab: TabState | null
  /** 上一次看着的那张网页；停在自家那两屏上时地址栏开关写它，见 siteLabel */
  lastTab: TabState | null
  /** 正文区此刻停在自家哪一屏上；看着网页时为 null */
  screen: OwnScreen | null
  /** 地址栏当前是否展开，来自主进程回传的窗口状态 */
  addressOpen: boolean
  /** 右侧栏当前是否占位，同时决定开关按钮的高亮 */
  railVisible: boolean
  /** 窗口是否置顶，决定置顶按钮的高亮 */
  alwaysOnTop: boolean
}>()

const emit = defineEmits<{
  toggleBall: []
  ballMenu: []
  patch: [patch: ConfigPatch]
}>()

/** 整条栏可拖动。按在按钮、地址栏开关、标签条上是操作，其余地方都是拖窗口 */
const drag = useWindowDrag()

/**
 * 地址栏开关上那个名字。
 *
 * 它说的是**一张网页**，因此停在起始页 / 系统设置上时**不跟着变成那一屏的名字**
 * （用户要求）：那两个词一出现，顶栏读起来就像多了一个叫「系统设置」的标签页
 * ——与标签条上那一格同一个道理（见 TabStrip 里那段注释，那里也是这么改的）。
 *
 * 此刻手里没有当前网页，就写「刚才那张」——也就是左上角那两颗键再点一次会回到的
 * 那一个（主进程的 lastTabId，见 tabManager.leaveScreen）。于是切进切出这两屏时，
 * 这一格**一动不动**，而它说的话与那两颗键的提示语「回到刚才那张网页」是同一句。
 *
 * 一张网页都没有时（刚启动、又被关光了）它一个字都不写：没有网页就没有名字，
 * 那个开关只剩一枚放大镜。
 *
 * 本机文件写的是**文件名**，不是 `file:` 那个 host——`new URL('file:///C:/…')`
 * 的 host 是空串，退回 `url` 就把整条 `C:\Users\…\Documents\斗破苍穹.txt`
 * 写在了顶栏上。README 里那条「本机文件在界面上只显示文件名，从不显示路径」
 * 是全程序一条硬规矩，这一格也不例外（见 @shared/url.ts 的 fileNameOf）。
 */
const siteLabel = computed(() => {
  const url = (props.activeTab ?? props.lastTab)?.url
  if (!url) return ''
  const name = fileNameOf(url)
  if (name) return name
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
})

/** 新建一张标签页并切过去 */
async function newTab(): Promise<void> {
  await window.zhituan.tabs.create({ activate: true })
}

/**
 * 切换地址栏。
 *
 * 用 mousedown.prevent 而不是 click：地址栏输入框一旦失焦就会自行收起，
 * 而按在按钮上会让它失焦——那样「点开关」会先收起再展开，等于没反应。
 * 挡掉 mousedown 的默认行为，焦点就不会移走，收起只由这次点击决定。
 */
function toggleAddress(event: MouseEvent): void {
  event.preventDefault()
  window.zhituan.win.setAddressOpen({ open: !props.addressOpen })
}

function toggleRail(): void {
  window.zhituan.win.setChrome({ rail: !props.railVisible })
}

/** 手机 / 电脑模式。跟着当前标签页走，换一页就跟着那一页的状态 */
const mobile = computed(() => props.activeTab?.uaMode === 'mobile')

function toggleUa(): void {
  const tabId = props.activeTabId
  if (!tabId) return
  void window.zhituan.page.setUa({ tabId, mode: mobile.value ? 'desktop' : 'mobile' })
}

function togglePin(): void {
  emit('patch', { window: { alwaysOnTop: !props.alwaysOnTop } })
}

// 模板里的 window 指向组件实例而非全局对象，因此全局调用都要包一层方法
function navBack(): void {
  const id = props.activeTabId
  if (id) void window.zhituan.nav.back({ tabId: id })
}

function navForward(): void {
  const id = props.activeTabId
  if (id) void window.zhituan.nav.forward({ tabId: id })
}

function navReload(): void {
  const id = props.activeTabId
  if (id) void window.zhituan.nav.reload({ tabId: id })
}

function winMinimize(): void {
  void window.zhituan.win.minimize()
}

/**
 * 最大化。铺满当前显示器的整个工作区，不保 16:9。
 *
 * 这一枚只画「最大化」这一态，不画「还原」：最大化之后整条顶栏都让位给网页
 * （用户定的），它就跟着没了。退出改走右上角那一枚还原键，或球的右键菜单——
 * 那两处都在最大化后仍在窗内的那一小块里。
 */
function winMaximize(): void {
  void window.zhituan.win.maximize()
}

function winClose(): void {
  void window.zhituan.win.close()
}

/**
 * 左上角那颗键：起始页的入口，也是它自己的出口。
 *
 * 再点一次就是「原路返回」——回到进来之前那张网页（没有可回的就落回
 * 起始页，那一侧判）。判据在这里而不是主进程：只有界面看得见此刻停在哪一屏，
 * 而托盘菜单里那些入口是明确意图，不该跟着变成开关。
 */
function goHome(): void {
  void (props.screen === 'home' ? window.zhituan.ui.leaveScreen() : window.zhituan.ui.openHome())
}

/**
 * 紧挨着起始页那颗键的「设置」：系统设置的入口，也是它自己的出口。
 *
 * 与起始页同一套判据——再点一次就原路返回。它原先待在右栏栏底、写着「设置」两个字
 * （用户要求搬到左上角并换成图标）：两屏的键摆在一起，「这两屏不是标签页、各有各的
 * 进出口」才一眼看得明白，而栏底那一格在小窗口里本来就会被滚出视野。
 *
 * 图标是这一套里那枚齿轮（Icon 的 settings）。这一枚原先画的是滑杆，用户点名要齿轮，
 * 齿怎么画准的账记在 Icon.vue 里。
 */
function toggleSettings(): void {
  void (props.screen === 'settings' ? window.zhituan.ui.leaveScreen() : window.zhituan.ui.openSettings())
}

/**
 * 排版（离线阅读的正文字号、行距、左右留白）。
 *
 * 这里原先没有这枚键，因为它本来长在能改排版的那一页上：自家 EPUB 阅读页右下角
 * 就有一枚 Aa。而**本机 TXT 那一页是 Chromium 自己渲染的**——整篇文档就是它
 * 自己生成的一个 `pre`，我们一个控件都挂不上去。于是这枚键只能借顶栏落脚，
 * 再开一张弹出面板（用户点名要的位置：顶栏加一枚 Aa）。
 *
 * 管得着的对象由 @shared/url 的 isLocalText 判：本机文件里除去 PDF 的那些
 * （TXT 这类 Chromium 排的页，以及自家 EPUB 阅读页）。PDF 不算——那一页的字是
 * 画进 canvas 的，没有字号可调，想放大得改缩放，那是右栏那三格的事。
 *
 * **不放宽成「任何时候都能点」**：右栏那三格缩放、第三条透明度滑块都是「没有
 * 可作用的对象就禁掉」的规矩（见 Rail.vue），这一枚照同一条走。
 */
const canTypeset = computed(() => isLocalText(props.activeTab?.url))

const typesetHint = computed(() =>
  canTypeset.value
    ? '排版：正文字号、行距、左右留白（只作用于正在读的这一份本机文本，网页不受影响）'
    : '排版：此刻没有正在读的本机文本。先打开一本：起始页 → 离线阅读 → 打开文件…'
)

/** 面板是独立子窗口，主进程按这枚键的矩形把它摆在底下（见 popoverWindow.place） */
function openTypeset(event: MouseEvent): void {
  openPopoverAt('typeset', event)
}
</script>

<template>
  <header
    class="topbar"
    @pointerdown="drag.onPointerDown"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerCancel"
  >
    <!--
      两屏的入口，摆在最左。它们不是标签页，各有各的键，而进出口是同一颗——
      再点一次就原路返回（判据在 goHome / toggleSettings 里）。
      与右边那组导航之间留出组间距，读起来是「两屏 · 一页」两摊事。
    -->
    <div class="group">
      <button
        class="icon"
        aria-label="起始页"
        :class="{ on: screen === 'home' }"
        :title="screen === 'home' ? '回到刚才那张网页' : '回到起始页'"
        @click="goHome"
      >
        <Icon name="home" />
      </button>
      <!--
        设置。图标是这一套里那枚齿轮（齿怎么画准的账见 Icon.vue 里那一枚）。
      -->
      <button
        class="icon"
        aria-label="系统设置"
        :class="{ on: screen === 'settings' }"
        :title="screen === 'settings' ? '回到刚才那张网页' : '系统设置'"
        @click="toggleSettings"
      >
        <Icon name="settings" />
      </button>
    </div>

    <!-- 导航 -->
    <div class="group">
      <button class="icon" title="后退" :disabled="!activeTab?.canGoBack" @click="navBack">
        <Icon name="back" />
      </button>
      <button class="icon" title="前进" :disabled="!activeTab?.canGoForward" @click="navForward">
        <Icon name="forward" />
      </button>
      <button class="icon" title="刷新" @click="navReload"><Icon name="reload" /></button>
    </div>

    <!-- 地址栏开关。地址栏默认折叠，这里是唤出它的入口 -->
    <button
      class="address-toggle"
      :class="{ on: addressOpen }"
      :title="addressOpen ? '收起地址栏' : '展开地址栏'"
      @mousedown="toggleAddress"
    >
      <Icon name="search" :size="14" />
      <span class="ellipsis">{{ siteLabel }}</span>
    </button>

    <!--
      标签条。它自己占住中间那一整块，也自己决定放不下时退回下拉清单，
      新建按钮跟着它走——浏览器里那个「+」也是挨着最后一个标签。
    -->
    <TabStrip :tabs="tabs" :active-tab-id="activeTabId" :last-tab-id="lastTab?.id ?? null">
      <button class="icon" title="新建标签页" @click="newTab">
        <Icon name="plus" />
      </button>
    </TabStrip>

    <!--
      排版。一枚写着「Aa」的键，与自家 EPUB 阅读页右下角那一枚同一个意思
      （见 openTypeset 那一段）。它排在**标签条与窗口操作之间**：
      左边那一整片是「这一页 / 这几张网页」的东西，右边那一整片是「这扇窗」，
      而它管的是「读的那份东西怎么排」——两头都沾一点，摆在这条界线上最不别扭。
      它是这一组里唯一按「当前这一页是谁」决定能不能点的（见 canTypeset）。
    -->
    <div class="group">
      <button
        class="icon text"
        :class="{ on: canTypeset }"
        :disabled="!canTypeset"
        :title="typesetHint"
        aria-label="排版"
        @click="openTypeset"
      >
        Aa
      </button>
    </div>

    <!--
      窗口操作。顺序：手机 · 置顶 · 最小化 · 最大化 · 关闭 · 悬浮球 · 收起右侧栏。
      手机与置顶原本是右栏里两个写着汉字的格子，改作图标搬到这里——
      顶栏里放得下图标，而它们改的是「这一页怎么显示」，不是阅读本身。
      末三枚按 Windows 一贯的左→右：最小化、最大化、关闭（用户点名要的次序）。
    -->
    <div class="group">
      <button
        class="icon"
        :class="{ on: mobile }"
        :disabled="!activeTab"
        :title="mobile ? '切回电脑版网页' : '切换到手机版网页'"
        @click="toggleUa"
      >
        <Icon name="mobile" />
      </button>
      <button
        class="icon"
        :class="{ on: alwaysOnTop }"
        :title="alwaysOnTop ? '取消窗口置顶' : '窗口置顶'"
        @click="togglePin"
      >
        <Icon name="pin" />
      </button>
      <button class="icon" title="最小化（老板键 1）" @click="winMinimize">
        <Icon name="minimize" />
      </button>
      <!--
        最大化：铺满当前显示器的工作区（不保 16:9）。
        最大化之后这条顶栏整个让位给网页，这一枚也跟着消失——
        退出那一步在右上角的还原键上（见 ChromeApp 的 .float）。
      -->
      <button class="icon" title="最大化（铺满工作区）" aria-label="最大化" @click="winMaximize">
        <Icon name="maximize" />
      </button>
      <button class="icon danger" title="关闭（藏进托盘，不退出）" @click="winClose">
        <Icon name="close" />
      </button>
      <Ball :collapsed="false" :floating="false" @toggle="emit('toggleBall')" @menu="emit('ballMenu')" />
      <button
        class="icon"
        :class="{ on: railVisible }"
        :title="railVisible ? '收起右侧栏' : '展开右侧栏'"
        @click="toggleRail"
      >
        <Icon name="panel-right" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  flex: 0 0 auto;
  height: var(--zhituan-top-h);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: var(--zhituan-surface);
  border-bottom: 1px solid var(--zhituan-hairline);
}

.group {
  display: flex;
  align-items: center;
  gap: 1px;
}

/* 标签条那一块自己吃掉剩余宽度（见 TabStrip 的 .rest），这里不必再放占位 */

.icon {
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--zhituan-radius-sm);
  color: var(--zhituan-text-dim);
  white-space: nowrap;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.icon:hover:not(:disabled) {
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-ink);
}

.icon:disabled {
  color: var(--zhituan-text-faint);
}

.icon.on {
  color: var(--zhituan-accent);
  background: var(--zhituan-accent-soft);
}

/*
 * 「Aa」那枚键里的字。
 *
 * 这一套图标规定不用字符冒充图标（见 Icon.vue），而这一枚是个例外——它
 * **本来就是字**：字号这件事拿一对字母来表示比画什么图形都直接，自家 EPUB
 * 阅读页右下角那一枚用的也是这两个字母、同一个意思。
 * 字重给到 600 让它在一片 1.6 描边的线性图标里立得住；13px 是与旁边 15px
 * 的图标视觉重量相当的那一档；行高压成 1 是为了不让它把行盒撑高、把这一枚
 * 顶得比邻居高半个像素。
 */
.icon.text {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
}

.icon.danger:hover {
  /* 悬停时底色换成实心红，字得跟着翻面——用 --zhituan-on-fill 而不是写死白色：
     那是「压在实心色上」的那一支墨，配色改了它跟着改（纸白下是白字） */
  color: var(--zhituan-on-fill);
  background: var(--zhituan-danger);
}

.ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 地址栏开关做得像浏览器的站点标识：一个图标加当前域名 */
.address-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  min-width: 120px;
  max-width: 260px;
  padding: 0 12px;
  border-radius: var(--zhituan-radius-pill);
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-text-dim);
  transition: background 120ms ease-out, color 120ms ease-out;
}

.address-toggle:hover {
  background: var(--zhituan-surface-active);
  color: var(--zhituan-ink);
}

.address-toggle.on {
  color: var(--zhituan-accent);
  background: var(--zhituan-accent-soft);
}

/*
 * 迷你档（窗口 480 宽）里把地址栏开关收成一个图标。
 *
 * 它占的 120px 是顶栏里最奢侈的一笔：那个宽度上域名本来就被截成「docs.claud…」，
 * 看得出来的一半信息标签条上也有一份。收掉它，标签条才拿得到放得下一个标签的
 * 地方——否则顶栏中间只剩一个光秃秃的数字，谁也不知道那是标签页。
 *
 * 阈值取在迷你档与 800 那一档之间：到了 800，这点宽度就不必省了。
 */
@media (max-width: 620px) {
  .address-toggle {
    width: 26px;
    min-width: 26px;
    padding: 0;
    gap: 0;
    justify-content: center;
  }

  .address-toggle .ellipsis {
    display: none;
  }
}
</style>
