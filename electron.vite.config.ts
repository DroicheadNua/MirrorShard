import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { UserConfig } from 'vite'

// Renderer用の共通設定
const rendererConfig: UserConfig = {
  // ... (もし共通の設定があればここに)
};

export default defineConfig({
  main: {

  },
  preload: {

  },
  renderer: {
    ...rendererConfig, // 共通設定を展開
    build: {
      rollupOptions: {
        input: {
          // ★★★ ここに複数のエントリーポイントを定義 ★★★
          main_window: resolve(__dirname, 'src/renderer/index.html'),
          preview_window: resolve(__dirname, 'src/renderer/preview.html'),
          shortcut_window: resolve(__dirname, 'src/renderer/shortcut.html'),
        }
      }
    }
  }
})