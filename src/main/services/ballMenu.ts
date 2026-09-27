/**
 * 悬浮球的右键菜单。
 *
 * 用原生菜单而不是 chrome 视图里的 DOM 菜单：chrome 层位于标签页视图
 * **之下**，任何画出顶栏范围的 DOM 都会被网页盖住，既看不到也点不到。
 * 原生菜单是独立的系统窗口，天然浮在最上层，这也是它唯一的可行解。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron'
import type { ChromePatch } from '@shared/ipc'
import type { WindowRuntime } from '@shared/types'

export interface BallMenuDeps {
  getWindow: () => BaseWindow | null
  getRuntime: () => WindowRuntime
  setChrome: (patch: ChromePatch) => void
  /** 从最大化回到之前的 16:9 矩形（只在最大化时才出现在菜单里） */
  restoreWindow: () => void
  hideToTray: () => void
  openSettings: () => void
  quit: () => void
}

export function popupBallMenu(deps: BallMenuDeps): void {
  const runtime = deps.getRuntime()
  const topBarOpen = runtime.topBarOpen

  /*
   * 最大化时菜单换一套：顶栏与右栏本来就让位给了网页，那时再说「隐藏顶部栏」
   * 是句空话（改了也看不见，要等还原）。因此那两条收起来，换成一条
   * 「还原窗口」——它也是这一态下不依赖「界面层抬到网页之上」是否成功的
   * 兜底出口（菜单是系统原生窗口，天然在最上层）。
   */
  const chromeItems: MenuItemConstructorOptions[] = runtime.maximized
    ? [{ label: '还原窗口', click: () => deps.restoreWindow() }, { type: 'separator' }]
    : [
        {
          label: topBarOpen ? '隐藏顶部栏' : '显示顶部栏',
          click: () => deps.setChrome({ topBar: !topBarOpen })
        },
        {
          label: runtime.railVisible ? '收起右侧栏' : '展开右侧栏',
          // 顶栏藏起来时右栏是球的落脚处，不能收——收掉球就没地方待了
          enabled: topBarOpen,
          click: () => deps.setChrome({ rail: !runtime.railVisible })
        },
        { type: 'separator' }
      ]

  const menu = Menu.buildFromTemplate([
    ...chromeItems,
    { label: '藏进托盘', click: () => deps.hideToTray() },
    { label: '系统设置', click: () => deps.openSettings() },
    { type: 'separator' },
    { label: '退出纸团', click: () => deps.quit() }
  ])

  const win = deps.getWindow()
  // 不给 window 也能弹，但传进去菜单才会随窗口一起消失、并正确获得焦点
  if (win) menu.popup({ window: win })
  else menu.popup()
}
