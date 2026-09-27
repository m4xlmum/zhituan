/**
 * 探针：拖动边缘改大小时，那个矩形到底是怎么算出来的。
 *
 * 缩放是这一版里唯一一处「算错了也不会报错」的地方——它会老实把窗口摆成
 * 一个 20:1 的长条，或者让窗口在拖上边缘时整体往下长（看起来像在移动窗口），
 * 而这两种错都只在屏幕上才看得出来。因此这里干两件事：
 *
 *   1. 把真的 geometry.ts 打成一包 require 进来，对 resizeRect 逐条断言不变量：
 *      恒为 16:9、被拖边对面钉住、上下限、以及角上两轴用哪一轴做主驱动。
 *   2. 再开一扇**真窗口**（摆在所有显示器之外，屏幕上不会出现任何东西），
 *      按算出来的矩形 setBounds 并读回比对。第 1 步验的是算术，
 *      这一步验的是「这扇窗真的收得下这个矩形」。
 *
 * 跑法：npx electron spike/resize.js
 * 产出：终端一份 [Qn] 报告，spike/out/resize.json
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const { app, BaseWindow, screen } = require('electron')
const esbuild = require('esbuild')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** 与 @shared/constants 对齐的两条：最小版面与比例 */
const MINI = { width: 480, height: 270 }
const RATIO = 16 / 9

const results = []
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail })
  console.log(`[${id}] ${verdict} — ${question}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

/**
 * 把真的 geometry.ts 打成一包再 require。
 *
 * 不在这里另抄一份 resizeRect：那样验的是抄本，而抄本永远是对的。
 * esbuild 本来就在依赖树里（vite 带进来的），给它一个 @shared 别名即可。
 */
async function loadGeometry() {
  const outfile = path.join(os.tmpdir(), `zhituan-geometry-${process.pid}.cjs`)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main', 'services', 'geometry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    alias: { '@shared': path.join(ROOT, 'src', 'shared') },
    logLevel: 'silent'
  })
  return require(outfile)
}

/** 恒 16:9：宽度与「高度 × 比例」相差不超过 1px（四舍五入的代价） */
const isRatio = (r) => Math.abs(r.width - r.height * RATIO) <= 1

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

app.whenReady().then(async () => {
  const { resizeRect } = await loadGeometry()

  /** 一扇所有显示器之外的落点，保证窗口永远不可见 */
  const displays = screen.getAllDisplays()
  const origin = {
    x: Math.min(...displays.map((d) => d.bounds.x)) - 900,
    y: Math.min(...displays.map((d) => d.bounds.y)) - 900
  }
  const workArea = screen.getDisplayMatching({ x: 0, y: 0, width: 1, height: 1 }).workArea
  const LIMITS = { min: MINI, max: { width: workArea.width, height: workArea.height } }

  const start = { x: 400, y: 300, width: 960, height: 540 }

  // ---- Q1：八条边各拖一段，结果都必须是 16:9 ----
  const ratioCases = []
  for (const edge of EDGES) {
    for (const [dx, dy] of [
      [120, 90],
      [-160, -140],
      [37, 11],
      [-9, 260]
    ]) {
      const r = resizeRect(start, edge, dx, dy, LIMITS)
      ratioCases.push({ edge, dx, dy, w: r.width, h: r.height, ok: isRatio(r) })
    }
  }
  const ratioBad = ratioCases.filter((c) => !c.ok)
  record(
    'Q1',
    `${ratioCases.length} 组拖法（八条边 × 四种位移）的结果都应当是 16:9`,
    ratioBad.length === 0 ? '是' : `否，${ratioBad.length} 组不是`,
    ratioBad.length ? ratioBad.slice(0, 4) : ratioCases.slice(0, 3)
  )

  // ---- Q2：被拖边对面那条边一动不动 ----
  /*
   * 这一条是缩放手感的全部：拖右边时左边缘不动，拖上边时下边缘不动。
   * 若写成「左上角永远钉死」，拖上边时窗口会整体往下长，看起来像在移动窗口。
   */
  const anchors = []
  for (const edge of EDGES) {
    const r = resizeRect(start, edge, 140, 100, LIMITS)
    anchors.push({
      edge,
      // 拖左边（含含 w 的角）时右边不动，否则左边不动
      left: edge.includes('w') ? r.x : start.x,
      leftOk: edge.includes('w') ? r.x + r.width === start.x + start.width : r.x === start.x,
      // 拖上边时下边不动，否则上边不动
      topOk: edge.startsWith('n') ? r.y + r.height === start.y + start.height : r.y === start.y,
      rightEdge: r.x + r.width,
      bottomEdge: r.y + r.height,
      w: r.width,
      h: r.height
    })
  }
  const anchorBad = anchors.filter((a) => !a.leftOk || !a.topOk)
  record(
    'Q2',
    '被拖边对面那条边应当钉住不动（拖右边钉左边、拖上边钉下边……）',
    anchorBad.length === 0 ? '是' : `否，${anchorBad.length} 条边不对`,
    anchorBad.length ? anchorBad : anchors.map((a) => `${a.edge}:${a.leftOk && a.topOk ? 'ok' : 'bad'}`).join(' ')
  )

  // ---- Q3：上下限 ----
  /*
   * 下限是 mini 那一档（已验证过的最小版面），上限是当前显示器的工作区。
   * 两个方向都要试：拖到极小与拖到极大。
   */
  const tiny = resizeRect(start, 'se', -5000, -5000, LIMITS)
  const huge = resizeRect(start, 'se', 5000, 5000, LIMITS)
  const tall = resizeRect(start, 'se', 5000, 0, LIMITS)
  record(
    'Q3',
    '拖到极小应当停在 mini 档，拖到极大应当停在工作区之内',
    tiny.width === MINI.width && tiny.height === MINI.height && huge.width <= workArea.width && huge.height <= workArea.height
      ? '是'
      : '否',
    { tiny: { w: tiny.width, h: tiny.height }, huge: { w: huge.width, h: huge.height }, tall: { w: tall.width, h: tall.height }, workArea }
  )

  // ---- Q4：角上两轴取相对变化更大的那一轴做驱动 ----
  /*
   * 角上同时拖两个方向时，两轴各自算出的边长本来就不一致（16:9 只有一个自由度），
   * 取「相对变化更大」的那一个，手感才是「往哪边拖得多就听谁的」。
   */
  const xWins = resizeRect(start, 'se', 480, 10, LIMITS)
  const yWins = resizeRect(start, 'se', 10, 270, LIMITS)
  record(
    'Q4',
    '拖右下角时，相对变化更大的那一轴说了算',
    // 宽 +480（相对 +50%）对上高 +10（相对 +1.9%）→ 听宽的，得到 1440
    // 高 +270（相对 +50%）对上宽 +10（相对 +1%）→ 听高的，也是 1440
    xWins.width === 1440 && yWins.width === 1440 ? '是' : '否',
    { '横拖占优': { w: xWins.width, h: xWins.height }, '竖拖占优': { w: yWins.width, h: yWins.height } }
  )

  // ---- Q5：真窗口收得下这些矩形（并且读回来就是那个尺寸） ----
  const win = new BaseWindow({
    x: origin.x,
    y: origin.y,
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'zhituan-resize-probe'
  })

  const applyCases = [
    ['右下角拖大', resizeRect(start, 'se', 260, 0, LIMITS)],
    ['左上角拖小', resizeRect(start, 'nw', -180, 0, LIMITS)],
    ['上边往上拖', resizeRect(start, 'n', 0, -150, LIMITS)],
    ['左边往左拖', resizeRect(start, 'w', -120, 0, LIMITS)],
    ['拖到最小', resizeRect(start, 'se', -5000, -5000, LIMITS)],
    // 工作区那一块：第三节的「最大化」就是把它交给同一个 setBounds
    ['工作区整块', { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }]
  ]

  const applied = []
  for (const [name, rect] of applyCases) {
    const want = { ...rect, x: origin.x, y: origin.y }
    win.setBounds(want)
    await delay(70)
    const got = win.getBounds()
    applied.push({
      name,
      want: { w: want.width, h: want.height },
      got: { w: got.width, h: got.height },
      dw: got.width - want.width,
      dh: got.height - want.height,
      ratioOk: isRatio(got)
    })
  }
  const applyBad = applied.filter((c) => Math.abs(c.dw) > 1 || Math.abs(c.dh) > 1)
  record(
    'Q5',
    '真窗口按算出的矩形 setBounds，读回来应当一致（resizable:false 也算数）',
    applyBad.length === 0 ? '是' : `否，${applyBad.length} 例对不上`,
    applied
  )

  record(
    'Q6',
    '工作区整块可以被一次 setBounds 摆出来（第三节的「最大化」就靠它）',
    applied.find((c) => c.name === '工作区整块')?.dw === 0 &&
      applied.find((c) => c.name === '工作区整块')?.dh === 0
      ? '是'
      : '否',
    { workArea, got: applied.find((c) => c.name === '工作区整块') }
  )

  win.destroy()

  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'resize.json'),
    JSON.stringify({ start, workArea, results, ratioCases, anchors, applied }, null, 2),
    'utf8'
  )

  app.exit(0)
})

app.on('window-all-closed', () => app.quit())
