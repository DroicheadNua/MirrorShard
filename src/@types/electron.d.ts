interface fontsInfo {
  availablefonts: string[];
  currentFontName: string;
}
interface ContentInfo {
  content: string;
  fontsize: number;
  lineNumber: number;
}

export interface IElectronAPI {
  // ファイル操作
  openFile: () => Promise<{ filePath: string; content: string; encoding: string; eol: 'LF' | 'CRLF' } | null>;
  readFile: (filePath: string) => Promise<{ content: string; encoding: string; eol: 'LF' | 'CRLF' } | null>;
  saveFile: (
    filePath: string | null,
    content: string,
    options: { encoding: string; eol: 'LF' | 'CRLF' }
  ) => Promise<string | null>;
  
  // ウィンドウ操作 (メインウィンドウ用)
  quitApp: () => void;
  minimizeWindow: () => void;
  closeWindow: () => void;
  
  // ウィンドウ操作 (共通)
  toggleFullScreen: () => void;

  // フォントサイズ
  getfontsize: () => Promise<number>;
  setfontsize: (size: number) => void;
  onChangefontsize: (callback: (action: 'increase' | 'decrease' | 'reset'| 'reset20') => void) => () => void;


  updatePreviewfontsize: (size: number) => void;
  onPreviewfontsizeChange: (callback: (size: number) => void) => () => void;




  // プレビューウィンドウ
  togglePreviewWindow: () => void;

  onLoadText: (callback: (data: { content: string; isDarkMode: boolean; fontsize: number; lineNumber: number }) => void) => () => void;
  
  // リアルタイムスクロール同期
  syncScrollPosition: (lineNumber: number) => void;
  onSyncScrollPosition: (callback: (lineNumber: number) => void) => () => void;
  onOpenFile: (callback: (filePath: string) => void) => () => void;
  onScrollTo: (callback: (direction: 'top' | 'bottom') => void) => () => void;
  onThemeUpdated: (callback: (isDarkMode: boolean) => void) => () => void;  
  themeUpdated: (data: { isDarkMode: boolean; }) => void;
  onRequestOpenPreview: (callback: () => void) => () => void;
  onRequestSessionSave: (callback: () => void) => void;
  sessionSave: (filePaths: (string | null)[]) => void;
  onOpenFileInNewTab: (callback: (filePath: string) => void) => () => void;
  onTriggerOpenFile: (callback: () => void) => () => void;
  onTriggerSaveFile: (callback: () => void) => () => void;
  getFontList: () => Promise<string[]>;
  getFontData: (path: string) => Promise<{ data: string; format: string; } | null>;

  getFontIndex: () => Promise<number>;
  setFontIndex: (index: number) => void;  

  openPreviewWindow: (data: { initialContent: ContentInfo; fontsInfo: fontsInfo; }) => void;
  updatePreview: (data: ContentInfo) => void;
  updatePreviewFont: (fontName: string) => void;

  // main -> preview
  onInitializePreview: (callback: (data: { initialContent: ContentInfo; fontsInfo: fontsInfo; isDarkMode: boolean; }) => void) => () => void;
  onUpdatePreview: (callback: (data: ContentInfo) => void) => () => void;
  onPreviewFontChange: (callback: (fontName: string) => void) => () => void;
  getbgmList: () => Promise<string[]>;
  onTriggerbgmCycle: (callback: () => void) => () => void;
  onTriggerbgmPlayPause: (callback: () => void) => () => void;
  onTriggerZenMode: (callback: () => void) => () => void;
  onTriggerTypeSoundToggle: (callback: () => void) => () => void;
  notifyPreviewClosed: () => void;
  onPreviewHasBeenClosed: (callback: () => void) => () => void;
  getbgList: () => Promise<string[]>;
  getbgIndex: () => Promise<number>;
  setbgIndex: (index: number) => void;
  onTriggerbgCycle: (callback: () => void) => () => void;
  rendererReady: () => void;
  togglePreviewSnow: () => void;
  onTriggerSnowToggle: (callback: () => void) => () => void;
  getSnowState: () => Promise<boolean>;
  setSnowState: (isEnabled: boolean) => void;
  triggerSnowToggle: () => void;
  getbgmIndex: () => Promise<number>;
  setbgmIndex: (index: number) => void;
  getbgmPausedState: () => Promise<boolean>;
  setbgmPausedState: (isPaused: boolean) => void;
  getTypeSoundState: () => Promise<boolean>;
  setTypeSoundState: (isEnabled: boolean) => void;
  onTriggerFocusMode: (callback: () => void) => () => void;
  onRequestUnsavedChangesCheck: (callback: () => void) => () => void;
  responseUnsavedChanges: (hasChanges: boolean) => void;
  sessionSaved: () => void;
  getDarkModeState: () => Promise<boolean>;
  setDarkModeState: (isEnabled: boolean) => void;
  getFocusModeState: () => Promise<boolean>;
  setFocusModeState: (isEnabled: boolean) => void;
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number; } | undefined>;
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number; }) => void;  
  onTriggerNewFile: (callback: () => void) => () => void;
  onTriggerFontCycle: (callback: () => void) => () => void;
  notifyFilesDropped: (filePaths: string[]) => void;
  showContextMenuFromBlueprint: (template: any[]) => void; // templateの型は後で厳密にできる
  getRecentFiles: () => Promise<{ path: string; basename: string; }[]>;
  addToHistory: (filePath: string) => void;
  onTriggerSaveAsFile: (callback: () => void) => () => void;
  onTriggerTogglePreview: (callback: () => void) => () => void;
  toggleDarkMode: () => void;
  getZenModeState: () => Promise<boolean>;
  setZenModeState: (isEnabled: boolean) => void;
  onToggleOutlineShortcut: (callback: () => void) => () => void;
  openResourcesFolder: () => void;
  onCycleTab: (callback: (direction: 'next' | 'previous') => void) => () => void;
  getBgmBuffer: (fileName: string) => Promise<Buffer | null>;
  confirmCloseTab: (fileName: string) => Promise<boolean>; // trueなら閉じる、falseならキャンセル
  confirmLargeFilePreview: (fileSize: number) => Promise<boolean>;
  requestGlobalFontSizeChange: (action: 'increase' | 'decrease' | 'reset' | 'reset20') => void;
  requestGlobalFontCycle: () => void;
  requestGlobalBgmCycle: () => void;
  requestGlobalBgmPlayPause: () => void;
}

// グローバルなwindowオブジェクトにelectronAPIが存在することを宣言
declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}