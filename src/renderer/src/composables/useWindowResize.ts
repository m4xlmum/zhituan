/**
 * 拖窗口的边缘改大小。与 useWindowDrag 是一对：一个改位置，一个改尺寸。
 *
 * 界面只管「开始」与「结束」两个信号，中间每一帧由主进程算（它读得到全局光标，
 * 而渲染进程的指针一旦离开窗口就收不到事件了）。因此这里按下时要把**拖的是哪条边**
 * 报上去——那是界面独有的信息，主进程无从知道。
 *
 * 「哪条边」是当参数传进来的，而不是每个手柄各调一次这个组合式函数：
 * 八条边由 ResizeFrame 里同一张表生成，边名跟着表走，两处不可能对不上；
 * 一个手柄一次调用则要挂八份 window 的 blur 监听，收尾逻辑也散在八处。
 *
 * 与拖动不同的是这里没有「点击」这一说：手柄上按一下不拖动，什么也不该发生，
 * 因此不必记按下坐标，也不必区分点击与拖动。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onUnmounted, ref } from 'vue'
import type { ResizeEdge } from '@shared/types'

export function useWindowResize() {
  /** 正在拖的是哪条边；null 表示没有在缩放 */
  const resizing = ref<ResizeEdge | null>(null)

  function onPointerDown(edge: ResizeEdge, event: PointerEvent): void {
    if (event.button !== 0) return
    resizing.value = edge
    try {
      // 捕获指针：窗口跟着手柄长，光标会短暂离开这个几像素宽的元素，
      // 不捕获的话 pointerup 收不到，缩放会一直挂到失焦为止。
      // 无头探针派发的合成事件背后没有真指针，这一步会抛 NotFoundError——
      // 它不该把缩放一起带走，因此单独兜住（useWindowDrag 里同样的处理）。
      ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    } catch {
      // 见上
    }
    event.preventDefault()
    window.zhituan.win.resizeStart(edge)
  }

  function end(): void {
    if (!resizing.value) return
    resizing.value = null
    window.zhituan.win.resizeEnd()
  }

  /**
   * 松开事件丢了也要把缩放收掉。
   *
   * 与拖动同一条兜底：主进程那边没有「窗口黏在光标上」那么严重，但一个挂住的
   * 缩放会让窗口一直跟着光标长。失焦是最可靠的信号——用户已经在别处按下了。
   */
  function onBlur(): void {
    end()
  }

  window.addEventListener('blur', onBlur)
  onUnmounted(() => window.removeEventListener('blur', onBlur))

  return {
    resizing,
    onPointerDown,
    onPointerUp: () => end(),
    onPointerCancel: () => end()
  }
}
