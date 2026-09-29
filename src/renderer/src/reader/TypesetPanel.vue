<script setup lang="ts">
/**
 * 离线阅读的排版三项（字号 / 行距 / 左右留白）——两个自家阅读页共用的那块面板。
 *
 * ## 为什么另起一个组件
 *
 * 本机 EPUB 与本机 TXT 各有自己的一页，而这两页右下角那枚 Aa 打开的是**同一块面板**：
 * 同样三条横向滑块、同样写 `ui.readerFontSize / readerLineHeight / readerMargin`
 * 这三个字段（见 @shared/constants 那六个上下限）。原先它长在 BookApp 里，TXT 那一页
 * 一来就得抄第二份——两份滑块的上下限、步长、读数格式只要有一处不同，
 * 两页就再也说不出「改的是同一件事」。
 *
 * ## 自己读配置，不接 props
 *
 * config 那一份镜像由 `useConfig` 给（`window.zhituan.config` + 配置广播），本组件
 * 自己取一份。父页面因此不必把三个数传进来、也不必替它把改动转出去：面板写的是配置，
 * 而**两个页面的正文都在听那条广播**（见 BookApp 与 TxtApp 的 applyTypeset），
 * 于是「拖一下、字当场变」不需要父页面牵线。
 *
 * 代价是同一页里有两次 `config.get`——一次在父页面、一次在这里。两毫秒的事，
 * 换的是这一块面板可以原样放进任何一页。
 *
 * ## 三类东西刻意不在这里
 *
 *   · **纸的透明度**（`ui.readerOpacity`）：它是右栏第三条滑块，不在面板里；
 *   · **PDF 那一页**：它的字是画进 canvas 的，没有字号可调——要放大得改缩放；
 *   · **Chromium 自己渲染的本机文本**（`.md`、`.log` 这一类）：页面上没有地方挂
 *     这块面板，那一类由顶栏那枚 Aa 开同一组控件（见 chrome/TopBar.vue 与
 *     popover/PopoverApp.vue）——那一份是**另一块面板**，因为它住在一扇独立的小窗里，
 *     锚点、宽度、材料都不同。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import {
  DEFAULT_READER_FONT,
  DEFAULT_READER_LINE,
  DEFAULT_READER_MARGIN,
  READER_FONT_MAX,
  READER_FONT_MIN,
  READER_LINE_MAX,
  READER_LINE_MIN,
  READER_MARGIN_MAX,
  READER_MARGIN_MIN
} from '@shared/constants'
import { useConfig } from '../composables/useConfig'

const { config, patch } = useConfig()

/** 面板上拖一下。写的是配置，回来的广播会让正文重排 */
function setTypeset(key: 'font' | 'line' | 'margin', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  void patch({
    ui:
      key === 'font'
        ? { readerFontSize: value }
        : key === 'line'
          ? { readerLineHeight: value }
          : { readerMargin: value }
  })
}
</script>

<template>
  <aside class="typeset">
    <label class="typeset__row">
      <span class="typeset__label">字号</span>
      <input
        class="typeset__range"
        type="range"
        :min="READER_FONT_MIN"
        :max="READER_FONT_MAX"
        step="1"
        :value="config?.ui.readerFontSize ?? DEFAULT_READER_FONT"
        @input="setTypeset('font', $event)"
      />
      <span class="typeset__value">{{ config?.ui.readerFontSize ?? DEFAULT_READER_FONT }}px</span>
    </label>
    <label class="typeset__row">
      <span class="typeset__label">行距</span>
      <input
        class="typeset__range"
        type="range"
        :min="READER_LINE_MIN"
        :max="READER_LINE_MAX"
        step="0.05"
        :value="config?.ui.readerLineHeight ?? DEFAULT_READER_LINE"
        @input="setTypeset('line', $event)"
      />
      <span class="typeset__value">{{
        (config?.ui.readerLineHeight ?? DEFAULT_READER_LINE).toFixed(2)
      }}</span>
    </label>
    <label class="typeset__row">
      <span class="typeset__label">留白</span>
      <input
        class="typeset__range"
        type="range"
        :min="READER_MARGIN_MIN"
        :max="READER_MARGIN_MAX"
        step="1"
        :value="config?.ui.readerMargin ?? DEFAULT_READER_MARGIN"
        @input="setTypeset('margin', $event)"
      />
      <span class="typeset__value">{{ config?.ui.readerMargin ?? DEFAULT_READER_MARGIN }}%</span>
    </label>
  </aside>
</template>
