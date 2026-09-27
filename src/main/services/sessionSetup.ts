/**
 * 会话（Cookie / 登录态）与安全策略。
 *
 * 用单一的持久化分区，而不是每个站点一个分区：
 * 内置站点里大量站点的登录横跨多个可注册域名（例如 weread.qq.com 与 qq.com），
 * 按站点分区会让登录态互相不可见，用户会遇到「明明登录过却又要登录」。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { app, session, type Session } from 'electron'
import { log } from './logger'

/** 前缀 persist: 不可省略——少了它分区只存在于内存，退出即丢失登录态 */
export const PARTITION = 'persist:zhituan'

/** 默认拒绝的权限，本应用没有理由需要它们 */
const DENIED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'midi',
  'midiSysex',
  'hid',
  'serial',
  'usb',
  'notifications',
  'idle-detection'
])

export function setupSession(): Session {
  const ses = session.fromPartition(PARTITION)

  // 权限一律拒绝，除非是剪贴板读取这类网页正常功能所必需的。
  // 阅读器不需要摄像头、麦克风、定位。
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = !DENIED_PERMISSIONS.has(permission) && permission === 'clipboard-read'
    if (!granted && DENIED_PERMISSIONS.has(permission)) {
      log.info(`已拒绝网页权限请求：${permission}`)
    }
    callback(granted)
  })

  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-read')

  // 下载交由 Chromium 默认行为处理，这里只记录
  ses.on('will-download', (_event, item) => {
    log.info(`开始下载：${item.getFilename()}`)
  })

  return ses
}

/**
 * 对所有 webContents 施加统一的加固策略。
 * 访客页面会加载任意第三方网站，因此必须假定它们不可信。
 */
export function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    // 不允许任何页面开新窗口，统一由 TabManager 转成标签页
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // 禁止导航到非 http(s) 等协议，避免被诱导唤起本地程序
    contents.on('will-navigate', (event, url) => {
      if (!/^(https?|about|data|blob|file):/i.test(url)) {
        log.warn(`已拦截导航：${url}`)
        event.preventDefault()
      }
    })

    // 禁止加载 webview
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
