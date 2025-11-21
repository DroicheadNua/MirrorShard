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
const selectBgBtn = document.getElementById('select-bg-btn')!;
const bgPathInput = document.getElementById('bg-path-input') as HTMLInputElement;
const clearBgBtn = document.getElementById('clear-bg-btn')!;
const selectBgmBtn = document.getElementById('select-bgm-btn')!;
const bgmPathInput = document.getElementById('bgm-path-input') as HTMLInputElement;
const clearBgmBtn = document.getElementById('clear-bgm-btn')!;
const geminiRadio = document.querySelector('input[name="api-provider"][value="gemini"]') as HTMLInputElement;
const lmStudioRadio = document.querySelector('input[name="api-provider"][value="lm-studio"]') as HTMLInputElement;
const geminiSettingsContainer = document.getElementById('gemini-settings-container');
const cotCharLimitInput = document.getElementById('cot-char-limit-input') as HTMLInputElement;
const aiMaxLengthInput = document.getElementById('ai-max-length-input') as HTMLInputElement;
const aiModelSelect = document.getElementById('ai-model-select') as HTMLSelectElement;
const customInput = document.getElementById('ai-model-custom') as HTMLInputElement;

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

const paths = await window.electronAPI.getCustomPaths();
if (paths.background) bgPathInput.value = paths.background;
if (paths.bgm) bgmPathInput.value = paths.bgm;

// 「Select...」ボタン (背景用)
selectBgBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFileDialog({
    title: '背景画像を選択',
    filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'webp'] }],
  });
  if (path) {
    bgPathInput.value = path;
    window.electronAPI.setCustomPath({ type: 'background', path });
    // ★ main経由で、rendererに「背景変えて」とお願い
    window.interop.sendToMain('apply-custom-background', path);
  }
});

// 「Clear」ボタン (背景用)
clearBgBtn.addEventListener('click', () => {
  bgPathInput.value = '';
  // ★ ストアのパスをクリア
  window.electronAPI.setCustomPath({ type: 'background', path: null });
  bgPathInput.value = '';
  document.body.style.removeProperty('background-image'); 
  window.interop.sendToMain('revert-to-cycle-bg');
});

// 「Select...」ボタン (BGM用)
selectBgmBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFileDialog({
    title: 'BGMを選択',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'ogg', 'wav', 'm4a'] },
      { name: 'All Files', extensions: ['*'] }
    ],
  });
  if (path) {
    bgmPathInput.value = path;
    // ★ mainに、設定の保存と、全ウィンドウへの適用を"お願い"する
    window.electronAPI.setCustomPath({ type: 'bgm', path });
    window.interop.sendToMain('apply-custom-bgm', path);
  }
});

// 「Clear」ボタン (BGM用)
clearBgmBtn.addEventListener('click', () => {
  bgmPathInput.value = '';
  window.electronAPI.setCustomPath({ type: 'bgm', path: null });
  bgmPathInput.value = '';
  window.interop.sendToMain('revert-to-cycle-bgm');
});

closeBtn.addEventListener('click', () => {
  window.electronAPI.closeSettingsWindow();
});

const geminiApiKeyInput = document.getElementById('gemini-api-key-input') as HTMLInputElement;

// 起動時に、保存された値を読み込んで表示
window.electronAPI.getStoreValue('geminiApiKey', '').then(apiKey => {
  if (geminiApiKeyInput) geminiApiKeyInput.value = apiKey;
});

// 値が変更されたら、即座に保存
geminiApiKeyInput?.addEventListener('change', () => {
  window.electronAPI.setStoreValue('geminiApiKey', geminiApiKeyInput.value);
});

// --- 1. 状態を復元する ---
window.electronAPI.getStoreValue('selectedApi', 'gemini').then(api => {
  if(!geminiSettingsContainer)return;
  if (api === 'lm-studio') {
    lmStudioRadio.checked = true;
    geminiSettingsContainer.style.display = 'none';
  } else {
    geminiRadio.checked = true;
    geminiSettingsContainer.style.display = 'block';
  }
});

// --- 2. 変更を監視し、保存する ---
[geminiRadio, lmStudioRadio].forEach(radio => {
  if(!geminiSettingsContainer)return;
  radio.addEventListener('change', () => {
    const selectedApi = radio.value;
    window.electronAPI.setStoreValue('selectedApi', selectedApi);
    // Geminiが選ばれた時だけ、APIキー入力欄を表示
    geminiSettingsContainer.style.display = selectedApi === 'gemini' ? 'block' : 'none';
  });
});

// --- 1. 起動時に、保存された値を読み込む ---
window.electronAPI.getStoreValue('cotCharLimit', 30).then(limit => {
  if (cotCharLimitInput) cotCharLimitInput.valueAsNumber = limit;
});
window.electronAPI.getStoreValue('aiResponseMaxLength', 2000).then(limit => {
  if (aiMaxLengthInput) aiMaxLengthInput.valueAsNumber = limit;
});

// --- 2. 値が変更されたら、即座に保存する ---
cotCharLimitInput?.addEventListener('change', () => {
  const limit = Math.max(10, Math.min(100, parseInt(cotCharLimitInput.value, 10)));
  cotCharLimitInput.value = String(limit); // 補正した値をUIに反映
  window.electronAPI.setStoreValue('cotCharLimit', limit);
});
aiMaxLengthInput?.addEventListener('change', () => {
  const limit = Math.max(100, Math.min(40000, parseInt(aiMaxLengthInput.value, 10)));
  aiMaxLengthInput.value = String(limit); // 補正した値をUIに反映
  window.electronAPI.setStoreValue('aiResponseMaxLength', limit);
});

// --- Gemini Model ---
// 表示切替ロジック
aiModelSelect.addEventListener('change', () => {
  if (aiModelSelect.value === 'custom') {
    customInput.style.display = 'block';
  } else {
    customInput.style.display = 'none';
  }
  saveSettings(); // 即時保存
});

customInput.addEventListener('change', saveSettings);

// 保存ロジック
function saveSettings() {
  const modelToSave = aiModelSelect.value === 'custom' ? customInput.value : aiModelSelect.value;
  window.electronAPI.setStoreValue('aiModel', modelToSave);
}

// 読み込みロジック
window.electronAPI.getStoreValue('aiModel', 'gemini-2.5-pro').then(model => {
  // 既知のリストにあるかチェック
  const options = Array.from(aiModelSelect.options).map(o => o.value);
  if (options.includes(model)) {
    aiModelSelect.value = model;
    customInput.style.display = 'none';
  } else {
    // リストになければカスタム扱い
    aiModelSelect.value = 'custom';
    customInput.value = model;
    customInput.style.display = 'block';
  }
});

// --- User Name ---
const userNameInput = document.getElementById('ai-user-name-input') as HTMLInputElement;
window.electronAPI.getStoreValue('aiChatUserName', 'User').then(name => userNameInput.value = name);
userNameInput.addEventListener('change', () => {
  window.electronAPI.setStoreValue('aiChatUserName', userNameInput.value);
  window.electronAPI.updateAiChatSettings();
});

// --- User Icon ---
const userIconPathInput = document.getElementById('ai-user-icon-path-input') as HTMLInputElement;
const userIconSelectBtn = document.getElementById('ai-user-icon-select');

// a) 起動時に、保存されたパスを入力欄に表示
window.electronAPI.getStoreValue('aiChatUserIconPath', '').then(path => {
  if (userIconPathInput) userIconPathInput.value = path;
});

// b) 入力欄が手動で変更されたら、ストアに保存
userIconPathInput?.addEventListener('change', async () => {
  const newPath = userIconPathInput.value;
  // ★ 画像をData URLに変換する新しいAPIをmainに依頼
  const dataUrl = newPath ? await window.electronAPI.convertPathToDataUrl(newPath) : '';
  window.electronAPI.setStoreValue('aiChatUserIconPath', newPath);
  window.electronAPI.setStoreValue('aiChatUserIconDataUrl', dataUrl);
  window.electronAPI.updateAiChatSettings();
});

// c) 「選択」ボタンは、入力欄を更新するヘルパー
userIconSelectBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.selectImageFile();
  if (result) {
    userIconPathInput.value = result.path;
    // ★ 手動変更と同じように、changeイベントを発火させて、保存処理を共通化
    userIconPathInput.dispatchEvent(new Event('change'));
  }
});

// --- Assistant Name ---
const assistantNameInput = document.getElementById('ai-assistant-name-input') as HTMLInputElement;
window.electronAPI.getStoreValue('aiChatAssistantName', 'Assistant').then(name => assistantNameInput.value = name);
assistantNameInput.addEventListener('change', async () => {
  window.electronAPI.setStoreValue('aiChatAssistantName', assistantNameInput.value);
  window.electronAPI.updateAiChatSettings();
});

// --- Assistant Icon ---
const assistantIconPathInput = document.getElementById('ai-assistant-icon-path-input') as HTMLInputElement;
const assistantIconSelectBtn = document.getElementById('ai-assistant-icon-select');

window.electronAPI.getStoreValue('aiChatAssistantIconPath', '').then(path => {
  if (assistantIconPathInput) assistantIconPathInput.value = path;
});

assistantIconPathInput?.addEventListener('change', async () => {
  const newPath = assistantIconPathInput.value;
  const dataUrl = newPath ? await window.electronAPI.convertPathToDataUrl(newPath) : '';
  window.electronAPI.setStoreValue('aiChatAssistantIconPath', newPath);
  window.electronAPI.setStoreValue('aiChatAssistantIconDataUrl', dataUrl);
  window.electronAPI.updateAiChatSettings();
});

assistantIconSelectBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.selectImageFile();
  if (result) {
    assistantIconPathInput.value = result.path;
    assistantIconPathInput.dispatchEvent(new Event('change'));
  }
});

});