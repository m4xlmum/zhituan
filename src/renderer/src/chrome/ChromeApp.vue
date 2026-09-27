<script setup lang="ts">
/**
 * chrome 层根组件。
 *
 * 三种形态共用这一层，差别只在界面部分是否绘制：
 *   - 展开：顶栏 + 地址栏（默认折叠）+ 更新提示条（有新版本时才占位）+ 正文
 *           （留空，由标签页视图覆盖）+ 右侧栏 + 悬浮球
 *   - 收起：只有悬浮球，铺满整扇窗
 *   - 最大化：没有栏也没有正文，只在右上角一小块里浮着「还原键 + 球」
 *
 * 正文之所以完全透明且不画东西，是因为标签页视图叠在它上方；
 * 窗口透明时，未被绘制的地方露出的是桌面。
 *
 * 最大化那一态与另两态有一处根本差别：**这一层的画布不是整扇窗了**。
 * 主进程把 chrome 视图的矩形缩成右上角那个小方块（WindowController.chromeBounds），
 * 于是这个文档的 0,0 就是那个方块的左上角，80×48 之外一个像素都不属于它。
 * 这是被逼出来的一招：chrome 与网页是两个视图，只有最上面那个收得到指针事件，
 * CSS 的 pointer-events 无论怎么写都不能把事件让给下面那个（见 edgeWatcher 的头注释）。
 * 想「只挡住右上角这么一块」，唯一的办法就是把这一层的矩形真的收小。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed } from 'vue'
import {
  ADDRESS_H,
  BALL_MARGIN,
  BALL_SIZE,
  FLOAT_GAP,
  FLOAT_KEY_SIZE,
  NOTICE_H,
  RAIL_W,
  RESIZE_CORNER,
  RESIZE_EDGE,
  TOP_BAR_H
} from '@shared/constants'
import TopBar from './TopBar.vue'
import AddressBar from './AddressBar.vue'
import UpdateNotice from './UpdateNotice.vue'
import Rail from './Rail.vue'
import Ball from './Ball.vue'
import ResizeFrame from './ResizeFrame.vue'
import Icon from './Icon.vue'
import { useConfig } from '../composables/useConfig'
import { useBackgroundAlpha } from '../composables/useBackgroundAlpha'
import { useTabs } from '../composables/useTabs'
import { useWindowState } from '../composables/useWindowState'

const { config, patch } = useConfig()
const { tabs, activeTabId, activeTab, screen, lastTab } = useTabs()
const { state, collapse, expand, restore } = useWindowState()

/** 底板透明度写在文档根上，理由见 useBackgroundAlpha */
useBackgroundAlpha(config)

/*
 * 这里**故意不写主题**（useTheme 只有起始页那一份文档调）。
 *
 * themes.css 里那三组配色是按 `html[data-theme]` 挑的，这一份文档从不写这个属性，
 * 于是顶栏、地址栏、右栏、悬浮球永远落在 `:root` 那一组——固定的纸白配色与圆角形态。
 * 主题是起始页那一屏的事，工具的样子不该跟着一页换了皮就变（PDF 阅读页更明显：
 * 那一页画的是内容，墨色跟着主题走会让磷绿下的整本书变成荧光绿）。
 * 网页在另一个 WebContentsView 里，本来也管不到。
 */

const collapsed = computed(() => state.value?.mode === 'collapsed')
const addressOpen = computed(() => state.value?.addressOpen ?? false)
const topBarOpen = computed(() => state.value?.topBarOpen ?? true)
/** 更新提示条是否占版面。由主进程按「有新版本且没被忽略」裁定，见 updateService */
const noticeVisible = computed(() => state.value?.noticeVisible ?? false)
/** 右侧栏是否占位。顶栏藏起来时它会被强制保留——那是球的落脚处 */
const railVisible = computed(() => state.value?.railVisible ?? true)
/**
 * 是否已最大化（铺满工作区）。
 *
 * 它与 mode 是两件事：最大化时仍然可以是「展开」或「收起」（收起成球之后
 * 再展开，回到的就是那块铺满的工作区），所以这里必须按 collapsed 与 maximized
 * 两个维度分别判断，模板里的分支顺序也是照这个来的——收起态优先。
 */
const maximized = computed(() => state.value?.maximized ?? false)

/** 同一个球，点一下收起或展开 */
function toggleBall(): void {
  if (collapsed.value) expand()
  else collapse()
}

/** 球的右键菜单。原生菜单，在顶栏之外也能弹（chrome 层画不出的地方它照画） */
function openBallMenu(): void {
  void window.zhituan.win.openBallMenu()
}

/**
 * 各区域尺寸由主进程的常量下发，不写死在 CSS 里。
 *
 * 正文的宽度与高度都是主进程按这些值算出来、直接设在标签页视图上的；
 * 这里若另写一份，两边迟早会差几个像素，网页就会被栏压住一条。
 *
 * 球的直径与留白同样下发：收起时主进程要把窗口缩到球身上，而那个矩形
 * 由 Ball 量出来上报，两边用的是同一组数字。
 */
const geometryVars = {
  '--zhituan-top-h': `${TOP_BAR_H}px`,
  '--zhituan-address-h': `${ADDRESS_H}px`,
  '--zhituan-notice-h': `${NOTICE_H}px`,
  '--zhituan-rail-w': `${RAIL_W}px`,
  '--zhituan-ball-size': `${BALL_SIZE}px`,
  '--zhituan-ball-margin': `${BALL_MARGIN}px`,
  '--zhituan-resize-edge': `${RESIZE_EDGE}px`,
  '--zhituan-resize-corner': `${RESIZE_CORNER}px`,
  /*
   * 最大化态那两组数字与上面同源：主进程把 chrome 视图的矩形设成
   * FLOAT_W × FLOAT_H（见 floatBox），这里画出来的一行必须正好填满它，
   * 差几像素就是球露出一条边或者被切掉一角。
   */
  '--zhituan-float-key': `${FLOAT_KEY_SIZE}px`,
  '--zhituan-float-gap': `${FLOAT_GAP}px`
}
</script>

<template>
  <div class="root" :style="geometryVars">
    <!--
      收起态：整扇窗就是一颗球。排在所有分支之前——最大化时也可以收起
      （那时窗口照样缩到球身上），收起才是这两件事里更彻底的那个形态。
    -->
    <Ball
      v-if="collapsed"
      collapsed
      :floating="false"
      @toggle="toggleBall"
      @menu="openBallMenu"
    />

    <!--
      最大化：没有栏、没有正文，只有右上角这一块。
      两栏都让位之后界面在窗口里再没有别的地盘，球与还原键就只能挤进这块小方块里，
      靠主进程把 chrome 视图提到最前面（WindowController.syncChromeOrder）才看得见、点得到。
      还原键在左、球在右：球的位置与「顶栏藏起来时浮在右上角」完全重合，
      两态之间切换时球不会跳。
    -->
    <div v-else-if="maximized" class="float">
      <button class="float-key" title="还原窗口" aria-label="还原窗口" @click="restore">
        <Icon name="restore" :size="14" />
      </button>
      <Ball :collapsed="false" :floating="false" @toggle="toggleBall" @menu="openBallMenu" />
    </div>

    <template v-else>
      <!-- 顶栏里就排着悬浮球，它是这一栏的第三个按钮 -->
      <TopBar
        v-if="topBarOpen"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :active-tab="activeTab"
        :last-tab="lastTab"
        :screen="screen"
        :address-open="addressOpen"
        :rail-visible="railVisible"
        :always-on-top="config?.window.alwaysOnTop ?? false"
        @toggle-ball="toggleBall"
        @ball-menu="openBallMenu"
        @patch="patch"
      />

      <div class="middle">
        <div class="main-col">
          <AddressBar v-if="addressOpen" :active-tab-id="activeTabId" :active-tab="activeTab" />

          <!--
            更新提示条排在地址栏之下、网页之上。
            顺序有讲究：地址栏是用户自己的东西（他刚唤出来的），不该被一条提示
            推着上下走；而提示说的是「网页里那条内容有新版本」，贴着网页才合情理。
          -->
          <UpdateNotice v-if="noticeVisible" />

          <!-- 中间留空：这一块由标签页视图覆盖 -->
          <div class="spacer" />
        </div>

        <Rail
          v-if="railVisible"
          :config="config"
          :active-tab="activeTab"
          :ball-gap-top="!topBarOpen"
          @patch="patch"
        />
      </div>

      <!-- 顶栏藏起来时球浮在右上角 -->
      <Ball
        v-if="!topBarOpen"
        :collapsed="false"
        floating
        @toggle="toggleBall"
        @menu="openBallMenu"
      />
    </template>

    <!--
      四周的缩放手柄。排在最后：它压在顶栏与右栏的留白上（那几像素本来就点不到），
      而角上的 8×8 会切掉「设置」按钮右下角 4×4——那是 Windows 自己的做法，
      角落让给缩放。
      收起态下窗口就是一颗球，没有边缘可言；最大化态下窗口是显示器给的，
      也没有可拖的余地——两者都不画。
    -->
    <ResizeFrame v-if="!collapsed && !maximized" />
  </div>
</template>

<style scoped>
.root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.middle {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.main-col {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.spacer {
  flex: 1 1 auto;
  background: transparent;
  pointer-events: none;
}

/*
 * 最大化时的那一小块（主进程把 chrome 视图的矩形收成 80×48 贴在右上角，
 * 因此这里的 inset: 0 就是那一小块，而不是整扇窗）。
 *
 * 靠右对齐、右侧留 BALL_MARGIN：球的右边缘与上边缘由此落在
 * 「顶栏藏起来时浮在右上角」那一态完全相同的位置上。
 */
.float {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--zhituan-float-gap);
  padding-right: var(--zhituan-ball-margin);
}

/*
 * 还原键：与球并排的一枚小圆键。
 *
 * 它必须自带不透明底色与投影——下面是网页，任何一张图都可能铺在它身后，
 * 只描边不填底的话这枚键在某些页面上就糊没了（球能用半透明是因为它有底色）。
 * 尺寸与圆角都跟着球的规矩来，免得挨在一起的两颗一圆一方。
 */
.float-key {
  width: var(--zhituan-float-key);
  height: var(--zhituan-float-key);
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--zhituan-surface);
  color: var(--zhituan-text-dim);
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.28);
  transition: background 120ms ease-out, color 120ms ease-out;
}

.float-key:hover {
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-ink);
}

.float-key:active {
  background: var(--zhituan-surface-active);
}
</style>
