/**
 * 系统托盘。它是窗口藏起来之后唯一的找回入口，因此必须始终可用。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import { log } from './logger'

/**
 * 两次单击之间的去重窗口。
 *
 * Windows 的双击会先送来两次 click（再跟一个 double-click），不去重的话
 * 一次双击就是「现形 → 收回」连着做一遍，用户看到窗口闪一下就没了。
 * 取 500ms 是因为那正是 Windows 自己判定双击的默认间隔（GetDoubleClickTime），
 * 比它更长的一次「连击」在系统眼里本来就是两次独立点击。
 */
const CLICK_DEDUPE_MS = 500

export interface TrayDeps {
  /**
   * 左键单击图标。
   *
   * 做成「切换」而不是单向的「现形」：托盘是窗口唯一稳定的找回入口，
   * 也应当是把它收回去的入口——否则用户从托盘点开之后，还得再去点窗口里的按钮。
   */
  onClickIcon: () => void
  /**
   * 双击里的第二次点击（已按去重丢弃，不切换显隐）。
   *
   * 用户双击时，第一次点击唤出窗口，第二次点击是落在**任务栏**上的：
   * 那一下会把任务栏变成前台窗口，刚唤到最前的窗口又退回后面去。
   * 所以这一次不要浪费，补一次「提到最前」。
   */
  onRepeatedClick: () => void
  /** 菜单里的「现形」：意图明确，不切换，直接把它提到最前 */
  onReveal: () => void
  onOpenSettings: () => void
  onQuit: () => void
}

export class TrayService {
  private tray: Tray | null = null
  private lastClickAt = 0

  constructor(private readonly deps: TrayDeps) {}

  create(iconPath: string): void {
    if (this.tray) return
    try {
      let image = nativeImage.createFromPath(iconPath)
      if (image.isEmpty()) {
        // 图标缺失时留一个占位，绝不能因为图标问题就没有托盘
        log.warn(`托盘图标加载失败：${iconPath}`)
        image = nativeImage.createEmpty()
      }
      this.tray = new Tray(image)
      this.tray.setToolTip('纸团')
      this.tray.setContextMenu(this.buildMenu())
      // 单击切换显隐。不再单独处理 double-click：双击本来就是两次 click，
      // 那两次里只有第一次作数，剩下的交给去重丢掉。
      this.tray.on('click', () => this.handleClick())
    } catch (err) {
      log.error('创建托盘失败', err)
    }
  }

  /**
   * 单击图标：第一次负责切换，紧随其后的重复点击负责「再提到最前一次」。
   *
   * 前缘处理（先动作、再挡住重复）而不是延时去重：窗口的响应不能被推迟半秒。
   * 双击的意图与单击相同，所以第二次不切换，但它也把任务栏点成了前台窗口，
   * 于是那一次正好用来把窗口重新提到前面，双击与单击的结果这才一致。
   */
  private handleClick(): void {
    const now = Date.now()
    const isRepeat = now - this.lastClickAt < CLICK_DEDUPE_MS
    this.lastClickAt = now
    if (isRepeat) {
      this.deps.onRepeatedClick()
      return
    }
    this.deps.onClickIcon()
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '现形', click: () => this.deps.onReveal() },
      { label: '系统设置', click: () => this.deps.onOpenSettings() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          this.deps.onQuit()
        }
      }
    ])
  }

  /**
   * explorer.exe 重启后托盘图标会消失，且 Electron 没有提供「任务栏重建」的通知。
   * 因此只能在每次需要用到托盘的时刻（显示窗口、藏起来）重建一次——
   * 重建成本很低，而托盘丢失意味着用户可能再也找不回窗口。
   */
  rebuild(iconPath: string): void {
    this.destroy()
    this.create(iconPath)
  }

  destroy(): void {
    try {
      this.tray?.destroy()
    } catch {
      // 忽略
    }
    this.tray = null
  }
}

/** 托盘在部分环境下需要一点时间才能挂上，启动时调用可避免首帧缺失 */
export function isTraySupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
}

export function quitApp(): void {
  app.quit()
}
