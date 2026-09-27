/**
 * 本机 EPUB 读到哪儿了。
 *
 * 与书签、历史同一个住处（`userData` 下的一份 JSON），**不做云同步**：这一份记的是
 * 「昨天那本书翻到第三章了」，而它比书签更琐碎、更频繁——一本书一次会话里会报很多次，
 * 因此写入走 `DebouncedWriter`（合并 + 退出前 flush），与配置落盘同一套。
 *
 * ## 为什么记「章 + 章内比例」，而不是一个像素偏移
 *
 * 因为**排版会变**。右下角那组控件（字号 / 行距 / 页边距）一拉，同一章的像素高度就
 * 跟着变；换个窗口尺寸也一样。像素偏移记下来，下次打开会停在半页之外；记比例，
 * 重排之后仍落在同一处。章的标识用**书内相对路径**（OPF 里那个 href）而不是章号：
 * 书更新一版、多出一篇序，章号会整体挪一格，路径不会。
 *
 * ## key 是本机路径
 *
 * 与 `history.json` 同一条规矩——那里面存的也是 `file:///…` 这样的完整地址。这一份
 * 落在用户自己的 `userData` 里，本就不该给外人看；主进程也从不把它交给阅读页
 * （阅读页只知道一个 token，见 services/bookReader.ts 的「路径不出主进程」）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import path from 'node:path'
import { DebouncedWriter, readJson } from './jsonFile'

/** 一本书读到哪儿了 */
export interface ReadingMark {
  /** 章在书里的相对路径（OPF 里那个 href，形如 `OEBPS/text/ch03.xhtml`） */
  chapter: string
  /** 章内进度 0–1。0 是这一章的开头 */
  ratio: number
  /** 最后一次记下的时刻（毫秒） */
  at: number
}

type Shelf = Record<string, ReadingMark>

const FILE = 'reading.json'

/**
 * 落盘去抖。
 *
 * 一次会话里位置会报很多次（翻章、停滚、关页），而这一份的价值只在「下次打开」时
 * 兑现一次——因此这里宁可晚一点写，也不要每翻一页就动一次磁盘。
 */
const WRITE_DEBOUNCE_MS = 1500

/**
 * 一本书记多久。半年没再打开就丢掉：给它一个上限，这一份文件才不会变成
 * 一本永远删不掉的账。
 */
const KEEP_MS = 1000 * 60 * 60 * 24 * 180

/** 同时记住几本书。超了就从最久没读的那本开始丢 */
const MAX_BOOKS = 80

function normalize(raw: unknown): Shelf {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Shelf = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object') continue
    const r = value as Partial<ReadingMark>
    if (typeof r.chapter !== 'string' || !r.chapter) continue
    const ratio = typeof r.ratio === 'number' && Number.isFinite(r.ratio) ? r.ratio : 0
    out[key] = {
      chapter: r.chapter,
      // 夹回 0–1：坏值不该让下次打开落在页面外面
      ratio: Math.min(1, Math.max(0, ratio)),
      at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0
    }
  }
  return out
}

export class ReadingStore {
  private shelf: Shelf
  private readonly dir: string
  private readonly writer: DebouncedWriter<Shelf>

  constructor(userDataDir: string) {
    this.dir = userDataDir
    this.shelf = normalize(readJson(path.join(userDataDir, FILE), {}))
    this.writer = new DebouncedWriter(path.join(userDataDir, FILE), WRITE_DEBOUNCE_MS)
  }

  /** 这本书上次读到哪儿了。没读过就没有 */
  of(bookPath: string): ReadingMark | null {
    return this.shelf[bookPath] ?? null
  }

  /**
   * 记一笔。
   *
   * 丢书与丢时刻都发生在这里而不是读取时：这样文件本身不会随着时间越长越大，
   * 而读取那一步永远是「有就是有」——不必在读的时候再判一次新旧。
   */
  remember(bookPath: string, chapter: string, ratio: number): void {
    if (!bookPath || !chapter) return
    const now = Date.now()
    this.shelf[bookPath] = {
      chapter,
      ratio: Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0)),
      at: now
    }

    // 先按「半年没读」丢，再按条数丢。两步都只动这一份账
    for (const [key, mark] of Object.entries(this.shelf)) {
      if (now - mark.at > KEEP_MS) delete this.shelf[key]
    }
    const keys = Object.keys(this.shelf)
    if (keys.length > MAX_BOOKS) {
      keys
        .sort((a, b) => (this.shelf[a]?.at ?? 0) - (this.shelf[b]?.at ?? 0))
        .slice(0, keys.length - MAX_BOOKS)
        .forEach((key) => delete this.shelf[key])
    }

    this.writer.schedule(this.shelf)
  }

  /** 进程退出前把还没落盘的那一笔写下去 */
  flush(): void {
    this.writer.flush()
  }

  /** 这份账落在哪儿。只有测试与探针会问 */
  get filePath(): string {
    return path.join(this.dir, FILE)
  }
}
