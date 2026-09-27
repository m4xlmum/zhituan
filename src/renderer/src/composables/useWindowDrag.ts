/**
 * 拖窗口。界面上每一块能拖的地方都用它：顶栏、地址栏、右侧栏、悬浮球。
 *
 * 早先靠 CSS 的 `-webkit-app-region: drag`：整条栏声明可拖，其中的控件再声明
 * no-drag 挖回来。那套写法有个不容易看出来的性质——**一个栏如果被 no-drag 的
 * 子元素铺满，就等于整个都拖不动**：顶栏中间那一整块是标签条（`flex: 1 1 auto`），
 * 右栏里是一个撑满的功能栈，于是两条栏上真正能按到的「空白像素」只剩下几像素的
 * 内边距，用户的结论就是「只能拖悬浮球」。而且可拖区域随版面变化，"哪儿能拖"
 * 还需要靠脑补 CSS 盒模型才知道。
 *
 * 改成一套显式处理之后，判据成为一条读得懂的规则：**按在控件上是操作，
 * 按在别处都是拖窗口**。「控件」由下面这个选择器定义，各处不必再关心
 * 自己的像素有没有被谁盖住。
 *
 * 实际的移动由主进程做（渲染进程一旦收不到指针事件就没法继续跟），
 * 这里只负责「开始」与「结束」两个信号，见 WindowController.beginDrag。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onUnmounted, ref } from 'vue'

/** 按在这些元素上是「操作」，不是「拖窗口」。豁免处自己标 data-drag-ignore */
const INTERACTIVE = 'button, input, textarea, select, a, [data-drag-ignore]'

/** 位移小于这个像素数就当作点击，而不是拖动 */
export const CLICK_SLOP = 5

export function useWindowDrag(onTap?: () => void) {
  const dragging = ref(false)

  /**
   * 按下时的屏幕坐标。
   *
   * 必须是屏幕坐标而不是页面坐标：拖动时窗口跟着光标走，光标在页面里几乎不动，
   * 用页面坐标算位移会恒为零，点击与拖动就分不开了。
   */
  let pressAt: { x: number; y: number } | null = null

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return

    const surface = event.currentTarget as Element | null
    const hit = event.target as Element | null
    const control = typeof hit?.closest === 'function' ? hit.closest(INTERACTIVE) : null
    // 起点**自己**就是控件时不算数：悬浮球本身就是一个 button，
    // 它既要能点（收起 / 展开）又要能拖。
    if (control && control !== surface) return

    pressAt = { x: event.screenX, y: event.screenY }
    dragging.value = true
    try {
      // 捕获指针：窗口移动过程中指针短暂离开球面也能继续收到 pointerup。
      // 无头探针里派发的合成事件背后没有真指针，这一步会抛 NotFoundError——
      // 它只是保险，拖窗口时窗口跟着光标走，指针本来就没离开过。
      surface?.setPointerCapture?.(event.pointerId)
    } catch {
      // 见上
    }
    window.zhituan.win.dragStart()
  }

  function end(event: PointerEvent | null): void {
    if (!dragging.value) return
    dragging.value = false
    const start = pressAt
    pressAt = null
    window.zhituan.win.dragEnd()
    if (!event || !start) return

    const moved = Math.hypot(event.screenX - start.x, event.screenY - start.y)
    if (moved < CLICK_SLOP) onTap?.()
  }

  /**
   * 松开事件丢了也要把拖动收掉。
   *
   * 事件为什么会丢：指针在按住时被别的窗口截走、界面正忙没来得及处理。
   * 而拖动一旦挂住，窗口就黏在光标上再也放不下来——那是比「拖不动」严重得多的
   * 故障。失焦是这种时候最可靠的信号：用户已经在别处按下了。
   * 主进程那边还有一道同样意思的网（win.on('blur')），两条路各自兜各自的场合。
   */
  function onBlur(): void {
    end(null)
  }

  window.addEventListener('blur', onBlur)
  onUnmounted(() => window.removeEventListener('blur', onBlur))

  return {
    dragging,
    onPointerDown,
    onPointerUp: (event: PointerEvent) => end(event),
    onPointerCancel: () => end(null)
  }
}
