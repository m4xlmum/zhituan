/**
 * 探针：主题落在哪一份文档上，以及「不跟着主题走的那四份」有没有真的不动。
 *
 * 起因是 1.5.1 的一次范围收回：1.3.0 把主题铺到了整个界面（顶栏、地址栏、标签条、
 * 右栏、悬浮球、弹出面板、系统设置页，连终端形态一起），1.5.1 把它收回到**起始页
 * 那一屏**——用户报的是 PDF 阅读页的字在磷绿下整本变成荧光绿。诊断下来那不是
 * 一处漏了跟主题，而是「主题管到内容层」这条边界本身就不该划在那里：界面的皮肤
 * 换一换无妨，**内容**（正在读的那一页书、那张网页）不该被染上颜色。
 *
 * 五份文档各自加载同一份 styles/themes.css，但**只有起始页那一份**把主题名写到
 * html[data-theme] / html[data-world] 上（见 composables/useTheme.ts）。其余四份
 * 从不写，于是永远落在主题层的 `:root` 那一组——纸白。这是设计，因此这一版的判据
 * 与上一版正好反过来：
 *
 * 1. **纸白这一套钉住了**：paper 下界面的每一条 --zhituan-* 与一张定格表逐条相同。
 *    主题层里配色散在各段变量组里，重做最怕的就是顺手改了不想改的那一档，
 *    而这种改动在截图上看不出来。表本身随配色一起更新，但判据一条不放松
 *    （见 PAPER_EXPECT 的说明）。
 * 2. **主题只动起始页，别处一寸不挪**（Q2，本版的核心）：把配置里的 ui.homeTheme
 *    依次摆成纸白 / 暗夜 / 磷绿，**同一份文档量三次**——界面、面板、设置页、
 *    PDF 阅读页这四份的三次读数必须逐条相同（而且等于纸白那一份），
 *    起始页那三次必须两两不同。四份里少问一份，「改了没反应」就会从那一份冒出来；
 *    而少问「起始页真的变了」这一头，就成了「主题整个坏掉了也叫 OK」。
 * 3. **终端形态（直角、等宽、发光）也只在起始页**：磷绿下起始页变直角换等宽字，
 *    界面那四份仍是纸白那一副圆角与无衬线栈，字也不发光。
 * 4. **透明中部没被弄坏**。窗口是逐像素透明的，chrome 视图的中部必须什么也不画，
 *    好让下面的网页或桌面露出来。终端世界的扫描线/暗角是铺满视口的覆盖层，
 *    它**绝不能跟着主题进 chrome**：那是机制，不是审美。如今它连起始页以外的地方
 *    都在样式上够不着（那段规则在 home.css 里，只有 home.html 加载它），
 *    但这一条仍然每次量——省掉它的代价是三份文档里多一层盖住桌面的膜。
 * 5. **「更新提示条」站得住**。它是一行 30px 的实底，占的是版面（网页要让出这一行），
 *    因此它比这一层里别的任何东西都更容易把中部染上色；同时它的底、字、强调色
 *    必须逐条取自**界面那一份**令牌——写死一个白底的话纸白下看着完全正常。
 *    这一组单独加载：真机上提示条只在有新版时才占版面，一直挂着会让上面那几条
 *    基准漂移。
 * 6. **停在自家那一屏上时界面没散架**。起始页与系统设置不再是标签页：它们不进
 *    标签条，各有各的入口键。这一态也是一种**没有当前网页**的状态，因此单独加载
 *    三次（Q13，含起点）：标签条一格不多、一格不亮，两颗入口键各亮各的，而顶上
 *    那两处写字的地方（地址栏开关、标签条让位后那一枚）与起点**逐字相同**——
 *    写的都是「一张网页」，不跟着变成那一屏的名字（用户报过两次：先是地址栏开关
 *    跟着顶上了「系统设置」，后是标签条那枚按钮跟着顶，而它正是回到网页的唯一入口）。
 * 7. **PDF 那一页的墨色是纸白那一份**（Q14）。这一条单独立问，不并进 Q2 里：
 *    用户报的就是它（磷绿下整本书的字变绿），而这个毛病在 Q2 的「四份文档读数相同」
 *    里只会体现成一行「pdf 逐条相同」，看不出说的是什么。PDF 这一页在探针里
 *    打不开书（没有 ?doc，也没有主进程那条 zhituan-pdf: 通道），因此量的是**它的输入**
 *    ——算好的 --zhituan-ink 与根上那两个属性；读它的那一行代码在 PdfApp 里只有一行、
 *    且只在模块初始化时跑一次（见那里的注释），不值得为它在这儿再摆一个真 PDF。
 *
 * 颜色一律经 canvas 归一后比对：getPropertyValue 拿回来的是计算值，写法
 * （`rgb(255 255 255 / 1)` 还是 `#ffffff`）随主题层怎么写出入很大，比字符串
 * 等于是在比实现细节；比颜色才是比结果。
 *
 * 跑法：npx electron spike/theme-chrome.js
 * 产出：终端一份 [Qn] 报告、spike/out/theme-chrome.json，断言失败时退出码 1
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'out')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 版面常量从 src/shared/constants.ts 里现读。
 *
 * 抄一个 30 到探针里最省事，但那正是这类断言最容易失效的地方：常量改了、
 * 探针照旧按旧值量，于是「高度对不上」永远报不出来。读源文件只多一处麻烦
 * （正则只认 `export const NAME = 30` 这一种写法），换来的是两边打架时当场红。
 */
function constant(name) {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'constants.ts'), 'utf8')
  const m = new RegExp(`^export const ${name} = ([\\d_]+)$`, 'm').exec(text)
  if (!m) throw new Error(`读不到常量 ${name}（constants.ts 的写法变了？）`)
  return Number(m[1].replace(/_/g, ''))
}

const NOTICE_H = constant('NOTICE_H')

/**
 * 字符串常量同理（HOME_TITLE / SETTINGS_TITLE）。
 *
 * 这一版里「停在自家那一屏上时地址栏开关上写什么」是判据之一，而那两个字
 * 正是从 constants.ts 来的。探针抄一份的话，改文案时两边一起错。
 */
function stringConstant(name) {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'constants.ts'), 'utf8')
  const m = new RegExp(`^export const ${name} = '([^']*)'$`, 'm').exec(text)
  if (!m) throw new Error(`读不到常量 ${name}（constants.ts 的写法变了？）`)
  return m[1]
}

/**
 * 会加载主题层的五份文档。`home` 是唯一写主题名的那一份，其余四份的读数
 * 在 Q2 里必须一字不差地相同——它们就是「主题不落在哪儿」这句话的四个证人。
 *
 * pdf 那一份在探针里打不开书（没有 ?doc），量到的是它的**输入**而非它画出来的字，
 * 见文件头第 7 条。
 */
const PAGES = {
  chrome: 'index.html',
  popover: 'popover.html',
  settings: 'settings.html',
  pdf: 'pdf.html',
  home: 'home.html'
}

/** 三套主题与它们该有的形态（见 @shared/constants 的 HOME_THEMES） */
const THEMES = [
  { id: 'paper', world: 'modern' },
  { id: 'night', world: 'modern' },
  { id: 'crt-green', world: 'terminal' }
]

/** 不写主题名的那几份。它们的读数在三套主题下必须逐条相同（== 纸白那一份） */
const THEMED_ONLY_HOME = ['chrome', 'popover', 'settings', 'pdf']

/**
 * 假桥的入参。每次 loadFile 之前改一改，见下面的 setOptions。
 */
const opts = {
  mode: 'default',
  maximized: false,
  theme: 'paper',
  /*
   * 5 个：与 spike/preview-preload.js 里 ALL_TABS 的条数一致。
   * 标签条里现在**只有网页**——起始页与系统设置不进这一条了（它们是「屏」，
   * 见 spike/own-screens.js），因此这个数就是网页标签的数。
   */
  tabs: 5,
  /*
   * 停在自家哪一屏上：null（看着网页）/ 'home' / 'settings'。
   * 上面那些基准一律用 null；Q13 那一问单独加载三次（起点 + 那两屏），见 loadScreen。
   */
  screen: null,
  bgAlpha: 1,
  ballIcon: 'book',
  ballFit: 'cover',
  ballImage: null,
  /*
   * 更新那条：默认没有新版本，于是提示条不占版面。
   * 这一组单独加载一次（见 loadNotice），不混进上面那些基准里。
   */
  notice: null,
  noticePhase: 'available',
  noticePercent: 42
}

ipcMain.on('preview:options', (event) => {
  event.returnValue = { ...opts }
})

/**
 * 纸白这一套的**定格值**：一条一条钉在这里，改动它必须是有意的。
 *
 * 这张表原先记的是「改动前的字面量」，用来问「默认零回归」。起始页改版时
 * 纸白这一套是**有意重做的**（靛替代浏览器蓝、细线合成一种、字压到 4.5:1 以上），
 * 那一问就不再成立了——但表本身的用处没变，而且现在更值钱：这一张表管着五份
 * 文档（配色散在各处、用它的地方更多了），改一个想改的值顺手带坏另一个，
 * 从截图上完全看不出来。
 * 因此这里不再是「与改动前相同」，而是「与本表逐条相同」，**判据一条没放松**：
 * 仍然逐条比到四通道，仍然要求 --zhituan-font 是无衬线栈。
 *
 * 值来自 styles/themes.css 的纸白那一段；改动那边的配色，这里跟着一起改，
 * 改不动就说明这次改的不是纸白一套，而是顺手带了别的主题。
 */
const PAPER_EXPECT = {
  /* 这个必须是纯白：Q4 要求「底板淡、面还是 #ffffff 的那三通道」 */
  '--zhituan-surface': ['#ffffff', 1],
  '--zhituan-surface-hover': ['#f3f4f6', 1],
  '--zhituan-surface-active': ['#e8eaee', 1],
  '--zhituan-border': ['#d2d6dd', 1],
  '--zhituan-hairline': ['#e6e8ec', 1],
  '--zhituan-ink': ['#15181d', 1],
  '--zhituan-text': ['#15181d', 1],
  '--zhituan-text-dim': ['#5a6270', 1],
  '--zhituan-text-faint': ['#666d79', 1],
  /* 靛，不是浏览器蓝：这一套里没有一处强调色长在链接上，见 themes.css 的说明 */
  '--zhituan-accent': ['#2f4a9e', 1],
  '--zhituan-accent-hover': ['#273f86', 1],
  '--zhituan-accent-soft': ['#2f4a9e', 0.1],
  '--zhituan-danger': ['#b3261e', 1],
  /* 后五个是这次新起名的令牌，纸白下的值就是它们各自取代的那个字面量 */
  '--zhituan-sunken': ['#eef0f3', 1],
  '--zhituan-sunken-hover': ['#e2e5ea', 1],
  '--zhituan-danger-soft': ['#fdf3f2', 1],
  '--zhituan-selected': ['#eef1fa', 1],
  '--zhituan-on-fill': ['#ffffff', 1]
}

/** 半径与字体：形状那一路的值。radius-md 的 12px 就是它一直以来的兜底值 */
const PAPER_SHAPE = {
  '--zhituan-radius': '6px',
  '--zhituan-radius-sm': '4px',
  '--zhituan-radius-md': '12px',
  '--zhituan-radius-pill': '13px',
  '--zhituan-radius-tag': '8px',
  '--zhituan-radius-track': '7px',
  /* 浮层不跟着底板变淡，用的是起始页的页底色（`--zhituan-panel: var(--ground)`），
     而起始页的页底这一版从纯白改成了 #f9fafb——那张裁剪弹窗跟着沉了一档，
     是这次重做的一部分，因此这里记的是新值 */
  '--zhituan-panel': ['#f9fafb', 1],
  /* 设置页自己的页底：它比卡片面暗一档，卡片才浮得起来。这一条没动 */
  '--zhituan-ground': ['#f6f7f9', 1]
}

/**
 * 直角验到元素上，不停在变量层。
 *
 * 变量对了不等于元素用了它——把 `border-radius: 13px` 改成
 * `var(--zhituan-radius-pill)` 时打错一个字母，值会静静地退回初始的 0，
 * 而 0 恰好也是终端世界的目标值，于是"改对了"和"改坏了"在磷绿下长得一样。
 * 因此在纸白下把这两处的实测圆角与改前的字面量对一次。
 */
const PAPER_RADIUS = { '.address-toggle': '13px', '.tab': '6px' }

/**
 * chrome 里必须保持逐像素透明的那几块。窗口透明靠的就是它们什么都不画。
 *
 * `.spacer` 是最后一块：它是正文那一格本身（网页在原生视图里叠在它上面）。
 * 它多出一块底色，就是桌面上多蒙一层——而提示条正好排在它上面一行，
 * 是这一层里唯一有可能把颜色漏下来的东西。
 */
const TRANSPARENT = ['.root', '.middle', '.main-col', '.spacer']

/**
 * 设置页的「字 / 它脚下的面」对，用来量可读性。
 *
 * 设置页是全应用里唯一一屏同时有好几种面的文档：左栏是凹面、卡片是浮面、
 * 按钮与选中按钮各是一层。浅色主题下它们各自取色，换到深色最容易剩下
 * 「浅底浅字」——那不需要任何变量出错，只需要有一处忘了跟。而这一页从 1.5.1 起
 * 固定落在纸白那一份上（它不写主题名），因此它得先在这一份上站得住。
 *
 * 写成 [名字, 字的选择器, 面的选择器]：多数时候两者是同一个元素，
 * 只有品牌字那种自己不画底、坐在左栏上的才分得开。
 */
const READABLE = [
  ['侧栏品牌', '.brand', '.brand'],
  ['侧栏导航', '.nav-item:not(.active)', '.nav-item:not(.active)'],
  ['侧栏当前项', '.nav-item.active', '.nav-item.active'],
  ['页标题', 'h2', 'h2'],
  ['设置项名', '.field > label', '.card'],
  ['说明文字', '.hint', '.card'],
  ['按钮', '.control button:not(.on)', '.control button:not(.on)'],
  ['选中按钮', '.control button.on', '.control button.on'],
  ['行内代码', 'code', 'code'],
  ['球图标', '.ball-icons .ball-chip:not(.on)', '.ball-icons .ball-chip:not(.on)'],
  ['球图标选中', '.ball-icons .ball-chip.on', '.ball-icons .ball-chip.on']
]

/** 逐个量圆角的元素。缺了就报 null，不编 */
const RADIUS_SELECTORS = ['.address-toggle', '.tab', '.fallback', '.count', '.float-key', '.ball']

const VAR_NAMES = [
  '--zhituan-alpha',
  '--zhituan-surface',
  '--zhituan-surface-hover',
  '--zhituan-surface-active',
  '--zhituan-border',
  '--zhituan-hairline',
  '--zhituan-surface-rgb',
  '--zhituan-surface-hover-rgb',
  '--zhituan-surface-active-rgb',
  '--zhituan-border-rgb',
  '--zhituan-hairline-rgb',
  '--zhituan-ink',
  '--zhituan-text',
  '--zhituan-text-dim',
  '--zhituan-text-faint',
  '--zhituan-accent',
  '--zhituan-accent-hover',
  '--zhituan-accent-soft',
  '--zhituan-danger',
  '--zhituan-sunken',
  '--zhituan-sunken-hover',
  '--zhituan-danger-soft',
  '--zhituan-selected',
  '--zhituan-on-fill',
  '--zhituan-radius',
  '--zhituan-radius-sm',
  '--zhituan-radius-md',
  '--zhituan-radius-pill',
  '--zhituan-radius-tag',
  '--zhituan-radius-track',
  '--zhituan-font',
  '--zhituan-panel',
  '--zhituan-ground',
  '--radius',
  '--radius-sm',
  '--radius-pill',
  /*
   * 起始页那一套名字（--ground/--text/…）。它们与上面那批 --zhituan-* 是同一个
   * 主题里的两套叫法，值在 themes.css 里各写一遍。这一版把它们也读回来，
   * 是因为 Q6 要量起始页自己的对比度——那三套主题现在只落在起始页上，
   * 不量它就没有任何一处量过夜与磷绿的配色了。
   */
  '--ground',
  '--text',
  '--text-secondary',
  '--text-tertiary',
  '--accent',
  '--divider',
  '--tile',
  '--font'
]

/**
 * 在页面里读一圈事实。
 *
 * 全部返回原始事实，判定放在 Node 这侧：探针的价值一半在于报告，
 * 判定散在页面字符串里就没法连起来看了。
 */
const COLLECT = `(async () => {
  const root = getComputedStyle(document.documentElement)
  const names = ${JSON.stringify(VAR_NAMES)}
  const vars = {}
  for (const n of names) vars[n] = root.getPropertyValue(n).trim()

  /*
   * 颜色归一。
   *
   * 先问 CSS.supports，再交给引擎自己序列化——这样"变量没解析出来"（空串）
   * 与"值写坏了"（不是颜色）都会如实报成 null，而不是悄悄变成黑色。
   *
   * 读 ctx.fillStyle 的字符串而不是画一个像素再读回来：像素是 8 位**预乘**存的，
   * 低 alpha 的颜色在那里会掉精度——rgba(37, 99, 235, 0.1) 读回来成了
   * (39, 98, 235, 0.102)，看着像颜色变了，其实只是 0.1×255 存不进一个字节。
   * 万一哪一代引擎改用 color(srgb …) 序列化，再退回读像素。
   */
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const toRgba = (value) => {
    if (!value || !CSS.supports('color', value)) return null
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    const text = String(ctx.fillStyle)
    let m = /^#([0-9a-f]{6})$/i.exec(text)
    if (m) {
      const n = parseInt(m[1], 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
    }
    m = /^rgba?\\(([^)]+)\\)$/i.exec(text)
    if (m) {
      const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
      return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 1000) / 1000 : 1]
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000]
  }

  const colors = {}
  for (const n of names) colors[n] = toRgba(vars[n])

  const lum = ([r, g, b]) => {
    const f = (c) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contrast = (a, b) => {
    const la = lum(a)
    const lb = lum(b)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }

  // 面用三通道那一份：它不带 alpha，是"这张面本身是什么颜色"，
  // 而 --zhituan-surface 可能被 --zhituan-alpha 乘淡过，拿它算对比度会随滑块浮动
  const rgbTriple = vars['--zhituan-surface-rgb'].split(/\\s+/).map(Number)
  const face = rgbTriple.length === 3 && rgbTriple.every(Number.isFinite) ? rgbTriple : null
  const onFace = (name) => (face && colors[name] ? contrast(colors[name], face) : null)

  /*
   * 「这个元素底下实际是什么颜色」——自下而上把祖先的底色一层层叠起来。
   *
   * 量设置页必须这么量：那里好几张面是半透明的（选中按钮是 10% 的强调色），
   * 单独读它自己的 background-color 得到的是 rgba(37, 99, 235, 0.1)，
   * 拿这个算对比度等于在跟一张不存在的面比。叠到第一张实色为止，
   * 得到的才是眼睛看到的那一块。
   */
  const composite = (layers) => {
    let out = layers[0].slice(0, 3)
    let alpha = layers[0][3]
    for (let i = 1; i < layers.length; i += 1) {
      const c = layers[i]
      const next = c[3] + alpha * (1 - c[3])
      if (next <= 0) {
        out = c.slice(0, 3)
        alpha = 0
        continue
      }
      out = [0, 1, 2].map((k) => (c[k] * c[3] + out[k] * alpha * (1 - c[3])) / next)
      alpha = next
    }
    return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2]), Math.round(alpha * 1000) / 1000]
  }

  const backdropOf = (el) => {
    const chain = []
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const c = toRgba(getComputedStyle(node).backgroundColor)
      if (c && c[3] > 0) chain.push(c)
      if (c && c[3] > 0.999) break
    }
    // 一路走到根都没有实色（chrome 与面板正是这样，它们故意全透明）→ 算不出来
    if (!chain.length) return null
    return composite(chain.reverse())
  }

  const measureReadable = () => {
    const out = []
    for (const [name, fgSel, bgSel] of ${JSON.stringify(READABLE)}) {
      let fg = null
      let bg = null
      try {
        fg = document.querySelector(fgSel)
        bg = document.querySelector(bgSel)
      } catch (error) {
        fg = null
      }
      // 这一栏里没有这个东西是正常的：设置项分在五个分栏里
      if (!fg || !bg) {
        out.push([name, null])
        continue
      }
      const style = getComputedStyle(fg)
      const ink = toRgba(style.color)
      const back = backdropOf(bg)
      const opaque = back && back[3] > 0.99
      out.push([
        name,
        {
          ink,
          back,
          fontSize: parseFloat(style.fontSize),
          fontWeight: Number(style.fontWeight) || 400,
          ratio: ink && opaque ? contrast(ink.slice(0, 3), back.slice(0, 3)) : null
        }
      ])
    }
    return out
  }

  /*
   * 逐栏量。
   *
   * 设置项分在五个分栏里（通用 / 隐蔽 / 快捷键 / 数据 / 关于），一屏只画一栏。
   * 只量当前这一栏的话，另外四栏的毛病要等用户点过去才会被发现——而那正是
   * 这次改动的题目：换了主题，每一栏都得站得住。切栏只改一个 ref，不会写配置。
   *
   * 用定时器等一帧，不用 requestAnimationFrame：探针那个窗口是 show: false 的，
   * 从没露过面的页面拿不到 rAF 回调——await 一个永远不来的回调，整个探针就
   * 挂在那儿了（第一版正是这么挂死的）。微任务队列一空，DOM 就是新的了。
   */
  const frame = () => new Promise((r) => setTimeout(r, 0))
  const sections = []
  const nav = Array.from(document.querySelectorAll('.nav-item'))
  for (const item of nav) {
    item.click()
    await frame()
    sections.push([item.textContent.trim(), measureReadable()])
  }
  if (nav.length) {
    nav[0].click()
    await frame()
  }

  const bg = {}
  for (const sel of ${JSON.stringify([...TRANSPARENT, '.topbar', '.rail', 'html', '.layout', '.content', '.sidebar', '.nav-item.active', '.card', '.panel', '.start', '.brand'])}) {
    let el = null
    try {
      el = document.querySelector(sel)
    } catch (error) {
      el = null
    }
    bg[sel] = getComputedStyle(el ?? document.documentElement).backgroundColor
  }

  /*
   * body::after 是终端世界那层扫描线与暗角。它是铺满视口的覆盖层，
   * 只许出现在起始页——因此这里把它的几何原样报出来，让 Node 那侧判定
   * "有没有铺满整个视口"。
   */
  const after = getComputedStyle(document.body, '::after')

  const radius = {}
  for (const sel of ${JSON.stringify(RADIUS_SELECTORS)}) {
    const el = document.querySelector(sel)
    radius[sel] = el ? getComputedStyle(el).borderTopLeftRadius : null
  }

  return {
    theme: document.documentElement.dataset.theme ?? null,
    world: document.documentElement.dataset.world ?? null,
    vars,
    colors,
    face,
    contrast: {
      ink: onFace('--zhituan-ink'),
      text: onFace('--zhituan-text'),
      'text-dim': onFace('--zhituan-text-dim'),
      'text-faint': onFace('--zhituan-text-faint'),
      accent: onFace('--zhituan-accent')
    },
    bg,
    radius,
    sections,
    body: {
      background: getComputedStyle(document.body).backgroundColor,
      textShadow: getComputedStyle(document.body).textShadow,
      fontFamily: getComputedStyle(document.body).fontFamily
    },
    after: {
      content: after.content,
      position: after.position,
      width: after.width,
      height: after.height,
      top: after.top,
      left: after.left,
      pointerEvents: after.pointerEvents
    },
    viewport: [window.innerWidth, window.innerHeight]
  }
})()`

/**
 * 挂上提示条之后单独读一圈。
 *
 * 比上面那份 COLLECT 窄得多，因为它要问的东西就三样：这一行画在哪儿、
 * 颜色从哪儿来、它下面那块留白还是不是空的。整份 COLLECT 里那些分栏、
 * 可读性、圆角表都不必再量一遍——同一份文档、同一套主题，上面已经量过。
 */
const COLLECT_NOTICE = `(() => {
  const root = getComputedStyle(document.documentElement)
  const cv = document.createElement('canvas')
  cv.width = 1
  cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const toRgba = (value) => {
    if (!value || !CSS.supports('color', value)) return null
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    const text = String(ctx.fillStyle)
    let m = /^#([0-9a-f]{6})$/i.exec(text)
    if (m) {
      const n = parseInt(m[1], 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
    }
    m = /^rgba?\\(([^)]+)\\)$/i.exec(text)
    if (m) {
      const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number)
      return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 1000) / 1000 : 1]
    }
    return null
  }
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const look = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      text: (el.textContent ?? '').trim(),
      color: toRgba(s.color),
      background: toRgba(s.backgroundColor),
      borderBottom: toRgba(s.borderBottomColor),
      borderBottomWidth: s.borderBottomWidth,
      radius: s.borderTopLeftRadius,
      fontSize: parseFloat(s.fontSize),
      box: box(el)
    }
  }
  const spacer = document.querySelector('.spacer')
  /*
   * 版面变量写在 .root 上，不在 :root 上——ChromeApp 的 geometryVars 是一份
   * :style。从 documentElement 读回来是空串，而空串最容易被读成「变量没了」。
   */
  const chromeRoot = document.querySelector('.root')
  return {
    theme: document.documentElement.dataset.theme ?? null,
    world: document.documentElement.dataset.world ?? null,
    /* 主进程下发的高度（geometryVars 里的 --zhituan-notice-h），与常量是同一个数 */
    noticeVar: chromeRoot
      ? getComputedStyle(chromeRoot).getPropertyValue('--zhituan-notice-h').trim()
      : '',
    tokens: {
      surface: toRgba(root.getPropertyValue('--zhituan-surface').trim()),
      surfaceHover: toRgba(root.getPropertyValue('--zhituan-surface-hover').trim()),
      hairline: toRgba(root.getPropertyValue('--zhituan-hairline').trim()),
      ink: toRgba(root.getPropertyValue('--zhituan-ink').trim()),
      textDim: toRgba(root.getPropertyValue('--zhituan-text-dim').trim()),
      accent: toRgba(root.getPropertyValue('--zhituan-accent').trim()),
      accentSoft: toRgba(root.getPropertyValue('--zhituan-accent-soft').trim()),
      radiusSm: root.getPropertyValue('--zhituan-radius-sm').trim()
    },
    row: look('.notice-row'),
    text: look('.notice-text'),
    primary: look('.notice-btn.primary'),
    icon: look('.notice-btn.icon'),
    progress: look('.notice-progress'),
    topbar: document.querySelector('.topbar') ? box(document.querySelector('.topbar')) : null,
    rail: document.querySelector('.rail') ? box(document.querySelector('.rail')) : null,
    /* 底色报原始字符串：判「是不是逐像素透明」要比的是 rgba(0, 0, 0, 0) 这个原话 */
    spacer: spacer ? { ...box(spacer), background: getComputedStyle(spacer).backgroundColor } : null,
    viewport: [window.innerWidth, window.innerHeight]
  }
})()`

/**
 * 顶上那一栏在这三种状态下各量一圈。
 *
 * 起始页与系统设置不是标签页：它们不进标签条，各有各的入口键（顶栏最左并排的
 * 那两颗），停在其中一屏上时**没有哪一格是高亮的**。正文区那块原生
 * 视图在预览里不存在，因此这一问能问的只有界面这一圈，而它恰好是这一版
 * 改动最要紧的那一圈：
 *
 * - 标签条没有因为多了这一屏而多出一格（格子数 == 网页标签数）；
 * - 没有哪一格是高亮的（对照起点：点进去之前是有一格亮的）；
 * - 两颗入口键里该亮的那一颗真的亮了，另一颗没亮；
 * - 顶上那两处写字的地方（地址栏开关、标签条让位后那一枚）与起点**逐字相同**
 *   ——它们说的都是「一张网页」，不跟着变成那一屏的名字（用户要求）。
 *
 * 少任何一条，就分不清「进去了」与「什么也没发生」。
 */
const COLLECT_SCREEN = `(async () => {
  const lit = (sel) => {
    const el = document.querySelector(sel)
    return el ? el.classList.contains('on') : null
  }
  const tabs = await window.zhituan.tabs.list()
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null
  return {
    screen: tabs.screen,
    activeTabId: tabs.activeTabId,
    网页标签数: tabs.tabs.length,
    格子数: document.querySelectorAll('.zone .tab').length,
    高亮的格数: document.querySelectorAll('.zone .tab.on').length,
    /* 两颗入口键各自那份 title 是活的（'系统设置' / '回到刚才那张网页'），按 aria-label 定位 */
    起始页键亮着: lit('.topbar button[aria-label="起始页"]'),
    设置键亮着: lit('.topbar button[aria-label="系统设置"]'),
    地址栏开关: text('.topbar .address-toggle .ellipsis'),
    下拉按钮: text('.zone .fallback .title')
  }
})()`

// ---------------------------------------------------------------- 判定

const results = []
const fail = (id, text) => results.push({ id, ok: false, text })
const pass = (id, text) => results.push({ id, ok: true, text })

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const show = (c) => (c ? `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}@${c[3]}` : 'null')

/**
 * WCAG 的相对亮度与对比度。与页面里那两份同名函数一字不差地重复了一遍。
 *
 * 重复而不是把它从页面里带出来：页面那一份算的是「元素上量到的字与它脚下的面」，
 * 要自下而上叠好几层（composite），非在页面里算不可；而 Q6 后半段要算的是
 * **两个变量之间**的关系，两边都已经归一成四通道带回来了，在 Node 这侧算更省事、
 * 也更清楚。两份式子必须一致，改一处就得改另一处。
 */
const relLum = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const la = relLum(a)
  const lb = relLum(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/**
 * 计算值的 0 写成 0px，而自定义属性里写的 0 就是 0。
 *
 * 同一个「直角」有两种写法，比之前得先把它们并成一种——否则磷绿主题下
 * 「令牌声明了 0、元素也真的是 0px」会被判成不一致（Q8 遇到过同一件事，
 * 那里用的是正则）。
 */
const zeroish = (v) => (v === '0' ? '0px' : v)
/** 上两张表写成 `'#rrggbb', alpha` 更好读，比的时候换成与页面一致的四通道 */
const expectRgba = ([hex, alpha]) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

function checkPaperPinned(paper) {
  const bad = []
  for (const [name, want] of Object.entries({ ...PAPER_EXPECT, ...PAPER_SHAPE })) {
    if (typeof want === 'string') {
      if (paper.vars[name] !== want) bad.push(`${name} 要 ${want} 实为 ${paper.vars[name] || '(空)'}`)
      continue
    }
    const got = paper.colors[name]
    if (!same(got, expectRgba(want))) bad.push(`${name} 要 ${show(expectRgba(want))} 实为 ${show(got)}`)
  }
  if (!paper.vars['--zhituan-font'].includes('Microsoft YaHei')) {
    bad.push(`--zhituan-font 该是无衬线栈，实为 ${paper.vars['--zhituan-font'] || '(空)'}`)
  }
  if (paper.vars['--zhituan-font'].includes('Cascadia Mono')) {
    bad.push('--zhituan-font 在界面里不该是等宽')
  }
  if (bad.length) fail('Q1', `纸白定格：界面那几条 --zhituan-* 与定格表不一致 —— ${bad.join('；')}`)
  else pass('Q1', `纸白定格：${Object.keys(PAPER_EXPECT).length + Object.keys(PAPER_SHAPE).length} 条 --zhituan-* 与定格表逐条相同`)
}

/** 一套主题的"指纹"：配色变了它就变，用来问"起始页那三套互不相同" */
const fingerprint = (page) =>
  ['--zhituan-surface-rgb', '--zhituan-hairline-rgb', '--zhituan-ink', '--zhituan-accent', '--zhituan-ground', '--ground']
    .map((n) => page.vars[n])
    .join('|')

/**
 * 两份读数不一样在哪儿。空数组就是逐条相同。
 *
 * 比的是**量出来的全部东西**：根上那两个属性、每个变量、归一后的每个颜色、
 * 逐元素量的底色与圆角、body 的字形与发光、以及设置页五个分栏各元素的
 * 字/底对比度读数。全比而不是挑几个，是因为这一版要证明的正是「主题在
 * 这四份文档上一寸都没挪」——挑着比就等于把没挑的那几处当成不会动。
 * 报出来的是**字段名**而不是全文 diff：失败时要一眼看出是配色漏了还是排版漏了。
 */
function diffReading(a, b) {
  const out = []
  for (const key of ['theme', 'world', 'body', 'bg', 'radius', 'after']) {
    if (!same(a[key], b[key])) out.push(key)
  }
  const vars = Object.keys(a.vars).filter((n) => a.vars[n] !== b.vars[n])
  if (vars.length) out.push(`变量 ${vars.join('/')}`)
  const colors = Object.keys(a.colors).filter((n) => !same(a.colors[n], b.colors[n]))
  if (colors.length) out.push(`颜色 ${colors.join('/')}`)
  if (!same(a.sections, b.sections)) out.push('设置页各栏的可读性读数')
  return out
}

/**
 * 本版的核心：主题只动起始页那一份文档。
 *
 * 两头都要问，缺一头这个断言就等于没写：
 *
 * · 四份文档（界面 / 面板 / 设置 / PDF）在**同一套入参下量三次**，三次必须逐条
 *   相同、且等于纸白那一份。少问一份，"改了没反应"就从那一份冒出来；
 *   只问变量不问量出来的读数，"变量对了但元素没用它"又漏了。
 * · 起始页那三次必须**两两不同**，且根上真的写着主题名与形态名。少了这一头，
 *   把 applyThemeToDocument 整个删掉，上面那四条会全绿——那正是最坏的一种绿。
 */
function checkScope(byPage) {
  const bad = []
  const lines = []
  for (const page of THEMED_ONLY_HOME) {
    const base = byPage[page].paper
    for (const t of THEMES) {
      const got = byPage[page][t.id]
      if (got.theme !== null) bad.push(`${page}/${t.id} 的根上写着 data-theme=${got.theme}，这一份文档不该写主题`)
      if (got.world !== null) bad.push(`${page}/${t.id} 的根上写着 data-world=${got.world}，这一份文档不该写形态`)
      const d = diffReading(base, got)
      if (d.length) bad.push(`${page} 在 ${t.id} 下与纸白不同：${d.join('、')}`)
    }
    lines.push(`${page} ×3 相同`)
  }
  const prints = THEMES.map((t) => fingerprint(byPage.home[t.id]))
  if (new Set(prints).size !== THEMES.length) {
    bad.push(`起始页的三套主题有重样的：${JSON.stringify(prints)}`)
  }
  for (const t of THEMES) {
    const got = byPage.home[t.id]
    if (got.theme !== t.id) bad.push(`起始页/${t.id} 的 data-theme 是 ${got.theme}，该是 ${t.id}`)
    if (got.world !== t.world) bad.push(`起始页/${t.id} 的 data-world 是 ${got.world}，该是 ${t.world}`)
  }
  if (bad.length) fail('Q2', `主题没守住「只管起始页」这条边界 —— ${bad.join('；')}`)
  else {
    pass(
      'Q2',
      `主题只落在起始页：界面 / 面板 / 设置 / PDF 四份文档在纸白、暗夜、磷绿下逐条相同（${lines.join('，')}），` +
        `而起始页那一屏三套各不相同、根上写着 data-theme 与 data-world`
    )
  }
}

/**
 * 终端形态（直角、等宽、发光）同样只在起始页。
 *
 * 上一版这一问问的是反过来的事（「形态跟进了界面」）。两头都要看：磷绿下
 * 起始页必须真的变直角、换等宽、字发光；而界面那几份必须**仍是纸白那一副**
 * ——那里的半径与字体由 Q2 逐条比过，这里只再点名一次字形与发光，
 * 因为它们是这两条里最容易被 text-shadow 这种可继承属性串门的东西。
 */
function checkTerminalShape(home, chrome) {
  const bad = []
  for (const n of [
    '--zhituan-radius',
    '--zhituan-radius-sm',
    '--zhituan-radius-md',
    '--zhituan-radius-pill',
    '--zhituan-radius-tag',
    '--zhituan-radius-track',
    '--radius',
    '--radius-sm',
    '--radius-pill'
  ]) {
    // 计算值一律是 px，0 会写成 0px
    if (!/^0(px)?$/.test(home.vars[n])) bad.push(`起始页的 ${n} 该是 0，实为 ${home.vars[n] || '(空)'}`)
  }
  if (!home.vars['--zhituan-font'].includes('Cascadia Mono')) {
    bad.push(`起始页的 --zhituan-font 该是等宽栈，实为 ${home.vars['--zhituan-font'] || '(空)'}`)
  }
  if (!home.vars['--font'].includes('Cascadia Mono')) {
    bad.push(`起始页的 --font 该是等宽栈（终端世界里展示字就是它），实为 ${home.vars['--font'] || '(空)'}`)
  }
  if (!home.body.textShadow || home.body.textShadow === 'none') {
    bad.push('起始页的字没有发光：body 的 text-shadow 是 none')
  }
  // 界面那一头：字形与发光都要留在纸白那一副上
  if (chrome.vars['--font'].includes('Cascadia Mono') || chrome.body.fontFamily.includes('Cascadia Mono')) {
    bad.push(`界面的字在磷绿下变成了等宽：${chrome.body.fontFamily}`)
  }
  if (chrome.body.textShadow && chrome.body.textShadow !== 'none') {
    bad.push(`界面的字在磷绿下发光了：${chrome.body.textShadow}`)
  }
  if (bad.length) fail('Q3', `终端形态越界了 —— ${bad.join('；')}`)
  else {
    pass(
      'Q3',
      `终端形态只在起始页：磷绿下那一页半径全 0、字体等宽（${home.vars['--zhituan-font'].split(',')[0]}）、字带发光，` +
        `而界面的字仍是无衬线栈、不发光`
    )
  }
}

/**
 * 直角验到元素上。
 *
 * 变量对了不等于元素用了它——把 `border-radius: 13px` 改成
 * `var(--zhituan-radius-pill)` 时打错一个字母，值会静静地退回初始的 0，
 * 而 0 恰好也是终端世界的目标值，于是"改对了"和"改坏了"在磷绿下长得一样。
 * 因此在纸白下把这两处的实测圆角与改前的字面量对一次。
 *
 * 磷绿那一半改问「与纸白逐条相同」：这一版起，界面**不该**再跟着形态走，
 * 所以「磷绿下是 0px」这个期望本身已经错了，而它错得很隐蔽——真按它判，
 * 一个正确的实现会被报成失败。
 */
function checkRadius(paper, crt) {
  const bad = []
  for (const [sel, want] of Object.entries(PAPER_RADIUS)) {
    const got = paper.radius[sel]
    if (got === null) bad.push(`纸白下找不到 ${sel}，量不到圆角`)
    else if (got !== want) bad.push(`纸白下 ${sel} 的圆角是 ${got}，定格表写的是 ${want}`)
  }
  for (const sel of Object.keys(PAPER_RADIUS)) {
    const got = crt.radius[sel]
    if (got !== paper.radius[sel]) bad.push(`磷绿下 ${sel} 的圆角是 ${got}，界面不该跟着形态走（纸白是 ${paper.radius[sel]}）`)
  }
  if (bad.length) fail('Q8', `圆角越界了 —— ${bad.join('；')}`)
  else {
    pass(
      'Q8',
      `圆角两头顶住了：纸白下 ${Object.entries(PAPER_RADIUS).map(([s, v]) => `${s} ${v}`).join(' / ')}，` +
        `磷绿下同一批元素仍是这些值（界面不跟着形态走）`
    )
  }
}

function checkAlpha(alpha) {
  const bad = []
  if (alpha.vars['--zhituan-alpha'] !== '0.4') bad.push(`--zhituan-alpha 是 ${alpha.vars['--zhituan-alpha'] || '(空)'}，该是 0.4`)
  const surface = alpha.colors['--zhituan-surface']
  if (!surface) bad.push('--zhituan-surface 读不成颜色（多半是 var() 没接上）')
  else {
    if (surface[3] !== 0.4) bad.push(`--zhituan-surface 的 alpha 是 ${surface[3]}，该是 0.4`)
    if (surface.slice(0, 3).join() !== '255,255,255') bad.push(`--zhituan-surface 的色相被改动了：${show(surface)}`)
  }
  // 强调色是"状态"，不跟着底板变淡
  if (alpha.colors['--zhituan-accent'] && alpha.colors['--zhituan-accent'][3] !== 1) {
    bad.push(`--zhituan-accent 也跟着淡了：${show(alpha.colors['--zhituan-accent'])}`)
  }
  if (bad.length) fail('Q4', `背景透明度没接上 —— ${bad.join('；')}`)
  else pass('Q4', '背景透明度仍然只淡底板：0.4 时 --zhituan-surface 是 rgb(255 255 255 / 0.4)，强调色不动')
}

/**
 * 透明中部有没有被弄坏，以及那层铺满视口的覆盖层有没有跑出起始页。
 *
 * 中部那几块只在界面这一份里（`.root/.middle/.main-col/.spacer`），因此逐主题量的是
 * chrome：三套入参下都必须逐像素透明——这一版它本来就不该跟着主题变，量三次是
 * 顺带把 Q2 的结论落到**实际画出来的字节**上（变量相同不等于画出来相同）。
 *
 * 后半段是 `body::after`：终端世界的扫描线与暗角，它是铺满视口的覆盖层，
 * 一旦落在界面这一份上，桌面上就多蒙一层膜。如今那段规则在 home.css 里、
 * 只有 home.html 加载它，够不着别处；但仍逐页量——省掉这一条，代价是
 * 某天它被搬进一份共用样式表时没人报得出来。起始页那一头同时问正反两面：
 * 磷绿下**该有**（那一页的屏就是这样的），纸白下**不该有**。
 */
function checkTransparent(byPage) {
  const bad = []
  const chrome = byPage.chrome
  for (const t of THEMES) {
    const page = chrome[t.id]
    for (const sel of TRANSPARENT) {
      const got = page.bg[sel]
      if (got !== 'rgba(0, 0, 0, 0)') bad.push(`${t.id} 的界面里 ${sel} 画了底色 ${got}`)
    }
  }
  const fills = (page) => {
    const after = page.after
    return (
      after.content !== 'none' &&
      after.content !== 'normal' &&
      after.position === 'fixed' &&
      after.width === `${page.viewport[0]}px` &&
      after.height === `${page.viewport[1]}px`
    )
  }
  for (const page of THEMED_ONLY_HOME) {
    for (const t of THEMES) {
      if (fills(byPage[page][t.id])) {
        bad.push(`${t.id} 下 ${page} 的 body::after 是一层铺满视口的覆盖层，它会把桌面盖住`)
      }
    }
  }
  for (const t of THEMES) {
    const got = fills(byPage.home[t.id])
    const want = t.world === 'terminal'
    if (got !== want) {
      bad.push(`起始页在 ${t.id} 下的扫描线${got ? '有' : '没有'}，这一套${want ? '该有' : '不该有'}`)
    }
  }
  if (bad.length) fail('Q5', `透明中部被弄坏了 —— ${bad.join('；')}`)
  else {
    pass(
      'Q5',
      `三套入参下界面的 ${TRANSPARENT.join(' / ')} 一律逐像素透明；铺满视口的 body::after 只在磷绿的起始页上有，` +
        `界面 / 面板 / 设置 / PDF 四份都没有`
    )
  }
}

/**
 * 对比度。
 *
 * 两头都量，因为这一版主题只剩起始页那一份在用：
 *
 * · 界面那一头是**纸白**——--zhituan-* 对 --zhituan-surface-rgb 那一张面。这是
 *   上一版量过的同一批数，只是不再逐主题量（三套相同这件事 Q2 已经证过）。
 * · 起始页那一头是**三套主题各自的配色**——--text/--text-secondary/--text-tertiary
 *   对 --ground。不量它，夜与磷绿这两套配色就一处也没量过了：它们今天只落在
 *   起始页上。三级字量的是**页底**而不是某张面：起始页那行 11px 的注脚就落在
 *   页底上，压面合格压页底不合格等于没量（themes.css 里 #767e8c 那一档正是
 *   这么被否掉的）。
 */
function checkContrast(byPage) {
  const bad = []
  const lines = []
  const chrome = byPage.chrome.paper
  lines.push(
    `界面(纸白): ${Object.entries(chrome.contrast)
      .map(([k, v]) => `${k} ${v}`)
      .join(' / ')}`
  )
  for (const [name, value] of Object.entries(chrome.contrast)) {
    if (value === null) bad.push(`界面的 ${name} 算不出对比度（颜色没解析出来）`)
    else if (value < 4.5) bad.push(`界面的 ${name} 只有 ${value}:1，低于 4.5:1`)
  }
  for (const t of THEMES) {
    const page = byPage.home[t.id]
    const ground = page.colors['--ground']
    if (!ground || ground[3] < 0.999) {
      bad.push(`起始页/${t.id} 的 --ground 读不成实色：${show(ground)}`)
      continue
    }
    const got = []
    for (const name of ['--text', '--text-secondary', '--text-tertiary', '--accent']) {
      const ink = page.colors[name]
      if (!ink) {
        bad.push(`起始页/${t.id} 的 ${name} 算不出对比度`)
        continue
      }
      const ratio = contrast(ink.slice(0, 3), ground.slice(0, 3))
      got.push(`${name.replace('--', '')} ${ratio}`)
      if (ratio < 4.5) bad.push(`起始页/${t.id} 的 ${name} 压页底只有 ${ratio}:1（${show(ink)} on ${show(ground)}），低于 4.5:1`)
    }
    lines.push(`起始页(${t.id}): ${got.join(' / ')}`)
  }
  if (bad.length) fail('Q6', `对比度不达标 —— ${bad.join('；')}`)
  else pass('Q6', `字与强调色都 ≥ 4.5:1（${lines.join('；')}）`)
}

/**
 * 设置页的可读性。
 *
 * 这一条查的是**元素上量得到的结果**，不是变量里写了什么：主题层把变量接过来了，
 * 元素忘了用它，两边的报告都会是绿的。左栏那块板子尤其典型——它过去写死成
 * #eef0f3，字跟着主题变成浅色之后，「浅底浅字」在纸白下看不出任何异常。
 *
 * 上一版这里逐主题量，问的是「换到夜与磷绿还读不读得出来」。这一版设置页
 * **不跟着主题走**（1.5.1 起），于是这一问变成了两件事：
 *
 * · 纸白下这一页仍然处处站得住（原来的那一问，判据一条没放松）；
 * · 三套入参下的读数**一模一样**——这一半由 Q2 的 diffReading 断言
 *   （它比的正是这份 sections），这里把三次都跑一遍，是为了让「相同」这件事
 *   建立在**量出来的数**上，而不是建立在「代码里没写主题」这句自述上。
 *
 * 阈值按字号分档（WCAG 的大字 3:1），免得把一个 15px 的粗标题判成不合格。
 */
function checkReadable(byTheme) {
  const bad = []
  const lines = []
  for (const t of THEMES) {
    const sections = byTheme.settings[t.id].sections
    if (!sections.length) {
      bad.push(`${t.id} 的设置页量不出分栏（.nav-item 一个都没有）`)
      continue
    }
    let worst = null
    for (const [section, pairs] of sections) {
      for (const [name, got] of pairs) {
        if (!got) continue
        const large = got.fontSize >= 18.66 || (got.fontSize >= 14 && got.fontWeight >= 700)
        const need = large ? 3 : 4.5
        if (got.ratio === null) {
          bad.push(`${t.id} 的「${section} / ${name}」算不出对比度：底色不是实色（${show(got.back)}）`)
          continue
        }
        if (got.ratio < need) {
          bad.push(
            `${t.id} 的「${section} / ${name}」只有 ${got.ratio}:1（要 ≥ ${need}）：字 ${show(got.ink)} 底 ${show(got.back)}`
          )
        }
        if (!worst || got.ratio < worst.ratio) worst = { name: `${section}/${name}`, ratio: got.ratio }
      }
    }
    if (worst) lines.push(`${t.id}: ${worst.name} ${worst.ratio}`)
  }
  if (bad.length) fail('Q9', `设置页有字读不出来 —— ${bad.slice(0, 6).join('；')}${bad.length > 6 ? `（另 ${bad.length - 6} 处）` : ''}`)
  else pass('Q9', `设置页五个分栏的字都压得住自己的底，三套入参下逐条相同（最紧的一处 ${lines.join('；')}）`)
}

/**
 * 提示条画出来了没有，以及它有没有把中部染上色。
 *
 * 「画出来了」在这里有几层意思：DOM 在（`.notice-row` 取得到）、尺寸对（正好
 * NOTICE_H 高、正好占正文那一栏宽）、位置对（顶栏之下）、**中部还在它下面**
 * （`.spacer` 的高度与起点都分毫不差），而且那中部仍然是逐像素透明的。
 * 最后一条才是这一组存在的理由：提示条是这一层里唯一一块**实底**，
 * 它的底色只要顺着 flex 落到 `.main-col` 上，桌面上就多蒙了一块——那在截图里
 * 看着只是「背景色有点不对」。
 *
 * 三套入参各挂一次而不是只挂一次：界面从 1.5.1 起不跟主题走，三次本该完全一样，
 * 而「本该一样」正是要量出来的东西——真去挂一次的话，某天提示条又把
 * ui.homeTheme 读回来（比如有人给它加了个按主题换色的分支），这一问不会有任何反应。
 */
function checkNoticeDrawn(withNotice) {
  const bad = []
  const lines = []
  for (const t of THEMES) {
    const page = withNotice[t.id]
    const row = page.row
    if (!row) {
      bad.push(`${t.id} 下没有 .notice-row`)
      continue
    }
    const bodyW = page.viewport[0] - (page.rail?.w ?? 0)
    if (page.noticeVar !== `${NOTICE_H}px`) {
      bad.push(`${t.id} 的 --zhituan-notice-h 是 ${page.noticeVar || '(空)'}，该是 ${NOTICE_H}px`)
    }
    if (row.box.h !== NOTICE_H) bad.push(`${t.id} 的提示条高 ${row.box.h}px，该是 ${NOTICE_H}px`)
    if (row.box.w !== bodyW) bad.push(`${t.id} 的提示条宽 ${row.box.w}px，正文那一栏该是 ${bodyW}px`)
    if (page.topbar && row.box.y !== page.topbar.h) {
      bad.push(`${t.id} 的提示条顶在 y=${row.box.y}，顶栏下沿是 ${page.topbar.h}`)
    }
    if (!page.spacer) bad.push(`${t.id} 下没有 .spacer（中部那块留白）`)
    else {
      if (page.spacer.background !== 'rgba(0, 0, 0, 0)') {
        bad.push(`${t.id} 的中部被染上了底色 ${page.spacer.background}`)
      }
      if (page.spacer.y !== row.box.y + row.box.h) {
        bad.push(`${t.id} 的中部从 y=${page.spacer.y} 起，提示条下沿是 ${row.box.y + row.box.h}`)
      }
      if (page.spacer.h <= 0) bad.push(`${t.id} 的中部没有高度（${page.spacer.h}）`)
    }
    if (page.progress) bad.push(`${t.id} 在 available 态下也画了进度线`)
    if (!page.text || !page.text.text.includes('1.1.0')) {
      bad.push(`${t.id} 的提示条没写出新版本号：${JSON.stringify(page.text?.text ?? null)}`)
    }
    lines.push(`${t.id} ${row.box.w}×${row.box.h}`)
  }
  if (bad.length) fail('Q10', `更新提示条没站住 —— ${bad.join('；')}`)
  else pass('Q10', `三套入参下提示条都画在自己那一行上（${lines.join(' / ')}），紧贴顶栏下沿、中部仍逐像素透明`)
}

/**
 * 这一行的颜色从哪儿来。
 *
 * 逐条与**这一份文档自己读到的令牌**比，而不是比三套互不相同——提示条住在界面里，
 * 而界面从 1.5.1 起不跟主题走，所以正确的画法是三套入参下画出一模一样的一条，
 * 且那一条逐条取自纸白那一份令牌。三条一起才完整：
 *
 * · 与令牌一致，保证它是**从主题层拿的**，不是写死的一串颜色（写死一个 #ffffff，
 *   在纸白下与令牌恰好相等，光看「一致」看不出来）；
 * · 三套入参下相同，保证它**没有**偷偷跟着 ui.homeTheme 走——那正是这一版
 *   收回边界时要防的回头路；
 * · 纸白的 --zhituan-surface 是纯白（Q1 钉着），于是「底色 == 令牌」同时也意味着
 *   这条提示条在默认这一套下是白的，而不是碰巧与某个深色相等。
 */
function checkNoticeTokens(withNotice) {
  const bad = []
  const lines = []
  const paints = []
  for (const t of THEMES) {
    const page = withNotice[t.id]
    const row = page.row
    if (!row) {
      bad.push(`${t.id} 下没有提示条`)
      continue
    }
    const pairs = [
      ['底色', row.background, page.tokens.surface],
      ['文字色', page.text?.color ?? null, page.tokens.textDim],
      ['主按钮字色', page.primary?.color ?? null, page.tokens.accent],
      ['主按钮底色', page.primary?.background ?? null, page.tokens.accentSoft],
      ['关闭键字色', page.icon?.color ?? null, page.tokens.textDim]
    ]
    for (const [name, got, token] of pairs) {
      if (!got || !token) {
        bad.push(`${t.id} 的${name}没量成颜色（实为 ${show(got)}，令牌 ${show(token)}）`)
        continue
      }
      if (!same(got, token)) bad.push(`${t.id} 的${name}是 ${show(got)}，该取令牌 ${show(token)}`)
    }
    if (row.borderBottomWidth !== '1px') bad.push(`${t.id} 的下沿不是 1px（${row.borderBottomWidth}）`)
    else if (!same(row.borderBottom, page.tokens.hairline)) {
      bad.push(`${t.id} 的下沿是 ${show(row.borderBottom)}，该取令牌 ${show(page.tokens.hairline)}`)
    }
    if (page.primary && zeroish(page.primary.radius) !== zeroish(page.tokens.radiusSm)) {
      bad.push(`${t.id} 的主按钮圆角是 ${page.primary.radius}，该取令牌 ${page.tokens.radiusSm}`)
    }
    paints.push(show(row.background))
    lines.push(
      `${t.id} 底 ${show(row.background)} 字 ${show(page.text?.color ?? null)} 主按钮 ${show(page.primary?.background ?? null)}/${show(page.primary?.color ?? null)} 圆角 ${page.primary?.radius ?? '—'}`
    )
  }
  if (paints.length === THEMES.length && new Set(paints).size !== 1) {
    bad.push(`三套入参下提示条画出来的底色不一样：${JSON.stringify(paints)}——它住在界面里，不该跟着主题走`)
  }
  if (bad.length) fail('Q11', `提示条的颜色不对 —— ${bad.join('；')}`)
  else pass('Q11', `提示条的底 / 字 / 强调色 / 圆角逐条取自界面那一份令牌，且三套入参下画出来的完全相同（${lines.join('；')}）`)
}

/**
 * 下载态那条进度线。
 *
 * 它必须画在**已经算进版面**的那 30px 里：这个条的高度是主进程按 NOTICE_H 排给
 * 网页的，进度线只要多占一个像素，网页就被压住一条——而它在截图上看着完全正常。
 * 因此这里同时量宽度（是不是真有 42%）与「行高有没有变」。
 *
 * 顺带把这一态下的两枚按钮也看住：1.3.3 把更新压成两下之后，下载中主按钮写着
 * 「更新并重启」（按下只是把意图记下，下完自己接着装），而 ✕ 是「这一版不要了」
 * 的出口——它会真的把在下的那一份中止掉。这一条原先判的是反过来的
 * 「下载中不给按钮」，见下面注释。
 */
function checkNoticeProgress(withNotice) {
  const bad = []
  const page = withNotice.downloading
  const bar = page.progress
  const row = page.row
  if (!row) bad.push('downloading 态下没有提示条')
  else if (!bar) bad.push('downloading 态下没有 .notice-progress')
  else {
    const want = Math.round((42 / 100) * row.box.w)
    if (Math.abs(bar.box.w - want) > 1) bad.push(`进度线宽 ${bar.box.w}px，42% 该是 ${want}px`)
    if (bar.box.h !== 2) bad.push(`进度线高 ${bar.box.h}px，该是 2px`)
    if (bar.box.y + bar.box.h > row.box.y + row.box.h) bad.push('进度线掉出了提示条')
    if (row.box.h !== NOTICE_H) bad.push(`有进度线时提示条高 ${row.box.h}px，该仍是 ${NOTICE_H}px`)
    if (!same(bar.background, page.tokens.accent)) {
      bad.push(`进度线是 ${show(bar.background)}，该取令牌 ${show(page.tokens.accent)}`)
    }
    if (!page.text || !page.text.text.includes('42%')) {
      bad.push(`文案里没写出进度：${JSON.stringify(page.text?.text ?? null)}`)
    }
    /*
     * 下载中那两枚按钮。这一条原先判的是「下载中不给这两枚」——那是更早一版的
     * 说法，那时下载只由用户点「下载」发起，下的过程中确实没什么可按的。
     * 1.3.3 把更新压成两下之后反过来：主按钮还在，按下去把意图记下、下完自己
     * 接着装（updateService.install）；✕ 也还在，它是「这一版不要了」的出口，
     * 而且现在真的会把在下的那一份中止掉、把半截文件删掉（updateService.ignore）。
     * 判据跟着改成「给了，且写的是那两句话」——否则这一问会在一个几版之前的行为
     * 上一直红着，而它本该看住的是提示条这块版面。
     */
    if (page.primary?.text !== '更新并重启') {
      bad.push(`下载中的主按钮写着 ${JSON.stringify(page.primary?.text ?? null)}，该是「更新并重启」`)
    }
    if (!page.icon) bad.push('下载中该留着 ✕——它是「这一版不要了」的出口，会真的把在下的那一份中止掉')
  }
  if (bad.length) fail('Q12', `下载态那条进度线不成立 —— ${bad.join('；')}`)
  else {
    pass(
      'Q12',
      `下载态下进度线画在 ${show(bar?.background)} 上、宽 ${bar?.box.w}px（42%），行高仍是 ${NOTICE_H}px，` +
        `主按钮写着「更新并重启」、✕ 也留着`
    )
  }
}

/**
 * 停在自家那一屏上时，顶上那一栏对不对。
 *
 * 判据里那两条「格子数 == 网页标签数」与「没有哪一格高亮」是这一问的骨架：
 * 起始页与系统设置曾经是**普通标签页**，各占一格、各带一枚 ✕，点进设置之后
 * 想出来只能去点标签条上那一格。这一版把它们改成「屏」，这两条正是
 * 「不再混在标签里」在界面上唯一看得见的凭据。
 *
 * 后半段是用户报的两次、两条不同的毛病，都在**顶上那两处写字的地方**：
 *
 * 1. 地址栏开关跟着变成了「起始页」「系统设置」——那两个词一出现，顶栏读起来
 *    就像多了一个叫「系统设置」的标签页（1.3.4 修）；
 * 2. 标签条让位后那一枚按钮跟着变成那一屏的名字，而它**是回到网页的唯一入口**
 *    （停在自家那两屏上时标签格看不见）：写的是屏名，用户按下去想回的那张网页
 *    就无从认起（1.3.5 修）。
 *
 * 两条合起来是一句话：这一栏里写字的地方写的都是**一张网页**，
 * 「此刻停在哪一屏」由左上角那两颗键各自的高亮说。因此判据不是「等于某个字」，
 * 而是「与起点逐字相同」——起点那一份是同一次量出来的（见 loadScreen），
 * 这正是用户的要求：点设置的时候这一块**完全不变**。
 *
 * 起点那处读不出来时（标签条放得下就没有那一枚按钮）这一条跳过不判：
 * 没有可比的东西，不该编一个出来。
 */
function checkScreens(page, home, settings) {
  const bad = []
  for (const [screen, got, want] of [
    ['home', home, stringConstant('HOME_TITLE')],
    ['settings', settings, stringConstant('SETTINGS_TITLE')]
  ]) {
    if (got.screen !== screen) bad.push(`${screen} 那一态下 tabs.list().screen 是 ${got.screen}`)
    if (got.activeTabId !== null) bad.push(`${screen} 那一态下 activeTabId 是 ${got.activeTabId}，该是 null`)
    if (got.格子数 !== got.网页标签数) {
      bad.push(`${screen} 那一态下标签条画了 ${got.格子数} 格，网页只有 ${got.网页标签数} 张`)
    }
    if (got.高亮的格数 !== 0) bad.push(`${screen} 那一态下还有 ${got.高亮的格数} 格是高亮的`)
    if (got.起始页键亮着 !== (screen === 'home')) {
      bad.push(`${screen} 那一态下「起始页」那颗键的亮灯是 ${got.起始页键亮着}`)
    }
    if (got.设置键亮着 !== (screen === 'settings')) {
      bad.push(`${screen} 那一态下「设置」那颗键的亮灯是 ${got.设置键亮着}`)
    }
    for (const [name, key] of [
      ['地址栏开关', '地址栏开关'],
      ['标签条让位后那一枚', '下拉按钮']
    ]) {
      // 起点那一态下没有这一处（窗口宽得放得下标签条）→ 没有可比的，不判
      if (page[key] === null) continue
      const wrote = got[key]
      if (wrote === want) {
        bad.push(`${screen} 那一态下${name}上写的是这一屏的名字 ${JSON.stringify(want)}，而它属于网页那一摊`)
      } else if (wrote !== page[key]) {
        bad.push(
          `${screen} 那一态下${name}上写的是 ${JSON.stringify(wrote)}，` +
            `起点写的是 ${JSON.stringify(page[key])}——用户要求这一块完全不变`
        )
      }
    }
  }
  if (bad.length) fail('Q13', `停在自家那一屏上时顶上那一栏没跟上 —— ${bad.join('；')}`)
  else {
    pass(
      'Q13',
      `停在起始页 / 系统设置上时（screen 各自对上、activeTabId 为 null）标签条一格不多、一格不亮，` +
        `两颗入口键各亮各的，而地址栏开关写着 ${JSON.stringify(page.地址栏开关)}、` +
        `标签条让位那一枚写着 ${JSON.stringify(page.下拉按钮)}——都与起点逐字相同，都不是那一屏的名字`
    )
  }
}

/**
 * PDF 阅读页的墨色（Q14）。
 *
 * 用户报的就是这一条：磷绿下整本书的字都成了荧光绿。病根不在 PDF 那一页，
 * 而在边界划错了——1.3.0 让 PDF 那一页也写主题名，于是它的 `--zhituan-ink`
 * 在磷绿下是 #57f08c，键控拿它当墨色把整页每个像素的 RGB 都写成那个绿。
 * 1.5.1 把主题收回起始页，这一页落回 `:root`（纸白，近黑）。
 *
 * 量的是**它的输入**：算好的 --zhituan-ink。读它的那一行在 PdfApp 里只有一行，
 * 且只在模块初始化时跑一次、之后再不重读（见那里的注释），因此「这个变量在
 * 三套主题下都是纸白那一份」就足够说明它画出来的字也是那一份。真去画一本书
 * 是另一个探针的事（spike/pdf-scheme.js 逐像素量过键控的结果）。
 *
 * 三条一起看：三套入参下相同、等于基准那一份、且**不等于磷绿那一份**
 * （最后一条是多余的——前两条成立它必然成立——但报出来最直观：失败信息里
 * 直接写着「磷绿下是 #57f08c，这一页读到的是 #57f08c」，一眼就是那个毛病）。
 */
function checkPdfInk(byPage) {
  const bad = []
  const pdf = byPage.pdf
  /* 基准那一份 = `:root` 里那个值，也正是起始页在纸白下拿到的那个 */
  const base = byPage.home.paper.vars['--zhituan-ink']
  const crt = byPage.home['crt-green'].vars['--zhituan-ink']
  for (const t of THEMES) {
    const got = pdf[t.id].vars['--zhituan-ink']
    if (got !== base) {
      bad.push(`${t.id} 下 PDF 那一页读到的 --zhituan-ink 是 ${got || '(空)'}，该是基准的 ${base}`)
    }
    if (t.id === 'crt-green' && got === crt) {
      bad.push(`磷绿下 PDF 那一页的墨色正是磷绿的 ${crt}——键控会把整本书写成这个颜色`)
    }
  }
  if (bad.length) fail('Q14', `PDF 阅读页的墨色跟着主题走了 —— ${bad.join('；')}`)
  else {
    pass(
      'Q14',
      `PDF 阅读页的墨色不跟主题换：纸白 / 暗夜 / 磷绿三套入参下读到的都是 ${base}（` +
        `磷绿那一套自己的 --zhituan-ink 是 ${crt}，没有落到这一页上）`
    )
  }
}

// ---------------------------------------------------------------- 跑

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

  /**
   * 换一套入参再加载一份文档，读一圈回来。
   *
   * 五份文档 × 三套主题这一圈就是 Q2 的全部依据：入参里只动 ui.homeTheme，
   * 于是「哪几份读数动了」这一问题本身就回答了「主题落在哪一份文档上」。
   */
  const load = async (page, theme, bgAlpha = 1) => {
    opts.theme = theme
    opts.bgAlpha = bgAlpha
    opts.notice = null
    await win.loadFile(path.join(ROOT, 'out', 'renderer', PAGES[page]))
    await wait(1100)
    return win.webContents.executeJavaScript(COLLECT)
  }

  /**
   * 挂上新版本再加载一次界面，量提示条那一组。
   *
   * 与 load 分开而不是给它加个开关：这一组的入参（有新版本、下载到一半）
   * 与上面那些基准是两回事，混在一起量，上面那几条「平时的界面」就会
   * 在一个多出一行的版面上得出读数——那正是提示条上线时最容易漏掉的回归。
   */
  const loadNotice = async (theme, phase = 'available') => {
    opts.theme = theme
    opts.bgAlpha = 1
    opts.notice = '1.1.0'
    opts.noticePhase = phase
    opts.noticePercent = 42
    await win.loadFile(path.join(ROOT, 'out', 'renderer', PAGES.chrome))
    await wait(1100)
    return win.webContents.executeJavaScript(COLLECT_NOTICE)
  }

  const byPage = {}
  for (const page of Object.keys(PAGES)) {
    byPage[page] = {}
    for (const t of THEMES) byPage[page][t.id] = await load(page, t.id)
  }

  /**
   * 顶上那一栏在三种状态下各量一次：正看着一张网页、停在起始页、停在系统设置。
   *
   * 单独加载而不是并进上面那个循环：这是**另一种状态**（没有当前网页），
   * 与那十二问赖以成立的「正看着某张网页」是两回事，混在一起量，
   * 上面那几条基准就会在一个没有当前页的版面上得出读数。
   *
   * 头一次传 null 量的是**起点**：用户对这两屏的要求是「点设置的时候标签页
   * 这部分完全不变」，而「不变」得有个东西可对着比。起点就是那个东西——
   * 三份读数出自同一段脚本、同一次窗口、同一套主题，差一个字都看得出来。
   * （拿上面那份 COLLECT 当基准不行：它量的是另一段脚本、另一种收窄宽度，
   * 而且它读的那些字段里根本没有这两处字。）
   */
  const loadScreen = async (screen) => {
    opts.screen = screen
    await win.loadFile(path.join(ROOT, 'out', 'renderer', PAGES.chrome))
    await wait(1100)
    const got = await win.webContents.executeJavaScript(COLLECT_SCREEN)
    opts.screen = null
    return got
  }
  const screenPage = await loadScreen(null)
  const screenHome = await loadScreen('home')
  const screenSettings = await loadScreen('settings')

  // 背景透明度那一档：只跑一次，用界面问
  const alphaProbe = await load('chrome', 'paper', 0.4)

  // 提示条那一组：三套主题各挂一次，再加一张下载到一半的
  const withNotice = {}
  for (const t of THEMES) withNotice[t.id] = await loadNotice(t.id)
  withNotice.downloading = await loadNotice('paper', 'downloading')

  checkPaperPinned(byPage.chrome.paper)
  checkScope(byPage)
  checkTerminalShape(byPage.home['crt-green'], byPage.chrome['crt-green'])
  checkRadius(byPage.chrome.paper, byPage.chrome['crt-green'])
  checkAlpha(alphaProbe)
  checkTransparent(byPage)
  checkContrast(byPage)
  checkReadable(byPage)
  checkNoticeDrawn(withNotice)
  checkNoticeTokens(withNotice)
  checkNoticeProgress(withNotice)
  checkScreens(screenPage, screenHome, screenSettings)
  checkPdfInk(byPage)

  for (const r of results) console.log(`[${r.id}] ${r.ok ? 'OK  ' : 'FAIL'} ${r.text}`)

  /*
   * 圆角与字形逐主题列一份，界面的与起始页的分开列。
   *
   * 这一行是这一版最直观的那张读数：界面那三行**必须一模一样**（磷绿不该把它
   * 变直角），起始页那一行里磷绿**必须**是 0px 与等宽。光看判据那一行
   * 「Q2 OK / Q3 OK」看不出这件事，而它正是用户要看的那件事。
   */
  for (const t of THEMES) {
    const page = byPage.chrome[t.id]
    const cells = RADIUS_SELECTORS.map((s) => `${s} ${page.radius[s] ?? '—'}`).join('  ')
    console.log(`SHAPE 界面 ${t.id.padEnd(10)} ${cells}  字体 ${page.body.fontFamily.split(',')[0]}`)
  }
  for (const t of THEMES) {
    const page = byPage.home[t.id]
    console.log(
      `SHAPE 起始页 ${t.id.padEnd(10)} --radius ${page.vars['--radius']} --radius-sm ${page.vars['--radius-sm']} --radius-pill ${page.vars['--radius-pill']}  字体 ${page.body.fontFamily.split(',')[0]}  发光 ${page.body.textShadow === 'none' ? '无' : '有'}`
    )
  }

  // 界面上实际画了什么，值得单独看一眼：调色板变了不等于界面用了它
  const painted = {}
  for (const t of THEMES) {
    const page = byPage.chrome[t.id]
    painted[t.id] = {
      topbar: page.bg['.topbar'],
      rail: page.bg['.rail'],
      railFont: page.body.fontFamily,
      settingsGround: byPage.settings[t.id].bg['html'],
      homeGround: byPage.home[t.id].bg['html'],
      pdfInk: byPage.pdf[t.id].vars['--zhituan-ink']
    }
  }
  for (const [id, row] of Object.entries(painted)) {
    console.log(
      `PAINT ${id.padEnd(10)} 顶栏 ${row.topbar} 右栏 ${row.rail} | 设置页底 ${row.settingsGround} | 起始页底 ${row.homeGround} | PDF 墨 ${row.pdfInk}`
    )
  }
  /*
   * 画出来的颜色。两头都问：界面这几处**不该**变，起始页那一处**必须**变。
   *
   * 上一版这一问是反过来的（界面三套各不相同）。反过来之后它反而更难糊弄：
   * 单问「起始页变了」的话，把主题整个铺回去也能通过；单问「界面没变」的话，
   * 把 applyThemeToDocument 删掉也能通过。两条一起才是「只落在起始页」。
   */
  const interfaceSame = THEMES.every(
    (t) =>
      painted[t.id].topbar === painted.paper.topbar &&
      painted[t.id].rail === painted.paper.rail &&
      painted[t.id].settingsGround === painted.paper.settingsGround
  )
  const homeDiffers = new Set(THEMES.map((t) => painted[t.id].homeGround)).size === THEMES.length
  if (!interfaceSame) {
    fail('Q7', '三套入参下界面画出来的颜色不一样——界面从 1.5.1 起不该跟着主题走')
  } else if (!homeDiffers) {
    fail('Q7', `三套主题下起始页画出来的底色一模一样（${painted.paper.homeGround}）——变量有了，那一页没用上`)
  } else {
    pass('Q7', '三套入参下顶栏 / 右栏 / 设置页底逐条相同（都是纸白那一份），而起始页的页底三套各不相同')
  }

  // 设置页面那几块面实际画成了什么。三行必须一模一样——这一页不跟主题走
  for (const t of THEMES) {
    const page = byPage.settings[t.id]
    console.log(
      `SETTINGS ${t.id.padEnd(10)} 左栏 ${page.bg['.sidebar']} 左栏当前项 ${page.bg['.nav-item.active']} 卡面 ${page.bg['.card']}`
    )
  }

  /*
   * PDF 阅读页那一行。这是用户报的那个毛病的位置，单列出来：
   * 「墨」那一列在三套入参下必须一个字符都不变，而磷绿那一套自己的墨色
   * 写在右边做对照——两个数一样就是毛病回来了。
   */
  for (const t of THEMES) {
    console.log(
      `PDFINK ${t.id.padEnd(10)} 这一页读到 ${byPage.pdf[t.id].vars['--zhituan-ink']} | 磷绿那一套自己的 --zhituan-ink ${byPage.home['crt-green'].vars['--zhituan-ink']}`
    )
  }

  // 提示条实际画成了什么。变量有了不等于界面用了它，这一行值得单独看一眼
  for (const t of THEMES) {
    const page = withNotice[t.id]
    console.log(
      `NOTICE ${t.id.padEnd(10)} ${page.text?.text ?? '—'} | 底 ${page.row ? show(page.row.background) : '—'} 字 ${page.text ? show(page.text.color) : '—'} 中部 ${page.spacer?.background ?? '—'}`
    )
  }
  console.log(
    `NOTICE ${'downloading'.padEnd(10)} ${withNotice.downloading.text?.text ?? '—'} | 进度线 ${withNotice.downloading.progress ? `${withNotice.downloading.progress.box.w}×${withNotice.downloading.progress.box.h}` : '—'}`
  )

  /*
   * 顶上那一栏在三态下各自写的是什么，逐条列出来。
   *
   * 这一行是用户要看的那种读数：「点设置的时候标签页这一块完全不变」——
   * 三行里的后两列必须一模一样，光看判据那一行「Q13 OK」看不出这件事。
   */
  for (const [name, got] of [
    ['起点（看着网页）', screenPage],
    ['停在起始页', screenHome],
    ['停在系统设置', screenSettings]
  ]) {
    console.log(
      `SCREEN ${name.padEnd(9)} 地址栏开关 ${JSON.stringify(got.地址栏开关)} 标签条那一枚 ${JSON.stringify(got.下拉按钮)} | 高亮的格 ${got.高亮的格数}/${got.格子数} 起始页键 ${got.起始页键亮着} 设置键 ${got.设置键亮着}`
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, 'theme-chrome.json'),
    JSON.stringify(
      { results, painted, byPage, alphaProbe, withNotice, screenPage, screenHome, screenSettings },
      null,
      2
    )
  )
  console.log(`REPORT spike/out/theme-chrome.json`)

  win.destroy()
  app.exit(failed.length ? 1 : 0)
})

/*
 * 出错必须吵着退出。
 *
 * 页面里抛出来的异常是 executeJavaScript 的 reject，不接就是一个未处理的
 * Promise——主进程不会因此退出，窗口又是隐藏的，于是探针看上去只是「还在跑」。
 * 第一版就栽在这儿：一行忘写插值，整个探针无声无息挂了两分多钟。
 */
process.on('unhandledRejection', (error) => {
  console.error(`[FAIL] 探针自己出错了：${error?.stack ?? error}`)
  app.exit(1)
})
