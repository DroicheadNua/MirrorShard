import './assets/preview.css';
import updateArticle from './ruby';
import { startSnowing } from './snow'; 

// --- [エリア1: DOM要素の取得] ---
const contentEl = document.getElementById('content');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const closePreviewBtn = document.getElementById('close-preview-btn');
const snowToggleBtn = document.getElementById('snow-toggle-btn');
const backgroundLayer = document.getElementById('background-layer');

// ★ 雪のアニメーションを管理する変数
let stopSnowing: (() => void) | null = null;
let isSnowing = false; // 初期値はfalse

// ★ 雪のON/OFFを切り替える関数
const toggleSnow = () => {
  isSnowing = !isSnowing; // 状態を反転
  
  if (isSnowing) {
    if (backgroundLayer && !stopSnowing) {
      stopSnowing = startSnowing(backgroundLayer);
    }
  } else {
    if (stopSnowing) {
      stopSnowing();
      stopSnowing = null;
    }
  }
  // 状態をファイルに保存
  window.electronAPI.setSnowState(isSnowing);
};


// --- [エリア2: メインの初期化リスナー] ---
// ウィンドウが開かれたときに、メインプロセスから全ての初期化データを受け取る
window.electronAPI.onInitializePreview(async (data) => {
  if (contentEl) {
    const { fontsInfo } = data;

    // 1. もし、mainからシステムフォントの情報が送られてきたら...
    if (fontsInfo.isSystemFont) {
      const { fontData } = fontsInfo;
      console.log(`[Preview] Initializing with system font: ${fontData.cssFontFamily}`);
      
      // a. その情報を使って、@font-faceを生成し、適用する
      //    (onApplySystemFontFromSettingsリスナーと全く同じロジック)
      try {
        const styleEl = document.createElement('style');
        styleEl.id = 'system-font-styles-preview';
        const fontUrl = `data:font/${fontData.format};base64,${fontData.base64}`;
        styleEl.textContent = `@font-face { font-family: '${fontData.cssFontFamily}'; src: url('${fontUrl}'); }`;
        document.head.appendChild(styleEl);
        await document.fonts.load(`16px "${fontData.cssFontFamily}"`);
        contentEl.style.fontFamily = `'${fontData.cssFontFamily}', serif`;
      } catch (e) { console.error('Failed to init with system font:', e); }

    } else {
      // 2. そうでなければ、これまで通りのサイクルフォントのロジックを実行
      console.log(`[Preview] Initializing with cycle font: ${fontsInfo.currentFontName}`);
      const { availablefonts, currentFontName } = fontsInfo;
      const styleEl = document.createElement('style');
      styleEl.id = 'dynamic-font-styles';

    styleEl.textContent = availablefonts.map((fontFile) => {
      const cssFontFamily = `my-editor-font-${fontFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const fontUrl = `safe-resource://fonts/${fontFile}`;
      return `
        @font-face {
          font-family: '${cssFontFamily}';
          src: url('${fontUrl}');
          font-weight: normal;
          font-style: normal;
        }
      `;
    }).join('\n');
    document.head.appendChild(styleEl);

    // 2. テーマを適用
    document.body.classList.toggle('dark-mode', data.isDarkMode);

    // 3. コンテンツを適用
    const { content, fontsize, lineNumber } = data.initialContent;
    const lines = content.split('\n');
    const htmlWithLineNumbers = lines.map((line, index) => {
      const span = document.createElement('span');
      span.id = `line-${index + 1}`;
      span.textContent = line || ' ';
      return span.outerHTML;
    }).join('<br>');
    contentEl.innerHTML = htmlWithLineNumbers;
    updateArticle(contentEl);

    // 4. 初期フォント、フォントサイズ、行間を適用
    contentEl.style.fontFamily = `'${currentFontName}', serif`;
    contentEl.style.fontSize = `${fontsize}px`;
    const newLineHeight = Math.max(fontsize, Math.round(fontsize * 1.8));
    contentEl.style.lineHeight = `${newLineHeight}px`;

    // 5. 初期スクロール位置を適用
    const targetElement = document.getElementById(`line-${lineNumber}`);
    if (targetElement) {
      setTimeout(() => targetElement.scrollIntoView({ block: 'center' }), 200);
    }

  isSnowing = await window.electronAPI.getSnowState();
  if (isSnowing) {
    if (backgroundLayer && !stopSnowing) {
      stopSnowing = startSnowing(backgroundLayer);
    }
  }
  }
}});

// --- [エリア3: リアルタイム更新のリスナー] ---

// メインウィンドウからのリアルタイムなコンテンツ更新を受け取る
window.electronAPI.onUpdatePreview((data) => {
    if (contentEl) {
        const lines = data.content.split('\n');
        const htmlWithLineNumbers = lines.map((line, index) => {
            const span = document.createElement('span');
            span.id = `line-${index + 1}`;
            span.textContent = line || ' ';
            return span.outerHTML;
        }).join('<br>');
        contentEl.innerHTML = htmlWithLineNumbers;
        updateArticle(contentEl);
        
        const targetElement = document.getElementById(`line-${data.lineNumber}`);
        if (targetElement) {
            targetElement.scrollIntoView({ block: 'nearest' });
        }
    }
});

// ★★★ 設定画面からのシステムフォント適用命令を受け取るリスナー ★★★
window.electronAPI.onApplySystemFontFromSettings(async (fontData) => {
  // fontDataには { cssFontFamily, base64, format } が含まれている
  const { cssFontFamily, base64, format } = fontData;
  console.log(`[Preview] Applying system font from settings: ${cssFontFamily}`);
  
  try {
    // 1. このプレビューウィンドウのdocumentに、@font-faceルールを生成
    //    IDを変えておくことで、メインウィンドウのスタイルと衝突しない
    const styleEl = document.getElementById('system-font-styles-preview') || document.createElement('style');
    styleEl.id = 'system-font-styles-preview';
    
    const mimeType = `font/${format}`;
    const fontUrl = `data:${mimeType};base64,${base64}`;
    const formatHint = format === 'ttf' ? 'truetype' : (format === 'otf' ? 'opentype' : format);

    styleEl.textContent = `
      @font-face {
        font-family: '${cssFontFamily}';
        src: url('${fontUrl}') format('${formatHint}');
      }
    `;
    document.head.appendChild(styleEl);
    
    // 2. フォントのロードが完了するのを待つ
    await document.fonts.load(`16px "${cssFontFamily}"`);
    
    // 3. プレビューの#content要素に、新しいフォントを適用する
    const contentEl = document.getElementById('content');
    if (contentEl) {
      contentEl.style.fontFamily = `'${cssFontFamily}', serif`;
    }
    console.log('[Preview] System font applied successfully.');

  } catch(e) {
    console.error('Failed to apply system font in preview:', e);
  }
});


// ★★★ サイクルフォントの変更を同期するリスナーも、念のため確認 ★★★
// (SnowEditorのコードから、このリスナーがあるはずです)
window.electronAPI.onPreviewFontChange((fontName) => {
  console.log(`[Preview] Applying cycle font: ${fontName}`);
  const contentEl = document.getElementById('content');
  if (contentEl) {
    contentEl.style.fontFamily = `'${fontName}', serif`;
  }
});

// メインウィンドウでのフォントサイズ変更に追従
window.electronAPI.onPreviewfontsizeChange((size) => {
  if (contentEl) {
    const newSize = size || 15;
    contentEl.style.fontSize = `${newSize}px`;
    const newLineHeight = Math.max(newSize, Math.round(newSize * 1.8));
    contentEl.style.lineHeight = `${newLineHeight}px`;
  }
});

// メインウィンドウでのスクロールに追従
window.electronAPI.onSyncScrollPosition((lineNumber) => {
  const targetElement = document.getElementById(`line-${lineNumber}`);
  if (targetElement) {
    targetElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

// メインウィンドウでのテーマ変更に追従
window.electronAPI.onThemeUpdated((isDarkMode) => {
  console.log(`[Preview] Theme updated. Is dark mode: ${isDarkMode}`);
  document.body.classList.toggle('dark-mode', isDarkMode);
});

// メインプロセスからのスクロール命令を受け取る (Home/Endキー用)
window.electronAPI.onScrollTo((direction) => {
  if (contentEl) {
    if (direction === 'top') {
      contentEl.scrollTo({ left: 0, behavior: 'auto' });
    } else {
      contentEl.scrollTo({ left: contentEl.scrollWidth, behavior: 'auto' });
    }
  }
});

// --- UIイベントリスナー ---

// 降雪エフェクト

snowToggleBtn?.addEventListener('click', () => {
  // mainに中継してもらい、自分自身に命令を送り返す
  window.electronAPI.triggerSnowToggle();
});

// onTriggerSnowToggleが呼ばれたかを確認
window.electronAPI.onTriggerSnowToggle(() => {
  console.log('Preview received: trigger-snow-toggle');
  toggleSnow(); // 既存のtoggleSnow関数を呼び出す
});

// フルスクリーンボタン
fullscreenBtn?.addEventListener('click', () => {
  window.electronAPI.toggleFullScreen();
});

// 閉じるボタン
closePreviewBtn?.addEventListener('click', () => {
  window.electronAPI.notifyPreviewClosed();
  window.electronAPI.togglePreviewWindow();
});

// マウスホイールでのスクロール
if (contentEl) {
  contentEl.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    contentEl.scrollLeft -= e.deltaY * 0.2;
  });
}

// キーボードショートカット
window.addEventListener('keydown', (e) => {
  if (!contentEl) return;
  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;

  // 文書頭/末へのジャンプ
  if (isCtrlOrCmd) {
    if (e.key === 'ArrowUp') { e.preventDefault(); contentEl.scrollTo({ left: 0, behavior: 'auto' }); }
    if (e.key === 'ArrowDown') { e.preventDefault(); contentEl.scrollTo({ left: -contentEl.scrollWidth, behavior: 'auto' }); }
  }

  // フォントサイズ変更
  if (isCtrlOrCmd) {
    let action: 'increase' | 'decrease' | 'reset' | 'reset20' | null = null;
    if (e.code === 'Semicolon' || e.code === 'Equal' || e.code === 'NumpadAdd') action = 'increase';
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') action = 'decrease';
    if (e.code === 'Digit0' || e.code === 'Numpad0') action = 'reset';
    if (e.code === 'Digit9' || e.code === 'Numpad9') action = 'reset20';
    
    if (action) {
      e.preventDefault();
      // ★ mainに「全ウィンドウのフォントサイズを変えて」とお願いする
      window.electronAPI.requestGlobalFontSizeChange(action);
    }
  }

  // フォントサイクル
  if (isCtrlOrCmd && e.shiftKey && e.code === 'KeyF') {
    e.preventDefault();
    window.electronAPI.requestGlobalFontCycle();
  }

    // プレビューのトグル
  if (e.key === 'F3' || (isCtrlOrCmd && !isShift && e.key === 'p')) {
    e.preventDefault();
    window.electronAPI.notifyPreviewClosed();
    window.electronAPI.togglePreviewWindow();
  }

  // ダークモード
  if (isCtrlOrCmd && e.code === 'KeyT') {
    e.preventDefault();
    window.electronAPI.toggleDarkMode(); // これは既存のAPIをそのまま使える
  }

  // BGM切替 (Ctrl + Shift + M)
  if (isCtrlOrCmd && isShift && e.code === 'KeyM') {
    e.preventDefault();
    console.log('[Preview] BGM Cycle requested.');
    // Mainに、全ウィンドウへのブロードキャストを要求
    window.electronAPI.requestGlobalBgmCycle();
  }

  // BGM再生/停止 (Ctrl + Shift + P)
  if (isCtrlOrCmd && isShift && e.code === 'KeyP') {
    e.preventDefault();
    console.log('[Preview] BGM Play/Pause requested.');
    window.electronAPI.requestGlobalBgmPlayPause();
  }
});

