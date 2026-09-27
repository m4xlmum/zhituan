/**
 * 探针：系统设置里到底有哪些设置项，各自在哪一节、看不看得见。
 *
 * 起因是一句反馈：**「收起主界面是否暂停播放」这个开关，得能在设置界面里改才对**。
 * 而这个开关其实一直都在（隐蔽 → 收起时暂停音视频），也就是说问题不在有没有，
 * 而在**找不找得到**。既然如此，就把它当成一次版面事实来量：把五节里的每一个
 * `.field` 逐个列出来，连「在不在可视区里」一起报，而不是靠读一遍模板说「有」。
 *
 * 模板里有、页面上看不见是这里真出过的事（架构要点第 8 条那个混过第一轮自查的 ✕，
 * 就是祖先被隐藏、自己写着 `visibility: visible`）。因此每一项都走
 * `checkVisibility({ visibilityProperty: true })`——它把祖先算进去。
 *
 * 加载的是 `out/renderer/settings.html`（编译产物）配 `preview-preload.js`
 * 那份假桥：窗口不显示，界面上不弹任何东西（用户要求过改代码时不要弹窗）。
 *
 * 跑法：npx electron spike/settings-fields.js
 * 产出：终端一份清单、spike/out/settings-fields.json、
 *      spike/out/settings-stealth.png（隐蔽那一节的截图）
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 把当前那一节里的设置项逐条读出来 */
const COLLECT = `(() => {
  const nav = [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim())
  const content = document.querySelector('.content')
  const rows = [...document.querySelectorAll('section .field')].map((f) => {
    const label = f.querySelector('label')
    const control = f.querySelector('input, select, button, textarea')
    const box = f.getBoundingClientRect()
    return {
      label: label ? label.textContent.trim() : null,
      control: control ? control.tagName.toLowerCase() + (control.type ? ':' + control.type : '') : null,
      value: control && 'checked' in control ? control.checked : control ? control.value : null,
      // 祖先被隐藏也要算进去，见文件头
      drawn: f.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }),
      // 在可视区里没有：内容区可滚动，压在下边的项要滚一下才看得到
      inView: content ? box.top >= -1 && box.bottom <= content.clientHeight + 1 : null,
      dim: (f.querySelector('.dim') || {}).textContent?.trim() || null
    }
  })
  return { nav, rows }
})()`

/** 点某一节，然后读这一节 */
const goTo = `(label) => {
  const b = [...document.querySelectorAll('.nav-item')].find((x) => x.textContent.trim() === label)
  if (!b) return false
  b.click()
  return true
}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 960,
    height: 540,
    show: false,
    frame: false,
    backgroundColor: '#1b1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  await win.loadFile(path.join(ROOT, 'out', 'renderer', 'settings.html'))
  await wait(1200)

  const evaluate = (code, arg) => win.webContents.executeJavaScript(`(${code})(${arg === undefined ? '' : JSON.stringify(arg)})`)

  const first = await win.webContents.executeJavaScript(COLLECT)
  const nav = first.nav
  const sections = {}

  for (const label of nav) {
    const clicked = await evaluate(goTo, label)
    if (!clicked) {
      sections[label] = { error: '点不到这一节' }
      continue
    }
    // 等 Vue 换一帧
    await wait(250)
    sections[label] = await win.webContents.executeJavaScript(COLLECT)
  }

  // 回到隐蔽那一节，截一张——「用户打开这一节会看到什么」是本题的证据
  await evaluate(goTo, '隐蔽')
  await wait(400)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const png = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT_DIR, 'settings-stealth.png'), png.toPNG())

  // 清单：五节各自都有什么
  console.log('\n系统设置里有哪些项：')
  for (const label of nav) {
    const s = sections[label]
    if (s?.error) {
      console.log(`  【${label}】${s.error}`)
      continue
    }
    console.log(`  【${label}】`)
    for (const r of s.rows) {
      const marks = [r.drawn ? '' : '画不出来', r.inView === false ? '要滚动才看得到' : '']
        .filter(Boolean)
        .join(' / ')
      console.log(`    ${r.label}  <${r.control}>  ${r.value}${marks ? `  ⚠ ${marks}` : ''}`)
    }
  }

  const stealth = sections['隐蔽']
  // 按「暂停」匹配而不是整条标题：这一项的标题改过几次措辞，
  // 而这一问要盯的是**它在不在、点不点得动**，不是它当前叫什么
  const media = stealth?.rows?.find((r) => r.label?.includes('暂停'))

  /* 开关这一下要真的走一遍：页面 → 假桥的 patch，改完再读回来。
     假桥的 patch 与真的 ConfigStore 一样逐个子对象合并（见 preview-preload.js），
     因此这里读回来的 stealth 是完整的，能看出有没有把旁边的项带坏。 */
  const toggled = await win.webContents.executeJavaScript(`(async () => {
    const f = [...document.querySelectorAll('section .field')]
      .find((x) => x.querySelector('label')?.textContent.includes('暂停'))
    if (!f) return '找不到这一项'
    const box = f.querySelector('input[type=checkbox]')
    if (!box) return '这一项不是一个开关'
    const before = box.checked
    box.checked = !before
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    const cfg = await window.zhituan.config.get()
    return { before, boxNow: box.checked, saved: cfg.stealth.muteMediaOnCollapse, stealth: cfg.stealth }
  })()`)

  const checks = [
    {
      id: 'Q1',
      question: '这一项真的在设置界面里，而且是画出来的',
      ok: !!media && media.drawn === true,
      detail: media ?? '整份清单里没有这一项'
    },
    {
      id: 'Q2',
      question: '它落在「隐蔽」那一节，并且不用滚动就看得见',
      ok: !!media && media.inView === true,
      detail: { 所在节: '隐蔽', inView: media?.inView }
    },
    {
      id: 'Q3',
      question: '点一下真的改得动，而且改的是这一个字段（不碰旁边的）',
      ok:
        typeof toggled === 'object' &&
        toggled.saved === toggled.boxNow &&
        toggled.saved !== toggled.before,
      detail: toggled
    }
  ]

  console.log('')
  for (const c of checks) {
    console.log(`[${c.id}] ${c.ok ? '是' : '否'} — ${c.question}`)
    console.log(`      ${JSON.stringify(c.detail)}`)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, 'settings-fields.json')
  fs.writeFileSync(out, JSON.stringify({ nav, sections, checks }, null, 2), 'utf8')
  console.log(`\nWROTE ${out}`)
  console.log(`WROTE ${path.join(OUT_DIR, 'settings-stealth.png')}`)

  const bad = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - bad.length}/${checks.length} 通过`)
  win.destroy()
  app.exit(bad.length === 0 ? 0 : 1)
})
