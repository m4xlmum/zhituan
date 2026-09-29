/**
 * README 的作品级图片：把无头预览抓到的界面原图，合成成几张成品图。
 *
 * 分工是刻意的：
 *
 *   spike/preview.js --out spike/out/readme   负责**抓**——它知道怎么在不显示的窗口里
 *                                             把界面渲染出来，产物是界面的原始截图；
 *   本脚本                                     负责**排**——把原图放进 1920×<实测高> 的黑底版式，
 *                                             加标题、加边框光，再编码成 WebP。
 *
 * 版式的高度是**量出来的**，不是 1080：Windows 会把窗口高度卡在工作区里（任务栏那 48px
 * 不给你），于是请求 1080 得到的是 1032。按 1080 排、按 1032 截，底下就会缺一条——
 * 上一版四格界面图正是这么被切掉下半截的。所以：窗口建完先读回真实尺寸再排版。
 *
 * 之所以不直接改 preview.js 去产成品图：抓图要盯着界面本身对不对，排图要盯着版式好不好看，
 * 两件事的验收标准不同，混在一个脚本里会互相牵制。原图留在 spike/out/readme（gitignore），
 * 成品写进 assets/（进仓库）。
 *
 * 用法：
 *   npx electron spike/readme-assets.js
 *
 * 产物：
 *   assets/banner.webp    名片：项目名 + 定位 + 一张真实的界面图
 *   assets/features.webp  三件能力：悬浮球 / 底板透明 / 三套主题
 *   assets/shots.webp     四张真实界面：起始页 / 终端世界 / 系统设置 / 弹出面板
 *   外加三张 spike/out/readme/verify-*.png：从**编码后的 WebP** 回读出来的缩小图，
 *   用来核对压缩之后还看不看得清（Read 工具看不了 WebP，只能这么看）。
 *
 * 原图不在这里抓：那是 `spike/capture-readme.sh` 的事，它按 CAPTURES 那张表逐张跑
 * spike/preview.js。两者的分工见下。
 *
 * 关于图片格式：README 里的展示图优先用 WebP。本仓库不为此引入 sharp 之类的依赖——
 * Chromium 自己就会编码 WebP（canvas.toDataURL('image/webp')），而这里本来就跑在 Electron 里。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const RAW = path.join(__dirname, 'out', 'readme')
const ASSETS = path.join(__dirname, '..', 'assets')

/*
 * 版式的几个常量。主进程排版里的两个数字要在这里对齐：
 * 顶栏 44px、右栏 48px（@shared/constants），界面图里的内容区就按它们裁。
 */
const TOPBAR = 44
const RAIL = 48
const WIN_W = 1280
const WIN_H = 720

const GOLD = '#d6b274'
const PAPER = '#f4f5f7'
const DIM = '#8b929c'
const FAINT = '#5d646e'
const FONT = `'Microsoft YaHei', 'PingFang SC', 'Segoe UI', system-ui, sans-serif`

/**
 * 封面右下角那枚版本号。
 *
 * 从 package.json 读，不在这里另抄一份：这一格写着 0.1.2 而版本早就走到 0.1.5 了，
 * 图与代码对不上，而图是读者唯一会照着去下载的那个东西。
 */
const VERSION = require('../package.json').version
/** 垫在透明界面底下的模拟桌面。截界面原图时故意不垫，留到版式里统一垫 */
const DESK = 'radial-gradient(130% 100% at 18% 0%, #fbfcfd 0%, #eef1f5 45%, #dde2e8 100%)'
/**
 * 「底板淡到 0」那张卡专用的中间调桌面。
 * 浅桌面看不出差别——界面底板自己就是白的，白压白等于没淡；深桌面又会把字吃掉
 * （字与图标取的是深色墨水，那是给浅桌面选的）。中间调两边都成立：白底明显、深字也还认得出。
 */
const DESK_MID = 'radial-gradient(120% 100% at 20% 0%, #d5dae0 0%, #c2c8cf 50%, #a9b0b8 100%)'

/**
 * 每一张原图**是怎么来的**：成品名 ← 探针写出的原始文件名 ← 跑出它的那条命令。
 *
 * 这张表是把那句话兑现的东西——README 说「图都是真实渲染的截图，没有手绘也没有摆拍」，
 * 而一张图自己证不了它是哪条命令跑出来的。`spike/capture-readme.sh` 照着这张表跑一遍，
 * 再把原始名复制成成品名；命令一字不差地写在这里，谁都能重跑出同一批图。
 *
 * 界面底板只有一份，页面有三份，拼的时候**底板恒为纸白的那一份**（1.5.1 起）。
 * 为什么：主题管的是起始页自己，顶栏与右栏不跟着换皮，因此「磷绿的起始页衬在纸白的
 * 顶栏上」不是切不出来的一态——它就是用户真的会看到的样子，也正是一张图要说清的事。
 * 上一版这里给每套主题各存了一份底板（chrome-night / chrome-crt-green），那两张现在
 * 与 chrome.png 逐像素相同：名不同、内容一样，读图的人会以为自己在看两态。因此删掉，
 * 只在注释里留一句「它为什么不在」。
 *
 * 两条容易搞混、也正是这张表要钉住的尺寸规矩：
 *   * 界面底板抓的是**整扇窗** 1280×720，并且**必须带 --alpha**；
 *   * 页面（home-*、settings）抓的是**正文区** 1232×676（`--body`），不是整扇窗。
 *     抓整扇窗再塞进正文区那个矩形，图会被压扁 2.5%——而 2.5% 在成品图上只是
 *     「看着有点扁」，认不出是哪个数字错了。checkAspect() 让这种错当场停下来。
 */
const CAPTURES = [
  ['chrome.png', 'preview-default-1280x720.png', '--alpha --width 1280 --height 720'],
  /* 「底板淡到 0」那一张卡的另一半：同一块界面底板，只是自己那层底不画了 */
  ['chrome-bg0.png', 'preview-default-1280x720-bg0.png', '--alpha --bg 0 --width 1280 --height 720'],
  ['home-paper.png', 'home-paper-1232x676.png', '--home --body --theme paper --width 1280 --height 720'],
  ['home-night.png', 'home-night-1232x676.png', '--home --body --theme night --width 1280 --height 720'],
  [
    'home-crt-green.png',
    'home-crt-green-1232x676.png',
    '--home --body --theme crt-green --width 1280 --height 720'
  ],
  ['settings.png', 'settings-1232x676.png', '--settings --body --width 1280 --height 720'],
  ['popover.png', 'popover-history-320x420.png', '--popover --kind history --width 320 --height 420'],
  [
    'ball.png',
    'preview-collapsed-200x200-zoom5.png',
    '--collapsed --alpha --width 200 --height 200 --ball-zoom 5'
  ]
]

/** 用到的原图，一次列全（就是上面那张表的成品名）。缺哪张就在启动时说清缺哪张，而不是猜 */
const NEEDED = CAPTURES.map(([name]) => name)

/** 原图实测尺寸。sizeOf 跑完填进来，checkAspect 靠它当场认出「这张图的宽高比不对」 */
const SIZES = {}

/**
 * 一张原图的实测尺寸。
 *
 * 版式里每个位置都要按真实宽高比摆，写死一个宽高迟早和抓出来的图对不上——
 * 而这种错位在成品图上看是「被拉扁了一点」，很难一眼认出来是哪个数字错了。
 */
function sizeOf(file) {
  const p = path.join(RAW, file)
  if (!fs.existsSync(p)) throw new Error(`缺原图：${file}（先在 spike/out/readme 里跑一遍 preview.js）`)
  const img = nativeImage.createFromPath(p)
  const s = img.getSize()
  if (!s.width) throw new Error(`读不出尺寸：${file}`)
  /*
   * 顺便报一下左上角那个像素的 alpha。
   * 需要透明通道的那几张（界面底板、球、面板）混进一张不透明的，图上就是一块灰底——
   * 而那很容易被当成「故意垫的底」。这里量一次，比在成品图上猜省事。
   */
  const bmp = img.toBitmap() // BGRA
  const alpha = bmp.length >= 4 ? bmp[3] : null
  return { file, w: s.width, h: s.height, ratio: s.width / s.height, alpha }
}

/**
 * 页面原图的宽高比，必须与它要贴进去的那个正文区矩形一致。
 *
 * 这一条是**量出来的教训**：上一版抓的是整扇窗（1280×720）却贴进正文区（1232×676），
 * 差 2.5%。成品图上看着只是「有点扁」，谁都认不出是哪个数字错了，于是错着进了仓库。
 * 容差给 0.004：取整到像素会带一点零头，而 1.7778 与 1.8225 差得远不止这些。
 */
function checkAspect(pageFile, boxW, boxH) {
  const s = SIZES[pageFile]
  if (!s) throw new Error(`没量过尺寸就要摆它：${pageFile}`)
  const want = boxW / boxH
  if (Math.abs(s.ratio - want) <= 0.004) return
  const cmd = (CAPTURES.find(([name]) => name === pageFile) ?? [])[2] ?? '(见 spike/capture-readme.sh)'
  throw new Error(
    `原图与它要贴的那个矩形不是同一个宽高比：${pageFile} 是 ${s.w}×${s.h}` +
      `（${s.ratio.toFixed(4)}），正文区是 ${boxW.toFixed(1)}×${boxH.toFixed(1)}（${want.toFixed(4)}）。\n` +
      `  多半是抓错了尺寸——它应当按**正文区**抓（--body）：\n` +
      `  npx electron spike/preview.js ${cmd}`
  )
}

/**
 * 应用窗口那一块：**底板层**（带透明通道的 chrome）叠在**页面层**之上。
 *
 * 这不是拼贴，是还原真实窗口的层次：窗口是逐像素透明的，界面自己只画顶栏与右栏，
 * 网页由另一个 WebContentsView 画在「顶栏之下、右栏之左」那个矩形里。
 * 因此抓了两张图（界面一张带透明通道的、页面一张完整的），在同一个内容区矩形里对齐。
 * 页面那张本来就是**按正文区**抓的，所以这里量出来的宽高比必须对得上（checkAspect）。
 *
 * `scale` 是相对 1280×720 的缩放。`chromeFile` 默认就是那块界面底板（chrome.png）；
 * 传 `chrome-bg0.png` 就得到「底板淡到 0」的一态——合成方式完全相同，只有那一层不同，
 * 于是两张图能直接比。
 */
function appWindow(pageFile, scale, chromeFile = 'chrome.png') {
  const w = Math.round(WIN_W * scale)
  const h = Math.round(WIN_H * scale)
  const top = +(TOPBAR * scale).toFixed(1)
  const rail = +(RAIL * scale).toFixed(1)
  const boxW = w - rail
  const boxH = h - top
  checkAspect(pageFile, boxW, boxH)
  return `<div class="win" style="width:${w}px;height:${h}px">
      <img class="win-page" src="${pageFile}" style="left:0;top:${top}px;width:${boxW}px;height:${boxH}px">
      <img class="win-chrome" src="${chromeFile}" style="left:0;top:0;width:${w}px;height:${h}px">
    </div>`
}

/** 页脚一行：左边项目名，右边一句事实。压在底部，两边都不抢视线 */
const footer = (right) =>
  `<div class="footer"><span>纸团 · zhituan</span><span>${right}</span></div>`

/** 黑底版式的公共部分：极深黑、一层很淡的暖光、一层纸张颗粒 */
const SHELL = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: ${FONT};
    background: #050505;
    color: ${PAPER};
    overflow: hidden;
    position: relative;
  }
  /* 电影打光：一个偏左上角的大光斑，压得很低，只为了让纯黑不死 */
  .keylight {
    position: absolute; inset: -30% -10% auto -10%; height: 90%;
    background: radial-gradient(60% 60% at 22% 30%, rgba(255,255,255,0.075), rgba(255,255,255,0) 70%);
  }
  .warmlight {
    position: absolute; right: -15%; bottom: -35%; width: 70%; height: 80%;
    background: radial-gradient(50% 50% at 50% 50%, rgba(214,178,116,0.10), rgba(214,178,116,0) 70%);
  }
  /* 颗粒：一层 SVG 噪声。纯黑在屏幕上很有塑料感，这一点点噪声让它像纸 */
  .grain {
    position: absolute; inset: 0; opacity: 0.22; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.5'/></svg>");
  }
  .win { position: relative; border-radius: 10px; overflow: hidden;
         box-shadow: 0 30px 90px rgba(0,0,0,0.85), 0 0 0 1px rgba(214,178,116,0.20), 0 0 140px rgba(214,178,116,0.10); }
  .win > img { position: absolute; display: block; }
  .win-page { object-fit: cover; object-position: left top; }
  .desk { background: ${DESK}; }
  .desk-mid { background: ${DESK_MID}; }
  /*
   * 从原图上裁一块：外层定尺寸并裁掉溢出，内层整幅缩放后平移到要露的那一段。
   * 之所以不预先裁成小图：CSS 缩放走的是同一套采样，少一次「裁完再缩放」的往返，
   * 而且要换裁哪儿只改这几个数。
   */
  .crop { position: relative; overflow: hidden; border-radius: 7px; }
  .crop > * { position: absolute; }
  .stack { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
  .row { overflow: hidden; border-radius: 7px; }
  .row img { display: block; }
  .tag-mini { font-size: 22px; letter-spacing: 1px; color: #5f666f; }
  .footer { position: absolute; left: 116px; right: 96px; bottom: 38px;
            display: flex; justify-content: space-between;
            font-size: 22px; letter-spacing: 1px; color: #565d67; }
`

/**
 * 第一张：名片。
 *
 * 左边是名字与定位，右边是**真实的界面**。作品集级封面的常见做法是把界面图当主体、
 * 文字当标题——这里沿用：名字按海报字号给，界面图只承担「它长这样」。
 *
 * 右边那一张用的是**深色那一套的起始页**（home-night）：黑底版式的名片上，只有
 * 它压得住。它顶上那条纸白的顶栏不是穿帮——主题只管起始页，那条栏在真机上就是这个
 * 颜色（第三张图里那张卡专门说这件事）。
 */
function htmlBanner() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${SHELL}
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; gap: 76px; padding: 0 96px 0 116px; }
  .left { flex: 0 0 auto; width: 664px; }
  .eyebrow { font-size: 22px; letter-spacing: 5px; color: ${GOLD}; margin-bottom: 28px; }
  h1 { font-size: 106px; line-height: 1.04; letter-spacing: 4px; font-weight: 700; }
  .latin { margin-top: 12px; font-size: 34px; letter-spacing: 11px; color: ${FAINT}; }
  .tagline { margin-top: 38px; font-size: 43px; line-height: 1.42; color: #cdd2d9; }
  .note { margin-top: 20px; font-size: 26px; line-height: 1.62; color: ${DIM}; }
  .tags { display: flex; gap: 12px; margin-top: 44px; }
  .tags span { font-size: 23px; color: #b9bfc7; border: 1px solid rgba(214,178,116,0.32);
               border-radius: 999px; padding: 9px 20px; }
  .right { flex: 1 1 auto; display: flex; align-items: center; }
  </style>
  <body>
    <div class="keylight"></div><div class="warmlight"></div><div class="grain"></div>
    <div class="wrap">
      <div class="left">
        <div class="eyebrow">WINDOWS · ELECTRON · 逐像素透明</div>
        <h1>纸团</h1>
        <div class="latin">zhituan</div>
        <div class="tagline">把网页装进一颗<br>能藏起来的球里</div>
        <div class="note">可调透明、置顶，鼠标一离开就收起。<br>在工作场景下低调地读网页。</div>
        <div class="tags"><span>开源 · GPL-2.0</span><span>${VERSION}</span><span>代码完全独立实现</span></div>
      </div>
      <div class="right">${appWindow('home-night.png', 0.76)}</div>
    </div>
    ${footer('Windows 10/11 · GPL-2.0-or-later')}
  </body></html>`
}

/**
 * 第二张：三件能力。
 *
 * 三张卡各配一张真实截图。图里的界面文字在 GitHub 的显示宽度下是看不清的——
 * 这是所有含截图的 README 的共同处境，因此**含义由卡的标题承担**，截图负责「它长这样」。
 * 第二、三张卡特意做成了「同一处的两态」与「同一处的三皮」，因为这两件事
 * 光看一张图说不明白：淡到 0 得和没淡的时候比，三套主题得并排才成立——
 * 而并排之后读者第一眼该看到的是**顶栏没变**（见 THEME_CROP 那段）。
 */
function htmlFeatures() {
  const MEDIA_H = 340
  const card = (inner, extra, title, line) => `
    <div class="card">
      <div class="media ${extra}" style="height:${MEDIA_H}px">${inner}</div>
      <div class="card-title">${title}</div>
      <div class="card-line">${line}</div>
    </div>`

  /*
   * 「底板淡到 0」的两态对照：同一块顶栏，一次底板 100%、一次 0%，上下叠着放。
   * 两张用的都是同一份合成（纸白的界面层 + 磷绿的起始页），只有界面层那张底板不同——
   * 于是读者一眼能看出变的只有那条底：页面纹丝不动，字与图标也没淡。
   *
   * 页面层挑磷绿那一份：它底子最黑，淡不淡底板在中间调桌面上差别最明显。
   */
  const CROP = { x: 640, w: 640, h: 132, out: 492 }
  const ck = CROP.out / CROP.w
  const crop = (chromeFile) => `<div class="crop" style="width:${CROP.out}px;height:${(CROP.h * ck).toFixed(1)}px">
      <div style="left:${(-CROP.x * ck).toFixed(1)}px;top:0;transform:scale(${ck.toFixed(5)});transform-origin:0 0">
        ${appWindow('home-crt-green.png', 1, chromeFile)}
      </div>
    </div>`

  /*
   * 三套主题：各切同一块地方——**顶栏的左半截，加上它下面那一条起始页正文**。
   *
   * 这一块的取法是这张卡的全部意义所在，因此说明白：三行里**顶栏那 44px 必须一模一样**，
   * 变的只能是它下面那一条——主题管的是起始页自己，顶栏、右栏、网页都不跟着换。
   * 上一版这里切的是右上角（顶栏右半截 + 右栏），那在旧口径下正好是最能看出差别的地方，
   * 在现在的口径下却是三张完全相同、逐像素一样的图。
   *
   * 正文那一条取 60px，是**量出来的**：这一段里三套皮各写各的名字（纸白与夜色写着
   * 「纸团」，终端世界那套写着 ZHITUAN 加一个 `> ▌` 光标），底子也各是一色
   * （白 / 近黑 / 黑），三行并排一眼就能分开。再多切就放不下了：卡片里那块媒体区
   * 高 340，三行加上两道 9px 的缝一共只能占 330——60 正好，再高一行就顶出框外，
   * 而 overflow:hidden 会把第三行整个吃掉，图上只看得到「三套主题只有两套」。
   *
   * 一处 1:1 地裁（不缩放）：宽 492 时窗里的字几乎就是原大小，三套皮的区别才看得清。
   * 底板一律是纸白那一份（appWindow 的默认值）——那不是穿帮，那就是真机上的样子。
   */
  const THEME_CROP = { x: 0, w: CROP.out, h: TOPBAR + 60 }
  const themeRow = (theme) => `<div class="crop" style="width:${THEME_CROP.w}px;height:${THEME_CROP.h}px">
      <div style="left:0;top:0">
        ${appWindow(`home-${theme}.png`, 1)}
      </div>
    </div>`

  /* 三行加两道缝，必须落在 MEDIA_H 里（上面那段说的就是这个账） */
  const ROWS_H = THEME_CROP.h * 3 + 9 * 2
  if (ROWS_H > MEDIA_H) throw new Error(`三套主题那三行塞不下：${ROWS_H} > ${MEDIA_H}`)

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${SHELL}
  .head { position: absolute; left: 116px; top: 84px; }
  .head h2 { font-size: 64px; letter-spacing: 2px; font-weight: 700; }
  .head p { margin-top: 16px; font-size: 28px; color: ${DIM}; }
  .cards { position: absolute; left: 116px; right: 96px; top: 268px; display: flex; gap: 38px; }
  .card { flex: 1 1 0; background: #0b0c0e; border: 1px solid #191b1f; border-radius: 18px;
          padding: 22px 22px 34px; }
  .media { border-radius: 11px; overflow: hidden; background: ${DESK};
           display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .media img { display: block; }
  .card-title { margin-top: 26px; font-size: 48px; letter-spacing: 1px; }
  .card-line { margin-top: 14px; font-size: 28px; line-height: 1.6; color: ${DIM}; }
  </style>
  <body>
    <div class="keylight"></div><div class="warmlight"></div><div class="grain"></div>
    <div class="head">
      <h2>三件难做对的事</h2>
      <p>都不是新功能，是把已有的做到位</p>
    </div>
    <div class="cards">
      ${card(
        /*
         * 球那一张是**放大 5 倍**的：真机上它只有 40×40，放在这张 1920 宽的版式里
         * 就是一颗看不见的芝麻。放大的是整颗球（球 40→200，球面上那枚 18px 的图形
         * 跟着 18→90，90/200 与 18/40 都是 0.45），所以它是等比放大，不是一颗畸形的球。
         * 图旁边把倍数写出来——不然读者会以为这球真有 230px。
         */
        `<div class="stack" style="align-items:center;gap:16px">
           <img src="ball.png" style="width:200px">
           <div class="tag-mini">放大 5× · 真机 40×40</div>
         </div>`,
        '',
        '收起成一颗球',
        '鼠标一离开就缩成 40×40。<br>屏幕上不留隐形的点击区。'
      )}
      ${card(
        `<div class="stack">
           <div class="tag-mini">界面底板 100%</div>
           ${crop('chrome.png')}
           <div class="tag-mini">界面底板 0%</div>
           ${crop('chrome-bg0.png')}
         </div>`,
        'desk-mid',
        '底板可以淡到 0',
        '淡的只是界面自己画的底板，<br>字与图标不透明，仍然点得到。'
      )}
      ${card(
        `<div class="stack" style="gap:9px">
           ${themeRow('paper')}
           ${themeRow('night')}
           ${themeRow('crt-green')}
         </div>`,
        'desk-mid',
        '三套主题，只换起始页',
        '顶栏、右栏、网页一概不动。<br>换皮换的是起始页自己那一份。'
      )}
    </div>
    ${footer('截图取自真实渲染的无头窗口')}
  </body></html>`
}

/**
 * 第三张：四张真实界面。
 *
 * 四格里有三格是**整扇窗的合成**（透明的界面层叠在页面层之上，见 appWindow），
 * 第四格是弹出面板自己——它是一扇独立的小窗，没有「界面层 + 页面层」这回事。
 *
 * 之所以不再单留一格叫「界面骨架」：骨架现在每一格都看得见，再拿一格去专门展示它，
 * 就和「起始页」那一格成了同一张图的两个说法。四格因此按**四个不同的东西**排：
 * 起始页（纸白）/ 同一页的终端世界（磷绿）/ 系统设置 / 弹出面板。
 *
 * 尺寸是被版面倒逼的：四格 16:9 的窗口图排两行，一行的高度由宽度定死，
 * 于是「一行能多高」决定「一格能多宽」。剩下的横向空隙交给 space-between——
 * 左边缘与标题对齐、右边缘与页脚对齐，中间那一大块留白才像是有意的。
 */
function htmlShots() {
  const cell = (label, note, inner) => `
    <div class="cell">
      <div class="label">${label}<span>${note}</span></div>
      <div class="frame">${inner}</div>
    </div>`

  const FRAME_W = 580
  const FRAME_H = 326 // 580 × 720/1280
  /*
   * 面板那一格：面板是竖的（320×420），这一格的框是横的（580×326），
   * 于是按**高度**等比放进去（320 × 286/420 ≈ 218 宽）。等比是要紧的——
   * 把 320×420 拉成 580×326 会得到一块既不像面板也不像窗口的东西。
   * 放不到 1:1 是因为 420 > 326：这一行的高度由同行的窗口图定死，撑不开。
   * 底下垫一层浅桌面、图上加一道投影，面板才从底上浮起来（它本来就是浮在桌面上的）。
   */
  const pad = (inner) =>
    `<div class="pad" style="width:${FRAME_W}px;height:${FRAME_H}px;background:${DESK}">${inner}</div>`

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${SHELL}
  .head { position: absolute; left: 116px; top: 44px; }
  .head h2 { font-size: 56px; letter-spacing: 2px; font-weight: 700; }
  .head p { margin-top: 14px; font-size: 28px; color: ${DIM}; }
  .grid { position: absolute; left: 116px; right: 96px; top: 172px;
          display: grid; grid-template-columns: repeat(2, ${FRAME_W}px);
          justify-content: space-between; gap: 26px 0; }
  .cell { width: ${FRAME_W}px; }
  .label { font-size: 30px; margin-bottom: 12px; }
  .label span { font-size: 22px; color: ${FAINT}; margin-left: 14px; }
  .frame { width: ${FRAME_W}px; height: ${FRAME_H}px; border-radius: 12px; overflow: hidden;
           box-shadow: 0 18px 46px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.05); }
  .frame img { display: block; width: ${FRAME_W}px; }
  .pad { display: flex; align-items: center; justify-content: center; }
  </style>
  <body>
    <div class="keylight"></div><div class="warmlight"></div><div class="grain"></div>
    <div class="head">
      <h2>界面</h2>
      <p>顶栏一条、右侧栏一条，其余让给网页</p>
    </div>
    <div class="grid">
      ${cell('起始页', '纸白 · 栏目线 · 内容条目', appWindow('home-paper.png', FRAME_W / WIN_W))}
      ${cell('终端世界', '同一页，另一套骨架', appWindow('home-crt-green.png', FRAME_W / WIN_W))}
      ${cell('系统设置', '窗口内的一页', appWindow('settings.png', FRAME_W / WIN_W))}
      ${cell(
        '弹出面板',
        '历史 / 书签 / 缩放 / 标签页 / 排版',
        pad(
          `<img src="popover.png" style="height:${FRAME_H - 40}px;filter:drop-shadow(0 12px 30px rgba(0,0,0,0.45))">`
        )
      )}
    </div>
    ${footer('截图取自真实渲染的无头窗口')}
  </body></html>`
}

/** 编码页：把一张图读进来，编码成 WebP；顺带回一张缩小的 PNG 供人眼核对 */
const ENCODER = `<!doctype html><html><meta charset="utf-8"><body style="margin:0">
<script>
  const file = decodeURIComponent(location.hash.slice(1))
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    window.__webp = c.toDataURL('image/webp', 0.9)
    // 缩到 1000 宽，近似它在 GitHub 上的显示尺寸，用来看小字还认不认得出来
    const k = Math.min(1, 1000 / img.naturalWidth)
    const s = document.createElement('canvas')
    s.width = Math.round(img.naturalWidth * k)
    s.height = Math.round(img.naturalHeight * k)
    s.getContext('2d').drawImage(img, 0, 0, s.width, s.height)
    window.__preview = s.toDataURL('image/png')
    window.__info = { w: img.naturalWidth, h: img.naturalHeight }
  }
  img.onerror = () => { window.__info = { error: '读不出来：' + file } }
  img.src = file
</script></body></html>`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(ASSETS, { recursive: true })

  const sizes = NEEDED.map(sizeOf)
  for (const s of sizes) {
    SIZES[s.file] = s
    const mark = s.alpha === 255 ? '不透明' : `alpha=${s.alpha}`
    console.log(`原图 ${s.file}  ${s.w}×${s.h}  ${mark}`)
  }

  // 版式页与编码页共用一扇隐藏窗口——它是唯一需要合成的进程
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
    backgroundColor: '#050505',
    webPreferences: { contextIsolation: true, sandbox: false }
  })

  /*
   * 回报真实画布。请求 1080 拿到的是工作区高度（1080 减掉任务栏），
   * 排版时若按请求值算，底下就会少一条——这一行就是用来当场看出来的。
   */
  const [CANVAS_W, CANVAS_H] = win.getSize()
  console.log(`\n版式画布 ${CANVAS_W}×${CANVAS_H}（高度被系统卡在工作区内）`)

  /** 把一段 HTML 落到 spike/out/readme 下再 loadFile：图按相对路径引用，省去 data URI 的体积限制 */
  const writeHtml = (name, html) => {
    const p = path.join(RAW, `_${name}.html`)
    fs.writeFileSync(p, html, 'utf8')
    return p
  }
  const encoderPath = writeHtml('encoder', ENCODER)

  /**
   * 编码 + 回读核对。
   *
   * 核对用的源是**已经写盘的 WebP**，不是内存里那份 canvas——要验的正是
   * 「压缩之后还清不清楚」，拿源图回读就等于没验。
   */
  const encode = async (pngName, webpName) => {
    await win.loadFile(encoderPath, { hash: encodeURIComponent(pngName) })
    const info = await win.webContents.executeJavaScript('window.__info')
    if (!info || info.error) throw new Error(`编码失败：${JSON.stringify(info)}`)
    const dataUrl = await win.webContents.executeJavaScript('window.__webp')
    const webp = Buffer.from(dataUrl.split(',')[1], 'base64')
    fs.writeFileSync(path.join(ASSETS, webpName), webp)

    await win.loadFile(encoderPath, { hash: encodeURIComponent(webpName) })
    const check = await win.webContents.executeJavaScript('window.__info')
    if (!check || check.error) throw new Error(`回读 WebP 失败：${JSON.stringify(check)}`)
    const preview = await win.webContents.executeJavaScript('window.__preview')
    fs.writeFileSync(
      path.join(RAW, `verify-${webpName.replace(/\.webp$/, '')}.png`),
      Buffer.from(preview.split(',')[1], 'base64')
    )
    return { src: `${info.w}×${info.h}`, bytes: webp.length }
  }

  const shoot = async (name, html) => {
    await win.loadFile(writeHtml(name, html))
    await wait(900)
    // 隐藏窗口的合成帧晚一拍：先等两帧，再丢掉一次抓取（同 preview.js 的 shoot）
    await win.webContents.executeJavaScript(
      `Promise.race([
         new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
         new Promise((r) => setTimeout(r, 500))
       ])`
    )
    await win.webContents.capturePage()
    await wait(200)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(RAW, `${name}.png`), image.toPNG())
    const out = await encode(`${name}.png`, `${name}.webp`)
    console.log(`\nWROTE assets/${name}.webp  ${out.src}  ${(out.bytes / 1024).toFixed(0)} KB`)
  }

  await shoot('banner', htmlBanner())
  await shoot('features', htmlFeatures())
  await shoot('shots', htmlShots())

  console.log(`\n回读核对图（Read 工具看不了 WebP，看这三张）：`)
  for (const n of ['banner', 'features', 'shots']) console.log(`  ${path.join(RAW, `verify-${n}.png`)}`)

  app.exit(0)
})
