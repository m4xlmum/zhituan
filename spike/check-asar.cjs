/**
 * 一次性小工具：核一遍打出来的 app.asar 里该在的东西在不在。
 *
 * 打包这一步最容易出的坏法是「源码改了、包里的还是旧的」——那时发出去的安装包装起来
 * 与本地跑的是两个程序。因此每发一版都拿它核一次：新页面的三份产物在不在，
 * 主进程包里那几处新的判据在不在。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
const asar = require('@electron/asar')

const S = process.argv[2]
const B = String.fromCharCode(92) // 反斜杠：asar 在 Windows 上认它，直接写会被 shell 吃掉

const list = asar.listPackage(S)
console.log(`包里共 ${list.length} 个条目`)

const 要有的条目 = ['out/renderer/txt.html']
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

检查('out/main/index.js', ['zhituan-txt', 'isActiveView', 'splitChapters', 'book:reading'])
检查('out/preload/index.js', ['book:reading'])
