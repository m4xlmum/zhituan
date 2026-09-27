"""造一本用来实测的真 EPUB。

用 Python 的 zipfile 而不是自己拼字节：**输入必须是可信的**。自己拼一份 ZIP 再拿它
去验解析器，写坏的那一处会同时骗过两边——「两边一致」在这里什么也证明不了。

这本样本刻意把几条难走的路都放进去：

  · `mimetype` 第一个、不压缩（EPUB 规范的要求，也是 ZIP 里唯一一条「顺序有意义」的规矩）
  · EPUB 3 的 `nav.xhtml` 目录，其中一条是嵌套的（量目录的缩进层级）
  · 一个 `linear="no"` 的条目（它**不该**出现在章节表里）
  · 一章里带 `<script>` 与 `onclick=`（量清洗那一道闸）
  · 另一章**故意不是良构的 XHTML**（`<p>` 不闭合）——这是那条
    「`.xhtml` 按 text/html 送」的逃生口的实测对象
  · 一个带空格与中文的文件名，用字面相对路径引用（量百分号编码那条路）
  · 正文长到能铺满一屏（不然透明像素占比没有意义）
"""
import os
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'book-open')
MIMETYPE = 'application/epub+zip'

CONTAINER = '''<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
'''

OPF = '''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:probe-0001</dc:identifier>
    <dc:title>探针样本</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>纸团</dc:creator>
    <meta property="dcterms:modified">2026-09-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/main.css" media-type="text/css"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/appendix.xhtml" media-type="application/xhtml+xml"/>
    <item id="dot" href="images/dot.svg" media-type="image/svg+xml"/>
    <item id="mine" href="images/我 的.svg" media-type="image/svg+xml"/>
  </manifest>
  <spine toc="nav">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3" linear="no"/>
  </spine>
</package>
'''

NAV = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="text/ch1.xhtml">第一章 纸</a>
        <ol><li><a href="text/ch1.xhtml#deep">纸的深处</a></li></ol>
      </li>
      <li><a href="text/ch2.xhtml">第二章 墨</a></li>
    </ol>
  </nav>
</body>
</html>
'''

CSS = '''html { background: #ffffff; }
body { margin-top: 48px; background: #ffffff; font-size: 20px; }
p { color: #112233; }
'''

BODY = '\n'.join(
    f'  <p>第 {i} 段。这一段是用来把屏幕铺满的，好在合成之后量一量桌面透过来多少。</p>'
    for i in range(1, 41)
)

CH1 = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>第一章 纸</title>
  <link rel="stylesheet" type="text/css" href="../styles/main.css"/>
  <script>window.__should_not_run = true</script>
</head>
<body onload="window.__also_should_not_run = true">
  <h1 id="deep">第一章 纸</h1>
{BODY}
  <p><img src="../images/dot.svg" alt="点"/></p>
  <p><img src="../images/我 的.svg" alt="带空格与中文名"/></p>
  <p><a href="ch2.xhtml">去第二章</a></p>
</body>
</html>
'''

# 这一份**故意不是良构的 XHTML**：<p> 不闭合。
# 若它被交给 XML 解析器，整页会变成一个解析错误（Q63 第 4 条）。
CH2 = f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>第二章 墨</title>
  <link rel="stylesheet" type="text/css" href="../styles/main.css"/>
</head>
<body>
  <h1>第二章 墨</h1>
{BODY}
  <p>这一段后面那个段落标签故意没有闭合。
  <p>所以这一章不是良构的 XML，它是那条「按 text/html 送」的逃生口要救的那一种。
</body>
</html>
'''

APPENDIX = '''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>附录</title></head>
<body><h1>附录</h1><p>linear="no" 的那一份，不该出现在章节表里。</p></body>
</html>
'''

DOT = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#3366ff"/></svg>\n'


def main():
    os.makedirs(ROOT, exist_ok=True)
    path = os.path.join(ROOT, 'sample.epub')
    files = [
        ('MIMETYPE_PLACEHOLDER', MIMETYPE),
        ('META-INF/container.xml', CONTAINER),
        ('OEBPS/content.opf', OPF),
        ('OEBPS/nav.xhtml', NAV),
        ('OEBPS/styles/main.css', CSS),
        ('OEBPS/text/ch1.xhtml', CH1),
        ('OEBPS/text/ch2.xhtml', CH2),
        ('OEBPS/text/appendix.xhtml', APPENDIX),
        ('OEBPS/images/dot.svg', DOT),
        ('OEBPS/images/我 的.svg', DOT),
    ]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, (name, text) in enumerate(files):
            real = 'mimetype' if name == 'MIMETYPE_PLACEHOLDER' else name
            info = zipfile.ZipInfo(real)
            info.compress_type = zipfile.ZIP_STORED if i == 0 else zipfile.ZIP_DEFLATED
            info.date_time = (2026, 9, 27, 0, 0, 0)
            z.writestr(info, text)
    print(f'写好：{path}（{os.path.getsize(path)} 字节）')
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            print(f'  {info.compress_type:>2} {info.file_size:>6}  {info.filename}')


if __name__ == '__main__':
    main()
