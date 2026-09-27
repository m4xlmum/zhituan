/**
 * 本机文件类 IPC：离线阅读。
 *
 * 这条路刻意做得最短：**系统选文件框选中的那几本直接开成标签页**，
 * 没有「书架」这种要维护的中间态。TXT 交给 Chromium 自己渲染；PDF 与 EPUB 开成
 * 自家的阅读页（pdf.js 画进 canvas，白纸才去得掉；EPUB 把章节注入 Shadow DOM，
 * 纸才归我们画。见 services/pdfReader.ts 与 services/bookReader.ts）。
 * 而「哪一本该走哪一路」不在这里判：地址交给 TabManager.create，判据只有两条
 * （@shared/url.ts 的 isLocalPdf 与 isLocalEpub）——会话恢复、网页里点一个 file:
 * 链接、地址栏里粘一个路径，走的也是那一处，本文件因此不必知道三种格式的分别。
 *
 * 路径不出主进程：回来的是文件名（见 @shared/url.ts 的 fileNameOf）。
 * 这个程序的全部意义是别人看不出你在干什么，而一条 `C:\Users\…\Documents\…`
 * 会把用户名和目录习惯一起摊在屏幕上。
 *
 * 另一个动作是**阅读位置**（`SEND.bookReading`）：本机 EPUB 的阅读页报一声
 * 「我在第几章的百分之几」，回程上只有几个数字。它住在这里是因为「接着上次读」
 * 本来就是离线阅读的一半——选完文件，读，下次打开回到原处。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { dialog, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { INVOKE, SEND } from '@shared/ipc'
import { fileNameOf } from '@shared/url'
import { rememberReading } from '../services/bookReader'
import type { AppContext } from '../context'

/**
 * 能选的文件类型。
 *
 * 只有一组，而且**不挂「所有文件」**：列上「所有文件」之后，用户能选中一本 MOBI
 * 或 AZW3，然后看着它变成一次下载——那比「选不到」更让人摸不着头脑。选不到是
 * 一句明确的话，而那一栏的说明里也写着这两种暂不支持、指向路线图。
 *
 * 过滤器名字要能自己说清「你能选什么」：Chromium 按扩展名猜内容类型，不认识的
 * 扩展名一律变成下载，因此这里只能收它认得的。PDF 与 EPUB 它都认得——而这两种
 * 都不再进 Chromium 自己那一路（PDF 内置阅读器的白底去不掉、EPUB 直接被它拦成
 * 下载），各自开成自家的阅读页，见 services/pdfReader.ts 与 services/bookReader.ts。
 */
const FILTERS: Electron.FileFilter[] = [
  { name: '文本、PDF 与电子书', extensions: ['txt', 'pdf', 'epub'] }
]

/**
 * 弹出选文件框，把选中的每一本开成一张标签页。返回它们的**文件名**。
 *
 * 多选是刻意的：一次挑三本书是「我要摸一天鱼」这个场景里很自然的动作，
 * 而一本一本弹三次同一个框，比多选难受得多。
 */
export async function openLocalFiles(ctx: AppContext): Promise<string[]> {
  const parent = ctx.controller.getWindow()
  const options: Electron.OpenDialogOptions = {
    title: '打开本机文件',
    buttonLabel: '开始阅读',
    properties: ['openFile', 'multiSelections'],
    filters: FILTERS
  }

  // 取消就是空数组——不是错误，界面据此什么都不说
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) return []

  const names: string[] = []
  for (const path of result.filePaths) {
    const url = pathToFileURL(path).href
    ctx.tabs.create({ url, activate: true })
    const name = fileNameOf(url)
    if (name) names.push(name)
  }
  return names
}

export function registerFileIpc(ctx: AppContext): void {
  ipcMain.handle(INVOKE.fileOpenLocal, () => openLocalFiles(ctx))

  /*
   * 阅读位置（本机 EPUB）：阅读页报一声「我在第几章的百分之几」。
   *
   * 处理得刻意薄：拿 token 去问 bookReader 那两张表换成本机路径，查不到就什么
   * 也不做——**安全边界天然在 token 表上**（只有真正开过的书才有 token），因此
   * 不必再加一层来源校验；桥本来也只有自家页面有，网页调不到这条通道。
   */
  ipcMain.on(SEND.bookReading, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') return
    const r = input as { token?: unknown; chapter?: unknown; ratio?: unknown }
    if (typeof r.token !== 'string' || typeof r.chapter !== 'string') return
    rememberReading(r.token, r.chapter, typeof r.ratio === 'number' ? r.ratio : 0)
  })
}
