/**
 * 从一枚 DOM 元素上开一张弹出面板。
 *
 * 面板的**位置不由界面算**：主进程按锚点矩形与屏幕工作区决定摆在锚点的哪一侧
 * （见 services/popoverWindow.ts 的 place）。因此这里只做一件事——把按下的那个
 * 元素量成矩形报上去。
 *
 * 顶栏那枚 Aa 与右栏那四格走的是同一条路。量法抄成两份迟早会差出几个像素
 * （两块的高度本来就不一样，一个 44px、一个满高），而这几行里没有一处是
 * 调用方可以自己决定的。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { OpenPopoverRequest } from '@shared/ipc'

/** 按下的那个元素（`@click` 里的 `$event.currentTarget`）所在的矩形，就是面板的锚点 */
export function openPopoverAt(kind: OpenPopoverRequest['kind'], event: MouseEvent): void {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  void window.zhituan.ui.openPopover({
    kind,
    anchorRect: {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height)
    }
  })
}
