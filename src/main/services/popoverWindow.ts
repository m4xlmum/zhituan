/**
 * 弹出面板窗口：站点列表、历史、书签、UA/缩放这些小面板。
 *
 * 刻意做成独立的子窗口，而不是 chrome 视图里的一块 DOM：
 * chrome 视图要覆盖整个窗口并保持中部透明，把面板塞进去会让
 * 命中区域与透明区域的计算复杂化。独立窗口更简单也更可靠。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { BrowserWindow, screen } from 'electron'
import type { OpenPopoverRequest } from '@shared/ipc'
import type { Rect } from '@shared/types'
import type { WindowRegistry } from './windowRegistry'
import { rendererUrl } from './rendererUrl'
import { log } from './logger'

const POPOVER_W = 320
const POPOVER_H = 420
/**
 * 标签页面板的高度。
 *
 * 它的锚点在顶栏，比其它面板更靠上，矮一点才不会在窗口贴着屏幕上沿时
 * 被挤到屏幕外；一屏能列下的标签页数量也够用了，多出来的自己滚。
 */
const TABS_H = 360
/**
 * 排版面板（离线阅读的字号 / 行距 / 左右留白 / 段距）的高度。
 *
 * 与标签页面板同理：锚点也在顶栏，而它里面只有四行滑块加一句话，用不着
 * 420 那么高——高出来的那截只是在窗口底下留一片空白。
 *
 * 四行滑块是 128px（一行 32px，见 PopoverApp 的 .trow），加小标题与那一句话，
 * 260 那一版（三行）量出来正文区还剩 225px 里的一截空白，加一行还够；
 * 取 300 是给那一句话留出折成三行的余地——它是随窗口宽度折行的，不是定高。
 * 探针里那条「面板容纳」量的正是这个：把窗口调到这个高度，看底下有没有被裁掉
 * （spike/txt-typeset.js 的 `面板容纳.裁掉了`，判据是 0）。
 */
const TYPESET_H = 300
const GAP = 6

/** 面板尺寸按类型给。标签页列表与排版面板都不需要那么高 */
function sizeOf(kind: OpenPopoverRequest['kind']): { width: number; height: number } {
  const height = kind === 'tabs' ? TABS_H : kind === 'typeset' ? TYPESET_H : POPOVER_H
  return { width: POPOVER_W, height }
}

/**
 * 往锚点**下方**摆的类型。
 *
 * 默认往上摆是因为锚点大多在窗口底部（右栏）；标签页与排版面板的锚点在顶栏上，
 * 再往上摆就飘到窗口外面去了。
 */
const PREFER_BELOW: ReadonlySet<OpenPopoverRequest['kind']> = new Set(['tabs', 'typeset'])

/**
 * 「同一次点击的第二半」的时限，见 justClosed。
 *
 * 两半之间只隔着一次 IPC 往返（主窗口被激活 → 面板 blur → 那颗键的 click
 * 走到主进程），几十毫秒；而人真要连点同一颗键两下，间隔不会短于 300ms。
 */
const REOPEN_MS = 300

export class PopoverWindowService {
  private win: BrowserWindow | null = null
  private currentKind: OpenPopoverRequest['kind'] | null = null

  /**
   * 刚刚因为失焦而收起的那个面板，以及收起的时刻。
   *
   * 它专治「同一次点击的第二半」：面板开着的时候焦点在面板身上（见 open() 里
   * show() 那一段），用户点面板**外面**那一下会先把焦点从面板上拿走——
   * 面板失焦收起，而那一下若正落在锚点那颗键上，那颗键照旧会发出一条 open 请求。
   * 不认出来的话，面板会「关掉又立刻开回来」，那颗键读起来像是点了没反应，
   * 「同一颗键再点一次 = 收起」这条手感就没了。kind 也对得上才算同一次：
   * 点了另一颗键是「换一个面板看」，得放行。
   */
  private justClosed: { kind: OpenPopoverRequest['kind']; at: number } | null = null

  constructor(
    private readonly registry: WindowRegistry,
    private readonly preloadPath: string,
    private readonly getParentBounds: () => Rect | null,
    /**
     * 把焦点还给主窗口。
     *
     * 面板是独立的一扇窗，它在场时焦点在它身上（见 open() 里 show() 那一段）。
     * 用户自己在面板里选完东西、面板收起之后，焦点得还回去——否则接着敲键盘
     * 是敲在一扇已经没了的窗口上，整片落空。
     */
    private readonly focusParent: () => void
  ) {}

  getKind(): OpenPopoverRequest['kind'] | null {
    return this.currentKind
  }

  open(req: OpenPopoverRequest): void {
    const parentBounds = this.getParentBounds()
    if (!parentBounds) return

    // 同一次点击的第二半，见 justClosed 那一段
    if (
      this.justClosed &&
      this.justClosed.kind === req.kind &&
      Date.now() - this.justClosed.at <= REOPEN_MS
    ) {
      this.justClosed = null
      return
    }

    // 同一个面板再次点击视为收起
    if (this.currentKind === req.kind && this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.close()
      return
    }

    this.close()

    const size = sizeOf(req.kind)
    const { x, y } = this.place(parentBounds, req.anchorRect, size, PREFER_BELOW.has(req.kind))

    const win = new BrowserWindow({
      x,
      y,
      width: size.width,
      height: size.height,
      // 不用 parent 选项：摸鱼窗口是 BaseWindow，而非 BrowserWindow。
      // 置顶与显式关闭已足够保证层级与生命周期。
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win
    this.currentKind = req.kind
    // 与 WindowController 同理：'closed' 触发时窗口已销毁，那时读 win.id 会抛
    // 「Object has been destroyed」。这里每次点开面板、点别处关掉都会走一遍，
    // 异常会冒到主进程的未捕获异常处理器上弹框，因此 id 提前记下。
    const winId = win.id

    // 面板打开期间必须挂起自动收起，否则用户一移开光标界面就缩成球，
    // 面板会孤零零飘在桌面上。
    this.registry.add(win, { blocksAutoHide: true })

    win.on('blur', () => {
      // 认明是**这一扇**：窗口关掉时也会发一次 blur（它本来就有焦点），
      // 若那时已经点开了另一个面板，this.win 是新的那扇——不认人就会把它关掉。
      if (this.win !== win) return
      // 焦点被拿走 = 用户点到了面板外面（网页、右栏、别的应用），面板就该收起。
      // 记下是哪一种面板、什么时候，理由见 justClosed 那一段。
      const kind = req.kind
      this.close()
      this.justClosed = { kind, at: Date.now() }
    })
    win.on('closed', () => {
      this.registry.remove(winId)
      // 两条都要认明是**这一扇**：'closed' 是异步到的，上一边那块面板关掉时
      // 新面板已经接手了，不加这一句会把新面板的 kind 抹成 null——
      // 「同一颗键再点一次 = 收起」那一条判据正是读它，抹掉之后那颗键就只剩开。
      if (this.win === win) {
        this.win = null
        this.currentKind = null
      }
    })

    /*
     * show()，不是 showInactive()：面板要**拿到焦点**，上面那条 blur 才有着落。
     *
     * 先前用的是 showInactive——焦点一直留在主窗口里，于是「用户点了别处」
     * 这件事面板根本收不到：blur 永不触发，面板就一直飘在那儿（用户报的就是这个）。
     * 菜单、下拉框本来就该拿走焦点：拿到之后，点任何别处都是一次失焦，
     * 面板自己收起；顺带键盘也有了去处（面板里的搜索框、Esc 收起）。
     */
    win.once('ready-to-show', () => win.show())

    const url = `${rendererUrl('popover')}?kind=${encodeURIComponent(req.kind)}`
    win.loadURL(url).catch((err) => log.error('加载弹出面板失败', err))
  }

  /**
   * 收起面板，**不碰焦点**。
   *
   * 走这条路的都是「焦点不该动」的场合：面板失焦自己收起（焦点已经在用户点的
   * 那一处了）、换一个面板（新面板马上接手）、窗口收起成球或进了托盘
   * （整扇窗口都不在了）。用户自己在面板里选完东西的那条路走 dismiss()。
   */
  close(): void {
    // 上一条「刚因为失焦关掉」的记录只对紧接着的那一次点击有意义，
    // 关掉即作废，免得隔了很久再点同一颗键被它吃掉
    this.justClosed = null
    const win = this.win
    this.win = null
    this.currentKind = null
    if (win && !win.isDestroyed()) {
      this.registry.remove(win.id)
      win.close()
    }
  }

  /**
   * 用户自己在面板里选完东西（切标签、点书签、点历史）之后收起面板。
   *
   * 与 close() 只差收尾这一下：面板在场时焦点在面板身上（见 open() 里 show()
   * 那一段），面板一走，焦点得还回主窗口——用户接下来的键盘是敲给网页的。
   * 失焦自己收起的那条路**绝不能**这么做：那时焦点多半正落在别的应用里，
   * 抢回来就成了「点一下别处，摸鱼窗口自己跳到最前」。
   */
  dismiss(): void {
    this.close()
    this.focusParent()
  }

  /** 依据锚点与屏幕可用区域决定面板摆在哪一侧 */
  private place(
    parentBounds: Rect,
    anchor: Rect,
    size: { width: number; height: number },
    preferBelow: boolean
  ): { x: number; y: number } {
    const anchorScreenX = parentBounds.x + anchor.x
    const anchorScreenY = parentBounds.y + anchor.y

    const display = screen.getDisplayNearestPoint({ x: anchorScreenX, y: anchorScreenY })
    const area = display.workArea

    let x = anchorScreenX
    if (x + size.width > area.x + area.width) x = area.x + area.width - size.width
    if (x < area.x) x = area.x

    const below = anchorScreenY + anchor.height + GAP
    const above = anchorScreenY - size.height - GAP

    // 锚点在底部的（右栏）优先往上摆，锚点在顶部的（顶栏）优先往下摆，
    // 两边都放不下时再退到另一侧，最后夹进工作区
    let y = preferBelow ? below : above
    if (y < area.y || y + size.height > area.y + area.height) {
      const fallback = preferBelow ? above : below
      y = Math.min(Math.max(fallback, area.y), area.y + area.height - size.height)
    }
    if (y < area.y) y = area.y

    return { x: Math.round(x), y: Math.round(y) }
  }
}
