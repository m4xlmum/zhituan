/**
 * 配置的响应式镜像。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { ConfigPatch } from '@shared/ipc'
import type { AppConfig } from '@shared/types'

export function useConfig() {
  const config = ref<AppConfig | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(async () => {
    config.value = await window.zhituan.config.get()
    unsubscribe = window.zhituan.config.onChanged((next) => {
      config.value = next
    })
  })

  onUnmounted(() => unsubscribe?.())

  async function patch(input: ConfigPatch): Promise<void> {
    config.value = await window.zhituan.config.patch(input)
  }

  return { config, patch }
}
