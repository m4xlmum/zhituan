/**
 * 「假的应用」——给 kill-self.nsi 造拓扑用的。
 *
 * 它只做两件事，其余一律不做：
 *
 *   1. 把探针 detached 地起起来。**起法与生产代码一字不差**：
 *      src/main/services/updateService.ts 的 spawnInstaller 用的是
 *      `spawn(安装包, args, { detached: true, stdio: 'ignore' })` 然后 unref()。
 *      detached 在 Windows 上只是 DETACHED_PROCESS + 新进程组——**父进程链还在**，
 *      这正是那个 bug 的关节：安装程序仍然是「应用」的子进程。
 *
 *   2. 自己活着不动，等着被 taskkill。
 *
 * 它的镜像名由外面决定（kill-self.sh 会把 node.exe 拷成 zt-fakeapp.exe），
 * 必须等于探针里的 APP_EXECUTABLE_FILENAME——这样探针的 taskkill 才会把它
 * 当成「纸团」。
 *
 * 用法：zt-fakeapp.exe fake-app.js <探针路径> [给探针的参数...]
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { spawn } = require('node:child_process')

const [probe, ...rest] = process.argv.slice(2)
if (!probe) {
  console.error('用法：fake-app.js <探针路径> [参数...]')
  process.exit(2)
}

const child = spawn(probe, rest, { detached: true, stdio: 'ignore' })
child.unref()

// 记一行到 stdout，好让驱动脚本把「谁是谁」对上
console.log(`fake-app pid=${process.pid} 起了探针 pid=${child.pid}：${probe} ${rest.join(' ')}`)

// 活着，等被杀。足够长，跑完一整轮探针绰绰有余
setTimeout(() => {}, 180_000)
