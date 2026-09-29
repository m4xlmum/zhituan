/**
 * 渲染进程页面地址。开发期指向 devServer，打包后指向 out/renderer 下的 HTML。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type RendererPage = 'index' | 'home' | 'popover' | 'settings' | 'pdf' | 'book' | 'txt'

export function rendererUrl(page: RendererPage): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    return `${devUrl}/${page}.html`
  }
  // __dirname 在打包后为 out/main，渲染产物在 out/renderer
  return pathToFileURL(join(__dirname, `../renderer/${page}.html`)).toString()
}
