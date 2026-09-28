# -*- coding: utf-8 -*-
"""
纸团 · 图标方案生成器（SVG 版）

链路：本脚本产 SVG 与一张对比板 HTML  ->  Chrome 无头栅格化成 PNG  ->  make_ico.py 打包。
全程不用装任何 Python 包（Chrome 是系统自带的），也不去碰 Electron ——
这台机器的执行环境会把 Electron 的渲染进程掐掉（SIGTERM，--no-sandbox
--in-process-gpu 都不行），Pillow 的下载又被代理卡死，只剩这条路。

「纸团」的几何：10 个顶点的多边形，角度刻意不等分、半径在 0.70~1.07 之间大幅摆动。
先试过 12 个均匀点加等幅抖动 —— 出来是一颗中心对称的**切割宝石**，不是揉皱的纸。
纸团的特征恰恰是「面的大小差很多」：两个凹点之间的那个面特别小，对面那个特别大，
再叠 3 档相近明度，皱褶才立得住。

每套方案出两个变体：
  big   带折面，用于 >= 48px
  mini  纯剪影（线描方案则是粗描边轮廓），用于 <= 32px —— 小尺寸下折面会糊成噪点，
        靠轮廓认形才认得出来。
"""

import math
import os

S = 512
CX = CY = 256
R_BALL = 152
RX = 112               # 圆角，512 的 22%，接近 Windows 11 的比例

ANG = [5, 42, 78, 116, 152, 189, 226, 262, 300, 336]
RAD = [0.98, 0.73, 1.00, 0.93, 1.07, 0.81, 0.97, 0.70, 1.03, 0.92]
# 三条弦把纸团切成四片；线描方案用的是同一组
CREASES = ((2, 7), (4, 6), (8, 1))

INK = "#20252C"
PAPER = "#F5F1E8"
CREAM = "#FBF7EF"
DARK = "#22262B"
DEEP = "#0E1216"
VERMILION = "#C0392B"
PHOS = "#3AE374"

# 每套三色：(外剪影, 内层一块, 折痕)
PAL_WHITE = ("#FFFFFF", "#EDE7DC", "#D3C9B6")
PAL_INK = ("#242C35", "#161B21", "#3B4550")
PAL_RED = ("#C0392B", "#A32E21", "#D96753")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SVGDIR = os.path.join(OUT, "svg")


def pts(cx, cy, R, rot=0.0):
    out = []
    for a, r in zip(ANG, RAD):
        t = math.radians(a + rot)
        rr = r * R
        out.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
    return out


def d_closed(p):
    return "M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in p) + "Z"


def cut(poly, i, j):
    """沿 poly[i]→poly[j] 的弦把多边形切成两块，两个端点各归一块"""
    return poly[i:j + 1], poly[j:] + poly[:i + 1]


def ball(cx, cy, R, palette):
    """纸团：外剪影 + 内层一块 + 两条短折痕。

    试错的四条路都留在 README 里，结论是这一条：
      1. 12 个均匀顶点 + 放射三角面 -> 中心对称的**切割宝石**
      2. 三条弦切成 4 片         -> 大小合适，但硬边大色块读出来是**折纸**
      3. 5 层同源多边形叠上去     -> 小图还行，放到 512 就是**洋葱/螺旋**
      4. 32~58 个内部点的 low-poly -> 有质感，但无论怎么调都读成**石头**
    在扁平矢量里，「揉皱」这个信息只能靠**很少几条折痕**带；细节一多，石头。
    """
    base, inner, crease = palette
    p = pts(cx, cy, R)
    s = f'<path d="{d_closed(p)}" fill="{base}"/>'
    # 内层刻意偏心：居中的话是「同心圈」，偏出去才读成翻折起来的一层
    q = pts(cx + 0.08 * R, cy + 0.10 * R, R * 0.72, 16)
    s += f'<path d="{d_closed(q)}" fill="{inner}"/>'
    return s


def crumple_mini(cx, cy, R, fill, stroke=None, stroke_w=0):
    p = pts(cx, cy, R)
    s = f'<path d="{d_closed(p)}" fill="{fill}"/>'
    if stroke:
        s += (f'<path d="{d_closed(p)}" fill="none" stroke="{stroke}" '
              f'stroke-width="{stroke_w}" stroke-linejoin="round"/>')
    return s


# 线描用的是另一套骨架：14 个点、半径高低交替，边界**本身就是**锯齿。
# 纸团的边界就是褶皱；轮廓不带起伏，画出来只是一个多边形线框（试过）。
JAG_ANG = [6, 30, 61, 88, 112, 145, 168, 196, 218, 247, 271, 298, 322, 349]
JAG_RAD = [1.04, 0.89, 0.97, 1.06, 0.86, 1.02, 0.91, 1.05, 0.88, 0.99, 1.03, 0.90, 0.96, 1.00]
# 内部三条折痕，连的是凹点
JAG_CREASES = ((1, 7), (4, 11), (6, 13))


def jag_pts(cx, cy, R):
    out = []
    for a, r in zip(JAG_ANG, JAG_RAD):
        t = math.radians(a)
        out.append((cx + r * R * math.cos(t), cy + r * R * math.sin(t)))
    return out


def line_ball(cx, cy, R, color, w):
    p = jag_pts(cx, cy, R)
    s = (f'<path d="{d_closed(p)}" fill="none" stroke="{color}" stroke-width="{w}" '
         f'stroke-linejoin="round"/>')
    for a, b in JAG_CREASES:
        pa, pb = p[a], p[b]
        mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
        dx, dy = pb[0] - pa[0], pb[1] - pa[1]
        L = math.hypot(dx, dy) or 1.0
        s += (f'<polyline points="{pa[0]:.2f},{pa[1]:.2f} {mx - dy / L * 18:.2f},{my + dx / L * 18:.2f} '
              f'{pb[0]:.2f},{pb[1]:.2f}" fill="none" stroke="{color}" stroke-width="{w * 0.5:.1f}" '
              f'stroke-linecap="round" stroke-linejoin="round"/>')
    return s


def line_ball_mini(cx, cy, R, color, w):
    return (f'<path d="{d_closed(jag_pts(cx, cy, R))}" fill="none" stroke="{color}" '
            f'stroke-width="{w}" stroke-linejoin="round"/>')


def text_lines(cx, cy, w, gap, lw, color, rot, opacity=1.0):
    s = (f'<g transform="rotate({rot} {cx} {cy})" stroke="{color}" stroke-width="{lw}" '
         f'stroke-linecap="round" opacity="{opacity}">')
    for k in (-1, 0, 1):
        length = w * 0.6 if k == 1 else w
        x1 = cx - w / 2
        y = cy + k * gap
        s += f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x1 + length:.2f}" y2="{y:.2f}"/>'
    return s + "</g>"


def paper(x, y, w, h, r, rot, fill, opacity=1.0):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" '
            f'opacity="{opacity}" transform="rotate({rot} {CX} {CY})"/>')


_uid = [0]


def wrap_svg(bg, inner, size=None):
    # 同一张对比板上，一套方案要出现 7 次；SVG 的 id 是文档级的，不区分实例，
    # 撞车时所有 url(#…) 都会指回第一个 —— 给每个实例换一个唯一后缀。
    _uid[0] += 1
    for name in ("fade",):
        inner = inner.replace(f'id="{name}"', f'id="{name}{_uid[0]}"')
        inner = inner.replace(f"url(#{name})", f"url(#{name}{_uid[0]})")
    wh = f' width="{size}" height="{size}"' if size else ""
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}"{wh}>'
    back = f'<rect width="{S}" height="{S}" rx="{RX}" fill="{bg}"/>' if bg else ""
    return head + back + inner + "</svg>"


# ———————————————————————————————————————— 七套方案：返回 (底色, 大图, 小图)

def scheme_A(big):
    bg = DARK
    if big:
        return bg, ball(CX, CY, R_BALL, PAL_WHITE)
    return bg, crumple_mini(CX, CY, R_BALL + 8, "#FFFFFF")


def scheme_B(big):
    bg = PAPER
    if big:
        return bg, ball(CX, CY, R_BALL, PAL_INK)
    return bg, crumple_mini(CX, CY, R_BALL + 8, INK)


def scheme_C(big):
    bg = PAPER
    if big:
        return bg, ball(CX, CY, R_BALL, PAL_INK) + text_lines(246, 262, 116, 33, 11, CREAM, -8)
    return bg, crumple_mini(CX, CY, R_BALL + 8, INK) + text_lines(246, 262, 114, 35, 14, PAPER, -8)


def scheme_D(big):
    bg = DARK
    if big:
        return bg, line_ball(CX, CY, R_BALL, CREAM, 17)
    return bg, line_ball_mini(CX, CY, R_BALL, "#FFFFFF", 30)


def scheme_E(big):
    bg = DARK
    back = paper(196, 168, 196, 250, 18, -15, "#FFFFFF", 0.30 if big else 0.40)
    front = paper(150, 142, 212, 258, 20, -4, CREAM if big else "#FFFFFF")
    lines = text_lines(255, 251, 140, 42, 11, "#C6BDAE", -4) if big else ""
    return bg, back + front + lines


def scheme_F(big):
    bg = PAPER
    if big:
        return bg, ball(CX, CY, R_BALL, PAL_RED)
    return bg, crumple_mini(CX, CY, R_BALL + 8, VERMILION)


def scheme_G(big):
    """渐隐的纸：把「窗口可逐像素透明」这一条直接画出来，不借任何隐喻"""
    bg = DARK
    if big:
        defs = ('<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">'
                '<stop offset="0" stop-color="#FBF7EF" stop-opacity="1"/>'
                '<stop offset="0.42" stop-color="#FBF7EF" stop-opacity="0.74"/>'
                '<stop offset="1" stop-color="#FBF7EF" stop-opacity="0.10"/>'
                '</linearGradient></defs>')
        lines = ('<g stroke="#22262B" stroke-width="11" stroke-linecap="round" opacity="0.5">'
                 '<line x1="188" y1="178" x2="324" y2="178"/>'
                 '<line x1="188" y1="218" x2="288" y2="218"/></g>')
        return bg, defs + '<rect x="152" y="108" width="208" height="296" rx="22" fill="url(#fade)"/>' + lines
    return bg, '<rect x="152" y="108" width="208" height="296" rx="22" fill="#FBF7EF"/>'


def scheme_D2(big):
    bg = DEEP
    if big:
        return bg, line_ball(CX, CY, R_BALL, PHOS, 17)
    return bg, line_ball_mini(CX, CY, R_BALL, PHOS, 30)


# id 是给用户看与引用的编号，函数名是内部实现（两边的顺序在此对齐）
SCHEMES = [
    ("A", "纸 · 墨", scheme_A,
     "一团纸的剪影压在深色底上，层与层之间只差一点明度。放进任务栏是一枚不起眼的深色方块，不喊「我是阅读器」——顺的是产品原则一「隐蔽优先于美观」。"),
    ("B", "纸 · 纸白", scheme_B,
     "反过来：暖白纸底压一团墨，安静、像纸品，跟「纸白」主题是一路的。A 和 B 选一个，主要看你想让它在浅色任务栏里跳，还是融进去。"),
    ("C", "纸 · 有字", scheme_C,
     "同 B，但纸里留了三行字：揉了，还看得出里面是字。这一套最贴题——产品干的就是把正在读的东西揉成一团。代价是 16px 下那三行只剩一块。"),
    ("D", "纸 · 线描", scheme_D,
     "只有一根粗细均匀的线勾出褶皱起伏。笔画最少、最轻的一套，缩到 16px 靠轮廓认形。想让图标存在感最低就选它。"),
    ("E", "纸 · 朱砂", scheme_F,
     "白纸底上一团朱砂红，像一枚印章。中文名字配中国色，是里面最显眼、最有「个性」的一个。"),
    ("F", "两张纸 · 透明", scheme_E,
     "前面一张实的、后面一张半透明的纸错开。这个隐喻和产品机制是同一条：窗口能逐像素透明，纸底下的东西透得出来。全部方案里最好认的一套。"),
    ("G", "渐隐的纸", scheme_G,
     "一张纸自上而下淡出，直接把「窗口可调透明度」画出来，不借任何隐喻。最「功能说明」的一套，也最不像阅读器。"),
    ("H", "纸 · 线描（磷绿）", scheme_D2,
     "就是 D，换第三个主题「磷绿」的颜色。只作参考——磷绿在浅色任务栏里对比偏弱。"),
]

SIZES = [
    (64, False),
    (48, False),
    (32, True),
    (16, True),
]


def build_board(path):
    cards = []
    for sid, name, fn, note in SCHEMES:
        bg, big = fn(True)
        _, mini = fn(False)
        hero = wrap_svg(bg, big, 190)
        sizes = "".join(
            f'<div class="sz">{wrap_svg(bg, mini if m else big, px)}<span>{px}</span></div>'
            for px, m in SIZES
        )
        bars = "".join(
            f'<div class="bar {kind}">{wrap_svg(bg, mini, 28)}'
            f'<span class="t">纸团</span><span class="u">&nbsp;· 32px</span></div>'
            for kind in ("dark", "light")
        )
        cards.append(f'''<section class="card">
  <div class="hero">{hero}<div class="idtag">{sid}</div></div>
  <div class="body">
    <div class="name">{name}</div>
    <p class="note">{note}</p>
    <div class="rowlabel">尺寸</div>
    <div class="sizes">{sizes}</div>
    <div class="rowlabel">任务栏</div>
    <div class="bars">{bars}</div>
  </div>
</section>''')

    html = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>纸团 · 图标方案</title><style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 34px 40px 44px; background: #E7E7EA; width: 1240px;
         font-family: "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
         color: #1B1F24; }}
  header {{ margin-bottom: 26px; }}
  h1 {{ margin: 0 0 8px; font-size: 25px; letter-spacing: .5px; }}
  .sub {{ font-size: 13.5px; color: #5A6470; line-height: 1.75; max-width: 940px; }}
  .sub b {{ color: #1B1F24; }}
  .card {{ background: #FFF; border: 1px solid #D6D6DC; border-radius: 14px;
           padding: 20px 22px; margin-bottom: 16px; display: flex; gap: 26px;
           align-items: flex-start; }}
  .hero {{ flex: 0 0 190px; display: flex; flex-direction: column; align-items: center; gap: 10px; }}
  .hero svg {{ display: block; border-radius: 6px; box-shadow: 0 5px 16px rgba(20,24,30,.16); }}
  .idtag {{ font-size: 11.5px; font-weight: 700; letter-spacing: 1px; color: #fff;
            background: #3A424C; border-radius: 5px; padding: 2px 8px; }}
  .body {{ flex: 1 1 auto; min-width: 0; }}
  .name {{ font-size: 17px; font-weight: 700; margin: 2px 0 8px; }}
  .note {{ font-size: 13px; line-height: 1.8; color: #4A5460; margin: 0 0 16px; }}
  .rowlabel {{ font-size: 11px; color: #8A929C; letter-spacing: .6px; margin-bottom: 6px; }}
  .sizes {{ display: flex; align-items: flex-end; gap: 20px; margin-bottom: 16px; }}
  .sz {{ display: flex; flex-direction: column; align-items: center; gap: 5px; }}
  .sz svg {{ display: block; }}
  .sz span {{ font-size: 10.5px; color: #9AA1AA; }}
  .bars {{ display: flex; gap: 14px; }}
  .bar {{ display: flex; align-items: center; gap: 9px; border-radius: 8px;
          padding: 7px 14px 7px 9px; }}
  .bar.dark {{ background: #1C1C1E; }}
  .bar.dark .t {{ color: #E8E8EA; }}
  .bar.light {{ background: #F2F2F4; border: 1px solid #DCDCE0; }}
  .bar.light .t {{ color: #1B1F24; }}
  .bar .t {{ font-size: 12px; }}
  .bar svg {{ display: block; }}
  .bar .u {{ font-size: 10px; opacity: .45; }}
</style></head><body>
<header>
  <h1>纸团 · 图标方案</h1>
  <div class="sub">
    每套给三样：<b>大图</b>（设置页 / 关于页的样子）、<b>各档尺寸</b>（16 与 32 是任务栏和 Alt+Tab 的真实大小，认不认得出看这一栏）、
    <b>深浅两种任务栏</b>（Windows 浅色与深色主题，图标在这两处都得站得住）。<br>
    全部矢量绘制，选中的那套会导出 16/32/48/64/128/256 六档 <code>icon.ico</code>，小尺寸另有简化版（去掉折面，只留轮廓）。
  </div>
</header>
<main>
{''.join(cards)}
</main></body></html>'''

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return len(html)


def main():
    os.makedirs(SVGDIR, exist_ok=True)
    for sid, name, fn, note in SCHEMES:
        for suffix, big in (("", True), ("-mini", False)):
            bg, inner = fn(big)
            with open(os.path.join(SVGDIR, f"{sid}{suffix}.svg"), "w", encoding="utf-8") as f:
                f.write(wrap_svg(bg, inner))
        print(f"  {sid:3} {name}")

    n = build_board(os.path.join(OUT, "board.html"))
    print(f"\n对比板 -> out/board.html（{n / 1024:.1f} KB，用 Chrome 截成 board.png）")
    print(f"单个 SVG -> out/svg/（{len(SCHEMES) * 2} 个）")


if __name__ == "__main__":
    main()
