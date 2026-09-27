/**
 * 更新状态的响应式镜像。
 *
 * 与 useWindowState / useConfig 逐字同构：挂载时拉一次、订阅广播、卸载退订。
 * 提示条与设置页各持有一份，靠同一条广播对齐——因此设置页点「更新并重启」时，
 * 窗口顶部那条提示上的百分比是同一个数。
 *
 * 三个动作里没有「下载」：下载是「检查更新」与「更新并重启」各自的后半截，
 * 界面上没有单独一颗下载按钮（见 updateService 的 check / install）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { UpdateState } from '@shared/types'

export function useUpdate() {
  const state = ref<UpdateState | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(async () => {
    state.value = await window.zhituan.update.get()
    unsubscribe = window.zhituan.update.onState((next) => {
      state.value = next
    })
  })

  onUnmounted(() => unsubscribe?.())

  /**
   * 查一次；查到比现在新就开始下。手动查不受「自动检查更新」那个开关管。
   *
   * 这一下要等的是**查**，不是下载：查完主进程就把下载起起来自己走了，回来时
   * 状态已经是 downloading，之后每一步都由广播送过来。
   */
  async function check(): Promise<void> {
    state.value = await window.zhituan.update.check()
  }

  /**
   * 更新并重启。已经下好就立刻装并退出；还在下就记下这个意图、下完自己装。
   *
   * 不等回执也不用回执——这个调用成功的话，本进程马上就不在了（或者还要等
   * 那一百多兆下完），两种情况都没有什么可等的。
   */
  function install(): void {
    void window.zhituan.update.install()
  }

  /** 忽略这个版本（传 null 是撤销）；下一次查到别的版本照常提示 */
  async function ignore(version: string | null): Promise<void> {
    state.value = await window.zhituan.update.ignore({ version })
  }

  return { state, check, install, ignore }
}
