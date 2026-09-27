/**
 * 探针的临时 userData 目录：建一个、跑完尽力收走、**下次启动顺手清掉上次没收走的**。
 *
 * ## 为什么不能只靠「退出时自己删」
 *
 * 因为**删不掉**。Windows 上文件句柄由内核持有，Electron 主进程还活着的时候
 * （哪怕已经 `app.exit()` 到一半），它自己的 `Cache` / `Code Cache` 那些目录就动不了：
 * `rmSync` 抛 `EBUSY` / `EPERM`，而收尾动作不能因为删不干净就把探针弄挂，于是只能吞掉。
 * 实测（2026-09-27）：进程退出之后从外面 `rm -rf` 一次就干净了——说明不是权限，
 * 是**自己删自己**这件事在 Windows 上不成立。
 *
 * 所以这里做两件事，缺一不可：
 *
 *   1. `removeTemp()` 仍然尽力而为（Linux / macOS 上是真能删掉的）；
 *   2. `makeTempUserData()` **在开工前**扫一遍同前缀的旧目录，把早于 1 小时的删掉——
 *      那时它们对应的进程早就没了，删得干净。1 小时这个门槛是为了绝不可能碰到
 *      正在跑的那一份（本项目最长的一支探针三分半）。
 *
 * 前缀由调用方给（`zhituan-booktab-` / `zhituan-live-`），这是「只删自己的东西」
 * 那一道闸：**只碰自己前缀底下的目录**，`%TEMP%` 里别人写的东西一个都不动。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** 早于这个时长的才算「上次留下的」。跑着的探针不可能这么久还没写完 userData */
const STALE_MS = 60 * 60 * 1000

/** 收走一个临时目录。删不掉就算了——理由是文件头那一段 */
function removeTemp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 })
    return true
  } catch {
    return false
  }
}

/**
 * 清掉同前缀的旧目录。返回清掉了几个与它们合计多大（字节）。
 * 只认自己那个前缀，且只认过期的。
 */
function sweepStale(prefix) {
  const dir = os.tmpdir()
  const now = Date.now()
  let 个数 = 0
  let 字节 = 0

  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return { 个数, 字节 }
  }

  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const full = path.join(dir, name)
    try {
      const st = fs.statSync(full)
      if (!st.isDirectory() || now - st.mtimeMs < STALE_MS) continue
      字节 += 大致大小(full)
      if (removeTemp(full)) 个数++
    } catch {
      // 正在被别人用、或者权限不对：跳过，不影响这一跑
    }
  }
  return { 个数, 字节 }
}

/**
 * 大致体积。只为了在日志里报一句「顺手清了多少」，因此**不递归算得很准**：
 * 顶层几项加起来就够说明问题了，也不必为了一个数字把整个目录走一遍。
 */
function 大致大小(dir) {
  let total = 0
  try {
    for (const name of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, name))
      if (st.isFile()) total += st.size
    }
  } catch {
    // 量不到就是 0
  }
  return total
}

/**
 * 建一个临时 userData 目录，顺手清掉这个前缀底下过期的旧目录。
 *
 * 旧的那批是「上次被 `timeout` 杀掉、没来得及收走」的——**这是常态而不是意外**：
 * 探针跑完不会自己退出（Electron 主进程在），跑法一律是 `timeout N npx electron …`。
 */
function makeTempUserData(prefix) {
  const { 个数, 字节 } = sweepStale(prefix)
  if (个数 > 0) {
    console.log(`…… 顺手清掉上次留下的 ${个数} 份临时 userData（约 ${Math.round(字节 / 1048576)}MB）`)
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

module.exports = { makeTempUserData, removeTemp, sweepStale }
