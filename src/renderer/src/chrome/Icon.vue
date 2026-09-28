<script setup lang="ts">
/**
 * 图标集。
 *
 * 统一为 24 视框、1.6 描边、圆头圆角、只用 currentColor 的线性图标。
 * 不使用 Unicode 字符冒充图标：字符的字重、基线和对齐由字体决定，
 * 在不同机器上表现不一致，也无法与文本的字号体系协调。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
defineProps<{
  name:
    | 'home'
    | 'back'
    | 'forward'
    | 'reload'
    | 'plus'
    | 'minus'
    | 'minimize'
    | 'close'
    | 'search'
    | 'history'
    | 'bookmark'
    | 'settings'
    | 'chevron-down'
    | 'panel-right'
    | 'mobile'
    | 'pin'
    | 'maximize'
    | 'restore'
    | 'pause'
    | 'stop'
    | 'file'
  size?: number
}>()
</script>

<template>
  <svg
    class="icon-svg"
    :width="size ?? 15"
    :height="size ?? 15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'home'">
      <path d="M4 11.5 12 4.5l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="M15 5l-7 7 7 7" />
    </template>
    <template v-else-if="name === 'forward'">
      <path d="M9 5l7 7-7 7" />
    </template>
    <template v-else-if="name === 'reload'">
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M18.5 3.5v4h-4" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'minus'">
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'minimize'">
      <path d="M5 18h14" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12M18 6L6 18" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="M7 10l5 5 5-5" />
    </template>
    <template v-else-if="name === 'panel-right'">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </template>
    <!--
      手机版网页：一台竖着的手机。不用「手机 + 显示器」两个图元来表达
      「手机 / 电脑」——顶栏里每个图标只有 15px，两个图元挤在一起只剩糊。
      按钮的高亮状态已经说明了「现在是哪一边」，图标只需要指出这件事是什么。
    -->
    <template v-else-if="name === 'mobile'">
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M10.5 17.5h3" />
    </template>
    <!-- 置顶：一枚图钉。头朝上、针朝下，与「钉在最上面」是同一个意思 -->
    <template v-else-if="name === 'pin'">
      <path d="M9 3.5h6v3.2l2.2 2.6v1.4H6.8v-1.4L9 6.7z" />
      <path d="M12 10.7v9.8" />
    </template>
    <!--
      最大化：一个空心方框，Windows 这一代的画法。
      它必须与下面的「还原」（两个错位方框）一眼分得开——两枚图标就挨着放
      （同一个按钮的两个状态），认错就等于点错。
    -->
    <template v-else-if="name === 'maximize'">
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
    </template>
    <!--
      还原：一大一小两个错位方框。后面那个只露出上面的边与右边的边——
      两条完整的方框挤在 24 视框里会糊成一片，露个拐角反而更像「一叠」。
    -->
    <template v-else-if="name === 'restore'">
      <rect x="4" y="9" width="11" height="11" rx="2" />
      <path d="M9 9V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
    </template>
    <!--
      收起时暂停播放：两道竖条的暂停符。
      右栏那两格开关中的第一格，高亮即当前状态，开着时收起成球、藏进托盘、
      最小化都会暂停网页里正在播的媒体。
      它挨着放大 / 缩小那几枚，尺寸取同一档，不为了好认而单独放大。
    -->
    <template v-else-if="name === 'pause'">
      <path d="M9.5 5.5v13M14.5 5.5v13" />
    </template>
    <!--
      切走时暂停播放：一个「停止」方块，与上面那道暂停符配成一对。

      做成方块，而不是「一页纸里再画个暂停符」——15px 上框里塞第二件东西只剩
      一团墨（同一页里 'file' 那一枚也是为这个才不画「纸 + 笔」）。
      这一枚必须与暂停符一眼分得开：两格挨在一起，说的是同一件事的两个场合
      （收起成球 / 切到别的标签），长得一样就没人分得清按的是哪一格。
      暂停（两道竖条）与停止（一方块）本来就是一对，所以这一对在语义上也是顺的。
    -->
    <template v-else-if="name === 'stop'">
      <rect x="6.5" y="5.5" width="11" height="13" rx="2.5" />
    </template>
    <!--
      本机文件：一页纸，右上角折起来。
      它出现在起始页「离线阅读」那一栏的行首，作用是让那一栏一眼看出不是站点——
      站点没有图标时画的是首字母的圆底，而一列圆底读起来就是一列网站。
      不做「纸 + 笔」或「纸 + 放大镜」：15px 上第二件东西只剩一团墨。
    -->
    <template v-else-if="name === 'file'">
      <path d="M13.5 4.5H8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9z" />
      <path d="M13.5 4.5V9H18" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5v4h4" />
      <path d="M12 8v4.5l3 1.8" />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M7 4.5h10a1 1 0 0 1 1 1v14l-6-3.6-6 3.6v-14a1 1 0 0 1 1-1z" />
    </template>
    <!--
      设置：一枚齿轮（八齿 + 外环 + 中心孔）。

      这一枚原先画的是「三条带旋钮的滑杆」，理由是齿轮的齿在 24 视框里画准不容易。
      用户后来要求「换成设置图标」，指的正是齿轮——于是齿不做成一条几十个点的
      外轮廓，而是从外环伸出去的八条短线：每条都落在真正的 45° 射线上（1.7 与 1.7
      的比值就是 1），对称是算出来的，不是描出来的。
    -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M19 12h2.4M17 17l1.7 1.7M12 19v2.4M7 17l-1.7 1.7M5 12H2.6M7 7L5.3 5.3M12 5V2.6M17 7l1.7-1.7"
      />
    </template>
  </svg>
</template>

<style scoped>
.icon-svg {
  display: block;
  flex: 0 0 auto;
}
</style>
