/**
 * 探针：正文区那一块地，**一点下去落到谁身上**——把用户日常那一串动作逐个走一遍，
 * 每走一步问一次。
 *
 * 用户报的是这一条：**起始页上点了没反应**——点行不开标签页、点栏目也不换栏，
 * 而顶栏与右栏的按钮照常好用。这两条合起来只可能是「正文区那一块被某个原生视图
 * 接走了」：views 之间的命中测试在原生那一侧，CSS 的 pointer-events 管不着
 * （docs/spike-findings.md Q19）。
 *
 * ## 判据是怎么定下来的
 *
 * 光有 Q19 那句话还不够：它说的是「指针只投给最上面那层」，没说**不画着的**
 * 那层算不算。这一条决定了结论，因此去源头查过：
 *
 *   - `View::setVisible(false)` → `views::View::SetVisible(false)`
 *     （electron/shell/browser/api/electron_api_view.cc:538）
 *   - 命中测试走 `View::GetEventHandlerForRect` → `ViewTargeterDelegate::TargetForRect`，
 *     那里面遍历孩子视图时有一条 `if (!child->GetVisible()) continue;`
 *     （chromium/ui/views/view_targeter_delegate.cc）
 *
 * 于是判据是干净的一句话：**正文区那一点的归属 = 矩形含这一点且画着的孩子里，
 * 层次最大的那个**。起始页在「起始页先建、访客标签后建」的次序里沉在最底下
 * （addChildView 是往上叠，见 spike/vieworder.js），但访客标签都不画着，
 * 因此那一点仍然归它——次序本身不是问题，这一跑要从别处找。
 *
 * ## 走的是他日常那一串
 *
 * 启动 → 恢复上次的标签 → 回起始页 → 收起再展开
 * → 光标贴到窗口边上再离开（界面层会被刻意抬上去，再让回来）→ 新建标签页
 * → 进设置再原路返回 → 最大化再还原 → 拖窗口 → 拖边框 → 网页全屏进出 → 藏进托盘
 * → 关标签页。**每走一步都问一次**：那一点是不是还归当时那一屏。
 *
 * ## 为什么这一跑把 autoCollapse 关掉
 *
 * 用户那份配置里它是开着的（`stealth.autoCollapse: true`），而这里必须关掉：
 * 自动收起要的是「真光标在窗口里待过」（`WindowLeaveWatcher.armed` 只在光标
 * 进过窗口之后才置上），而这一跑的窗口摆在所有显示器之外、从不显示，
 * 真光标**永远进不去**——它在这里只可能误触发。触发它的是拖动那一步：
 * 拖动按绝对算法跟着真光标走，窗口于是被拽到屏幕上的光标底下，光标就此进了窗口，
 * 随后 `hideDelayMs` 一到就收起。这一跑原先就摔在这儿：M14 起窗口已经是
 * `collapsed`，M15–M19 量的全是一扇收起的窗口（叠着的可见视图是空的），
 * 六条全红，而产品一点毛病都没有。
 *
 * 收起 / 展开这条路本身没被放过：M4、M7 直接叫 `controller.collapse()/expand()`，
 * 走的是同一条状态机，与这个开关无关。
 *
 * 会动次序的只有 `WindowController.syncChromeOrder`——它记着一个 `chromeOnTop`，
 * 而收起 / 展开 / 贴边 / 最大化这几条来回都会读它、也会改它。记着的值与场上的
 * 实情一旦说岔，界面层（整窗大的一层，正文区那一块在它上面是空档，点下去
 * 沉不到网页）就会一直压在上面：**整块正文都点不动，而顶栏与右栏照常**
 * ——正是用户报的那一条。因此这一跑盯的就是这条不变量。
 *
 * 只读私表的两处（探针的特权）：`tabs.tabs` / `tabs.activeId`、`controller.chromeOnTop`。
 *
 * 窗口摆在所有显示器之外、并且从不显示（show / showInactive 换成空操作）：
 * 用户说过改代码时不要弹窗。光标那一条由 `setEdgeHot` 直接驱动，不劳烦真光标。
 *
 * 跑法：npx electron spike/home-layer.js
 * 产出：终端一份 [Mn] 报告、spike/out/home-layer.json（有不变量破了就以非零码退出）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, screen, session, ipcMain } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

/** 把要用的几份 TS 各打成一包再 require。理由与 window-max.js 同：验真的，不验抄本 */
async function buildModules() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-layer-'))
  await esbuild.build({
    entryPoints: [
      path.join(ROOT, 'src', 'main', 'services', 'windowController.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'tabManager.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'configStore.ts'),
      path.join(ROOT, 'src', 'main', 'services', 'windowRegistry.ts')
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
    controller: require(at('main', 'services', 'windowController.cjs')),
    tabs: require(at('main', 'services', 'tabManager.cjs')),
    configStore: require(at('main', 'services', 'configStore.cjs')),
    registry: require(at('main', 'services', 'windowRegistry.cjs'))
  }
}

/** 一页本地网页，tag 用来在场上的几份文档里认出它 */
function writePage(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zhituan-layer-${tag}-`))
  const file = path.join(dir, 'page.html')
  fs.writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>${tag}</title><body style="margin:0">${tag}</body>`,
    'utf8'
  )
  return pathToFileURL(file).toString()
}

const watchdog = setTimeout(() => {
  console.error('[FAIL] 探针超时未收场——看门狗把它收了')
  app.exit(1)
}, 180_000)

process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})

app.whenReady().then(async () => {
  try {
    await main()
  } catch (error) {
    console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
    clearTimeout(watchdog)
    app.exit(1)
  }
})

async function main() {
  const mods = await buildModules()
  const { WindowController } = mods.controller
  const { TabManager } = mods.tabs
  const { ConfigStore } = mods.configStore
  const { WindowRegistry } = mods.registry

  // 「上次没关的那些标签」：两页本地网页，顺序与用户那份配置同（书在前、视频在后）
  const weread = writePage('weread')
  const douyin = writePage('douyin')

  const config = new ConfigStore(fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-layer-config-')))
  const displays = screen.getAllDisplays()
  config.set((c) => ({
    ...c,
    window: {
      ...c.window,
      // 摆在所有显示器之外，且从不显示。与 own-screens.js 同一手
      x: Math.min(...displays.map((d) => d.bounds.x)) - 1200,
      y: Math.min(...displays.map((d) => d.bounds.y)) - 900,
      // 与用户那份配置同档：1013×570
      width: 1013,
      height: 570
    },
    /*
     * 关掉自动收起：见文件头。用户那份配置里它是开着的，但这一跑的窗口
     * 停在屏幕外、真光标永远进不去，这个开关在这里只会在拖动那一步误触发
     * （拖动把窗口拽到光标底下 → 光标进了窗口 → 收起）。
     */
    stealth: { ...c.stealth, autoCollapse: false },
    ui: { ...c.ui, topBarOpen: true, railOpen: true },
    lastSession: { openUrls: [weread, douyin], activeIndex: 0 }
  }))

  const ses = session.fromPartition('zhituan-layer-probe')
  // 自家页面带着 preview-preload 进来，那份假桥要问主进程要一组「预览参数」
  ipcMain.on('preview:options', (event) => {
    event.returnValue = {
      mode: 'default',
      maximized: false,
      theme: 'paper',
      tabs: 0,
      bgAlpha: 1,
      ballIcon: 'book',
      ballFit: 'cover',
      ballImage: null
    }
  })

  let tabsRef = null
  const controller = new WindowController({
    config,
    registry: new WindowRegistry(),
    preloadPath: path.join(__dirname, 'preview-preload.js'),
    rendererUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).toString(),
    onVisibilityChange: (visible) => {
      tabsRef?.setBodyVisible(visible, config.get().stealth.muteMediaOnCollapse)
    },
    onLayoutChange: () => tabsRef?.layoutAll(),
    onStateChange: () => {},
    onLeavePageFullscreen: () => tabsRef?.exitPageFullscreen()
  })
  const tabs = new TabManager({
    getWindow: () => controller.getWindow(),
    getBodyRect: () => controller.getBodyRect(),
    getSession: () => ses,
    getPreloadPath: () => path.join(__dirname, 'preview-preload.js'),
    getConfig: () => config.get(),
    onStateChange: () => {},
    onNavigated: () => {},
    onViewAdded: () => controller.syncChromeOrder(true),
    onPageFullscreen: (active) => controller.setPageFullscreen(active)
  })
  tabsRef = tabs

  controller.create()
  const win = controller.getWindow()
  /*
   * 这一跑从不把窗口摆到屏幕上（用户要求过改代码时不要弹窗），于是
   * show / hide / isVisible 这一组由探针自己记账。
   *
   * 不记账不行：`isOnScreen()` 判的是 `win.isVisible()`，而真的那个**永远是 false**
   * （我们从没 show 过），于是 `toggleFromTray()` 两次都走「藏起来」那一支——
   * 第二次点托盘图标叫不回来，M17 起每一步量的都是一扇藏着的窗口（叠着的可见视图
   * 是空的，六条全红，而产品一点毛病都没有）。记账之后控制器那一套判断照旧是真的，
   * 假的只有「屏幕上到底有没有过这扇窗」这一件探针根本做不到的事。
   */
  let shown = true
  win.show = () => {
    shown = true
  }
  win.showInactive = () => {
    shown = true
  }
  win.hide = () => {
    shown = false
  }
  win.isVisible = () => shown
  const chrome = controller.getChromeView()

  // ------------------------------------------------------------ 认场上的视图

  const docOf = (view) => {
    try {
      const url = view.webContents.getURL()
      return url.startsWith('file:') ? url.split('/').pop().split('?')[0] : url
    } catch {
      return '(读不到)'
    }
  }
  const visibleOf = (view) => {
    try {
      return view.getVisible()
    } catch {
      return null
    }
  }
  const boundsOf = (view) => {
    try {
      const r = view.getBounds()
      return [r.x, r.y, r.width, r.height]
    } catch {
      return null
    }
  }
  const layers = () =>
    win.contentView.children.map((v, index) => ({
      层次: index,
      是界面层: v === chrome,
      文档: docOf(v),
      画着: visibleOf(v),
      矩形: boundsOf(v)
    }))

  /** 此刻画着的那一屏（自家两屏也在其中，「谁在上面」只有一份账） */
  const activeEntry = () => (tabs.activeId ? (tabs.tabs.get(tabs.activeId) ?? null) : null)

  /**
   * 某一**点**按原生那一侧的规矩归谁：矩形含这一点、**画着**的孩子里层次最大的那个。
   *
   * 不给点就问正文区正中间那一点——「正文能不能点」问的就是它。最大化那一档
   * 要问的却是别处（右上角那组控件所在的那一点），所以点可以给进来；给的若是
   * 一个函数就在**问的那一刻**取值（那一小块的位置本身就是最大化之后才有的）。
   */
  const whoTakesClicks = (at) => {
    const pt = typeof at === 'function' ? at() : at
    const body = controller.getBodyRect()
    const x = pt ? pt[0] : body.x + Math.floor(body.width / 2)
    const y = pt ? pt[1] : body.y + Math.floor(body.height / 2)
    const hits = win.contentView.children.filter((v) => {
      if (visibleOf(v) !== true) return false
      const r = boundsOf(v)
      return (
        r && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]
      )
    })
    return { 点: [x, y], 拿到的视图: hits[hits.length - 1] ?? null, 叠着的可见视图: hits.map(docOf) }
  }

  // ------------------------------------------------------------ 不变量

  const broken = []

  /**
   * 走一步，问一次。
   *
   * expect 是这一步结束时那一点**该**归谁：
   *   'page'   归此刻那一屏（他停在起始页上时，那一点就该是起始页）
   *   'chrome' 归界面层——**这是设计写明的代价**：光标贴在窗口边上时界面层被抬上去，
   *            整扇窗的点击都归它，好让左/下两条边的缩放手柄收得到按下；
   *            最大化时右上角那一组控件要看得见、点得到，界面层也得待在上面。
   *
   * at：这一步要问的是哪一点（不给就是正文区正中间）。界面层在最大化时只剩
   * 右上角一小块，正文正中间那一点根本不在它里面——问「那组控件能不能点」
   * 得把点给到那一小块上去。
   *
   * expect 给 **null** = 只记一笔、不断言：这一步所在的时刻**还没有那一屏**
   * 可比（M0 问在起始页出生之前，那时整扇窗只有界面层，它接走那一点是对的）。
   */
  const step = async (id, what, action, expect = 'page', at = null) => {
    await action()
    await delay(150)
    const who = whoTakesClicks(at)
    const want = expect === 'chrome' ? chrome : (activeEntry()?.view ?? null)
    const ok = who.拿到的视图 === want
    const detail = {
      chromeOnTop: controller.chromeOnTop,
      mode: controller.getMode(),
      最大化: controller.isMaximized(),
      停在哪: activeEntry() ? docOf(activeEntry().view) : null,
      点: who.点,
      那一点归谁: docOf(who.拿到的视图 ?? { webContents: { getURL: () => '(没人)' } }),
      该归谁:
        expect === null
          ? '(记一笔，不断言)'
          : expect === 'chrome'
            ? '界面层'
            : activeEntry()
              ? docOf(activeEntry().view)
              : '(没人)',
      叠着的可见视图: who.叠着的可见视图
    }
    if (expect !== null && !ok) broken.push({ id, what, detail })
    record(id, what, expect === null ? '记一笔' : ok ? '是' : '不是', detail)
  }

  // ------------------------------------------------------------ 真机启动那一条路

  controller.show()
  await delay(300)

  await step(
    'M0',
    '（底色）窗口刚起来、还什么都没有时：整扇窗只有界面层，那一点归它',
    async () => {},
    null
  )

  // ① 首页常驻：它是「回到起点」的落点，也是启动后的第一屏
  await step('M1', '启动建起始页之后，那一点归起始页吗', async () => {
    tabs.openHome()
    await delay(1200)
  })

  // ② 恢复上次的访客标签页（activate:false），③ 切到上次停的那一张
  await step('M2', '恢复上次那两个标签、并切到停着的那一张之后', async () => {
    for (const url of config.get().lastSession.openUrls) tabs.create({ url, activate: false })
    await delay(600)
    const list = tabs.list()
    const index = Math.min(config.get().lastSession.activeIndex, list.length - 1)
    if (list[index]) tabs.activate(list[index].id)
  })

  // ④ 点顶栏那颗「起始页」键：视图已经在场，于是只切显隐，不重建、也不抬次序
  await step('M3', '回起始页（点顶栏那颗键）之后，那一点归起始页吗', async () => {
    tabs.openHome()
  })

  // ⑤ 收起 → 展开（autoCollapse 开着，这是他的日常）
  await step('M4', '收起成球、再展开之后，那一点归起始页吗', async () => {
    controller.collapse()
    await delay(200)
    controller.expand()
  })

  // ⑥ 光标贴到窗口边上（界面层被抬上去），再离开（该让回来）
  await step('M5', '光标贴在窗口边上时（界面层抬上去，这是设计）', async () => {
    controller.setEdgeHot(true)
  }, 'chrome')

  await step('M6', '光标离开窗口边之后，界面层让回来了吗', async () => {
    controller.setEdgeHot(false)
  })

  /*
   * ⑦ 贴边与收起叠在一起。
   *
   * 这两个动作各自都会去读、去改 chromeOnTop：贴边把界面层抬上去，收起则让
   * 「窗口矩形」变成 null（不再盯边框）。两者的次序一换，记着的值就可能与
   * 场上的实情说岔——而说岔的后果是界面层永远压在上面，整块正文都点不动。
   */
  await step('M7', '先贴边再收起、再展开、最后离开边：一路之后界面层让回来了吗', async () => {
    controller.setEdgeHot(true)
    await delay(120)
    controller.collapse()
    await delay(200)
    controller.expand()
    await delay(120)
    controller.setEdgeHot(false)
  })

  // ⑧ 贴边的时候新建一张标签页（新视图永远加到最上层，界面层必须重抬一次）
  await step('M8', '贴着边新建一张网页标签时（界面层必须在最上面）', async () => {
    controller.setEdgeHot(true)
    await delay(120)
    tabs.create({ url: douyin, activate: true })
  }, 'chrome')

  await step('M9', '新建完再离开窗口边，界面层让回来了吗', async () => {
    controller.setEdgeHot(false)
  })

  // ⑨ 进设置、原路返回
  await step('M10', '进系统设置之后，那一点归设置页吗', async () => {
    tabs.openSettings()
    await delay(800)
  })

  await step('M11', '从设置原路返回之后，那一点归回去吗', async () => {
    tabs.leaveScreen()
  })

  // ⑩ 最大化 / 还原
  //
  // 最大化时界面层缩成右上角那一小块（只有还原键与那颗球），因此「那组控件
  // 能不能点」要问**那一小块里**的一点，不是正文正中间——正文正中间归网页，
  // 而那正是要的（整扇窗都该归网页）。两条一起问。
  const floatCentre = () => {
    const r = boundsOf(chrome)
    return [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)]
  }
  await step(
    'M12',
    '最大化时，右上角那组控件（还原键与球）那一点归界面层吗——窗口的出口就在那儿',
    async () => {
      controller.maximize()
    },
    'chrome',
    floatCentre
  )

  await step('M12b', '最大化时，正文区正中间那一点仍归网页吗', async () => {})

  await step('M13', '从最大化还原之后，那一点归网页吗', async () => {
    controller.restore()
  })

  /*
   * ⑪ 拖窗口与拖边框（都是他每天在做的）。
   *
   * 按下与松开必须落在**同一个同步块**里：这两个动作都是按绝对算法跟着真光标走
   * （每 DRAG_TICK_MS 挪一次窗口），而这一跑的窗口停在屏幕外——中间只要有一次
   * 滴答，它就会被拽到屏幕上的光标底下，之后每一步量的都是另一个位置的窗口。
   * 同一轮 JS 里做完，定时器根本没有机会跑（window-max.js 的 Q6 同一个理由）。
   */
  await step('M14', '拖一次窗口之后，那一点归网页吗', async () => {
    controller.beginDrag()
    controller.endDrag()
  })

  await step('M15', '拖一次左边框之后，那一点归网页吗', async () => {
    controller.beginResize('left')
    controller.endResize()
  })

  // ⑫ 网页全屏进出（视频里那枚键）
  await step('M16', '网页进全屏、再退出来之后，那一点归网页吗', async () => {
    controller.setPageFullscreen(true)
    await delay(300)
    controller.setPageFullscreen(false)
    await delay(300)
  })

  // ⑬ 藏进托盘再回来
  await step('M17', '藏进托盘、再回展开态之后，那一点归网页吗', async () => {
    controller.toggleFromTray()
    await delay(300)
    controller.toggleFromTray()
    await delay(300)
  })

  // ⑭ 关掉当前那张网页标签（关完会落到别处，落在哪儿都行，那一点都得归它）
  await step('M18', '关掉当前那张网页标签之后，那一点归那时那一屏吗', async () => {
    const entry = activeEntry()
    if (entry && entry.kind === 'guest') tabs.close(entry.id)
    await delay(300)
  })

  // ⑮ 回起始页收尾：走完一整串之后，起始页还点得动吗（这就是用户报的那一条）
  await step('M19', '走完这一整串之后，停在起始页上时那一点归起始页吗', async () => {
    tabs.openHome()
    await delay(400)
  })

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'home-layer.json')
  fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8')
  console.log(`WROTE ${out}`)
  console.log(`\n${results.length - broken.length}/${results.length} 通过`)
  for (const b of broken) console.log(`  破了 ${b.id}：${b.what}`)
  clearTimeout(watchdog)
  app.exit(broken.length ? 1 : 0)
}
