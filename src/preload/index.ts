/**
 * 预加载入口。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { contextBridge } from 'electron'
import { api } from './api'

/**
 * 只有本应用自己的页面才能拿到这套 API。
 *
 * 首页是一个「自家标签页」，它带着 preload 运行；如果用户把它导航到
 * 第三方站点，preload 会在新文档上重新执行——若不加判断，那个站点
 * 就能直接调用 window.zhituan 读写站点、历史与书签。
 * 因此这里按协议与来源做白名单判断，只认本地文件与本机 devServer。
 *
 * 本机 PDF 的阅读页（pdf.html）也在这一份名单里：它也是自家的页，也要读配置
 * （主题决定墨色、背景透明度决定它那一条浮层）。它画的是 canvas，不把 PDF 的
 * 内容塞进 DOM——那本书里的任何东西都到不了这一层。
 *
 * 本机 EPUB 的阅读页（book.html）同理，而且**它比 pdf.html 更依赖这座桥**：
 * 纸的透明度、排版三项（字号 / 行距 / 左右留白）全部来自配置，而「读到哪了」
 * 还要经 `zhituan.book` 报回主进程。少写它一个的后果不是报错，是**静默地什么都
 * 不生效**——滑块拖不动、位置记不住，看着像功能没做出来。2026-09-27 由
 * spike/book-tab.js 的 T4 抓到（见 docs/spike-findings.md 的 Q69）。
 */
const OWN_PAGES = [
  '/index.html',
  '/home.html',
  '/popover.html',
  '/settings.html',
  '/pdf.html',
  '/book.html'
]

function isOwnPage(): boolean {
  const { protocol, hostname, pathname } = window.location

  if (protocol === 'file:') {
    return OWN_PAGES.some((p) => pathname.endsWith(p))
  }

  // 开发期由 electron-vite 的 devServer 提供页面；远端站点不可能是 localhost
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  return (protocol === 'http:' || protocol === 'https:') && isLocal && pathname.endsWith('.html')
}

if (isOwnPage()) {
  // contextIsolation 开启，渲染进程只能看到这一个对象
  contextBridge.exposeInMainWorld('zhituan', api)
}
