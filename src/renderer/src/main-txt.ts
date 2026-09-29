/**
 * 本机 TXT 阅读页入口。
 *
 * 这一页也是一张「自家标签页」：它带 preload（要读配置里的阅读透明度与主题，还要把
 * 「读到哪儿了」报回主进程），但与 PDF / EPUB 那两页都不同——**它的正文是一份纯文本**，
 * 既没有书给的样式表，也没有画进 canvas 的字。
 *
 * 于是这一页要自己做完两件事，两件都在 @shared/txt.ts 里：
 *
 *   1. **认编码**（`fetch` 回那份字节，`decodeText` 认 BOM / UTF-16 / UTF-8 / GBK）；主进程
 *      只送字节、不认编码，理由在那一份文件头里。
 *   2. **切章**（`splitChapters`）——这正是这一页存在的理由：Chromium 那个文本查看器
 *      里整篇文档是一个大 `pre`，没有「章」可记，读到哪里只能记整篇的百分之几。
 *
 * 样式的分工见 styles/txt.css：外壳在 book.css（与 EPUB 那一页共用），正文在这一页。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { createApp } from 'vue'
import TxtApp from './txt/TxtApp.vue'

createApp(TxtApp).mount('#app')
