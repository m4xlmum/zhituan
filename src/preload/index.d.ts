/**
 * 渲染进程可见的 window.zhituan 类型声明。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { ZhituanApi } from '@shared/ipc'

declare global {
  interface Window {
    zhituan: ZhituanApi
  }
}

export {}
