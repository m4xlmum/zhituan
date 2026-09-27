<script setup lang="ts">
/**
 * 自定义悬浮球图标的裁剪弹窗。
 *
 * 只做一件事：让用户在**方形**取景框里决定留下哪一块，然后按 128×128 导出。
 *
 * 为什么是方形而不是圆形取景：同一张图在球的两种落法里都要用。
 * 铺满球面时它会被球裁成圆（方形四角本来也看不见，所以框里画一圈虚线提示），
 * 而缩成中央图案时它是一个方方正正的小图——若在这里就裁成圆，
 * 那一档的四个角会被白裁一次。
 *
 * 导出用 Chromium 自己的 WebP 编码（canvas.toDataURL），本仓库不为一张图标
 * 引入图像处理依赖（`spike/readme-assets.js` 已经在用同一条路）。
 * 读文件用 FileReader 转 data URI 而不是 URL.createObjectURL：这个页面的 CSP
 * 只放行 `img-src 'self' data: https:`，blob: 会被挡下来。
 *
 * 弹窗里放一枚**真实的 40px 球**做预览——128×128 的裁剪结果缩到球上还剩多少
 * 看得出来吗，只有按真实尺寸看一遍才知道。预览的变换与导出的变换是同一套数字，
 * 因此它不是一个「差不多」的示意图。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BALL_GLYPH_SIZE, BALL_IMAGE_SIZE, BALL_SIZE } from '@shared/constants'
import type { BallCustomFit } from '@shared/constants'

const props = defineProps<{
  /** 打开时先载入的图（「重新裁剪」时是当前那张）。null 表示从空白开始 */
  source?: string | null
  /** 球的落法，决定预览里图占多大一块 */
  fit: BallCustomFit
}>()

const emit = defineEmits<{ save: [dataUrl: string]; cancel: [] }>()

/** 缩放档位。1 = 恰好铺满取景框，再大就是放大 */
const ZOOM_MIN = 1
const ZOOM_MAX = 4

/**
 * 取景框边长（CSS px）。
 *
 * 挂载时按窗口量一次：这个窗口可能只有 480×270（迷你档），
 * 写死 240 会让弹窗在那种尺寸下被裁掉一半。导出的数学与它无关——
 * 换算系数是 BALL_IMAGE_SIZE / S，S 变小时只是取景框画得小一点。
 */
const S = ref(240)

const srcUrl = ref<string | null>(null)
const nat = ref<{ w: number; h: number } | null>(null)
const error = ref('')
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)

/** 解码后的那张图，导出时直接画它 */
let sourceEl: HTMLImageElement | null = null

onMounted(() => {
  S.value = Math.round(
    Math.min(240, Math.max(140, Math.min(window.innerWidth - 210, window.innerHeight - 200)))
  )
  window.addEventListener('keydown', onKey)
  if (props.source) void load(props.source)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** 图以「铺满取景框」为 1 倍。之后所有几何都由它推出来 */
const base = computed(() =>
  nat.value ? Math.max(S.value / nat.value.w, S.value / nat.value.h) : 1
)
const drawW = computed(() => (nat.value ? nat.value.w * base.value * zoom.value : 0))
const drawH = computed(() => (nat.value ? nat.value.h * base.value * zoom.value : 0))

/** 平移量（相对取景框中心的像素）。夹在「图始终盖满取景框」的范围里 */
function clampOffsets(): void {
  const mx = Math.max(0, (drawW.value - S.value) / 2)
  const my = Math.max(0, (drawH.value - S.value) / 2)
  offsetX.value = Math.min(mx, Math.max(-mx, offsetX.value))
  offsetY.value = Math.min(my, Math.max(-my, offsetY.value))
}

function setZoom(next: number): void {
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
  clampOffsets()
}

async function load(url: string): Promise<void> {
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    error.value = '这张图读不出来，换一张试试'
    return
  }
  sourceEl = img
  srcUrl.value = url
  nat.value = { w: img.naturalWidth, h: img.naturalHeight }
  zoom.value = ZOOM_MIN
  offsetX.value = 0
  offsetY.value = 0
  error.value = ''
}

/** 选文件。FileReader 转 data URI 后再走统一那条路 */
function pickFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 清掉 input 的值，否则再选同一张不会触发 change
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '请选一张图片（PNG / JPEG / WebP）'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') void load(reader.result)
    else error.value = '这个文件读不出来'
  }
  reader.onerror = () => {
    error.value = '这个文件读不出来'
  }
  reader.readAsDataURL(file)
}

// ---------------------------------------------------------------- 拖动与缩放

let dragging: { x: number; y: number; ox: number; oy: number } | null = null

function onDown(event: PointerEvent): void {
  if (!srcUrl.value) return
  dragging = { x: event.clientX, y: event.clientY, ox: offsetX.value, oy: offsetY.value }
  try {
    // 捕获指针：光标滑出取景框那一刻拖动不该断。
    // 合成出来的 PointerEvent（无头探针用的那种）没有真的指针可捕获，这里会抛
    // NotFoundError——它不该把拖动一起带走，因此单独兜住。
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    /* 捕获不到也能拖，只是滑出去就断 */
  }
  // 挡掉默认行为：不挡的话拖动会变成选中图片、甚至触发原生图片拖动
  event.preventDefault()
}

function onMove(event: PointerEvent): void {
  if (!dragging) return
  offsetX.value = dragging.ox + (event.clientX - dragging.x)
  offsetY.value = dragging.oy + (event.clientY - dragging.y)
  clampOffsets()
}

function onUp(): void {
  dragging = null
}

function onWheel(event: WheelEvent): void {
  if (!srcUrl.value) return
  setZoom(zoom.value * (event.deltaY > 0 ? 0.92 : 1.08))
}

function reset(): void {
  setZoom(ZOOM_MIN)
  offsetX.value = 0
  offsetY.value = 0
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('cancel')
}

// ---------------------------------------------------------------- 预览与导出

/** 取景框里那张图的位置与大小。取景框与弹窗里的那枚球共用它 */
const imgStyle = computed(() => ({
  left: '50%',
  top: '50%',
  width: `${drawW.value}px`,
  height: `${drawH.value}px`,
  transform: `translate(-50%, -50%) translate(${offsetX.value}px, ${offsetY.value}px)`
}))

/** 预览里图占的那一块：铺满时是整颗球，中央图案时是球面上那个图形的边长 */
const previewBox = computed(() => (props.fit === 'cover' ? BALL_SIZE : BALL_GLYPH_SIZE))

/**
 * 预览的内层：把一个与取景框等大的盒子整体缩到球上，再把它摆到球心。
 *
 * 缩放原点取左上角（`transform-origin: 0 0`），于是「摆到球心」这一步
 * 就是给左上角一个偏移——缩完之后那块正好是 box × box，居中即 (球径 − box) / 2。
 * 与取景框共用同一份 imgStyle，所以预览里看到的就是导出后会被画出来的那一块。
 */
const previewInnerStyle = computed(() => {
  const box = previewBox.value
  const inset = (BALL_SIZE - box) / 2
  return {
    left: `${inset}px`,
    top: `${inset}px`,
    width: `${S.value}px`,
    height: `${S.value}px`,
    transform: `scale(${box / S.value})`,
    transformOrigin: '0 0'
  }
})

const canSave = computed(() => !!srcUrl.value)

function save(): void {
  const img = sourceEl
  if (!img) return
  const size = BALL_IMAGE_SIZE
  const k = size / S.value
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    error.value = '这台机器上画不出来，换个方式试试'
    return
  }
  ctx.imageSmoothingQuality = 'high'
  const w = drawW.value * k
  const h = drawH.value * k
  ctx.drawImage(img, size / 2 + offsetX.value * k - w / 2, size / 2 + offsetY.value * k - h / 2, w, h)
  emit('save', canvas.toDataURL('image/webp', 0.9))
}
</script>

<template>
  <div class="cropper" @click.self="emit('cancel')">
    <div class="sheet">
      <div class="head">
        <h3>自定义悬浮球图标</h3>
        <p class="hint">
          拖动图调整位置，滚轮或滑块缩放。虚线圈里是「铺满球面」时看得见的部分。
        </p>
      </div>

      <div class="body">
        <div class="stage-col">
          <div
            class="stage"
            :class="{ empty: !srcUrl }"
            :style="{ width: `${S}px`, height: `${S}px` }"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @wheel.prevent="onWheel"
          >
            <div class="inner" :style="{ width: `${S}px`, height: `${S}px` }">
              <img v-if="srcUrl" :src="srcUrl" :style="imgStyle" alt="" draggable="false" />
            </div>
            <div class="ring"></div>
            <p v-if="!srcUrl" class="placeholder">还没有选图</p>
          </div>

          <div class="zoom">
            <span class="zoom-label">缩放</span>
            <input
              class="zoom-range"
              type="range"
              :min="ZOOM_MIN"
              :max="ZOOM_MAX"
              step="0.01"
              :value="zoom"
              :disabled="!srcUrl"
              @input="setZoom(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="zoom-value">{{ zoom.toFixed(2) }}×</span>
          </div>
        </div>

        <div class="side">
          <div class="side-label">缩到球上是这样</div>
          <div class="ball-preview" :style="{ '--ball': `${BALL_SIZE}px` }">
            <div class="preview-inner" :style="previewInnerStyle">
              <img v-if="srcUrl" :src="srcUrl" :style="imgStyle" alt="" draggable="false" />
            </div>
          </div>
          <div class="side-label dim">{{ fit === 'cover' ? '铺满球面' : '中央图案' }}</div>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <label class="btn">
          选择图片
          <input
            class="file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            @change="pickFile"
          />
        </label>
        <button class="btn" :disabled="!srcUrl" @click="reset">重置</button>
        <span class="spacer"></span>
        <button class="btn" @click="emit('cancel')">取消</button>
        <button class="btn primary" :disabled="!canSave" @click="save">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 盖住整个设置页。这一页本身是可滚动的，弹窗自己也要能滚——迷你档只有 270 高 */
.cropper {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
  background: rgba(9, 11, 14, 0.55);
  backdrop-filter: blur(2px);
}

.sheet {
  max-width: 100%;
  padding: 18px 20px 16px;
  border-radius: var(--zhituan-radius-md, 12px);
  background: var(--zhituan-panel, #ffffff);
  color: var(--zhituan-ink, #111827);
  box-shadow: 0 18px 48px rgba(9, 11, 14, 0.35);
}

.head h3 {
  font-size: 15px;
  font-weight: 600;
}

.head .hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--zhituan-text-dim, #6b7280);
}

.body {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  margin-top: 14px;
}

/* 取景框。棋盘底是为了让透明区域看得出来——不然透明底会和弹窗底色混成一片 */
.stage {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 8px;
  cursor: grab;
  touch-action: none;
  background-color: #eef0f3;
  background-image:
    linear-gradient(45deg, rgba(17, 24, 39, 0.08) 25%, transparent 25% 75%, rgba(17, 24, 39, 0.08) 75%),
    linear-gradient(45deg, rgba(17, 24, 39, 0.08) 25%, transparent 25% 75%, rgba(17, 24, 39, 0.08) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}

.stage.empty {
  cursor: default;
}

.stage:active:not(.empty) {
  cursor: grabbing;
}

.inner {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.inner img {
  position: absolute;
  max-width: none;
  user-select: none;
  -webkit-user-drag: none;
}

/* 「铺满球面」时看得见的那一圈。只做提示，不挡指针（拖动要能穿过它） */
.ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.25);
  pointer-events: none;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--zhituan-text-dim, #6b7280);
  pointer-events: none;
}

.stage-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.zoom {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--zhituan-text-dim, #6b7280);
}

.zoom-range {
  flex: 1 1 auto;
  min-width: 0;
}

.zoom-value {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.side-label {
  font-size: 12px;
  color: var(--zhituan-text-dim, #6b7280);
  white-space: nowrap;
}

.side-label.dim {
  opacity: 0.75;
}

/*
 * 预览：一枚**真实尺寸**的球。球面上的图形与球一个颜色（都是白字压在强调色上），
 * 因此这里照抄球的底与前景色，而不是另配一套。
 */
.ball-preview {
  position: relative;
  width: var(--ball, 40px);
  height: var(--ball, 40px);
  border-radius: 50%;
  overflow: hidden;
  background: var(--zhituan-accent, #2563eb);
}

/* 位置与缩放全部由行内样式给（见 previewInnerStyle），这里只管裁切 */
.preview-inner {
  position: absolute;
  overflow: hidden;
}

.preview-inner img {
  position: absolute;
  max-width: none;
  user-select: none;
  -webkit-user-drag: none;
}

.error {
  margin-top: 10px;
  font-size: 12px;
  color: var(--zhituan-danger, #b42318);
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.spacer {
  flex: 1 1 auto;
}

.btn {
  position: relative;
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--zhituan-radius-sm, 6px);
  border: 1px solid var(--zhituan-hairline, rgba(17, 24, 39, 0.12));
  background: transparent;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
}

/*
 * 悬停的那一层过去是 5% 的黑（叠在纸白面板上是 #f2f2f2）。改成令牌之后
 * 纸白下是 #f3f4f6——差 2/255，换来的是它在暗夜下真的看得见：
 * 5% 的黑叠在 #16181d 上，与没悬停时是同一个颜色。
 */
.btn:hover:not(:disabled) {
  background: var(--zhituan-surface-hover, rgba(17, 24, 39, 0.05));
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn.primary {
  border-color: transparent;
  background: var(--zhituan-accent, #2563eb);
  color: var(--zhituan-on-fill, #ffffff);
}

.btn.primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

/* 选文件那个按钮：input 铺满按钮并透明，点哪儿都是它 */
.file {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

@media (max-width: 560px) {
  .body {
    gap: 12px;
  }

  .side {
    display: none;
  }
}
</style>
