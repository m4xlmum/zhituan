/**
 * 悬浮球图标的响应式镜像：内置的那一枚来自配置，自定义的那张来自 ballIcon 通道。
 *
 * 两处要用同一份判断（球自己、系统设置里的选择器），因此做成组合式函数：
 * 「选了自定义但图不在」该退回内置图标这条规则只此一处。
 *
 * 那两个来源是**分开的**——自定义图有几十 KB，进配置就意味着透明度滑块每动一格
 * 都要把它推一遍（见 services/ballIconStore.ts）。分开之后这里要自己把两份拼起来。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CUSTOM_BALL_ICON, DEFAULT_BALL_CUSTOM_FIT, DEFAULT_BALL_ICON } from '@shared/constants'
import type { BallCustomFit, BallIcon, BallIconChoice } from '@shared/constants'
import { useConfig } from './useConfig'

export function useBallIcon() {
  const { config, patch } = useConfig()
  /** 用户上传的那张图（data URI）。null = 没有 */
  const customSrc = ref<string | null>(null)
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    /*
     * 先订阅再取，不能反过来：反过来的话，「取」与「订阅」之间发生的那一次变更
     * 会丢——球从此停在旧图上，直到用户下次再动它一下。
     */
    unsubscribe = window.zhituan.ballIcon.onChanged((next) => {
      customSrc.value = next
    })
    void window.zhituan.ballIcon.get().then((next) => {
      customSrc.value = next
    })
  })

  onUnmounted(() => unsubscribe?.())

  /** 配置里选的图标。配置还没到时按默认，避免球先闪一下空的 */
  const choice = computed<BallIconChoice>(() => config.value?.ui.ballIcon ?? DEFAULT_BALL_ICON)

  const fit = computed<BallCustomFit>(
    () => config.value?.ui.ballCustomFit ?? DEFAULT_BALL_CUSTOM_FIT
  )

  /**
   * 此刻该画自定义图吗。
   *
   * 配置里写着 'custom' 却没有图（文件被删、复制配置时漏了它），
   * 或者图就是空的——这两种都退回内置图标。宁可画错一枚图标，
   * 也不能留一个画不出东西的空球：球是收起态下整扇窗的全部内容，
   * 空球等于窗口不见了。
   */
  const custom = computed(() => choice.value === CUSTOM_BALL_ICON && !!customSrc.value)

  /** 真正要画的内置图标。选了自定义且有图时不看它 */
  const builtinIcon = computed<BallIcon>(() =>
    choice.value === CUSTOM_BALL_ICON ? DEFAULT_BALL_ICON : choice.value
  )

  function setIcon(next: BallIconChoice): Promise<void> {
    return patch({ ui: { ballIcon: next } })
  }

  function setFit(next: BallCustomFit): Promise<void> {
    return patch({ ui: { ballCustomFit: next } })
  }

  /**
   * 存一张新图。
   *
   * 主进程可能拒收（超限、不是图片）并回 null，于是这里要拿**返回值**而不是
   * 自己传进去的那个当作新的现状——不然界面会显示一张根本没存下来的图。
   */
  async function setImage(dataUrl: string | null): Promise<void> {
    customSrc.value = await window.zhituan.ballIcon.set({ dataUrl })
  }

  return { customSrc, choice, fit, custom, builtinIcon, setIcon, setFit, setImage }
}
