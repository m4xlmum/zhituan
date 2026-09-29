/**
 * 起始页两套世界共用的数据形状。
 *
 * 两套世界的皮完全不同（现代行式列表 / 命令行），但它们要回答的是同一个问题：
 * 「这个站点叫什么、去哪、图标在哪」。因此站点条目只在这里定义一次。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { SiteSection } from '@shared/constants'

/** 一个可打开的站点条目 */
export interface HomeTile {
  key: string
  name: string
  url: string
  domain: string
  icon?: string
  /**
   * 这个站点归在哪一栏（见 @shared/presets 的 sectionOfUrl）。
   *
   * null 是「认不出来」，不是「没有这一栏」：用户自己加的站点与他不常走的
   * 那些域名都可能落在这里。这样的条目只出现在「全部」里——宁可让它在
   * 「全部」中多占一行，也不要按关键词猜一个可能猜错的栏目。
   */
  section: SiteSection | null
  /**
   * 这一条是不是**我的站点**里的一条记录，是的话是哪一条。
   *
   * 起始页上「编辑」与「删除」两件事的落点不同，全看这一格：
   *
   *   · 有 id —— 它是用户自己加的，就直接改/删那条记录；
   *   · 没有 id —— 它是历史推出来的「常访问」或内置的「热门站点」，
   *     没有记录可改可删。**编辑**它等于把它收成一条自己的站点（带上改过的新值），
   *     旧的域名若因此变了就记进「被移除」名单；**删除**它只能记域名。
   *
   * 同一个域名不会同时出现两条（见 tilesOf 的去重），因此这里不必判「删了谁」。
   */
  siteId: string | null
}
