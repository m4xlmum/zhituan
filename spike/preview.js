/**
 * 无头预览：把编译好的界面在一个不显示的窗口里渲染出来，
 * 截一张图、再导出若干元素的实测几何，用来核对版面。
 *
 * 存在的理由是「改界面的过程中不该一遍遍弹窗打扰用户」：一个 show:false
 * 的窗口既不会出现在屏幕上，也不会抢焦点，而 paintWhenInitiallyHidden
 * 默认为真，所以它照样会把界面画出来给 capturePage 抓。
 *
 * 用法：
 *   npx electron spike/preview.js                 # 顶栏展开
 *   npx electron spike/preview.js --no-topbar     # 顶栏藏起来，球浮在右上角
 *   npx electron spike/preview.js --collapsed     # 已收起（只剩一颗球）
 *   npx electron spike/preview.js --maximized     # 已最大化：右上角那一小块（还原键 + 球）
 *   npx electron spike/preview.js --maximized --width 960 --height 540 --desktop  # 放大看它在桌面上的样子
 *   npx electron spike/preview.js --width 480 --height 270   # 迷你档多大，标签条就得让位
 *   npx electron spike/preview.js --tabs 2        # 只留前 2 个标签页（标签条里只有网页）：放得下那一态
 *   npx electron spike/preview.js --click-tab 0   # 点第 0 格标签，再截一张
 *   npx electron spike/preview.js --click-rail-pause  # 点右栏那格开关，再截一张
 *   npx electron spike/preview.js --drag-opacity 40   # 拖「整体」透明度那条滑块到 40%，问松手之后它显示什么
 *   npx electron spike/preview.js --reader --drag-opacity 40 --drag-slider 阅读
 *   # 上一行：正文区底下摆一本本机 TXT，再拖右栏第三条滑块（见 --reader / --drag-slider）
 *   npx electron spike/preview.js --reader 40     # 同上，但第三条停在 40% 上照一张静止的图
 *   npx electron spike/preview.js --reader 40 --width 480 --height 270  # 迷你档：三条滑块塞不塞得下
 *   npx electron spike/preview.js --screen settings   # 界面停在系统设置上：标签条哪一格都不高亮
 *   npx electron spike/preview.js --screen home       # 停在起始页上：起始页那颗键亮着
 *   npx electron spike/preview.js --click-screen      # 用两颗键各进出一次，打一行 SCREEN 再截两张
 *   npx electron spike/preview.js --resize 1100x700   # 改窗口尺寸再截一张：让位与回归
 *   npx electron spike/preview.js --home          # 起始页
 *   npx electron spike/preview.js --home --themes # 起始页三套主题各截一张（走真实换主题那条路）
 *   npx electron spike/preview.js --home --plate local   # 起始页停在「离线阅读」那一栏
 *   npx electron spike/preview.js --home --click-plate video  # 照完「全部」再点一下「视频」栏
 *   npx electron spike/preview.js --home --plate local --open-file 斗破苍穹.txt,三体（全集）.pdf
 *   # 上一行：点一下「打开文件…」，让对话框返回这两本，看那一圈走完之后是什么样
 *   npx electron spike/preview.js --home --themes --body      # 按**正文区**的尺寸渲染（见 --body）
 *   npx electron spike/preview.js --home --body --plate local --width 480 --height 270  # 迷你档那一栏
 *   npx electron spike/preview.js --home --body --theme crt-green --width 480 --height 270
 *   npx electron spike/preview.js --home --body --address-open  # 地址栏展开时正文区更矮那一档
 *   npx electron spike/preview.js --home --reduced-motion      # 系统开着「减少动态效果」时的那一页
 *   npx electron spike/preview.js --home --no-reduced-motion   # 反过来：那一档里才量得到换栏的那条动画
 *   # --theme 只对起始页那一份文档有效（1.5.1 起）：界面、面板、设置页、PDF
 *   #   都不写主题，给了也只是把 ui.homeTheme 记进 JSON，画面一个像素都不变。
 *   #   唯一的例外是设置页自己那颗选中的按钮——它读的就是 ui.homeTheme。
 *   npx electron spike/preview.js --settings --theme crt-green   # 设置页：磷绿那颗亮着
 *   npx electron spike/preview.js --settings --width 560 --height 400
 *   # 注意：--home / --settings 看的是**那一份文档**自己长什么样；
 *   #      --screen home|settings 看的是**界面处在「停在它上面」那一态**（见上）
 *   npx electron spike/preview.js --bg 0.35        # 界面底板透明度：底板该淡，字不该淡
 *   npx electron spike/preview.js --notice 1.1.0    # 更新提示条：查到新版，点一下更新并重启
 *   npx electron spike/preview.js --notice 1.1.0 --notice-phase downloading --notice-percent 42
 *   npx electron spike/preview.js --notice 1.1.0 --notice-phase downloading --notice-pending
 *   npx electron spike/preview.js --notice 1.1.0 --notice-phase ready --theme night
 *   npx electron spike/preview.js --drag-probe     # 逐个位置按一下，问「这里按下去起的是拖动还是缩放」
 *   npx electron spike/preview.js --popover --bg 0.35   # 弹出面板也是另一份文档，同样要问一遍
 *   npx electron spike/preview.js --popover --kind tabs # 面板有五张，换一张看
 *   npx electron spike/preview.js --desktop        # 界面背后垫一层模拟桌面：截图用
 *   npx electron spike/preview.js --collapsed --alpha --out spike/out/readme   # 带透明通道的球
 *   npx electron spike/preview.js --collapsed --ball-icon cat   # 球面上画哪个图标
 *   npx electron spike/preview.js --collapsed --width 160 --height 160 --ball-zoom 4
 *   npx electron spike/preview.js --collapsed --ball-image a.png --ball-fit glyph
 * 产物写在 spike/out/ 下：preview-<名字>.png 与 preview-<名字>.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv
const has = (flag) => args.includes(flag)
/** --width 800 形式的取值 */
const num = (flag, fallback) => {
  const i = args.indexOf(flag)
  const value = i >= 0 ? Number(args[i + 1]) : NaN
  return Number.isFinite(value) ? value : fallback
}

const MODES = { '--no-topbar': 'no-topbar', '--collapsed': 'collapsed' }
const modeFlag = Object.keys(MODES).find(has)
const mode = modeFlag ? MODES[modeFlag] : 'default'

/**
 * --maximized：已最大化（铺满工作区）。
 *
 * 与 mode 正交——最大化时也可以收起成球，因此它单独一个开关，
 * 而不是并进 MODES 里去。
 */
const MAXIMIZED = has('--maximized')

const page = has('--home')
  ? 'home'
  : has('--settings')
    ? 'settings'
    : has('--popover')
      ? 'popover'
      : 'chrome'
const PAGE_FILE = {
  chrome: 'index.html',
  home: 'home.html',
  settings: 'settings.html',
  popover: 'popover.html'
}

/*
 * --maximized 时默认就按那一小块的尺寸开窗口（80×48，与主进程的 floatBox 同源）。
 *
 * 这一档是必需的，不是排版偏好：chrome 层在真实程序里最大化时**只剩这么一块**
 * （见 WindowController.chromeBounds），拿 960×540 去渲染它，量到的坐标就不是
 * 真机上的坐标了——「还原键与球各自落在哪几像素」正是这一档唯一要问的事。
 *
 * 想看图就自己给 --width / --height（配 --desktop 垫一层桌面），
 * 那时量的数字不再代表真机，只有截图能看。
 */
const WIDTH = num('--width', MAXIMIZED ? 80 : 960)
const HEIGHT = num('--height', MAXIMIZED ? 48 : 540)

/*
 * --reduced-motion：把系统的「减少动态效果」打开再渲染。
 *
 * 起始页换栏那一下有一个被安排过的动作，而它在减少动态效果下必须是**没有**的——
 * 这一条只写得出样式、量不到就等于没说。Chromium 有这个开关，
 * 于是这一档问的是：开着它时 .rows 上算出来的 animation-name 是不是 none。
 *
 * 注意**这台机器本来就开着**（默认那几跑量出来 reducedMotion 就是 true），
 * 所以真正要单独跑的是它的反面 --no-reduced-motion：只有那一档里
 * document.getAnimations() 才问得到那条动画的名字、时长与缓动。
 */
if (has('--reduced-motion')) app.commandLine.appendSwitch('force-prefers-reduced-motion')


/** 只留前 N 个标签页。标签条放不放得下是算出来的，得能用少几张试出「放得下」那一态 */
const TABS = num('--tabs', 0)
/**
 * --no-tabs：一张网页都没有（全关光了，正文区自己落回起始页）。
 *
 * 这是顶栏那个地址栏开关唯一一个字都不写的场合：它写的是一张网页，
 * 而没有网页就没有名字（见 TopBar 的 siteLabel），只剩一枚放大镜。
 */
const NO_TABS = has('--no-tabs')
/**
 * --screen home|settings：界面停在这一屏上。
 *
 * 与 --home / --settings 是两回事：那两个是把起始页 / 设置**那一份文档**单独
 * 渲染出来看它自己长什么样；这个是「界面处在『停在那一屏上』那一态」——
 * 正文区那块原生的视图在预览里根本不存在，要看的是界面这一圈：
 * 标签条哪一格都不高亮、那颗键自己亮着。顶栏那个地址栏开关**不跟着变**：
 * 它写的是一张网页，停在自家那两屏上时写的是「刚才那张」（见 TopBar 的 siteLabel）。
 *
 * 想看见「点进去 / 再点一次回来」这一步，用 --click-screen。
 */
const SCREEN = (() => {
  const i = args.indexOf('--screen')
  const value = i >= 0 ? args[i + 1] : null
  return value === 'home' || value === 'settings' ? value : null
})()
/**
 * --plate <id>：起始页停在某一栏上（all / video / reading / news / quiz / local）。
 *
 * 与 --screen 有一处不一样：那一屏是主进程记着的状态，因此 --screen 只要把它
 * 摆出来；而「停在哪一栏」是起始页自己的、不落盘的临时状态——真机上只有
 * 「点一下那一栏」这一条路走得到，这里也就照着点一下，不另开旁路摆状态。
 * （点的那一下会顺手清空输入框，与真机上一样。）
 *
 * id 名单从界面上读（见下面的 PLATE_IDS），不在脚本里另抄一份——抄一份就会
 * 在改名之后悄悄对不上，而那时照出来的图仍然叫那个名字。
 */
const PLATE = (() => {
  const i = args.indexOf('--plate')
  const value = i >= 0 ? args[i + 1] : null
  return value && !value.startsWith('--') ? value : null
})()

/**
 * --click-plate <id>：照完默认那一张（全部）之后点一下这一栏，再照一张。
 *
 * 与 --plate 的分工和 --screen / --click-screen 那一对一样：一个是「就在那一态
 * 上」，一个是「看着它切过去」。换栏这一步要验的不只是画面换了——输入框里的
 * 光标该留在原处、行列表该换成另一摊、状态行那个读数该跟着变一种说法
 * （「站点 16」摆在离线阅读那一栏里是句错话），三件事只有点一下才知道。
 */
const CLICK_PLATE = (() => {
  const i = args.indexOf('--click-plate')
  const value = i >= 0 ? args[i + 1] : null
  return value && !value.startsWith('--') ? value : null
})()

/**
 * --open-file 斗破苍穹.txt,三体（全集）.pdf：让「打开文件…」那次对话框返回这几本。
 *
 * 无头窗口里弹不出系统对话框，因此这一步由假桥代劳（见 preview-preload.js），
 * 而**点击是真的**：探针会去点「离线阅读」那一栏里那行「打开文件…」，
 * 界面照真机那条路走一遍——调到 files.openLocal、拿到文件名、重新取一遍历史。
 * 要看的是这一圈走完之后：页眉的标签数加一、「离线阅读」那一栏多出这本书，
 * 而且那一行印的是书名与 .TXT，不是一条路径。
 */
const OPEN_FILE = (() => {
  const i = args.indexOf('--open-file')
  const value = i >= 0 ? args[i + 1] : null
  return value && !value.startsWith('--') ? value : null
})()

/**
 * 这一次先停在哪一栏。
 *
 * 由 --plate 说了算；--open-file 没配 --plate 时就是「离线阅读」——那行
 * 「打开文件…」只长在那一栏里，因此用户不必再写一遍 --plate local。
 */
const PLATE_TARGET = PLATE ?? (OPEN_FILE ? 'local' : null)

/**
 * --bg 0.35：把界面底板透明度设成这个值。
 *
 * 这一项要验的是「底板淡、字不淡」这一对关系，光看截图说不清到底是哪一层淡了，
 * 因此 MEASURE 里除了截图还回报顶栏的实测底色与图标的实测字色。
 */
const BG = Math.min(1, Math.max(0, num('--bg', 1)))

/**
 * --reader [%]：正文区底下摆一本本机 TXT，也就是右栏第三条滑块（离线阅读正文的
 * 透明度）**唯一**活着的场合。
 *
 * 它与前两条不同：那两条任何时候都管得着（窗与界面一直在），这一条只在读一本
 * 本机文件时才有对象，因此界面把它按右栏那三格缩放的规矩禁掉了。于是这一条要
 * 两态各照一张：不给 --reader 的一张看「禁用」（灰点、读数照旧、鼠标不是手），
 * 给了的一张看「活着」。
 *
 * 数值那一半是后面可选的百分数（不给就是 100%），与 --bg 同一条规矩。
 */
const READER_ALPHA = (() => {
  const i = args.indexOf('--reader')
  if (i < 0) return null
  const next = args[i + 1]
  const value = next && !next.startsWith('--') ? Number(next) : NaN
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 1
})()
/**
 * --resize 1100x700：截完第一张之后把窗口改到这么大，再截一张。
 *
 * 标签条的让位是靠 ResizeObserver 重新量出来的，这条路只有真改窗口尺寸才走得到。
 */
const resize = (() => {
  const i = args.indexOf('--resize')
  if (i < 0) return null
  const m = /^(\d+)x(\d+)$/.exec(args[i + 1] ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null
})()
/** 主题id由起始页自己给出（见下面的 THEME_IDS），这里只需要一个能看得清的默认值 */
const theme = (() => {
  const i = args.indexOf('--theme')
  return i >= 0 ? args[i + 1] : 'paper'
})()

/**
 * --out spike/out/readme：换个输出目录。
 *
 * README 的截图走的就是这条：生成的图要进仓库，而 spike/out 是 gitignore 的，
 * 因此得能把原图写到别处去，再另行合成。
 */
const OUT = (() => {
  const i = args.indexOf('--out')
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : path.join(__dirname, 'out')
})()

/*
 * --body：按**正文区**的尺寸渲染这一页。
 *
 * 起始页在真机上不占整扇窗：界面层只画顶栏与右侧栏，这一页被摆在它们让出来的
 * 那个矩形里（`windowController.getBodyRect()`，算的是 geometry.ts 的 `body`）。
 * 因此「960×540 的窗口里这一页有多高」是一个**算出来的数**，不是窗口尺寸：
 * 默认档它是 912×496，迷你档 432×226。
 *
 * 不给这个开关时，这一页按整扇窗渲染。那对「这一份文档自己长什么样」是够的，
 * 但对**高度**不够用——比真机宽 48、高 44，而高度恰恰是这一页最紧的那一轴
 * （见 .impeccable/surfaces/home.md 的 Constraints）。按整扇窗量出来的行数
 * 比用户看到的多，换行点也偏后，于是一张「放得下」的图会是假的。
 *
 * 尺寸不在这里手抄：constants.ts 与 geometry.ts 各打成一包再 require，
 * body 矩形由应用自己那个 `computeLayout` 算出来（同 home-sections.js 的路子，
 * 理由也一样——抄一份的代价不会当场显形，只会在某次改了顶栏高度之后，
 * 让这里量出来的行数悄悄多一行）。
 *
 * --address-open：地址栏也展开着（默认是折叠的，见 README）。它再吃掉 34px 高度。
 * 这一档要的是**最紧的那个正文区**：地址栏开着时 960×540 只剩 912×462。
 */
const BODY = has('--body')
const ADDRESS_OPEN = has('--address-open')

/**
 * --desktop [light|dark|<css 颜色>]：在界面**背后**垫一层模拟桌面。
 *
 * 窗口是逐像素透明的，界面自己只画顶栏、右栏这些底板，其余部分是空的——
 * 平时那些位置透出来的是真实桌面，而在不显示的窗口里截图时，透出来的是
 * 窗口自己的 backgroundColor（一块深灰）。截图要给人看「它浮在桌面上是什么样」，
 * 就得把那层桌面**画进这份文档**（写在 html 上，界面自己的底板盖在它上面）。
 *
 * 垫进来的桌面是假的，但它只影响截图，不影响界面自己的任何判断：
 * 因此这个开关默认关着，验证版面时不要开。
 */
const DESKTOP_PRESETS = {
  light: 'radial-gradient(130% 100% at 18% 0%, #fbfcfd 0%, #eef1f5 45%, #dde2e8 100%)',
  dark: 'radial-gradient(130% 100% at 18% 0%, #232a31 0%, #161a1f 45%, #0a0d10 100%)'
}
const DESKTOP = (() => {
  const i = args.indexOf('--desktop')
  if (i < 0) return null
  const next = args[i + 1]
  const value = next && !next.startsWith('--') ? next : 'light'
  return DESKTOP_PRESETS[value] ?? value
})()

/**
 * --alpha：把窗口做成真正透明的，于是 capturePage 抓到的图**带透明通道**。
 *
 * 悬浮球那类产物需要这个：球是圆的，四周必须是透明的，才能贴到别的底上合成。
 * 不透明窗口抓出来的图，四周会被窗口自己的 backgroundColor 填满。
 */
const ALPHA = has('--alpha')

/** 面板有五种，默认看「站点」那一张；--kind uaZoom 能换一张看 */
const KIND = (() => {
  const i = args.indexOf('--kind')
  return i >= 0 && args[i + 1] ? args[i + 1] : 'sites'
})()

/**
 * --ball-image <路径>：把这张本地图当作「用户上传过的那张自定义图标」。
 *
 * 自定义图标是独立于配置的一份数据（userData/ball-icon.json），因此它也不能
 * 混进 --ball-icon 里当第九个内置图标看——两种落法（铺满球面 / 中央图案）
 * 要各自出一张图。
 */
const BALL_IMAGE = (() => {
  const i = args.indexOf('--ball-image')
  const next = i >= 0 ? args[i + 1] : null
  return next && !next.startsWith('--') ? path.resolve(next) : null
})()

/**
 * --ball-icon <id>：球面上画哪个图标（8 个内置之一，或 custom）。
 *
 * 没点名时：给了 --ball-image 就当作选中的是自定义那一张（这是最常见的用法），
 * 否则回到内置的默认值。--ball-icon custom 却**不给**图也是一档要看的：
 * 「选了自定义却没有图」必须退回内置图标，否则收起态的球会是一块空白——
 * 而那一刻球就是窗口的全部。
 */
const BALL_ICON = (() => {
  const i = args.indexOf('--ball-icon')
  const next = i >= 0 ? args[i + 1] : null
  if (next && !next.startsWith('--')) return next
  return BALL_IMAGE ? 'custom' : 'book'
})()

/** --ball-fit cover|glyph：自定义图标落进球里的方式，默认与配置默认值一致 */
const BALL_FIT = (() => {
  const i = args.indexOf('--ball-fit')
  const next = i >= 0 ? args[i + 1] : null
  return next === 'glyph' ? 'glyph' : 'cover'
})()

/**
 * --notice <版本>：摆出「查到这一版」那一态，于是提示条占一行。
 *
 * 形态由 --notice-phase 挑（available / downloading / ready / error），
 * 下载中那一条进度线要 --notice-percent 才有长度，失败那一句要 --notice-message，
 * 而「下载中且已经按过更新并重启」那一态要 --notice-pending（那句话会变长、
 * 按钮会收起来——两件事都只在那一态下看得出来）。
 * 不给 --notice 就一条提示都没有——那正是「没有新版本」的正常样子，
 * 因此它同时也是「平时窗口长什么样」的基准。
 */
const NOTICE = (() => {
  const i = args.indexOf('--notice')
  const next = i >= 0 ? args[i + 1] : null
  return next && !next.startsWith('--') ? next : null
})()

/** --notice-phase <阶段>：提示条摆出哪一态，默认「可以下载」 */
const NOTICE_PHASE = (() => {
  const value = (() => {
    const i = args.indexOf('--notice-phase')
    return i >= 0 ? args[i + 1] : null
  })()
  const known = ['available', 'downloading', 'ready', 'error']
  return known.includes(value) ? value : 'available'
})()

/** --notice-pending：「更新并重启」已经按过了（配 downloading 用才是它那个样子） */
const NOTICE_PENDING = args.includes('--notice-pending')

const NOTICE_PERCENT = Math.min(100, Math.max(0, num('--notice-percent', 42)))

const NOTICE_MESSAGE = (() => {
  const i = args.indexOf('--notice-message')
  const next = i >= 0 ? args[i + 1] : null
  return next && !next.startsWith('--') ? next : '网络不通'
})()

/**
 * --ball-zoom 4：把球面上的图形放大 4 倍再截图。
 *
 * 球上只有 18 像素画图标，八枚剪影长得成不成立，在 40×40 的截图里看不出来。
 * 放大只加一条 CSS：球的直径、窗口的尺寸、任何布局数字都不动，因此这张图
 * **不是真实比例**，它只回答一个问题——这几段路径本身立不立得住。
 * 图形放大后不会撑开窗口，所以窗口要自己给大一点：
 *   --collapsed --width 160 --height 160 --ball-zoom 4
 */
const BALL_ZOOM = Math.min(12, Math.max(1, num('--ball-zoom', 1)))

const outDir = OUT
const pagePath = path.join(__dirname, '..', 'out', 'renderer', PAGE_FILE[page])

/** 渲染进程上报的悬浮球矩形——「收起时窗口落到哪」全靠它 */
let reportedBallRect = null
ipcMain.on('preview:ballRect', (_event, rect) => {
  reportedBallRect = rect
})

/** 后缀 → MIME。与真实的那份校验一致：只认这四种，别的连球都进不去 */
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/**
 * 把 --ball-image 那张图读成 data URI。
 *
 * 读文件这件事放在主进程这侧：preload 里的 console 落在渲染进程的调试台里，
 * 无头跑一遍是看不见的——路径写错时会静悄悄退化成「没有图」，
 * 而那正好也是另一档要看的形态，于是错的那一档与对的那一档长得一模一样。
 * 因此这里读不出来就**直接退出**，并把话说清楚。
 */
const BALL_IMAGE_DATA = (() => {
  if (!BALL_IMAGE) return null
  const mime = MIME_BY_EXT[path.extname(BALL_IMAGE).toLowerCase()]
  if (!mime) {
    console.error(`PREVIEW --ball-image 只认 png/jpeg/webp：${BALL_IMAGE}`)
    app.exit(1)
    return null
  }
  try {
    const bytes = fs.readFileSync(BALL_IMAGE)
    console.log(`BALL_IMAGE ${BALL_IMAGE} (${Math.round(bytes.length / 1024)} KB)`)
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch (error) {
    console.error(`PREVIEW --ball-image 读不了：${BALL_IMAGE}（${error.message}）`)
    app.exit(1)
    return null
  }
})()

/**
 * 热门站点那张表，开窗前填好（见 presetSitesOf）。写在这里而不是 whenReady
 * 里面：下面是 `preview:options` 的应答，它在模块作用域里读这个变量，
 * 而 whenReady 里面那个作用域它看不见——写进去就是一条静默的 ReferenceError，
 * 应答整个不发，假桥拿不到任何选项。
 */
let PRESETS = []

ipcMain.on('preview:options', (event) => {
  event.returnValue = {
    mode,
    maximized: MAXIMIZED,
    theme,
    tabs: TABS,
    noTabs: NO_TABS,
    screen: SCREEN,
    bgAlpha: BG,
    reader: READER_ALPHA !== null,
    readerAlpha: READER_ALPHA ?? 1,
    ballIcon: BALL_ICON,
    ballFit: BALL_FIT,
    ballImage: BALL_IMAGE_DATA,
    notice: NOTICE,
    noticePhase: NOTICE_PHASE,
    noticePending: NOTICE_PENDING,
    noticePercent: NOTICE_PERCENT,
    noticeMessage: NOTICE_MESSAGE,
    openFile: OPEN_FILE,
    presets: PRESETS
  }
})

/**
 * 量一圈关键元素。数字比眼睛靠谱，而且能直接和主进程的版面常量对照。
 *
 * 这是**模板字符串**，整段原样发给渲染进程执行：里面写注释时别用反引号
 * （`.icon.on` 那种写法会把模板提前收尾，剩下半段变成主进程里跑的真代码，
 * 报出来的是「App threw an error during load」，跟渲染进程一点关系都没有）。
 */
const MEASURE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height)
    }
  }
  const rightGroup = document.querySelector('.topbar .group:last-of-type')
  /*
   * 标签条这一块。要看的是三件事：
   * 放不下时有没有让位（fits / fallback 存在与否）、让位后的标签条是不是
   * 真的离开了流（不在流里才不会把「+」与窗口操作挤走）、
   * 显示时最后一格有没有被啃掉一条边（lastTab 右端 ≤ zone 右端）。
   */
  const zone = box('.zone')
  const lastTab = box('.zone .tab:last-of-type')
  const tabs = [...document.querySelectorAll('.zone .tab')]
  return {
    window: { w: window.innerWidth, h: window.innerHeight },
    topbar: box('.topbar'),
    rail: box('.rail'),
    ball: box('.ball'),
    /*
     * 最大化时右上角那一小块里的两样东西（见 ChromeApp 的 .float）。
     *
     * 这一组是这一态**唯一**还能点的东西，因此它的位置不能靠截图判断
     * （球是半透明的、键压在网页上，差几像素看不出来）：
     * 还原键在左、球在右，两者竖直居中，球的右边缘离界面层右沿正好
     * BALL_MARGIN（4）——与「顶栏藏起来时球浮在右上角」是同一个落点，
     * 两态之间切换球不该跳。数字在这里，判据在窗口宽度上（80）。
     */
    floatBox: box('.float'),
    floatKey: box('.float-key'),
    /*
     * 球面上画的是什么。
     *
     * 「内置的某一枚」与「用户上传的那张」是两条完全不同的渲染路径
     * （一段 svg 路径 vs 一张图），截图看得出来，但「选了自定义却没有图」
     * 该退回内置、以及两种落法各自的实测尺寸，都要实测数字才说得清。
     * 内置那一枚还报第一段路径的开头几个字符：八个 id 各是一条不同的路径，
     * 拿它跟 BallGlyph 的表对一下，就知道传进来的 id 有没有真的生效。
     */
    ballGlyph: (() => {
      const el = document.querySelector('.ball')
      if (!el) return null
      const sizeOf = (node) => {
        const r = node.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      }
      const img = el.querySelector('img.custom')
      if (img) {
        return {
          kind: 'custom',
          fit: img.classList.contains('cover')
            ? 'cover'
            : img.classList.contains('glyph')
              ? 'glyph'
              : null,
          // 只报开头：整条 data URI 有几千字符，写进 JSON 没意义
          src: String(img.getAttribute('src') ?? '').slice(0, 24),
          box: sizeOf(img)
        }
      }
      const svg = el.querySelector('svg')
      if (!svg) return null
      return {
        kind: 'builtin',
        paths: svg.querySelectorAll('path').length,
        d0: (svg.querySelector('path')?.getAttribute('d') ?? '').slice(0, 20),
        box: sizeOf(svg)
      }
    })(),
    zone,
    stripFits: document.querySelector('.strip')?.dataset.fits ?? null,
    /*
     * 更新提示条。它是一条**占版面的行**：高度必须等于 NOTICE_H（30），
     * 上沿必须紧贴地址栏的下沿（地址栏折叠时就是顶栏的下沿）——差几像素
     * 就是网页被压住一条，或者提示条自己露在网页外面。
     *
     * 进度线单独量：它画在条的下沿之内，因此高度是 2、不与条的高度相加。
     * 还要报它的宽度，因为「进度是不是真的画出来了」只能这么问——
     * 2px 高的一条在缩过的截图上未必看得清。
     */
    notice: box('.notice-row'),
    noticeText: document.querySelector('.notice-text')?.textContent?.trim() ?? null,
    noticeProgress: (() => {
      const el = document.querySelector('.notice-progress')
      if (!el) return null
      const r = el.getBoundingClientRect()
      const row = el.parentElement.getBoundingClientRect()
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        // 右端离条的下沿有多远：0 说明它贴在底边上，而不是压在文字中间
        fromBottom: Math.round(row.bottom - r.bottom)
      }
    })(),
    /*
     * 缩放手柄的实测几何。它们**没有背景色**，截图上看不见，因此「画在哪、多大」
     * 只能这么问；而这几像素的位置正是「有没有抢走控件的点击」的全部依据。
     * 尺寸应当与 @shared/constants 的 RESIZE_EDGE / RESIZE_CORNER 一致（各 4 / 8）。
     */
    resizeHandles: [...document.querySelectorAll('[data-resize-handle]')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        edge: el.getAttribute('data-resize-handle'),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        cursor: getComputedStyle(el).cursor
      }
    }),
    // 逐格实测：左端、宽度，以及里面的文字有没有被省略号截掉
    tabBoxes: tabs.map((el) => {
      const r = el.getBoundingClientRect()
      const title = el.querySelector('.title')
      return {
        x: Math.round(r.x),
        w: Math.round(r.width),
        on: el.classList.contains('on'),
        glyph: el.querySelector('img') ? 'img' : el.querySelector('svg') ? 'svg' : 'dot',
        titleClipped: title ? title.scrollWidth > title.clientWidth : null,
        /*
         * 用 checkVisibility 而不是 getComputedStyle(...).visibility：
         * 后者只看这一格自己的值，祖先被隐藏它照样报 visible。
         * 实测踩过：让位时整条标签条是 hidden 的，可当前那一格的关闭键
         * 自己写着 visibility: visible，于是在下拉按钮旁边留下一个孤零零的 ✕，
         * 而这一项当时报的是 true —— 看不见的 bug 正是这么混过去的。
         */
        closeVisible: el.querySelector('.x')?.checkVisibility({ visibilityProperty: true }) ?? null
      }
    }),
    lastTab,
    // 超出容器右沿就是被啃了——这正是「放不下却没让位」的样子
    lastTabOverflow: lastTab && zone ? Math.round(lastTab.x + lastTab.w - (zone.x + zone.w)) : null,
    fallback: box('.fallback'),
    fallbackText: document.querySelector('.fallback .title')?.textContent?.trim() ?? null,
    fallbackCount: document.querySelector('.fallback .count')?.textContent?.trim() ?? null,
    plus: box('.zone > button.icon:not(.fallback)'),
    addressToggle: box('.address-toggle'),
    // 右侧那一组按钮，从左到右，用来核对顺序
    rightButtons: rightGroup
      ? [...rightGroup.children].map((el) => ({
          cls: el.className,
          title: el.getAttribute('title'),
          x: Math.round(el.getBoundingClientRect().x),
          w: Math.round(el.getBoundingClientRect().width)
        }))
      : null,
    /*
     * 顶栏那几个图标按钮的「亮没亮」。
     *
     * 手机与置顶是这一版新搬进来的两个，它们的高亮各有一处真值来源：
     * 手机跟着当前标签页的 uaMode，置顶跟着 config.window.alwaysOnTop。
     * 截图里那点淡淡的强调色背景看不出是「亮了」还是配色本来如此，
     * 因此连实测颜色一起报出来。
     */
    topIcons: [...document.querySelectorAll('.topbar .group:last-of-type > button')].map((el) => ({
      title: el.getAttribute('title'),
      on: el.classList.contains('on'),
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor
    })),
    // 右栏里都有哪些功能，按上下顺序——顶栏藏起来时它是唯一的功能入口
    railButtons: [...document.querySelectorAll('.rail button')].map(
      (el) => el.getAttribute('title') ?? el.className
    ),
    /*
     * 背景透明度要看的三件事，各问各的：
     *   alpha —— 界面根上的那个变量，滑块拉出来的原始值
     *   底板 —— 顶栏/右栏的实测底色，应当带上这个 alpha
     *   字   —— 图标与文字的实测颜色，必须是不带 alpha 的实色：
     *           拉到 0 也要看得见、点得到，否则就是把自己锁在外面
     */
    surfaces: (() => {
      const root = document.querySelector('.root')
      const bar = document.querySelector('.topbar') ?? document.querySelector('.rail')
      const inkEl = document.querySelector('.topbar .icon') ?? document.querySelector('.rail button')
      if (!bar) return null
      const s = getComputedStyle(bar)
      return {
        alpha: root ? getComputedStyle(root).getPropertyValue('--zhituan-alpha').trim() : null,
        bar: s.backgroundColor,
        // 顶栏的分隔线在下面，右栏的在左边
        hairline: bar.classList.contains('topbar') ? s.borderBottomColor : s.borderLeftColor,
        ink: inkEl ? getComputedStyle(inkEl).color : null
      }
    })(),
    /*
     * 两屏那两颗键各自的实测配色。
     *
     * 它们长什么样是**看不太出来的**：.icon.on 在纸白下是「淡蓝底 + 蓝字」，
     * 到了暗夜，那块淡底是 0.14 的蓝叠在近黑的栏上——同一套令牌，肉眼在小图上
     * 未必分得清「亮着」与「没亮」。而这两颗键现在各自代表一屏的进出口，
     * 亮灯就是「你正停在这一屏上」的唯一凭据，不能靠猜。
     * 于是把两份计算值都摆出来：亮着的那颗该是 accent 字 + accent-soft 底。
     */
    screenKeys: Object.fromEntries(
      [
        ['起始页', '.topbar button[aria-label="起始页"]'],
        ['设置', '.topbar button[aria-label="系统设置"]']
      ].map(([name, sel]) => {
        const el = document.querySelector(sel)
        if (!el) return [name, null]
        const s = getComputedStyle(el)
        return [
          name,
          { on: el.classList.contains('on'), color: s.color, background: s.backgroundColor }
        ]
      })
    ),
    /*
     * 地址栏开关上写着的那几个字。
     *
     * 它说的是**一张网页**，因此停在起始页 / 系统设置上时不该跟着变成那一屏的名字
     * （用户要求）：那两个词一出现，顶栏读起来就像多了一个叫「系统设置」的标签页。
     * 这一格是纯渲染结果——siteLabel 怎么算是 TopBar 的事，它画在屏幕上是什么
     * 只有量一遍才知道。迷你档里那一格是藏起来的（读回空串），因此要在 960 这一档问。
     */
    addressLabel: document.querySelector('.address-toggle .ellipsis')?.textContent?.trim() ?? null,
    /*
     * 右栏那三条透明度滑块，以及功能栈有没有被撑出滚动区。
     *
     * 这一栏陆续加过东西（去掉手机 / 置顶两个按钮、换进一条 56px 的滑块、
     * 又添了第三条「阅读」），净空是否够用是算出来的，得实测一遍：scrollHeight
     * 大于 clientHeight 就意味着有控件被裁在可视区外，那一栏的功能就点不到了。
     *
     * disabled 也要报：第三条只在读本机文件时活着，而「禁用」这件事在截图上
     * 只是那颗点变灰了一点，肉眼看不出它到底是真的 disabled，还是只画灰了
     * 却照样能拖——这一条正是最容易做假的地方。
     */
    sliders: [...document.querySelectorAll('.opacity')].map((el) => {
      const track = el.querySelector('input')
      return {
        label: el.querySelector('.label')?.textContent?.trim() ?? null,
        value: el.querySelector('.value')?.textContent?.trim() ?? null,
        min: track?.getAttribute('min') ?? null,
        max: track?.getAttribute('max') ?? null,
        disabled: track?.disabled ?? null,
        offClass: el.classList.contains('off'),
        /*
         * tooltip 长在 **input** 上（Slider 把整句话写在那一格），不在外框上。
         * 外框上那个 title 一直是 null——先前照外框读，读出来的是一列 null，
         * 看着像「三条都没写说明」，其实是一个读错了元素的读数。
         */
        hint: track?.getAttribute('title') ?? null,
        box: (() => {
          const r = el.getBoundingClientRect()
          return { y: Math.round(r.y), h: Math.round(r.height) }
        })(),
        track: track && (() => {
          const r = track.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })()
      }
    }),
    stackScroll: (() => {
      const el = document.querySelector('.rail .stack')
      if (!el) return null
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, overflow: el.scrollHeight - el.clientHeight }
    })(),
    bodySample: box('.rest')
  }
})()`

/** 起始页与系统设置的版面：看排版是否成立，以及主题有没有真的换掉颜色 */
const PAGE_MEASURE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const style = getComputedStyle(document.body)
  return {
    window: { w: window.innerWidth, h: window.innerHeight },
    theme: document.documentElement.dataset.theme ?? null,
    world: document.documentElement.dataset.world ?? null,
    colors: {
      ground: style.backgroundColor,
      text: style.color,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    },
    // 现代世界：行式列表。两套世界的四段划分逐段对齐，选的名也就一一对应
    modern: box('.modern'),
    wordmark: box('.wordmark'),
    prompt: box('.modern .prompt'),
    favicon: box('.modern .favicon'),
    lines: box('.modern .lines'),
    lineCount: document.querySelectorAll('.modern .line').length,
    firstLine: box('.modern .line'),
    resumeVerb: document.querySelector('.modern .line.resume .verb')?.textContent?.trim() ?? null,
    status: box('.modern .status'),
    // 终端世界：命令行
    term: box('.term'),
    termBar: box('.term .bar'),
    termPrompt: box('.term .prompt'),
    cursor: box('.term .cursor'),
    termLines: box('.term .lines'),
    termLineCount: document.querySelectorAll('.term .line').length,
    termFirstLine: box('.term .line'),
    termStatus: box('.term .status'),
    /*
     * 栏目线。当前那一栏与其余各栏的**字号对照**是这条线成不成立的判据，
     * 因此两边都量：只量当前栏看不出「它比其余大」这件事。
     */
    plates: box('.plates'),
    plateOn: document.querySelector('.plates .plate.on')?.dataset.plate ?? null,
    plateItems: [...document.querySelectorAll('.plates .plate')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        id: el.dataset.plate,
        text: el.textContent.trim(),
        on: el.classList.contains('on'),
        x: Math.round(r.x),
        w: Math.round(r.width),
        size: getComputedStyle(el).fontSize
      }
    }),
    /*
     * 栏目线放不放得下。--width 448 那一档问的就是这个：六栏要么缩字号、要么
     * 退回两字缩写，两者都量得出来（字号在上面那一项里，缩写看 text 有多长）。
     * gap 是末栏右端到这一页内容右边界还剩多少像素，负数就是顶出边了。
     */
    plateFit: (() => {
      const el = document.querySelector('.plates')
      if (!el) return null
      const root = document.querySelector('.modern, .term')
      const last = el.lastElementChild
      const pad = root ? parseFloat(getComputedStyle(root).paddingRight) : 0
      return {
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        gap:
          root && last
            ? Math.round(root.getBoundingClientRect().right - pad - last.getBoundingClientRect().right)
            : null
      }
    })(),
    /** 根上挂着哪几个类：narrow 在不在，就是「六栏有没有退回两字缩写」 */
    rootClass: document.querySelector('.modern, .term')?.className ?? null,
    /** 状态行左端那个读数：它数的是什么、用哪种写法，随栏目与搜索状态变 */
    stat: document.querySelector('.status .stat')?.textContent?.trim() ?? null,
    /** 「离线阅读」那一栏的格式说明。别的栏目没有它 */
    note: document.querySelector('.note')?.textContent?.trim() ?? null,
    noteBox: box('.note'),
    /*
     * 收尾线：这一栏到底了才画的那一条短线。它该在的时候在、不该在的时候不在，
     * 都得量——「行被上限截掉时不许画」是它唯一一条规矩。
     */
    endRule: box('.lines .end'),
    /*
     * 换栏那一下被安排成了什么。
     *
     * fill: both 让动画跑完之后仍留在 document.getAnimations() 里，因此这里问得到
     * 它的名字、时长与缓动。「这一页有过一个被安排的动作」也是量出来的，
     * 不是从样式表里读出来的。
     */
    animations: document.getAnimations().map((a) => {
      const frames = a.effect?.getKeyframes?.() ?? []
      return {
        name: a.animationName ?? null,
        ms: Math.round(a.effect?.getTiming?.().duration ?? 0),
        /*
         * 缓动读**第一帧**上那一条，不读 getTiming().easing。
         *
         * animation-timing-function 是被折进关键帧里的：时序上的 easing 一直
         * 留在默认的 linear 上，真正那条曲线挂在每一帧的 easing 上。读错了地方，
         * cubic-bezier(0.16, 1, 0.3, 1) 就会印成 linear——于是「这条曲线是不是
         * 已经被改回 ease」永远量不出来。
         */
        easing: frames[0]?.easing ?? a.effect?.getTiming?.().easing ?? null,
        // 关键帧的节点位置：只有 from/to 两点就是一步落定，没有中间站
        offsets: frames.map((k) => k.offset),
        state: a.playState
      }
    }),
    /** 这一跑里「减少动态效果」开着没有（--reduced-motion 那一档） */
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    /*
     * 这一页上**哪个元素**被选中了。
     *
     * 起始页的键盘整副都挂在输入行上（onInputKeydown 是它唯一的 keydown），
     * 因此没选中输入行 = 状态行第一帧就写着的那句「← → 换板块」是句空话。
     * 这件事从代码上看不出来（组件里写着 focus()，什么时候调才是关键），
     * 从截图上也看不出——所以直接问 DOM：该是 input。
     * 没有元素被选中时 activeElement 是 body，打印出来就是 body。
     */
    active: (() => {
      const el = document.activeElement
      if (!el) return null
      const cls = String(el.className ?? '')
        .split(' ')
        .filter(Boolean)[0]
      return cls ? el.tagName.toLowerCase() + '.' + cls : el.tagName.toLowerCase()
    })(),
    /** 行首那一格画的是什么：本机文件挂文件图标，站点要么图标要么首字母 */
    lineFavicons: [...document.querySelectorAll('.lines .line .favicon')].map((el) =>
      el.querySelector('svg') ? 'file' : el.querySelector('img') ? 'img' : 'initial'
    ),
    /*
     * 行里露出来的文字若带着本机路径就是漏了。起始页上本机文件只该显示
     * 文件名（斗破苍穹.txt）；显示成 C:\Users\…\斗破苍穹.txt 就等于把用户
     * 机器上的目录结构摆进了截图，这一项必须为空。
     *
     * 判据只认**本机路径**那三种写法，不认「有斜杠」：
     *   file: 开头、盘符（C:\ 或 C:/）、UNC（\\主机\共享）。
     * 先前写的是 /[\\/]|file:/，那一条把每一行网页站点的 title
     * （https://www.zhihu.com/…）全当成了泄漏——它量的是「有没有斜杠」，
     * 而这一项要问的是「有没有本机路径」，两件事。宽出来的那些命中会
     * 把真的泄漏淹掉，因此这里收紧到本机路径本身。
     */
    pathLeaks: (() => {
      const local = /(^|[\s"'(])file:|\b[a-zA-Z]:[\\/]|\\\\[^\s\\/]/
      return [...document.querySelectorAll('.lines .line')]
        .map((el) => {
          const label = el.querySelector('.label')?.textContent ?? ''
          const host = el.querySelector('.host')?.textContent ?? ''
          return label + ' ' + host
        })
        .filter((text) => local.test(text))
    })(),
    /*
     * 同一件事的另一半：**属性**里的路径。
     *
     * 上一轮漏掉的正是这一处——行上的文字是干净的，可那一行还挂着一个
     * :title，悬停时浏览器把整条 file:///C:/Users/… 弹在屏幕上。只量文字
     * 量不到它，因此这一项单列：凡是 page 上任何元素带的 title 里出现
     * 本机路径（同上那三种写法），这里就得列出来。
     */
    titleLeaks: [...document.querySelectorAll('[title]')]
      .map((el) => el.getAttribute('title') ?? '')
      .filter((text) => /(^|[\s"'(])file:|\b[a-zA-Z]:[\\/]|\\\\[^\s\\/]/.test(text)),
    /*
     * 展示字到底有没有用上。
     *
     * 自带的那份字读不到时（子集不全、路径写错、CSP 挡掉），页面不会报错，
     * 只会静默回落到 --font-display 那一串里的下一个——从截图上几乎看不出来。
     * 因此这里问四件事：
     *   faces   文档手上的那几份字叫什么、什么状态（error 就是没读上）
     *   loaded  有没有一份「我们那份」真的读进来了——这是最硬的一条
     *   covers  check() 认不认栏目线上这些字。**这一条弱**：按规范，家族压根
     *           不存在时 check() 也返回 true（没有字需要加载），所以它单独
     *           不能证明什么，只用来排除「声明了但子集缺字」
     *   widths  同一个词在「我们那份」与两个兜底字体下各有多宽——
     *           **相等就是没换上**：换上了一个字面，宽度就不会一样
     *
     * widths 量的是**拉丁词**而不是汉字。汉字在任何一个中文字体里都是 1em
     * 见方（26px 的「纸团」在哪一份字下都是 104px），拿它比宽窄问不出
     * 任何事——上一轮量出三个 104 就是这么来的。拉丁字母的宽度逐字不同，
     * 衬线那份与两个兜底才会分开。
     */
    fontFaces: [...document.fonts].map((f) => ({
      family: f.family,
      weight: f.weight,
      status: f.status
    })),
    displayLoaded: [...document.fonts].some(
      (f) => f.family === 'Zhituan Display Serif' && f.status === 'loaded'
    ),
    displayVar: getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim(),
    displayCovers: document.fonts.check('26px "Zhituan Display Serif"', '全部离线阅读'),
    displayWidths: (() => {
      const probe = document.createElement('span')
      probe.style.cssText =
        'position:absolute;visibility:hidden;white-space:nowrap;font-size:26px;font-weight:400'
      document.body.appendChild(probe)
      const width = (text, family) => {
        probe.textContent = text
        probe.style.fontFamily = family
        return Math.round(probe.getBoundingClientRect().width * 10) / 10
      }
      const result = {
        latin: {
          ours: width('Zhituan', '"Zhituan Display Serif"'),
          fallbackSerif: width('Zhituan', '"SimSun"'),
          fallbackSans: width('Zhituan', '"Microsoft YaHei"')
        },
        /* 汉字这一行只为留个底：三份必然相等，见上面那段说明 */
        han: {
          ours: width('纸团', '"Zhituan Display Serif"'),
          fallbackSerif: width('纸团', '"SimSun"'),
          fallbackSans: width('纸团', '"Microsoft YaHei"')
        }
      }
      probe.remove()
      return result
    })(),
    // 两套世界共用的主题选择器
    themeMenu: box('.theme-menu'),
    themePanel: box('.theme-menu .panel'),
    themeItem: box('.theme-menu .item'),
    sidebar: box('.sidebar'),
    content: box('.content')
  }
})()`

/**
 * 弹出面板：另一扇窗、另一份文档。
 *
 * 要问的和 chrome 一样——底板淡了、字没淡——但这里还得额外确认一件事：
 * 面板窗口是透明的，底板真的淡下去时露出来的是桌面，因此这一份的数据
 * 必须来自面板这份文档自己写下的 --zhituan-alpha，而不是从别处继承来的。
 */
const POPOVER_MEASURE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const panel = document.querySelector('.panel')
  const row = document.querySelector('.row')
  const s = panel ? getComputedStyle(panel) : null
  return {
    window: { w: window.innerWidth, h: window.innerHeight },
    kind: new URLSearchParams(location.search).get('kind'),
    // 写在文档根上的那个值；空串就意味着这份文档没写，底板不会淡
    alpha: document.documentElement.style.getPropertyValue('--zhituan-alpha'),
    panel: box('.panel'),
    panelBg: s?.backgroundColor ?? null,
    panelBorder: s?.borderTopColor ?? null,
    rowColor: row ? getComputedStyle(row).color : null,
    rowCount: document.querySelectorAll('.row').length,
    title: document.querySelector('.title')?.textContent?.trim() ?? null
  }
})()`

/** 从主题选择器里取全部主题 id——不在脚本里另抄一份名单 */const THEME_IDS = `[...document.querySelectorAll('.theme-menu .panel .chips')].map((el) => el.dataset.theme)`

/**
 * 从栏目线上取全部栏目 id——同样不另抄一份名单。
 *
 * --plate 要的是「界面上真有这一栏」，而不是「脚本里写着有这个 id」：
 * 后者在栏目改名之后照样通过，照出来的却是一张没换过的图。
 */
const PLATE_IDS = `[...document.querySelectorAll('.plates .plate')].map((el) => el.dataset.plate)`

/**
 * 读一遍栏目线此刻的样子：停在哪一栏、状态行的读数、说明条、以及底下那几行
 * 各自印着什么（动词 / 名称 / 右端）。
 *
 * 换栏这件事从截图上只看得出一半——「读数说的是不是这一栏在数的东西」、
 * 「本机文件那几行右端印的是不是 .TXT 而不是域名」这类事，得把文字读出来。
 */
const READ_PLATES = `(() => {
  const root = document.querySelector('.modern, .term')
  return {
    在哪一栏: document.querySelector('.plates .plate.on')?.dataset.plate ?? null,
    缩成两字: root ? root.classList.contains('narrow') : null,
    读数: document.querySelector('.status .stat')?.textContent?.trim() ?? null,
    说明: document.querySelector('.note')?.textContent?.trim() ?? null,
    行: [...document.querySelectorAll('.lines .line')].map((el) => ({
      动词: el.querySelector('.verb')?.textContent?.trim() ?? '',
      名称: el.querySelector('.label')?.textContent?.trim() ?? '',
      右端: el.querySelector('.host')?.textContent?.trim() ?? '',
      本机文件: !!el.querySelector('.favicon svg')
    }))
  }
})()`

/**
 * 此刻正在跑的那几条动画。换栏那一下是不是真的动了，只有**点完之后马上问**
 * 才答得出来——那两条都是 180ms，等 400ms 再读，`document.getAnimations()`
 * 已经空了，于是「什么都没有」会被读成「它没动」。
 *
 * 与 measured.animations 问的是同一件事，只是时机不同：那一份是在页面已经安定
 * 下来之后读的，回答的是「这一页被安排过什么」；这一份回答的是「刚刚那一下动了没有」。
 */
const RUNNING_ANIMATIONS = `document.getAnimations().map((a) => ({
  name: a.animationName ?? null,
  ms: Math.round(a.effect?.getTiming?.().duration ?? 0),
  easing: (a.effect?.getKeyframes?.() ?? [])[0]?.easing ?? null,
  state: a.playState
}))`

/**
 * 拖动探针：在一组**有名有姓**的位置上按一下再松开，问这一下起没起拖动。
 *
 * 这是这一版里最容易悄悄坏掉的一环：上一版整条顶栏与右栏都被 no-drag 的子元素
 * 铺满，于是只剩悬浮球拖得动——而这件事从代码上看不出来，截图上也看不出。
 * 判据不问代码，问界面自己：在目标点上派发一个会冒泡的 pointerdown、再派发
 * pointerup，然后读假桥里的拖动计数（dragLog，只存在于 spike 的假桥里）。
 *
 * 用合成的 PointerEvent 而不是 webContents.sendInputEvent：后者走真实输入通道，
 * 会把鼠标真的按下去并抢走焦点，而这具窗口是隐藏的，落点也说不清楚。
 * 合成事件的 setPointerCapture 会抛 NotFoundError——界面自己兜住了（见
 * useWindowDrag 里的 try），不影响这里要问的问题。
 *
 * 合成事件不会合成出 click，因此按在按钮上的那些点没有副作用；悬浮球那一下会
 * 走到「收起」上，而假桥里收起是空操作，界面也不会因此换形。
 */
const DRAG_PROBE = `(() => {
  const boxOf = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null
  const centerOf = (sel) => {
    const r = boxOf(sel)
    return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null
  }

  const bar = boxOf('.topbar')
  const rail = boxOf('.rail')
  /*
   * 顶栏里现在有三组 .group，第一组是「两屏的键」（起始页 / 设置）而不是导航。
   * 因此导航那一组按内容认，不按次序认——次序是会变的，而「后退」这枚键跟着导航走。
   */
  const screens = boxOf('.topbar .group:has(button[aria-label="系统设置"])')
  const nav = boxOf('.topbar .group:has(button[title="后退"])')
  const items = [...document.querySelectorAll('.rail .stack .item')]
  const firstItem = items[0]?.getBoundingClientRect() ?? null
  const railMidX = rail ? Math.round(rail.x + rail.width / 2) : 0
  const W = window.innerWidth
  const H = window.innerHeight

  /*
   * 第三项是「这一点应当起的是哪一种手势」：
   *   'resize:<边名>' —— 缩放手柄，且报上来的边名必须是这一个（拖东边报成西边，
   *                       窗口就朝反方向长，而那种错光看截图看不出来）
   *   省略           —— 其余一律**不该**起缩放：手柄若画大了，第一个被抢走点击的
   *                       就是这些控件，而界面上看不出来
   */
  const POINTS = [
    /*
     * 顶栏自己的左端留白。取 bar.x + 6 而不是 +3：最外那 4px 归**缩放手柄**
     * （窗口左边缘的手柄是通高的，顶栏这一段也在它里面），从 4 往里才是
     * 顶栏那 8px 内边距剩下的部分，那里按下去应当还是拖窗口。
     */
    ['顶栏左端留白', bar ? { x: Math.round(bar.x + 6), y: Math.round(bar.y + bar.height / 2) } : null],
    /*
     * 两屏那两颗键（起始页 / 设置）与导航组之间新留出的一道组间距。
     * 它按「组间距」设计，也就是一处可拖的空白；两颗键挨得只有 1px，
     * 而这 4px 要是也归了控件，顶栏左边就没有拖动面了。
     */
    ['顶栏：两屏键与导航组之间的缝', screens ? { x: Math.round(screens.right + 2), y: Math.round(bar.y + bar.height / 2) } : null],
    ['顶栏：导航组与地址栏之间的缝', nav ? { x: Math.round(nav.right + 2), y: Math.round(bar.y + bar.height / 2) } : null],
    ['顶栏：标签条右侧的空白（.rest）', centerOf('.zone > .rest')],
    ['顶栏：第一格标签（控件，不该拖）', centerOf('.zone .tab')],
    ['顶栏：地址栏开关（控件，不该拖）', centerOf('.address-toggle')],
    /*
     * 两屏那两颗键。它们原先一在左上、一在右栏栏底，现在并排摆在最左：
     * 两枚都是控件（按下去是进 / 出那一屏，不是拖窗口），而它们与导航组
     * 只隔一道组间距——这一条量的是「那 4px 的缝没被谁吃掉」。
     */
    ['顶栏：起始页（控件，不该拖）', centerOf('.topbar button[aria-label="起始页"]')],
    ['顶栏：设置（控件，不该拖）', centerOf('.topbar button[aria-label="系统设置"]')],
    ['顶栏：手机（控件，不该拖）', centerOf('.topbar button[title*="手机"]')],
    ['顶栏：置顶（控件，不该拖）', centerOf('.topbar button[title*="置顶"]')],
    /*
     * 最大化那一枚与左右邻居只隔 28px（按钮就是 28px 宽），而它紧贴着右上角——
     * 8×8 的角手柄会不会啃掉它右下角那几像素，只能靠这个点问出来。
     */
    ['顶栏：最大化（控件，不该拖）', centerOf('.topbar button[title*="最大化"]')],
    ['顶栏：最小化（控件，不该拖）', centerOf('.topbar button[title*="最小化"]')],
    ['顶栏：悬浮球（它自己就是拖动面）', centerOf('.ball')],
    /*
     * 更新提示条。整行都是拖动面（与顶栏、地址栏同一套规则：按在按钮上是操作，
     * 按在别处都是拖窗口），因此文字那一点应当起拖动，两枚按钮则不应当。
     * 不给 --notice 时这一行根本不存在，三条都报「这一点算不出来」——
     * 那不是错，因此不计进 bad。
     */
    ['更新提示条：文字（拖动面）', centerOf('.notice-text')],
    ['更新提示条：主按钮（控件，不该拖）', centerOf('.notice-btn.primary')],
    ['更新提示条：忽略（控件，不该拖）', centerOf('.notice-btn.icon')],
    /*
     * 右栏顶端留白。顶栏藏起来时这一栏顶到 y=0，而那最上 4px 归**上边缘**的
     * 缩放手柄（那条手柄是通宽的），纵坐标因此至少要从 6 起；
     * 顶栏展开时 rail.y 本来就是 44，rail.y + 2 已经够。
     */
    ['右栏顶端留白', rail ? { x: Math.round(rail.x + 2), y: Math.max(6, Math.round(rail.y + 2)) } : null],
    ['右栏：两个功能格之间的缝', firstItem ? { x: railMidX, y: Math.round(firstItem.bottom + 1) } : null],
    ['右栏：分隔线', centerOf('.rail .sep')],
    ['右栏：收起时暂停（控件，不该拖）', centerOf('.rail button[title*="收起时暂停"]')],
    ['右栏：滑块的小字（不该拖）', centerOf('.rail .opacity .label')],
    ['右栏：滑块的轨道（控件，不该拖）', centerOf('.rail .opacity input')],

    // 四条边与四个角的中点各按一下：起缩放，且边名要对得上
    ['上边缘', { x: Math.round(W / 2), y: 1 }, 'resize:n'],
    ['右边缘', { x: W - 2, y: Math.round(H / 2) }, 'resize:e'],
    ['左上角', { x: 1, y: 1 }, 'resize:nw'],
    ['右上角', { x: W - 1, y: 1 }, 'resize:ne'],
    ['右下角', { x: W - 1, y: H - 1 }, 'resize:se'],
    /*
     * 下边缘与左边缘在**真机上**归网页：正文矩形从 x=0 起、下沿到窗口底，
     * 而网页是叠在界面之上的原生视图，界面在这两处收不到指针事件。
     * 这一格要等「把界面提到网页之上」那套机制落地之后才真正可用
     * （见 WindowController.setChromeOnTop）。此处只能验手柄本身在不在，
     * 名字里写清楚，免得把这一格当成「真机上也能拖」。
     */
    ['下边缘（真机归网页）', { x: Math.round(W / 2), y: H - 1 }, 'resize:s'],
    ['左边缘（真机归网页）', { x: 1, y: Math.round(H / 2) }, 'resize:w'],
    ['左下角（真机归网页）', { x: 1, y: H - 1 }, 'resize:sw']
  ]

  const results = []
  /*
   * 收起态（窗口就是一颗球）**不画**手柄，那时没有「边缘」可言。
   * 探针的点是按展开态列出来的，因此这里按实际有没有手柄来定判据：
   * 没有手柄时，那些点全部变成「不该起缩放」——收起态若还能拖出缩放，
   * 球就会在光标下被拉成一块方的。
   */
  const handles = document.querySelectorAll('[data-resize-handle]').length
  for (const [name, p, want] of POINTS) {
    const expect = handles > 0 ? (want ?? null) : null
    if (!p) {
      results.push({ name, at: null, hit: null, started: null, resized: null, why: '这一点算不出来' })
      continue
    }
    const hit = document.elementFromPoint(p.x, p.y)
    if (!hit) {
      results.push({ name, at: p, hit: null, started: null, resized: null, why: '这一点上没有元素' })
      continue
    }
    const classes = typeof hit.className === 'string' ? hit.className.trim().split(/\\s+/).filter(Boolean) : []
    const dragBefore = window.zhituan.win.dragLog().starts
    const resizeBefore = window.zhituan.win.resizeLog()
    const base = {
      bubbles: true, cancelable: true, composed: true,
      button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y
    }
    hit.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }))
    hit.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
    const log = window.zhituan.win.resizeLog()
    const started = window.zhituan.win.dragLog().starts > dragBefore
    const resized = log.starts > resizeBefore.starts
    // 报上来的边名：这一点若起了缩放，就是最后一次记下的那一个
    const edge = resized ? log.edges[log.edges.length - 1] : null
    const ok = expect ? resized && edge === expect.slice('resize:'.length) : !resized
    results.push({
      name,
      at: p,
      hit: hit.tagName.toLowerCase() + classes.map((c) => '.' + c).join(''),
      started,
      resized,
      edge,
      want: expect,
      ok
    })
  }

  /*
   * 收尾对账：每个点都按下去又松开了，起停次数应当相等。
   * starts > ends 意味着有一次拖动没被收掉——那正是「窗口黏在光标上」的前身，
   * 界面给这类漏网准备了四道兜底（松手、窗口失焦、页面失焦、下一次按下重新锚定），
   * 而这里能把它查出来。缩放的两条路（开始 / 结束）同此。
   */
  const log = window.zhituan.win.dragLog()
  const rlog = window.zhituan.win.resizeLog()
  return {
    points: results,
    handles,
    starts: log.starts,
    ends: log.ends,
    balanced: log.starts === log.ends,
    resizeStarts: rlog.starts,
    resizeEnds: rlog.ends,
    resizeBalanced: rlog.starts === rlog.ends,
    // 手势判对的那些点：一条条按名字列出来，「哪些对哪些不对」一眼看得出
    bad: results.filter((p) => p.ok === false).map((p) => p.name)
  }
})()`


const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 这一页在真机上拿到的那块矩形有多大（见上面 --body 的说明）。
 *
 * 把 constants.ts 与 geometry.ts 各打成一包再 require，用应用自己的
 * `computeLayout` 算——所以这里回答的是「真机会给它多大」，不是「我猜多大」。
 * 临时目录用完就删：require 已经把文件读进内存了，之后删掉不影响。
 */
async function bodyRectOf(width, height) {
  const ROOT = path.join(__dirname, '..')
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-body-'))
  try {
    await esbuild.build({
      entryPoints: [
        path.join(ROOT, 'src', 'shared', 'constants.ts'),
        path.join(ROOT, 'src', 'main', 'services', 'geometry.ts')
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
    const K = require(path.join(outdir, 'shared', 'constants.cjs'))
    const { computeLayout } = require(path.join(outdir, 'main', 'services', 'geometry.cjs'))
    return computeLayout(width, height, K.TOP_BAR_H, ADDRESS_OPEN ? K.ADDRESS_H : 0, 0, K.RAIL_W).body
  } finally {
    try {
      fs.rmSync(outdir, { recursive: true, force: true })
    } catch {
      // 临时目录删不掉不影响结论
    }
  }
}

/**
 * 热门站点那一列（弹出面板的「热门站点」一节）。
 *
 * 真机上这条桥回的就是 `PRESET_SITES` 本身（`registerDataIpc.ts` 把那张表
 * 原样递出去），而假桥原先回的是空数组——于是面板里「热门站点」这个标题
 * 底下一条都没有，下半截空着。那不是设计成这样的留白，是假数据没给。
 *
 * 表从 presets.ts 打出来，不在这儿另抄一份：抄本会走样，而走样的方式恰好是
 * 「探针里那十几个站点名和产品里的对不上」，看图的看不出来。
 */
async function presetSitesOf() {
  const ROOT = path.join(__dirname, '..')
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhituan-presets-'))
  try {
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'src', 'shared', 'presets.ts')],
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
    return require(path.join(outdir, 'shared', 'presets.cjs')).PRESET_SITES
  } finally {
    try {
      fs.rmSync(outdir, { recursive: true, force: true })
    } catch {
      // 临时目录删不掉不影响结论
    }
  }
}

app.whenReady().then(async () => {
  /*
   * 真正开窗的那对尺寸。
   *
   * 不给 --body 时就是 --width / --height（这一份文档自己占满整扇窗）；
   * 给了就换成正文区——这一页在真机上的视口是什么样，窗口就开成什么样，
   * 于是下面量出来的每一行、每一次换行，都是用户会看到的那一份。
   */
  const rect = BODY ? await bodyRectOf(WIDTH, HEIGHT) : null
  /*
   * 只有弹出面板会经假桥读这张表（起始页是直接 import 的），因此只在那一页
   * 打一次包——每跑都打一次没必要，而这一跑是为了看图，不是量时间。
   * 赋给的是模块级那个变量：`preview:options` 的应答在模块作用域里读它。
   */
  PRESETS = page === 'popover' ? await presetSitesOf() : []
  const viewW = rect ? rect.width : WIDTH
  const viewH = rect ? rect.height : HEIGHT
  if (rect) {
    console.log(
      `BODY 窗口 ${WIDTH}×${HEIGHT}${ADDRESS_OPEN ? '（地址栏展开）' : '（地址栏折叠）'} → 正文区 ${viewW}×${viewH}`
    )
  }

  const win = new BrowserWindow({
    width: viewW,
    height: viewH,
    show: false,
    /*
     * 无边框，与真实窗口一致。带上系统边框时 --width 给的是**外框**尺寸，
     * 视口会比它小一圈（1280×720 请求到的是 1264×655），于是
     * --width 480 --height 270 量到的并不是迷你档那个 480×270 的视口。
     */
    frame: false,
    // 要透明通道时不能给底色：给了底色，球四周那圈透明就被填成一块灰
    ...(ALPHA ? { transparent: true } : { backgroundColor: '#1b1f24' }),
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  /*
   * 面板是带 ?kind= 打开的（五种面板共用一份 popover.html），
   * 不带参数时它自己是默认的「站点」那一张。
   */
  await win.loadFile(pagePath, page === 'popover' ? { search: `?kind=${KIND}` } : undefined)

  /*
   * --no-reduced-motion 的反面那一档：把「减少动态效果」**覆写掉**再量。
   *
   * 这一档是必需的，因为**这台机器本身就开着减少动态效果**：不给任何开关时，
   * 无头窗口里 matchMedia('(prefers-reduced-motion: reduce)') 量出来就是 true
   * （每一跑都印着 reducedMotion: true、animations: []）。于是「换栏那一下有没有
   * 一个被安排的动作」在默认那几跑里根本量不到——样式里那条动画被自己的 media
   * 查询撤掉了，而那正是它该做的事。
   *
   * Chromium 只有「强制打开」那个开关（--reduced-motion 用的就是它），没有
   * 「强制关掉」的，所以这一档走 CDP：Emulation.setEmulatedMedia 覆写这一项。
   *
   * **必须在 loadFile 之后**：sendCommand 等的是渲染进程的回应，而它在 loadFile
   * 之前还不存在——上一版写在 loadFile 之前，于是那条命令永远等不到回应，
   * 整个探针就停在 BODY 那一行不动了。覆写来得晚一步不影响结果：样式重算之后
   * 那条动画照样从头走一遍（fill: both，量的是它的名字、时长与缓动）。
   */
  if (has('--no-reduced-motion')) {
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    })
  }

  // 渲染进程是异步拉状态再渲染的，等它把首帧摆好
  await wait(1200)
  // 展示字是异步加载的，量宽度之前得等它到齐，否则量到的是兜底那份。
  // 末尾接一个 true：document.fonts.ready 兑现的是 FontFaceSet 本身，
  // 那不是能被 executeJavaScript 搬回来的值——直接等它就卡在这里。
  if (page === 'home' || page === 'settings') {
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  }

  /*
   * 模拟桌面垫在 html 上：界面自己的底板画在它上面，而界面留白的地方透出来
   * 就成了「桌面」。关掉这个开关时什么都不做，验证版面拿到的还是那块默认灰底。
   */
  if (DESKTOP) {
    await win.webContents.executeJavaScript(
      `document.documentElement.style.background = ${JSON.stringify(DESKTOP)}`
    )
  }

  /*
   * --ball-zoom：只放大**图形本身**。
   *
   * 用 insertCSS 而不是去改 svg 的 width/height：那两个属性归 Vue 管，
   * 下一次重渲染会把它们改回去，而样式表不会。球自己的直径因此保持原样，
   * 这张图只用来判断路径画得成不成立（见上面 BALL_ZOOM 的说明）。
   */
  if (BALL_ZOOM > 1) {
    await win.webContents.insertCSS(
      `.ball svg, .ball img.custom { transform: scale(${BALL_ZOOM}); transform-origin: center; }`
    )
  }

  fs.mkdirSync(outDir, { recursive: true })

  /** --drag-probe 的结果。截一次图顺带量一次，写进 JSON，也在终端打一份 */
  let dragProbe = null

  const shoot = async (name) => {
    /*
     * 先等渲染进程真的画完一帧，再抓图。
     *
     * 不显示窗口的合成帧会晚一拍：状态刚改完就 capturePage，拿到的往往是
     * 上一帧——曾经出现过「crt-green 的截图里是第一版配色」这种灵异现象，
     * 而同一时刻 executeJavaScript 读出来的 DOM 又是对的。
     * 连等两帧（rAF 回调意味着这一帧已经提交），外加一次丢弃的抓取。
     * rAF 在隐藏窗口里可能被节流，因此加个超时兜底，别把脚本挂住。
     */
    await win.webContents.executeJavaScript(
      `Promise.race([
         new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
         new Promise((r) => setTimeout(r, 500))
       ])`
    )
    await win.webContents.capturePage()
    await wait(150)

    const image = await win.webContents.capturePage()
    const png = path.join(outDir, `${name}.png`)
    fs.writeFileSync(png, image.toPNG())
    const measured = await win.webContents.executeJavaScript(
      page === 'chrome' ? MEASURE : page === 'popover' ? POPOVER_MEASURE : PAGE_MEASURE
    )
    /*
     * 这一份写的是**当下实测的**最大化状态，不是 --maximized 这个入参。
     *
     * 两者在那一轮还原往返里必然对不上：--maximized 起的窗口跑完一圈点过还原键，
     * 盘面上已经不是最大化了。若这里照入参写一句 true，JSON 就与紧挨着它的
     * topbar / rail 实测自相矛盾——而读这份 JSON 的人正是拿它当证据用的。
     */
    const live = await win.webContents
      .executeJavaScript(`window.zhituan.win.getState()`)
      .catch(() => null)
    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify(
        {
          page,
          mode,
          maximized: live?.maximized ?? MAXIMIZED,
          theme,
          bg: BG,
          /*
           * 这一份图是在多大的视口里渲染的。
           *
           * `window` 是窗口，`body` 是起始页 / 设置页这类自家一屏在真机上真正
           * 拿到的那块矩形（不给 --body 时按整扇窗渲染，两者相等）。读这份 JSON
           * 的人正是拿它当证据的，因此这张图代表哪一态必须写在里面。
           */
          viewport: {
            window: { width: WIDTH, height: HEIGHT },
            body: rect ? { width: rect.width, height: rect.height } : { width: WIDTH, height: HEIGHT },
            renderIsBody: BODY,
            addressOpen: ADDRESS_OPEN,
            rendered: { width: viewW, height: viewH }
          },
          reportedBallRect,
          measured,
          dragProbe
        },
        null,
        2
      ),
      'utf8'
    )
    console.log(`WROTE ${png}`)
    if (page === 'chrome') {
      console.log(`BALL_RECT ${JSON.stringify(reportedBallRect)}`)
      // 球面上画的是哪一枚、实测多大：与截图对着看，比只看图确定得多
      console.log(`BALL_GLYPH ${JSON.stringify(measured.ballGlyph)}`)
      // 两屏那两颗键的实测配色：亮着的那颗是不是真的亮着，暗夜下靠肉眼分不清
      console.log(`SCREEN_KEYS ${JSON.stringify(measured.screenKeys)}`)
      /*
       * 三条透明度滑块各自长什么样，以及功能栈有没有被撑出滚动区。
       *
       * 只印「标签 / 读数 / 上下限 / 禁没禁」这四样：它们正是判据的全部——
       * 第三条在网页上是禁用的（disabled 为 true）、在读本机 TXT 时是活的，
       * 而读数的上下限与 shared/constants 里那三对常量应当逐一相符。
       */
      console.log(
        `SLIDERS ${JSON.stringify(
          measured.sliders.map((s) => ({
            标签: s.label,
            读数: s.value,
            范围: `${s.min}–${s.max}`,
            禁用: s.disabled,
            灰着: s.offClass,
            tooltip: s.hint
          }))
        )}`
      )
      console.log(`RAIL_STACK ${JSON.stringify(measured.stackScroll)}`)
      /*
       * 地址栏开关上写着什么，以及**它有没有跟着屏名变**——用户报的就是这一条。
       *
       * 判据：停在自家那两屏上时，那一格必须仍是刚才那张网页（与不给 --screen 时
       * 逐字相同），因此 `写的是屏名` 必须是 false。这两个屏名写死在这里，
       * 与上面 SCREEN_KEYS 那两个键同一个理由：这一条要盯的正是「屏名有没有漏到
       * 一个该写网页的地方」。
       */
      console.log(
        `SCREEN_PILL ${JSON.stringify({
          停在哪一屏: SCREEN ?? null,
          开关上写着: measured.addressLabel,
          写的是屏名:
            measured.addressLabel === '起始页' || measured.addressLabel === '系统设置'
        })}`
      )
      /*
       * 让位成下拉按钮时，那枚按钮上写着什么。
       *
       * 与上面那一格同一条规矩：它代表的是**一张网页**，停在自家那两屏上时
       * 写的是刚才那张（也就是按它一下会进去的那张），因此同一份界面上，
       * 给不给 --screen 读到的都该是同一行字。`写的是屏名` 必须是 false。
       */
      console.log(
        `SCREEN_STRIP ${JSON.stringify({
          停在哪一屏: SCREEN ?? null,
          让位了: measured.fallback !== null,
          按钮上写着: measured.fallbackText,
          写的是屏名:
            measured.fallbackText === '起始页' || measured.fallbackText === '系统设置'
        })}`
      )
      // 最大化那一档：右上角两样东西的实测几何，判据见 MEASURE 里的说明
      if (MAXIMIZED) {
        console.log(
          `FLOAT ${JSON.stringify({ box: measured.floatBox, key: measured.floatKey, ball: measured.ball })}`
        )
      }
      // 提示条：高度、位置、那一句文案、进度线。26 行之外的东西看不见，只能这么问
      if (NOTICE) {
        console.log(
          `NOTICE ${JSON.stringify({
            row: measured.notice,
            text: measured.noticeText,
            progress: measured.noticeProgress,
            topbar: measured.topbar
          })}`
        )
      }
    } else {
      /*
       * 起始页 / 设置页：几件只有量了才知道的事，当场印出来。
       *
       * 其中两件是上一轮**文字干净、属性漏了**那一类：pathLeaks 看的是行上的
       * 字，titleLeaks 看的是 title 属性；displayWidths 看的是展示字到底换上了
       * 没有（拉丁那一行里 ours 与两个兜底不相等就是换上了）。
       *
       * lines 两档都印：终端世界的行在 .term 底下，现代世界的在 .modern 底下，
       * 一次只会有一个是数（另一个是 0）。先前写的是 `lineCount ?? termLineCount`，
       * 而 0 不是 nullish，终端那一跑因此印成 0——数在，被 `??` 挡住。
       */
      console.log(
        `PAGE ${JSON.stringify({
          lines: measured.lineCount || measured.termLineCount || null,
          area: measured.lines ?? measured.termLines ?? null,
          plate: measured.plateOn ?? null,
          stat: measured.stat ?? null,
          note: measured.note ?? null,
          endRule: measured.endRule ?? null,
          animations: measured.animations ?? null,
          reducedMotion: measured.reducedMotion ?? null,
          active: measured.active ?? null,
          pathLeaks: measured.pathLeaks ?? null,
          titleLeaks: measured.titleLeaks ?? null,
          displayLoaded: measured.displayLoaded ?? null,
          displayCovers: measured.displayCovers ?? null,
          displayWidths: measured.displayWidths ?? null
        })}`
      )
    }
  }

  const run = (js) => win.webContents.executeJavaScript(js)
  /*
   * 尺寸与非默认的标签数都写进名字：同一台机器上跑几档下来，别互相覆盖。
   *
   * 写的是**这一页实际拿到的那块**（--body 时是正文区，不是窗口）：图名要说的是
   * 「这张图里的文档有多宽多高」，写窗口尺寸的话，912×496 的那一张会挂着 960×540
   * 的名字，而这两个数在高度上差 44——正好是这一页最紧的那一轴。
   */
  const size = viewW !== 960 || viewH !== 540 ? `-${viewW}x${viewH}` : ''
  const tabs = TABS ? `-${TABS}tabs` : ''
  // 底板透明度同理：跑了 0.35 那一档之后，默认那一档的图不该被它盖掉
  const bg = BG !== 1 ? `-bg${BG}` : ''
  /*
   * 本机 TXT 那一态同理，而且它必须跟着值走：不给 --reader 的那张是「禁用」
   * （默认那张图里第三条是灰的），--reader 100 与 --reader 40 又是两种读数。
   * 三张图各说一件事，谁也不该盖掉谁。
   */
  const reader = READER_ALPHA !== null ? `-reader${Math.round(READER_ALPHA * 100)}` : ''
  /*
   * 球面上画的是什么也写进名字：八枚内置图标是八张图，跑第二轮时彼此不能覆盖。
   * 自定义那张用落法而不是文件名做标记——同一个落法同一张图，重跑就该盖掉旧的那张。
   */
  const ball = BALL_IMAGE ? `-img${BALL_FIT}` : BALL_ICON !== 'book' ? `-icon${BALL_ICON}` : ''
  const zoom = BALL_ZOOM > 1 ? `-zoom${BALL_ZOOM}` : ''
  // 最大化那一档与展开态是两张不同的图（一张是右上角一小块、一张是整扇窗），不能互相覆盖
  const max = MAXIMIZED ? '-max' : ''
  /*
   * 主题也写进名字，但只有两张图配得上这个名字。
   *
   * 起始页一直这么干——三套主题各截一张是它的常规用法，而它也是**唯一**写主题的
   * 那一份文档。设置页再算半个：它自己不换皮，但「主题」那一栏的选中态读的正是
   * ui.homeTheme，换一个主题那张图里的按钮就换了地方。因此这两页照旧缀后缀
   * （起始页一律缀，设置页只在 --theme 明确指到非默认主题时才缀——它的图名
   * README 在用，不能因为多了一个默认值就全体改名）。
   *
   * 界面、弹出面板、PDF 这三份文档 1.5.1 起彻底不写主题，给了 --theme 画面也
   * 一个像素都不变。它们若还缀后缀，落下来的就是两张一模一样的图、两个名字，
   * 读图的人会以为自己在看两态——所以一律不缀。
   */
  const themeTag =
    page === 'home' ? `-${theme}` : page === 'settings' && theme !== 'paper' ? `-${theme}` : ''
  /*
   * 提示条的形态也写进名字：四种形态各是一张图，跑第二轮时彼此不能覆盖。
   * 「已按过更新并重启」那一态另加一段后缀——它是另一种文案，会被上一种盖掉。
   * 只有 chrome 那一页会画它，别的页面上这个开关没有任何作用。
   */
  const noticeTag =
    page === 'chrome' && NOTICE
      ? `-notice${NOTICE_PHASE === 'available' ? '' : `-${NOTICE_PHASE}`}${NOTICE_PENDING ? '-pending' : ''}`
      : ''
  /*
   * 停在哪一屏也写进名字：起始页与设置是两张不同的图，不能互相覆盖。
   * 不给 --screen 时一个字都不加——默认那几张图的名字 README 在用。
   */
  const screenTag = SCREEN ? `-screen${SCREEN}` : ''
  /*
   * 停在哪一栏也写进名字：六栏各是一张图，跑第二轮时彼此不能覆盖。
   * 不给 --plate 时一个字都不加——「全部」那一张就是默认那张图，重跑该盖掉旧的。
   */
  const plateTag = PLATE_TARGET ? `-plate${PLATE_TARGET}` : ''

  /*
   * --drag-probe：先按一遍，再照第一张。
   *
   * 放在截图之前：探针会派发几次 pointerdown/pointerup，虽然不含 click、
   * 按道理不改动界面，但把「量」放在「照」前头更稳妥——将来探针万一长出
   * 副作用，也不至于污染后面所有的图。
   */
  if (page === 'chrome' && has('--drag-probe')) {
    dragProbe = await run(DRAG_PROBE)
    for (const p of dragProbe.points) {
      const mark = p.started ? '拖' : p.started === false ? '不拖' : '？'
      // 手势判对与否：'✓' / '✗' / 这一点没算出判据（'·'）
      const verdict = p.ok === true ? '✓' : p.ok === false ? '✗' : '·'
      const size = p.want ? ` ${p.want}${p.edge ? `→${p.edge}` : ''}` : ''
      console.log(`DRAG ${verdict} ${mark} ${p.name} → ${p.hit ?? p.why ?? '?'}${size}`)
    }
    console.log(`DRAG_BAD ${JSON.stringify(dragProbe.bad)}`)
    console.log(`DRAG_HANDLES ${dragProbe.handles}`)
    console.log(
      `DRAG_LOG ${JSON.stringify({
        starts: dragProbe.starts,
        ends: dragProbe.ends,
        balanced: dragProbe.balanced,
        resizeStarts: dragProbe.resizeStarts,
        resizeEnds: dragProbe.resizeEnds,
        resizeBalanced: dragProbe.resizeBalanced
      })}`
    )
  }

  /*
   * 起始页的栏目。三条路分开走：
   *   --plate       先把这一栏点出来，再照（六栏各一张，看每一栏长什么样）
   *   --click-plate 先照默认那一眼（全部），点一下这一栏再照一张（看换栏那一步）
   *   --open-file   停在「离线阅读」上，点那行「打开文件…」，看走完之后是什么样
   *
   * 三条都是**真的点界面**：这一页「停在哪一栏」不落盘，真机上只有点这一条路
   * 走得到，绕开它摆状态就会验出一个真实程序走不到的形状。
   */
  if (page === 'home' && (PLATE_TARGET || CLICK_PLATE)) {
    const ids = await run(PLATE_IDS)
    console.log(`PLATE_IDS ${JSON.stringify(ids)}`)
    /*
     * 名字对不上就直接失败，不照那一张：把一张「全部」标成 video 存下来，
     * 比什么都不存更坏——那张图会被当作「视频栏长这样」的证据用。
     */
    for (const wanted of [PLATE_TARGET, CLICK_PLATE]) {
      if (wanted && !ids.includes(wanted)) {
        console.log(`PLATE_BAD ${JSON.stringify({ 要的: wanted, 界面上的: ids })}`)
        app.exit(1)
        return
      }
    }
    if (PLATE_TARGET) {
      await run(`document.querySelector('.plates .plate[data-plate="${PLATE_TARGET}"]').click()`)
      await wait(300)
      console.log(`PLATE 在 ${PLATE_TARGET}：${JSON.stringify(await run(READ_PLATES))}`)
    }
    // --themes 那一档照的是三套配色，换栏那一步在那一档里会把名字弄乱，明说一句
    if (CLICK_PLATE && has('--themes')) {
      console.log('PLATE_SKIP --themes 照的是三套配色，换栏那一步请用 --home --click-plate')
    }
  }

  if (page === 'home' && has('--themes')) {
    /*
     * 展开主题选择器。
     *
     * 点开与点选必须分成两次 executeJavaScript：Vue 的 DOM 更新是下一帧的事，
     * 同一次调用里点开面板就立刻去取面板里的按钮，取到的是空的。
     */
    const openMenu = `(() => {
      const trigger = document.querySelector('.theme-menu .trigger')
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
    })()`

    await run(openMenu)
    await wait(300)
    // 主题名单从面板里读，不在脚本里另抄一份
    const ids = await run(THEME_IDS)
    console.log(`THEMES ${JSON.stringify(ids)}`)
    await shoot(`home-picker${plateTag}${size}${bg}`)

    for (let i = 0; i < ids.length; i += 1) {
      /*
       * 走真实那条路：点菜单项 → 写配置 → 广播 → 重新渲染。
       * 直接改 dataset.theme 换不出另一套世界——主题要连形态一起换掉，
       * 那一步只有应用自己知道（见 @shared/constants 的 worldOfTheme）。
       */
      await run(`document.querySelectorAll('.theme-menu .panel .item')[${i}].click()`)
      await wait(400)
      await shoot(`home-${ids[i]}${plateTag}${size}${bg}`)
      await run(openMenu)
      await wait(250)
    }
  } else {
    const name =
      page !== 'chrome'
        ? `${page}${themeTag}${plateTag}${page === 'popover' ? `-${KIND}` : ''}${size}${tabs}${bg}${ball}${zoom}`
        : `preview-${mode}${max}${themeTag}${noticeTag}${screenTag}${size}${tabs}${bg}${ball}${zoom}${reader}`
    await shoot(name)

    /*
     * 点一下那一栏，再照一张。要看的是「换栏」这一步本身：输入框里的光标该留在
     * 原处、行列表该换成另一摊、状态行那个读数该跟着变一种说法（「站点 16」
     * 摆在离线阅读那一栏里是句错话）——三件事在截图上只看得出一半，
     * 因此前后各读一遍栏目线，打一行 PLATE。
     */
    if (page === 'home' && CLICK_PLATE) {
      console.log(`PLATE 点之前：${JSON.stringify(await run(READ_PLATES))}`)
      /*
       * 点之前先问一遍正在跑什么：换栏那条动画只在真的换栏时才该跑，
       * 因此「点之前是空的、点之后有两条」才是完整的证据。
       * fill: both 让它们跑完仍留在列表里，所以点之后**不等**也不会漏
       * ——但先读那一次必须是点之前，否则分不清是挂载那一次还是换栏那一次。
       */
      console.log(`SETTLE 点之前正在跑的：${JSON.stringify(await run(RUNNING_ANIMATIONS))}`)
      await run(`document.querySelector('.plates .plate[data-plate="${CLICK_PLATE}"]').click()`)
      console.log(`SETTLE 点之后正在跑的：${JSON.stringify(await run(RUNNING_ANIMATIONS))}`)
      await wait(400)
      console.log(`PLATE 点之后：${JSON.stringify(await run(READ_PLATES))}`)
      await shoot(`${name}-clickplate-${CLICK_PLATE}`)
    }

    /*
     * 走一遍「打开文件…」。
     *
     * 点的是那一行本身，界面照真机那条路走：调到 files.openLocal → 拿到文件名 →
     * 重新取一遍历史（见 HomeApp.openFile）。对话框由假桥代劳，点击是真的。
     * 要看的三件事都在那行日志里：页眉的标签数加了一、「离线阅读」那一栏多出
     * 这本书、而那一行印的是书名与 .TXT 而不是一条路径。
     */
    if (page === 'home' && OPEN_FILE) {
      const meta = () => run(`document.querySelector('.bar .meta')?.textContent?.trim() ?? null`)
      console.log(`OPEN_FILE 点之前：${JSON.stringify({ 页眉: await meta(), ...(await run(READ_PLATES)) })}`)
      await run(`document.querySelector('.lines .line.file')?.click()`)
      await wait(400)
      console.log(`OPEN_FILE 点之后：${JSON.stringify({ 页眉: await meta(), ...(await run(READ_PLATES)) })}`)
      await shoot(`${name}-openfile`)
    }

    /*
     * 最大化那一档：点一下右上角那枚还原键，再照一张。
     *
     * 这是「最大化 → 还原」这条往返的端到端验收：界面发意图 → 主进程改状态 →
     * 广播回来 → 界面重画（假桥里那条广播是真的，见 preview-preload.js）。
     * 第二张的 JSON 里必须重新出现 rightButtons 与 railButtons——顶栏与右栏回来了。
     * 只看第一张只能证明「藏着」，证不了「回得来」，而这一态唯一的出口就是那枚键。
     */
    if (page === 'chrome' && MAXIMIZED) {
      await run(`document.querySelector('.float-key')?.click()`)
      await wait(400)
      await shoot(`${name}-restored`)
    }

    /*
     * 点一格标签，再截一张。
     *
     * 「点得动」是标签条的全部意义，而这件事只有真点一下才知道：
     * 假桥里 activate 会改掉当前格并广播，两张图的选中格应当不同。
     */
    if (page === 'chrome' && has('--click-tab')) {
      const at = num('--click-tab', 0)
      await run(`document.querySelectorAll('.zone .tab')[${at}]?.click()`)
      await wait(400)
      await shoot(`${name}-click${at}`)
    }

    /*
     * 点右栏最上面那一格「收起时暂停播放」，再截一张。
     *
     * 这一格是全栏唯一的开关：按下去就地改配置（stealth.muteMediaOnCollapse），
     * 而不是打开面板。因此要问的是三件事——配置真的改了、高亮跟着改了、
     * **旁边的项没有被带坏**（假桥的 patch 与真的 ConfigStore 一样逐个子对象合并，
     * 见 preview-preload.js；它原先只对 `ui` 这么做，改一个 stealth 字段会把
     * 整个 stealth 换掉）。高亮按 title 定位，不按 `.item.on`——后者是通用类名，
     * 将来别的格子用上它就问到别处去了。
     */
    if (page === 'chrome' && has('--click-rail-pause')) {
      const railPause = async () =>
        run(`(async () => {
          const cfg = await window.zhituan.config.get()
          const b = document.querySelector('.rail button[title*="收起时暂停"]')
          return {
            value: cfg.stealth.muteMediaOnCollapse,
            高亮: b ? b.classList.contains('on') : null,
            旁边的项: cfg.stealth.autoCollapse
          }
        })()`)
      const before = await railPause()
      await run(`document.querySelector('.rail button[title*="收起时暂停"]')?.click()`)
      await wait(400)
      const after = await railPause()
      console.log(`RAIL_PAUSE ${JSON.stringify({ 点之前: before, 点之后: after })}`)
      await shoot(`${name}-railpause`)
    }

    /*
     * 拖右栏某一条透明度滑块，问松手之后它显示的是刚拖到的那个值，还是弹回
     * 改动前的旧值（默认 100%）。拖哪一条由 --drag-slider 说了算，默认「整体」。
     *
     * 用户报的正是「整体」这一条。它走的是窗口级属性（win.setOpacity），与设置页
     * 那条走 configPatch 的不是同一条路，而配置广播从前只挂在 configPatch 上——
     * 界面手里那份配置镜像一直停在挂载时读到的旧值上，用户一松手显示就回落到它，
     * 调小多少次都还是 100%。
     *
     * 假桥把这一态**放大到看得见**：它的 setOpacity 收下请求就完
     * （preview-preload.js），也就是「主进程一声不响」的极端情形——真机上广播
     * 迟早会来，这里永远不来。于是这一问量的是滑块自己那半边：松手之后它该守着
     * 自己刚拖到的值，直到 props 真的换掉，而不是立刻回落到 props 里的旧值。
     *
     * 三条滑块共用这一段，是因为它们各自那条路都从**同一个组件**出去，而那件
     * 报告的事（守不住自己刚拖到的值）是组件里的状态机——换一条滑块不换这个机制，
     * 抄第二份探针只会让两边慢慢走岔。差异只在两处，都按标签取：
     *   写进哪个键 —— 整体是 win.setOpacity，另两条是 config 的两条 ui 字段；
     *   怎么确认请求真的出去了 —— 整体看假桥记的那笔账，另两条看配置读回来是什么
     *   （它们本来就经 configPatch，假桥那一份是真的会改的）。
     *
     * 三问，缺一不可：
     *   拖动中   —— 显示跟得上手指，且请求真的发了出去；
     *   松手     —— **用户报的那一帧**：显示仍是刚拖到的值，不是 100%；
     *   模型换掉 —— 让假桥广播一个**别的**值进来（模拟主进程夹过一道），显示必须
     *               改听它的。这一问盯的是「守着自己那个值」不许守成死锁：换了值
     *               它还不动，这滑块就成了一个只会念自己旧心情的摆设。
     */
    if (page === 'chrome' && has('--drag-opacity')) {
      const 目标 = num('--drag-opacity', 40)
      // 与目标明显不同，用来把滑块从「守着自己那个值」里拽出来
      const 别的值 = 目标 > 50 ? 20 : 80

      const 拖哪条 = (() => {
        const i = args.indexOf('--drag-slider')
        return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '整体'
      })()
      /*
       * 每一条滑块「改写的是配置里的哪一格」，以及「怎么把那一格读回来」。
       * 整体那一格**读不回来**（假桥的 setOpacity 只记账、不改配置，见上面那段
       * 说明），因此它的证据是那笔账；另两条的证据是配置里真的变成了这个值。
       */
      const 键 = {
        整体: { 广播: (v) => `{ window: { opacity: ${v} } }`, 读回: null },
        背景: { 广播: (v) => `{ ui: { backgroundOpacity: ${v} } }`, 读回: (c) => c.ui.backgroundOpacity },
        阅读: { 广播: (v) => `{ ui: { readerOpacity: ${v} } }`, 读回: (c) => c.ui.readerOpacity }
      }[拖哪条]
      if (!键) {
        console.error(`PREVIEW --drag-slider 只认「整体」「背景」「阅读」：${拖哪条}`)
        app.exit(1)
        return
      }

      const 找 = `[...document.querySelectorAll('.rail .opacity')]
        .find((e) => e.querySelector('.label')?.textContent?.trim() === ${JSON.stringify(拖哪条)})`
      const 读 = `(() => {
        const box = ${找}
        if (!box) return null
        const el = box.querySelector('.slider')
        return {
          显示: box.querySelector('.value')?.textContent?.trim() ?? null,
          值: Number(el.value),
          禁用: el.disabled
        }
      })()`
      const 按 = (type) =>
        run(`(() => {
          const box = ${找}
          if (!box) return false
          box.querySelector('.slider').dispatchEvent(
            new PointerEvent(${JSON.stringify(type)}, { bubbles: true, pointerId: 1 })
          )
          return true
        })()`)

      const 拖之前 = await run(读)
      await 按('pointerdown')
      await wait(50)
      /*
       * 拖一格：把值写进去再派一次 input——这正是浏览器真拖动时做的事，
       * onInput 读的就是 target.value，因此这一串没有一步是替它做主的。
       *
       * 写值与**读显示**必须是两次调用，中间那一小段等待也是必需的：Vue 的重画
       * 在微任务里，与派事件同一个任务里读到的还是上一次画出来的那一帧。
       * 少了这一步，被测的东西就变成了「DOM 里那个值」，而滑块坏没坏恰恰是
       * 画出来的那个数说了算——下面松手那一帧同理（在那里漏掉它，毛病会
       * 反过来被读成一个「没问题」）。
       */
      await run(`(() => {
        const box = ${找}
        const el = box.querySelector('.slider')
        el.value = String(${目标})
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await wait(50)
      const 拖动中 = await run(读)
      const 发出去的请求 = 键.读回
        ? 键.读回(await run(`window.zhituan.config.get()`))
        : ((await run(`window.zhituan.win.opacityLog().calls`)).slice(-1)[0] ?? null)

      await 按('pointerup')
      await wait(50)
      const 松手 = await run(读)

      // 广播一个别的值进来：走的是与真机同一条路（假桥的 patch 真的会广播）
      await run(`window.zhituan.config.patch(${键.广播(别的值 / 100)})`)
      await wait(250)
      const 模型换掉之后 = await run(读)

      console.log(
        `DRAG_OPACITY ${JSON.stringify({
          拖的是: 拖哪条,
          目标: `${目标}%`,
          拖之前,
          拖动中,
          假桥收到的: 发出去的请求,
          松手,
          模型换成: `${别的值}%`,
          模型换掉之后
        })}`
      )
      const 破了 = []
      /*
       * 禁用着的那条不许被这一问悄悄放过。
       *
       * 派发出来的 input 事件**绕得开 disabled**（dispatchEvent 不看那个属性），
       * 于是拿一条禁用的滑块跑这一问会有两个后果：写进配置的那个值在真机上
       * 用户根本拖不出来，而三问还会全绿。因此先把「它此刻该活着」这件事
       * 摆在最前面——想量禁用态就换 --drag-slider，不要拖一条禁着的。
       */
      if (拖动中?.禁用) 破了.push(`${拖哪条}这条滑块此刻是禁用的，这一问量不到它`)
      if (拖动中?.显示 !== `${目标}%`) 破了.push(`拖动中显示的是 ${拖动中?.显示}`)
      if (发出去的请求 === null || Math.abs(发出去的请求 * 100 - 目标) > 1) {
        破了.push(`假桥收到的不是 ${目标}%：${发出去的请求}`)
      }
      if (松手?.显示 !== `${目标}%`) 破了.push(`松手之后跳成了 ${松手?.显示}`)
      if (模型换掉之后?.显示 !== `${别的值}%`) 破了.push(`模型换成 ${别的值}% 之后显示的是 ${模型换掉之后?.显示}`)
      console.log(破了.length ? `DRAG_OPACITY_FAIL ${JSON.stringify(破了)}` : 'DRAG_OPACITY_OK')
      await shoot(`${name}-drag${拖哪条}${目标}`)
    }

    /*
     * 点「设置」那颗键进出一次，再点「起始页」那颗键进出一次，各截一张。
     *
     * 这两颗键是起始页与系统设置**仅有的两个入口**（设置那颗原先在右栏栏底，
     * 用户要求搬到左上角并换成图标，现在与起始页并排），而且各自都是开关：
     * 不在那一屏上就进去，已经在那一屏上就原路返回进来之前那张网页。
     * 标签条不再列这两屏，于是「此刻停在哪」只能从三处读出来——`screen`、
     * 哪一格标签高亮、以及地址栏开关上写着什么。三处一起读，缺一处就分不清
     * 「进去成功」与「什么也没发生」。
     *
     * 两颗键都按 aria-label 找，不按 title：title 会随状态在「进去」与「回来」
     * 两种说法之间换（两屏都亮着时更是两颗键同一个说法），要靠它认键就得
     * 先知道自己要问的是哪一态——那正是这一问要验的东西。
     *
     * 两次点击之间必须重新查一遍 DOM：Vue 的更新是下一帧的事，而且高亮的
     * 类名与 title 都会随状态换掉。
     */
    if (page === 'chrome' && has('--click-screen')) {
      const HOME_KEY = '.topbar button[aria-label="起始页"]'
      const SETTINGS_KEY = '.topbar button[aria-label="系统设置"]'
      const readScreen = async () =>
        run(`(async () => {
          const s = await window.zhituan.tabs.list()
          const home = document.querySelector('${HOME_KEY}')
          const key = document.querySelector('${SETTINGS_KEY}')
          return {
            停在哪: s.screen,
            当前网页: s.activeTabId,
            高亮的格: s.tabs.filter((t) => t.isActive).map((t) => t.id),
            起始页键亮着: home ? home.classList.contains('on') : null,
            设置键亮着: key ? key.classList.contains('on') : null,
            地址栏开关: document.querySelector('.topbar .address-toggle .ellipsis')?.textContent?.trim() ?? null
          }
        })()`)
      const steps = [{ 动作: '起点', ...(await readScreen()) }]
      await run(`document.querySelector('${SETTINGS_KEY}')?.click()`)
      await wait(400)
      steps.push({ 动作: '点「设置」键', ...(await readScreen()) })
      await shoot(`${name}-settings`)
      await run(`document.querySelector('${SETTINGS_KEY}')?.click()`)
      await wait(400)
      steps.push({ 动作: '再点一次「设置」键', ...(await readScreen()) })
      await run(`document.querySelector('${HOME_KEY}')?.click()`)
      await wait(400)
      steps.push({ 动作: '点「起始页」键', ...(await readScreen()) })
      await shoot(`${name}-home`)
      await run(`document.querySelector('${HOME_KEY}')?.click()`)
      await wait(400)
      steps.push({ 动作: '再点一次「起始页」键', ...(await readScreen()) })
      console.log(`SCREEN ${JSON.stringify({ 步骤: steps })}`)
    }

    /*
     * 标签条让位成那一枚下拉按钮时，按**身子**与按**箭头**是两件事。
     *
     * 身子写着「这一条代表的那张网页」，按它就该进到那张网页里去；只有箭头
     * 才是「展开清单」。理由很实在：停在起始页 / 系统设置上时这一枚是回到
     * 原来那张网页的唯一入口（标签条上那些格子那一档下看不见），按下去却弹出
     * 一份清单、还要再找一遍，等于白白多一步。
     *
     * 三件事一起问：
     *   ① 停在自家那两屏上时按钮上写的东西**与看着网页时逐字相同**——用户报的
     *      就是「点设置时标签页部分跟着变了」；
     *   ② 按身子**不发**清单请求、按箭头**发**一条（面板是另一个窗口，预览里
     *      不会出现，因此「展开没展开」只问得出这一个读数，见假桥的 popoverLog）；
     *   ③ 停在自家那两屏上按身子，回到的是刚才那张网页。
     */
    if (page === 'chrome' && has('--click-fallback')) {
      const BODY = '.zone .fallback'
      const CARET = '.zone .fallback .caret'
      const HOME_KEY = '.topbar button[aria-label="起始页"]'
      const SETTINGS_KEY = '.topbar button[aria-label="系统设置"]'
      const read = async () =>
        run(`(async () => {
          const s = await window.zhituan.tabs.list()
          return {
            停在哪一屏: s.screen,
            当前网页: s.activeTabId,
            按钮上写着: document.querySelector('${BODY} .title')?.textContent?.trim() ?? null,
            数字牌: document.querySelector('${BODY} .count')?.textContent?.trim() ?? null,
            清单请求: window.zhituan.ui.popoverLog().requests
          }
        })()`)
      const press = async (sel) => {
        await run(`document.querySelector('${sel}')?.click()`)
        await wait(400)
      }

      const steps = [{ 动作: '起点（看着一张网页）', ...(await read()) }]
      const 起点写着 = steps[0].按钮上写着
      const 起点那张 = steps[0].当前网页

      await press(BODY)
      steps.push({ 动作: '按身子', ...(await read()) })
      await press(CARET)
      steps.push({ 动作: '按箭头', ...(await read()) })
      await press(SETTINGS_KEY)
      steps.push({ 动作: '点「设置」键', ...(await read()) })
      await shoot(`${name}-fallback-settings`)
      await press(CARET)
      steps.push({ 动作: '停在设置上按箭头', ...(await read()) })
      await shoot(`${name}-fallback-list`)
      await press(BODY)
      steps.push({ 动作: '停在设置上按身子', ...(await read()) })
      await shoot(`${name}-fallback-back`)

      console.log(`FALLBACK ${JSON.stringify({ 步骤: steps })}`)

      const 破了 = []
      const at = (n) => steps[n]
      if (!起点写着 || 起点写着 === '起始页' || 起点写着 === '系统设置') {
        破了.push(`起点按钮上写着 ${JSON.stringify(起点写着)}，该是当前那张网页的标题`)
      }
      if (at(1).清单请求.length !== 0) {
        破了.push(`按身子发了清单请求 ${JSON.stringify(at(1).清单请求)}——只有箭头才该展开清单`)
      }
      if (at(1).当前网页 !== 起点那张) 破了.push(`看着网页时按身子，当前网页变成了 ${at(1).当前网页}`)
      if (at(2).清单请求.join() !== 'tabs') {
        破了.push(`按箭头发的清单请求是 ${JSON.stringify(at(2).清单请求)}，该恰好一条 tabs`)
      }
      if (at(2).当前网页 !== 起点那张) 破了.push(`按箭头之后当前网页变成了 ${at(2).当前网页}`)
      if (at(3).停在哪一屏 !== 'settings') 破了.push(`点「设置」键之后停在哪一屏是 ${at(3).停在哪一屏}`)
      if (at(3).按钮上写着 !== 起点写着) {
        破了.push(
          `停在设置上按钮上写着 ${JSON.stringify(at(3).按钮上写着)}，看着网页时写的是 ${JSON.stringify(起点写着)}——这一格不该跟着屏变`
        )
      }
      if (at(4).清单请求.length !== 2) {
        破了.push(`停在设置上按箭头，清单请求变成 ${JSON.stringify(at(4).清单请求)}`)
      }
      if (at(4).停在哪一屏 !== 'settings') 破了.push('停在设置上按箭头，人却被踢出了设置')
      if (at(5).停在哪一屏 !== null) 破了.push(`停在设置上按身子，停在哪一屏是 ${at(5).停在哪一屏}`)
      if (at(5).当前网页 !== 起点那张) {
        破了.push(`停在设置上按身子，回到的是 ${at(5).当前网页}，该是刚才那张 ${起点那张}`)
      }
      console.log(破了.length ? `FALLBACK_FAIL ${JSON.stringify(破了)}` : 'FALLBACK_OK')
    }

    /*
     * 改窗口尺寸，再截一张：标签条的让位与回归都靠这一步走一遍。
     * 窗口一变，渲染进程那边的 ResizeObserver 才量得出新的余量。
     */
    if (resize) {
      win.setSize(resize.width, resize.height)
      await wait(600)
      await shoot(`${name}-resized${resize.width}x${resize.height}`)
    }
  }

  app.exit(0)
})
