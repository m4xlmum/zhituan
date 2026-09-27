/**
 * 界面底板透明度：把配置里的 ui.backgroundOpacity 写成 --zhituan-alpha。
 *
 * 必须写在**文档根**（documentElement）上，而不是组件自己的根节点上。
 *
 * tokens.css 里那几条底板色是在 :root 上用 `rgb(... / var(--zhituan-alpha))` 拼出来的，
 * 而自定义属性里的 var() 是在**声明它的那个元素**上完成替换的：:root 上算出来的
 * 就是一个定了值的颜色，之后只是把这个结果继承下去。于是写在下层元素上的
 * --zhituan-alpha 根本轮不到参与替换。实测过这个坑：--zhituan-alpha 报 0.35，
 * 而顶栏实测底色仍是 rgb(255, 255, 255)——不透明，滑块看着在动，画面纹丝不动。
 * 两者必须落在同一个元素上，也就是 :root。
 *
 * ChromeApp 与 PopoverApp 各是一份文档，各调一次。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { watchEffect, type Ref } from 'vue'
import type { AppConfig } from '@shared/types'

export function useBackgroundAlpha(config: Ref<AppConfig | null>): void {
  watchEffect(() => {
    document.documentElement.style.setProperty(
      '--zhituan-alpha',
      String(config.value?.ui.backgroundOpacity ?? 1)
    )
  })
}
