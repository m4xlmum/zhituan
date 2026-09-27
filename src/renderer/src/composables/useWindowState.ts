/**
 * 窗口运行状态的响应式镜像（展开 / 收起成球、界面透明度）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { WindowRuntime } from '@shared/types'

export function useWindowState() {
  const state = ref<WindowRuntime | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(async () => {
    state.value = await window.zhituan.win.getState()
    unsubscribe = window.zhituan.win.onState((next) => {
      state.value = next
    })
  })

  onUnmounted(() => unsubscribe?.())

  /** 整个界面缩成悬浮球 */
  function collapse(): void {
    void window.zhituan.win.collapse()
  }

  /** 从悬浮球展开回完整界面 */
  function expand(): void {
    void window.zhituan.win.expand()
  }

  /** 铺满当前显示器的整个工作区（两栏与地址栏随之让位） */
  function maximize(): void {
    void window.zhituan.win.maximize()
  }

  /** 从最大化回到之前的 16:9 矩形 */
  function restore(): void {
    void window.zhituan.win.restore()
  }

  return { state, collapse, expand, maximize, restore }
}
