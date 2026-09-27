/**
 * 本机 EPUB 阅读页入口。
 *
 * 这一页也是一张「自家标签页」：它带 preload（要读配置里的阅读透明度与主题），
 * 但与 PDF 那一页有个要紧的区别——**书的内容会进 DOM**。PDF 那边只有一张 canvas，
 * 书里的任何东西都到不了界面层；这里要把章节真的插进来，因此书自己的 CSS 也就
 * 真的会生效。
 *
 * 隔离靠 Shadow DOM（书用 `body { }` 排自己的版，我们不该被它带着走），挡脚本靠
 * book.html 的 CSP 加这一页的清洗那两道闸。整件事的实测依据在 spike/book-page.js。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { createApp } from 'vue'
import BookApp from './book/BookApp.vue'

createApp(BookApp).mount('#app')
