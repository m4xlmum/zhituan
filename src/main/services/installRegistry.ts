/**
 * 「这台机器上登记的安装」——注册表说装了哪一版、装在哪儿。
 *
 * ## 它回答的问题
 *
 * 1.6.6 那次事故留在用户机器上的形态是**混合安装**：注册表写着 1.6.7，磁盘上的
 * zhituan.exe 还是 1.6.6（app.asar 被一个退不掉的进程占着，安装器一个字节都没
 * 换掉）。从用户那一侧看就是「点了更新并重启，只重启，没更新」——而应用自己
 * 对此一无所知：它按「版本号 = 注册表」这个假设说话，于是永远说不出真相。
 *
 * 这个模块读一遍注册表，让应用能说出那句实话：**本机登记的是 A 版，我正跑着的
 * 却是 B 版**。它不是判据，是给用户的一句话（见 UpdateNotice）。安装器那一侧
 * 现在也会在动手之前探问、拦下、把话说清楚（见 build/installer.nsh 的第 1 层）；
 * 两个出口说同一件事，是因为用户可能从任一侧撞上这个状态。
 *
 * ## 两把键
 *
 * electron-builder 的 NSIS 模板把安装信息写在两处，键名都是 appId 的 UUID v5
 * （见 appGuidOf）：
 *
 *   HKCU\Software\<GUID>                                            ← INSTALL_REGISTRY_KEY
 *     InstallLocation / KeepShortcuts / ShortcutName
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID> ← UNINSTALL_REGISTRY_KEY
 *     DisplayName / DisplayVersion / DisplayIcon / UninstallString…
 *
 * **版本号在卸载那一把上**（DisplayVersion），**装在哪两把上都能问**（卸载那把的
 * DisplayIcon 是「<exe 路径>,0」，另一把有 InstallLocation）。本机实读（1.6.6
 * 正跑着的那台机器）：
 *
 *   DisplayVersion  1.6.7
 *   DisplayIcon     C:\Users\poem\Desktop\zhituan\zhituan.exe,0
 *   InstallLocation C:\Users\poem\Desktop\zhituan
 *
 * 安装时若选了「所有用户」（perMachine 为假时也能选），这两把键落在 HKLM，因此
 * 两个根键都问一遍；HKLM 那一支问的是 64 位视图（NSIS 那边 SetRegView 64，
 * Electron 起的也是 64 位 reg.exe）。
 *
 * ## 只报「正在跑的这一份」
 *
 * 比之前先要求**登记的安装目录与正在跑的这个 exe 所在目录是同一个**。不是同一个
 * 就一句话都不说：那时注册表里的版本号讲的是别的目录里那一份，跟我们这个进程的
 * 文件新旧毫无关系，说了就是冤枉（开发模式跑源码、或者用户手边还放着一份解压版
 * 都属这一类）。同理，目录读不出来（键不在、值里有 ANSI 表达不了的字、reg.exe
 * 起不来）也一律沉默——**这条路上错的方向只能是漏报，不能是冤报**。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, normalize } from 'node:path'
import { isNewer } from '@shared/version'
import { log } from './logger'

/**
 * electron-builder 给 NSIS 用的那个命名空间常量（app-builder-lib 的
 * NsisTarget.js:28），GUID = UUID v5(appId, 它)。不是抄来的谜语数：本机 appId
 * `com.m4xlmum.zhituan` 用它算出来正是 `3437b4c4-5fc0-5612-8fed-0aba488ce0e5`，
 * 与这台机器注册表里那两把真实键名逐字相同（spike/update-check.js 的 Q14 每次
 * 都会重算一遍并跟 electron-builder.yml 里的 appId 对上）。
 */
const EB_NS_UUID = '50e065bc-3134-11e6-9bab-38c9862bdaf3'

/**
 * appId → 注册表键名里那把 GUID。
 *
 * 与 electron-builder 同一套算法：sha1(命名空间字节 ‖ appId 的 UTF-8)，取前 16
 * 字节，再把版本位（第 7 字节高半字节 = 5）与变体位（第 9 字节高两位 = 10）压上，
 * 最后按 8-4-4-4-12 排成十六进制。
 */
export function appGuidOf(appId: string): string {
  const ns = Buffer.allocUnsafe(16)
  let at = 0
  for (let i = 0; i < 16; i += 1) {
    ns[i] = parseInt(EB_NS_UUID.slice(at, at + 2), 16)
    at += 2
    // 命名空间自己那四个连字符要跳过
    if (i === 3 || i === 5 || i === 7 || i === 9) at += 1
  }
  const bytes = createHash('sha1').update(ns).update(appId, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 注册表里记着的那一份安装 */
export interface RegisteredInstall {
  /** 登记的版本号（DisplayVersion） */
  version: string
  /** 登记的安装目录。读不出来时是 null —— 那就什么都不说，见文件头 */
  dir: string | null
}

/**
 * 从 `reg query` 的一行里取出某个 REG_SZ 的值。
 *
 * 形状是 `    DisplayVersion    REG_SZ    1.6.7`（列宽不定，值里可能有空格）。
 * 只认 REG_SZ：这几处登记的都是字符串，碰上别的类型宁可当读不出来。
 */
export function parseRegValue(stdout: string, name: string): string | null {
  const line = new RegExp(`^\\s*${name}\\s+REG_SZ\\s+(.*?)\\s*$`)
  for (const raw of stdout.split(/\r?\n/)) {
    const m = line.exec(raw)
    if (m) return m[1]
  }
  return null
}

/**
 * 问一句注册表。读不到（键不在、名字不在、reg.exe 起不来）都返回 null。
 *
 * 输出按 UTF-8 解，而 reg.exe 吐的是本机 ANSI 码页——路径里带中文时这一串会是
 * 乱码。刻意不为此加一套解码：这个值只用来跟「正在跑的目录」比相等，乱码只会
 * 比不相等，而比不相等的结果是沉默（见文件头），不是报错。
 */
function regQuery(key: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', key, '/v', name],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (err, stdout) => {
        resolve(err ? null : parseRegValue(stdout, name))
      }
    )
  })
}

/** DisplayIcon 是「<exe 路径>,0」，把路径那一半取出来、再取它的目录 */
function dirOfIcon(icon: string | null): string | null {
  if (icon === null) return null
  const path = icon
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()
  return path === '' ? null : dirname(path)
}

/**
 * 读本机登记的安装（HKCU 优先，再看 HKLM）。读不到就是 null。
 *
 * HKCU 优先是因为本项目的安装器默认按当前用户装（electron-builder.yml 里
 * perMachine: false），那是最常见的那一份；两边都装了的话，卸载项里先问到的
 * 那一份才是「最近一次安装」登记的那一份。
 */
export async function readRegisteredInstall(appId: string): Promise<RegisteredInstall | null> {
  if (process.platform !== 'win32') return null
  const guid = appGuidOf(appId)
  for (const hive of ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE']) {
    const uninstall = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`
    const version = await regQuery(uninstall, 'DisplayVersion')
    if (version === null || version === '') continue
    const installLocation = await regQuery(`${hive}\\Software\\${guid}`, 'InstallLocation')
    const icon = installLocation === null ? await regQuery(uninstall, 'DisplayIcon') : null
    return { version, dir: installLocation ?? dirOfIcon(icon) }
  }
  return null
}

/** 判据要的三样东西。抽成一个纯函数，是为了探针能在不碰注册表的前提下把每种组合都问一遍 */
export interface MixedInstallInput {
  /** 正在跑的这一份的版本（app.getVersion()） */
  runningVersion: string
  /** 正在跑的这个 exe 所在的目录 */
  runningDir: string
  registered: RegisteredInstall | null
}

/**
 * 混合安装的判据：**登记的版本比正在跑的这一版新，而且两者是同一个目录**。
 * 是就返回登记的那个版本号（说给人听时要用），不是就 null。
 *
 * 「同一个目录」这一条不是洁癖：不同目录时登记的版本讲的是另一个位置上的那一份，
 * 本进程的文件新旧它管不着（见文件头）。
 */
export function mixedInstallOf(input: MixedInstallInput): string | null {
  const registered = input.registered
  if (registered === null || registered.dir === null) return null
  const same = normalize(registered.dir).toLowerCase() === normalize(input.runningDir).toLowerCase()
  if (!same) return null
  return isNewer(registered.version, input.runningVersion) ? registered.version : null
}

/**
 * 给主进程用的那一句：读一遍注册表，回答「本机登记的安装比正在跑的这一份新吗」。
 *
 * 读出来的东西每一句都写进日志：这个状态在用户那里表现为「更新了但没变」，而
 * 下一次有人拿着日志来找原因时，这三行（登记了什么、跑着什么、算出来什么）就是
 * 全部证据。
 */
export async function detectMixedInstall(input: {
  appId: string
  runningVersion: string
  runningDir: string
}): Promise<string | null> {
  const registered = await readRegisteredInstall(input.appId)
  const mixed = mixedInstallOf({
    runningVersion: input.runningVersion,
    runningDir: input.runningDir,
    registered
  })
  const said =
    registered === null
      ? '本机读不到登记项'
      : `本机登记的是 ${registered.version}${registered.dir === null ? '（目录读不出来）' : ` @ ${registered.dir}`}`
  const here = `正在跑的是 ${input.runningVersion} @ ${input.runningDir}`
  if (mixed === null) log.info(`${said}；${here} —— 不是混合安装`)
  else log.warn(`${said}；${here} —— 混合安装：上一次更新没落地（少了 ${mixed} 那一版的文件）`)
  return mixed
}
