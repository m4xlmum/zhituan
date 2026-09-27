/**
 * 键控：把 PDF 那一层纸收掉、只留下字，并把字染成当前主题的墨色。
 *
 * 这是整个自阅方案里唯一一处「算法」，也是唯一一处**只能靠测量定下来**的东西，
 * 因此它单独成文件、注释里带着量出来的数（探针 spike/pdf-render.js，结论记在
 * docs/spike-findings.md 的 Q51 之后）。三条判据逐条都有来历：
 *
 * 一、透明背景只对「没有画纸」的 PDF 有效。
 *     pdf.js 允许 `background: 'rgba(0,0,0,0)'`，纯文字页到这一步就只剩字了
 *     （实测 563362 个透明像素）。但很多 PDF（尤其是各种转换器印出来的）**真的
 *     画了一张白矩形**当纸，那种页面上透明背景一点用没有。
 *
 * 二、纸必须能被「键」掉，而键控要以**纸本身为零点**。
 *     最直接的想法是 `keep = 1 - 亮度`（越黑越留），它在纯黑字上恰好对；但纸要是
 *     #111 那种「不是纯黑」的深底，就会留下一层 6.7% 的灰雾（实测 meanAlpha 18.5、
 *     整页只透出 11%），灰色的纸更糟——那是 50% 的一层纱。中位数就是纸：一页里
 *     占面积最大的一层必然是纸，于是以它为 0、以纯黑（或纯白）为 1。
 *
 * 三、「有没有纸」与「哪一面是纸」是两个问题，不能混成一个。
 *     纯文字页里「画上的像素」只有字本身，它的亮度中位数必然是暗的（实测 16）；
 *     拿这个数当「纸是黑的」去翻，正文会被整个抹掉（实测只剩 7321 个像素）。
 *     因此先看**画满没画满**（`painted > PAPER_SHARE`）——只有整页基本被画满，
 *     才谈得上「哪一边是纸」；没画满就一律按浅纸、用 `keep = 1 - 亮度`
 *     （那一页的「纸」就是没画过的那些像素：窗口透明，桌面透过来）。
 *
 * 四、纸那一头定成中位数之后，**墨那一头也得跟着定**，不能默认它是纯黑。
 *     正文极少是 #000：这一版所有素材印出来的正文都是 #111，亮度 0.067，
 *     于是 `keep = (P - L) / P` 给出 0.933——字是 93.3% 的墨，桌面上那 6.7%
 *     从笔画里透出来。这与第二条里量到的 6.7% 是同一个数、同一个毛病，
 *     只是换到了墨这一头：**纸是 0 这一头由中位数定了，另一头就得由这一页
 *     最深的墨来定**。做法是再数一份直方图、问「实心像素里最暗的那 0.5% 落在哪」
 *     （不取单个最暗的像素：一个压缩噪点不该让整页的墨退回去），据此把量程
 *     拉到 1。整页最深的墨也没比纸深多少（不到四分之一量程）时不拉：那一页
 *     没有「墨」可谈，放大只会把底纹与噪点变成字。
 *
 *     这一份直方图必须只收**实心**的像素（alpha ≥ 128），不能与判纸那一份合用：
 *     半透明的裙边上 RGB 是 premultiply 反算的，alpha 越小越不可信（a=8 附近
 *     `#111` 会反算成 `(0,0,0)`）。实测过——纯文字页只画了 2.6% 的像素，
 *     「最暗的 0.5%」只有几十个，被那条裙边占成 L=0，量程于是算成 1、
 *     字停在 238/255（93%，正好又是那层 6.7% 的纱）。
 *
 *     上面这些数都是**量出来的**，不是想出来的：探针 spike/pdf-scheme.js 的
 *     逐像素读数、以及 spike/pdf-render.js 逐素材跑的那一遍。
 *
 * 交给它的画面必须是刚画完的原始像素：键控是**就地改写**的，用同一张画布连着算
 * 两次，第二次吃到的是第一次的结果。阅读页每次重画都会先 clearRect 再来，正是为此。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/** 用户按的那一档。auto 自己判深浅，另外两档是「我说的算」 */
export type Polarity = 'auto' | 'light' | 'dark'

/** 键控这一趟的结果，给探针与调试看 */
export interface Keyed {
  /** 纸的亮度 0–1；null = 这一页没有画出来的纸（纯文字页） */
  paper: number | null
  /** 实际按哪一面键的 */
  face: 'light' | 'dark' | 'plain'
  /** 画上的像素（alpha ≥ 8）占全页的比例 0–1 */
  painted: number
  /** 键控**之前**最深的墨离纸有多远（0–1，1 = 已经是纯黑／纯白）。1 表示没拉量程 */
  span: number
  /** 这一趟花了多少毫秒 */
  ms: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 「整页基本被画满」的界线。
 *
 * 六份素材实测（画上的像素占整页的比例，探针 spike/pdf-render.js 的「画满」一栏）：
 *   纯文字 2.6% · 中文 3.8% · 一块彩色插图 17.9% · 一块白纸 28% · 带页边距的深底 45.4%
 *   · 整页深底 84.9%
 * 界线取在 28% 与 45.4% 那道空档里，并且**往低处偏**：
 *
 *  · 浅色占多数时这条界线根本用不上——把浅灰纸当成「白纸」与当成「没画」是同一件事
 *    （实测：28% 那一份白纸在两边的结果逐像素相同，因为 P 都算成 1）。
 *    它只在「画上的那些像素以深色为主」时说话，而那时只有两种解释：那是一张深纸，
 *    或者那是字／插图。字不可能铺满三分之一页（排满的正文也就 4–8%），所以由面积判。
 *  · 判错的代价两头不一样：漏判一张深纸，整页变成一块实心墨、**一个字都读不出来**；
 *    把一块大插图当成深纸，是那张插图消失——而彩色本来就明写了要放弃。
 *    因此宁可把界线放低一点。
 *  · 再往低走就不行了：一块占了三分之一页的深色插图会被当成纸。这一档没有万全的
 *    界线（这一页上「纸」与「大块深色」本来就是同一个东西），认错了按右下角那枚键。
 */
const PAPER_SHARE = 0.35

/**
 * 墨那一头至少要占四分之一量程，才值得把量程拉到 1。
 *
 * 见文件头第四条：不够四分之一就说明这一页没有「墨」，多半只是一层底纹，
 * 这时最多就该什么都不做——放大等于把噪点写成字。
 */
const INK_SPAN_FLOOR = 0.25

/** 取尾部多少个像素当「墨」：画上的像素里最暗（或最亮）的 0.5% */
const INK_TAIL = 0.005

/**
 * 就地键控。返回纸的亮度与实际按的那一面（给读数用）。
 *
 * `ink` 是墨色（themes.css 里 `:root` 那一组的 --zhituan-ink，见 PdfApp 里读它的地方）：
 * 键控把每个像素的 alpha 按「它有多像我想要的东西」算出来，RGB 一律写成这个墨色
 * ——PDF 里的彩色（插图、彩色标题）在这一步被放弃，换来的是一份**在任何主题下都
 * 读得下去**的正文（这一页不跟主题换色，见 PdfApp 的文件头注释）。这是自阅方案
 * 明写的取舍，不是疏漏。
 */
export function inkCanvas(
  ctx: CanvasRenderingContext2D,
  ink: readonly [number, number, number],
  polarity: Polarity
): Keyed {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const t0 = performance.now()

  // 两趟直方图同时问出三件事：纸的亮度（中位数）、「这一页画满了没有」、以及墨有多深。
  // 亮度用 Rec.709 那一组系数（0.2126/0.7152/0.0722），与 CSS 的 filter 同源，
  // 眼睛对绿的敏感度最高这件事就体现在这三个数上。
  //
  // 两个直方图的分界是 alpha：`hist` 收所有画上的像素（a ≥ 8），用来判纸；
  // `inkHist` 只收**实心**的（a ≥ 128），用来量墨。后者不是可有可无的——
  // 半透明的那条裙边上，像素的 RGB 是 premultiply 反算回来的，alpha 越小越不可信
  // （a=8 附近 #111 会反算成 (0,0,0)）。实测：纯文字页只画了 2.6% 的像素，
  // 「最暗的 0.5%」只有几十个，被那条裙边占成了 L=0，于是量程算成 1、字停在
  // 238/255（93%，又是那层 6.7% 的纱）；改成只在实心像素上量，同一页就是 255。
  let painted = 0
  let solid = 0
  const hist = new Uint32Array(256)
  const inkHist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a < 8) continue
    const L = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
    hist[L]++
    painted++
    if (a >= 128) {
      inkHist[L]++
      solid++
    }
  }
  let acc = 0
  let median = 0
  for (let L = 0; L < 256; L++) {
    acc += hist[L]
    if (acc >= painted / 2) {
      median = L
      break
    }
  }
  // 再问两次：墨那一头落在哪儿（实心像素里最暗／最亮的 0.5%）
  const tail = Math.max(1, Math.round(solid * INK_TAIL))
  let lo = 0
  acc = 0
  for (let L = 0; L < 256 && solid > 0; L++) {
    acc += inkHist[L]
    if (acc >= tail) {
      lo = L
      break
    }
  }
  let hi = 255
  acc = 0
  for (let L = 255; L >= 0 && solid > 0; L--) {
    acc += inkHist[L]
    if (acc >= tail) {
      hi = L
      break
    }
  }
  const share = painted / (d.length / 4)
  const hasPaper = share > PAPER_SHARE

  /*
   * 零点 P 与方向。
   *
   * auto：有纸就按中位数分深浅；没纸就没有「纸」这个概念，走纯文字的算法。
   * light / dark：方向由用户那一下定，零点仍取中位数——那一档说的是「纸在哪一边」，
   *   而不是「纸有多亮」。所以在一页深底浅字上按「浅底」，结果是整页被抹平；
   *   这是按错按钮的诚实后果（再按一下就到「深底」），比留一层纱糊着强。
   * 纯文字页上按「深底」同理会把字抹掉：它本来就没有纸，深底这个说法不成立。
   */
  let paper: number | null
  let face: Keyed['face']
  if (polarity === 'light') {
    paper = hasPaper ? median / 255 : 1
    face = 'light'
  } else if (polarity === 'dark') {
    paper = hasPaper ? median / 255 : 0
    face = 'dark'
  } else if (hasPaper) {
    paper = median / 255
    face = paper >= 0.5 ? 'light' : 'dark'
  } else {
    paper = null
    face = 'plain'
  }

  /*
   * 墨那一头的零点（文件头第四条）：量出这一页最深的墨离纸有多远，再把量程拉到 1。
   * 三条式子与下面那三条一模一样，只是问的是「最深的墨落在哪儿」而不是「这个像素落在哪儿」。
   */
  let span: number
  if (paper === null) span = 1 - lo / 255
  else if (face === 'dark') span = (hi / 255 - paper) / Math.max(1 - paper, 1e-3)
  else span = (paper - lo / 255) / Math.max(paper, 1e-3)
  span = clamp01(span)
  const scale = span > INK_SPAN_FLOOR ? 1 / span : 1

  const [r, g, b] = ink
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    /*
     * 三条式子，都是「以纸为 0、以另一头为 1」的同一个意思：
     *   plain  1 - L        没有纸，纸就是白
     *   light  (P - L) / P      P 是白纸的亮度
     *   dark   (L - P) / (1-P)  P 是深纸的亮度
     * 输入那一层的 alpha 必须乘进来（`a * …`）：PDF 里本来就半透明的地方
     * （水印、底纹）不该因为键控变成实心。
     * 分母兜一个 1e-3：纯黑纸（P=0）时 (1-P) 是 1，纯白纸（P=1）时 P 是 1，
     * 两条都到不了 0，这个兜底只是不让它除出 Infinity 来。
     *
     * `scale` 就是文件头第四条那一拉：只放大量程，不动零点——纸仍然是 0，
     * 变的只是「这一页最深的墨」从 0.93 成为 1。
     */
    let shape: number
    if (paper === null) shape = 1 - L
    else if (face === 'dark') shape = clamp01((L - paper) / Math.max(1 - paper, 1e-3))
    else shape = clamp01((paper - L) / Math.max(paper, 1e-3))

    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
    d[i + 3] = Math.max(0, Math.min(255, Math.round(clamp01(shape * scale) * a * 255)))
  }

  ctx.putImageData(img, 0, 0)
  return { paper, face, painted: +share.toFixed(4), span: +span.toFixed(4), ms: performance.now() - t0 }
}

/**
 * 把一条 CSS 颜色读成三个通道。
 *
 * 墨色来自主题层（styles/themes.css 的 --zhituan-ink）。这一页不写主题名，因此读到
 * 的总是 `:root` 那一份（纸白的近黑）；这里仍认 `rgb()/rgba()` 与三位十六进制，
 * 是因为配色是**可以改的**——改配色的人不该因为换了一种写法就看见一个「墨色没
 * 生效」的怪毛病。认不出来时回落到深色那一支（#e7e9ee 之类），绝不回落到纯黑：
 * 纯黑在深色桌面上的透明窗口里等于隐形。
 */
export function inkFromCss(value: string | null | undefined): [number, number, number] {
  const text = (value ?? '').trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const s = hex[1]
    const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16)
    ]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2])]
    }
  }
  return [231, 233, 238]
}
