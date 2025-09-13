// preloadからAPIを呼び出すための準備
const { electronAPI } = window;

// DOM要素の取得
const scanBtn = document.getElementById('scan-fonts-btn') as HTMLButtonElement;
const fontSelector = document.getElementById('system-font-selector') as HTMLSelectElement;
const applyBtn = document.getElementById('apply-font-btn') as HTMLButtonElement;
const statusEl = document.getElementById('font-scan-status') as HTMLParagraphElement;
const closeBtn = document.getElementById('close-settings-btn') as HTMLButtonElement;
const currentFontDisplay = document.getElementById('current-font-display')!;
const pandocPathInput = document.getElementById('pandoc-path-input') as HTMLInputElement;
const selectPandocBtn = document.getElementById('select-pandoc-btn') as HTMLButtonElement;
const pandocLink = document.getElementById('pandoc-link') as HTMLAnchorElement;
const kindlegenPathInput = document.getElementById('kindlegen-path-input') as HTMLInputElement;
const selectKindlegenBtn = document.getElementById('select-kindlegen-btn') as HTMLButtonElement;
const kindlegenLink = document.getElementById('kindlegen-link') as HTMLAnchorElement;

/** フォントリストを読み込み、UIを構築する */
const loadFontList = async (force: boolean) => {
  statusEl.textContent = force ? 'Rescanning...' : 'Loading...';
  scanBtn.disabled = true;
  fontSelector.innerHTML = '<option>Loading...</option>';
  applyBtn.disabled = true;
  
  try {
    const fonts = await window.electronAPI.scanSystemFonts(force);
    fontSelector.innerHTML = '';
    
    if (fonts.length > 0) {
      fonts.forEach(font => {
        const option = new Option(font.family, font.path);
        fontSelector.add(option);
      });
      fontSelector.disabled = false;
      applyBtn.disabled = false;
      statusEl.textContent = `${fonts.length} fonts found.`;
    } else {
      statusEl.textContent = 'No fonts found.';
    }
  } catch (e) {
    statusEl.textContent = 'An error occurred during the scan.';
    console.error(e); 
}
  finally { scanBtn.disabled = false; }
};

/**
 * 現在適用されているフォント名を表示する関数
 */
async function updateCurrentFontDisplay() {
  // 1. mainに、ストアに保存されているシステムフォントのパスを問い合わせる
  const appliedPath = await window.electronAPI.getAppliedSystemFontPath();

  if (appliedPath) {
    // パスからファイル名を抽出し、表示する
    const familyName = appliedPath.split(/[\\/]/).pop()?.split('.').slice(0, -1).join('.') || 'Unknown';
    currentFontDisplay.textContent = `Current Font: ${familyName}`;
  } else {
    currentFontDisplay.textContent = 'Current Font: Default Cycle Font';
  }
}

// ★★★ DOMContentLoadedを、ここでも使う ★★★
window.addEventListener('DOMContentLoaded', async () => {
  // DOMの準備が完了した、この瞬間なら、electronAPIは絶対に存在するはず
  const { electronAPI } = window;
  loadFontList(false); // ★ false = キャッシュを優先
  updateCurrentFontDisplay();

  const savedPandocPath = await window.electronAPI.getPandocPath();
  if (savedPandocPath) pandocPathInput.value = savedPandocPath;

// 「Select...」ボタン
selectPandocBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFileDialog({ title: 'Pandoc実行ファイルを選択' });
  if (path) {
    pandocPathInput.value = path;
    // ★ 変更されたパスを、即座にストアに保存
    window.electronAPI.setPandocPath(path);
  }
});

// 入力欄が手で変更されたときも、ストアに保存
pandocPathInput.addEventListener('change', () => {
  window.electronAPI.setPandocPath(pandocPathInput.value);
});


// 外部リンク
pandocLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.electronAPI.openExternalLink('https://pandoc.org/installing.html');
});
// 起動時に保存されたパスを読み込む処理も追加
  window.electronAPI.getPandocPath().then(path => {
    if (path) pandocPathInput.value = path;
  });
  // スキャンボタンは、常に「強制再スキャン」を実行する
  scanBtn.addEventListener('click', () => loadFontList(true));

// 「Apply Font」ボタンの処理
applyBtn.addEventListener('click', async () => {
  const selectedPath = fontSelector.value;
  const selectedFamily = fontSelector.options[fontSelector.selectedIndex].text;
  if (!selectedPath) return;

  applyBtn.disabled = true;
  applyBtn.textContent = 'Applying...';
  
  try {
    // 1. mainに、フォントデータのBase64化を依頼
    const base64 = await electronAPI.getFontBase64(selectedPath);
    if (!base64) throw new Error('Failed to get Base64 data.');

    // 2. CSSで安全なファミリー名を生成
    const cssFontFamily = `system-font-${selectedFamily.replace(/[\s]/g, '_')}`;
    const format = selectedPath.split('.').pop()?.toLowerCase() || 'truetype';
    
    // 3. ★★★ mainに、メインウィンドウへのフォント適用を"命令"する ★★★
    electronAPI.applyFontToMainWindow({ path: selectedPath, cssFontFamily, base64, format });
      // ★★★ ストアに、適用したフォントのパスを保存するよう、mainにお願いする ★★★
      electronAPI.setAppliedSystemFontPath(selectedPath);
      
      // ★ 同時に、サイクルフォントのインデックスをリセットするようお願いする
      electronAPI.clearFontIndex();
    statusEl.textContent = `Font "${selectedFamily}" applied!`;
    updateCurrentFontDisplay();
  } catch (e) {
    statusEl.textContent = 'Failed to apply font.';
    console.error(e);
  } finally {
    setTimeout(() => {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Font';
    }, 1000);
  }
});

closeBtn.addEventListener('click', () => {
  window.electronAPI.closeSettingsWindow();
});

});