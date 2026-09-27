/**
 * 探针用的 preload 替身——**只替一座桥**（配置），别的一律照真。
 *
 * 真 preload（src/preload/index.ts）会校验来源，而这一页在探针里是从 file: 加载的，
 * 走不通。所以把 `window.zhituan.config` 顶上，形状照真实现给：`get` / `patch` /
 * `onChanged`。BookApp 只用这一座桥（读 ui.readerOpacity），因此这里的"假"只假在
 * 出处，不假在行为。
 *
 * `__probeSetOpacity` 是**探针专有**的一枚钩子（真 preload 里没有）：让探针在不同
 * 透明度之间切换而不必重开一扇窗。它走的是与那条真滑块同一条 `onChanged`，
 * 所以顺手把「拉滑块纸当场跟着淡」这条响应式路径也量了。
 *
 * 沙箱里的 preload 拿不到 node:fs，因此初始值走环境变量。
 */
const { contextBridge } = require('electron')

let current = Number(process.env.BOOK_PROBE_OPACITY ?? 1)
if (!Number.isFinite(current)) current = 1

const listeners = new Set()
const snapshot = () => ({ ui: { readerOpacity: current } })

contextBridge.exposeInMainWorld('zhituan', {
  config: {
    get: async () => snapshot(),
    patch: async (patch) => {
      const next = patch && patch.ui && typeof patch.ui.readerOpacity === 'number' ? patch.ui.readerOpacity : current
      current = next
      const shown = snapshot()
      for (const cb of listeners) cb(shown)
      return shown
    },
    onChanged: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  },
  __probeSetOpacity: (v) => {
    current = v
    const shown = snapshot()
    for (const cb of listeners) cb(shown)
  }
})
