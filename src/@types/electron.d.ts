// ★★★ サイクルフォント用とシステムフォント用の、2つの型を定義 ★★★
interface CycleFontsInfo {
  isSystemFont?: false; // システムフォントではないことを示すフラグ
  availablefonts: string[];
  currentFontName: string;
}
interface SystemFontInfo {
  isSystemFont: true; // システムフォントであることを示すフラグ
  fontData: {
    cssFontFamily: string;
    base64: string;
    format: string;
  };
}
// ★★★ fontsInfoは、このどちらかの型になる ★★★
type FontsInfo = CycleFontsInfo | SystemFontInfo;

interface ContentInfo {
  content: string;
  fontsize: number;
  lineNumber: number;
}

interface ExportOptions {
  sourceFilePath: string;
  encoding: string;
  title: string;
  author: string;
  coverImagePath: string | null;
  isVertical: boolean;
  useRubyFilter: boolean;
  format: 'epub' | 'html'| 'pdf'; 
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IElectronAPI {
  // ファイル操作
  openFile: () => Promise<{ 
    filePath: string; 
    content: string; 
    encoding: string; 
    eol: "LF" | "CRLF";
    warning?: string; // ★
  } | null>;
  
  readFile: (filePath: string) => Promise<{ 
    content: string; 
    encoding: string; 
    eol: "LF" | "CRLF";
    warning?: string; // ★
  } | null>;
  saveFile: (
    filePath: string | null,
    content: string,
    options: { encoding: string; eol: 'LF' | 'CRLF' }
  ) => Promise<{
    success: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
  }>;
  
  // ウィンドウ操作 (メインウィンドウ用)
  quitApp: () => void;
  minimizeWindow: () => void;
  closeWindow: () => void;
  
  // ウィンドウ操作 (共通)
  requestToggleFullscreen: () => void;

  // フォントサイズ
  getfontsize: () => Promise<number>;
  setfontsize: (size: number) => void;
  onChangefontsize: (callback: (action: 'increase' | 'decrease' | 'reset'| 'reset20') => void) => () => void;


  updatePreviewfontsize: (size: number) => void;
  onPreviewfontsizeChange: (callback: (size: number) => void) => () => void;




  // プレビューウィンドウ
  togglePreviewWindow: () => void;
  toggleIPWindow: () => void;

  onLoadText: (callback: (data: { content: string; isDarkMode: boolean; fontsize: number; lineNumber: number }) => void) => () => void;
  
  // リアルタイムスクロール同期
  syncScrollPosition: (lineNumber: number) => void;
  onSyncScrollPosition: (callback: (lineNumber: number) => void) => () => void;
  onOpenFile: (callback: (filePath: string, isTemporary?: boolean) => void) => () => void;
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

  openPreviewWindow: (data: {
    initialContent: ContentInfo;
    fontsInfo: FontsInfo;
  }) => void;
  updatePreview: (data: ContentInfo) => void;
  updatePreviewFont: (fontName: string) => void;

  // main -> preview
  onInitializePreview: (callback: (data: {
    initialContent: ContentInfo;
    fontsInfo: FontsInfo;
    isDarkMode: boolean;
  }) => void) => () => void;
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
  onToggleRightAlignShortcut: (callback: () => void) => () => void;
  openResourcesFolder: () => void;
  onCycleTab: (callback: (direction: 'next' | 'previous') => void) => () => void;
  getBgmBuffer: (fileName: string) => Promise<Buffer | null>;
  confirmCloseTab: (fileName: string) => Promise<boolean>; // trueなら閉じる、falseならキャンセル
  confirmLargeFilePreview: (fileSize: number) => Promise<boolean>;
  requestGlobalFontSizeChange: (action: 'increase' | 'decrease' | 'reset' | 'reset20') => void;
  requestGlobalFontCycle: () => void;
  requestGlobalBgmCycle: () => void;
  requestGlobalBgmPlayPause: () => void;
  scanSystemFonts: (force: boolean) => Promise<{ family: string; path: string; }[]>;
  getFontBase64: (filePath: string) => Promise<string | null>;
  // ★ メインウィンドウにフォント変更を"命令"するためのAPI
  applyFontToMainWindow: (fontData: { path: string; cssFontFamily: string; base64: string; format: string }) => void;
  onApplySystemFontFromSettings: (callback: (fontData: { path: string; cssFontFamily: string; base64: string; format: string }) => void) => () => void;
  toggleSettingsWindow: () => void;
  createIdeaProcessorWindow: () => void;

  getAppliedSystemFontPath: () => Promise<string | undefined>;
  setAppliedSystemFontPath: (filePath: string | null) => Promise<void>;
  clearFontIndex: () => void;  
  closeSettingsWindow: () => void;
  selectImageDialog: () => Promise<string | null>;
  runExport: (options: ExportOptions) => Promise<{ success: boolean; error?: string }>;  
  onRequestExportWindow: (callback: () => void) => () => void;
  getPandocPath: () => Promise<string>;
  setPandocPath: (path: string) => void;
  openExternalLink: (url: string) => void;  
  selectFileDialog: (options: FileDialogOptions) => Promise<string | null>;
  openExportWindow: (filePath: string) => void;
  getTargetFilePath: () => Promise<string | null>;
  closeExportWindow: () => void;  
  setExportBusyState: (isBusy: boolean) => void;
  showEncodingWarningDialog: (message: string) => void;
  confirmSaveWithEncodingWarning: (fileName: string) => Promise<boolean>;
  analyzeSourceFile: (filePath: string) => Promise<{ encoding: string; eol: 'LF' | 'CRLF'; } | null>;
  getCustomPaths: () => Promise<{ background?: string; bgm?: string }>;
  setCustomPath: (args: { type: 'background' | 'bgm'; path: string | null }) => void;
  getBackgroundDataUrl: (filePath: string) => Promise<string | null>;
  getBgmDataUrl: (filePath: string) => Promise<string | null>;
saveIdeaProcessorFile: (filePath: string | null, saveData: any) => Promise<any>;
  on: (channel: string, callback: (...args: any[]) => void) => void;
  debugLog: (...args: any[]) => void;
  notifyReadyForData: () => void;
  ideaOpenFile: () => Promise<void>;
  ideaOpenFileByPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  checkDirtyState: () => Promise<boolean>;
  triggerSaveSync: () => Promise<{
    success: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
  }>;  
  notifyReadyToClose: (canClose: boolean, zoomState: any, nextFilePath?: string | null) => void;
  historyPush: (stateString: string) => Promise<void>;
  historyUndo: () => Promise<string | null>;
  historyRedo: () => Promise<string | null>;
  fileNew: () => void;
  notifyTitleChange: (filePath: string | null) => void;  
  notifyRendererIsReady: () => void;
  exportAsMarkdown: (content: string, currentPath: string | null) => void;
  exportAsImage: (dataUrl: string, format: 'png' | 'jpeg', currentPath: string | null) => void;
  exportAsPdf: (dataUrl: string, currentPath: string | null) => void;
  exportAsHtml: (dataUrl: string, currentPath: string | null) => void;
  sendMarkdownToEditor: (content: string) => void;
  importFromScrivener: () => Promise<{ title: string; content: string } | null>;
  onContextMenuCommand: (callback: (command: string) => void) => void;
  resetIpWindow: () => void;
  getStoreValue: <T>(key: string, defaultValue: T) => Promise<T>;
  setStoreValue: (key: string, value: any) => void;  
  requestNativeUndo: () => void;
  requestNativeRedo: () => void;  
  checkForUnsavedChanges: () => Promise<boolean>;
  confirmSaveDialog: (windowName: string) => Promise<'save' | 'discard' | 'cancel'>;
  toggleIpAlwaysOnTop: () => Promise<boolean>;
  togglePreviewAlwaysOnTop: () => Promise<boolean>;
  requestGeminiResponse: (
      apiKey: string, 
      history: { role: string, content: string }[], 
      newMessage: string
  ) => Promise<{ success: boolean; text?: string; error?: string; }>;  
  requestLmStudioResponse: (
      history: ChatMessage[]
  ) => Promise<{ success: boolean; text?: string; error?: string; }>;  
  showInfoDialog: (message: string) => void;
  openAiChatWindow: () => void;
  closeAiChatWindow: () => void;
  writeToClipboard: (text: string) => void;
  importGeminiLogAsText: () => Promise<{ title: string; content: string } | null>;
  convertGeminiLogToText: () => void;  
  saveAiChatLog: (history: ChatMessage[], format: 'pastel' | 'lm-studio') => void;
  loadAiChatLog: () => Promise<ChatMessage[] | null>;  
  loadAiChatLogByPath: (filePath: string) => Promise<ChatMessage[] | null>;
  onGlobalFontSizeChange: (callback: (action: 'increase' | 'decrease' | 'reset' | 'reset20') => void) => void;
  sendChatToEditor: (title: string, content: string) => void;
  selectImageFile: () => Promise<{ path: string; dataUrl: string; } | null>;
  saveAiChatLogOverwrite: (history: ChatMessage[]) => void;
  updateAiChatSettings: () => void;   
  convertPathToDataUrl: (filePath: string) => Promise<string | null>;
  isChatDirty: () => Promise<boolean>;
  onRequestChatDirtyState: (callback: () => void) => void;
  responseChatDirtyState: (isDirty: boolean) => void;  
}

// グローバルなwindowオブジェクトにelectronAPIが存在することを宣言
declare global {
  interface Window {
    electronAPI: IElectronAPI;
    interop: {
      sendToMain: (channel: string, data?: any) => void;
      onMainMessage: (channel: string, callback: (data: any) => void) => () => void;
    };    
  }
}