/**
 * 注入到访客页面的样式。
 *
 * 注意：**窗口的**无极透明度不走这里——spike 证明 setOpacity 与透明窗口可以
 * 正常混合，因此不需要向网页注入 opacity。这里处理四件事：
 *
 *   1. 让网页本身透明（否则透明窗口里会残留一块不透明的网页底色）；
 *   2. 藏起滚动条；
 *   3. 离线阅读的透明度（applyReaderOpacity）——这一条**只给本机文件**
 *      用，网页永远不许吃到它；
 *   4. 离线阅读的排版**三项**：字号 / 行距 / 左右留白（applyReaderTypeset），
 *      同样只给本机文件里**由 Chromium 自己排**的那些（`.md`、`.log` 这一类；
 *      本机 TXT 从 1.6.9 起有自己的阅读页，本机 EPUB 一直有，那几项由它们自己
 *      读配置——见 book/BookApp.vue 与 txt/TxtApp.vue 的 applyTypeset）。
 *
 * 四项里的**段距不在这里**（1.6.10 加的那一项）。这一页的正文是 Chromium 排出来的
 * 一个整块 `<pre>`，一个标签都不是我们给的，也就没有「段与段之间」这个对象：要落
 * 段距就得先把那几百万字拆成元素，而那正是 1.6.9 把本机 TXT 从这一条路上搬走的原因
 * （见 TxtApp 文件头第 1 条）。因此顶栏那份面板在这一类页面上把段距那一行**禁掉**
 * 并写明原因（见 popover/PopoverApp.vue 的 paraOff），而不是给一个拖了没反应的滑块。
 *
 * 第 1、2 条不分对象，第 3、4 条分——它们不进 injectPageStyles 那一张样式的
 * 主要原因还不是「分对象」，而是**它们都要随配置当场改**（用户正拖着那几条
 * 滑块），于是必须撤得回来、也必须改得动。两处都走 CSSOM 上的行内声明
 * （理由见 applyReaderOpacity 那一段）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { WebContents } from 'electron'
import {
  READER_FONT_MAX,
  READER_FONT_MIN,
  READER_LINE_MAX,
  READER_LINE_MIN,
  READER_MARGIN_MAX,
  READER_MARGIN_MIN
} from '@shared/constants'
import { log } from './logger'

/** 让页面背景透明，否则透明窗口里会残留一块不透明的网页底色 */
const TRANSPARENT_BACKGROUND = `
html, body { background: transparent !important; }
`

/** 藏起滚动条。长滚动条是「正在摸鱼」最明显的视觉证据 */
const HIDE_SCROLLBARS = `
::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
html { scrollbar-width: none !important; -ms-overflow-style: none !important; }
`

/**
 * 按 webContents 登记已注入样式的 key。
 *
 * 页面每次导航都会重建文档，之前注入的样式随文档一起消失，
 * 因此必须在每次 dom-ready 后重新注入——只注入一次是最常见的错误。
 */
const injectedKeys = new WeakMap<WebContents, string[]>()

function buildCss(opts: { hideScrollbars: boolean }): string {
  return TRANSPARENT_BACKGROUND + (opts.hideScrollbars ? HIDE_SCROLLBARS : '')
}

/** 在页面文档就绪后调用 */
export async function injectPageStyles(
  wc: WebContents,
  opts: { hideScrollbars: boolean }
): Promise<void> {
  try {
    await removePageStyles(wc)
    const key = await wc.insertCSS(buildCss(opts), { cssOrigin: 'user' })
    injectedKeys.set(wc, [key])
  } catch (err) {
    // 页面可能已在导航中被销毁，属于正常竞态
    log.warn('注入页面样式失败', err)
  }
}

/** 移除已注入的样式，避免切换「隐藏滚动条」后残留旧规则 */
export async function removePageStyles(wc: WebContents): Promise<void> {
  const keys = injectedKeys.get(wc)
  if (!keys) return
  for (const key of keys) {
    try {
      await wc.removeInsertedCSS(key)
    } catch {
      // 文档已销毁，无需处理
    }
  }
  injectedKeys.delete(wc)
}

/**
 * 离线阅读的透明度。**调用方必须先判定这一页是本机文件**
 * （TabManager 用 @shared/url 的 isLocalFile）——网页永远不许吃到它。
 *
 * 这一页（本机 TXT / 网页文件）的底由 Chromium 自己画，我们碰不到它，能碰的
 * 只有最外面这一层，因此整页 `opacity` 就是「字淡下去、桌面从笔画里透过来」。
 * 同一条滑块在 **PDF 那一页**落的是另一处：那一页的纸是我们自己画进画布的，
 * 于是它把纸**补回来**（画布的底色，alpha 由同一条滑块给），字始终实心
 * （见 pdf/PdfApp.vue）。两处落点不一样的原因写在 @shared/constants 的
 * READER_OPACITY_MIN 里。
 *
 * ## 为什么不是 insertCSS（这一条摔过一跤）
 *
 * 原本走的是 `wc.insertCSS(…, { cssOrigin: 'user' })` + 换值时
 * `removeInsertedCSS(旧 key)`。**撤不掉**：在 Electron 44.4.3 上实测，
 * `removeInsertedCSS` 对 user origin 注入的表**不报错、也不生效**——删掉之后
 * 页面自己算出来的 opacity 还是旧值（default origin 的同一对调用则一切正常。
 * 见 spike/css-remove.js：默认来源 0.4 → 1，user 来源 0.4 → 0.4）。
 * 于是「拉回 100%」这一半当着用户的面失效，而且不报错——只有量合成之后的像素
 * 加上读页面自己算出的 opacity，才分得开「没撤掉」与「撤了没重画」两种坏法
 * （live-app.js 的 A12 就是这么问出来的，见 spike-findings.md 的 Q49）。
 *
 * ## 现在走的是 CSSOM 上的行内声明
 *
 * `document.documentElement.style.setProperty('opacity', v, 'important')`，
 * 回到 1 时 `removeProperty('opacity')`。三条理由：
 *
 *   · **撤得掉**——自己写的属性自己删，不必求 removeInsertedCSS；
 *   · **拿到的最强**——行内的 !important 压过页面自己样式表里的任何 !important
 *     （换成一枚 <style> 的话，同是作者来源，就得跟页面的规则比分量和先后）；
 *   · **不碰 CSP**——CSP 只管从标记里解析出来的样式与 <style> 元素，
 *     不管 CSSOM 上直接写的属性，因此本机那些自带 CSP 的 HTML 也一样淡得下去。
 *
 * 文档一导航就重建，这一条随之消失，由 did-navigate → applyPageStyles 再写一次
 * ——与上面两块样式的重注入同一时机。传 1 表示「不淡」：此时只删、不写。
 */
export async function applyReaderOpacity(wc: WebContents, value: number): Promise<void> {
  // 这一段会进样式，因此不信任调用方：非数就当作 1，再夹到 0–1。
  // 定到四位小数是为了让它一定写成 `0.4` 这样的十进制——直接把数插进脚本的话，
  // 极小值会写成 `1e-7`，那不是 CSS 数值该有的写法。
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1

  const 脚本 = `(() => {
    const 行内 = document.documentElement.style
    if (${v >= 1}) 行内.removeProperty('opacity')
    else 行内.setProperty('opacity', '${v.toFixed(4)}', 'important')
  })()`

  try {
    await wc.executeJavaScript(脚本)
  } catch (err) {
    // 页面可能已在导航中被销毁，属于正常竞态
    log.warn('注入阅读透明度失败', err)
  }
}

/**
 * 离线阅读的排版三项：字号 / 行距 / 左右留白。
 * **调用方必须先判定这一页是本机文件**（TabManager 用 @shared/url 的 isLocalFile）
 * ——网页永远不许吃到它。
 *
 * 只有三项，**没有段距**：这一页整篇是一个 `<pre>`，没有段与段之间可言
 * （理由见文件头第 4 条）。那个字段照样在配置里，由自家那两页阅读器去落。
 *
 * ## 它落在哪
 *
 * 这一页是 Chromium 自己渲染的纯文本：整篇文档就是一棵子树，`document.body`
 * 底下躺着一个 `<pre>`，几百万字全在里面（实测见 spike/txt-page.js：用户那本
 * 6.4MB 的小说排出来是一个 354 万字的 `pre`，文档高 308 万像素）。
 * UA 样式表给它的排版是 `font: 13px monospace; white-space: pre-wrap;
 * word-wrap: break-word; padding-left: 0; max-width: none`。
 * 我们碰不到它的结构（那一页的每一行都是 Chromium 排的），能碰的只有
 * **写在那个 `pre` 上的样式**——因此这三项就落在它身上。
 *
 * ## 留白为什么用 padding，不用 width / max-width
 *
 * 本机 EPUB 那一页的同类注入写的是 `width`（那一页的容器是我们画的），这一页
 * **不能照抄**：UA 给的 `pre { max-width: none }` 是一条**具体的**长度声明，
 * 而 `width` 在「max-width 为 none」时没有任何对手，于是 `width: 60%` 会被
 * 无视，正文铺成一条不换行的横带、横向滚出去。`padding-left/right` 没有这个
 * 问题：它加在盒子内侧，`pre-wrap` 照旧在少了几十像素的行盒里折行。
 * 用百分比而不是像素，与书页那份一致——换个窗口宽度读到的还是同一份版心。
 *
 * ## 为什么是行内 CSSOM，而不是 insertCSS
 *
 * 与 applyReaderOpacity 逐条相同：**撤得掉**（自己写的自己删）、**拿到的最强**
 * （行内的 !important 压过页面样式表里的任何规则，UA 的 `pre{}` 更是不在话下）、
 * **不碰 CSP**（CSP 管不着 CSSOM 上直接写的属性）。这一条尤其重要：用户正拖着
 * 那三条滑块，每一次改动都要当场落进去。
 *
 * ## 为什么不等默认值就不写
 *
 * 配置里只有一份字号（`ui.readerFontSize`），本机 EPUB 与 TXT 那两页读的也是它。
 * 于是 17px / 1.85 / 6% 这一组默认值在几个地方说的是同一件事。代价是**打开一份
 * 本机文本的默认样子变了**：从 Chromium 的 13px monospace 变成 17px——这正是
 * 用户要的（那 13px 在 903×508 的窗口里读小说本来就偏小），也是几页字号
 * 终于对齐的那一步。这一条写在 README 里。
 *
 * 传进来的值在这里再夹一遍：这三项在 configStore 里没有夹（那三个字段是
 * 直接取的），手工改坏的配置能一路漏到这儿，而它们**会进样式**。
 */
export async function applyReaderTypeset(
  wc: WebContents,
  typeset: { fontSize: number; lineHeight: number; margin: number }
): Promise<void> {
  const 夹 = (v: number, min: number, max: number): number =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min

  const 字号 = 夹(typeset.fontSize, READER_FONT_MIN, READER_FONT_MAX)
  const 行距 = 夹(typeset.lineHeight, READER_LINE_MIN, READER_LINE_MAX)
  const 留白 = 夹(typeset.margin, READER_MARGIN_MIN, READER_MARGIN_MAX)

  // 行距是**无单位倍数**（`line-height: 1.85` 这种写法），于是它随字号一起缩放
  // ——这正是无单位行距的意义，也是书页那份写进样式表的形式。
  const 脚本 = `(() => {
    const 目标 = document.querySelector('pre') || document.body
    if (!目标) return
    const 样式 = 目标.style
    样式.setProperty('font-size', '${字号}px', 'important')
    样式.setProperty('line-height', '${行距}', 'important')
    样式.setProperty('padding-left', '${留白}%', 'important')
    样式.setProperty('padding-right', '${留白}%', 'important')
  })()`

  try {
    await wc.executeJavaScript(脚本)
  } catch (err) {
    // 页面可能已在导航中被销毁，属于正常竞态
    log.warn('注入阅读排版失败', err)
  }
}
