/**
 * 全局常量。主进程、预加载与渲染进程共享。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/**
 * 顶部功能栏高度（DIP）。
 *
 * 由悬浮球的直径决定：球就排在这一行里，44 = 40 + 上下各 2px 留白。
 */
export const TOP_BAR_H = 44

/**
 * 地址栏展开时占用的高度（DIP）。
 *
 * 地址栏默认折叠。横屏下纵向空间最紧张，而起始页本身就是一个搜索入口，
 * 常驻一行地址栏是白占地方。折叠时这一行高度归零，正文直接顶到顶栏下沿。
 */
export const ADDRESS_H = 34

/**
 * 更新提示条的高度（DIP）。
 *
 * 与新版本有关的提示只落在这一条上——**不用系统通知**：通知会进通知中心、
 * 上锁屏、被录屏录进去，那等于替用户宣布「我在跑别的程序」。
 *
 * 30 是「一行 12px 的字、外加两枚 22px 的小按钮、上下各留 4px」的最小整数。
 * 它是一条**占版面的行**（与地址栏同类，正文要往下让 30px）而不是浮在网页上的
 * 覆盖层：界面层与网页是两个原生视图，铺在网页上的东西会把那一块的点击整个
 * 吃掉（见 docs/spike-findings.md 的 Q19）。
 */
export const NOTICE_H = 30

/**
 * 右侧功能栏宽度（DIP）。
 *
 * 站点、历史、书签、缩放、透明度、设置这些原本摊在底栏的功能都收在这条竖栏里。
 * 底栏要横跨整个窗口宽度，而竖栏只吃掉 48px：在 960 宽的窗口里是 5%，
 * 而 44px 高的底栏在 540 高的窗口里要占掉 8%。横屏下后者才是更贵的那条。
 */
export const RAIL_W = 48

/**
 * 窗口保持 16:9 横屏比例。
 *
 * 横屏下窗口更宽更矮，纵向空间宝贵，因此两条工具栏的高度按
 * 540 高度下的占比定，不能再沿用竖屏时代的比例。
 */
export const ASPECT_RATIO = 16 / 9

/**
 * 悬浮球直径（DIP）。
 *
 * 球是顶栏里的一个按钮，也是收起之后整扇窗的内容。
 * 40 不是随手取的：收起时窗口要缩到球身上，而平台不接受过小的窗口
 * （实测下限约 32×39，见 spike/minsize.js）。球若小于这个下限，
 * 窗口就缩不到球那么大，而球是铺满窗口画的，于是被拉成椭圆。
 * 40 是这个下限之上最小的整数直径。
 */
export const BALL_SIZE = 40

/**
 * 球面上图形的边长。
 *
 * 取球径的 0.46（40px 的球上是 18px）：再大图形就顶到球边，再小球心那点
 * 笔画就糊成一团。三处都要这个数——球自己（内置图形与自定义图的「中央图案」
 * 落法）、设置页的那排图标预览、裁剪弹窗里的预览球——因此只能有一份。
 * 那三处必须长得一模一样：设置页里看到的就应当是球面上的样子。
 */
export const BALL_GLYPH_SIZE = Math.round(BALL_SIZE * 0.46)

/**
 * 顶栏藏起来之后，悬浮球距窗口边缘的留白。
 *
 * 由栏宽反推：RAIL_W = 48 = 直径 + 两侧各 4px，球才能正好落在右栏那一列里。
 * 渲染进程的 CSS 与主进程的兜底矩形共用它。
 */
export const BALL_MARGIN = (RAIL_W - BALL_SIZE) / 2

/**
 * 自绘缩放手柄的粗细（DIP）：四条边 4px，四个角 8×8。
 *
 * 为什么是自绘而不是 `resizable: true`：透明窗口开原生缩放会在某些 Windows
 * 版本上失效，而透明是这个程序的全部（见 windowSurface.ts）。
 *
 * 4 这个数不是随手取的——它恰好是顶栏与右侧栏自己的内边距，于是这两条边上的
 * 手柄永远压不到任何一个控件，只是把「栏目与窗口之间那几像素的留白」变成了
 * 可拖的区域。界面与探针读的是同一份数字（探针要去这些位置按一下）。
 */
export const RESIZE_EDGE = 4
export const RESIZE_CORNER = 8

/**
 * 「光标离窗口边框多近就算贴上了」的那条带子（DIP）。
 *
 * 比手柄本身宽一倍：界面层要抬到网页之上，左边缘与下边缘的手柄才收得到那一下
 * 按下（那两处的像素本来归网页，见 ResizeFrame 与 edgeWatcher）。抬起来要点
 * 时间（一次轮询，最长 POLL_MS），因此带子得比手柄先一步起反应——
 * 光标走到边上时，界面层必须已经抬好了。
 */
export const EDGE_HOT_BAND = RESIZE_CORNER

/**
 * 最大化时浮在窗口右上角的那一组控件：一枚还原键 + 悬浮球。
 *
 * 两栏都被藏起来了，界面在窗口里没有自己的地盘，因此这组控件画在一个
 * **缩到右上角那一小块**的 chrome 视图里，并抬到网页之上（见 setChromeOnTop）。
 * 尺寸写在这里是因为主进程要按它设 chrome 视图的矩形，而界面要按同一组数字
 * 把两枚控件摆进那一块里——两边对不上就会出现「控件画在视图外面」。
 *
 * 高度取 BALL_SIZE + 两侧留白、宽度取两枚控件加间距与留白，于是球落在
 * 距窗口右边和下边各 BALL_MARGIN 处，与「顶栏藏起来时球的落点」完全一致。
 * 键的 26 与顶栏里那些图标按钮同一个数（那里是 CSS 的 26px，这里是常量，
 * 两处指的是同一件事：一枚图标键的大小）。
 */
export const FLOAT_KEY_SIZE = 26
export const FLOAT_GAP = 6
export const FLOAT_H = BALL_SIZE + BALL_MARGIN * 2
export const FLOAT_W = FLOAT_KEY_SIZE + FLOAT_GAP + BALL_SIZE + BALL_MARGIN * 2

/** 主进程鼠标位置轮询间隔（毫秒） */
export const POLL_MS = 50
/**
 * 拖动窗口时跟踪光标的间隔（毫秒）。
 *
 * 这个值必须**小于** Windows 的系统时钟滴答（约 15.6ms）——不是「越小越流畅」，
 * 而是「不小于它就会翻倍」：定时器间隔会被向上取整到滴答的整数倍。实测
 * （spike/dragTicks.js）请求 16ms 得到的是 p50 30.2ms，也就是两个滴答；
 * 请求 8ms 得到 15.1ms，一个滴答，这已经是 setInterval 在 Windows 上能给到的
 * 最快值。一个被取整成 30ms 的间隔，眼睛看到的就是拖动时画面一顿一顿。
 */
export const DRAG_TICK_MS = 8
/** 光标离开后多久才收起成球（毫秒）。收起慢、展开靠点击，避免误触 */
export const HIDE_DELAY_MS = 700
/** 淡入淡出时长（毫秒） */
export const FADE_MS = 200
/** 淡入淡出的计时器步长（毫秒） */
export const FADE_TICK_MS = 16
/**
 * 窗口停止移动多久后才落盘位置、重放表面状态（毫秒）。
 *
 * 自己实现的拖动每帧都会发一次 move（一个系统滴答一次）。若每次都写配置并重放
 * 整套窗口属性，就是持续闪烁加持续落盘。位置本身立即记在内存里，
 * 只有这两件有副作用的事要等它停下来。
 */
export const MOVE_SETTLE_MS = 200

/** 透明度下限。0 会让窗口不可见却仍可交互，形成自我锁定，故不允许 */
export const OPACITY_MIN = 0.05
export const OPACITY_MAX = 1

/**
 * 界面底板透明度范围。
 *
 * 与窗口透明度（OPACITY_MIN）不同，这里下限可以是 0：它作用的是界面自己画的
 * 底板（顶栏、地址栏、右栏、弹出面板），字与图标始终不透明。于是拉到 0
 * 剩下的是「浮在桌面上的几个按钮」，设置项本身仍然看得见、点得到，
 * 不会把自己锁在外面。网页与自家页面（起始页、系统设置）不受它影响——
 * 网页要给的是可读的纸，透过去的是底板，两者不是一回事。
 */
export const BACKGROUND_OPACITY_MIN = 0
export const BACKGROUND_OPACITY_MAX = 1

/**
 * 离线阅读透明度的范围。
 *
 * 下限同样是 0，理由与背景透明度一样：它作用在**被读的那一份**上，
 * 界面那几条栏与控件都不受它影响，因此拉到 0 也锁不住自己
 * ——右栏那条滑块就摆在眼前，随时拉得回来。0% 的那一态是「读的东西不在，
 * 界面还在」（对照的是老板键那种「整扇窗不在」）。
 *
 * 同一个值在两处落点不一样，因为两处能碰到的东西不一样：
 *
 *   · **PDF 阅读页**（这一页是我们自己画的）：淡的是**纸**。0% = 纸全实
 *     （一张白纸垫到字下面），100% = 纸全透，也就是 1.5.2 之前一直的样子
 *     ——纸在键控那一趟被写成 alpha 0，没有任何东西补回来。因此那里取的是
 *     **1 − 值**：默认那个 1 仍旧是「什么都不加」。**字始终是实心的**，
 *     滑块动不了它（见 pdf/PdfApp.vue）。
 *   · **本机 TXT 与网页文件**（Chromium 自己渲染，我们碰不到它的底）：
 *     值就是那一层 `opacity`，100% 不淡、0% 淡到看不见。
 *
 * 上限给 1：两处共同的意思是**默认值 1 = 这一版之前的样子**（PDF 的纸全透、
 * TXT 的正文不淡），于是老配置一个数都不用迁。
 */
export const READER_OPACITY_MIN = 0
export const READER_OPACITY_MAX = 1

/**
 * 阅读排版三项的范围（只作用于本机 EPUB 那一页，见 UiConfig.readerFontSize）。
 *
 * 字号给的是 **px** 而不是比例：书的 CSS 里 `font-size` 有 em、%、pt 各种写法，
 * 按比例去乘会得到一个「乘不出确定值」的结果；而这一页的正文归我们排，
 * 给一个绝对值最清楚。上下限取的是「还能读」的两头：14px 是手机上正文的地板，
 * 26px 已经比大多数书的标题还大。
 *
 * 行距是**无单位倍数**（`line-height: 1.85` 这种写法），于是它随字号一起缩放
 * ——这正是无单位行距的意义，也是我们写进样式表的形式。
 *
 * 留白是左右两边的百分比（相对正文区宽度）：用百分比而不是 px，换个窗口宽度
 * 读到的还是同一份版心。
 */
export const READER_FONT_MIN = 14
export const READER_FONT_MAX = 26
export const READER_LINE_MIN = 1.4
export const READER_LINE_MAX = 2.4
export const READER_MARGIN_MIN = 0
export const READER_MARGIN_MAX = 14

/**
 * 三项的默认值。
 *
 * 刻意与书页里原先写死的那组排版逐字相同（`17px` / `1.85` / `6%`）：
 * 这一版把写死的值搬进配置，用户看到的版面一个像素都不该变。
 */
export const DEFAULT_READER_FONT = 17
export const DEFAULT_READER_LINE = 1.85
export const DEFAULT_READER_MARGIN = 6

/** 窗口尺寸预设（DIP）。四个都严格 16:9，换尺寸不会让版面在两个方向上各自重排 */
export const SIZE_PRESETS = {
  mini: { width: 480, height: 270 },
  small: { width: 800, height: 450 },
  medium: { width: 960, height: 540 },
  large: { width: 1280, height: 720 }
} as const

export type SizePreset = keyof typeof SIZE_PRESETS

/** 默认老板键。Alt+Z 最小化/恢复，Alt+X 藏进托盘 */
export const DEFAULT_BOSS_MINIMIZE = 'Alt+Z'
export const DEFAULT_BOSS_HIDE = 'Alt+X'

/**
 * 配置文件版本，用于迁移。
 *
 * 2：窗口由竖屏改为 16:9 横屏，旧的竖屏尺寸不再适用。
 * 3：隐藏策略改为收起成悬浮球，旧的按区域隐藏设置整体作废。
 * 4：悬浮球改为窗口内的常驻元素，且自动收起默认关闭。
 * 5：底栏取消，功能移入右侧栏，悬浮球不再有「左下」这个停靠位。
 * 6：悬浮球移入顶栏并成为其中的一个按钮，停靠位置与大小不再可调；
 *    顶栏与右侧栏改为可各自隐藏（ui.topBarOpen / ui.railOpen）。
 * 7：右侧栏去掉迷你与收藏；系统设置由独立窗口改为窗口内的一页（ui.homeTheme 同时加入）。
 * 8：起始页主题由七个收到三个，并且主题开始决定界面形态（卡片 / 命令行）。
 * 9：新增 ui.backgroundOpacity（界面底板透明度），默认 1（与旧行为一致）。
 * 10：新增 ui.ballIcon / ui.ballCustomFit（悬浮球图标）。默认值与旧行为一致，
 *     自定义图标本身另存 userData/ball-icon.json，不在配置里。
 * 11：新增 ui.readerOpacity（离线阅读正文的不透明度）。默认 1，
 *     也就是这一版之前的样子：正文不淡。旧配置没有这一项，
 *     逐字段校验会给它默认值，因此迁移逻辑一个字都不用写。
 *     1.5.2 起这一项在 PDF 那一页上换了个落点（淡的是纸不是字），但默认值 1
 *     在两处仍然是「什么都不加」，因此版本号不用动、迁移仍然一个字都不用写。
 */
export const CONFIG_VERSION = 11

/** 1 版时代的竖屏尺寸；命中这些值说明是「没改过尺寸」的旧配置，迁移时重置 */
export const LEGACY_PORTRAIT_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 280, height: 500 },
  { width: 420, height: 640 },
  { width: 560, height: 800 },
  { width: 760, height: 900 }
]

/** 历史记录上限 */
export const HISTORY_LIMIT = 2000

/** 默认搜索引擎 */
export const DEFAULT_SEARCH_TEMPLATE = 'https://www.bing.com/search?q=%s'

/**
 * 新建标签页默认打开的地址。
 *
 * 顶栏标签条末尾那颗 `+` 打开的就是它（设置 → 通用 → 新标签页里能改）。
 * 这一份是两处的共用的默认值：配置的默认值（configStore）与运行时的兜底
 * （用户把那一格填成空的时候，见 TabManager.newTabUrl）。
 */
export const DEFAULT_NEW_TAB_URL = 'https://www.google.com'

/**
 * 首页的伪地址。
 *
 * 首页是「自家页面」，需要 preload 才能读到站点与历史；
 * 而访客页面刻意不注入任何 preload。两者因此是不同的 kind，
 * 由 TabManager 的 kind 区分，绝不共用同一个视图。
 *
 * 它**不进标签条**：起始页是顶栏左上角那颗键的落点，是窗口里的一「屏」，
 * 不是标签页。这个伪地址只用来对外说清「显示的是哪一屏」——
 * 真实的 file:// 路径既不显示，也不该显示。
 */
export const HOME_URL = 'zhituan://home'
export const HOME_TITLE = '起始页'

/**
 * 系统设置的伪地址。
 *
 * 与首页同属「自家页面」：带 preload、能读写配置，但它不再是一扇独立窗口——
 * 那扇窗口会出现在任务栏与 Alt+Tab 里，等于把「我在摸鱼」写在脸上。
 * 与首页一样不进标签条：入口是顶栏最左那颗「起始页」右边紧挨着的那颗键。
 */
export const SETTINGS_URL = 'zhituan://settings'
export const SETTINGS_TITLE = '系统设置'

/**
 * 起始页的栏目。
 *
 * 这一页要回答的是「今天摸哪条鱼」，所以它是一次**分类**：顶上一排栏目键，
 * 点哪个下面换哪一摊。栏目的划分取自墨鱼阅读那份使用指南（网页 / 离线），
 * 再按本站预置站点表里本来就有、却一直混在一列里的那几类细分。
 *
 * 这份表是**唯一的一份**：起始页画它，探针按 id 点它，站点的归属（presets.ts
 * 的 sectionOfUrl）也指着它。id 同时是对外的名字（CSS、探针参数、页面状态）。
 *
 * `local` 那一栏不是站点栏——它底下排的是本机文件，只有它一个。标出来是因为
 * 「这一栏的内容从哪儿来」这件事在别处都要判一次（见 HomeApp 的 rowsOfSection）。
 */
export type SectionId = 'all' | 'video' | 'reading' | 'news' | 'quiz' | 'local'

/** 站点能归到哪一栏。不含「全部」与「离线阅读」：那两栏不是站点栏 */
export type SiteSection = Exclude<SectionId, 'all' | 'local'>

export const SECTIONS: ReadonlyArray<{
  id: SectionId
  label: string
  /** 栏目线放不下时用的两字缩写（照 TabStrip 让位那条路数） */
  short: string
  /** 是不是「本机文件」那一栏 */
  local?: boolean
}> = [
  { id: 'all', label: '全部', short: '全部' },
  { id: 'video', label: '视频', short: '视频' },
  { id: 'reading', label: '阅读', short: '阅读' },
  { id: 'news', label: '资讯', short: '资讯' },
  { id: 'quiz', label: '刷题', short: '刷题' },
  { id: 'local', label: '离线阅读', short: '离线', local: true }
]

/** 打开起始页时落在哪一栏。落在「全部」上：打开就想看全，再自己往细里点 */
export const DEFAULT_SECTION: SectionId = 'all'

/** 栏目的名字。id 认不出来时如实回落到「全部」，不编一个不存在的栏目 */
export function sectionTitle(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? SECTIONS[0].label
}

/**
 * 离线阅读那一栏里写明的格式界限。
 *
 * 写在常量里而不是页面里，是因为它同时要出现在探针的读数里：这条界线
 * （能读什么、不能读什么）是这一栏对用户说过的话里最容易失效的一句。
 */
export const LOCAL_FORMATS_NOTE = 'TXT / PDF 直接读；EPUB / MOBI / AZW3 暂不支持（见路线图）'

/**
 * 起始页的两套世界。
 *
 * 主题不只是配色，它决定这一页**长成什么形态**：
 * - modern：卡片排版，像一张安静的桌面（纸白、暗夜）
 * - terminal：命令行排版，提示符 + 输出行 + 状态行（磷绿）
 *
 * 一份数据、一套交互，两套渲染。分开的理由是这两种形态对空间的用法根本不同：
 * 卡片要横竖两个方向的余量，命令行只要一行行往下排，在迷你档（正文区
 * 432×232）里反而更从容。
 */
export type HomeWorld = 'modern' | 'terminal'

/**
 * 起始页的主题。
 *
 * 三个主题 = 两套世界：现代配色两套，荧光屏一套。
 *
 * 主题管的是**起始页那一屏**，只有它这一份文档把主题名写到 `html[data-theme]` 上
 * （见 renderer/src/composables/useTheme.ts）。顶栏、地址栏、标签条、右栏、悬浮球、
 * 弹出面板、系统设置页与 PDF 阅读页那几份文档虽然加载着同一份 styles/themes.css，
 * 却从不写这个属性——于是永远落在 `:root` 那一组（纸白）上。**这是设计**：
 * 工具的样子不跟着一页换皮，何况 PDF 那一页画的是内容，墨色跟着主题走会让
 * 磷绿下的整本书变成荧光绿（1.5.0 实装如此，1.5.1 修掉）。
 *
 * **网页永远不受影响**：访客页面是另一个 WebContentsView，拿不到这份样式表，
 * 也拿不到这个属性。读懂这一条就明白它的边界在哪。
 */
export type HomeTheme = 'paper' | 'night' | 'crt-green'

export const HOME_THEMES: ReadonlyArray<{
  id: HomeTheme
  label: string
  hint: string
  world: HomeWorld
}> = [
  { id: 'paper', label: '纸白', hint: '浅色行式列表，日光灯下最不显眼', world: 'modern' },
  { id: 'night', label: '暗夜', hint: '深色行式列表，不发光，晚上眼睛舒服', world: 'modern' },
  { id: 'crt-green', label: '磷绿', hint: 'P1 单色终端：命令行、扫描线、余辉', world: 'terminal' }
]

export const DEFAULT_HOME_THEME: HomeTheme = 'paper'

/** 主题属于哪套世界。表里没有的（旧配置、写坏的配置）按现代世界处理 */
export function worldOfTheme(id: HomeTheme): HomeWorld {
  return HOME_THEMES.find((t) => t.id === id)?.world ?? 'modern'
}

/**
 * 8 版收掉的主题。
 *
 * 它们全是荧光屏那一类的，所以迁移时落到同属终端世界的磷绿上，
 * 而不是落到纸白——把选过黑底的人扔回白底，比换个荧光色更突兀。
 */
export const LEGACY_HOME_THEMES: readonly string[] = [
  'crt-amber',
  'crt-ice',
  'crt-white',
  'dos'
]

/**
 * 悬浮球可以画什么。
 *
 * 与 HOME_THEMES 一样，这份表是**唯一的一份**：主进程用它校验配置，
 * 渲染进程用它出选择器，球自己按 id 取图形。
 *
 * 挑的都是 40px 的球上还认得出的剪影——球面上只有 18px 画图标，
 * 那点地方放不下任何细节，认得出来靠的是外轮廓，不是笔画。
 */
export type BallIcon =
  | 'book'
  | 'eye'
  | 'fish'
  | 'coffee'
  | 'moon'
  | 'cat'
  | 'code'
  | 'headphones'

export const BALL_ICONS: ReadonlyArray<{ id: BallIcon; label: string }> = [
  { id: 'book', label: '书页' },
  { id: 'eye', label: '眯眼' },
  { id: 'fish', label: '摸鱼' },
  { id: 'coffee', label: '咖啡' },
  { id: 'moon', label: '月亮' },
  { id: 'cat', label: '猫' },
  { id: 'code', label: '代码' },
  { id: 'headphones', label: '耳机' }
]

export const DEFAULT_BALL_ICON: BallIcon = 'book'

/**
 * 自定义图标这一档。
 *
 * 它可以出现在 ballIcon 该出现的一切地方，但不是 BallIcon——内置的那几个
 * 画在代码里，这一个来自用户上传的图，两者的渲染路径完全不同。
 */
export const CUSTOM_BALL_ICON = 'custom'

export type BallIconChoice = BallIcon | typeof CUSTOM_BALL_ICON

/**
 * 自定义图标落进球里的两种方式。
 *
 * 只差一个尺寸：有的图本身就是一个完整的圆（头像、徽标），铺满才好看；
 * 有的是透明底上的一枚小图案，缩在球心才不至于把笔画顶到球边上去。
 *
 * 两种都保留球自己的底色。那一层在铺满时不显眼（图是不透明的就把它整个盖住了），
 * 而在图的透明部分上正好补上底色——否则收起态下球会整颗消失，
 * 而收起态的球就是窗口的全部内容。
 */
export type BallCustomFit = 'cover' | 'glyph'

export const BALL_CUSTOM_FITS: ReadonlyArray<{ id: BallCustomFit; label: string; hint: string }> = [
  { id: 'cover', label: '铺满球面', hint: '图铺满整颗球的边缘，适合本身是圆形的图' },
  { id: 'glyph', label: '中央图案', hint: '图缩在球心，四周留给球的底色' }
]

export const DEFAULT_BALL_CUSTOM_FIT: BallCustomFit = 'cover'

/**
 * 自定义图标的落盘边长（像素）。
 *
 * 球只有 40px，128 已留足 HiDPI 的余量（3 倍屏上是 120）。
 * 裁剪后按这个边长编码，存的就是它实际会被用到的尺寸——
 * 用户上传一张 4000px 的照片，没必要原样留在配置目录里。
 */
export const BALL_IMAGE_SIZE = 128

/**
 * 自定义图标的体积上限（字符数）。
 *
 * base64 之后大约是原始字节的 4/3，512KB 对应约 384KB 的图，
 * 而 128×128 的 WebP 通常在 5–20KB。这个上限只用来挡「显然不该收的东西」，
 * 正常上传碰不到它。
 */
export const BALL_IMAGE_MAX_BYTES = 512 * 1024

/** 标签页状态广播去抖（毫秒） */
export const TABS_BROADCAST_DEBOUNCE_MS = 60

/** 持久化写入去抖（毫秒） */
export const PERSIST_DEBOUNCE_MS = 300

// ---------------------------------------------------------------- 自动检查更新

/**
 * 更新源。本应用唯一的对外地址。
 *
 * 走的是 `releases/latest/download/` 这条**下载路径**，不是 api.github.com：
 * 前者不需要 token、不占未认证请求那 60 次/小时的额度，也只是 CDN 上的一个
 * 静态文件。查新版本这件事值不上一条 API 通道。
 *
 * owner/repo 写死在这里而不是去读打包时生成的 app-update.yml：那个文件是
 * electron-builder 从 git remote 推出来的，一旦打包机器上的 remote 变了，
 * 它就悄悄变——而这份地址是产品事实，不该随构建环境漂。
 */
export const UPDATE_FEED_BASE = 'https://github.com/m4xlmum/zhituan'

/**
 * 启动后多久才去查（毫秒）。
 *
 * 两个理由，都与「别打扰」有关：一是别和启动那一堆活（恢复标签页、重建托盘、
 * 摆窗口）抢；二是一个刚打开的窗口立刻自己冒出一条提示，比二十秒后悄悄多出
 * 一条更容易被旁边的人一眼看见。
 */
export const UPDATE_CHECK_DELAY_MS = 20_000

/**
 * 单次检查（取 latest.yml）的整体超时（毫秒）。
 *
 * Electron 的 ClientRequest 没有 setTimeout，自己挂一个定时器调 abort()。
 * 拿不到就当作「这次没查到」——查更新失败不该在界面上留下任何东西。
 */
export const UPDATE_CHECK_TIMEOUT_MS = 15_000

/**
 * 下载卡住的判据（毫秒）：多久没有收到任何数据就放弃。
 *
 * 刻意**不设总时长上限**：安装包有 100MB 以上，慢网下线几分钟是正常的，
 * 设了总时长等于「网慢的人永远更新不了」。判据只能是「还在动吗」。
 * 每收到一块数据就把这个表重置一次。
 */
export const UPDATE_STALL_MS = 60_000

/**
 * 起安装程序之后、退出之前留的宽限期（毫秒）。
 *
 * 真事：上一个版本的安装窗口没关，互斥锁（APP_GUID 两个版本同一把）让新的
 * 安装程序在半秒内 Abort，安安静静——应用若照原样「起了就退」，用户手里就
 * 什么都没有了：应用关了、安装没开始、原因一个字都没有。宽限期内夭折就留在
 * ready 并把原因说给人（见 updateService.spawnInstaller）。三秒足够看出
 * 「当场夭折」，也短到不拖正常安装——活过宽限期说明它已经在真的干活，退出
 * 交接才交得出去。
 */
export const UPDATE_SPAWN_GRACE_MS = 3_000

