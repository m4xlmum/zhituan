<script setup lang="ts">
/**
 * 悬浮球。
 *
 * 三种形态，同一个组件：
 *   - 排在顶栏里（默认）——它是工具栏里的一个按钮，位置由 CSS 排布决定
 *   - 顶栏被隐藏时，浮在窗口右上角（右栏顶端）
 *   - 收起时铺满整扇窗，窗口此刻恰好就是球的尺寸
 *
 * 收起态与展开态下球在屏幕上的矩形完全一致，因此收起与展开看起来就是
 * 界面在球的位置上缩进去、再长出来，球本身一动不动。这不是巧合：主进程
 * 收缩窗口时用的就是这里量出来并上报的矩形（见 @shared/ipc 的 SEND.setBallRect）。
 * 让主进程自己算一遍「球该在哪」等于把版面规则抄成两份，迟早会差出几个像素。
 *
 * 平时半透明、悬停变清晰——既找得到，又不抢眼。反馈只用透明度、阴影这类
 * 不改变占位的属性：任何缩放都会让球在收起态顶出窗口边界，被切出四个方角。
 *
 * 球面上的图形有两个来源：内置的那几枚（BallGlyph）与用户上传的那一张（<img>）。
 * 该画哪一个由 useBallIcon 决定——「选了自定义却没有图」要退回内置图标这条规则
 * 只写在那一处，这里只用它的结论。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BALL_GLYPH_SIZE } from '@shared/constants'
import BallGlyph from './BallGlyph.vue'
import { useBallIcon } from '../composables/useBallIcon'
import { useWindowDrag } from '../composables/useWindowDrag'

const props = defineProps<{
  /** 收起态：球铺满整扇窗 */
  collapsed: boolean
  /** 顶栏被隐藏，球改浮在窗口右上角 */
  floating: boolean
}>()

const emit = defineEmits<{ toggle: []; menu: [] }>()

const el = ref<HTMLButtonElement | null>(null)

/** 图形边长。取自 @shared/constants——球的这一份与设置页那排预览是同一个数 */
const glyphSize = BALL_GLYPH_SIZE

const { customSrc, custom, fit, builtinIcon } = useBallIcon()

/**
 * 自定义图的尺寸。铺满时交给 CSS（inset: 0），缩在球心时按球径算。
 *
 * 用行内样式而不是 CSS 类，是因为这个数字来自 @shared/constants 的
 * BALL_GLYPH_SIZE——抄进样式表就多了一份要跟着改的常量。
 */
const customStyle = computed(() =>
  fit.value === 'glyph'
    ? { width: `${glyphSize}px`, height: `${glyphSize}px` }
    : undefined
)

/**
 * 球既能点（收起 / 展开），也能拖（移动整个窗口）。
 *
 * 这两件事必须由同一套按下处理分开：拖动时窗口跟着光标走，光标位置其实
 * 几乎没变，所以判据只能是「按下到松开的位移」——由 useWindowDrag 提供，
 * 它同时负责在位移足够大时走拖动那条路，位移小就回报一次点击。
 */
const drag = useWindowDrag(() => emit('toggle'))

/**
 * 把球当前的矩形报给主进程。
 *
 * 收起时窗口要缩到球身上，而球的位置由 CSS 排布决定，只有渲染进程量得准。
 * 收起态下不上报：那时球铺满整扇窗，量到的是窗口而不是球，
 * 报上去会把「球该在哪」覆盖成窗口的位置，展开后收起就再也落不回原处。
 */
function reportRect(): void {
  if (props.collapsed) return
  const node = el.value
  if (!node) return
  const r = node.getBoundingClientRect()
  window.zhituan.win.setBallRect({
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height)
  })
}

onMounted(() => {
  reportRect()
  window.addEventListener('resize', reportRect)
})

onBeforeUnmount(() => window.removeEventListener('resize', reportRect))

// 顶栏藏起来前后，球换了个落脚处，位置要重新报一次
watch(
  () => props.floating,
  () => void nextTick(reportRect)
)
</script>

<template>
  <button
    ref="el"
    class="ball"
    :class="{ docked: !collapsed, floating, collapsed }"
    :style="collapsed ? undefined : { width: 'var(--zhituan-ball-size)', height: 'var(--zhituan-ball-size)' }"
    :title="collapsed ? '展开纸团（右键更多）' : '收起成悬浮球（右键更多，拖动可移动窗口）'"
    :aria-label="collapsed ? '展开纸团' : '收起成悬浮球'"
    @pointerdown="drag.onPointerDown"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerCancel"
    @contextmenu.prevent="emit('menu')"
  >
    <img
      v-if="custom"
      class="custom"
      :class="fit"
      :src="customSrc ?? undefined"
      :style="customStyle"
      alt=""
      draggable="false"
    />
    <BallGlyph v-else :name="builtinIcon" :size="glyphSize" />
  </button>
</template>

<style scoped>
.ball {
  /* 默认排在顶栏里：跟着 flex 走，自己占位 */
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--zhituan-accent);
  /* 球面就是一块实色填充，上面的图形跟着填充的深浅翻面，见 themes.css */
  color: var(--zhituan-on-fill);
  opacity: 0.55;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.28);
  transition: opacity 140ms ease-out, box-shadow 140ms ease-out;
  /* 拖动是自己实现的，所以光标形状也要自己给 */
  cursor: grab;
  z-index: 10;
  /*
   * 关键：任何状态下都不能画出这个盒子。
   * 收起后窗口正好是球的尺寸，一旦放大哪怕百分之几，圆就会被窗口边界切出方角。
   * 因此反馈只用透明度与阴影——它们不会改变球的占位。
   */
  transform: none;
}

/* 顶栏藏起来时球浮在右上角。右栏会被强制保留，所以那里一定是 chrome 的地盘 */
.ball.floating {
  position: absolute;
  top: var(--zhituan-ball-margin);
  right: var(--zhituan-ball-margin);
}

/*
 * 收起态：窗口就是球，球紧贴着窗口的四条边。
 * clip-path 是保险：窗口本应是正方形（主进程按球心摆一个正方形，见
 * WindowController.collapsedBounds），但平台有最小窗口尺寸，万一还是被卡成
 * 非正方，border-radius 会画出椭圆。circle(closest-side) 取短边作直径，
 * 窗口是正方形时与 border-radius: 50% 完全一致，不是时也仍是正圆。
 */
.ball.collapsed {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  clip-path: circle(closest-side at 50% 50%);
}

.ball.docked {
  /* 展开态下它只是一个开关，不影响正文区域的观感 */
  opacity: 0.45;
}

/*
 * 自定义图。两种落法只差尺寸与裁切：
 * cover 铺满球面并圆裁（像一张头像），glyph 缩在球心（尺寸由行内样式给）。
 *
 * 两种都留着球的底色：图不透明时它整个被盖住，图的透明部分上它正好补底。
 * 少了这层，一张透明底的图会让球在收起态下整颗消失——而那一刻球就是窗口的全部。
 */
.custom {
  display: block;
  /* 图不能被原生拖动：拖球是移动窗口，浏览器插手的图片拖动会把它顶掉 */
  user-select: none;
  -webkit-user-drag: none;
}

.custom.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.custom.glyph {
  object-fit: contain;
}

.ball:hover {
  opacity: 1;
  box-shadow: 0 3px 12px rgba(17, 24, 39, 0.34);
}

/* 按下时向内收，而不是向外扩 */
.ball:active {
  cursor: grabbing;
  opacity: 1;
  box-shadow:
    0 1px 4px rgba(17, 24, 39, 0.3),
    inset 0 0 0 2px color-mix(in srgb, var(--zhituan-on-fill) 45%, transparent);
}

.ball:focus-visible {
  opacity: 1;
  outline: 2px solid var(--zhituan-accent);
  outline-offset: 2px;
}

/*
 * 收起态：窗口正好是球的尺寸，球紧贴着窗口的四条边。
 * 阴影与向外的焦点环都会画到球外面去，而那里已经没有窗口了——
 * 结果是四个角上留下四块灰影，看着像窗口没切干净。
 * 因此这一态下不画任何超出球面的东西，反馈只靠透明度。
 */
.ball.collapsed,
.ball.collapsed:hover,
.ball.collapsed:active {
  box-shadow: none;
}

.ball.collapsed:focus-visible {
  outline-offset: -4px;
}
</style>
