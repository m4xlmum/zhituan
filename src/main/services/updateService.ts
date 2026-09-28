/**
 * 自动检查更新。
 *
 * 三件事：知道有新版本（查 latest.yml）→ 让人看得见（窗口内的一条提示，
 * 见 renderer/src/chrome/UpdateNotice.vue）→ 装得上（下载、校验、起安装程序）。
 *
 * ## 为什么不用 electron-updater
 *
 * 这是「装个库就完了」的典型需求，但在这个仓库里不是：
 *
 * 1. 运行时依赖现在只有两个（都是 @electron-toolkit 的），而它会带进来八九个
 *    （fs-extra / js-yaml / semver / lodash.* / tiny-typed-emitter…），
 *    externalizeDepsPlugin() 让它们全都要打进 app.asar。为一个「一年点几次」
 *    的功能换掉这个形状，不划算。
 * 2. 它的安装那一步与本项目的退出流程打架。quitAndInstall() 走的是它挂在
 *    app.on('quit') 上的处理器，且要求 exitCode === 0；而本项目的 will-quit
 *    结尾是 app.exit(0)——那是有意为之的（那台机器上 Electron 的默认退出会卡
 *    四十多秒，见 src/main/index.ts 的 will-quit）。也就是说「退出时自动装」
 *    在这里本来就不可靠，而绕开它只能自己 spawn 安装程序。
 * 3. 它最值钱的是差量下载（.blockmap），代价是要一直维护 .blockmap 并把它的
 *    下载器一起吞下来。本项目的更新是「用户按下那一下才开始下」，全量可接受。
 *
 * 自己写的代价是**每次更新都全量下载**（1.0.0 的安装包 111MB）。换来的是零新
 * 依赖、退出流程不动、以及安装那一步完全在自己手里。
 *
 * ## 用户只按两下
 *
 * 第一下是「检查更新」，第二下是「更新并重启」。之后全自动：
 *
 *   - **第一下之后**：手动查到的那个版本自己开始下载（那 111MB 是用户挑明的，
 *     不必再让他点一次「下载」）；而启动二十秒后那次静默检查仍然只提示、不下
 *     ——它后面没有人按过任何东西。两条入口因此走的是同一个 check()，
 *     差别只在 manual 这一枚参数上。
 *   - **第二下之后**：还没下的先下再装，正在下的一边下一边等（下完自己装），
 *     已经下好的立刻装。安装是**静默**的、装完把应用自己叫回来（见 install）。
 *
 * 于是「下载」这个动作不再是界面上的一颗按钮，而是这句话的前半截。它仍然
 * 只由用户发起——没有任何一条路上会不问自取地开始下 111MB。
 *
 * ## 状态只有一份
 *
 * 这个类持有 UpdateState，界面（提示条与设置页）都只是它的投影。因此下载进度
 * 在哪个文档里看都是同一个数。**提示条是否占版面**是另一回事，那是窗口控制器
 * 持有的版面状态（WindowRuntime.noticeVisible），由这里的 setNoticeVisible 拨动。
 *
 * ## 失败是安静的
 *
 * 查不到、下不动、校验不过——一律只在设置页那一行里写一句，**界面上不弹任何
 * 东西**。这是个隐身软件：一次网络抖动不该在屏幕上冒出一条东西来。唯一的例外
 * 是「已经知道有新版本、用户按了更新并重启、下载失败」——那时提示条本来就在，
 * 它改成说一句「下载失败」，并给一个去发布页的出口。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { net } from 'electron'
import type { ClientRequest } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { spawn as nodeSpawn } from 'node:child_process'
import { join } from 'node:path'
import { UPDATE_CHECK_TIMEOUT_MS, UPDATE_SPAWN_GRACE_MS, UPDATE_STALL_MS } from '@shared/constants'
import type { UpdateState } from '@shared/types'
import { isNewer, parseVersion } from '@shared/version'
import type { ConfigStore } from './configStore'
import { log } from './logger'

/** latest.yml 里我们要的那几行。electron-builder 写的就这一份形状 */
export interface UpdateManifest {
  version: string
  file: {
    /** 资产文件名，比如 zhituan-1.0.0-x64.exe */
    url: string
    /** 文件的 sha512，base64 编码（electron-builder 写的就是 base64） */
    sha512: string
    size: number
  }
}

/** 起安装程序的返回。真实的（node 的 ChildProcess）能报「早夭」；探针的替身可以不戴 `on`，那就当「不会早夭」 */
export interface SpawnedChild {
  unref(): void
  on?(event: 'exit', listener: (code: number | null) => void): void
  on?(event: 'error', listener: (err: Error) => void): void
}

/** 起安装程序。抽成类型是为了探针能换掉它——探针验到「该起的时候才起」为止 */
export type SpawnFn = (
  file: string,
  args: readonly string[],
  options: { detached: true; stdio: 'ignore' }
) => SpawnedChild

export interface UpdateDeps {
  config: ConfigStore
  /** 更新源，见 constants 的 UPDATE_FEED_BASE */
  feedBase: string
  /** 正在运行的这个版本 */
  currentVersion: string
  /** 这个构建能不能查更新。开发模式下为 false——不联网，也不提示 */
  enabled: boolean
  /** 安装包下到哪儿 */
  downloadDir: string
  onState: (state: UpdateState) => void
  setNoticeVisible: (visible: boolean) => void
  quit: () => void
  spawn?: SpawnFn
  /**
   * 起安装程序之后、退出之前的宽限期（毫秒），默认 UPDATE_SPAWN_GRACE_MS。
   * 探针给 0——「安装程序早夭」那条路要用另一个替身亲手点火，不需要真等三秒。
   */
  spawnGraceMs?: number
}

/**
 * 解析 latest.yml。
 *
 * 刻意**不写通用 YAML 解析器**：认的只有 electron-builder 写出来的那一份形状
 * （顶层 version，files 列表的第一项里 url / sha512 / size）。多认一种写法就多
 * 一种判错的可能，而判错的方向只能是「以为有个新版本」或者「以为没有」——
 * 两者都由不得猜。读不懂就返回 null，上层当作「这次没查到」。
 *
 * url 里不许出现路径分隔符与 `..`：它既会被拼进下载地址，也会被当作本地文件名
 * （见 downloadFile）。这一条是安全边界，不是格式洁癖。
 */
export function parseManifest(text: string): UpdateManifest | null {
  let version = ''
  let url = ''
  let sha512 = ''
  let size = 0
  let inFiles = false
  let entryIndent = -1

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length

    if (indent === 0 && line.startsWith('version:')) {
      version = unquote(line.slice('version:'.length).trim())
      continue
    }
    if (indent === 0 && line.startsWith('files:')) {
      inFiles = true
      continue
    }
    if (inFiles) {
      if (line.startsWith('- ')) {
        // 只认第一项：本项目每次只发一个安装包
        if (url !== '') {
          inFiles = false
          continue
        }
        entryIndent = indent
        const first = line.slice(2).trim()
        if (first.startsWith('url:')) url = unquote(first.slice('url:'.length).trim())
        continue
      }
      if (url !== '' && indent > entryIndent) {
        if (line.startsWith('sha512:')) sha512 = unquote(line.slice('sha512:'.length).trim())
        else if (line.startsWith('size:')) size = Number(line.slice('size:'.length).trim())
        continue
      }
      inFiles = false
    }
  }

  if (version === '' || url === '' || sha512 === '') return null
  if (/[/\\]/.test(url) || url.includes('..')) {
    log.warn(`发布信息里的文件名不可信，忽略：${url}`)
    return null
  }
  if (!Number.isFinite(size) || size <= 0) return null
  return { version, file: { url, sha512, size } }
}

function unquote(value: string): string {
  const m = /^['"]?(.*?)['"]?$/.exec(value)
  return m ? m[1] : value
}

/** 一次失败说给人听是什么失败。认不出来的原样带出去，别把它吞掉 */
function reasonOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/ERR_(INTERNET|CONNECTION|NAME|PROXY|TIMED)/.test(text)) return '网络不通'
  return text === '' ? '未知错误' : text
}

/**
 * 静默安装要的三枚参数，一枚都不能少。
 *
 * - `/S` 不走向导、也不选目录。装到哪儿**由安装程序自己记住**：上一次装在
 *   `HKCU\Software\<某个 UUID>\InstallLocation` 里（那个 UUID 由 appId 推出来），
 *   静默装回的是同一个目录，因此用户当初选在哪儿、升级就落在哪儿，不会多出一份。
 * - `--updated` 说明「这是升级」。它让安装程序容忍还有一个实例在跑（睡一会儿、
 *   再收掉，而不是弹一个「请先关闭」的框），也跳过桌面快捷方式的重建。
 * - `--force-run` **装完把应用启动回来**。这一枚是我们这个形状（assisted
 *   installer，即 oneClick: false）专有的：electron-builder 的
 *   templates/nsis/installSection.nsh 里，`!ifdef ONE_CLICK` 那一支才是「静默也
 *   重启」，我们这一支的判据是 `${isForceRun} ${andIf} ${Silent}`。少了它，
 *   安装程序装完就静默退出，没有人把应用叫回来——「全自动」就断在最后一步上。
 *
 * 这三枚一起加上，等于把「用户点下一步」的那几步全部替他按了。代价是升级期间
 * 看不见任何界面，因此**只有用户自己按了「更新并重启」才许走这条路**（见 install）。
 */
const SILENT_INSTALL_ARGS: readonly string[] = ['/S', '--updated', '--force-run']

export class UpdateService {
  private state: UpdateState
  private manifest: UpdateManifest | null = null
  /** 下载完成并通过校验的安装包路径。只有它是真的才算「能装」 */
  private installerPath: string | null = null
  private checking = false
  private downloading = false
  /**
   * 这一次下载是**被用户中止**的（按了「忽略这一版」），不是失败了。
   *
   * 中止同样会让那条 promise 走进 catch，而 catch 里默认写的是「下载失败：xxx」
   * ——一句话错怪了网络，还让设置页把那句挂在最显眼的位置。有了这枚标志，
   * catch 就知道该闭嘴：状态由 ignore() 自己落回去。
   */
  private aborting = false
  private inflight: ClientRequest | null = null

  constructor(private readonly deps: UpdateDeps) {
    this.state = {
      phase: deps.enabled ? 'idle' : 'disabled',
      enabled: deps.enabled,
      currentVersion: deps.currentVersion,
      version: null,
      percent: 0,
      message: deps.enabled ? '' : '开发模式下不检查更新',
      ignored: false,
      pendingInstall: false
    }
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  /**
   * 查一次。
   *
   * `manual` 是从设置页那个按钮来的：**开关管的是自动检查，不管手动**
   * ——用户关掉「自动检查更新」的意思是「别自己联网」，不是「把这个功能删掉」。
   * 而且手动那一次查到新版就**接着下**：按下这颗键的人要的就是「更新」，
   * 让他再点一次「下载」只是多一道手续（见文件头的「用户只按两下」）。
   */
  async check(options: { manual?: boolean } = {}): Promise<UpdateState> {
    if (!this.deps.enabled) return this.getState()
    if (!options.manual && !this.deps.config.get().update.autoCheck) return this.getState()
    // 正在查或正在下时不叠第二次：并发请求对这件事没有任何好处
    if (this.checking || this.downloading) return this.getState()

    let kickDownload = false
    this.checking = true
    this.setState({ phase: 'checking', message: '' })
    try {
      const text = await this.fetch(
        `${this.deps.feedBase}/releases/latest/download/latest.yml`,
        UPDATE_CHECK_TIMEOUT_MS
      )
      const manifest = parseManifest(text)
      if (!manifest || !parseVersion(manifest.version)) throw new Error('发布信息读不出来')

      // 先把上一个版本的残留下载清掉，再判要不要下
      await this.sweep(manifest.file.url)
      this.manifest = manifest

      if (!isNewer(manifest.version, this.deps.currentVersion)) {
        this.installerPath = null
        this.manifest = null
        this.setState({ phase: 'none', version: null, percent: 0, message: '', pendingInstall: false })
        return this.getState()
      }

      // 下过、且还对得上就不重下（112MB 不值得重来一遍）
      const cached = join(this.deps.downloadDir, manifest.file.url)
      if (await this.matchesHash(cached, manifest.file.sha512)) {
        this.installerPath = cached
        this.setState({ phase: 'ready', version: manifest.version, percent: 100, message: '' })
        return this.getState()
      }

      this.installerPath = null
      this.setState({
        phase: 'available',
        version: manifest.version,
        percent: 0,
        message: '',
        pendingInstall: false
      })
      kickDownload = options.manual === true
    } catch (err) {
      log.warn(`检查更新失败：${reasonOf(err)}`)
      this.manifest = null
      this.installerPath = null
      this.setState({ phase: 'error', version: null, percent: 0, message: reasonOf(err) })
    } finally {
      this.checking = false
    }

    /*
     * 起下载要等 `checking` 落回 false 之后。
     *
     * download() 自己的闸是「正在查或正在下就不进来」，在 try 块里直接调会被
     * 这枚标志当场挡掉——什么都不发生，而外面看起来一切正常（这类「安静地没做
     * 成」最难查）。等 finally 走完再起，走的是与手动下载完全同一条路。
     */
    if (kickDownload) void this.download()
    return this.getState()
  }

  /**
   * 下那个安装包，边下边算 sha512，下完比对。
   *
   * 手动的「检查更新」与「更新并重启」都会从这里走（见 check 与 install）。
   * 下完之后如果用户已经按过「更新并重启」（pendingInstall），这里**直接接着装**
   * ——那一下按的就是「下完自己装、自己重启」，不必让他再按第三次。
   */
  async download(): Promise<UpdateState> {
    if (!this.deps.enabled) return this.getState()
    if (this.downloading || this.checking) return this.getState()
    const manifest = this.manifest
    if (!manifest) return this.getState()

    this.downloading = true
    this.setState({ phase: 'downloading', version: manifest.version, percent: 0, message: '' })
    const target = join(this.deps.downloadDir, manifest.file.url)
    try {
      await mkdir(this.deps.downloadDir, { recursive: true })
      /*
       * 起请求之前再看一眼有没有被中止。
       *
       * 「按下 ✕」与「请求真的发出去」之间隔着 mkdir 这一个 await：那几毫秒里
       * inflight 还是 null，ignore() 的 abort() 落空，于是这一百多兆会在一句
       * 「这一版不要了」之后照下不误、还照装。这枚标志是把那道缝堵上。
       */
      if (this.aborting) throw new Error('下载已被中止')
      const got = await this.downloadFile(target, manifest)
      // 下完之后、改状态之前再看一眼：中止可能刚好发生在最后那一下
      if (this.aborting) throw new Error('下载已被中止')
      if (got !== manifest.file.sha512) {
        // 校验不过的东西不许留在盘上——尤其不许留在「下一步就要执行它」的位置
        await rm(target, { force: true })
        throw new Error('下载的文件校验不过，已删除')
      }
      this.installerPath = target
      this.setState({ phase: 'ready', percent: 100, message: '' })
    } catch (err) {
      if (this.aborting) {
        // 用户按了「忽略这一版」把它中止的，不是失败：状态已经由 ignore() 落回去了。
        // 半截的 .part 由 downloadFile 自己收拾，这里补一刀是防「中止赶在下完之后」
        // ——那一份是完整的，因此得连正名一起删掉。两刀都 await，不留竞态给外人看
        log.info('下载被用户中止')
        await rm(`${target}.part`, { force: true })
        await rm(target, { force: true })
      } else {
        log.warn(`下载更新失败：${reasonOf(err)}`)
        this.installerPath = null
        this.setState({ phase: 'error', percent: 0, message: reasonOf(err), pendingInstall: false })
      }
    } finally {
      this.downloading = false
      this.aborting = false
    }

    // 「下完自己装」那一步。走的是同一个 install()，因此「没校验过不许装」那条
    // 门槛也一并管着这里——installerPath 与 phase 是它自己看着的
    if (this.state.phase === 'ready' && this.state.pendingInstall) this.install()
    return this.getState()
  }

  /**
   * 「更新并重启」这一下走到头。三条路，按当前状态分：
   *
   * - **ready**（这一版已下完并通过校验）→ 起安装程序、退出本进程。
   * - **downloading / available** → 记下这个意图（pendingInstall），下完自己装；
   *   available 时顺手把下载起起来。用户按的既然是「更新并重启」，就不该因为
   *   「还没开始下」而什么都不发生。
   * - **其余状态**（idle / none / error / 关掉）→ 拒绝并记一条日志。**永远不装在
   *   没校验过的东西上**，这条门槛不许松：available 时 installerPath 是空的，
   *   这里的拒绝正是把它挡住的那只手。
   *
   * 安装是**静默**的（`/S --updated --force-run`，见 SILENT_INSTALL_ARGS）：不走向导、
   * 装回上次那个目录、装完把应用自己叫回来。走这条路的前提是**用户按了这一下**
   * ——没有任何一条路上会自己装、自己重启。
   *
   * 顺序是「先起、宽限、后退出」：spawn 之后先看三秒（宽限期，见 spawnInstaller），
   * 安装程序当场夭折就不退、说原因；活过宽限期本进程才走。退出之后安装程序
   * detached 着活下来（不 detach 会被 app.exit(0) 一起带走）。
   */
  install(): void {
    const phase = this.state.phase
    if (phase === 'ready' && this.installerPath) {
      this.spawnInstaller()
      return
    }
    if (phase === 'available' || phase === 'downloading') {
      const needsDownload = phase === 'available'
      this.setState({ pendingInstall: true })
      if (needsDownload) void this.download()
      return
    }
    log.warn(`当前状态（${phase}）没有可装的东西，已拒绝`)
  }

  /** 起安装程序并退出。只有 install() 走得到这里，且只在 ready 那一支 */
  private spawnInstaller(): void {
    const spawn: SpawnFn = this.deps.spawn ?? ((f, a, o) => nodeSpawn(f, a as string[], o))
    log.info(`静默安装并重启：${this.installerPath}`)
    // 上一次失败留下的那句原因，从这一次尝试起就不作数了
    this.setState({ message: '' })
    const child = spawn(this.installerPath as string, SILENT_INSTALL_ARGS, {
      detached: true,
      stdio: 'ignore'
    })

    /*
     * 宽限期：安装程序刚起来就死，应用不许跟着退。
     *
     * 真事（1.6.1 那天）：上一个版本的安装窗口在桌面上开了九十分钟没关，
     * 互斥锁（APP_GUID 两个版本同一把）让新的安装程序在半秒内 Abort，安安静静。
     * 应用照原样「起了就退」，于是用户看到的就是「点了更新并重启，应用关了，
     * 然后什么都没有」——安装没开始，原因一个字都没有。宽限期内以任何姿态离场
     * 都算「没跑起来」（一百多兆的静默安装不可能几秒内装完）：留在 ready——
     * 那一份仍是校验过的——把原因说给人，修好之后（比如关掉那个安装窗口）
     * 再按一下「更新并重启」就重装。活过宽限期才 unref + 退出：那时它已经在
     * 真的干活，退出交接才交得出去。
     */
    const graceMs = this.deps.spawnGraceMs ?? UPDATE_SPAWN_GRACE_MS
    let settled = false
    const fail = (why: string): void => {
      if (settled) return
      settled = true
      log.warn(`安装程序没能跑起来：${why}`)
      this.setState({ phase: 'ready', message: why, pendingInstall: false })
      child.unref()
    }
    child.on?.('error', (err) => fail(`安装程序没能启动：${reasonOf(err)}`))
    child.on?.('exit', (code) => {
      fail(`安装程序刚启动就退出了（代码 ${code ?? '未知'}）。若还有一个没关的安装窗口，先关掉它再试`)
    })
    setTimeout(() => {
      if (settled) return
      settled = true
      child.unref()
      this.deps.quit()
    }, graceMs)
  }

  /**
   * 忽略某个版本（`version` 传 null 是撤销）。
   *
   * 只忽略这一个版本：下一个版本照常提示。落盘，因此下次启动不再冒出来。
   *
   * 正在下的时候被忽略，就**把在下的那一份真的中止掉**：既然下载可能是「手动
   * 查一下」自己带起来的，用户就得有个出口——不然那一百多兆会在他明确说了
   * 「这一版不要」之后继续下完，还占着盘。撤销（传 null）不动下载：那不是
   * 「不要这一版」的意思。
   */
  ignore(version: string | null): UpdateState {
    this.deps.config.set((c) => ({ ...c, update: { ...c.update, ignoredVersion: version } }))
    if (version !== null && version === this.state.version && this.downloading) {
      this.aborting = true
      this.inflight?.abort()
      this.setState({ phase: 'available', percent: 0, message: '', pendingInstall: false })
      return this.getState()
    }
    this.setState({ pendingInstall: false })
    return this.getState()
  }

  // ------------------------------------------------------------ 内部

  /**
   * 状态只有这一个出口：改状态 → 广播 → 拨提示条。
   *
   * 提示条的判据是**「有一个已知的新版本、且没被忽略」**，而不是逐个 phase 列举：
   * 下载失败时 version 仍在，提示条就还在，于是它能改口说「下载失败」并给一个
   * 去发布页的出口；查更新失败时 version 是 null（我们确实不知道有没有新版），
   * 提示条自己就收了——不必在界面上弹任何东西。
   */
  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.state.ignored = this.state.version !== null && this.isIgnored(this.state.version)
    this.deps.onState(this.getState())
    this.deps.setNoticeVisible(this.state.version !== null && !this.state.ignored)
  }

  private isIgnored(version: string): boolean {
    return this.deps.config.get().update.ignoredVersion === version
  }

  /** 取一份文本（latest.yml 就几行）。超时用定时器，Electron 的 ClientRequest 没有 setTimeout */
  private fetch(url: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = net.request(url)
      this.inflight = req
      let settled = false
      const finish = (err: Error | null, text?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.inflight === req) this.inflight = null
        if (err) reject(err)
        else resolve(text ?? '')
      }
      const timer = setTimeout(() => {
        req.abort()
        finish(new Error('连接超时'))
      }, timeoutMs)

      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          finish(new Error(`服务器返回 ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')))
        res.on('error', (err: Error) => finish(err))
      })
      req.on('error', (err: Error) => finish(err))
      req.end()
    })
  }

  /**
   * 下文件。返回它的 sha512（base64），比对由调用方做。
   *
   * 先写 `<名字>.part`、下完再改名：**半截文件绝不以上面那个名字出现在盘上**。
   * 于是「盘上有这个文件」永远等于「它是完整的」，缓存判断与清理都只需要看一个名字。
   *
   * 卡住的判据是「多久没有数据」而不是总时长：安装包 100MB 以上，网慢的人下
   * 几分钟是正常的，设总时长等于让他们永远更新不了。每收到一块就把表重置。
   */
  private downloadFile(target: string, manifest: UpdateManifest): Promise<string> {
    const part = `${target}.part`
    const url = `${this.deps.feedBase}/releases/download/v${manifest.version}/${manifest.file.url}`
    return new Promise((resolve, reject) => {
      const req = net.request(url)
      this.inflight = req
      const hash = createHash('sha512')
      let received = 0
      let percent = 0
      let settled = false
      const out = createWriteStream(part)

      const cleanup = (): void => {
        clearTimeout(stall)
        out.destroy()
      }
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        req.abort()
        void rm(part, { force: true })
        if (this.inflight === req) this.inflight = null
        reject(err)
      }
      const stall = setTimeout(() => fail(new Error('下载中断')), UPDATE_STALL_MS)
      const bump = (): void => {
        stall.refresh()
      }

      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          fail(new Error(`服务器返回 ${res.statusCode}`))
          return
        }
        const header = Number(res.headers['content-length'])
        const total = Number.isFinite(header) && header > 0 ? header : manifest.file.size
        res.on('data', (chunk: Buffer) => {
          bump()
          const buf = Buffer.from(chunk)
          received += buf.length
          hash.update(buf)
          out.write(buf)
          const next = Math.min(99, Math.floor((received / total) * 100))
          if (next !== percent) {
            percent = next
            this.setState({ percent: next })
          }
        })
        res.on('end', () => {
          if (settled) return
          out.end(() => {
            if (settled) return
            settled = true
            cleanup()
            if (this.inflight === req) this.inflight = null
            rename(part, target).then(
              () => {
                this.setState({ percent: 100 })
                resolve(hash.digest('base64'))
              },
              (err: Error) => {
                void rm(part, { force: true })
                reject(err)
              }
            )
          })
        })
        res.on('error', (err: Error) => fail(err))
      })
      req.on('error', (err: Error) => fail(err))
      out.on('error', (err: Error) => fail(err))
      req.end()
    })
  }

  /** 盘上那份文件是不是就是这一份（sha512 对得上）。流式读，不把 100MB 读进内存 */
  private matchesHash(file: string, expected: string): Promise<boolean> {
    return new Promise((resolve) => {
      const hash = createHash('sha512')
      const input = createReadStream(file)
      input.on('data', (chunk) => hash.update(chunk))
      input.on('error', () => {
        resolve(false)
      })
      input.on('end', () => {
        resolve(hash.digest('base64') === expected)
      })
    })
  }

  /** 清掉下载目录里不是这一版的东西（只动我们自己的那个目录） */
  private async sweep(keep: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.deps.downloadDir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === keep || entry === `${keep}.part`) continue
      await rm(join(this.deps.downloadDir, entry), { force: true, recursive: true })
    }
  }
}
