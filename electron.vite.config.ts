import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/*
 * 版本号只有 package.json 一份。
 *
 * 「关于」那一页要显示它，而打包时用的也是它（electron-builder 直接读 package.json）。
 * 在页面里再抄一遍字面量，改版本号时就必然漏掉一处——显示的版本与装上的版本对不上，
 * 而这一页存在的意义正是回答「我装的是哪一版」。因此在构建时把它塞进渲染进程。
 */
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    // 版本号从 package.json 读进来，见文件开头
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          home: resolve('src/renderer/home.html'),
          popover: resolve('src/renderer/popover.html'),
          settings: resolve('src/renderer/settings.html'),
          // 本机 PDF 的阅读页（pdf.js 画进 canvas的那一张，见 src/main/services/pdfReader.ts）
          pdf: resolve('src/renderer/pdf.html'),
          // 本机 EPUB 的阅读页（章节注入 Shadow DOM，纸归我们画，见 src/main/services/bookReader.ts）
          book: resolve('src/renderer/book.html'),
          // 本机 TXT 的阅读页（自己解编码、自己切章，纸归我们画，见 src/main/services/txtReader.ts）
          txt: resolve('src/renderer/txt.html')
        }
      }
    }
  }
})
