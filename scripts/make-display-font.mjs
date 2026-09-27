/**
 * 做出起始页的展示字（display face）。
 *
 * 为什么要有这一步：起始页的报头（标识与栏目线）原先吃的是 --font，也就是
 * 微软雅黑——**平台自己的界面字**。用系统字当一页「自有世界」的门面，
 * 等于这一页没有门面：它在谁的机器上就长成谁的界面。展示字因此必须是自己带着的。
 *
 * 字从哪来：Noto Serif SC（思源宋体的 Google 版本，OFL 1.1，可自由再分发）。
 * 报纸的报头、中文书刊的标题历来是宋体那一档，这一页的论点是「一张报纸的
 * 栏目页」，因此展示字是一套宋体，而不是再找一个无衬线。
 *
 * 为什么是子集而不是整份：上游那份 25MB（31058 个字形，覆盖全部中日韩）。
 * 这一页的展示字只用在两处——报头与栏目线——它们说的字是数得出来的。
 * 子集因此按**这两个面上的原文**生成，而不是按「常用字表」猜：
 * 栏目名取自 @shared/constants 的 SECTIONS（真的那份，不是抄一遍），
 * 报头那两个字取 EXTRA。**没有**覆盖到的字不会变成豆腐块，只是回落到
 * 衬线栈里的下一个字——因此漏字看得见，但不难看。
 *
 * 用子集的代价是这一条纪律：**展示面上加字，要回来把那个字加进 EXTRA 再跑一遍**
 * （脚本会核对该字确实出现在 StartPage.vue 里，改错了当场报错，不静默漏字）。
 *
 * 用法（改动展示面之后重跑，产物要一起提交）：
 *   node scripts/make-display-font.mjs
 * 依赖：一个装了 fontTools 与 brotli 的 python（`pip install fonttools brotli`）。
 * PATH 上那个不一定装着（本机就不是），因此可以指名道姓：
 *   PYTHON=/path/to/venv/bin/python node scripts/make-display-font.mjs
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const ROOT = resolve(import.meta.dirname, '..')
const OUT_FONT = join(ROOT, 'src/renderer/src/assets/fonts/zhituan-display-serif.woff2')
const OUT_LICENSE = join(ROOT, 'src/renderer/src/assets/fonts/OFL.txt')

/** 上游：google/fonts 仓库里的可变字体（wght 200–900，默认 200）。改版本要连 OFL 一起核对 */
const UPSTREAM_URL =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf'
const UPSTREAM_LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt'
const CACHE = join(homedir(), '.cache', 'zhituan-font')
const CACHED_FONT = join(CACHE, 'NotoSerifSC[wght].ttf')

/**
 * 跑 fontTools 的解释器。
 *
 * 不写死 `python`：PATH 上那个未必装着 fontTools（本机就是这样——系统 Python
 * 没有，装了的那份在别的 venv 里），而报错会晚到 `fontTools.varLib` 那一行，
 * 读起来像脚本坏了。装好依赖之后用 `PYTHON=/path/to/python node scripts/…` 指定。
 */
const PYTHON = process.env.PYTHON ?? 'python'

/** 只保留这一段字重：报头用 700，栏目线用 400，两头都不需要 */
const WEIGHT_RANGE = '400:700'

/** 自己带的那份字叫什么。改名字见下面 NAMES 那一段脚本里的说明 */
const FAMILY = 'Zhituan Display Serif'

/**
 * 改名字表。
 *
 * 上游那份是可变字体，默认实例是 ExtraLight（wght 200）。收窄到 400–700 之后
 * 字名还写着 ExtraLight——一个默认 400 的字自称 ExtraLight，是这条流水线上
 * 唯一一处会骗人的元数据，因此在这里一并改掉。
 *
 * 名字表里**只动**家族与子族那几条：版权（0）、许可（13）、许可网址（14）
 * 一个都不动——OFL 要求许可随字走，而这个文件会被分发到别人的机器上。
 * 名字换成角色名（而不是留着上游的），是因为这份字是子集：它不是 Noto Serif SC，
 * 它是「起始页展示面用的那 133 个字」，换成角色名谁都不会看错。
 */
const RENAME_PY = `
import sys
from fontTools.ttLib import TTFont

src, dst, family = sys.argv[1], sys.argv[2], sys.argv[3]
font = TTFont(src)
name = font['name']
records = {
  1: family,
  2: 'Regular',
  3: family + ' Subset; upstream Noto Serif SC (OFL 1.1)',
  4: family,
  6: family.replace(' ', ''),
  16: family,
  17: 'Regular',
}
for name_id, value in records.items():
    name.removeNames(nameID=name_id)
    name.setName(value, name_id, 3, 1, 0x409)
font['OS/2'].usWeightClass = 400
font.save(dst)
`

/**
 * 展示面上除栏目名之外还说的字。
 *
 * 标识：`纸团`（StartPage.vue 的 .wordmark，现代世界那一支）。
 * 终端世界的标识是 `ZHITUAN`，那几个字母由下面的 ASCII 那一段覆盖。
 */
const EXTRA = '纸团'

/** 拉丁与标点：展示面上未必说，但缺一个就回落，不如一次带齐 */
const LATIN =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '·—–…“”‘’《》〈〉（）「」『』、。！？：；·'

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = [error.stderr, error.stdout].filter(Boolean).join('\n').trim()
    throw new Error(`${cmd} 失败：\n${detail || error.message}`)
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 真的那份 SECTIONS：把 TS 打成一包再 require，不抄一遍（探针用的也是这一手） */
async function sections() {
  const out = join(tmpdir(), `zhituan-sections-${process.pid}.cjs`)
  await build({
    entryPoints: [join(ROOT, 'src/shared/constants.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    external: ['electron']
  })
  try {
    return require(out).SECTIONS
  } finally {
    rmSync(out, { force: true })
  }
}

async function main() {
  if (!existsSync(CACHED_FONT)) {
    mkdirSync(CACHE, { recursive: true })
    console.log(`上游字体不在缓存里，下载：${UPSTREAM_URL}`)
    sh('curl', ['-sL', '--max-time', '300', '-o', CACHED_FONT, UPSTREAM_URL])
    sh('curl', ['-sL', '--max-time', '60', '-o', join(CACHE, 'OFL.txt'), UPSTREAM_LICENSE_URL])
  }
  if (!existsSync(CACHED_FONT)) throw new Error(`下载没有落到 ${CACHED_FONT}`)

  const list = await sections()
  const plateText = list.map((s) => s.label + s.short).join('')
  const glyphs = [...new Set([...LATIN, ...plateText, ...EXTRA])].join('')

  // 漏字要当场说出来：EXTRA 里那几个字必须真的还在这份展示面上
  const page = readFileSync(join(ROOT, 'src/renderer/src/home/StartPage.vue'), 'utf8')
  const missing = [...EXTRA].filter((ch) => !page.includes(ch))
  if (missing.length) {
    throw new Error(
      `EXTRA 里的 ${missing.join('')} 在 StartPage.vue 里找不到了——` +
        '展示面改了名或删了字，请按新的原文更新 EXTRA 再跑一遍'
    )
  }

  const dir = join(CACHE, 'build')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const textFile = join(dir, 'glyphs.txt')
  const renamePy = join(dir, 'rename.py')
  const limited = join(dir, 'limited.ttf')
  const named = join(dir, 'named.ttf')
  const subset = join(dir, 'subset.woff2')
  writeFileSync(textFile, glyphs, 'utf8')
  writeFileSync(renamePy, RENAME_PY, 'utf8')

  // 先把字重收到 400–700：轴上的变化数据跟字形数一起压缩，范围越窄产物越小
  sh(PYTHON, ['-m', 'fontTools.varLib.instancer', CACHED_FONT, `wght=${WEIGHT_RANGE}`, '-o', limited])
  sh(PYTHON, [renamePy, limited, named, FAMILY])
  // 子集：名字表与 OFL（nameID 13/14）留着——许可随字走，不只是随仓库走。
  // 走 `-m fontTools.subset` 而不是 `pyftsubset`：后者是一个控制台脚本，
  // 只有装着 fontTools 的那个环境里才有，而前者在任何能 import 到它的解释器下都成立。
  sh(PYTHON, [
    '-m',
    'fontTools.subset',
    named,
    `--text-file=${textFile}`,
    '--flavor=woff2',
    '--layout-features=ccmp,locl,kern,liga,calt,mark,mkmk',
    '--no-hinting',
    '--desubroutinize',
    '--name-IDs=*',
    '--name-legacy',
    '--name-languages=*',
    `--output-file=${subset}`
  ])

  mkdirSync(dirname(OUT_FONT), { recursive: true })
  writeFileSync(OUT_FONT, readFileSync(subset))
  const cachedLicense = join(CACHE, 'OFL.txt')
  writeFileSync(OUT_LICENSE, existsSync(cachedLicense) ? readFileSync(cachedLicense) : '')

  const bytes = readFileSync(OUT_FONT).length
  console.log(`展示面用的字：${glyphs.length} 个（其中栏目名 ${plateText.length}）`)
  console.log(`写出 ${OUT_FONT.replace(ROOT, '.')}`)
  console.log(`  ${bytes} 字节（${(bytes / 1024).toFixed(1)}KB）  sha256 ${sha256(OUT_FONT).slice(0, 16)}`)
  console.log(`  OFL 随字附上：${OUT_LICENSE.replace(ROOT, '.')}`)
}

await main()
