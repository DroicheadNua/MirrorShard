import './assets/export.css';
import type { IElectronAPI, ExportOptions } from '../../@types/electron';

// グローバルなwindowオブジェクトに型を宣言
declare global { interface Window { electronAPI: IElectronAPI; } }

let sourceFilePath: string | null = null;
let sourceFileEncoding: string = 'UTF-8';

// --- DOM取得 ---
const sourceFileDisplay = document.getElementById('source-file-display')!;
const titleInput = document.getElementById('title-input') as HTMLInputElement;
const authorInput = document.getElementById('author-input') as HTMLInputElement;
const coverImagePathInput = document.getElementById('cover-image-path') as HTMLInputElement;
const selectCoverBtn = document.getElementById('select-cover-btn')!;
const formatSelect = document.getElementById('format-select') as HTMLSelectElement;
const verticalCheck = document.getElementById('vertical-check') as HTMLInputElement;
const rubyCheck = document.getElementById('ruby-check') as HTMLInputElement;
const runExportBtn = document.getElementById('run-export-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('close-export-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status-message')!;
const epubOptionsWrapper = document.getElementById('epub-options-wrapper')!;

function updateUIForFormat() {
  const format = formatSelect.value;
  if (format === 'epub') {
    // EPUBが選択されたら、EPUB専用オプションを表示
    epubOptionsWrapper?.classList.remove('hidden');
  } else {
    // それ以外の形式（PDF, HTML）が選択されたら、隠す
    epubOptionsWrapper?.classList.add('hidden');
  }  
  runExportBtn.textContent = `Export as ${format.toUpperCase()}`;
}

// フォーマットが変更されたら、UIを更新
formatSelect.addEventListener('change', updateUIForFormat);

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', async () => {
  // 1. mainから、処理対象のファイルパスを取得
  sourceFilePath = await window.electronAPI.getTargetFilePath();
  if (sourceFilePath) {
    const fileName = sourceFilePath.split(/[\\/]/).pop() || '';
    sourceFileDisplay.textContent = sourceFilePath;
    titleInput.value = fileName.split('.').slice(0, -1).join('.');
    const analysis = await window.electronAPI.analyzeSourceFile(sourceFilePath);
    if (analysis) {
      sourceFileEncoding = analysis.encoding;
    }    
  } else {
    sourceFileDisplay.textContent = 'Error: No source file specified.';
    runExportBtn.disabled = true;
  }
  
  // 2. 初期状態のUIを更新
  updateExportButtonText();
  updateUIForFormat();
});

// --- イベントリスナー ---

// 出力形式が変更されたら、UIを更新
formatSelect.addEventListener('change', updateExportButtonText);

function updateExportButtonText() {
  const format = formatSelect.value;
  runExportBtn.textContent = `Export as ${format.toUpperCase()}`;
  if (format === 'epub') {
    // EPUBが選択されたら、EPUB専用オプションを表示
    epubOptionsWrapper?.classList.remove('hidden');
  } else {
    // それ以外の形式（PDF, HTML）が選択されたら、隠す
    epubOptionsWrapper?.classList.add('hidden');
  }  
}

// 表紙画像選択ボタン
selectCoverBtn.addEventListener('click', async () => {
  const path = await window.electronAPI.selectFileDialog({
    title: '表紙画像を選択',
    filters: [{ name: 'Images', extensions: ['jpg', 'png'] }],
  });
  if (path) coverImagePathInput.value = path;
});

// 閉じるボタン
closeBtn.addEventListener('click', () => window.electronAPI.closeExportWindow());

// 「Export」ボタン
runExportBtn.addEventListener('click', async () => {
  if (!sourceFilePath) return;
  window.electronAPI.setExportBusyState(true);
  statusEl.textContent = 'Exporting... Please wait.';
  runExportBtn.disabled = true;
  closeBtn.disabled = true;

  const options: ExportOptions = {
    sourceFilePath: sourceFilePath,
    encoding: sourceFileEncoding,
    title: titleInput.value,
    author: authorInput.value,
    coverImagePath: coverImagePathInput.value || null,
    isVertical: verticalCheck.checked,
    useRubyFilter: rubyCheck.checked,
    format: formatSelect.value as ExportOptions['format'],
  };

  const result = await window.electronAPI.runExport(options);

  if (result.success) {
    statusEl.textContent = 'Export successful!';
    setTimeout(() => window.electronAPI.closeExportWindow(), 1500); // 成功したら自動で閉じる
  } else if (!result.error?.includes('Cancelled')) {
    statusEl.textContent = 'Export failed.';
    alert(`Export failed:\n${result.error}`);
    closeBtn.disabled = false;
  } else {
    statusEl.textContent = '';
    closeBtn.disabled = false;
  }
  window.electronAPI.setExportBusyState(false);
  runExportBtn.disabled = false;
});