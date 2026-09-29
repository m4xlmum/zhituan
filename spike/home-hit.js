/**
 * 起始页的命中测试：真去问「这一点上站的是谁」。
 *
 * 存在的理由：这一页此前所有的取证都是 `element.click()`——那是**直接调 DOM**，
 * 绕开了整条命中测试。于是「有东西盖在按钮上面」这一类毛病，探针一个都照不出来，
 * 而用户在真机上点的时候，点到的正是那个盖着的东西。
 *
 * `document.elementFromPoint()` 走的是真实命中测试（含 pointer-events、
 * z-index、覆盖层），因此它就是「用户这一下点到谁」这个问题的答案。
 * 对每一处可点的东西，问三件事：该是谁、点到的是谁、那一点上从上到下排着谁。
 *
 * 用法：
 *   npx electron spike/home-hit.js                     # 正文档区尺寸（960×540 的正文）
 *   npx electron spike/home-hit.js --width 1280 --height 720
 *   npx electron spike/home-hit.js --theme crt-green
 *   npx electron spike/home-hit.js --view grid          # 也要在网格那两档下问一遍
 *
 * `--view` 是**直接把起始状态设成那一档**（假桥的 ui.homeView），不是在页面上
 * 点出来——换档那一步的重新量算由 preview.js 的 --view 负责（它点的是真按钮）；
 * 这里要问的是另一件事：网格那两档里，行尾那两枚按钮、状态行那三枚排布键
 * 有没有被谁盖住。两档的 DOM 长得不一样，只量列表那一档是不够的。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const args = process.argv
const num = (flag, fallback) => {
  const i = args.indexOf(flag)
  const value = i >= 0 ? Number(args[i + 1]) : NaN
  return Number.isFinite(value) ? value : fallback
}

const WIDTH = num('--width', 960)
const HEIGHT = num('--height', 540)
const themeIndex = args.indexOf('--theme')
const THEME = themeIndex >= 0 ? args[themeIndex + 1] : null
const viewIndex = args.indexOf('--view')
const VIEW = viewIndex >= 0 ? args[viewIndex + 1] : 'list'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 一处可点的东西：名字 + 选择器。
 *
 * 栏目键与行是**逐个**问的，不按选择器只问第一个：一列里有六栏、十几行，
 * 而「只有某一行被盖住」这种事只会出现在其中一个位置上。
 */
const PROBE = `(() => {
  const describe = (el) => {
    if (!el) return null
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : []
    return { tag: el.tagName.toLowerCase(), cls, text: (el.textContent || '').trim().slice(0, 12) }
  }

  const targets = []
  const add = (name, el) => {
    if (el) targets.push({ name, el })
  }

  add('输入框', document.querySelector('.prompt .field input'))
  add('添加', document.querySelector('.bar .add'))
  document.querySelectorAll('.plates .plate').forEach((el) => {
    add('栏目:' + (el.dataset.plate || '?'), el)
  })
  document.querySelectorAll('.lines .line').forEach((el, i) => {
    add('行' + i + ':' + ((el.querySelector('.label') || {}).textContent || '').trim().slice(0, 8), el)
  })
  // 状态行右端那三枚排布键：列表 / 小图标 / 图标。它们就在状态行里，
  // 而状态行紧挨着「栏目线」与整片内容区的下沿——被谁盖住一点都不奇怪
  document.querySelectorAll('.status .views .view').forEach((el) => {
    add('排布:' + (el.dataset.view || '?'), el)
  })
  add('主题键', document.querySelector('.theme-menu .trigger'))

  const out = []
  for (const { name, el } of targets) {
    const r = el.getBoundingClientRect()
    const x = Math.round(r.x + r.width / 2)
    const y = Math.round(r.y + r.height / 2)
    const hit = document.elementFromPoint(x, y)
    const stack = document
      .elementsFromPoint(x, y)
      .slice(0, 4)
      .map(describe)
    /*
     * 判据：点到的东西必须是它自己、或者是它的后代。
     * 祖先不算——那正是「被盖住」的样子，也正是这一跑要找的东西。
     */
    const ok = hit === el || el.contains(hit)
    out.push({
      name,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      ok,
      hit: describe(hit),
      stack
    })
  }
  return out
})()`

/**
 * 假桥在模块作用域里同步问一次选项（`ipcRenderer.sendSync('preview:options')`），
 * 因此这个应答必须在开窗之前就挂好——晚一步，preload 拿不到任何东西，
 * 假桥建不出来，页面渲染出来的是一张空壳，而这一跑看起来只是「一处都点不到」。
 */
ipcMain.on('preview:options', (event) => {
  event.returnValue = {
    mode: 'default',
    maximized: false,
    theme: THEME ?? 'paper',
    openFile: null,
    homeView: VIEW
  }
})

/**
 * 行尾那两枚「编辑 / 移除」的命中测试。
 *
 * 它们平时是 display:none——鼠标停在那一行上才出现（起始页一行本来就窄，
 * 常驻两枚按钮会把「地址」那一格挤没）。因此这一遍要先把指针真挪到那一行上
 * （sendInputEvent 的 mouseMove 会走 Chromium 那一侧的命中测试，:hover 因此
 * 是真的），再问这一刻「按钮上站着的是谁」。
 *
 * 这一问比前一遍更要紧：这两枚按钮**盖在行的右端**，而那底下正是 `.open`
 * 那一整片可点区。要是 elementFromPoint 回来的是 `.open`，用户点「移除」时
 * 开的就是这个站点——比点不到更糟。按钮按 data-act 认，不按文字：
 * 文案随世界变（现代世界「编辑 / 移除」、终端世界 edit/del）。
 */
const HOVER_PROBE = `(() => {
  const describe = (el) => {
    if (!el) return null
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : []
    return { tag: el.tagName.toLowerCase(), cls, text: (el.textContent || '').trim().slice(0, 12) }
  }
  const out = []
  document.querySelectorAll('.lines .line').forEach((line, i) => {
    line.querySelectorAll('.acts .act').forEach((el) => {
      if (el.offsetParent === null) return
      const r = el.getBoundingClientRect()
      const x = Math.round(r.x + r.width / 2)
      const y = Math.round(r.y + r.height / 2)
      const hit = document.elementFromPoint(x, y)
      out.push({
        name: '行' + i + ':' + (el.dataset.act || '?'),
        act: el.dataset.act || null,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        ok: hit === el || el.contains(hit),
        hit: describe(hit),
        stack: document.elementsFromPoint(x, y).slice(0, 4).map(describe)
      })
    })
  })
  return out
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#1b1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  await win.loadFile(path.join(__dirname, '..', 'out', 'renderer', 'home.html'))
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await wait(1200)

  if (THEME) {
    /*
     * 换皮这一步其实**已经**由假桥做完了（上面 `preview:options` 里那个 theme），
     * 这里点菜单只是为了量一条真实路径：点得动、点完页面上真换了。
     *
     * 认 id 要取 `.chips` 那个子元素上的 `data-theme`——它挂在里面那一层色块上，
     * 不在 `.item` 自己身上。早先这里读的是 `el.dataset.theme`，读不到就退成
     * textContent，而那三行写的是说明文字（「磷绿P1 单色终端：……」），
     * 于是 `--theme crt-green` 永远匹配不上、每次都打印一行看着像故障的
     * `THEME_BAD`——探针自己认错了人，不是页面少了那套皮。
     */
    const openMenu = `(() => {
      const trigger = document.querySelector('.theme-menu .trigger')
      if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
    })()`
    await win.webContents.executeJavaScript(openMenu)
    await wait(300)
    const ids = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.theme-menu .panel .item')].map(
        (el) => el.querySelector('.chips')?.dataset.theme || ''
      )`
    )
    console.log(
      `THEMES ${JSON.stringify(ids)}（标记为当前的是第 ${
        (await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.theme-menu .panel .item')].findIndex((el) => el.classList.contains('on'))`
        )) + 1
      } 项，桥给的档是 ${THEME}）`
    )
    const at = ids.indexOf(THEME)
    if (at >= 0) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.theme-menu .panel .item')[${at}].click()`
      )
      await wait(500)
    } else {
      console.log(`THEME_BAD 界面上的主题里没有 ${THEME}`)
    }
  }

  const results = await win.webContents.executeJavaScript(PROBE)
  const bad = results.filter((r) => !r.ok)
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗'
    const hit = r.hit ? `${r.hit.tag}.${r.hit.cls.join('.')}` : 'null'
    console.log(`HIT ${mark} ${r.name} @${r.box.x},${r.box.y} ${r.box.w}×${r.box.h} → ${hit}`)
    if (!r.ok) {
      console.log(
        `    叠着：${r.stack.map((s) => (s ? `${s.tag}.${s.cls.join('.')}` : 'null')).join(' / ')}`
      )
    }
  }
  console.log(`HIT_BAD ${JSON.stringify(bad.map((r) => r.name))}`)

  /*
   * 真按一下。
   *
   * 命中测试说了「这一点上站着谁」，但没说过**真按下去界面接不接得住**。
   * 这里的每一下都走 Chromium 的输入通道（webContents.sendInputEvent），
   * 于是鼠标按下、松开、click 整套事件是真的，与用户那一下只差一个屏幕。
   * 记的是**页面收到的 click**（capture 阶段挂在 document 上，谁被点中都会记），
   * 以及栏目线自己变没变——后者是「换栏」这一步的直接后果。
   */
  await win.webContents.executeJavaScript(`(() => {
    window.__clicks = []
    document.addEventListener('click', (event) => {
      const el = event.target
      window.__clicks.push({
        tag: el && el.tagName ? el.tagName.toLowerCase() : null,
        cls: el && typeof el.className === 'string' ? el.className.trim() : null,
        text: (event.target && event.target.textContent || '').trim().slice(0, 10)
      })
    }, true)
  })()`)

  const press = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    await wait(60)
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await wait(60)
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await wait(300)
  }

  const atOf = (name) => {
    const r = results.find((x) => x.name === name)
    return r ? { x: r.box.x + Math.round(r.box.w / 2), y: r.box.y + Math.round(r.box.h / 2) } : null
  }

  const plateAt = atOf('栏目:quiz')
  if (plateAt) {
    await press(plateAt.x, plateAt.y)
    const state = await win.webContents.executeJavaScript(
      `JSON.stringify({
        点到的: window.__clicks,
        现在哪一栏: document.querySelector('.plate.on')?.dataset.plate ?? null
      })`
    )
    console.log(`PRESS 栏目:quiz @${plateAt.x},${plateAt.y} → ${state}`)
  }

  const rowAt = atOf('行2:起点中文网') || atOf(results.find((r) => r.name.startsWith('行'))?.name)
  if (rowAt) {
    await win.webContents.executeJavaScript('window.__clicks = []')
    await press(rowAt.x, rowAt.y)
    const state = await win.webContents.executeJavaScript(`JSON.stringify(window.__clicks)`)
    console.log(`PRESS 行 @${rowAt.x},${rowAt.y} → ${state}`)
  }

  // ---- 行尾那两枚按钮：先把指针挪上那一行，再问谁站在它们上面
  const hoverRow = results.find((r) => r.name.startsWith('行3')) ?? results.find((r) => r.name.startsWith('行'))
  let acts = []
  if (hoverRow) {
    const hx = hoverRow.box.x + hoverRow.box.w - 26
    const hy = hoverRow.box.y + Math.round(hoverRow.box.h / 2)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: hx, y: hy })
    await wait(250)
    acts = await win.webContents.executeJavaScript(HOVER_PROBE)
    for (const a of acts) {
      const mark = a.ok ? '✓' : '✗'
      const hit = a.hit ? `${a.hit.tag}.${a.hit.cls.join('.')}` : 'null'
      console.log(`ACT ${mark} ${a.name} @${a.box.x},${a.box.y} ${a.box.w}×${a.box.h} → ${hit}`)
      if (!a.ok) {
        console.log(
          `    叠着：${a.stack.map((s) => (s ? `${s.tag}.${s.cls.join('.')}` : 'null')).join(' / ')}`
        )
      }
    }
    console.log(`ACT_N ${acts.length}`)
    console.log(`ACT_BAD ${JSON.stringify(acts.filter((a) => !a.ok).map((a) => a.name))}`)
  }

  /*
   * 真按一下「编辑」。
   *
   * 命中测试说了那一点上站着谁，但没说按下去界面接不接得住——尤其这一枚：
   * 按错了开的是这个站点（`pick` 与 `editRow` 就在同一行的两个按钮上）。
   * 按完看两件事：编辑器开没开、这一下有没有**同时**把这个站点打开。
   */
  const editAct = acts.find((a) => a.ok && a.act === 'edit')
  if (editAct) {
    await win.webContents.executeJavaScript('window.__clicks = []')
    const ex = editAct.box.x + Math.round(editAct.box.w / 2)
    const ey = editAct.box.y + Math.round(editAct.box.h / 2)
    await press(ex, ey)
    const state = await win.webContents.executeJavaScript(`JSON.stringify({
      编辑器: document.querySelector('.site-editor .head')?.textContent.trim().replace(/\\s+/g, ' ') ?? null,
      点到的: window.__clicks
    })`)
    console.log(`PRESS 编辑 @${ex},${ey} → ${state}`)
  }

  console.log(`HIT_DONE`)

  app.exit(bad.length ? 1 : 0)
})

/*
 * 抛出去要看得见。
 *
 * 无头跑一遍看不见渲染进程的调试台，主进程这一侧若静悄悄地挂住，
 * 上面那些 HIT 一行都不会出现，而「一行都没有」看起来跟「一处都没问题」
 * 完全不一样，却同样没有结论。挂住一次已经吃过这个亏。
 */
process.on('unhandledRejection', (err) => {
  console.error(`HIT_ERROR ${err && err.stack ? err.stack : String(err)}`)
  app.exit(2)
})
