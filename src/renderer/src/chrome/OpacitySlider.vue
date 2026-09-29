<script setup lang="ts">
/**
 * 竖直百分比滑块（右栏版）。整体透明度、背景透明度与离线阅读透明度共用这一个。
 *
 * 三条的下限不一样，因此 min / max 由调用方给：
 * 界面透明度的下限锁在 5%（0% 会让窗口不可见却仍可交互，用户会以为自己
 * 把窗口弄丢了，真正「藏起来」请用老板键或托盘）；背景透明度与阅读透明度的
 * 下限都是 0——它们分别只作用在界面自己画的底板上、以及正在读的那一份上
 * （PDF 那张纸、TXT 的正文），栏与控件始终不透明，拉到 0 剩下的是
 * 「浮在桌面上的一排按钮」或者「读的东西不在、界面还在」，锁不住自己。
 *
 * 而「此刻管不管得着」是另一回事：阅读透明度只作用在离线阅读上，
 * 停在网页或起始页上时它下面没有可作用的对象，于是由调用方传 disabled
 * 禁掉——与右栏那三格缩放同一个道理，不装作能点（见 Rail.vue）。
 * 禁用时只剩「读数 + 一个灰点」，值仍在，只是这一档改不动它。
 *
 * 横条转 90° 放置，而不是用竖排 Input：Chromium 的 range 只有横向是稳定的，
 * 竖排写法各版本表现不一，而 transform 一定可靠。
 * 旋转不改变布局盒，所以外框必须按旋转**后**的尺寸留位。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    /** 显示在数值上方的小字 */
    label: string
    /** 取值范围（与 modelValue 同为 0–1 的分数） */
    min?: number
    max?: number
    /** tooltip 里追加的一句说明 */
    hint?: string
    /**
     * 此刻没有可作用的对象（见文件头）。
     *
     * 禁用是**真的禁用**（input 上那颗 disabled），不只是画灰一点：
     * 灰着却还能拖，会让人以为「拖了没反应」是坏了。
     */
    disabled?: boolean
  }>(),
  { min: 0, max: 1, disabled: false }
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const dragging = ref(false)

/** 拖动期间不回写显示值，避免主进程回传造成的抖动 */
const localValue = ref(props.modelValue)

/**
 * 「刚拖到、还没被确认」的那个值。
 *
 * 松手那一帧 modelValue 还没跟上——写一次窗口透明度是一次 IPC 往返，广播回来
 * 更晚，而 Vue 的状态更新在微任务里就刷了。于是松手后先画出来的那一帧读到的
 * 仍是改动前的旧值（默认 100%），滑块当着用户的面跳回去；整体透明度那条更糟，
 * 从前主进程根本不广播，跳回去就再也不回来了。
 *
 * 因此把自己刚拖到的值记在这里，显示先按它来，等 modelValue 真的追上
 * （或用户又按下去）再交还给 props。
 */
const unconfirmed = ref<number | null>(null)

const current = computed(() =>
  dragging.value ? localValue.value : (unconfirmed.value ?? props.modelValue)
)
const displayValue = computed(() => Math.round(current.value * 100))

// 模型一变就以它为准：那说明这一次写入已经有了下文（多半正是自己刚拖到的值，
// 也可能是主进程夹紧后的结果——夹过也照它的，只有它说的是真话）
watch(
  () => props.modelValue,
  () => {
    unconfirmed.value = null
  }
)

/** 从**画着的那一格**起步，而不是从 props 起步：上面那个未确认的值可能正被显示着 */
function onPointerDown(): void {
  localValue.value = current.value
  unconfirmed.value = null
  dragging.value = true
}

function onInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value) / 100
  const value = Math.max(props.min, Math.min(props.max, raw))
  localValue.value = value
  unconfirmed.value = value
  emit('update:modelValue', value)
}

const title = computed(
  () => `${props.label} ${displayValue.value}%${props.hint ? `（${props.hint}）` : ''}`
)
</script>

<template>
  <div class="opacity" :class="{ off: disabled }">
    <span class="label">{{ label }}</span>
    <span class="value">{{ displayValue }}%</span>
    <div class="track-wrap">
      <input
        class="slider"
        type="range"
        :min="Math.round(min * 100)"
        :max="Math.round(max * 100)"
        :value="displayValue"
        :disabled="disabled"
        :title="title"
        :aria-label="title"
        @pointerdown="onPointerDown"
        @pointerup="dragging = false"
        @input="onInput"
      />
    </div>
  </div>
</template>

<style scoped>
.opacity {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  /*
   * 上下各留一点，下面那 1px 是去掉了 4px 换来的。
   *
   * 第三条滑块（阅读）一进来，960×540 这一档的功能栈就从「正好不滚」变成
   * 溢出 3px——最下面那条滑块的底边被裁掉一线。一列里三条各让出 3px 就够，
   * 而它们之间本来还有栈的 2px 空隙与分隔线自己的 6px 外边距，少这 3px
   * 一点也不挤。实测（preview.js 的 RAIL_STACK）：溢出 3px → 余 6px。
   */
  padding: 2px 0 1px;
}

.label,
.value {
  color: var(--zhituan-text-dim);
  font-size: 11px;
  line-height: 12px;
  font-variant-numeric: tabular-nums;
}

.label {
  color: var(--zhituan-text-faint);
}

.track-wrap {
  /*
   * 横条的长度与厚度。长度同时决定槽的高度、横条的宽度与居中偏移，
   * 三处必须一致，所以只在这里写一次，由子元素继承。
   *
   * 长度由**调用方**给：`--zhituan-rail-track` 是右栏按窗口高度算出来的
   * （见 Rail.vue 里那一段账），窗口矮的时候三条一起缩，免得最底下那条被
   * 折叠线裁掉一半。56px 只是「不在那条栏里时的兜底」，也是默认档 960×540
   * 下算出来的那个值。
   */
  --track-len: var(--zhituan-rail-track, 56px);
  --track-thick: 14px;
  position: relative;
  width: 16px;
  height: var(--track-len);
}

/*
 * 绝对定位，并且用负外边距居中——不能靠父级的居中来摆这一条。
 *
 * 横条（宽 56）比槽（宽 16）宽得多。作为 grid 项时 Chromium 不会两侧均分溢出，
 * 而是从槽的左沿向右排（实测：槽在文档 x 929..945，输入框落在 931..1041，
 * 中心偏右 49px）；改用 inset:0 + margin:auto 也一样，因为负的 auto 外边距
 * 不成立，LTR 下 margin-left 会被归零，结果仍是向右溢出 28px。
 * 两种情况下转 90° 之后整条都落到可视列之外，看上去就是这个控件根本不存在。
 *
 * 因此这里把「居中」写成明确的一半尺寸偏移，与父级宽度无关。
 *
 * 56px 是默认档 960×540 下算出来的那个长度：这一栏里现在有**三条**滑块
 * （整体、背景、阅读），而 960×540 留给功能栈的正好是 488px。三条各 56px 的轨道，
 * 连着各自上下两行小字，一条占 85px，加上上面那几格按钮与分隔线，正好把这一列
 * 填满——实测溢出 0px，一格不多一格不少（preview.js 的 RAIL_STACK）。
 * 它是**上限**而不是定值：窗口变矮时由 Rail 把三条一起缩下去（那个 clamp 的
 * 账写在 Rail.vue 里），因此这个数在这里只当兜底。下限 30px 是精度与「还看得见
 * 拇指」两头夹出来的；再矮就由整条栈自己滚（迷你档 480×270 实测溢出 264px）。
 */
.slider {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--track-len);
  height: var(--track-thick);
  margin-left: calc(var(--track-len) / -2);
  margin-top: calc(var(--track-thick) / -2);
  transform: rotate(-90deg);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

/*
 * 轨道与滑块同高（14px），二者之间就没有居中歧义——
 * 视觉上的那条细线由背景渐变画出来，命中区域则保持 14px 宽。
 */
.slider::-webkit-slider-runnable-track {
  height: 14px;
  border-radius: var(--zhituan-radius-track);
  background-image: linear-gradient(var(--zhituan-border), var(--zhituan-border));
  background-size: 100% 3px;
  background-position: center;
  background-repeat: no-repeat;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--zhituan-accent);
}

/* 键盘焦点必须看得见：滑块的默认轮廓已被去掉，这里补回来 */
.slider:focus-visible {
  outline: 2px solid var(--zhituan-accent);
  outline-offset: 3px;
}

/*
 * 禁用态：读数退到最淡的一档，滑块从那颗实心点变成一个灰点。
 *
 * **位置照旧按当前值摆着**——这个值是存下来的配置，不是「没有值」；
 * 换回一本本机文件，它就照这个值淡给你看。因此这里只改颜色，不动读数。
 */
.opacity.off .value {
  color: var(--zhituan-text-faint);
}

.opacity.off .slider {
  cursor: default;
}

.opacity.off .slider::-webkit-slider-thumb {
  background: var(--zhituan-border);
}
</style>
