/**
 * 探针：自动检查更新这条路，从「查」到「下」到「装」到底成不成立。
 *
 * 这个功能的形状有一半是**安全**决定的，所以探针的重心不在「顺利的那条路」，
 * 而在三条「不行的那条路」：
 *
 * 1. **没下完、没校验通过时，绝不许起安装程序。** 允许执行一个来路不明（或者
 *    只下了一半）的可执行文件，比不更新严重得多。install() 在 idle / none /
 *    error 上一律拒绝；在 available 与下载中只记下意图（pendingInstall），
 *    **当场一次 spawn 都不许有**；只有 ready（下完并通过校验）才起安装程序。
 * 2. **校验不过的东西不许留在盘上。** 它躺的那个位置正是「下一步就要执行它」。
 *    篡改一个字节 → 必须 error，且那个文件当场消失。
 * 3. **失败是安静的。** 查不动、网不通时不许把提示条叫出来——这是个隐身软件，
 *    一次网络抖动不该在屏幕上冒出一条东西。断言的是 setNoticeVisible 替身收到的
 *    **全是 false**，而不是「反正没显示」。
 *
 * 另外几条只有在这里验得了：
 *
 *   - **用户只按两下，后面全是自动的**（这一版新改的形状）：第一下「检查更新」
 *     查到新版就自己开始下（Q8b），第二下「更新并重启」按下之后该下的先下、
 *     该排队的排队、下完自己装、装完自己重启（Q8c）。这两条路**跨过了界面上的
 *     点击**——没有人 await 它们，因此探针得自己盯着那一串走完（见 makeStage
 *     的 settled）。
 *   - **静默安装的三枚参数一枚不少**（Q10）：`/S --updated --force-run`。
 *     少了 `--force-run`，assisted installer 装完不会把应用启动回来，
 *     「全自动」就断在最后一步上（见 docs/spike-findings.md 的 Q48）。
 *   - **下载中被忽略要真的中止**（Q8d）：不留 `.part`、不写成「下载失败」、
 *     更不许把它装上；撤销之后能重来一遍。
 *   - **开关管的是自动检查，不管手动**：autoCheck=false 时 check() 一个请求都不
 *     发（用 HTTP 服务器的计数证明，不是看返回值），而手动 check({manual:true}) 照发。
 *   - **已经下过的那一份会被认出来**：再查一次直接 ready，不重下 111MB。
 *   - **广播不许刷屏**：进度只在整数百分比变化时才发一次，总数 ≤ 101。
 *
 * 用的是**真的** UpdateService / ConfigStore / version.ts（esbuild 打成一包再
 * require，见 buildModules），配置写在临时目录里，绝不碰用户那一份。HTTP 服务器
 * 是本机起的；GitHub 那条真地址只有 `--net` 时才走。
 *
 * 资产是探针自己造的 2MB 随机字节——因此「下载 + 校验」这条路能真的走完，
 * 而不必去动那个 111MB 的真安装包。真安装包只在 Q12 里量一下大小。
 *
 * 跑法：npx electron spike/update-check.js
 *       npx electron spike/update-check.js --net    （多问一次真地址）
 * 产出：终端一份 [Qn] 报告、spike/out/update-check.json（有一问没过就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app } = require('electron')
const esbuild = require('esbuild')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const MANIFEST_PATH = '/releases/latest/download/latest.yml'
const WANT_NET = process.argv.includes('--net')

const results = []
let failed = 0

/**
 * 记一问。
 *
 * 判定与报告同一处出口：这一版要问的东西多，散着写会漏掉某一问的失败——
 * 而「漏掉一问」与「那一问过了」在终端上长得一模一样。
 */
function check(id, question, problems, detail) {
  const ok = problems.length === 0
  results.push({ id, question, ok, problems, detail })
  if (!ok) failed += 1
  console.log(`[${id}] ${ok ? 'OK  ' : 'FAIL'} ${question}`)
  if (!ok) for (const p of problems) console.log(`      · ${p}`)
  else if (detail !== undefined) {
    console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}

const step = (what) => console.log(`  · ${what}`)

/**
 * 记一问「没跑成」。
 *
 * 与失败分开记：`--net` 那一问验的是「URL 拼得对不对」，只有真地址验得了，
 * 而真地址通不通由这台机器的网络决定（这台机器上 github.com 只有走本地代理
 * 才通，见 docs/spike-findings.md 里那条关于 GitHub 直连的结论）。把它算成失败，
 * 等于让探针在一个与代码无关的条件上永远红着——那种红很快就会被当成噪音忽略掉。
 */
function skip(id, question, why) {
  results.push({ id, question, ok: null, problems: [], detail: why })
  console.log(`[${id}] SKIP ${question}`)
  console.log(`      ${why}`)
}

/** 把要用的几份 TS 各打成一包再 require。理由与 tray-reveal.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-update-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'updateService.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'configStore.ts'),
      path.join(ROOT, 'src', 'shared', 'version.ts'),
      path.join(ROOT, 'src', 'shared', 'constants.ts')
    ],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outdir,
    outbase: path.join(ROOT, 'src'),
    outExtension: { '.js': '.cjs' },
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    external: ['electron'],
    logLevel: 'silent'
  })
  const at = (...p) => path.join(outdir, ...p)
  return {
    updateService: require(at('main', 'services', 'updateService.cjs')),
    configStore: require(at('main', 'services', 'configStore.cjs')),
    version: require(at('shared', 'version.cjs')),
    constants: require(at('shared', 'constants.cjs'))
  }
}

// ---------------------------------------------------------------- 场子

const assetName = (version) => `zhituan-${version}-x64.exe`
const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('base64')

/** electron-builder 写出来的那一份形状，逐行照抄 */
function manifestText(version, sha, size) {
  const url = assetName(version)
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha}`,
    `    size: ${size}`,
    `path: ${url}`,
    `sha512: ${sha}`,
    "releaseDate: '2026-09-24T09:11:08.855Z'",
    ''
  ].join('\n')
}

/** 本机那只「GitHub」。请求逐条记账，因为「开关关掉就不许联网」只能这么证明 */
function startServer(state) {
  const server = http.createServer((req, res) => {
    state.requests.push(req.url)
    if (req.url === MANIFEST_PATH) {
      res.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' })
      res.end(state.manifest)
      return
    }
    if (req.url.startsWith('/releases/download/')) {
      state.downloads += 1
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(state.asset.length)
      })
      res.end(state.asset)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = http.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

const tmpDir = (kind) => fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-update-${kind}-`))

/**
 * 一个现场：一份临时配置、一个临时下载目录、一个 UpdateService。
 *
 * spawn / quit / setNoticeVisible / onState 四个出口全部换成记账的替身——
 * 「有没有起过安装程序」「提示条被拨成过什么」这两件事，正是这一版要问的。
 *
 * download() 被包了一层，把每一条下载的 promise 记下来，交给 settled() 去等。
 * 要它是因为这一版有一半的路**没有人 await**：手动查一次会自己带起下载、
 * 下完还会自己接着装，全是 fire-and-forget。探针要问「下完之后到底发生了什么」，
 * 就得有个地方等那一串安静下来——等着不动，或者靠 sleep 猜时间，两种都验不准。
 */
function makeStage(mods, options) {
  const config = new mods.configStore.ConfigStore(options.configDir)
  if (options.configure) options.configure(config)
  const events = []
  const notices = []
  const spawns = []
  let quits = 0
  const service = new mods.updateService.UpdateService({
    config,
    feedBase: options.feedBase,
    currentVersion: options.currentVersion ?? '1.0.0',
    enabled: options.enabled ?? true,
    downloadDir: options.downloadDir,
    onState: (s) => events.push(s),
    setNoticeVisible: (v) => notices.push(v),
    quit: () => {
      quits += 1
    },
    spawn: (file, args, spawnOpts) => {
      spawns.push({ file, args, spawnOpts })
      return { unref() {} }
    }
  })

  const inflight = new Set()
  const rawDownload = service.download.bind(service)
  service.download = (...callArgs) => {
    const p = rawDownload(...callArgs)
    inflight.add(p)
    p.then(
      () => inflight.delete(p),
      () => inflight.delete(p)
    )
    return p
  }
  /** 等到「查 / 下 / 下完接着装」这一串全安静下来（最多转 200 圈，防死循环） */
  const settled = async () => {
    for (let i = 0; i < 200 && inflight.size; i += 1) await Promise.all([...inflight])
  }

  return {
    service,
    config,
    events,
    notices,
    spawns,
    quits: () => quits,
    settled,
    last: () => events[events.length - 1]
  }
}

/**
 * 提示条每一次拨动，是否正好等于「那一刻有一个已知的新版本、且没被忽略」。
 *
 * 主进程 setState 里这两件事是同一行代码的两个动作（先广播、再拨条），因此
 * 两份记录的下标天然对齐。对齐着比，才能验出「状态对了、条没跟上」这类不对称
 * ——那种错在界面上表现为「明明有新版本却没有提示」，不这么比就只能靠肉眼。
 */
function noticePairs(stage) {
  const bad = []
  if (stage.events.length !== stage.notices.length) {
    bad.push(`广播 ${stage.events.length} 次、拨条 ${stage.notices.length} 次，对不上`)
  }
  for (let i = 0; i < Math.min(stage.events.length, stage.notices.length); i += 1) {
    const e = stage.events[i]
    const want = e.version !== null && !e.ignored
    if (stage.notices[i] !== want) {
      bad.push(
        `第 ${i + 1} 次：状态 ${e.phase}/${e.version ?? '—'}${e.ignored ? '（已忽略）' : ''} 该拨 ${want}，实拨 ${stage.notices[i]}`
      )
    }
  }
  return bad
}

// ---------------------------------------------------------------- 跑

async function main() {
  const mods = await buildModules()
  const { isNewer, parseVersion } = mods.version
  const { parseManifest, UpdateService } = mods.updateService
  if (!UpdateService) throw new Error('updateService 里没有 UpdateService')

  const asset = crypto.randomBytes(2 * 1024 * 1024)
  const sha = sha512(asset)
  const state = { requests: [], downloads: 0, manifest: '', asset }
  const server = await startServer(state)
  const base = `http://127.0.0.1:${server.address().port}`
  step(`本机那只「GitHub」在 ${base}，资产 ${asset.length} 字节`)

  // ------------------------------------------------------------ Q1 版本比较

  {
    const cases = [
      ['1.1.0', '1.0.0', true, '新版就是新版'],
      ['1.0.0', '1.0.0', false, '同版本不算新'],
      ['v1.0.1', '1.0.0', true, 'v 前缀忽略'],
      ['1.0', '1.0.0', false, '缺段按 0 补'],
      ['1.1', '1.0.0', true, '缺段按 0 补（另一头）'],
      ['1.1.0-beta', '1.1.0', false, '预发布版低于同号的正式版'],
      ['1.1.0', '1.1.0-beta', true, '正式版高于同号的预发布版'],
      ['1.0.0-alpha', '1.0.0-beta', false, '同为预发布版时按后缀字典序'],
      ['1.0.0', '0.9.9', true, '大版本跨过去'],
      ['1.0.0.1', '1.0.0', true, '多出来的段里有非零就更大'],
      ['1.0.0.0', '1.0.0', false, '多出来的段全是零就不算'],
      ['abc', '1.0.0', false, '认不出来一律不判为更新'],
      ['1.0.0', 'abc', false, '另一头认不出来也一样'],
      ['', '1.0.0', false, '空串'],
      ['1.0.0+build', '1.0.0', false, '不认的写法不当成新版']
    ]
    const bad = []
    for (const [cand, cur, want, why] of cases) {
      const got = isNewer(cand, cur)
      if (got !== want) bad.push(`isNewer(${JSON.stringify(cand)}, ${JSON.stringify(cur)}) 得 ${got}，该是 ${want}（${why}）`)
    }
    const parsed = parseVersion('1.1.0-beta')
    if (!parsed || parsed.pre !== 'beta' || parsed.nums.join('.') !== '1.1.0') {
      bad.push(`parseVersion('1.1.0-beta') 得 ${JSON.stringify(parsed)}`)
    }
    if (parseVersion('v1.0.1')?.pre !== null) bad.push('parseVersion 该把 v 前缀丢掉')
    check('Q1', `版本比较 ${cases.length} 条逐条对上（含预发布版比同号正式版低）`, bad)
  }

  // ------------------------------------------------------------ Q2 同版本

  {
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    const stage = makeStage(mods, { configDir, downloadDir, feedBase: base })
    state.manifest = manifestText('1.0.0', sha, asset.length)
    const s = await stage.service.check()
    const bad = []
    if (s.phase !== 'none') bad.push(`phase 是 ${s.phase}，该是 none`)
    if (s.version !== null) bad.push(`version 是 ${s.version}，该是 null`)
    if (!stage.notices.length) bad.push('setNoticeVisible 一次都没被调用')
    if (stage.notices.some((v) => v !== false)) bad.push(`拨成了 ${JSON.stringify(stage.notices)}，该全是 false`)
    bad.push(...noticePairs(stage))
    check('Q2', `源上就是当前版本（1.0.0）→ 判为「没有新版」，提示条一次都没被叫出来`, bad, {
      phase: s.phase,
      notices: stage.notices
    })
  }

  // ------------------------------------------------------------ Q3 有新版本

  const live = (() => {
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    return { downloadDir, stage: makeStage(mods, { configDir, downloadDir, feedBase: base }) }
  })()
  {
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const s = await live.stage.service.check()
    const bad = []
    if (s.phase !== 'available') bad.push(`phase 是 ${s.phase}，该是 available`)
    if (s.version !== '1.1.0') bad.push(`version 是 ${s.version}，该是 1.1.0`)
    if (s.ignored) bad.push('没忽略过，ignored 该是 false')
    if (live.stage.notices[live.stage.notices.length - 1] !== true) {
      bad.push(`最后一次拨条是 ${live.stage.notices[live.stage.notices.length - 1]}，该是 true`)
    }
    bad.push(...noticePairs(live.stage))
    check('Q3', '源上是 1.1.0 → 判为「有新版本」，提示条被叫出来', bad, {
      phase: s.phase,
      version: s.version,
      notices: live.stage.notices
    })
  }

  // ------------------------------------------------------------ Q4 下载与校验

  {
    const stage = live.stage
    const before = state.downloads
    const s = await stage.service.download()
    const target = path.join(live.downloadDir, assetName('1.1.0'))
    const bad = []
    if (s.phase !== 'ready') bad.push(`phase 是 ${s.phase}，该是 ready`)
    if (s.percent !== 100) bad.push(`percent 是 ${s.percent}，该是 100`)
    if (state.downloads - before !== 1) bad.push(`下载请求发了 ${state.downloads - before} 次，该是 1 次`)
    if (!fs.existsSync(target)) bad.push(`${target} 不在盘上`)
    else if (sha512(fs.readFileSync(target)) !== sha) bad.push('盘上那份文件的 sha512 与发布信息对不上')
    if (fs.existsSync(`${target}.part`)) bad.push('.part 还留在盘上（半截文件不该出现在这个目录里）')

    // 进度：只在整数百分比变化时发一次，且单调到头是 100
    const percents = stage.events.filter((e) => e.phase === 'downloading').map((e) => e.percent)
    if (percents.length > 101) bad.push(`进度广播了 ${percents.length} 次，最多 101 次`)
    if (percents[percents.length - 1] !== 100) bad.push(`最后一次进度是 ${percents[percents.length - 1]}，该是 100`)
    for (let i = 1; i < percents.length; i += 1) {
      if (percents[i] < percents[i - 1]) bad.push(`进度退回去了：${percents[i - 1]} → ${percents[i]}`)
    }
    bad.push(...noticePairs(stage))
    check('Q4', '下载 + 校验通过 → ready：文件在盘上、哈希对得上、没有 .part、进度不刷屏', bad, {
      phase: s.phase,
      percentBroadcasts: percents.length,
      lastPercents: percents.slice(-4)
    })
  }

  // ------------------------------------------------------------ Q5 校验不过

  {
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    const stage = makeStage(mods, { configDir, downloadDir, feedBase: base })
    const tampered = (sha[0] === 'A' ? 'B' : 'A') + sha.slice(1)
    state.manifest = manifestText('1.1.0', tampered, asset.length)
    await stage.service.check()
    const s = await stage.service.download()
    const target = path.join(downloadDir, assetName('1.1.0'))
    const bad = []
    if (s.phase !== 'error') bad.push(`phase 是 ${s.phase}，该是 error`)
    if (!s.message.includes('校验')) bad.push(`话是 ${JSON.stringify(s.message)}，该说清楚是校验不过`)
    if (fs.existsSync(target)) bad.push('校验不过的文件还留在盘上')
    if (fs.existsSync(`${target}.part`)) bad.push('.part 还留在盘上')
    if (stage.notices[stage.notices.length - 1] !== true) {
      bad.push('下载失败时提示条该留着（它要改口说失败并给一个去发布页的出口）')
    }
    bad.push(...noticePairs(stage))
    check('Q5', '发布信息里的 sha512 被改过 → error，且那份文件当场从盘上消失', bad, {
      phase: s.phase,
      message: s.message
    })
  }

  // ------------------------------------------------------------ Q6 网络不通（拒连）

  {
    const dead = await freePort()
    const configDir = tmpDir('config')
    const stage = makeStage(mods, { configDir, downloadDir: tmpDir('dl'), feedBase: `http://127.0.0.1:${dead}` })
    const s = await stage.service.check()
    const bad = []
    if (s.phase !== 'error') bad.push(`phase 是 ${s.phase}，该是 error`)
    if (s.version !== null) bad.push(`version 是 ${s.version}，网络不通时我们并不知道有没有新版`)
    if (!s.message) bad.push('没给一句给人看的原因')
    if (!stage.notices.length) bad.push('setNoticeVisible 一次都没被调用')
    if (stage.notices.some((v) => v !== false)) bad.push(`拨成了 ${JSON.stringify(stage.notices)}，该全是 false`)
    check('Q6', `源连不上（端口 ${dead} 关着）→ error、提示条一次都没被叫出来、异常没冒到进程上`, bad, {
      phase: s.phase,
      message: s.message
    })
  }

  // ------------------------------------------------------------ Q7 网络不通（挂着不回）

  {
    // 一个只接不答的服务器：路径不同——拒连是当场报错，挂着不回要走那个 15 秒的定时器
    const hang = http.createServer(() => {})
    await new Promise((resolve) => hang.listen(0, '127.0.0.1', resolve))
    const configDir = tmpDir('config')
    const stage = makeStage(mods, {
      configDir,
      downloadDir: tmpDir('dl'),
      feedBase: `http://127.0.0.1:${hang.address().port}`
    })
    const started = Date.now()
    const s = await stage.service.check()
    const took = Date.now() - started
    await new Promise((resolve) => hang.close(resolve))
    const bad = []
    if (s.phase !== 'error') bad.push(`phase 是 ${s.phase}，该是 error`)
    if (!/超时/.test(s.message)) bad.push(`话是 ${JSON.stringify(s.message)}，该说「连接超时」`)
    if (took < 10_000) bad.push(`只等了 ${took}ms 就放弃——不像是走满了那 15 秒的超时`)
    if (stage.notices.some((v) => v !== false)) bad.push('提示条被叫出来了')
    check('Q7', `源只接不答 → ${Math.round(took / 1000)} 秒后按超时收场（ClientRequest 没有 setTimeout，这个超时是自己挂的）`, bad, {
      phase: s.phase,
      message: s.message,
      ms: took
    })
  }

  // ------------------------------------------------------------ Q8 开关只管自动

  {
    const configDir = tmpDir('config')
    const stage = makeStage(mods, {
      configDir,
      downloadDir: tmpDir('dl'),
      feedBase: base,
      configure: (config) => config.set((c) => ({ ...c, update: { ...c.update, autoCheck: false } }))
    })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const before = state.requests.length
    const auto = await stage.service.check()
    const afterAuto = state.requests.length
    const downloadsBeforeManual = state.downloads
    const manual = await stage.service.check({ manual: true })
    const afterManual = state.requests.length
    const bad = []
    if (afterAuto !== before) bad.push(`关掉自动检查之后，check() 还是发了 ${afterAuto - before} 次请求`)
    if (auto.phase !== 'idle') bad.push(`自动那次的 phase 是 ${auto.phase}，该停在 idle`)
    if (state.downloads !== downloadsBeforeManual) {
      bad.push('自动那一次什么都没按，却把安装包下起来了（那 111MB 只能由用户发起）')
    }
    if (afterManual - afterAuto !== 1) {
      bad.push(`手动那次发了 ${afterManual - afterAuto} 次请求，该是 1 次——开关管的是自动，不是把这个功能删掉`)
    }
    // 手动查完就自己下：回来时状态已经是 downloading（下载由这一下带起来）
    if (manual.phase !== 'downloading') bad.push(`手动那次的 phase 是 ${manual.phase}，该是 downloading`)
    if (manual.pendingInstall) bad.push('只是查了一下，没有按过「更新并重启」，pendingInstall 不该是 true')
    check('Q8', '关掉「自动检查更新」→ 自动那次一个请求都没发（服务器计数为 0）；手动照发，且查完自己开始下', bad, {
      requestsAuto: afterAuto - before,
      requestsManual: afterManual - afterAuto,
      manualPhase: manual.phase
    })
  }

  // ------------------------------------------------------------ Q8b 手动查就自己下

  {
    // 一个干净现场：谁都没有调过 download()，只有 check({manual:true}) 这一下
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    const stage = makeStage(mods, { configDir, downloadDir, feedBase: base })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const downloadsBefore = state.downloads
    const s = await stage.service.check({ manual: true })
    const bad = []
    if (state.downloads - downloadsBefore !== 1) {
      bad.push(`手动查完之后的下载请求是 ${state.downloads - downloadsBefore} 次，该正好 1 次`)
    }
    // 回来的那一刻是 downloading（还没下完），下完之后自己变成 ready
    if (s.phase !== 'downloading') bad.push(`check() 回来时 phase 是 ${s.phase}，该是 downloading`)
    await stage.settled()
    if (stage.last().phase !== 'ready') bad.push(`下完之后 phase 是 ${stage.last().phase}，该是 ready`)
    const target = path.join(downloadDir, assetName('1.1.0'))
    if (!fs.existsSync(target)) bad.push('下完之后盘上没有那一份')
    // 没有按过「更新并重启」，因此**不许**起安装程序
    if (stage.spawns.length) bad.push('只查了一下就起了安装程序——「更新并重启」那一下才允许装')
    if (stage.quits()) bad.push('只查了一下就把进程退了')
    check('Q8b', '手动「检查更新」→ 没人按过下载，那一份自己下起来了；但**没有**自己装、自己重启', bad, {
      phaseOnReturn: s.phase,
      phaseAfter: stage.last().phase,
      downloads: state.downloads - downloadsBefore,
      spawns: stage.spawns.length
    })
  }

  // ------------------------------------------------------------ Q8c 下完自己装

  {
    // 「更新并重启」按在下载途中：这一下要一路走到装完（下完自己装、自己重启）
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    const stage = makeStage(mods, { configDir, downloadDir, feedBase: base })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const bad = []

    // 还没下、也没查过时按它：拒绝（也验一遍 available 之前的那道门）
    stage.service.install()
    if (stage.spawns.length) bad.push('idle 时就起了安装程序')

    const checked = await stage.service.check({ manual: true })
    if (checked.phase !== 'downloading') bad.push(`手动查完是 ${checked.phase}，该是 downloading`)
    stage.service.install() // 下载途中按的那一下
    if (!stage.service.getState().pendingInstall) bad.push('按过之后 pendingInstall 该是 true')
    const mid = stage.service.getState()
    if (mid.phase !== 'downloading') bad.push(`排队之后 phase 是 ${mid.phase}，该仍是 downloading`)
    if (stage.spawns.length) bad.push('还没下完就起了安装程序——那一下只是排队')

    await stage.settled()
    if (stage.spawns.length !== 1) bad.push(`下完之后起了 ${stage.spawns.length} 次安装程序，该是 1 次`)
    else {
      const got = stage.spawns[0]
      const want = path.join(downloadDir, assetName('1.1.0'))
      if (got.file !== want) bad.push(`起的是 ${got.file}，该是 ${want}`)
    }
    if (stage.quits() !== 1) bad.push(`quit 调了 ${stage.quits()} 次，该是 1 次`)
    check('Q8c', '下载途中按「更新并重启」→ 只排队不动手；下完自己起安装程序并退出', bad, {
      pendingInstall: mid.pendingInstall,
      spawns: stage.spawns.map((x) => path.basename(x.file)),
      quits: stage.quits()
    })
  }

  // ------------------------------------------------------------ Q8d 下载中被忽略

  {
    // 下载中按 ✕：那一份要真的中止掉，盘上不留半截文件，状态落回 available
    const configDir = tmpDir('config')
    const downloadDir = tmpDir('dl')
    const stage = makeStage(mods, { configDir, downloadDir, feedBase: base })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const bad = []

    await stage.service.check({ manual: true })
    if (stage.service.getState().phase !== 'downloading') bad.push('前提不成立：手动查完没有开始下')
    stage.service.install() // 先按一下「更新并重启」，看它会不会被忽略一起作废
    const s = stage.service.ignore('1.1.0')
    if (s.phase !== 'available') bad.push(`忽略之后 phase 是 ${s.phase}，该落回 available`)
    if (!s.ignored) bad.push('忽略之后 ignored 该是 true')
    if (s.pendingInstall) bad.push('忽略之后 pendingInstall 该作废——那一版已经不要了')
    if (s.version !== '1.1.0') bad.push(`version 是 ${s.version}，该留着（设置页要靠它显示「已忽略」）`)
    if (stage.notices[stage.notices.length - 1] !== false) bad.push('被忽略之后提示条该收掉')

    await stage.settled()
    // 被中止之后：不许写成「下载失败」（用户自己按的，不是网络出了问题），也不许装
    const end = stage.last()
    if (end.phase === 'error') bad.push(`中止被记成了下载失败（${end.message}）——那是用户自己按的`)
    if (stage.spawns.length) bad.push('已经不要那一版了，却还是把它装上了')
    if (stage.quits()) bad.push('已经不要那一版了，却还是把进程退了')
    const target = path.join(downloadDir, assetName('1.1.0'))
    if (fs.existsSync(`${target}.part`)) bad.push('.part 还留在盘上')
    if (fs.existsSync(target)) bad.push('中止之后那份文件却完整地留在盘上')
    // 撤销之后要能重新来一遍
    const undone = stage.service.ignore(null)
    if (undone.ignored) bad.push('撤销之后 ignored 该是 false')
    await stage.service.check({ manual: true })
    await stage.settled()
    if (stage.last().phase !== 'ready') bad.push(`撤销后重来一遍，最后是 ${stage.last().phase}，该是 ready`)
    check('Q8d', '下载中按 ✕ → 那一份真的被中止（不留 .part、不写成失败、也不装），撤销之后能重来', bad, {
      phaseAfterIgnore: s.phase,
      downloads: state.downloads,
      lastPhase: stage.last().phase
    })
  }


  // ------------------------------------------------------------ Q9 忽略

  {
    const configDir = tmpDir('config')
    const stage = makeStage(mods, {
      configDir,
      downloadDir: tmpDir('dl'),
      feedBase: base,
      configure: (config) =>
        config.set((c) => ({ ...c, update: { ...c.update, ignoredVersion: '1.1.0' } }))
    })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    const same = await stage.service.check()
    const bad = []
    if (same.phase !== 'available') bad.push(`被忽略的那一版 phase 是 ${same.phase}，该仍是 available（设置页看得见）`)
    if (!same.ignored) bad.push('ignored 该是 true')
    if (stage.notices[stage.notices.length - 1] !== false) bad.push('被忽略的那一版不该占版面')
    bad.push(...noticePairs(stage))

    state.manifest = manifestText('1.2.0', sha, asset.length)
    const next = await stage.service.check()
    if (next.version !== '1.2.0') bad.push(`下一版的 version 是 ${next.version}`)
    if (next.ignored) bad.push('下一版不该跟着被忽略')
    if (stage.notices[stage.notices.length - 1] !== true) bad.push('下一版该照常占版面')

    // 撤销
    const undone = stage.service.ignore(null)
    if (undone.ignored) bad.push('撤销之后 ignored 该是 false')
    if (stage.notices[stage.notices.length - 1] !== true) bad.push('撤销之后该占版面')
    // 落盘：换一个实例读同一个目录，读到的得是刚才写的那个。
    // 写盘是排队的（DebouncedWriter），所以读之前必须 flush——退出时走的是同一条路
    stage.service.ignore('1.2.0')
    stage.config.flush()
    const reread = new mods.configStore.ConfigStore(configDir).get().update.ignoredVersion
    if (reread !== '1.2.0') bad.push(`落盘的是 ${JSON.stringify(reread)}，该是 1.2.0`)
    check('Q9', '忽略只忽略这一版：被忽略的不占版面、下一版照常提示、撤销能回去、且落了盘', bad, {
      ignoredOnDisk: reread
    })
  }

  // ------------------------------------------------------------ Q10 安装的门槛

  {
    const bad = []
    const refused = []

    // ① 还没查过
    {
      const stage = makeStage(mods, {
        configDir: tmpDir('config'),
        downloadDir: tmpDir('dl'),
        feedBase: base
      })
      stage.service.install()
      refused.push(`idle → ${stage.service.getState().phase}`)
      if (stage.spawns.length) bad.push('idle 时就起了安装程序')
      if (stage.quits()) bad.push('idle 时就把进程退了')

      // ② 源上就是当前版本：没有任何东西可装
      state.manifest = manifestText('1.0.0', sha, asset.length)
      await stage.service.check()
      stage.service.install()
      refused.push(`none → ${stage.service.getState().phase}`)
      if (stage.service.getState().phase !== 'none') {
        bad.push(`同版本那一次 phase 是 ${stage.service.getState().phase}`)
      }
      if (stage.spawns.length) bad.push('none 时就起了安装程序')
    }

    // ③ 查都查不到（源连不上）：同样不许动
    {
      const dead = await freePort()
      const stage = makeStage(mods, {
        configDir: tmpDir('config'),
        downloadDir: tmpDir('dl'),
        feedBase: `http://127.0.0.1:${dead}`
      })
      await stage.service.check()
      stage.service.install()
      refused.push(`error → ${stage.service.getState().phase}`)
      if (stage.service.getState().phase !== 'error') {
        bad.push(`连不上那一次 phase 是 ${stage.service.getState().phase}`)
      }
      if (stage.spawns.length) bad.push('error 时就起了安装程序')
    }

    // ④ 有新版但盘上还没有：按下那一下**只排队**，当场不许装
    //    （下完自己装是另一条路，由 Q8c 单独问）
    {
      const stage = makeStage(mods, {
        configDir: tmpDir('config'),
        downloadDir: tmpDir('dl'),
        feedBase: base
      })
      state.manifest = manifestText('1.1.0', sha, asset.length)
      await stage.service.check()
      if (stage.service.getState().phase !== 'available') bad.push('前提不成立：这会儿该是 available')
      stage.service.install()
      const s = stage.service.getState()
      refused.push(`available → ${s.phase}`)
      if (!s.pendingInstall) bad.push('available 上按一下，pendingInstall 该记成 true（下完自己装）')
      if (s.phase === 'ready') bad.push('刚按下就变成 ready 了——盘上根本还没有那一份')
      if (stage.spawns.length) bad.push('还没下完就起了安装程序')
      if (stage.quits()) bad.push('还没下完就把进程退了')
    }

    // ⑤ 下完并通过校验：恰好一次，参数一枚不少
    const ready = (() => {
      const downloadDir = tmpDir('dl')
      return {
        downloadDir,
        stage: makeStage(mods, { configDir: tmpDir('config'), downloadDir, feedBase: base })
      }
    })()
    {
      const stage = ready.stage
      state.manifest = manifestText('1.1.0', sha, asset.length)
      await stage.service.check({ manual: true })
      await stage.settled()
      if (stage.service.getState().phase !== 'ready') {
        bad.push(`前提不成立：下完之后是 ${stage.service.getState().phase}，该是 ready`)
      }
      if (stage.spawns.length) bad.push('没人按过「更新并重启」，却自己装上了')

      const returned = stage.service.install()
      if (returned !== undefined) bad.push('install() 是同步的，不该有返回值')
      if (stage.spawns.length !== 1) bad.push(`ready 之后起了 ${stage.spawns.length} 次安装程序，该是 1 次`)
      else {
        const got = stage.spawns[0]
        const want = path.join(ready.downloadDir, assetName('1.1.0'))
        if (got.file !== want) bad.push(`起的是 ${got.file}，该是 ${want}`)
        // 三枚参数一枚都不能少：少了 --force-run，装完就没有人把应用叫回来
        const wantArgs = ['/S', '--updated', '--force-run']
        if (JSON.stringify(got.args) !== JSON.stringify(wantArgs)) {
          bad.push(`参数是 ${JSON.stringify(got.args)}，该逐字是 ${JSON.stringify(wantArgs)}`)
        }
        if (got.spawnOpts.detached !== true) bad.push('没 detach——安装程序会被 app.exit(0) 一起带走')
        if (got.spawnOpts.stdio !== 'ignore') bad.push(`stdio 是 ${got.spawnOpts.stdio}`)
      }
      if (stage.quits() !== 1) bad.push(`quit 调了 ${stage.quits()} 次，该是 1 次`)
    }
    check(
      'Q10',
      '没下完、没校验过就不许装（idle / none / error / available 各拒绝一次），'
        + 'ready 之后起一次静默安装程序（/S --updated --force-run）并退出',
      bad,
      {
        refused,
        spawn: ready.stage.spawns.map((s) => ({
          file: path.basename(s.file),
          args: s.args,
          detached: s.spawnOpts.detached
        })),
        quits: ready.stage.quits()
      }
    )
  }

  // ------------------------------------------------------------ Q11 下过的不重下

  {
    const stage = makeStage(mods, {
      configDir: tmpDir('config'),
      downloadDir: tmpDir('dl'),
      feedBase: base
    })
    state.manifest = manifestText('1.1.0', sha, asset.length)
    await stage.service.check({ manual: true })
    await stage.settled()
    const before = state.downloads
    const s = await stage.service.check()
    const bad = []
    if (s.phase !== 'ready') bad.push(`phase 是 ${s.phase}，该直接是 ready`)
    if (s.percent !== 100) bad.push(`percent 是 ${s.percent}`)
    if (state.downloads !== before) bad.push(`又下了一次（${state.downloads - before} 次请求）`)
    if (stage.spawns.length) bad.push('再查一次不该重装（没人按过「更新并重启」）')
    check('Q11', '已经下过且校验对得上的那一份会被认出来：再查一次直接 ready，不重下', bad, {
      phase: s.phase,
      extraDownloadRequests: state.downloads - before
    })
  }

  // ------------------------------------------------------------ Q12 真实的 latest.yml

  {
    const bad = []
    const file = path.join(ROOT, 'release', 'latest.yml')
    let parsed = null
    if (!fs.existsSync(file)) bad.push(`${file} 不在（先跑一次 npm run build:win）`)
    else parsed = parseManifest(fs.readFileSync(file, 'utf8'))
    if (fs.existsSync(file) && !parsed) bad.push('release/latest.yml 解析不出来')
    if (parsed) {
      if (!/^\d+\.\d+\.\d+$/.test(parsed.version)) bad.push(`version 是 ${JSON.stringify(parsed.version)}`)
      if (parsed.file.url !== assetName(parsed.version)) {
        bad.push(`url 是 ${parsed.file.url}，按版本号该是 ${assetName(parsed.version)}`)
      }
      if (!parsed.file.sha512) bad.push('sha512 是空的')
      const exe = path.join(ROOT, 'release', parsed.file.url)
      if (!fs.existsSync(exe)) bad.push(`${exe} 不在盘上`)
      else {
        const size = fs.statSync(exe).size
        if (size !== parsed.file.size) bad.push(`发布信息里的 size 是 ${parsed.file.size}，盘上那份是 ${size}`)
        if (sha512(fs.readFileSync(exe)) !== parsed.file.sha512) bad.push('发布信息里的 sha512 与盘上那份对不上')
      }
      if (isNewer(parsed.version, parsed.version)) bad.push('自己比自己被判成了更新')
    }
    check('Q12', '真的那份 release/latest.yml 解析得出来，且与盘上那个 exe 分毫不差', bad, parsed ?? undefined)
  }

  // ------------------------------------------------------------ Q13 真地址（--net）

  if (WANT_NET) {
    const configDir = tmpDir('config')
    const stage = makeStage(mods, {
      configDir,
      downloadDir: tmpDir('dl'),
      feedBase: mods.constants.UPDATE_FEED_BASE,
      currentVersion: '0.0.1'
    })
    step(`去真地址取一次：${mods.constants.UPDATE_FEED_BASE}`)
    const s = await stage.service.check()
    if (s.phase === 'error') {
      skip(
        'Q13',
        '真地址取回来的版本号（URL 拼得对不对，只有它能验）',
        `这次没走通：${s.message}。这台机器上 github.com 时通时不通——同一支探针连着跑，`
          + '见过 170ms 就回来的六次，也见过二十秒不回、代理解析报 DIRECT 的几分钟。'
          + '因此这一问红了未必是代码的问题，等网络稳的时候再跑一次。'
      )
    } else {
      const bad = []
      if (s.phase !== 'available') bad.push(`currentVersion 报 0.0.1 时 phase 是 ${s.phase}，该是 available`)
      if (!s.version) bad.push('没读到版本号')
      check('Q13', `真地址取回来的是 ${s.version}（URL 拼对了，且走的是系统代理）`, bad, {
        version: s.version,
        currentVersion: s.currentVersion
      })
    }
  } else {
    step('跳过真地址那一问（要跑加 --net）')
  }

  server.close()
}

/** 出错必须吵着退出。理由见 docs/spike-findings.md 的 Q30 */
process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场——看门狗把它收了')
  app.exit(1)
}, 180_000)

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
    clearTimeout(watchdog)
    app.exit(1)
    return
  }
  clearTimeout(watchdog)
  const skipped = results.filter((r) => r.ok === null).length
  const graded = results.length - skipped
  console.log(`\n${graded - failed}/${graded} 通过${skipped ? `（另 ${skipped} 问跳过）` : ''}`)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'update-check.json'),
    JSON.stringify({ results, at: new Date().toISOString() }, null, 2)
  )
  console.log('REPORT spike/out/update-check.json')
  app.exit(failed ? 1 : 0)
})
