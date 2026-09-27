/**
 * 应用级依赖的聚合。所有服务在此汇合，供 IPC 层引用。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { OpenPopoverRequest } from '@shared/ipc'
import type { BallIconStore } from './services/ballIconStore'
import type { BookmarkStore } from './services/bookmarkStore'
import type { BossKeyService } from './services/bossKeyService'
import type { ConfigStore } from './services/configStore'
import type { HistoryStore } from './services/historyStore'
import type { ReadingStore } from './services/readingStore'
import type { SiteStore } from './services/siteStore'
import type { TabManager } from './services/tabManager'
import type { TrayService } from './services/trayService'
import type { UpdateService } from './services/updateService'
import type { WindowController } from './services/windowController'
import type { WindowRegistry } from './services/windowRegistry'

export interface AppContext {
  userDataDir: string
  config: ConfigStore
  registry: WindowRegistry
  sites: SiteStore
  history: HistoryStore
  bookmarks: BookmarkStore
  /** 本机 EPUB 读到哪儿了。按书的本机路径记，见 readingStore.ts */
  reading: ReadingStore
  /** 用户上传的悬浮球图标。单独一个文件、单独一组通道，见 ballIconStore.ts */
  ballIcon: BallIconStore
  controller: WindowController
  tabs: TabManager
  bossKeys: BossKeyService
  tray: TrayService
  /** 检查更新。查什么、下到哪儿、装不装，都归它；界面只是它的投影 */
  update: UpdateService
  /** 向所有界面窗口广播 */
  broadcast: (channel: string, payload: unknown) => void
  /**
   * 进入自家那一屏。两者都是窗口内的视图，**不是标签页**：
   * 起始页与设置各是顶栏最左那两颗键（起始页在前，设置紧挨着它）。
   * 窗口若正缩成球或藏在托盘里，这两条都会先叫回来。
   */
  openHome: () => void
  openSettings: () => void
  /** 从上面那两屏原路返回进来之前那张网页（没有可回的就落回起始页） */
  leaveScreen: () => void
  openPopover: (req: OpenPopoverRequest) => void
  closePopover: () => void
  quit: () => void
}
