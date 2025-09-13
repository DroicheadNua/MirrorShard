import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IElectronAPI } from '../@types/electron.d'
// ページのズーム機能を無効化し、Ctrl +/- をフォントサイズ変更に使えるようにする
webFrame.setVisualZoomLevelLimits(1, 1)





const api: IElectronAPI = {
  // ファイル操作
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (filePath, content, options) => ipcRenderer.invoke('file:saveFile', filePath, content, options),
  
  // ウィンドウ操作 (メインウィンドウ用)
  quitApp: () => ipcRenderer.send('quit-app'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // ウィンドウ操作 (共通)
  toggleFullScreen: () => ipcRenderer.send('window-toggle-fullscreen'),

  // フォントサイズ
  getfontsize: () => ipcRenderer.invoke('get-font-size'),
  setfontsize: (size) => ipcRenderer.send('set-font-size', size),
  onChangefontsize: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('change-font-size', handler);
    return () => ipcRenderer.removeListener('change-font-size', handler);
  },
updatePreviewFont: (fontName) => ipcRenderer.send('update-preview-font', fontName),
  onPreviewFontChange: (callback) => {
    const handler = (_event, fontName: string) => callback(fontName);
    ipcRenderer.on('preview-font-change', handler);
    return () => ipcRenderer.removeListener('preview-font-change', handler);
  },

  updatePreviewfontsize: (size) => ipcRenderer.send('update-preview-font-size', size),
  onPreviewfontsizeChange: (callback) => {
    const handler = (_event, size) => callback(size);
    ipcRenderer.on('preview-font-size-change', handler);
    return () => ipcRenderer.removeListener('preview-font-size-change', handler);
  },



  // プレビューウィンドウ
  togglePreviewWindow: () => ipcRenderer.send('toggle-preview-window'),
  openPreviewWindow: (data) => ipcRenderer.send('open-preview-window', data),
  updatePreview: (data) => ipcRenderer.send('update-preview', data),
  onLoadText: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('load-text', handler);
    return () => ipcRenderer.removeListener('load-text', handler);
  },

  // リアルタイムスクロール同期
  syncScrollPosition: (lineNumber) => ipcRenderer.send('sync-scroll-position', lineNumber),
  onSyncScrollPosition: (callback) => {
    const handler = (_event, lineNumber) => callback(lineNumber);
    ipcRenderer.on('sync-scroll-position-to-preview', handler);
    return () => ipcRenderer.removeListener('sync-scroll-position-to-preview', handler);
  },
  onOpenFile: (callback) => {
    const handler = (_event, filePath: string) => callback(filePath);
    ipcRenderer.on('open-file', handler);
    return () => ipcRenderer.removeListener('open-file', handler);
  },
  onScrollTo: (callback) => {
    const handler = (_event, direction) => callback(direction);
    ipcRenderer.on('scroll-to', handler);
    return () => ipcRenderer.removeListener('scroll-to', handler);
  },
  onThemeUpdated: (callback) => {
    const handler = (_event, isDarkMode) => callback(isDarkMode);
    ipcRenderer.on('theme-updated', handler);
    return () => ipcRenderer.removeListener('theme-updated', handler);
  },  
  themeUpdated: (data) => ipcRenderer.send('theme-updated', data),
  onRequestOpenPreview: (callback) => {
  const handler = () => callback();
  ipcRenderer.on('trigger-open-preview-request', handler);
  return () => ipcRenderer.removeListener('trigger-open-preview-request', handler);
},
sessionSave: (filePaths) => ipcRenderer.send('session-save', filePaths),
onOpenFileInNewTab: (callback) => {
  const handler = (_event, filePath) => callback(filePath);
  ipcRenderer.on('open-file-in-new-tab', handler);
  return () => ipcRenderer.removeListener('open-file-in-new-tab', handler);
},
onTriggerOpenFile: (callback) => {
  const handler = () => callback();
  ipcRenderer.on('trigger-open-file', handler);
  return () => ipcRenderer.removeListener('trigger-open-file', handler);
},
onTriggerSaveFile: (callback) => {
  const handler = () => callback();
  ipcRenderer.on('trigger-save-file', handler);
  return () => ipcRenderer.removeListener('trigger-save-file', handler);
},
  getFontList: (): Promise<string[]> => ipcRenderer.invoke('get-font-list'),
  getFontData: (path: string): Promise<{ data: string; format: string; } | null> => ipcRenderer.invoke('get-font-data', path),

  getFontIndex: () => ipcRenderer.invoke('get-font-index'),
  setFontIndex: (index) => ipcRenderer.send('set-font-index', index),

  onInitializePreview: (callback) => {
    // ★ mainから送られてくるdataを、正しい型として解釈する
    const handler = (_event, data: any) => callback(data as any);
    ipcRenderer.on('initialize-preview', handler);
    return () => ipcRenderer.removeListener('initialize-preview', handler);
  },
  
  onUpdatePreview: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-preview-content', handler);
    return () => ipcRenderer.removeListener('update-preview-content', handler);
  },
  getbgmList: () => ipcRenderer.invoke('get-bgm-list'),
  onTriggerbgmCycle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-bgm-cycle', handler);
    return () => ipcRenderer.removeListener('trigger-bgm-cycle', handler);
  },
  onTriggerbgmPlayPause: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-bgm-play-pause', handler);
    return () => ipcRenderer.removeListener('trigger-bgm-play-pause', handler);
  },
  onTriggerZenMode: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-zen-mode', handler);
    return () => ipcRenderer.removeListener('trigger-zen-mode', handler);
  },  
  onTriggerTypeSoundToggle: (callback) => {
  const handler = () => callback();
  ipcRenderer.on('trigger-typesound-toggle', handler);
  return () => ipcRenderer.removeListener('trigger-typesound-toggle', handler);
},
  notifyPreviewClosed: () => ipcRenderer.send('notify-preview-closed'),
  
  onPreviewHasBeenClosed: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('preview-has-been-closed', handler);
    return () => ipcRenderer.removeListener('preview-has-been-closed', handler);
  },
  getbgList: () => ipcRenderer.invoke('get-bg-list'),
  getbgIndex: () => ipcRenderer.invoke('get-bg-index'),
  setbgIndex: (index) => ipcRenderer.send('set-bg-index', index),
  onTriggerbgCycle: (callback) => {
  const handler = () => callback();
  ipcRenderer.on('trigger-bg-cycle', handler);
  return () => ipcRenderer.removeListener('trigger-bg-cycle', handler);
},
  rendererReady: () => ipcRenderer.send('renderer-ready'),
  togglePreviewSnow: () => ipcRenderer.send('toggle-preview-snow'),
  onTriggerSnowToggle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-snow-toggle', handler);
    return () => ipcRenderer.removeListener('trigger-snow-toggle', handler);
  },
  getSnowState: () => ipcRenderer.invoke('get-snow-state'),
  setSnowState: (isEnabled) => ipcRenderer.send('set-snow-state', isEnabled),
  triggerSnowToggle: () => ipcRenderer.send('trigger-snow-toggle'),
  getbgmIndex: () => ipcRenderer.invoke('get-bgm-index'),
  setbgmIndex: (index) => ipcRenderer.send('set-bgm-index', index),
  getbgmPausedState: () => ipcRenderer.invoke('get-bgm-paused-state'),
  setbgmPausedState: (isPaused) => ipcRenderer.send('set-bgm-paused-state', isPaused),  
  getTypeSoundState: () => ipcRenderer.invoke('get-typesound-state'),
  setTypeSoundState: (isEnabled) => ipcRenderer.send('set-typesound-state', isEnabled),
  onTriggerFocusMode: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-focus-mode', handler);
    return () => ipcRenderer.removeListener('trigger-focus-mode', handler);
  },
  onRequestUnsavedChangesCheck: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('request-unsaved-changes-check', handler);
    return () => ipcRenderer.removeListener('request-unsaved-changes-check', handler);
  },
  responseUnsavedChanges: (hasChanges) => ipcRenderer.send('response-unsaved-changes', hasChanges),

  onRequestSessionSave: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('request-session-save', handler);
    return () => ipcRenderer.removeListener('request-session-save', handler);
  },
  sessionSaved: () => ipcRenderer.send('session-saved'),  
  getDarkModeState: () => ipcRenderer.invoke('get-dark-mode-state'),
  setDarkModeState: (isEnabled) => ipcRenderer.send('set-dark-mode-state', isEnabled),
  getFocusModeState: () => ipcRenderer.invoke('get-focus-mode-state'),
  setFocusModeState: (isEnabled) => ipcRenderer.send('set-focus-mode-state', isEnabled),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  setWindowBounds: (bounds) => ipcRenderer.send('set-window-bounds', bounds),
  onTriggerNewFile: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-new-file', handler);
    return () => ipcRenderer.removeListener('trigger-new-file', handler);
  },
  onTriggerFontCycle: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-font-cycle', handler);
    return () => ipcRenderer.removeListener('trigger-font-cycle', handler);
  },  
  notifyFilesDropped: (filePaths) => ipcRenderer.send('files-dropped', filePaths),
  showContextMenuFromBlueprint: (template) => ipcRenderer.send('show-context-menu-from-blueprint', template),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  addToHistory: (filePath) => ipcRenderer.send('add-to-history', filePath),
    onTriggerSaveAsFile: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('trigger-save-as-file', handler);
    return () => ipcRenderer.removeListener('trigger-save-as-file', handler);
  },
    onTriggerTogglePreview: (callback) => {
    ipcRenderer.on('trigger-toggle-preview', callback);
    return () => ipcRenderer.removeAllListeners('trigger-toggle-preview');
  },
  toggleDarkMode: () => ipcRenderer.send('toggle-dark-mode'),
  getZenModeState: () => ipcRenderer.invoke('get-zen-mode-state'),
  setZenModeState: (isEnabled) => ipcRenderer.send('set-zen-mode-state', isEnabled),
  onToggleOutlineShortcut: (callback) => {
    ipcRenderer.on('toggle-outline-shortcut', callback);
    return () => ipcRenderer.removeAllListeners('toggle-outline-shortcut');
  },
  openResourcesFolder: () => ipcRenderer.send('open-resources-folder'),
  onCycleTab: (callback) => {
    const handler = (_event, direction: 'next' | 'previous') => callback(direction);
    ipcRenderer.on('cycle-tab', handler);
    return () => ipcRenderer.removeListener('cycle-tab', handler);
  },
  getBgmBuffer: (fileName) => ipcRenderer.invoke('get-bgm-buffer', fileName),
  confirmCloseTab: (fileName) => ipcRenderer.invoke('confirm-close-tab', fileName),
  confirmLargeFilePreview: (fileSize) => ipcRenderer.invoke('confirm-large-file-preview', fileSize),
  requestGlobalFontSizeChange: (action) => ipcRenderer.send('request-font-size-change', action),
  requestGlobalFontCycle: () => ipcRenderer.send('request-font-cycle'),  
  requestGlobalBgmCycle: () => ipcRenderer.send('request-bgm-cycle'),
  requestGlobalBgmPlayPause: () => ipcRenderer.send('request-bgm-play-pause'),
  scanSystemFonts: (force) => ipcRenderer.invoke('scan-system-fonts', force),
  getFontBase64: (filePath) => ipcRenderer.invoke('get-font-base64', filePath),
  applyFontToMainWindow: (fontData) => ipcRenderer.send('apply-font-to-main-window', fontData),  
  onApplySystemFontFromSettings: (callback) => {
    const handler = (_event, fontData) => callback(fontData);
    ipcRenderer.on('apply-system-font-from-settings', handler);
    return () => ipcRenderer.removeListener('apply-system-font-from-settings', handler);
  },  
  toggleSettingsWindow: () => ipcRenderer.send('toggle-settings-window'),

  getAppliedSystemFontPath: () => ipcRenderer.invoke('get-applied-system-font-path'),
  setAppliedSystemFontPath: (filePath) => ipcRenderer.invoke('set-applied-system-font-path', filePath),
  clearFontIndex: () => ipcRenderer.send('clear-font-index'),  
  closeSettingsWindow: () => ipcRenderer.send('close-settings-window'),
  selectImageDialog: () => ipcRenderer.invoke('select-image-dialog'),
  runExport: (options) => ipcRenderer.invoke('run-export', options),  
    onRequestExportWindow: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('request-export-window', handler);
    return () => {
      ipcRenderer.removeListener('request-export-window', handler);
    };
  },
    getPandocPath: () => ipcRenderer.invoke('get-pandoc-path'),
    setPandocPath: (path) => ipcRenderer.send('set-pandoc-path', path),
    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),  
    selectFileDialog: (options) => ipcRenderer.invoke('select-file-dialog', options),
    openExportWindow: (filePath) => ipcRenderer.send('open-export-window', filePath),
    getTargetFilePath: () => ipcRenderer.invoke('get-target-file-path'),
    closeExportWindow: () => ipcRenderer.send('close-export-window'),    
    setExportBusyState: (isBusy) => ipcRenderer.send('set-export-busy-state', isBusy),
    showEncodingWarningDialog: (message) => ipcRenderer.send('show-encoding-warning', message),
    confirmSaveWithEncodingWarning: (fileName) => ipcRenderer.invoke('confirm-save-with-encoding-warning', fileName),
    analyzeSourceFile: (filePath) => ipcRenderer.invoke('analyze-source-file', filePath),
}

contextBridge.exposeInMainWorld('electronAPI', api)

// ★★★ マウスの「戻る/進む」ボタンイベントを直接リッスン ★★★
window.addEventListener('mouseup', (event) => {
  if (event.button === 3 || event.button === 4) {
    event.preventDefault();
    const direction = event.button === 3 ? 'previous' : 'next';
    
    // ★★★ mainプロセスに、新しいチャンネルで通知 ★★★
    ipcRenderer.send('mouse-nav', direction);
  }
});