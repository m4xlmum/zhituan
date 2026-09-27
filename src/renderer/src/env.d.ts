/**
 * Vue 单文件组件的类型声明。
 *
 * window.zhituan 的声明在 src/preload/index.d.ts，由 tsconfig.web.json 纳入。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/**
 * 应用版本号，构建时由 electron.vite.config.ts 从 package.json 写进来。
 *
 * 之所以不是运行时的 `app.getVersion()`：这一页只需要一个字符串，
 * 而它在构建时就已经确定了，为它牵一条 IPC 通道不划算。
 */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/**
 * Vite 的 worker 导入。
 *
 * 这一条是为了本机 PDF 的阅读页：它要 pdf.js 的 worker，而且必须走
 * `?worker&inline`——`file:` 页面 new Worker 一个 `file:` 脚本会被当成跨来源挡掉，
 * inline 出来的是一个 blob，实测可用（见 src/renderer/src/pdf/PdfApp.vue）。
 *
 * 类型是自己写的，而不是引 `vite/client`：那一份还会顺带声明 import.meta.env、
 * 各种静态资源的导入等等，而这个工程只有这一条真的用得上。tsconfig.web.json 没有
 * `types` 字段，因此 node_modules/@types 之外的东西一律要自己声明。
 */
declare module '*?worker&inline' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
