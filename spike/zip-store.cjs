/**
 * 一个最小 ZIP 写手，只写「存」不写「压」——给探针现造一本 EPUB 用。
 *
 * 为什么不借 `zipfile` 那样的库、也不去读用户机器上任何真实文件：EPUB 就是一个
 * ZIP，而本项目的解包（`services/bookReader.ts`）两条路都认，因此这里最省事的写法
 * 恰好也是最规范的写法——EPUB 规范本来就要求 `mimetype` 那一条以 STORED 放在最前。
 *
 * 自己不压，就得自己算 CRC32：中央目录里那一格是校验和，**写错的话解包照样成功**，
 * 只有校验工具会报。因此这里宁可写全，也不留一个「看起来能用」的半成品。
 *
 * 探针用法：
 *   const { zipStore } = require('./zip-store.cjs')
 *   fs.writeFileSync(书, zipStore([
 *     { name: 'mimetype', data: 'application/epub+zip' },   // 必须第一个
 *     { name: 'META-INF/container.xml', data: ... },
 *     ...
 *   ]))
 *
 * 第一版这份东西长在 `spike/live-app.js` 里（A13），第二支探针（`book-tab.js`）
 * 要同一本书，于是抽到这里——两份实现迟早会各自漂移，而漂移的那一份会在某天
 * 变成一条假的「产品坏了」。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** files：`[{ name, data }]`，顺序就是这个顺序（mimetype 必须排第一） */
function zipStore(files) {
  const locals = []
  const central = []
  let offset = 0

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.from(f.data, 'utf8')
    const crc = crc32(data)

    // 本地头 30 字节 + 名 + 内容
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4) // 需要 2.0 才能解
    head.writeUInt16LE(0x0800, 6) // 位 11：名是 UTF-8（EPUB 规定）
    head.writeUInt16LE(0, 8) // 0 = 只存
    head.writeUInt16LE(0, 10) // 时刻
    head.writeUInt16LE(0x21, 12) // 日期：1980-01-01
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18) // 压后
    head.writeUInt32LE(data.length, 22) // 原始
    head.writeUInt16LE(name.length, 26)
    head.writeUInt16LE(0, 28) // 本地扩展字段：不写
    locals.push(head, name, data)

    // 中央目录条目 46 字节 + 名
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30) // 扩展
    cd.writeUInt16LE(0, 32) // 注释
    cd.writeUInt16LE(0, 34) // 起始盘
    cd.writeUInt16LE(0, 36) // 内部属性
    cd.writeUInt32LE(0, 38) // 外部属性
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)

    offset += 30 + name.length + data.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // 本盘号
  eocd.writeUInt16LE(0, 6) // 中央目录起始盘
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // 中央目录的偏移
  eocd.writeUInt16LE(0, 20) // 注释长度

  return Buffer.concat([...locals, cdBuf, eocd])
}

/**
 * 一本两章的书（A13 与 book-tab.js 共用同一本）。
 *
 * 刻意带上两样东西：`body { margin-top: 48px }` 与 `background-color: #fff`
 * ——前者是「书的选择器命中了 Shadow DOM 里的正文」的证据，后者是「那张纸被我们
 * 收掉了」的证据。少了任何一样，一个坏掉的实现也可能读出一串好看的数。
 */
function probeBook() {
  /**
   * 第二章刻意写长。
   *
   * 续读那一问要「滚到章内某一处，再关掉重开」，而一页就放得下的章节根本滚不动
   * （`scrollHeight === clientHeight`），量出来的比例永远是 0——那样这一问会
   * 一路绿灯却什么也没量到。选第二章而不是第一章：第一章的滚动行为正被
   * T3（滚轮到章末才翻章）当着现场用，不去动它。
   */
  const 长段 = Array.from(
    { length: 40 },
    (_, i) => `<p>第 ${i + 1} 段：把这一章撑长，续读才量得出「章内某一个位置」。</p>`
  ).join('\n')

  const 章节 = (n, 说) =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${n}章</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>第${n}章 · 探针写的</h1><p>${说}</p>${n === 2 ? 长段 : ''}</body></html>`

  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">probe-book</dc:identifier>
    <dc:title>探针写的书</dc:title>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">第一章</a></li>
  <li><a href="ch2.xhtml">第二章</a></li>
</ol></nav></body></html>`
    },
    /*
     * 书自己写死的排版，一行三用：
     *   · `margin-top: 48px` 是「书的选择器命中 Shadow DOM 里那个 body」的证据；
     *   · `background-color` 是「那张纸被我们收掉了」的证据；
     *   · `font-size` / `line-height` 是「用户的排版三项压得过书」的证据——
     *     压不住的话，探针读回来的就是 20px / 1.2。
     */
    {
      name: 'OEBPS/style.css',
      data: 'body { margin-top: 48px; background-color: rgb(255, 255, 255); font-size: 20px; line-height: 1.2; }'
    },
    { name: 'OEBPS/ch1.xhtml', data: 章节(1, '这一段是探针写的第一章，用来量真身上认不认这本书。') },
    { name: 'OEBPS/ch2.xhtml', data: 章节(2, '这一段是第二章，用来量翻章与目录点得动不动。') }
  ])
}

module.exports = { crc32, zipStore, probeBook }
