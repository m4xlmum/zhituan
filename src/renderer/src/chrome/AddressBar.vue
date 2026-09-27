<script setup lang="ts">
/**
 * 地址栏，默认折叠在顶栏下方。
 *
 * 它只在自己被唤出时才挂载：高度归零不是把它藏起来，而是整行不占位，
 * 正文直接顶到顶栏下沿。展开与折叠由主进程裁定（正文是原生视图，
 * 必须和它同时让位），这里只负责发出意图、按回传的状态绘制。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onMounted, ref, watch } from 'vue'
import type { TabState } from '@shared/types'
import { useWindowDrag } from '../composables/useWindowDrag'

const props = defineProps<{
  activeTabId: string | null
  activeTab: TabState | null
}>()

/** 这一行也能拖窗口：输入框以外的部分（上下那几像素、两端的留白）都是拖动的落点 */
const drag = useWindowDrag()

const input = ref('')
const editing = ref(false)
const field = ref<HTMLInputElement | null>(null)

/**
 * 未编辑时地址栏跟随当前标签页；编辑时不抢用户的输入。
 *
 * 停在起始页 / 系统设置上时留空：此刻没有当前网页（那两个视图不在标签状态里），
 * 而这两屏里本来也没有网址可显示。
 */
watch(
  () => props.activeTab?.url,
  (url) => {
    if (editing.value) return
    input.value = url ?? ''
  },
  { immediate: true }
)

// 这一行只会在被主动唤出时挂载，所以挂载即聚焦
onMounted(() => {
  field.value?.focus()
  field.value?.select()
})

function close(): void {
  window.zhituan.win.setAddressOpen({ open: false })
}

/**
 * 回车即打开。
 *
 * `tabId` 可以是 null——正文区正停在起始页或系统设置上时就是它。
 * 那两屏不承载访客内容，主进程会另开一张网页标签并切过去（见 TabManager.goto）。
 * 因此这里不必先挡一道「没有当前页就别提交」：那样按回车会毫无反应，
 * 而用户的意图是明确的。
 */
function submit(): void {
  const value = input.value.trim()
  if (!value) return
  editing.value = false
  close()
  void window.zhituan.nav.goto({ tabId: props.activeTabId, input: value })
}
</script>

<template>
  <div
    class="address-row"
    @pointerdown="drag.onPointerDown"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerCancel"
  >
    <form class="field" @submit.prevent="submit">
      <input
        ref="field"
        v-model="input"
        type="text"
        placeholder="输入网址，或输入关键词搜索"
        spellcheck="false"
        @focus="editing = true"
        @blur="close"
        @keydown.esc="close"
      />
    </form>
  </div>
</template>

<style scoped>
.address-row {
  flex: 0 0 auto;
  height: var(--zhituan-address-h);
  display: flex;
  align-items: center;
  /* 这一行不与悬浮球重叠：球停在顶栏的槽位里，或停在右侧栏，
     两种情况都够不到这里，因此不预留槽位 */
  padding: 0 8px;
  background: var(--zhituan-surface);
  border-bottom: 1px solid var(--zhituan-hairline);
}

/* 做成浏览器的地址框：浅底圆角，而不是一条下划线 */
.field {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
}

.field input {
  width: 100%;
  height: 24px;
  padding: 0 12px;
  background: var(--zhituan-surface-hover);
  border: 1px solid transparent;
  border-radius: var(--zhituan-radius);
  color: var(--zhituan-ink);
  outline: none;
  transition: background 120ms ease-out, border-color 120ms ease-out;
}

.field input::placeholder {
  color: var(--zhituan-text-faint);
}

.field input:hover {
  background: var(--zhituan-surface-active);
}

.field input:focus {
  background: var(--zhituan-surface);
  border-color: var(--zhituan-accent);
}

/* 焦点不能只靠颜色：低透明度下背景与描边的变化不足以定位 */
.field input:focus-visible {
  outline: 2px solid var(--zhituan-accent);
  outline-offset: 1px;
}
</style>
