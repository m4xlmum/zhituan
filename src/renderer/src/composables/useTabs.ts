/**
 * 标签页状态的响应式镜像。状态由主进程推送，这里只做展示。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { OwnScreen, TabState } from '@shared/types'

export function useTabs() {
  const tabs = ref<TabState[]>([])
  const activeTabId = ref<string | null>(null)
  /** 正文区此刻停在自家哪一屏上；看着网页时为 null */
  const screen = ref<OwnScreen | null>(null)
  /** 上一次看着的那张网页的 id；顶栏那个地址栏开关靠它（见 TopBar 的 siteLabel） */
  const lastTabId = ref<string | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(async () => {
    const initial = await window.zhituan.tabs.list()
    tabs.value = initial.tabs
    activeTabId.value = initial.activeTabId
    screen.value = initial.screen
    lastTabId.value = initial.lastTabId

    unsubscribe = window.zhituan.tabs.onState((payload) => {
      tabs.value = payload.tabs
      activeTabId.value = payload.activeTabId
      screen.value = payload.screen
      lastTabId.value = payload.lastTabId
    })
  })

  onUnmounted(() => unsubscribe?.())

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)
  const lastTab = computed(() => tabs.value.find((t) => t.id === lastTabId.value) ?? null)

  return { tabs, activeTabId, activeTab, screen, lastTabId, lastTab }
}
