/**
 * 一次性小工具：核一遍打出来的 app.asar 里该在的东西在不在。
 *
 * 打包这一步最容易出的坏法是「源码改了、包里的还是旧的」——那时发出去的安装包装起来
 * 与本地跑的是两个程序。因此每发一版都拿它核一次：新页面的三份产物在不在，
 * 主进程包里那几处新的判据在不在。
 *
 * **关键词要写在它真正住的那个包里**（1.6.11 修的一处假报）。原先这一支把
 * `splitChapters` 挂在主进程包上一起查，而那个函数住在 `src/shared/txt.ts`，
 * 用它的是**阅读页**（`TxtApp.vue` / `main-txt.ts`）——主进程从 1.6.9 起只管
 * 「读文件、发字节」（见 architecture.md 的 `txtReader.ts` 那一行），一个引用都没有，
 * 打包器自然把它摇掉了。于是它每跑一次都如实报「缺 splitChapters」，而缺的那一件
 * 本来就不该在：**一支每次都报同一句假话的尺子，等于没有尺子**——真出问题时那两句
 * 混在一起谁也分不出来（同一条道理见 spike-findings 的 Q88）。现在按包分开：
 * 主进程查主进程真有的那几处，切章那一套去**页面产物**上查。
 *
 * 跑法：node spike/check-asar.cjs release-<版本>/win-unpacked/resources/app.asar
 *       node spike/check-asar.cjs release-<版本>/win-unpacked/resources/app.asar.original
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const asar = require('@electron/asar')

const S = process.argv[2]
const B = String.fromCharCode(92) // 反斜杠：asar 在 Windows 上认它，直接写会被 shell 吃掉

const list = asar.listPackage(S)
console.log(`包里共 ${list.length} 个条目`)

const 要有的条目 = ['out/renderer/txt.html', 'out/renderer/book.html', 'out/renderer/pdf.html']
for (const p of 要有的条目) {
  console.log(`${list.includes(B + p.split('/').join(B)) ? '在  ' : '不在'} ${p}`)
}
const 页面产物 = list.filter((p) => /renderer.assets.txt-/.test(p))
console.log(`${页面产物.length} 份 txt 页面的产物：${页面产物.join('、')}`)

const 检查 = (entry, 关键词) => {
  const s = asar.extractFile(S, entry.split('/').join(B)).toString('utf8')
  const 缺 = 关键词.filter((k) => !s.includes(k))
  console.log(`${entry}（${s.length} 字节）：${缺.length ? '缺 ' + 缺.join('、') : '该在的都在'}`)
}

/** 在一批候选条目里找那个含关键词的（页面产物的文件名带着内容哈希，抄不进脚本里） */
const 检查某一个产物 = (模式, 关键词) => {
  const 条 = list.filter((p) => 模式.test(p))
  if (!条.length) {
    console.log(`找不到匹配 ${模式} 的产物`)
    return
  }
  for (const p of 条) {
    检查(p.split(B).filter(Boolean).join('/'), 关键词)
  }
}

// 主进程：它自己那几处判据（协议名、阅读位置那道闸、记账那一路）
检查('out/main/index.js', ['zhituan-txt', 'isActiveView', 'book:reading', 'reading.json'])
检查('out/preload/index.js', ['book:reading'])
// 切章那一套住在阅读页，不在主进程（见文件头）
检查某一个产物(/renderer.assets.txt-.*\.js$/, ['splitChapters', 'decodeText', 'locateChapter'])
检查某一个产物(/renderer.assets.book-.*\.js$/, ['epub'])
