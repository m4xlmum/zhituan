/**
 * 预加载脚本：把一组固定的、类型化的能力暴露给渲染进程。
 *
 * 渲染进程永远拿不到 ipcRenderer 本身，只能调用这里列出的方法。
 * 通道名由 @shared/ipc 统一提供，避免两侧写错字符串而静默失效。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { ipcRenderer } from 'electron'
import { BROADCAST, INVOKE, SEND } from '@shared/ipc'
import type {
  ConfigPatch,
  ZhituanApi,
  OpenPopoverRequest,
  TabsStatePayload
} from '@shared/ipc'
import type {
  AppConfig,
  Bookmark,
  HistoryEntry,
  HotkeyInfo,
  PresetSite,
  SiteRecord,
  UpdateState,
  WindowRuntime
} from '@shared/types'
import type { SizePreset } from '@shared/constants'

/** 订阅广播并返回取消订阅函数，避免渲染进程堆积监听器 */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

export const api: ZhituanApi = {
  config: {
    get: () => ipcRenderer.invoke(INVOKE.configGet) as Promise<AppConfig>,
    patch: (patch: ConfigPatch) => ipcRenderer.invoke(INVOKE.configPatch, patch) as Promise<AppConfig>,
    onChanged: (cb) => on<AppConfig>(BROADCAST.configChanged, cb)
  },

  ballIcon: {
    get: () => ipcRenderer.invoke(INVOKE.ballIconGet) as Promise<string | null>,
    set: (input) => ipcRenderer.invoke(INVOKE.ballIconSet, input) as Promise<string | null>,
    onChanged: (cb) => on<string | null>(BROADCAST.ballIconChanged, cb)
  },

  sites: {
    list: () => ipcRenderer.invoke(INVOKE.sitesList) as Promise<SiteRecord[]>,
    add: (input) => ipcRenderer.invoke(INVOKE.sitesAdd, input) as Promise<SiteRecord[]>,
    update: (input) => ipcRenderer.invoke(INVOKE.sitesUpdate, input) as Promise<SiteRecord[]>,
    remove: (input) => ipcRenderer.invoke(INVOKE.sitesRemove, input) as Promise<SiteRecord[]>,
    reorder: (input) => ipcRenderer.invoke(INVOKE.sitesReorder, input) as Promise<SiteRecord[]>,
    presets: () => ipcRenderer.invoke(INVOKE.presetsList) as Promise<PresetSite[]>
  },

  history: {
    list: (input) => ipcRenderer.invoke(INVOKE.historyList, input) as Promise<HistoryEntry[]>,
    clear: () => ipcRenderer.invoke(INVOKE.historyClear) as Promise<void>
  },

  bookmarks: {
    list: (input) => ipcRenderer.invoke(INVOKE.bookmarksList, input) as Promise<Bookmark[]>,
    remove: (input) => ipcRenderer.invoke(INVOKE.bookmarksRemove, input) as Promise<Bookmark[]>,
    update: (input) => ipcRenderer.invoke(INVOKE.bookmarksUpdate, input) as Promise<Bookmark[]>
  },

  tabs: {
    // 不给 url 就是「新建标签页」：打开配置里的 browser.newTabUrl（默认 google.com）
    create: (input) => ipcRenderer.invoke(INVOKE.tabsCreate, input) as Promise<{ tabId: string }>,
    close: (input) => ipcRenderer.invoke(INVOKE.tabsClose, input) as Promise<void>,
    activate: (input) => ipcRenderer.invoke(INVOKE.tabsActivate, input) as Promise<void>,
    reorder: (input) => ipcRenderer.invoke(INVOKE.tabsReorder, input) as Promise<void>,
    list: () => ipcRenderer.invoke(INVOKE.tabsList) as Promise<TabsStatePayload>,
    onState: (cb) => on<TabsStatePayload>(BROADCAST.tabsState, cb)
  },

  nav: {
    goto: (input) => ipcRenderer.invoke(INVOKE.navGoto, input) as Promise<void>,
    back: (input) => ipcRenderer.invoke(INVOKE.navBack, input) as Promise<void>,
    forward: (input) => ipcRenderer.invoke(INVOKE.navForward, input) as Promise<void>,
    reload: (input) => ipcRenderer.invoke(INVOKE.navReload, input) as Promise<void>,
    stop: (input) => ipcRenderer.invoke(INVOKE.navStop, input) as Promise<void>
  },

  page: {
    setZoom: (input) => ipcRenderer.invoke(INVOKE.pageSetZoom, input) as Promise<number>,
    setUa: (input) => ipcRenderer.invoke(INVOKE.pageSetUa, input) as Promise<string>
  },

  win: {
    setOpacity: (input) => ipcRenderer.invoke(INVOKE.winSetOpacity, input) as Promise<void>,
    collapse: () => ipcRenderer.invoke(INVOKE.winCollapse) as Promise<void>,
    expand: () => ipcRenderer.invoke(INVOKE.winExpand) as Promise<void>,
    maximize: () => ipcRenderer.invoke(INVOKE.winMaximize) as Promise<void>,
    restore: () => ipcRenderer.invoke(INVOKE.winRestore) as Promise<void>,
    // 拖动走单向消息：定位由主进程算，不需要回执，也不该有往返延迟
    dragStart: () => {
      ipcRenderer.send(SEND.dragStart)
    },
    dragEnd: () => {
      ipcRenderer.send(SEND.dragEnd)
    },
    // 缩放与拖动同一条路：界面只报「拖的是哪条边」，矩形与光标都由主进程读
    resizeStart: (edge) => {
      ipcRenderer.send(SEND.resizeStart, edge)
    },
    resizeEnd: () => {
      ipcRenderer.send(SEND.resizeEnd)
    },
    // 地址栏折叠同样走单向消息：它是版面切换，状态由主进程持有并回传
    setAddressOpen: (input) => {
      ipcRenderer.send(SEND.setAddressOpen, input)
    },
    // 顶栏 / 右侧栏的显隐与地址栏同类，走同一条路
    setChrome: (input) => {
      ipcRenderer.send(SEND.setChrome, input)
    },
    // 球的位置是渲染进程量出来的，报给主进程用于「缩到球身上」
    setBallRect: (rect) => {
      ipcRenderer.send(SEND.setBallRect, rect)
    },
    openBallMenu: () => ipcRenderer.invoke(INVOKE.winOpenBallMenu) as Promise<void>,
    setSize: (input: { preset: SizePreset } | { width: number; height: number }) =>
      ipcRenderer.invoke(INVOKE.winSetSize, input) as Promise<void>,
    minimize: () => ipcRenderer.invoke(INVOKE.winMinimize) as Promise<void>,
    hideToTray: () => ipcRenderer.invoke(INVOKE.winHideToTray) as Promise<void>,
    reassert: () => ipcRenderer.invoke(INVOKE.winReassert) as Promise<void>,
    close: () => ipcRenderer.invoke(INVOKE.winClose) as Promise<void>,
    getState: () => ipcRenderer.invoke(INVOKE.winGetState) as Promise<WindowRuntime>,
    onState: (cb) => on<WindowRuntime>(BROADCAST.windowState, cb)
  },

  ui: {
    openPopover: (req: OpenPopoverRequest) =>
      ipcRenderer.invoke(INVOKE.uiOpenPopover, req) as Promise<void>,
    closePopover: () => ipcRenderer.invoke(INVOKE.uiClosePopover) as Promise<void>,
    openHome: () => ipcRenderer.invoke(INVOKE.uiOpenHome) as Promise<void>,
    openSettings: () => ipcRenderer.invoke(INVOKE.uiOpenSettings) as Promise<void>,
    // 同一条键再点一次就是它——判据（此刻停在哪一屏）在界面这一侧
    leaveScreen: () => ipcRenderer.invoke(INVOKE.uiLeaveScreen) as Promise<void>
  },

  hotkey: {
    list: () =>
      ipcRenderer.invoke(INVOKE.hotkeyList) as Promise<{
        bossMinimize: HotkeyInfo
        bossHideToTray: HotkeyInfo
      }>,
    set: (input) =>
      ipcRenderer.invoke(INVOKE.hotkeySet, input) as Promise<{
        ok: boolean
        accelerator: string
        reason?: string
      }>
  },

  // 离线阅读：选中的本机文件由主进程开成普通的网页标签，回来的是文件名
  files: {
    openLocal: () => ipcRenderer.invoke(INVOKE.fileOpenLocal) as Promise<string[]>
  },

  // 本机 EPUB 的阅读位置。单向发出去就完事：主进程侧合并落盘，
  // 而「上次读到哪」是它开这一页时写进地址里的（见 @shared/ipc 的 ZhituanApi.book）
  book: {
    remember: (input) => {
      ipcRenderer.send(SEND.bookReading, input)
    }
  },

  update: {
    get: () => ipcRenderer.invoke(INVOKE.updateGet) as Promise<UpdateState>,
    check: () => ipcRenderer.invoke(INVOKE.updateCheck) as Promise<UpdateState>,
    install: () => ipcRenderer.invoke(INVOKE.updateInstall) as Promise<void>,
    ignore: (input) => ipcRenderer.invoke(INVOKE.updateIgnore, input) as Promise<UpdateState>,
    onState: (cb) => on<UpdateState>(BROADCAST.updateState, cb)
  },

  app: {
    quit: () => ipcRenderer.invoke(INVOKE.appQuit) as Promise<void>
  }
}
