/**
 * 数据类 IPC：配置、我的站点、历史、书签。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { ipcMain } from 'electron'
import { BROADCAST, INVOKE } from '@shared/ipc'
import type { ConfigPatch } from '@shared/ipc'
import { CUSTOM_BALL_ICON, DEFAULT_BALL_ICON } from '@shared/constants'
import type { AppContext } from '../context'

export function registerDataIpc(ctx: AppContext): void {
  // ---------------------------------------------------------------- 配置
  ipcMain.handle(INVOKE.configGet, () => ctx.config.get())

  ipcMain.handle(INVOKE.configPatch, (_e, patch: ConfigPatch) => {
    const before = ctx.config.get()
    const after = ctx.config.patch(patch)

    // 影响窗口表现的配置变更需要立即生效
    if (after.stealth.contentProtection !== before.stealth.contentProtection) {
      ctx.controller.setContentProtection(after.stealth.contentProtection)
    }
    // 界面分区显隐牵动原生正文视图的版面，正常走 win.setChrome；
    // 这里兜住从设置界面直接改配置的那条路
    if (
      after.ui.topBarOpen !== before.ui.topBarOpen ||
      after.ui.railOpen !== before.ui.railOpen
    ) {
      ctx.controller.setChrome({ topBar: after.ui.topBarOpen, rail: after.ui.railOpen })
    }
    if (after.window.alwaysOnTop !== before.window.alwaysOnTop) {
      ctx.controller.reassert()
    }
    // 关掉自动收起时，若正停着一颗球就把界面展开，
    // 否则用户会以为设置没生效——球还在那里
    if (!after.stealth.autoCollapse && ctx.controller.getMode() === 'collapsed') {
      ctx.controller.expand()
    }

    /*
     * 广播不在这里做：配置的广播挂在 ConfigStore 的订阅上（见 index.ts），
     * 谁写的都走同一条路。这里只负责「改配置会牵动窗口」的那几个副作用——
     * 它们之所以需要单独写，正是因为走到这里的这次改动是**界面**发起的，
     * 而控制器自己改配置时（显隐两栏、调透明度）顺手就把这些做完了。
     */
    return after
  })

  // ---------------------------------------------------------------- 悬浮球图标
  ipcMain.handle(INVOKE.ballIconGet, () => ctx.ballIcon.get())

  ipcMain.handle(INVOKE.ballIconSet, (_e, input: { dataUrl: string | null }) => {
    const stored = ctx.ballIcon.set(input?.dataUrl ?? null)
    /*
     * 清除之后不能把 ballIcon 留在 'custom' 上——那样球会去取一张已经不存在的图，
     * 画出来是一个空壳。退回内置的默认图标，用户至少还看得见球。
     * 反过来（存进来一张新图）不动配置：选哪个图标是用户的选择，
     * 设置界面里点「自定义」那一下才改它。
     */
    if (stored === null && ctx.config.get().ui.ballIcon === CUSTOM_BALL_ICON) {
      ctx.config.patch({ ui: { ballIcon: DEFAULT_BALL_ICON } })
    }
    ctx.broadcast(BROADCAST.ballIconChanged, stored)
    return stored
  })

  // ---------------------------------------------------------------- 我的站点
  ipcMain.handle(INVOKE.sitesList, () => ctx.sites.list())
  ipcMain.handle(INVOKE.sitesAdd, (_e, input: { title?: string; url: string }) => ctx.sites.add(input))
  ipcMain.handle(INVOKE.sitesUpdate, (_e, input: { id: string; patch: Record<string, unknown> }) =>
    ctx.sites.update(input.id, input.patch)
  )
  ipcMain.handle(INVOKE.sitesRemove, (_e, input: { id: string }) => ctx.sites.remove(input.id))
  ipcMain.handle(INVOKE.sitesReorder, (_e, input: { ids: string[] }) => ctx.sites.reorder(input.ids))

  /*
   * 起始页上被移除的站点域名（见 @shared/types 的 HiddenSite）。
   *
   * 与 sites 那几条摆在一起，因为它们说的是同一件事的两半：起始页上「删除这一行」
   * 落在哪一半上，取决于这一行是从哪儿来的——我的站点删记录，常访问与热门站点
   * 只能记域名。两半都在这一处，读的人一眼看得出「删除」不是一条路。
   */
  ipcMain.handle(INVOKE.hiddenList, () => ctx.hidden.list())
  ipcMain.handle(INVOKE.hiddenAdd, (_e, input: { domains: string[] }) =>
    ctx.hidden.hide(input?.domains ?? [])
  )
  ipcMain.handle(INVOKE.hiddenRemove, (_e, input: { domains: string[] }) =>
    ctx.hidden.unhide(input?.domains ?? [])
  )

  // ---------------------------------------------------------------- 历史
  ipcMain.handle(INVOKE.historyList, (_e, input?: { query?: string; limit?: number; offset?: number }) =>
    ctx.history.query(input ?? {})
  )
  ipcMain.handle(INVOKE.historyClear, () => {
    ctx.history.clear()
  })

  // ---------------------------------------------------------------- 书签
  ipcMain.handle(INVOKE.bookmarksList, (_e, input?: { query?: string }) => ctx.bookmarks.query(input ?? {}))
  ipcMain.handle(INVOKE.bookmarksRemove, (_e, input: { id: string }) => ctx.bookmarks.remove(input.id))
  ipcMain.handle(INVOKE.bookmarksUpdate, (_e, input: { id: string; patch: Record<string, unknown> }) =>
    ctx.bookmarks.update(input.id, input.patch)
  )
}
