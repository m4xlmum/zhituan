/**
 * 探针用的 electron 门面。
 *
 * 探针要验的是**真的**主进程模块（src/main/services/bookReader.ts），而它 import
 * 了 electron。这里把那个名字转给 `global.__electron`——探针在 require 打好的包之前
 * 把真实现塞进去，于是它调到的 protocol / Session 都是真的，协议也真的注册在
 * Electron 上。用替身的话，测出来的就是替身的行为，与本项目的规矩相反。
 *
 * 用取值器而不是提前拷一份：拷贝发生在模块求值的那一刻，而那时 global.__electron
 * 可能还没塞进来（打包之后模块的求值顺序由 esbuild 定，不该指望它）。
 */
const names = [
  'app',
  'protocol',
  'session',
  'ipcMain',
  'BrowserWindow',
  'nativeImage',
  'dialog',
  'shell',
  'net',
  'screen'
]

const stub = {}
for (const name of names) {
  Object.defineProperty(stub, name, {
    enumerable: true,
    get: () => (global.__electron ?? {})[name]
  })
}

module.exports = stub
