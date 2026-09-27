<script setup lang="ts">
/**
 * 窗口四周的缩放手柄。
 *
 * 八个几像素宽的元素贴着窗口四边，按下即开始缩放（见 useWindowResize），
 * 结果恒为 16:9。之所以自绘而不是把窗口设成 resizable：透明窗口开原生缩放
 * 会在某些 Windows 版本上失效，而透明是这个程序的全部。
 *
 * 尺寸取自 @shared/constants（边 4px、角 8×8）——它们由 ChromeApp 下发到
 * CSS 变量上（--zhituan-resize-edge / --zhituan-resize-corner），这里不另写一份数字：
 * 无头探针要按着同一组数字去这些位置下指，两处对不上就验不出东西。
 *
 * 压在谁头上：手柄是最后画的，因此顶栏与右栏的**留白**（那 4px 内边距）在手柄下面。
 * 那里的像素本来什么也点不到，正好拿来当拖拽区；而按钮、滑块这些控件都从 4px
 * 往里起，不会被抢走。球是唯一被啃到一点的：它竖直居中在 44px 的顶栏里
 * （上下各让 2px），于是顶上那 2px 落进了上边缘的手柄里——Windows 上最外那几
 * 像素本来就归缩放，球心那 40px 一点不受影响，点球收起照旧。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { ResizeEdge } from '@shared/types'
import { useWindowResize } from '../composables/useWindowResize'

const resize = useWindowResize()

/**
 * 八条边一张表。`edges` 决定手柄画在哪一格，`cursor` 是这一格的鼠标样式——
 * 光标形状是这里唯一还得自己说一遍的东西（CSS 没有「按边名取光标」的写法），
 * 对角线用 nwse / nesw 两族，与 Windows 一致。
 */
const HANDLES: ReadonlyArray<{ edge: ResizeEdge; cursor: string }> = [
  { edge: 'n', cursor: 'ns-resize' },
  { edge: 's', cursor: 'ns-resize' },
  { edge: 'w', cursor: 'ew-resize' },
  { edge: 'e', cursor: 'ew-resize' },
  { edge: 'nw', cursor: 'nwse-resize' },
  { edge: 'se', cursor: 'nwse-resize' },
  { edge: 'ne', cursor: 'nesw-resize' },
  { edge: 'sw', cursor: 'nesw-resize' }
]
</script>

<template>
  <div class="frame">
    <div
      v-for="h in HANDLES"
      :key="h.edge"
      class="handle"
      :class="`edge-${h.edge}`"
      :style="{ cursor: h.cursor }"
      :data-resize-handle="h.edge"
      @pointerdown="resize.onPointerDown(h.edge, $event)"
      @pointerup="resize.onPointerUp"
      @pointercancel="resize.onPointerCancel"
    />
  </div>
</template>

<style scoped>
/* 铺满窗口的一层空壳。它自己不吃指针（下面的 .handle 吃），于是这一层
   不会挡住它覆盖到的任何东西——虽然它只覆盖四条边。 */
.frame {
  position: absolute;
  inset: 0;
  z-index: 9;
  pointer-events: none;
}

.handle {
  position: absolute;
  pointer-events: auto;
  /* 触摸屏上按在边上不该顺带滚动页面 */
  touch-action: none;
}

/* 四条边：各 4px 宽的一条 */
.edge-n,
.edge-s {
  left: 0;
  right: 0;
  height: var(--zhituan-resize-edge);
}

.edge-w,
.edge-e {
  top: 0;
  bottom: 0;
  width: var(--zhituan-resize-edge);
}

.edge-n {
  top: 0;
}

.edge-s {
  bottom: 0;
}

.edge-w {
  left: 0;
}

.edge-e {
  right: 0;
}

/*
 * 四个角：8×8，压在两条边相交处。
 *
 * 角必须排在边之后（HANDLES 的顺序已经如此）：两者重叠的那 4×4 里，
 * 后画的赢——否则「拖右下角」会变成拖下边或右边，而它们的结果是同一个
 * （16:9 只有一个自由度），用户察觉不到，但这个说法在代码里要立得住。
 */
.edge-nw,
.edge-ne,
.edge-sw,
.edge-se {
  width: var(--zhituan-resize-corner);
  height: var(--zhituan-resize-corner);
}

.edge-nw {
  top: 0;
  left: 0;
}

.edge-ne {
  top: 0;
  right: 0;
}

.edge-sw {
  bottom: 0;
  left: 0;
}

.edge-se {
  bottom: 0;
  right: 0;
}
</style>
