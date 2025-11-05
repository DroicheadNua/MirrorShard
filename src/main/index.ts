// src/main/index.ts
import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, protocol, clipboard } from 'electron'
import path, { join, basename, extname } from 'path'
import * as Encoding from 'encoding-japanese';
import { electronApp, is } from '@electron-toolkit/utils'
import AdmZip from 'adm-zip'
import Store from 'electron-store'
import { promises as fsPromises, existsSync, writeFileSync, readFileSync, statSync, cpSync } from 'fs'
import os from 'os';
import { ExportOptions } from '../@types/electron';
import util from 'util';


// --- [エリア 1: 型定義 & グローバル変数] ---
interface StoreType {
  fontsize: number;
  fontIndex: number;
  previewBounds?: { x: number; y: number; width: number; height: number; };
  previewIsFullscreen?: boolean;
  bgIndex: number;
  bgmIndex: number;
  isbgmPaused: boolean;
  isTypeSoundEnabled: boolean;
  isSnowing: boolean;
  sessionFilePaths?: string[];
  isDarkMode: boolean;
  isFocusMode: boolean;
  isZenMode: boolean;
  windowBounds?: { x: number; y: number; width: number; height: number; };
  appliedSystemFontPath?: string;
  pandocPath?: string;
  isOutlineVisible: boolean; 
  isRightAlign: boolean;
  customBackgroundPath?: string;
  customBgmPath?: string;  
  isFullscreen?: boolean;
  ideaProcessorIsMaximized?: boolean;
  isIpAlwaysOnTop?: boolean; 
  isPreviewAlwaysOnTop?: boolean;
  aiResponseMaxLength?: number;
  aiChatWindowBounds?: { x: number; y: number; width: number; height: number; };
  lastAiChatSessionPath?: string | null;  
}

const store = new Store<StoreType>({ 
  defaults: { 
    fontsize: 15, 
    fontIndex: 0,
    previewBounds: undefined,
    previewIsFullscreen: false,
    bgIndex: 0,
    bgmIndex: -1, // -1は「曲が選択されていない」
    isbgmPaused: true,
    isTypeSoundEnabled: true,
    isSnowing: false,
    sessionFilePaths: [],
    isDarkMode: false,
    isFocusMode: false,
    isZenMode: false,
    windowBounds: undefined,
    pandocPath: 'pandoc',
    isOutlineVisible: true,   
    isRightAlign: false,
    isFullscreen: false,
    ideaProcessorIsMaximized: false,
    isIpAlwaysOnTop: true, 
    isPreviewAlwaysOnTop: true,    
    aiResponseMaxLength: 2000,
    aiChatWindowBounds: undefined,
    lastAiChatSessionPath: null,    
  }
});

interface CanvasNode {
  id: string;
  type: 'file';
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  parentId?: string | null; // 親グループのID。存在しない場合もあるのでオプショナルに。
  isTemplateItem?: boolean;
  placeholder?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label: string;
  type: string; // 'line', 'arrow', 'double_arrow'
  isTemplateItem?: boolean;
}

interface CanvasGroup {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  isTemplateRoot?: boolean;
}

interface LmStudioResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const userDataPath = app.getPath('userData');
const iconPath = join(__dirname, '../../resources/icon.png');
const historyFilePath = join(userDataPath, 'history.json');
const MAX_HISTORY = 10;
const PREVIEW_TEXT_LIMIT = 500000;
const fontCachePath = join(app.getPath('userData'), 'system-fonts.json');
const isMac = process.platform === 'darwin'

let previewWindow: BrowserWindow | null = null;
let shortcutWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let ideaProcessorWindow: BrowserWindow | null = null;
let aiChatWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let fileToOpenOnStartup: string | null = null;
let exportWindow: BrowserWindow | null = null;
let isExporting = false;

const autoSaveDir = path.join(app.getPath('userData'), 'ipAutoSave');
const untitledPath = path.join(autoSaveDir, 'Untitled.mrsd');
const historyDir = path.join(app.getPath('userData'), 'ipHistory');
let historyFiles: string[] = [];
let historyIndex = -1;

// --- [エリア 1.5: 遅延読み込み処理] ---
import type * as Fontkit from 'fontkit';
import type { lookup as MimeLookup } from 'mime-types';
import type { ExecOptions } from 'child_process';
type ExecPromise = (
  command: string,
  options?: ExecOptions
) => Promise<{ stdout: string; stderr: string }>;

let fontkit: typeof Fontkit | null = null;
let _lookup: typeof MimeLookup | null = null;
let _execPromise: ExecPromise | null = null;

function getFontkit() {
  if (!fontkit) {
    fontkit = require('fontkit');
  }
  return fontkit;
}
const getLookup = () => {
  if (!_lookup) _lookup = require('mime-types').lookup;
  return _lookup;
};
const getExecPromise = (): ExecPromise => {
  // まだ生成されていなければ
  if (!_execPromise) {
    // この場で`exec`を読み込む
    const { exec } = require('child_process');
    // 読み込んだ`exec`を`promisify`して、変数にキャッシュする
    // `as ExecPromise` を付けて、型を明示的に教えてあげることが重要
    _execPromise = util.promisify(exec) as ExecPromise;
  }
  // キャッシュした（または既に存在した）`execPromise`を返す
  return _execPromise;
};

// --- [エリア 2: ヘルパー関数] ---

function ensureUserResources(): void {
  try {
    // a. パスを定義
    const userDataPath = app.getPath('userData');
  const sourceResourcesPath = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    // ★ 開発時のパス解決を、より堅牢にする
    : join(app.getAppPath(), 'resources');

    // ★ resourcesフォルダ自体をコピー先（userData/resources）にコピーする
    const destResourcesPath = join(userDataPath, 'resources');
    
    // コピー元が存在し、かつ、コピー先が存在しない場合のみコピー
    if (existsSync(sourceResourcesPath) && !existsSync(destResourcesPath)) {
      console.log(`[ensure] Copying initial resources: "${sourceResourcesPath}" -> "${destResourcesPath}"`);
      cpSync(sourceResourcesPath, destResourcesPath, { recursive: true });
    }
    // もし、トップレベルは存在しても…
    else {
      // a) これから追加したいサブフォルダのリストを定義
      const subfoldersToCheck = ['default_icons']; // 将来、'themes'などを追加できる

      subfoldersToCheck.forEach(folder => {
        const sourceSubfolder = join(sourceResourcesPath, folder);
        const destSubfolder = join(destResourcesPath, folder);

        // b) もし、そのサブフォルダが、コピー先に存在しなかったら…
        if (existsSync(sourceSubfolder) && !existsSync(destSubfolder)) {
          // c) そのサブフォルダだけを、追加でコピーする (アップデート)
          console.log(`[ensure] Updating subfolder: "${folder}"`);
          cpSync(sourceSubfolder, destSubfolder, { recursive: true });
        }
      });
    }    
  } catch (e) {
    console.error('FATAL: Failed to ensure user resources:', e);
    dialog.showErrorBox('リソースファイルのコピーに失敗しました', `エラー:`);
    app.quit();
  }
}

async function analyzeFile(filePath: string): Promise<{
  content: string;
  encoding: string;
  eol: 'LF' | 'CRLF';
  warning?: string;
}> {
  const buffer = await fsPromises.readFile(filePath);
  let warning: string | undefined = undefined;

  // --- ステップ1: 2つの確証（BOM-less UTF-8 と Shift_JIS）を先に得る ---
  const contentIsUtf8 = isUtf8(buffer);

  // --- ステップ2: encoding-japaneseによる自動判定 ---
  const detectedEncoding = Encoding.detect(buffer) as Encoding.Encoding | false;

  // --- ステップ3: 判定結果に基づいて、デコードと状態決定を行う ---
  let content: string;
  let finalEncoding: string;
  
  // a) BOMがなく、かつ内容がUTF-8として完全に妥当な場合、UTF-8を最優先する
  //    (FORM FEEDのような制御文字による誤判定をここで覆す)
  //    ただし、BOM付きファイルは detectedEncoding が 'UTF8BOM' 等になるため、この条件には入らない。
  if (contentIsUtf8 && detectedEncoding !== 'UTF8BOM' && detectedEncoding !== 'UTF16LE' && detectedEncoding !== 'UTF16BE') {
    content = buffer.toString('utf8'); // ★ ライブラリを介さず、直接デコード
    finalEncoding = 'UTF8';
    
    // b) ただし、SJISの可能性も探る（安全のための警告）
    if (isSjis(buffer)) {
      warning = `このファイルの文字コードはUTF-8と推定されましたが、Shift_JISである可能性もあります...`;
    }
  }
  // c) もし、何らかのエンコーディングが（BOM含め）明確に検出されたら...
  else if (detectedEncoding) {
    let encodingToUse = detectedEncoding;
    if (detectedEncoding === 'ASCII') {
      encodingToUse = 'UTF8';
    }
    if (detectedEncoding === 'UTF32') {
      encodingToUse = 'UTF8';
      warning = `UTF-32は現在サポートされていません。安全のためUTF-8として開きます。文字化けしている場合は保存せずに閉じてください。`;
    }    
    try {
      content = Encoding.convert(buffer, { to: 'UNICODE', from: encodingToUse, type: 'string' });
      finalEncoding = encodingToUse;
    } catch (e) {
      content = buffer.toString('utf8'); // ★ フォールバックもネイティブに
      finalEncoding = 'UTF8';
      warning = `エンコード'${detectedEncoding}'のデコードに失敗しました。UTF-8として開きます。`;
    }
  } 
  // d) もし、何も検出できなかったら... 
  else {
    content = Encoding.convert(buffer, { to: 'UNICODE', from: 'UTF8', type: 'string' });
    finalEncoding = 'UTF8';
    warning = `文字コードを自動判別できませんでした。UTF-8として開きます。`;
  }

  // --- ステップ4: EOLを検出し、内容を正規化して返す ---
  const eol: 'LF' | 'CRLF' = content.includes('\r\n') ? 'CRLF' : 'LF';
  // ★ 制御文字(FORM FEED)をここで無害化する
  const normalizedContent = content
    .replace(/\r\n/g, '\n') // EOL正規化
    .replace(/\u000C/g, '[FF]'); // FORM FEEDを可視化

  // 表示用のエンコーディング名を整形
  if (finalEncoding === 'SJIS') finalEncoding = 'Shift_JIS';
  if (finalEncoding === 'EUCJP') finalEncoding = 'EUC-JP';
  if (finalEncoding === 'JIS') finalEncoding = 'ISO-2022-JP';
  
  return { content: normalizedContent, encoding: finalEncoding, eol, warning };
}

// isSjisを、encoding-japaneseを使って再実装
function isSjis(buffer: Buffer): boolean {
  try {
    const sjisStr = Encoding.convert(buffer, { to: 'UNICODE', from: 'SJIS', type: 'string'});
    const reEncodedBuffer = Encoding.convert(sjisStr, { from: 'UNICODE', to: 'SJIS', type: 'buffer' });
    // SJISとしてデコードし、再度エンコードした結果が、元のバイト列と一致するか
    return buffer.equals(reEncodedBuffer);
  } catch (e) {
    return false;
  }
}

// isUtf8関数を、Node.jsネイティブのBuffer機能で再実装
function isUtf8(buffer: Buffer): boolean {
  // Buffer.compareは、2つのバッファが完全に同一であれば0を返します。
  // bufferをNode.jsネイティブのUTF-8として文字列に変換し、
  // 即座にUTF-8としてBufferに書き戻します。
  // 元のバイト列と1バイトも変わらなければ、それは妥当なUTF-8です。
  return Buffer.compare(buffer, Buffer.from(buffer.toString('utf8'), 'utf8')) === 0;
}

async function resetIPHistory() {
  await fsPromises.rm(historyDir, { recursive: true, force: true }).catch(() => {});
  await fsPromises.mkdir(historyDir, { recursive: true });
  historyFiles = [];
  historyIndex = -1;
  console.log(`reset IP History`);
}

function loadHistory(): string[] {
  try {
    if (existsSync(historyFilePath)) {
      const data = readFileSync(historyFilePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('Failed to load history:', e)
  }
  return []
}
function addToHistory(filePath: string): void {
  // OSの「最近使った項目」にも追加 (Mac/Win対応)
  app.addRecentDocument(filePath)

  // 自前の履歴ファイルを更新
  let history = loadHistory()
  history = history.filter((p) => p !== filePath)
  history.unshift(filePath)
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY)
  }
  try {
    writeFileSync(historyFilePath, JSON.stringify(history, null, 2))
  } catch (e) {
    console.error('Failed to save history:', e)
  }
}
function buildMenu(): void {
  const history = loadHistory()
  const historySubmenu: Electron.MenuItemConstructorOptions[] = history.map((filePath) => ({
    label: basename(filePath),
    click: () => openFileInWindow(filePath)
  }))

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              //{ role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('trigger-new-file');
          }
        },
        {
          label: 'Idea Processor', 
          accelerator: 'CmdOrCtrl+I',
          click: () => {
            createIdeaProcessorWindow(); 
          }
        },                         
        {
          label: 'AI Chat', 
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            createAiChatWindow(); 
          }
        },            
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;
        if (focusedWindow === ideaProcessorWindow) {
          handleOpenIdeaProcessorFile(); 
        } else {
            BrowserWindow.getFocusedWindow()?.webContents.send('trigger-open-file');
          }
         }
        },

{
  label: 'Save File',
  accelerator: 'CmdOrCtrl+S',
  click: () => {
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-save-file');
  }
},

        {
          label: 'Recent Files',
          submenu: historySubmenu.length > 0 ? historySubmenu : [{ label: 'No Recent Files', enabled: false }]
        },
        { type: 'separator' as const },
        isMac
         ? { role: 'close' as const } 
          : { 
              label: 'Exit', 
              // ★ Ctrl+Qを明示的に設定
              accelerator: 'CmdOrCtrl+Q', 
              click: () => { app.quit(); } 
            }
      ]
    },
{
  label: 'Edit',
  submenu: [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      click: () => { // ★ 引数は使わない
        // ★ `getFocusedWindow()`で、現在のウィンドウを確実に取得
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;

        if (focusedWindow === ideaProcessorWindow) {
          focusedWindow.webContents.send('trigger-ip-undo');
        } else {
          // ★ `focusedWindow`は、本物の`BrowserWindow`なので、`webContents`が存在する
          focusedWindow.webContents.undo(); 
        }
      }
    },
    {
      label: 'Redo',
      accelerator: 'CmdOrCtrl+Y',
      click: () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;

        if (focusedWindow === ideaProcessorWindow) {
          focusedWindow.webContents.send('trigger-ip-redo');
        } else {
          focusedWindow.webContents.redo();
        }
      }
    },
    { type: 'separator' },
    { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' }, // ★ roleが使えるものは、roleを使うのが一番シンプル
    { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
    { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
    { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' } // ★ selectAllに修正
  ]
},
    {
      label: 'View',
submenu: [
  {
    label: '文字を大きく',
    accelerator: 'CmdOrCtrl+=',
    click: () => {
        const windowsToUpdate = [
        mainWindow, 
        previewWindow, 
        ideaProcessorWindow, 
        aiChatWindow
      ];
      windowsToUpdate.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('change-font-size', 'increase');
        }
      });  
    }
  },
  {
    label: '文字を小さく',
    accelerator: 'CmdOrCtrl+-',
    click: () => {
        const windowsToUpdate = [
        mainWindow, 
        previewWindow, 
        ideaProcessorWindow, 
        aiChatWindow
      ];
      windowsToUpdate.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('change-font-size', 'decrease');
        }
      });  
    }
  },
  {
    label: '文字サイズをリセット',
    accelerator: 'CmdOrCtrl+0',
    click: () => {
        const windowsToUpdate = [
        mainWindow, 
        previewWindow, 
        ideaProcessorWindow, 
        aiChatWindow
      ];
      windowsToUpdate.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('change-font-size', 'reset');
        }
      });  
    }
  },
  {
    label: '文字サイズを20に',
    accelerator: 'CmdOrCtrl+9',
    click: () => {
        const windowsToUpdate = [
        mainWindow, 
        previewWindow, 
        ideaProcessorWindow, 
        aiChatWindow
      ];
      windowsToUpdate.forEach(win => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('change-font-size', 'reset20');
        }
      });  
    }
  },  
      {
      label: 'Toggle Preview',
      accelerator: 'CmdOrCtrl+P',
      click: () => {
        BrowserWindow.getFocusedWindow()?.webContents.send('trigger-toggle-preview');
      }
    },
        {
          label: 'Cycle Font',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            // フォーカスされているウィンドウに命令を送る
            BrowserWindow.getFocusedWindow()?.webContents.send('trigger-font-cycle');
          }
        },  
    {
      label: 'Toggle Dark Mode',
      accelerator: 'CmdOrCtrl+T',
      click: () => {
            // 1. 現在の状態をストアから読み取る
            const currentIsDarkMode = store.get('isDarkMode', false);
            // 2. 状態を反転させる
            const newIsDarkMode = !currentIsDarkMode;
            // 3. ストアとOSに反映
            store.set('isDarkMode', newIsDarkMode);
            nativeTheme.themeSource = newIsDarkMode ? 'dark' : 'light';
            // 4. 全ウィンドウに号令をかける
            BrowserWindow.getAllWindows().forEach(win => {
              if (win && !win.isDestroyed()) {
                win.webContents.send('theme-updated', newIsDarkMode);
              }
            });
      }
    },      
    {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          // 開発環境でない場合は、何もしない
          click: (_, focusedWindow) => { 
            const win = focusedWindow as BrowserWindow;
            if (is.dev && win) win.reload(); 
          }
    },
    {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_, focusedWindow) => { 
            const win = focusedWindow as BrowserWindow;
            if (is.dev && win) win.webContents.reloadIgnoringCache(); 
          }
    },
    { role: 'toggleDevTools' as const },
    { type: 'separator' as const },
    {
      label: 'Open Resources Folder',
      accelerator: 'CmdOrCtrl+Shift+J',
      click: () => {
        // shell.openPathを直接実行するのが一番シンプル
        const resourcesPath = join(app.getPath('userData'), 'resources');
        if (existsSync(resourcesPath)) {
          shell.openPath(resourcesPath);
        }
      }
    },      
{
  label: 'Cycle bgm',
  accelerator: 'CmdOrCtrl+Shift+M',
  click: () => {
    // 現在フォーカスされているウィンドウを取得し、そこに命令を送る
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-bgm-cycle');
  }
},
{
  label: 'Play/Pause bgm',
  accelerator: 'CmdOrCtrl+Shift+P',
  click: () => {
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-bgm-play-pause')
}
},
{
  label: 'Toggle Type Sound',
  accelerator: 'CmdOrCtrl+Shift+T',
  click: () => {
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-typesound-toggle')
}
},
{
  label: 'Cycle Background',
  accelerator: 'CmdOrCtrl+Shift+B',
  click: () => {
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-bg-cycle');
  }
},
  {
    label: 'Toggle Snow Effect',
    accelerator: 'CmdOrCtrl+Shift+E',
    click: () => BrowserWindow.getFocusedWindow()?.webContents.send('trigger-snow-toggle')
  },
  {
    label: 'Toggle Focus Mode',
    accelerator: 'CmdOrCtrl+Shift+W',
    click: () => BrowserWindow.getFocusedWindow()?.webContents.send('trigger-focus-mode')
  },  
{
  label: 'Toggle Zen Mode',
  accelerator: 'CmdOrCtrl+Shift+C',
  click: () => {
    // 現在フォーカスされているウィンドウを取得し、そこに命令を送る
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-zen-mode')
}
},
    {
      label: 'Toggle Outline Panel',
      accelerator: 'CmdOrCtrl+Shift+O',
      visible: false, // メニューには表示しない
      click: () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (!focusedWindow) return;
        if (focusedWindow === ideaProcessorWindow) {
          focusedWindow.webContents.send('toggle-ip-outline');
        } else {
        BrowserWindow.getFocusedWindow()?.webContents.send('toggle-outline-shortcut');
      }
     }
    },
    {
      label: 'Toggle Right Align',
      accelerator: 'CmdOrCtrl+Shift+D',
      visible: false, // メニューには表示しない
      click: () => {
        BrowserWindow.getFocusedWindow()?.webContents.send('toggle-right-align-shortcut');
      }
    },    
    {
      label: 'Cycle Next Tab',
      accelerator: 'Ctrl+Tab',
      visible: false, // メニューには表示しない
      click: () => {
        BrowserWindow.getFocusedWindow()?.webContents.send('cycle-tab', 'next');
      }
    },
    {
      label: 'Cycle Previous Tab',
      accelerator: 'Ctrl+Shift+Tab',
      visible: false,
      click: () => {
        BrowserWindow.getFocusedWindow()?.webContents.send('cycle-tab', 'previous');
      }
    },
    { type: 'separator' as const },        
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
    {
      label: 'Toggle Fullscreen',
      // ★ F11 (Windows/Linux) と Cmd+Ctrl+F (macOS) の両方を公式にサポート
      accelerator: process.platform === 'darwin' ? 'Cmd+Ctrl+F' : 'F11',
      click: (_, focusedWindow) => {
        if (!focusedWindow) return;
        if (focusedWindow === ideaProcessorWindow || focusedWindow === previewWindow) {
            // --- サブウィンドウの処理 (最大化) ---
            if (!focusedWindow.isMaximized()) {
                // 保存してから最大化
                if (focusedWindow === ideaProcessorWindow) {
                    store.set('ideaProcessorWindow.bounds', focusedWindow.getBounds());
                } else if (focusedWindow === previewWindow) {
                    store.set('previewBounds', focusedWindow.getBounds());
                }
                focusedWindow.maximize();
            } else {
                focusedWindow.unmaximize();
            }
        } 
        else {
            // --- メインウィンドウの処理 (フルスクリーン) ---
            const isCurrentlyFullscreen = focusedWindow.isFullScreen();
            // これからフルスクリーンにする場合
            if (!isCurrentlyFullscreen) {
                // 保存してからフルスクリーンに
                store.set('windowBounds', focusedWindow.getBounds());
            }        
            focusedWindow.setFullScreen(!isCurrentlyFullscreen);
        }
      }
    }
      ]
    },
    {
  label: 'Help', // 新しいメニュートップレベル
  submenu: [
    {
      label: 'Show Shortcuts',
      accelerator: 'F1',
      click: () => {
        toggleShortcutWindow();
      }
    },
    {
      label: 'Settings',
      accelerator: 'F2',
      click: () => {
        toggleSettingsWindow();
      }
    }, 
    {
      label: 'Export As...',
      accelerator: 'CmdOrCtrl+E', 
      click: () => {
        if (isExporting) {
          dialog.showMessageBox({ type: 'info', message: 'エクスポート処理の実行中です。' });
          exportWindow?.focus(); // 既存のウィンドウにフォーカスを当てる
          return;
        }
        
        if (exportWindow && !exportWindow.isDestroyed()) {
          exportWindow.close();
        } else {
          BrowserWindow.getFocusedWindow()?.webContents.send('request-export-window');
        }
      }
    },
  ]
}
  ];
  if (isMac) {
      const fileMenu = template[1].submenu as Electron.MenuItemConstructorOptions[];
      const closeItemIndex = fileMenu.findIndex(item => item.role === 'close');
      if (closeItemIndex > -1) {
          // 'close' ロールを削除し、代わりに 'quit' を実行するようにする
          fileMenu[closeItemIndex] = {
              label: 'Close Window',
              accelerator: 'Cmd+W',
              click: () => app.quit() // ★ ウィンドウを閉じるのではなく、アプリを終了
          };
      }
  }  

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
function toggleShortcutWindow() {
  if (shortcutWindow && !shortcutWindow.isDestroyed()) {
    shortcutWindow.close();
    return;
  }
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    dialog.showErrorBox('Error', 'Cannot open the shortcut window without a main window.');
    return;
  }

  const baseWidth = 540; 
  const baseHeight = 700; 
  const isDarkMode = store.get('isDarkMode', false);

  shortcutWindow = new BrowserWindow({
    width: baseWidth,
    height: baseHeight,
    title: 'Shortcut Keys',
    parent: mainWindow, 
    modal: false, 
    frame: false,  
    resizable: false,  
    show: false,
    backgroundColor: isDarkMode ? '#333' : '#ddd', 
  });

  const aspectRatio = baseWidth / baseHeight;
  shortcutWindow.setAspectRatio(aspectRatio);    
    // ESCキーで閉じられるようにする
    shortcutWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
            shortcutWindow?.close();
            event.preventDefault();
        }
    });

    shortcutWindow.on('closed', () => { shortcutWindow = null; });
    
    // パスを解決してロード
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (is.dev && rendererUrl) {
      shortcutWindow.loadURL(`${rendererUrl}/shortcut.html`);
    } else {
      shortcutWindow.loadFile(join(__dirname, '../renderer/shortcut.html'));
    }

  shortcutWindow.webContents.once('did-finish-load', () => {
      if (process.platform === 'darwin') { // もしmacOSなら
        const css = `.mac-only { display: inline !important; }`;
        shortcutWindow?.webContents.insertCSS(css);
      }
      setTimeout(() => {
          if (shortcutWindow && !shortcutWindow.isDestroyed()) {
              shortcutWindow.show();
          }
      }, 50); 
  });
}

function toggleSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  } else {
    if (!mainWindow || mainWindow.isDestroyed()) {
        dialog.showErrorBox('Error', 'Cannot open this window without a main window.'); 
        return;
    }
    settingsWindow = new BrowserWindow({
      // ★ 親の高さに合わせ、幅は少し狭くする
      minWidth:540,
      minHeight:720,
      width: 540,
      height: 720, 
      title: 'Settings',
      parent: mainWindow, // 親を指定
      modal: false,
      frame: false,
      show: false,
      webPreferences: {
        // ★★★ 設定ウィンドウ専用のpreloadを指定 ★★★
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false, // 必要に応じて
      }
    });
    settingsWindow.webContents.on('did-finish-load', () => {
      if (process.platform === 'darwin') { // もしmacOSなら
        const css = `.mac-only { display: inline !important; }`;
        settingsWindow?.webContents.insertCSS(css);
      }
    });
    // ESCキーで閉じられるようにする
    settingsWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
            settingsWindow?.close();
            event.preventDefault();
        }
    });

    settingsWindow.on('closed', () => { settingsWindow = null; });
    
    // パスを解決してロード
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (is.dev && rendererUrl) {
      settingsWindow.loadURL(`${rendererUrl}/settings.html`);
    } else {
      settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'));
    }

    settingsWindow.on('ready-to-show', () => settingsWindow?.show());
  }
}

function createIdeaProcessorWindow() {
  // --- 自身のトグル制御 ---
  // もし既にアイデアプロセッサウィンドウが開いていたら、閉じるだけ
  if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
    ideaProcessorWindow.close();
    return; // ここで処理を終了
  }
  
  resetIPHistory();

  // --- ウィンドウの生成 ---
  // const parentWindow = BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isMinimized());
  // if (!parentWindow) return;
  const savedBounds = store.get('ideaProcessorWindow.bounds');
  const wasMaximized = store.get('ideaProcessorWindow.isMaximized', false);
    if (!mainWindow || mainWindow.isDestroyed()) {
        dialog.showErrorBox('Error', 'Cannot open this window without a main window.'); 
        return;
    }
  const isParentFullscreen = mainWindow.isFullScreen();
  const isAlwaysOnTop = store.get('isIpAlwaysOnTop', true);
  ideaProcessorWindow = new BrowserWindow({
    ...(savedBounds || { width: 960, height: 720 }),
    minWidth: 640,
    minHeight: 480,
    title: 'Idea Processor',
    parent: isMac ? mainWindow : undefined,
    alwaysOnTop: isAlwaysOnTop,
    modal: false, 
    frame: false,
    fullscreenable: false,

    show: false,
    transparent: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), // 既存のpreloadを共有
      sandbox: false,
      contextIsolation: true
    }
  });

  // ★★★ (macOS限定の追加対策) フルスクリーン時の挙動を制御 ★★★
  //     もし親がフルスクリーンなら、子ウィンドウが同じ空間に参加しないようにする
  if (process.platform === 'darwin' && isParentFullscreen) {
    ideaProcessorWindow.setWindowButtonVisibility(false); // 信号機を一旦隠す
  }  

  // ウィンドウの準備ができたら、初期化データを送る
  ideaProcessorWindow.webContents.once('did-finish-load', async () => {
      
    // a) `electron-store`から現在の設定を取得
    const isDarkMode = store.get('isDarkMode', false);

    const savedZoom = store.get('ideaProcessorWindow.zoom', { 
      scale: 1,                          // デフォルトのスケールは 1
      position: { x: 0, y: 0 }           // デフォルトの位置は (0, 0)
    });
    // b) 前回開いていたファイルパスを取得 (なければnull)
    const lastOpenedFile = store.get('lastOpenedIdeaFile', null);

    let dataToLoad = null;
    if (lastOpenedFile) {
        try {
            // parseMrsdFile を await で呼び出し、結果を待つ
            const parsedData = await parseMrsdFile(lastOpenedFile);
            if (parsedData) {
                dataToLoad = parsedData;
            } else {
                // parseMrsdFileがnullを返した場合（＝ファイルはあるが中身が不正）
                throw new Error('Invalid file format.');
            }
        } catch (error: any) {
            // ファイルが存在しない、またはパースに失敗した場合
            console.error(`Failed to load last opened file: ${lastOpenedFile}`, error);
            // ユーザーにエラーを通知
            dialog.showErrorBox('File Load Error', `前回終了時のファイル'${basename(lastOpenedFile)}'を開けませんでした。新規ファイルで起動します。\n\nエラー: ${error.message}`);
            // 次回からこのファイルを開かないように、ストアをクリア
            store.set('lastOpenedIdeaFile', null);
            dataToLoad = null;
        }
    }

    // c) 初期化データをまとめる
    const initialData = {
      theme: isDarkMode ? 'dark' : 'light',
      zoomState: savedZoom,
      filePathToLoad: dataToLoad ? lastOpenedFile : null
    };
    setTimeout(() => {
      if (wasMaximized && ideaProcessorWindow) {
    ideaProcessorWindow.maximize();
  }  
    },50);
    // d) 'initialize-idea-processor'チャンネルでデータを送信
   if (!initialData.filePathToLoad) {
      
  }
    ideaProcessorWindow?.webContents.send('initialize-idea-processor', initialData);
  });

  // ★ ESCキーでのクローズは不要かもしれないので、一旦コメントアウト
  //    テキスト入力中に誤って閉じてしまう可能性があるため
  /*
  ideaProcessorWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape') {
          ideaProcessorWindow?.close();
          event.preventDefault();
      }
  });
  */

  if (isMac){
    if(isAlwaysOnTop) {
    ideaProcessorWindow.setParentWindow(mainWindow);
  } else {
    ideaProcessorWindow.setParentWindow(null);
  }
}

ideaProcessorWindow.on('close', (e) => {
  if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
    e.preventDefault(); // まず閉じるのをキャンセル
    // レンダラーに終了準備をお願いする
    ideaProcessorWindow.webContents.send('please-prepare-to-close');
  }
});

ipcMain.once('ready-to-close', (_event, canClose: boolean, zoomState: any, nextFilePath?: string | null) => {
  // 終了が許可された場合のみ、状態を保存する
  if (canClose) {
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
      const isMaximized = ideaProcessorWindow.isMaximized();
      store.set('ideaProcessorWindow.isMaximized', isMaximized);
      store.set('ideaProcessorWindow.zoom', zoomState);
      if (!isMaximized) {
        store.set('ideaProcessorWindow.bounds', ideaProcessorWindow.getBounds());
      }
      // rendererから渡された、次に開くべき正しいファイルパスを保存する
      // (もし破棄されたら、nextFilePathはnullになり、ストアもnullで更新される)
      store.set('lastOpenedIdeaFile', nextFilePath);
      ideaProcessorWindow.destroy();
    }
  }
});

ideaProcessorWindow.on('closed', () => {
  ideaProcessorWindow = null;
});
  
  // --- コンテンツのロード ---
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (is.dev && rendererUrl) {
    // ★ 読み込むHTMLを`idea-processor.html`に変更
    ideaProcessorWindow.loadURL(`${rendererUrl}/idea-processor.html`);
  } else {
    ideaProcessorWindow.loadFile(join(__dirname, '../renderer/idea-processor.html'));
  }

  // ideaProcessorWindow.on('ready-to-show', () => {
  //   ideaProcessorWindow?.show();
  // });
  // a) `renderer`からの「描画準備完了」の合図を、一度だけ待つ
  ipcMain.once('renderer-is-ready', () => {
      const isAlwaysOnTop = store.get('isIpAlwaysOnTop', true);
      ideaProcessorWindow?.webContents.send('ip-always-on-top-changed', isAlwaysOnTop);    
    // b) 合図が来たら、ウィンドウを表示する
    setTimeout(() => {
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {      
      ideaProcessorWindow.show();      
    }
    }, 50);
  });  
}

function createAiChatWindow() {
  if (aiChatWindow && !aiChatWindow.isDestroyed()) {
    aiChatWindow.close();
    return;
  }
  if (!mainWindow) return;

  const isDarkMode = store.get('isDarkMode', false);
  const savedBounds = store.get('aiChatWindowBounds');
  
  aiChatWindow = new BrowserWindow({
    ...(savedBounds || { width: 400, height: 700 }),
    minWidth: 350,
    minHeight: 500,
//    parent: mainWindow,
    modal: false,
    frame: false,
    show: false,
    backgroundColor: isDarkMode ? '#333333' : '#EAE3D2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    }
  });

  // did-finish-load と setTimeout で、フリッカーなく表示
  aiChatWindow.webContents.once('did-finish-load', () => {
    const lastSessionPath = store.get('lastAiChatSessionPath');
    if (lastSessionPath) {
      aiChatWindow?.webContents.send('load-ai-chat-session', lastSessionPath);
    }    
    setTimeout(() => {
      aiChatWindow?.show();
    }, 50);
  });

  aiChatWindow.on('close', (e) => {
    e.preventDefault(); 
    handleCloseAiChatWindow(); 
  });

  aiChatWindow.on('closed', () => { aiChatWindow = null; });
  
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (is.dev && rendererUrl) {
    // 開発環境の場合
    aiChatWindow.loadURL(`${rendererUrl}/ai-chat.html`);
  } else {
    // 本番環境の場合
    aiChatWindow.loadFile(join(__dirname, '../renderer/ai-chat.html'));
  }
}

async function handleCloseAiChatWindow() {
  // 安全のためのガード節
  if (!aiChatWindow || aiChatWindow.isDestroyed()) {
    return;
  }

  // 1. rendererに、isDirtyかどうかを尋ねる
  const isDirty = await aiChatWindow.webContents.executeJavaScript(
    'window.electronAPI.isChatDirty()', true
  ).catch(() => false);

  let confirmClose = true;
  if (isDirty) {
    // 2. もしDirtyなら、お馴染みの確認ダイアログを表示
    const { response } = await dialog.showMessageBox(aiChatWindow, {
      type: 'question',
      buttons: ['変更を破棄して閉じる', 'キャンセル'],
      defaultId: 1, cancelId: 1,
      message: '保存されていないチャットログがあります。破棄しますか？',
    });
    if (response === 1) { // キャンセルが押された
      confirmClose = false;
    }
  }

  // 3. 閉じる事が確定したら…
  if (confirmClose) {
    // 4. ★★★ 最後に、boundsを保存してから、ウィンドウを「破壊」する ★★★
    store.set('aiChatWindowBounds', aiChatWindow.getBounds());
    aiChatWindow.destroy();
  }
}

// ファイルを開いてパースし、データを返すだけのヘルパー関数
async function parseMrsdFile(filePath: string) {  
  try {
    // 1. AdmZipでファイル（バッファ）を読み込む
    const zip = new AdmZip(filePath);
    
    // 2. canvas.jsonを読み込んでパースする
    const canvasJsonEntry = zip.getEntry('canvas.json');
    if (!canvasJsonEntry) throw new Error('canvas.jsonが見つかりません。');
    const canvasData = JSON.parse(canvasJsonEntry.getData().toString('utf8'));

    // もし、読み込んだデータに 'edges' が存在するなら、
    // それを 'links' にリネームし、中身もrendererが期待する形に変換する
    if (canvasData.edges && Array.isArray(canvasData.edges)) {
      canvasData.links = canvasData.edges.map(edge => ({
        id: edge.id,
        from: edge.fromNode, // fromNode -> from
        to: edge.toNode,     // toNode -> to
        label: edge.label,
        type: edge.type,
        isTemplateItem: edge.isTemplateItem || false, // isTemplateItem も渡す
      }));
      // 元のedgesプロパティは削除
      delete canvasData.edges;
    }

    // 3. 各ノードの本文データを読み込む
    if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
      for (const node of canvasData.nodes) {
        if (node.type === 'file' && node.file) {
          const contentEntry = zip.getEntry(node.file);
          // ★ 本文データをノードオブジェクトに直接追加する
          node.contentText = contentEntry ? contentEntry.getData().toString('utf8') : '';
        }
      }
    }
    const cleanData = JSON.parse(JSON.stringify(canvasData));
  return cleanData; // パースしたデータを返す
  } catch (error) {
    console.error('ファイルの読み込みに失敗しました:${filePath}', error);
    throw error;
  }
}

async function handleOpenIdeaProcessorFile() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'アイデアプロセッサファイルを開く',
    filters: [
      { name: 'MirrorShard Canvas', extensions: ['mrsd'] }
    ],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) {
    return;
  }

  const filePath = filePaths[0];
  resetIPHistory();
  
  try {
    // 1. AdmZipでファイル（バッファ）を読み込む
    const zip = new AdmZip(filePath);
    
    // 2. canvas.jsonを読み込んでパースする
    const canvasJsonEntry = zip.getEntry('canvas.json');
    if (!canvasJsonEntry) throw new Error('canvas.jsonが見つかりません。');
    const canvasData = JSON.parse(canvasJsonEntry.getData().toString('utf8'));

    // 3. 各ノードの本文データを読み込む
    if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
      for (const node of canvasData.nodes) {
        if (node.type === 'file' && node.file) {
          const contentEntry = zip.getEntry(node.file);
          // ★ 本文データをノードオブジェクトに直接追加する
          node.contentText = contentEntry ? contentEntry.getData().toString('utf8') : '';
        }
      }
    }
    const cleanData = JSON.parse(JSON.stringify(canvasData));
    
    if (!ideaProcessorWindow || ideaProcessorWindow.isDestroyed()) {
      return;
    }
    // ★ 確実に存在するウィンドウを取得し、フォーカスを当てる
    const targetWindow = ideaProcessorWindow!; // `!` を付けて、存在することを明示
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.focus();    
    store.set('lastOpenedIdeaFile', filePath);

    // 5. ウィンドウが表示されたら、パースしたデータを送信する
  if (targetWindow.webContents.isLoading()) {
    targetWindow.webContents.once('did-finish-load', () => {
      targetWindow.webContents.send('load-data', { filePath: filePath, data: cleanData });
    });
  } else {
    // 既にロード済みなら、即座に送信
    targetWindow.webContents.send('load-data', { filePath: filePath, data: cleanData });
  }

  } catch (error) {
    console.error('ファイルの読み込みに失敗しました:', error);
  let errorMessage = '不明なエラーが発生しました。';
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  }    
    dialog.showErrorBox('読み込み失敗', `ファイルの読み込み中にエラーが発生しました。\n\n${errorMessage}`);
  }
}

function openFileInWindow(filePath: string): void {
  addToHistory(filePath);
  buildMenu();
  const mainWindow = BrowserWindow.getAllWindows().find(win => win !== previewWindow && win !== shortcutWindow);
  if (mainWindow) {
    mainWindow.webContents.send('open-file', filePath);
    mainWindow.focus();
  } else {
    fileToOpenOnStartup = filePath;
    createWindow();
  }
}

function createWindow(filePath?: string | null): void {
  ensureUserResources();
  const savedBounds = store.get('windowBounds');
  const wasFullscreen = store.get('isFullscreen', false);
  const isDarkMode = store.get('isDarkMode', false);
  const mainWindowOptions: Electron.BrowserWindowConstructorOptions = {
  ...(savedBounds || { width: 900, height: 670 }),
  minWidth: 640,
  minHeight: 480,  
    show: false,
    backgroundColor: isDarkMode ? '#333333' : '#dddddd',
  icon: iconPath,
  autoHideMenuBar: true,
  ...(process.platform === 'linux' ? { icon: iconPath } : {}), 
  frame: false,
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: -20, y: -20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    }
  };

// Linuxの場合のみ、iconプロパティを追加
  if (process.platform === 'linux') {
    // 定義済みのiconPathを使う
    mainWindowOptions.icon = iconPath; 
  }

 mainWindow = new BrowserWindow(mainWindowOptions);  

  ipcMain.once('renderer-ready', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // a) 起動時に開くべきファイルがあれば、それをrendererに伝える
    //    (このタイミングで送ることで、表示前の処理が確実になる)
    if (filePath) {
      mainWindow.webContents.send('open-file', filePath);
    }
    
    // b) もし前回がフルスクリーンだったら、フルスクリーンにする
    if (wasFullscreen) {
      mainWindow.setFullScreen(true);
    }
    
    // c) すべての準備が整った、まさにその瞬間に、ウィンドウを表示する
    mainWindow.show();
    mainWindow.focus();
  });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });  


  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

// Viteの開発サーバーURLがあるかどうかで読み込み先を分岐させる
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function scanSystemFontsInternal(): Promise<{ family: string; path: string }[]> {
  console.log('[FontManager] Scanning system fonts...');
  const fk = getFontkit();
  try {
    const fontList: { family: string; path: string }[] = [];
    const seenFamilies = new Set<string>();
    const platform = os.platform();

    if (platform === 'linux') {
      // --- Linuxの場合: globを動的にインポートして、再帰的に検索 ---
      try {
        const { glob } = await import('glob');
        const searchPatterns = [
          '/usr/share/fonts/**/*.ttf', '/usr/share/fonts/**/*.otf',
          '/usr/local/share/fonts/**/*.ttf', '/usr/local/share/fonts/**/*.otf',
          join(os.homedir(), '.fonts', '**/*.ttf'), join(os.homedir(), '.fonts', '**/*.otf'),
          join(os.homedir(), '.local', 'share', 'fonts', '**/*.ttf'), join(os.homedir(), '.local', 'share', 'fonts', '**/*.otf'),
        ];
        const fontPaths = await glob(searchPatterns, { nodir: true, dot: false });

        for (const filePath of fontPaths) {
          try {
            const font = fk.openSync(filePath);
            const fontsInFile = 'fonts' in font ? (font as any).fonts : [font];
            for (const f of fontsInFile) {
              if (f.familyName && !seenFamilies.has(f.familyName)) {
                fontList.push({ family: f.familyName, path: filePath });
                seenFamilies.add(f.familyName);
              }
            }
          } catch (e) { /* 壊れたフォントはスキップ */ }
        }
      } catch (e) { console.error('Glob dynamic import or execution failed:', e); }

    } else {
      // --- WindowsとmacOSの場合: readdirで、指定されたフォルダだけを検索 ---
      const fontDirs: string[] = [];
      if (platform === 'win32') {
        fontDirs.push(join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'));
        fontDirs.push('C:\\Windows\\Fonts');
      } else if (platform === 'darwin') {
        fontDirs.push(join(os.homedir(), 'Library', 'Fonts'));
        fontDirs.push('/Library/Fonts');
        fontDirs.push('/System/Library/Fonts');
      }
      
      for (const dir of fontDirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = await fsPromises.readdir(dir);
          for (const file of files) {
            if (/\.(ttf|otf|ttc)$/i.test(file)) {
              const filePath = join(dir, file);
              try {
                const font = fk.openSync(filePath);
                const fontsInFile = 'fonts' in font ? (font as any).fonts : [font];
                for (const f of fontsInFile) {
                  if (f.familyName && !seenFamilies.has(f.familyName)) {
                    fontList.push({ family: f.familyName, path: filePath });
                    seenFamilies.add(f.familyName);
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    fontList.sort((a, b) => a.family.localeCompare(b.family));
    return fontList;

  } catch (err) {
    console.error('[FontManager] System font scan failed:', err);
    return [];
  }
}

function sanitizeFileName(name: string): string {
  // Windows/macOS/Linuxで共通して使えない文字や、パス区切り文字を置換
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled';
}

/**
 * Geminiのチャットログ(JSON文字列)を、ChatMessage配列に変換する
 * @param jsonString Geminiのログファイルのコンテンツ
 */
function parseGeminiLog(jsonString: string): ChatMessage[] {
    const data = JSON.parse(jsonString);

    if (data.chunkedPrompt?.chunks && Array.isArray(data.chunkedPrompt.chunks)) {
        const history: ChatMessage[] = data.chunkedPrompt.chunks
            // 1. "思考"ではない、実際の会話のやり取りだけをフィルタリング
            .filter(chunk => !chunk.isThought && chunk.text)
            // 2. ChatMessage形式に変換
            .map(chunk => ({
                role: chunk.role === 'model' ? 'assistant' : 'user',
                // 3. partsではなく、完全な応答が格納されている 'text' を使う
                content: (chunk.text as string).trim()
            }));
        return history;
    } else {
        // もし、将来、さらに別の形式が現れた時のためのフォールバック
        throw new Error('Unsupported Gemini log format. Only "chunkedPrompt" format is supported.');
    }
}

// --- [エリア 3: IPCハンドラ] ---
function setupIpcHandlers(): void {

// ★ デバッグ専用のIPCハンドラを追加
ipcMain.on('debug-log', (_event, ...args) => {
  console.log('[Renderer-Debug]', ...args);
});  

  // --- ファイル操作 ---
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt', 'md'] }]});
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    addToHistory(filePath);
    buildMenu();
    const analysis = await analyzeFile(filePath);
    return { filePath, ...analysis };
  });
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      if (existsSync(filePath)) {
        return await analyzeFile(filePath);
      }
    } catch (e) { console.error(`Failed to read file: ${filePath}`, e); }
    return null;
  });

ipcMain.handle('file:saveFile', async (
  _event,
  filePath: string | null,
  content: string,
  options: { encoding: string; eol: 'LF' | 'CRLF' }
) => {
  console.log('[Main] Received save request with options:', options);

  let finalPath = filePath;

  if (!finalPath) {
    const { canceled, filePath: newFilePath } = await dialog.showSaveDialog({
      title: '名前を付けて保存',
      defaultPath: 'untitled.txt',
      filters: [
        { name: 'Text File', extensions: ['txt'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (canceled || !newFilePath) {
      return { success: false, cancelled: true };
    }
    finalPath = newFilePath;
  }
  
  // ★★★ ここからが、Atomic Saveの実装です ★★★
  const tempFilePath = `${finalPath}.${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`;

  try {
    // 表示用の文字列を、ファイルに書き込むべき本来の文字列に戻す 
    const restoredContent = content.replace(/\[FF\]/g, '\u000C');    
    // --- 1. すべての変換処理 ---
    const contentToSave = options.eol === 'CRLF' ? restoredContent.replace(/\n/g, '\r\n') : restoredContent;
    const convertedData = Encoding.convert(contentToSave, {
      from: 'UNICODE',
      to: options.encoding as Encoding.Encoding,
      type: 'buffer'
    });
    const bufferToWrite = Buffer.from(convertedData);

    // ★★★ 1.5 書き込み前に、元のファイルサイズを記憶しておく ★★★
    let originalSize = -1; // -1は「ファイルが存在しなかった」
    if (finalPath && existsSync(finalPath)) {
      try {
        originalSize = (await fsPromises.stat(finalPath)).size;
      } catch (e) { /* statに失敗しても、処理は続行 */ }
    }

    // --- 2. ★ 書き込み先を、一時ファイルに変更 ---
    await fsPromises.writeFile(tempFilePath, bufferToWrite);

    // 2.5 セーフティネット
    const newSize = (await fsPromises.stat(tempFilePath)).size;
    // もし、元のファイルが存在し(>=0)、かつ、新しいファイルが0バイトか、
    // あるいは元のサイズの半分以下に"不自然に"減少していたら...
    if (originalSize >= 0 && (newSize === 0 || newSize < originalSize * 0.5)) {
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: '保存警告',
        message: `保存後のファイルサイズが、異常に減少 (${originalSize} bytes -> ${newSize} bytes) しました。`,
        detail: 'これは、エンコーディングの変換エラーなどにより、データの一部が失われたことを示唆しています。本当にこの内容で上書き保存しますか？\n\n「いいえ」を選択して、内容を確認することを強く推奨します。',
        buttons: ['はい、上書き保存します', 'いいえ、キャンセルします'],
        defaultId: 1,
        cancelId: 1,
      });

      if (choice.response === 1) { // キャンセルが押された
        // ★ エラーをthrowするのではなく、キャンセルされたことを示すオブジェクトを返す
        //   まず一時ファイルを削除
        if (existsSync(tempFilePath)) await fsPromises.unlink(tempFilePath);
        return { success: false, cancelled: true };
      }
    }

    // --- 3. ★ 書き込みが成功したら、リネームで元のファイルを上書き ---
    await fsPromises.rename(tempFilePath, finalPath);

    // --- 4. 成功後の処理 (変更なし) ---
    addToHistory(finalPath);
    buildMenu();
    return { success: true, path: finalPath };

  } catch (e: any) {
    console.error(`Failed to save file atomically: ${finalPath}`, e);
    dialog.showErrorBox('保存失敗', `ファイルの保存中にエラーが発生しました。\n\n${e.message}`);
    
    // ★ 5. 失敗した場合、一時ファイルが残っていれば削除する後始末
    try {
      if (existsSync(tempFilePath)) {
        await fsPromises.unlink(tempFilePath);
      }
    } catch (cleanupError) {
      console.error('Failed to clean up temporary save file:', cleanupError);
    }

    return { success: false, cancelled: false, error: e.message };
  }
});

ipcMain.handle('idea:openFile', handleOpenIdeaProcessorFile);

ipcMain.handle('idea:saveFile', async (_event, filePath, saveData) => {
  let finalPath = filePath;

  // 1. ファイル選択ダイアログのフィルタを `.mrsd` に変更
  if (!finalPath) {
    const { canceled, filePath: newFilePath } = await dialog.showSaveDialog({
      title: 'アイデアプロセッサファイルを保存',
      defaultPath: 'untitled.mrsd',
      filters: [
        { name: 'MirrorShard Canvas', extensions: ['mrsd'] }, // ★ 拡張子を変更
      ]
    });
    if (canceled || !newFilePath) {
      return { success: false, cancelled: true };
    }
    finalPath = newFilePath;
  }

  const tempFilePath = `${finalPath}.${Date.now()}-${Math.random().toString(36).substring(2)}.tmp`;

  // 2. AdmZipを使って、ZIPアーカイブを生成する
  try {
    let existingCreatedAt: string | null = null;

    // ★ もし既存ファイルを上書き保存する場合...
    if (finalPath && existsSync(finalPath)) {
      try {
        const zip = new AdmZip(finalPath);
        const canvasJsonEntry = zip.getEntry('canvas.json');
        if (canvasJsonEntry) {
          const canvasData = JSON.parse(canvasJsonEntry.getData().toString('utf8'));
          // ★ 既存の作成日時を読み取って保持しておく
          if (canvasData.metadata && canvasData.metadata.createdAt) {
            existingCreatedAt = canvasData.metadata.createdAt;
          }
        }
      } catch (e) {
        // 読み込みに失敗しても、処理は続行（新しい日時が生成される）
        console.warn('既存の .mrsd ファイルの読み取りに失敗しました:', e);
      }
    }

    const zip = new AdmZip();

    // ★ 型定義を使って、canvasDataの型を明確にする
    const canvasData: {
      nodes: CanvasNode[]; // ★ ここで「CanvasNodeの配列です」と教える
      edges: CanvasEdge[];
      groups: CanvasGroup[];
      metadata: any;
    } = {
      nodes: [], // これで、この配列はCanvasNode[]型だと認識される
      edges: (saveData.links || []).map(link => ({ 
        id: link.id, // ★ `edge_...`で再生成しない
        fromNode: link.from,
        toNode: link.to,
        label: link.label,
        type: link.type,
        isTemplateItem: link.isTemplateItem || false,
      })),
      groups: (saveData.groups || []).map(group => ({
        id: group.id,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        label: group.label,
        isTemplateRoot: group.isTemplateRoot || false, // ★ isTemplateRoot を追加
      })),
      metadata: {
      createdAt: existingCreatedAt || new Date().toISOString(), // ★ 存在すれば再利用、なければ新規作成
      updatedAt: new Date().toISOString() // 更新日時も追加すると便利
      }
    };
    
    // 1. 各ノードの本文を、独立したファイルとしてZipに追加する
    // files/ フォルダ内のファイル名の重複を避けるためのセット
    const usedFileNames = new Set<string>();    
    for (const node of saveData.nodes) {

      let baseName = sanitizeFileName(node.title);
      let finalName = `${baseName}.md`;
      
      // ★ 重複チェック
      let counter = 1;
      while (usedFileNames.has(finalName)) {
        finalName = `${baseName} (${counter}).md`;
        counter++;
      }
      usedFileNames.add(finalName);

      // 本文をBufferに変換して、`files/`フォルダ内に追加
      zip.addFile(`files/${finalName}`, Buffer.from(node.contentText || '', 'utf8'));

      // 2. `canvas.json`に格納するノード情報からは、重い本文データを除く
      //    代わりに、どのファイルを参照するかという情報(`file`)を追加
      canvasData.nodes.push({
        id: node.id,
        type: 'file', // Obsidianライクなtype
        file: `files/${finalName}`, // ★ ファイルへの参照
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        title: node.title, // ★ タイトルはcanvas.jsonにも入れておくとプレビュー等で便利
        parentId: node.parentId || null,
        isTemplateItem: node.isTemplateItem || false,
        placeholder: node.placeholder || undefined,
      });
    }
    
    // 3. 全ての情報をまとめた`canvas.json`をZipに追加する
    const canvasJsonString = JSON.stringify(canvasData, null, 2);
    zip.addFile('canvas.json', Buffer.from(canvasJsonString, 'utf8'));

    // 4. ★ `writeZip`ではなく、`toBuffer()`でメモリ上にZipデータを作成
    const bufferToWrite = zip.toBuffer();



    // 6. ★ 一時ファイルに、バッファを書き込む
    await fsPromises.writeFile(tempFilePath, bufferToWrite);

    // 7. ★ リネームで、元のファイルをアトミックに上書き
    await fsPromises.rename(tempFilePath, finalPath);
    
    // 8. 成功後の処理 (ストアへの保存など)
    store.set('lastOpenedIdeaFile', finalPath);
    return { success: true, path: finalPath };

  } catch (e: any) {
    console.error(`Failed to save file atomically: ${finalPath}`, e);
    dialog.showErrorBox('保存失敗', `ファイルの保存中にエラーが発生しました。\n\n${e.message}`);
    
    try {
      if (existsSync(tempFilePath)) {
        await fsPromises.unlink(tempFilePath);
      }
    } catch (cleanupError) {
      console.error('Failed to clean up temporary save file:', cleanupError);
    }

    return { success: false, cancelled: false, error: e.message };
  }
});

  // アイデアプロセッサのエクスポート機能

  ipcMain.on('export-as-markdown', async (_event, content: string, currentPath: string | null) => {
      const path = require('path');
      
      const defaultName = currentPath
          ? path.basename(currentPath, path.extname(currentPath)) + '.md'
          : 'Untitled.md';

      const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export as Markdown',
          defaultPath: defaultName,
          filters: [{ name: 'Markdown', extensions: ['md'] }]
      });

      if (!canceled && filePath) {
          try {
              await fsPromises.writeFile(filePath, content, 'utf-8');
              shell.showItemInFolder(filePath);
          } catch (e: any) {
              dialog.showErrorBox('Export Failed', e.message);
          }
      }
  });

  ipcMain.on('send-markdown-to-editor', async (_event, content: string) => {
      try {
          // 1. 一時ファイルにマークダウンを書き出す
          const tempDir = app.getPath('temp');
          const tempFilePath = join(tempDir, `From_IP.md`);
          await fsPromises.writeFile(tempFilePath, content, 'utf-8');

          // 2. メインのエディタウィンドウを探す
          const mainWindow = BrowserWindow.getAllWindows().find(win => 
              win !== previewWindow && win !== ideaProcessorWindow // 他のサブウィンドウではない
          );

          if (mainWindow) {
              // 3. メインウィンドウに「このファイルを開け」と命令する
              mainWindow.webContents.send('open-file', tempFilePath, true);
              mainWindow.focus();
          } else {
              // メインウィンドウが見つからない場合はエラー
              dialog.showErrorBox('Error', 'Main editor window not found.');
          }
      } catch (e: any) {
          dialog.showErrorBox('Send to Editor Failed', e.message);
      }
  });  

  ipcMain.on('export-as-image', async (_event, dataUrl: string, format: 'png' | 'jpeg', currentPath: string | null) => {
      const defaultName = currentPath
          ? basename(currentPath, extname(currentPath)) + `.${format}`
          : `canvas.${format}`;

      const { canceled, filePath } = await dialog.showSaveDialog({
          title: `Export as ${format.toUpperCase()}`,
          defaultPath: defaultName,
          filters: [{ name: `${format.toUpperCase()} Image`, extensions: [format] }]
      });

      if (!canceled && filePath) {
          try {
              // Data URLから 'data:image/png;base64,' のようなヘッダ部分を取り除く
              const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
              // Base64をBufferにデコード
              const buffer = Buffer.from(base64Data, 'base64');
              // ファイルに書き込む
              await fsPromises.writeFile(filePath, buffer);
              shell.showItemInFolder(filePath);
          } catch (e: any) {
              dialog.showErrorBox('Image Export Failed', e.message);
          }
      }
  });  

  ipcMain.on('export-as-pdf', async (_event, dataUrl: string, currentPath: string | null) => {
      const defaultName = currentPath
          ? basename(currentPath, extname(currentPath)) + '.pdf'
          : 'canvas.pdf';

      const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export as PDF',
          defaultPath: defaultName,
          filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      });

      if (!canceled && filePath) {
          // 1. 非表示のウィンドウを一時的に作成
          const pdfWindow = new BrowserWindow({ show: false });
          try {
              // 2. 画像だけを表示するシンプルなHTMLをロード
              await pdfWindow.loadURL(`data:text/html,
                  <body style="margin:0;"><img src="${dataUrl}" style="width:100%;"></body>`);
              
              // 3. PDFとして印刷（A4横向き、マージンなしを推奨）
              const pdfData = await pdfWindow.webContents.printToPDF({
                  landscape: true,
                  margins: { top: 0, bottom: 0, left: 0, right: 0 } ,
                  printBackground: true,
              });

              // 4. ファイルに書き込む
              await fsPromises.writeFile(filePath, pdfData);
              shell.showItemInFolder(filePath);
          } catch (e: any) {
              dialog.showErrorBox('PDF Export Failed', e.message);
          } finally {
              // 5. 必ずウィンドウを閉じる
              pdfWindow.close();
          }
      }
  });  

ipcMain.on('export-as-html', async (_event, dataUrl: string, currentPath: string | null) => {
    // 1. デフォルトのファイル名を決定
    const defaultName = currentPath
        ? basename(currentPath, extname(currentPath)) + '.html'
        : 'canvas.html';

    // 2. 保存ダイアログを表示
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export as HTML',
        defaultPath: defaultName,
        filters: [{ name: 'HTML Document', extensions: ['html'] }]
    });

    if (!canceled && filePath) {
        // 3. テーマに応じた背景色を決定
        const isDarkMode = store.get('isDarkMode', false);
        const bgColor = isDarkMode ? '#333333' : 'antiquewhite';

        // 4. HTMLコンテンツを生成
        const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exported Canvas</title>
  <style>
    body { margin: 0; background-color: ${bgColor}; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    img { max-width: 100%; height: auto; display: block; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <img src="${dataUrl}" alt="Exported Canvas Image">
</body>
</html>`;

        // 5. ファイルに書き込み、フォルダを開く
        try {
            await fsPromises.writeFile(filePath, htmlContent, 'utf-8');
            shell.showItemInFolder(filePath);
        } catch (e: any) {
            dialog.showErrorBox('HTML Export Failed', e.message);
        }
    }
});

  ipcMain.on('add-to-history', (_event, filePath: string) => { addToHistory(filePath); buildMenu(); });
  ipcMain.on('files-dropped', (_event, filePaths: string[]) => { filePaths.forEach(openFileInWindow); });
  ipcMain.on('session-save', (_event, filePaths: string[]) => {
    store.set('sessionFilePaths', filePaths.filter((p): p is string => p !== null));
  });

  ipcMain.on('renderer-ready', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    console.log('[Main] Renderer is ready. Showing window.');
    window.show();
    window.focus();
  }
});

  // アイデアプロセッサウィンドウの位置とサイズをリセット
  ipcMain.on('reset-ip-window', () => {
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
      // 1. デフォルトのサイズに戻す
      ideaProcessorWindow.setSize(960, 720);
      // 2. 画面の中央に移動する
      ideaProcessorWindow.center();
    }
  });

  // --- ウィンドウ操作 ---
  ipcMain.on('quit-app', () => app.quit());

  ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());

  ipcMain.on('window-close', () => app.quit());

  // --- プレビューウィンドウ ---
  ipcMain.on('open-preview-window', (ipcEvent, data) => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.focus();
      return;
    }
  const parentWindow = BrowserWindow.fromWebContents(ipcEvent.sender);
  const savedBounds = store.get('previewBounds');
  const savedIsFullscreen = store.get('previewIsFullscreen', false);
  const isAlwaysOnTop = store.get('isPreviewAlwaysOnTop', true);
    if (!mainWindow || mainWindow.isDestroyed()) {
        dialog.showErrorBox('Error', 'Cannot open this window without a main window.'); 
        return;
    }  
  previewWindow = new BrowserWindow({
    ...(savedBounds || { width: 800, height: 600 }),
    minWidth: 480,
    minHeight: 320,      
    parent: isMac ? mainWindow : undefined,
    alwaysOnTop: isAlwaysOnTop,
    fullscreenable: false,
    show: false, 
    frame: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  });

  if (savedIsFullscreen) {
    previewWindow.setFullScreen(true);
  previewWindow.maximize();
}

  if (isMac){
    if(isAlwaysOnTop) {
      previewWindow.setParentWindow(mainWindow);
    } else {
      previewWindow.setParentWindow(null);
    }
  }

  previewWindow.on('ready-to-show', () => previewWindow?.show());
  previewWindow.on('close', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    // ★ フルスクリーン状態を取得して保存
    const isMaximized = previewWindow.isMaximized();
    store.set('previewIsFullscreen', isMaximized);
    // フルスクリーン状態では、正しいウィンドウサイズが取得できないことがあるので、
    // フルスクリーンでない場合のみ、サイズを保存する
    if (!isMaximized) {
      const bounds = previewWindow.getBounds();
      store.set('previewBounds', bounds);
      console.log('Preview bounds saved:', bounds);
    }
  }
  });
  previewWindow.on('closed', () => { 
    previewWindow = null; 
    if (parentWindow && !parentWindow.isDestroyed()) {
      // b. 親ウィンドウがまだ生きていることを確認してから、通知を送る
      parentWindow.webContents.send('preview-closed');
    }
  });
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (is.dev && rendererUrl) {
    previewWindow.loadURL(`${rendererUrl}/preview.html`);
  } else {
    previewWindow.loadFile(join(__dirname, '../renderer/preview.html'));
  }
  previewWindow.webContents.on('did-finish-load', () => {
    
    // 1. まず、rendererから受け取ったデフォルトのデータで初期化命令を送る
    const initialData = {
      ...data,
      isDarkMode: store.get('isDarkMode', false),
    };
    previewWindow?.webContents.send('initialize-preview', initialData);
    
    // 2. "その後"、バックグラウンドでシステムフォントのチェックと読み込みを開始
    const appliedSystemFontPath = store.get('appliedSystemFontPath') as string | undefined;
    
    if (appliedSystemFontPath && existsSync(appliedSystemFontPath)) {
      
      // ★ `await`を使わず、`.then()`で非同期チェーンを構築する
      fsPromises.readFile(appliedSystemFontPath, 'base64')
        .then(base64 => {
          // 読み込みが成功したら、
          const family = appliedSystemFontPath.split(/[\\/]/).pop()?.split('.').slice(0, -1).join('.') || 'system-font';
          const cssFontFamily = `system-font-${family.replace(/[\s]/g, '_')}`;
          const format = extname(appliedSystemFontPath).substring(1);
          
          // プレビューウィンドウに「このシステムフォントで上書きして」と、追加の命令を送る
          previewWindow?.webContents.send('apply-system-font-from-settings', {
            cssFontFamily,
            base64,
            format
          });
        })
        .catch(e => {
          console.error('Failed to load applied system font for preview in background:', e);
        });
    }
  });
      previewWindow.on('show', () => {
      parentWindow?.focus();
    });
  });
  ipcMain.on('toggle-preview-window', () => { previewWindow?.close(); });
  ipcMain.on('toggle-ip-window', () => { ideaProcessorWindow?.close(); });
  ipcMain.on('update-preview', (_event, data) => { previewWindow?.webContents.send('update-preview-content', data); });
  ipcMain.on('notify-preview-closed', (event) => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win !== BrowserWindow.fromWebContents(event.sender)) {
        win.webContents.send('preview-has-been-closed');
      }
    });
  });

  ipcMain.on('sync-scroll-position', (_event, lineNumber: number) => { previewWindow?.webContents.send('sync-scroll-position-to-preview', lineNumber); });
  ipcMain.on('preview-scroll', (_event, direction: 'top' | 'bottom') => { previewWindow?.webContents.send('scroll-to', direction); });
  ipcMain.handle('confirm-large-file-preview', async (event, fileSize) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const choice = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['プレビューする', 'キャンセル'],
      defaultId: 1,
      title: '巨大なファイル',
      message: `テキストが非常に巨大です (${fileSize}文字)。`,
      detail: `プレビューの表示に時間がかかるか、不安定になる可能性があります。\n最初の${PREVIEW_TEXT_LIMIT}文字のみでプレビューしますか？`,
      cancelId: 1,
    });
    return choice.response === 0; // 「プレビューする」が押されたらtrue
  });
  ipcMain.on('close-settings-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });
  ipcMain.on('close-export-window', () => {
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.close();
    }
  });
  ipcMain.on('close-ai-chat-window', () => {
    if (aiChatWindow && !aiChatWindow.isDestroyed()) {
      aiChatWindow.close();
      console.log("0");
    }
  });  
  ipcMain.on('write-to-clipboard', (_event, text: string) => {
    clipboard.writeText(text);
  });  

ipcMain.handle('get-pandoc-path', () => {
  // ストアからパスを取得。見つからなければ'pandoc'をデフォルト値とする。
  return store.get('pandocPath', 'pandoc');
});

ipcMain.on('set-pandoc-path', (_event, path: string) => {
  store.set('pandocPath', path);
  console.log(`[Store] Pandoc path set to: ${path}`);
});

// ★ settings.tsの<a>タグから呼ばれる、外部リンクを開くための安全なハンドラ
ipcMain.on('open-external-link', (_event, url: string) => {
  // URLがhttpまたはhttpsで始まることを検証してから開くのが、より安全
  if (url.startsWith('http:') || url.startsWith('https:')) {
    shell.openExternal(url);
  }
});

ipcMain.handle('select-file-dialog', async (_event, options) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    ...options
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('get-target-file-path', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return (window as any).targetFilePath || null;
});

ipcMain.handle('get-custom-paths', () => {
  return {
    background: store.get('customBackgroundPath'),
    bgm: store.get('customBgmPath'),
  };
});

ipcMain.on('set-custom-path', (_event, { type, path }: { type: 'background' | 'bgm', path: string | null }) => {
  if (type === 'background') {
    store.set('customBackgroundPath', path);
    console.log(`[Store] Custom background path set to: ${path}`);
  } else if (type === 'bgm') {
    store.set('customBgmPath', path);
    console.log(`[Store] Custom BGM path set to: ${path}`);
  }
});

ipcMain.handle('get-background-data-url', async (_event, filePath: string | null) => {
  const lookup = getLookup();
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const buffer = await fsPromises.readFile(filePath);
    const base64 = buffer.toString('base64');
    const mimeType = lookup(filePath) || 'application/octet-stream';
    return `data:${mimeType};base64,${base64}`;
  } catch (e) { return null; }
});

ipcMain.handle('get-bgm-data-url', async (_event, filePath: string | null) => {
  const lookup = getLookup();
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const buffer = await fsPromises.readFile(filePath);
    const base64 = buffer.toString('base64');
    const mimeType = lookup(filePath) || 'audio/mpeg';
    return `data:${mimeType};base64,${base64}`;
  } catch (e) {
    console.error(`Failed to generate data URL for BGM: ${filePath}`, e);
    return null;
  }
});


ipcMain.on('interop-message', (_event, message) => {
  const mainWindow = BrowserWindow.getAllWindows().find(win => win.isVisible() && win !== settingsWindow && win !== previewWindow && win !== shortcutWindow);
    // settings -> main -> renderer のように中継
  if (mainWindow) {
    mainWindow.webContents.send('main-interop-message', message);
    console.log(`[Interop] Forwarded message from settings to main window:`, message);
  }
});

ipcMain.on('open-ai-chat-window', createAiChatWindow);

ipcMain.on('open-export-window', (_event, filePath: string) => {
  if (exportWindow && !exportWindow.isDestroyed()) {
    exportWindow.close();   
    return;
  }  
  const mainWindow = BrowserWindow.getFocusedWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
        dialog.showErrorBox('Error', 'Cannot open this window without a main window.'); 
        return;
    }
  exportWindow = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 520,
    minHeight: 700,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'), // 共通のpreloadを使う
      sandbox: false,
    }
  });

      exportWindow.on('close', (event) => {
        // もし、エクスポート中なら、閉じるのをキャンセル
        if (isExporting) {
          event.preventDefault();
          dialog.showMessageBox(exportWindow!, {
            type: 'warning',
            title: '処理中です',
            message: 'エクスポート処理の実行中です。'
          });
        }
      });

      exportWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') {
            exportWindow?.close();
            event.preventDefault();
        }
    });

  // ★ ウィンドウ自身に、対象のファイルパスを記憶させる
  (exportWindow as any).targetFilePath = filePath;
  
  // URLをロード
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (is.dev && rendererUrl) {
    exportWindow.loadURL(`${rendererUrl}/export.html`);
  } else {
    exportWindow.loadFile(join(__dirname, '../renderer/export.html'));
  }

  exportWindow.on('ready-to-show', () => {
    exportWindow?.show();
  });
  
  exportWindow.on('closed', () => {
    exportWindow = null;
  });
});

ipcMain.on('set-export-busy-state', (_event, isBusy: boolean) => {
  isExporting = isBusy;
  console.log(`[Main] Export busy state set to: ${isBusy}`);
});  

// ★★★ Pandoc実行ハンドラ ★★★
ipcMain.handle('run-export', async (_event, options: ExportOptions) => {
  const execPromise = getExecPromise();
  isExporting = true;
  const {
    sourceFilePath,
    encoding,
    title,
    author,
    coverImagePath,
    isVertical,
    useRubyFilter,
    format
  } = options;

  // --- [ステップ 1: Pandocの存在チェック & 保存先の決定] ---
  let pandocPath = store.get('pandocPath', 'pandoc');
  let isPandocFound = false;
  try {
    await execPromise(`"${pandocPath}" --version`);
    isPandocFound = true;
  } catch {
    const defaultPaths: string[] = [];
    const platform = os.platform();
    if (platform === 'win32') {
      defaultPaths.push(join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Pandoc', 'pandoc.exe'));
      defaultPaths.push(join(process.env['LOCALAPPDATA'] || '', 'Pandoc', 'pandoc.exe')); // ★ ローカルインストール先
    } else if (platform === 'darwin') {
      defaultPaths.push('/usr/local/bin/pandoc');
    } else { // Linux
      defaultPaths.push('/usr/bin/pandoc');
    }

    for (const p of defaultPaths) {
      if (existsSync(p)) {
        pandocPath = p;
        isPandocFound = true;
        store.set('pandocPath', pandocPath);
        break;
      }
    }
  }

  if (!isPandocFound) {
    dialog.showErrorBox('Pandoc Not Found', 'Pandocが見つかりません。「高度な設定」でパスを指定してください。');
    return { success: false, error: 'Pandoc not found' };
  }  

  const { canceled, filePath: outputPath } = await dialog.showSaveDialog({
    title: `Export as ${format.toUpperCase()}`,
    defaultPath: `${basename(sourceFilePath, extname(sourceFilePath))}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (canceled || !outputPath) return { success: false, error: 'Cancelled' };

  // --- [ステップ 2: Markdownの前処理 (全フォーマット共通)] ---
  const tempDir = app.getPath('temp');
  const tempMdPath = join(tempDir, 'processed.md');
  try {
    // --- [ステップ 1: 正しいエンコーディングでファイルを読み込み、UTF-8に変換] ---
    // a) まず、ファイルをバイナリ(Buffer)として読み込む
    const buffer = await fsPromises.readFile(sourceFilePath);
    
    // b) rendererから渡された、"正しい"エンコーディング情報を使って、UNICODE(JS内部文字列)にデコード
    const decodedMarkdown = Encoding.convert(buffer, {
      to: 'UNICODE',
      from: encoding as Encoding.Encoding, // rendererがanalyzeFileで特定したエンコーディング
      type: 'string'
    });

    // --- [ステップ 2: JavaScriptで、完璧な前処理を行う] ---
    // a) 改行処理
    let processedText = decodedMarkdown.replace(/(?<!\n)\n(?!\n)/g, '  \n');
    if (useRubyFilter) {
      processedText = processedText.replace(/｜([^《]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
      const kanjiRange = '\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3400-\\u4DBF';
      const kanjiRubyRegex = new RegExp(`([^｜|])([${kanjiRange}]+)《([^》\\n]+?)》`, 'gu');
      processedText = processedText.replace(kanjiRubyRegex, '$1<ruby>$2<rt>$3</rt></ruby>');
    }
    // c) 処理後のテキストを、Pandocが最も得意なUTF-8として、一時ファイルに書き込む
    await fsPromises.writeFile(tempMdPath, processedText, 'utf-8');

    // --- [ステップ 2: Pandocで、単一の巨大なHTMLを生成] ---
    const tempHtmlPath = join(tempDir, 'print_version.html');
    let command = `"${pandocPath}" "${tempMdPath}" -f markdown-yaml_metadata_block+raw_html -o "${tempHtmlPath}" --standalone --embed-resources`;
    command += ` --metadata lang=ja-JP`;
    
    // a) メタデータを追加
    if (title) command += ` --metadata title="${title}"`;
    if (author) command += ` --metadata author="${author}"`;
    
    // b) 向きに応じたCSSと、Notoフォントを埋め込むヘッダーを追加
    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const cssFileName = isVertical ? 'vertical.css' : 'horizontal.css';
    const cssPath = join(resourcesPath, 'resources', 'styles', cssFileName);
    if (existsSync(cssPath)) {
      command += ` --css="${cssPath}"`;
    }

    const fontFileName = 'NotoSerifJP-VariableFont_wght.ttf';
    const fontPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'fonts', fontFileName);
    if (existsSync(fontPath)) {
        const fontData = await fsPromises.readFile(fontPath, 'base64');
        const fontFaceCss = `<style>@font-face { font-family: "Noto Serif JP"; src: url("data:font/ttf;base64,${fontData}"); }</style>`;
        const tempHeaderPath = join(tempDir, 'header.html');
        await fsPromises.writeFile(tempHeaderPath, fontFaceCss);
        command += ` --include-in-header="${tempHeaderPath}"`;
    }

    await execPromise(command);
    
    // --- [ステップ 3: 生成されたHTMLを、最終フォーマットに変換] ---
    if (format === 'html') {
      await fsPromises.copyFile(tempHtmlPath, outputPath);
    } else if (format === 'pdf') {
      const printWindow = new BrowserWindow({ show: false });
      try {
        await printWindow.loadFile(tempHtmlPath);
        const pdfData = await printWindow.webContents.printToPDF({ printBackground: true });
        await fsPromises.writeFile(outputPath, pdfData);
      } finally {
        printWindow.close();
      }
    } else if (format === 'epub') {
        // EPUBの場合は、Pandocで直接生成する方が高品質
        let epubCommand = `"${pandocPath}" "${tempMdPath}" -f markdown+raw_html -o "${outputPath}" --standalone`;
        epubCommand += ` --metadata lang=ja-JP`;
      // メタデータ、表紙、縦書きCSSなどを追加
      if (title) epubCommand += ` --metadata title="${title}"`;
      if (author) epubCommand += ` --metadata author="${author}"`;
      if (coverImagePath) epubCommand += ` --epub-cover-image="${coverImagePath}"`;
      if (isVertical) {
        const cssPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'styles', 'epubvertical.css');
        if (existsSync(cssPath)) epubCommand += ` --css="${cssPath}"`;
        epubCommand += ` --metadata "page-progression-direction:rtl"`;
      }
      
      console.log(`[Export] Executing Pandoc for EPUB: ${epubCommand}`);
        await execPromise(epubCommand);
    }
    
    shell.showItemInFolder(outputPath);
    return { success: true };

  } catch (e: any) {
    dialog.showErrorBox('エクスポート失敗', `処理中にエラーが発生しました。\n\n${e.stderr || e.message}`);
    return { success: false, error: e.stderr || e.message };
  }finally {
    isExporting = false; 
  }
});

ipcMain.handle('analyze-source-file', async (_event, filePath: string) => {
  try {
    // ★ 既存の、完璧なanalyzeFile関数を再利用する
    const { content, ...meta } = await analyzeFile(filePath);
    return meta; // contentは不要なので、encodingとeolだけを返す
  } catch (e) {
    return null;
  }
});

  // --- 設定 (ストア) ---
  ipcMain.handle('get-font-size', () => store.get('fontsize', 16));
  ipcMain.on('set-font-size', (_event, size: number) => store.set('fontsize', size));
  ipcMain.handle('get-font-index', () => store.get('fontIndex', 0));
  ipcMain.on('set-font-index', (_event, index: number) => store.set('fontIndex', index));
  // 保存された背景インデックスを取得/保存
  ipcMain.handle('get-bg-index', () => store.get('bgIndex', 0));
  ipcMain.on('set-bg-index', (_event, index: number) => store.set('bgIndex', index));
  // bgm
  ipcMain.handle('get-bgm-index', () => store.get('bgmIndex', -1));
  ipcMain.on('set-bgm-index', (_event, index) => store.set('bgmIndex', index));
  ipcMain.handle('get-bgm-paused-state', () => store.get('isbgmPaused', true));
  ipcMain.on('set-bgm-paused-state', (_event, isPaused) => store.set('isbgmPaused', isPaused));
  // タイプ音
  ipcMain.handle('get-typesound-state', () => store.get('isTypeSoundEnabled', true));
  ipcMain.on('set-typesound-state', (_event, isEnabled) => store.set('isTypeSoundEnabled', isEnabled));  
  // ダークモード 
  ipcMain.handle('get-dark-mode-state', () => store.get('isDarkMode', false));
  ipcMain.on('set-dark-mode-state', (_event, isEnabled: boolean) => store.set('isDarkMode', isEnabled));
  // フォーカスモード
  ipcMain.handle('get-focus-mode-state', () => store.get('isFocusMode', false));
  ipcMain.on('set-focus-mode-state', (_event, isEnabled: boolean) => store.set('isFocusMode', isEnabled));  
  ipcMain.handle('get-zen-mode-state', () => store.get('isZenMode', false));
  ipcMain.on('set-zen-mode-state', (_event, isEnabled: boolean) => {
    store.set('isZenMode', isEnabled);
  });   
  ipcMain.handle('get-snow-state', () => store.get('isSnowing', false));
  ipcMain.on('set-snow-state', (_event, isEnabled: boolean) => store.set('isSnowing', isEnabled));     
  
  // --- リソースリスト取得 ---
  ipcMain.handle('get-font-list', async () => {
    console.log('ipcMain: 同梱フォントのスキャンを開始');
    try {
      const targetPath = join(app.getPath('userData'), 'resources',  'fonts');
      
      if (!existsSync(targetPath)) {
        console.warn(`[get-font-list] フォントディレクトリが見つかりません: ${targetPath}`);
        return [];
      }
      const files = await fsPromises.readdir(targetPath);
      const fontFiles = files.filter(f => /\.(ttf|otf|ttc)$/i.test(f)).sort();
      
      console.log(`ipcMain: ${fontFiles.length}個の同梱フォントを発見`);
      return fontFiles; // ★★★ 文字列の配列を返す ★★★

    } catch (e) {
      console.error('ipcMain: 同梱フォントのスキャンに失敗:', e);
      return []; 
    }
  });

  ipcMain.handle('scan-system-fonts', async (_event, forceRescan: boolean = false) => {

    // 1. キャッシュを優先して読み込む
    if (!forceRescan && existsSync(fontCachePath)) {
      try {
        console.log('[FontManager] Loading fonts from cache...');
        const cacheData = await fsPromises.readFile(fontCachePath, 'utf-8');
        return JSON.parse(cacheData);
      } catch (e) {
        console.error('Failed to read font cache, rescanning.', e);
      }
    }

    // 2. キャッシュがないか、強制再スキャンなら、スキャンを実行
    const fontList = await scanSystemFontsInternal();
    
    // 3. スキャン結果をキャッシュに書き込む
    try {
      await fsPromises.writeFile(fontCachePath, JSON.stringify(fontList));
    } catch (e) {
      console.error('Failed to write font cache.', e);
    }
    
    return fontList;
  });

  // 指定されたフォントパスのデータを、Base64で返す
  ipcMain.handle('get-font-base64', async (_event, filePath: string) => {
    try {
      if (existsSync(filePath)) {
        const buffer = await fsPromises.readFile(filePath);
        return buffer.toString('base64');
      }
    } catch (e) {
      console.error(`Failed to read font file for Base64 conversion: ${filePath}`, e);
    }
    return null;
  });

ipcMain.on('apply-font-to-main-window', (_event, fontData) => {
  BrowserWindow.getAllWindows().forEach(win => {
    // 設定ウィンドウ自身は除く
    if (win !== settingsWindow) {
      win.webContents.send('apply-system-font-from-settings', fontData);
    }
  });
});

ipcMain.on('apply-system-font', (_event, font: { path: string; family: string }) => {

  // ★ メインウィンドウに、Base64とCSSファミリー名だけでなく、元のパスも送る
  BrowserWindow.getAllWindows().forEach(win => {
    if (win !== settingsWindow /* ... */) {
      // getFontBase64をここで呼び出して、データを組み立てる
      fsPromises.readFile(font.path, 'base64').then(base64 => {
        const cssFontFamily = `system-font-${font.family.replace(/[\s]/g, '_')}`;
        const format = extname(font.path).substring(1);
        
        win.webContents.send('apply-system-font-from-settings', { 
          path: font.path, // ★ 元のパス
          cssFontFamily, 
          base64, 
          format 
        });
      }).catch(e => console.error('Failed to read font for main window:', e));
    }
  });
});

  ipcMain.handle('get-applied-system-font-path', () => {
    return store.get('appliedSystemFontPath');
  });
  ipcMain.handle('set-applied-system-font-path', async (_event, filePath: string | null) => {
      store.set('appliedSystemFontPath', filePath);
  });

  // ★ サイクルフォントのインデックスをクリアするハンドラも追加
  ipcMain.on('clear-font-index', () => {
      store.set('fontIndex', 0); // または-1など、初期値にリセット
  });  

  ipcMain.on('toggle-settings-window', toggleSettingsWindow);
  ipcMain.on('toggle-IP-window', createIdeaProcessorWindow);
  
  ipcMain.handle('get-bg-list', async () => {
    try {
      const targetPath = join(userDataPath, 'resources', 'background');
      
      if (!existsSync(targetPath)) return [];
      const files = await fsPromises.readdir(targetPath);
      return files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).sort();
    } catch (e) { return []; }
  });
  ipcMain.handle('get-bgm-list', async () => {
    try {
      const bgmList: string[] = [];
      const seenFiles = new Set<string>(); // 重複を防ぐためのセット

      // --- 1. デフォルトBGM（bgm.dat）をスキャン ---
      const archivePath = join(app.getPath('userData'), 'resources', 'bgm', 'bgm.dat');
      if (existsSync(archivePath)) {
        try {
          const zip = new AdmZip(archivePath);
          const zipEntries = zip.getEntries();
          zipEntries.forEach(entry => {
            if (!entry.isDirectory && !seenFiles.has(entry.entryName)) {
              bgmList.push(entry.entryName);
              seenFiles.add(entry.entryName);
            }
          });
        } catch (e) {
          console.error('Failed to read bgm.dat archive:', e);
        }
      }

      // --- 2. ユーザー追加BGM（bgmフォルダ）をスキャン ---
      const userBgmPath = join(app.getPath('userData'), 'resources', 'bgm');
      if (existsSync(userBgmPath)) {
        try {
          const userFiles = await fsPromises.readdir(userBgmPath);
          userFiles.forEach(file => {
            if (/\.(mp3|ogg|wav|m4a)$/i.test(file) && !seenFiles.has(file)) {
              bgmList.push(file);
              seenFiles.add(file);
            }
          });
        } catch (e) {
          console.error('Failed to read user bgm directory:', e);
        }
      }

      // --- 3. マージした結果をソートして返す ---
      return bgmList.sort();

    } catch (e) {
      console.error('Failed to get BGM list:', e);
      return [];
    }
  });
  ipcMain.handle('confirm-close-tab', async (event, fileName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const choice = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['変更を破棄して閉じる', 'キャンセル'],
      defaultId: 1,
      title: '未保存の変更',
      message: `ファイル "${fileName}" の変更を保存しますか？`,
      detail: '保存しない場合、変更は失われます。',
      cancelId: 1,
    });
    return choice.response === 0; // 「破棄して閉じる」が押された場合のみtrue
  });  
  ipcMain.handle('get-bgm-buffer', async (_event, fileName: string) => {
    try {
      // あなたの既存のBGMファイル検索ロジックをここに
      const userBgmFilePath = join(app.getPath('userData'), 'resources', 'bgm', fileName);
      if (existsSync(userBgmFilePath)) {
        return await fsPromises.readFile(userBgmFilePath);
      }
      const archivePath = join(app.getPath('userData'), 'resources', 'bgm', 'bgm.dat');
      if (existsSync(archivePath)) {
        const zip = new AdmZip(archivePath);
        const zipEntry = zip.getEntry(fileName);
        if (zipEntry) return zipEntry.getData();
      }
    } catch (e) { console.error(`Failed to get BGM buffer for ${fileName}:`, e); }
    return null;
  });  
  ipcMain.on('open-resources-folder', () => {
    const resourcesPath = join(app.getPath('userData'), 'resources');
    // フォルダが存在することを念のため確認
    if (existsSync(resourcesPath)) {
      // OSの標準ファイラーで、指定したパスを開く
      shell.openPath(resourcesPath);
    } else {
      dialog.showErrorBox('エラー', '素材フォルダが見つかりませんでした。');
    }
  });

  ipcMain.on('mouse-nav', (_event, direction: 'next' | 'previous') => {
  console.log(`[Main] Mouse navigation request received: ${direction}`);
  // 現在フォーカスされているウィンドウに、'cycle-tab'命令を送信する
  BrowserWindow.getFocusedWindow()?.webContents.send('cycle-tab', direction);
});
  
  // --- 右クリックメニュー ---
  ipcMain.handle('get-recent-files', async () => {
    const history = loadHistory(); 
    // basenameとpathの両方を送る
    return history.map(p => ({ path: p, basename: basename(p) }));
  });
  ipcMain.on('show-context-menu-from-blueprint', (event, blueprint) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    // 受け取った設計図を、実行可能なメニューテンプレートに変換する関数
    const buildTemplateFromBlueprint = (items) => {
      return items.map(item => {
        // サブメニューがあれば、再帰的に処理
        if (item.submenu) {
          return { ...item, submenu: buildTemplateFromBlueprint(item.submenu) };
        }

        // 識別子(id)に応じて、clickハンドラを割り当てる
        switch (item.id) {
          case 'open-recent':
              return { ...item, click: () => {
                addToHistory(item.path); // ★ ここでも履歴に追加
                buildMenu();
                senderWindow.webContents.send('open-file', item.path);
              }};
          case 'open-file':
            return { ...item, click: () => senderWindow.webContents.send('trigger-open-file') };
          case 'import-scrivener':
            return { ...item, click: () => senderWindow.webContents.send('context-menu-command', 'import-scrivener') };
          case 'import-gemini-log':
            return { ...item, click: () => senderWindow.webContents.send('trigger-import-gemini-log') };                      
          case 'save-file':
            return { ...item, click: () => senderWindow.webContents.send('trigger-save-file') };
          case 'save-as-file':
            return { ...item, click: () => senderWindow.webContents.send('trigger-save-as-file') };           
          case 'undo':
            return { ...item, role: 'undo' };
          case 'cut':
            return { ...item, role: 'cut' };
          case 'copy':
            return { ...item, role: 'copy' };
          case 'paste':
            return { ...item, role: 'paste' };
          case 'select-all':
            return { ...item, role: 'selectAll' };
          case 'ai-chat-clear':
            return { ...item, click: () => senderWindow.webContents.send('trigger-ai-chat-clear') };
          case 'ai-chat-load':
            return { ...item, click: () => senderWindow.webContents.send('trigger-ai-chat-load') };
          case 'ai-chat-save':
            return { ...item, click: () => senderWindow.webContents.send('trigger-ai-chat-save') };
          case 'ai-chat-to-editor':
            return { ...item, click: () => senderWindow.webContents.send('trigger-ai-chat-to-editor') };            
          case 'ai-chat-close':
            return { ...item, click: () => {
              if (aiChatWindow && !aiChatWindow.isDestroyed()) {
                aiChatWindow.close();
              }
            }};            
          default:
            return item; // clickハンドラが付かない項目（separatorなど）
        }
      });
    };
    
    const finalTemplate = buildTemplateFromBlueprint(blueprint);
    const menu = Menu.buildFromTemplate(finalTemplate);
    menu.popup({ window: senderWindow });
  });

  // --- テーマ & フォントのブロードキャスト ---
  ipcMain.on('toggle-dark-mode', () => {
    const newIsDarkMode = !store.get('isDarkMode', false);
    store.set('isDarkMode', newIsDarkMode);
    nativeTheme.themeSource = newIsDarkMode ? 'dark' : 'light';
    BrowserWindow.getAllWindows().forEach(win => win.webContents.send('theme-updated', newIsDarkMode));
  });
  ipcMain.on('update-preview-font', (_event, fontName: string) => { previewWindow?.webContents.send('preview-font-change', fontName); });
  ipcMain.on('update-preview-font-size', (_event, size: number) => { previewWindow?.webContents.send('preview-font-size-change', size); });
// ★ プレビューからのフォントサイズ変更要求をハンドル
ipcMain.on('request-font-size-change', (_event, action) => {
  console.log(`[Main] Font size change requested: ${action}`);
  // ★ 既存のメニューと同じ号令を、全ウィンドウに送る
  // BrowserWindow.getAllWindows().forEach(win => {
  //   win.webContents.send('change-font-size', action);
  // });
  // 1. 現在開いている、可能性のあるすべてのウィンドウへの参照を取得
  const windowsToUpdate = [
    mainWindow, 
    previewWindow, 
    ideaProcessorWindow, 
    aiChatWindow
  ];

  // 2. 存在する、そして破壊されていないウィンドウだけに、確実にメッセージを送る
  windowsToUpdate.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('change-font-size', action);
    }
  });  
});
// ★ プレビューからのフォントサイクル要求をハンドル
ipcMain.on('request-font-cycle', () => {
  console.log('[Main] Font cycle requested.');
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('trigger-font-cycle');
  });
});
ipcMain.on('request-bgm-cycle', () => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('trigger-bgm-cycle');
  });
});
ipcMain.on('request-bgm-play-pause', () => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('trigger-bgm-play-pause');
  });
});

ipcMain.on('show-encoding-warning', (event, message: string) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    dialog.showMessageBox(window, {
      type: 'warning',
      title: 'エンコード警告',
      message: message
    });
  }
});

ipcMain.handle('confirm-save-with-encoding-warning', async (event, fileName: string) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const choice = await dialog.showMessageBox(window!, {
    type: 'warning',
    buttons: ['このまま保存', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    title: '保存の確認',
    message: `ファイル "${fileName}" は、読み込み時にエンコードの問題が検出されました。`,
    detail: 'このままUTF-8として保存すると、元のファイル形式が失われたり、文字化けした部分がそのまま保存される可能性があります。本当に保存しますか？',
  });
  return choice.response === 0; // 「このまま保存」が押されたらtrue
});

  // --- マウス & タブサイクル ---
  // (createWindow内の app-command で処理されるので、ここでは不要)

  // --- 降雪エフェクト ---
  ipcMain.on('toggle-preview-snow', () => { previewWindow?.webContents.send('trigger-snow-toggle'); });


ipcMain.handle('idea:openFileByPath', async (event, filePath: string) => {
  await resetIPHistory();
  await fsPromises.rm(autoSaveDir, { recursive: true, force: true }).catch(() => {});
  const data = await parseMrsdFile(filePath);
  if (data) {
    event.sender.send('load-data', { filePath, data });
  } 
  else {
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
      _createNewUntitledFile(ideaProcessorWindow.webContents);
    } 
  }
  return { success: true };
});

ipcMain.handle('import-from-scrivener', async (_event) => {
    // 1. ユーザーに .scriv プロジェクトフォルダを選択させる
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Scrivener Project Folder',
        properties: ['openDirectory']
    });
    if (canceled || filePaths.length === 0) return null;
    
    const projectPath = filePaths[0];
    const projectName = basename(projectPath, '.scriv');
    const scrivxPath = join(projectPath, `${projectName}.scrivx`);
    const searchIndexesPath = join(projectPath, 'Files', 'search.indexes');

    if (!existsSync(scrivxPath) || !existsSync(searchIndexesPath)) {
        dialog.showErrorBox('Invalid Project', '.scrivx or search.indexes file not found.');
        return null;
    }

    try {
        // 2. XMLファイルを読み込み、パースする
        const convert = require('xml-js');
        const scrivxXml = await fsPromises.readFile(scrivxPath, 'utf-8');
        const searchXml = await fsPromises.readFile(searchIndexesPath, 'utf-8');

        const scrivxJs = convert.xml2js(scrivxXml, { compact: true });
        const searchJs = convert.xml2js(searchXml, { compact: true });
        
        // 3. search.indexes の内容を、IDをキーにしたMapに変換して高速化
        const contentMap = new Map<string, { title: string, synopsis?: string, text?: string }>();
        const documents = searchJs.SearchIndexes?.Documents?.Document;
        if (documents) {
            (Array.isArray(documents) ? documents : [documents]).forEach(doc => {
                if (doc?._attributes?.ID) {
                    contentMap.set(doc._attributes.ID, {
                        title: doc.Title?._text || '',
                        synopsis: doc.Synopsis?._text,
                        text: doc.Text?._text
                    });
                }
            });
        }
        console.log("search.indexes loaded.");

        // 4. scrivx の階層を再帰的にたどり、マークダウンを生成
        let markdownContent = '';
        const traverseBinder = (item: any, level: number) => {
          if (!item?._attributes?.UUID) return;
            const uuid = item._attributes.UUID;
            const itemContent = contentMap.get(uuid);
            const title = item.Title?._text || itemContent?.title || 'Untitled';
            
            // ゴミ箱やリサーチフォルダは無視
            if (item._attributes.Type === 'TrashFolder' || item._attributes.Type === 'ResearchFolder') {
                return;
            }

            markdownContent += `${'#'.repeat(level)} ${title}\n\n`;

            if (itemContent) {
                if (itemContent.synopsis) {
                    markdownContent += `Synopsis: ${itemContent.synopsis}\n\n`;
                }
                if (itemContent.text) {
                    markdownContent += `${itemContent.text}\n\n`;
                }
            }

            // 子要素があれば、再帰的に処理
            if (item.Children?.BinderItem) {
                const children = item.Children.BinderItem;
                (Array.isArray(children) ? children : [children]).forEach(child => {
                    traverseBinder(child, level + 1);
                });
            }
        };

        const rootItems = scrivxJs.ScrivenerProject?.Binder?.BinderItem;
        if (rootItems) {
            (Array.isArray(rootItems) ? rootItems : [rootItems]).forEach(item => {
                traverseBinder(item, 1);
            });
        }

        // 5. 生成したマークダウンを renderer に返す
        return { title: projectName, content: markdownContent };

    } catch (e: any) {
        dialog.showErrorBox('Import Failed', e.message);
        throw new Error(e.message);
    }
});

ipcMain.handle('check-for-unsaved-changes', (event) => {
    // このメッセージを送ってきたrendererに、逆質問する
    const webContents = event.sender;
    
    // rendererからの応答を待つためのPromise
    return new Promise(resolve => {
        // 一度だけ応答を待つリスナー
        ipcMain.once('response-unsaved-changes', (_e, hasChanges: boolean) => {
            resolve(hasChanges);
        });
        // rendererに応答を要求
        webContents.send('request-unsaved-changes-check');
    });
});

ipcMain.handle('confirm-save-dialog', async (event, windowName: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return 'cancel';

    const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        buttons: ['保存する', '変更を破棄', 'キャンセル'],
        defaultId: 0,
        cancelId: 2,
        title: '未保存の変更',
        message: `${windowName} に保存されていない変更があります。`,
    });

    if (response === 0) return 'save';
    if (response === 1) return 'discard';
    return 'cancel';
});

ipcMain.handle('toggle-ip-always-on-top', () => {
  if (!ideaProcessorWindow || !mainWindow || ideaProcessorWindow.isDestroyed()) {
    return store.get('isIpAlwaysOnTop', true);
  }
  
  const currentState = store.get('isIpAlwaysOnTop', true);
  const newState = !currentState;

  if (isMac) {
    // --- macOS用の、最も確実な実装 ---
    if (newState) {
      ideaProcessorWindow.setAlwaysOnTop(true, 'normal');
      ideaProcessorWindow.setParentWindow(mainWindow);
      ideaProcessorWindow.focus(); // 念のためフォーカス
    } else {
      ideaProcessorWindow.setParentWindow(null);
      ideaProcessorWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
  } else {
    // --- Windows/Linux用の、フリッカーのない、最もシンプルな実装 ---
    ideaProcessorWindow.setAlwaysOnTop(newState, 'normal');
  }

  store.set('isIpAlwaysOnTop', newState);
  return newState;
});

ipcMain.handle('toggle-preview-always-on-top', () => {
  if (!previewWindow || !mainWindow || previewWindow.isDestroyed()) {
    return store.get('isPreviewAlwaysOnTop', true);
  }
  const currentState = store.get('isPreviewAlwaysOnTop', true);
  const newState = !currentState;
  
  if (isMac) {
    if (newState) {
      previewWindow.setAlwaysOnTop(true, 'normal');
      previewWindow.setParentWindow(mainWindow);
      previewWindow.focus(); 
    } else {
      previewWindow.setParentWindow(null);
      previewWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
  } else {
    previewWindow.setAlwaysOnTop(newState, 'normal');
  }

  store.set('isPreviewAlwaysOnTop', newState);
  return newState;
});

ipcMain.on('request-toggle-fullscreen', (event) => {
  // ★ このイベントを送ってきたウィンドウを取得
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return;

  // ★★★ メニューのclickハンドラと、全く同じロジックを実行 ★★★
  if (senderWindow === ideaProcessorWindow || senderWindow === previewWindow) {
      // --- サブウィンドウの処理 (最大化) ---
      if (!senderWindow.isMaximized()) {
          // 保存してから最大化
          if (senderWindow === ideaProcessorWindow) {
              store.set('ideaProcessorWindow.bounds', senderWindow.getBounds());
          } else if (senderWindow === previewWindow) {
              store.set('previewBounds', senderWindow.getBounds());
          }
          senderWindow.maximize();
      } else {
          senderWindow.unmaximize();
      }
  } 
  else { // メインウィンドウの場合
      // --- メインウィンドウの処理 (フルスクリーン) ---
      const isCurrentlyFullscreen = senderWindow.isFullScreen();
      if (!isCurrentlyFullscreen) {
          store.set('windowBounds', senderWindow.getBounds());
      }        
      senderWindow.setFullScreen(!isCurrentlyFullscreen);
  }
});

ipcMain.handle('request-gemini-response', async (_event, apiKey: string, history: any[], newMessage: string) => {
    try {
      const { GoogleGenerativeAI } = require("@google/generative-ai"); 
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" }); 

        const chat = model.startChat({
            history: history.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                //partsは配列である必要があるので、この形がより安全
                parts: [{ text: msg.content }] 
            }))
        });
        
        // sendMessageに渡すのは、文字列だけでOK
        const result = await chat.sendMessage(newMessage);
        const response = result.response;
        const text = response.text();
        const maxLength = store.get('aiResponseMaxLength', 2000);
        const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        return { success: true, text: truncatedText };
        
    } catch (error) {
        let errorMessage = "An unknown error occurred.";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        console.error("Gemini API Error:", errorMessage);
        return { success: false, error: errorMessage };
    }
});

ipcMain.handle('request-lm-studio-response', async (_event, history: ChatMessage[]) => {
  try {
    const fetch = require('node-fetch');
    // 1. ストアから、「1アイデアあたりの目標文字数」を読み込む
    const charLimitPerIdea = store.get('cotCharLimit', 30);    
    // 2. 3つのアイデアの「合計の目標文字数」を計算する
    const totalCharLimit = charLimitPerIdea * 3;    
    // 3. 合計文字数を、AIが理解できる「合計トークン数」に換算する
    const maxTokens = Math.ceil(totalCharLimit * 1.5);
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        temperature: 0.7,
        stream: false,
        max_tokens: maxTokens
      })
    });
    if (!response.ok) throw new Error(`[${response.status}] ${response.statusText}`);
    
    // ★ as LmStudioResponse で、TypeScriptに「データの形」を教える
    const data = await response.json() as LmStudioResponse;
    
    // ★ オプショナルチェイニングで、安全にデータにアクセスする
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        const maxLength = store.get('aiResponseMaxLength', 2000);
        const truncatedText = content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
        return { success: true, text: truncatedText };
    } else {
        throw new Error('Unexpected response structure from LM Studio.');
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

  // ★ infoレベルの、シンプルなメッセージボックスを表示するためのハンドラ
  ipcMain.on('show-info-dialog', (event, message: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Information',
        message: message,
      });
    }
  });

// --- ハンドラ1: ログの保存 ---
ipcMain.on('save-ai-chat-log', async (_event, history: ChatMessage[]) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Chat Log As...',
        defaultPath: 'chat-log.json',
        filters: [{ name: 'Pastel Chat Log', extensions: ['json'] }]
    });
    if (canceled || !filePath) return;

    const dataToSave = {
        name: "AI", // (あるいは、ストアから読み込んだアシスタント名)
        createdAt: Date.now(),
        // worldSettings: { ... },
        messages: history.map(msg => ({
            currentlySelected: 0,
            versions: [{
                role: msg.role,
                type: msg.role === 'user' ? 'singleStep' : 'multiStep',
                content: msg.role === 'user' ? [{ type: 'text', text: msg.content }] : null,
                steps: msg.role === 'assistant' 
                    ? [{ type: 'contentBlock', content: [{ type: 'text', text: msg.content }] }] 
                    : null,
            }]
        }))
    };
    await fsPromises.writeFile(filePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
    store.set('lastAiChatSessionPath', filePath);
});

// 上書き保存
ipcMain.on('save-ai-chat-log-overwrite', async (_event, history: ChatMessage[]) => {
    const lastPath = store.get('lastAiChatSessionPath');

    if (lastPath && existsSync(lastPath)) {
        try {
            // Pastel形式への変換ロジック
            const dataToSave = JSON.stringify({
        name: "AI", // デフォルト名
        createdAt: Date.now(),
        worldSettings: {
            // 将来のために、現在の設定をここに含める
        },
        messages: history.map(msg => ({
            currentlySelected: 0,
            versions: [{
                role: msg.role,
                type: msg.role === 'user' ? 'singleStep' : 'multiStep',
                content: msg.role === 'user' ? [{ type: 'text', text: msg.content }] : null,
                steps: msg.role === 'assistant' ? [{ type: 'contentBlock', content: [{ type: 'text', text: msg.content }] }] : null,
            }]
        }))
    });
            await fsPromises.writeFile(lastPath, dataToSave, 'utf-8');
            // (オプション：成功をrendererに通知する)
        } catch (e) {
            // (オプション：失敗をrendererに通知する)
        }
    } else {
        // もしパスがなければ、「名前を付けて保存」を代わりに実行
        // 'save-ai-chat-log' は 'on' なので、'emit' ではなく、
        // rendererに「名前を付けて保存ダイアログを開いて」と逆にお願いするのが良い
        const win = BrowserWindow.fromWebContents(_event.sender);
        win?.webContents.send('trigger-ai-chat-save'); // renderer側でこのイベントをリッスン
    }
});

ipcMain.on('update-ai-chat-settings', () => {
  // ai-chatウィンドウに、「設定が変わったから、UIを更新して」と伝える
  if (aiChatWindow && !aiChatWindow.isDestroyed()) {
    aiChatWindow.webContents.send('ai-chat-settings-updated');
  }
});

// --- ハンドラ2: ログの読み込み (自動判別) ---
ipcMain.handle('load-ai-chat-log', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [
          { name: 'Chat Log Files', extensions: ['json', '*'] }
        ]
    });
    if (canceled || !filePaths.length) return null;

    try {
      const content = await fsPromises.readFile(filePaths[0], 'utf-8');
      const data = JSON.parse(content);

        let history: ChatMessage[] = [];
    if (data.chunkedPrompt?.chunks) { // Gemini形式
        history = parseGeminiLog(content); // 既存のGeminiパーサーを呼び出す
    } 
    else if (data.messages) { // LM Studio 形式
        history = data.messages.map(m => {
            const v = m.versions?.[m.currentlySelected];
            if (!v) return null;
            const finalRole = v.role === 'model' ? 'assistant' : v.role;
            let t = '';
            if (v.type === 'singleStep' && v.content?.[0]?.text) {
                t = v.content[0].text;
            } else if (v.type === 'multiStep' && v.steps) {
                const cs = v.steps.find(s => s.type === 'contentBlock');
                if (cs?.content?.[0]?.text) { t = cs.content[0].text; } 
                else { return null; }
            } else { return null; }
            return { role: finalRole, content: t.trim() };
        }).filter(Boolean);
    } else {
        throw new Error('不明なログ形式です。');
    }
    
    return history;

    } catch (e: any) {
        dialog.showErrorBox('Import Failed', e.message);
        return null;
    }
});

ipcMain.handle('load-ai-chat-log-by-path', async (_event, filePath: string) => {
    try {
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            throw new Error(`Path is not a valid file: ${filePath}`);
        }
        
        const content = await fsPromises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

        let history: ChatMessage[] = [];
    if (data.chunkedPrompt?.chunks) { // Gemini形式
        history = parseGeminiLog(content); // 既存のGeminiパーサーを呼び出す
    } 
    else if (data.messages) { // Pastel / LM Studio 形式
        history = data.messages.map(m => {
            const v = m.versions?.[m.currentlySelected];
            if (!v) return null;
            const finalRole = v.role === 'model' ? 'assistant' : v.role;
            let t = '';
            if (v.type === 'singleStep' && v.content?.[0]?.text) {
                t = v.content[0].text;
            } else if (v.type === 'multiStep' && v.steps) {
                const cs = v.steps.find(s => s.type === 'contentBlock');
                if (cs?.content?.[0]?.text) { t = cs.content[0].text; } 
                else { return null; }
            } else { return null; }
            return { role: finalRole, content: t.trim() };
        }).filter(Boolean);
    } else {
        throw new Error('不明なログ形式です。');
    }
        return history;
    } catch (e: any) {
        console.error(`Failed to load chat log from path: ${filePath}`, e);
        return null;
    }
});

// --- ハンドラ3: Geminiログを、プレーンテキストに変換して保存 ---
ipcMain.handle('import-gemini-log-as-text', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Gemini Log as a New Tab',
        filters: [{ name: 'All Files', extensions: ['*'] }] // Geminiログは拡張子がない
    });
    if (canceled || !filePaths.length) return null;

    const sourcePath = filePaths[0];
    try {
        const fileContent = await fsPromises.readFile(sourcePath, 'utf-8');
        const history = parseGeminiLog(fileContent); 
        
        // テキスト形式に変換
        const textContent = history.map(m => 
            `■ ${m.role === 'user' ? 'User' : 'AI'}\n\n${m.content}`
        ).join('\n\n---\n\n');
        
        // ★ ファイル名と、変換後のテキストコンテンツを、rendererに返す
        return {
            title: basename(sourcePath) + '.txt',
            content: textContent
        };

    } catch (e: any) {
        dialog.showErrorBox('Import Failed', e.message);
        return null;
    }
});

ipcMain.on('send-chat-to-editor', (_event, title: string, content: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('import-text-as-new-tab', title, content);
  }
});

ipcMain.handle('select-image-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Icon Image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
        properties: ['openFile']
    });
    if (canceled || !filePaths.length) return null;
    const filePath = filePaths[0];
    try {
        // ★ ファイルを読み込み、Base64 Data URLに変換する
        const buffer = await fsPromises.readFile(filePath);
        const mimeType = getLookup()(filePath) || 'image/png'; // mime-typesライブラリを使用
        const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        
        // ★ パスと、Data URLの両方を返す
        return { path: filePath, dataUrl: dataUrl };
    } catch (e) {
        return null;
    }
});

ipcMain.handle('convert-path-to-data-url', async (_event, filePath: string) => {
    if (!filePath || !existsSync(filePath)) return null;
    try {
        const buffer = await fsPromises.readFile(filePath);
        const mimeType = getLookup()(filePath) || 'image/png';
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (e) {
        return null;
    }
});

ipcMain.handle('is-chat-dirty', (event) => {
  // ★ mainは、rendererに「状態を報告せよ」と、逆質問するだけ
  const webContents = event.sender;
  return new Promise(resolve => {
    ipcMain.once('response-chat-dirty-state', (_e, isDirty) => resolve(isDirty));
    webContents.send('request-chat-dirty-state');
  });
});

}

// --- [エリア 4: アプリケーションライフサイクル] ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // ★★★ setupIpcHandlersは、ここで一度だけ呼び出す ★★★
  setupIpcHandlers();
  app.on('second-instance', (_event, commandLine) => {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length > 0) {
      if (allWindows[0].isMinimized()) allWindows[0].restore()
      allWindows[0].focus()
    }
    // 1. パッケージ化されているかどうかで、チェックすべき引数の開始位置を変える
    //    開発時: electron . "D:\ファイル.txt" -> 3番目以降
    //    本番時:   app.exe "D:\ファイル.txt" -> 2番目以降
    const pathArgIndex = app.isPackaged ? 1 : 2;

    // 2. コマンドライン引数の中から、"存在するファイルへのパス"と思われるものを探す
    const filePath = commandLine.slice(pathArgIndex).find(arg => {
      // -- や - で始まるオプションは除外
      if (arg.startsWith('-')) return false;
      try {
        // 実際にファイルとして存在するかチェック
        return existsSync(arg) && statSync(arg).isFile();
      } catch {
        return false;
      }
    });
    if (filePath) {
      console.log(`[second-instance] Opening file: ${filePath}`);
      openFileInWindow(filePath)
    }
  })
}

app.on('open-file', (event, path) => {
  event.preventDefault();
  if (app.isReady()) {
    // アプリが既に準備完了なら、直接ウィンドウに開くよう命令
    openFileInWindow(path);
  } else {
    // まだ準備できていなければ、変数に記憶しておく
    fileToOpenOnStartup = path;
  }
});

async function _openIdeaProcessorFile(filePathToLoad?: string) {
  let filePath = filePathToLoad;
  if (!filePath) {
    console.log("no path");
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'アイデアプロセッサファイルを開く',
    filters: [
      { name: 'MirrorShard Canvas', extensions: ['mrsd'] }
    ],
    properties: ['openFile']
  });
    if (canceled || !filePaths.length) return;
    filePath = filePaths[0];
  }

  // 1. まず、ファイルをパースしてみる
  const data = await parseMrsdFile(filePath);

  // 2. ★★★ パースの結果で、処理を分岐する ★★★

  // a) もし、パースに「成功」したら (`data`が存在すれば)...
  if (data) {
    console.log("data exist");
    await resetIPHistory();
    // (履歴の0番目を作成するロジック)
    
    if (!ideaProcessorWindow || ideaProcessorWindow.isDestroyed()) {
      createIdeaProcessorWindow();
    }
    // `did-finish-load`を待ってからデータを送信
    ideaProcessorWindow!.webContents.once('did-finish-load', () => { // ★ `!`で、存在することを明示
        ideaProcessorWindow?.webContents.send('load-data', { filePath, data });
    });
  } 
  // b) もし、パースに「失敗」したら (`data`が`null`なら)...
  else {
    console.log("no data");
    // ★ `_createNewUntitledFile`を呼び出す
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
      _createNewUntitledFile(ideaProcessorWindow.webContents);
    } else {
      createIdeaProcessorWindow();
      // ★ `ideaProcessorWindow`が`null`になる可能性を、完全に排除
      if (ideaProcessorWindow) {
        ideaProcessorWindow.webContents.once('did-finish-load', () => {
          if (ideaProcessorWindow) { // `once`の中でも、もう一度チェック
             _createNewUntitledFile(ideaProcessorWindow.webContents);
          }
        });
      }
    }
  }
}

async function _createNewUntitledFile(webContents: Electron.WebContents) {
  await resetIPHistory();
  // `Untitled.mrsd`を、空のデータで作成（または上書き）
  const zip = new AdmZip();
  let existingCreatedAt: string | null = null;
  const initialData = { 
    nodes: [], 
    edges: [], 
    groups: [], 
    metadata: {
      createdAt: existingCreatedAt || new Date().toISOString(), // ★ 存在すれば再利用、なければ新規作成
      updatedAt: new Date().toISOString() // 更新日時も追加すると便利
      } 
    };
  zip.addFile('canvas.json', Buffer.from(JSON.stringify(initialData), 'utf8'));
  await fsPromises.mkdir(path.dirname(untitledPath), { recursive: true });
  zip.writeZip(untitledPath);

  // ★ `renderer`に、「準備ができたよ」と、新しいファイルパスを教える
  webContents.send('file:new', untitledPath);
};

app.whenReady().then(() => {
  // 1. アプリケーションの基本的なセットアップ
  electronApp.setAppUserModelId('com.YourName.mirrorshard'); // ★ AppUserModelIdを更新
  ensureUserResources();
  buildMenu(); // 最初のメニューを構築

  // 2. カスタムプロトコルの設定
  protocol.handle('safe-resource', async (request) => {
    try {
      const urlPath = decodeURIComponent(request.url.substring('safe-resource://'.length));
      
      // --- [ステップ1: BGM用の特別ルート] ---
      if (urlPath.startsWith('bgm/')) {
        const fileName = urlPath.substring('bgm/'.length);
        const userBgmFilePath = join(app.getPath('userData'), 'resources', 'bgm', fileName);

        // 1. まず、ユーザーのbgmフォルダを探す
        if (existsSync(userBgmFilePath)) {
          console.log(`[Protocol] Loading user BGM: ${fileName}`);
          const buffer = await fsPromises.readFile(userBgmFilePath);
          // ★ 型エラー解決策: Bufferを直接渡す
          return new Response(buffer as any, { headers: { 'Content-Type': 'audio/mpeg' } });
        }

        // 2. なければ、デフォルトのbgm.datアーカイブを探す
        const archivePath = join(app.getPath('userData'), 'resources', 'bgm' , 'bgm.dat');
        if (existsSync(archivePath)) {
          const zip = new AdmZip(archivePath);
          const zipEntry = zip.getEntry(fileName);
          if (zipEntry) {
            console.log(`[Protocol] Loading default BGM from archive: ${fileName}`);
            const buffer = zipEntry.getData();
            // ★ 型エラー解決策: Bufferを直接渡す
            return new Response(buffer as any, { headers: { 'Content-Type': 'audio/mpeg' } });
          }
        }
        
        // どちらにも見つからなかった場合
        console.warn(`[Protocol] BGM not found: ${fileName}`);
        return new Response('BGM Not Found', { status: 404 });
      }
      
      // --- [ステップ2: フォント、背景画像など、通常のファイルルート] ---
      const absolutePath = join(app.getPath('userData'), 'resources', urlPath);
      if (!existsSync(absolutePath)) {
          return new Response(`File Not Found: ${absolutePath}`, { status: 404 });
      }

      const buffer = await fsPromises.readFile(absolutePath);
      
      // MIMEタイプを決定
      let mimeType = 'application/octet-stream';
      const ext = extname(urlPath).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.ttf') mimeType = 'font/ttf';
      else if (ext === '.otf') mimeType = 'font/otf';

      return new Response(buffer as any, {
        status: 200,
        headers: { 'Content-Type': mimeType }
      });

    } catch (error) {
      console.error(`Failed to handle 'safe-resource' for ${request.url}:`, error);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  // 3. 外部から開くべきファイルを特定する（ウィンドウ作成前）
  let externalFileToOpen: string | null = null;
  
  // Windows/Linuxのコマンドライン引数からファイルパスを探す
  // 'is.dev'を使うと、開発時と本番時で引数の位置を自動で調整してくれる
  const argIndex = is.dev ? 2 : 1; 
  const filePathFromArgv = process.argv.slice(argIndex).find((arg) => {
    try {
      return !arg.startsWith('--') && existsSync(arg) && statSync(arg).isFile();
    } catch { return false; }
  });
  
  // fileToOpenOnStartup はmacOS用だが、念のため両方をチェック
  // (fileToOpenOnStartup変数はグローバルスコープで let fileToOpenOnStartup: string | null = null; と定義しておく)
  externalFileToOpen = fileToOpenOnStartup || filePathFromArgv || null;
  
  if (externalFileToOpen) {
    console.log(`[Main] Startup file detected: ${externalFileToOpen}`);
    // 外部ファイルが開かれる場合、履歴に即座に追加
    addToHistory(externalFileToOpen);
    buildMenu(); // メニューを更新
  }

  // 4. セッション情報を読み込む
  const sessionFilePaths = (store.get('sessionFilePaths') as string[] | undefined) || [];
  
  // 5. 最初のウィンドウを作成
  createWindow();

  // 6. ウィンドウの準備完了後に、適切なファイルを開くよう命令
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    // did-finish-loadは一度しか発火しないので 'once' を使う
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Window loaded. Sending open commands...');

      // a) 外部ファイルがあれば、それを最優先で開く
      if (externalFileToOpen) {
        mainWindow.webContents.send('open-file', externalFileToOpen);
        // この場合、ユーザーは特定のファイルを開きたいので、セッションは復元しない
      } 
      // b) なければ、セッションを復元
      else if (sessionFilePaths.length > 0) {
        // 最初のファイルをメインタブで開く
        mainWindow.webContents.send('open-file', sessionFilePaths[0]);
        // 2つ目以降を新しいタブで開く
        if (sessionFilePaths.length > 1) {
          sessionFilePaths.slice(1).forEach(path => {
            mainWindow.webContents.send('open-file-in-new-tab', path);
          });
        }
      } 
      // c) それもなければ、新規ファイルを作成
      else {
        mainWindow.webContents.send('trigger-new-file');
      }
    });
  }

  // 7. macOSのDockアイコンクリック時の挙動
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

app.on('web-contents-created', (_event, webContents) => {
  (webContents as any).on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward' || cmd === 'browser-forward') {
      // イベントのデフォルト動作（履歴移動）をキャンセル
      e.preventDefault();
      
      const direction = cmd === 'browser-backward' ? 'previous' : 'next';
      // このwebContentsを持つウィンドウに直接命令を送る
      mainWindow.webContents.send('cycle-tab', direction);
      console.log(`[Main] app-command '${cmd}' forwarded as 'cycle-tab:${direction}'`);
    }
  });
});

  ipcMain.handle('get-store-value', (_event, key, defaultValue) => {
    return store.get(key, defaultValue);
  });

  ipcMain.on('set-store-value', (_event, key, value) => {
    store.set(key, value);
  });

  // アイデアプロセッサ関連

  // ★ `history:push`ハンドラ：`renderer`から送られてきた「純粋なデータ」を、ファイルに書き出すだけ
ipcMain.handle('history:push', async (_event, stateString: string) => {
    // 1. Redoスタックの破棄
    // historyIndex は、常に配列の最後の要素を指しているはず
    historyFiles.splice(historyIndex + 1);
    
    // 2. 新しいファイル名の決定
    const lastFile = historyFiles[historyFiles.length - 1];
    const nextIndex = lastFile ? parseInt(lastFile.split('_')[1], 10) + 1 : 0;
    const fileName = `history_${String(nextIndex).padStart(9, '0')}.json`;
    
    // 3. 書き込みとメモリ更新
    await fsPromises.writeFile(path.join(historyDir, fileName), stateString, 'utf8');
    historyFiles.push(fileName);
    // ★ historyIndex は、常に配列の長さ-1 に更新する
    historyIndex = historyFiles.length - 1;

    // ★★★ ここからが、新しい削除ロジック ★★★
    // 4. 上限を超えていたら、最も古いファイルを削除
    const MAX_HISTORY_FILES = 500; 
    if (historyFiles.length > MAX_HISTORY_FILES) {
        // a) 配列の先頭にある、最も古いファイル名を取得
        const oldestFile = historyFiles.shift(); 
        
        // b) ★★★ historyIndex-- を「しない」！ ★★★
        // shift()で配列の長さが1減ったので、新しい historyIndex は
        // 自動的に (新しい長さ - 1) となり、正しい位置を指す。
        // （例: 6個 -> 5個になったら、indexは5 -> 4になる）
        historyIndex = historyFiles.length - 1;

        // c) 物理ファイルを削除
        if (oldestFile) {
            await fsPromises.unlink(path.join(historyDir, oldestFile)).catch(() => {});
        }
    }
  });

  // ★ アンドゥ/リドゥのハンドラ：ファイルを読み込んで、中身を返すだけ
  ipcMain.handle('history:undo', async () => {
    if (historyIndex > 0) {
      historyIndex--;
      return await fsPromises.readFile(path.join(historyDir, historyFiles[historyIndex]), 'utf8');
    }
    return null;
  });
  ipcMain.handle('history:redo', async () => {
    if (historyIndex < historyFiles.length - 1) {
      historyIndex++;
      return await fsPromises.readFile(path.join(historyDir, historyFiles[historyIndex]), 'utf8');
    }
    return null;
  });

  ipcMain.on('request-native-undo', (event) => {
    const webContents = event.sender;
    if (webContents && !webContents.isDestroyed()) {
      webContents.undo();
    }
  });

  ipcMain.on('request-native-redo', (event) => {
    const webContents = event.sender;
    if (webContents && !webContents.isDestroyed()) {
      webContents.redo();
    }
  });

  ipcMain.on('idea:openFile', (_event, filePath?: string) => {
    _openIdeaProcessorFile(filePath);
  });  

  // ★ タイトル更新ハンドラ
  ipcMain.on('notify-title-change', (event, filePath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const fileName = filePath ? path.basename(filePath) : 'Untitled';
      win.setTitle(`${fileName}`);
    }
  });

  ipcMain.on('file:new', (event) => {
    _createNewUntitledFile(event.sender);
  });

});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;

  try {
    // --- ステップ1: アイデアプロセッサに終了準備を問い合わせる ---
    if (ideaProcessorWindow && !ideaProcessorWindow.isDestroyed()) {
      const ipReadyPromise = new Promise<boolean>(resolve => {
        ipcMain.once('ready-to-close', (_e, canClose) => resolve(canClose));
      });
      ideaProcessorWindow.webContents.send('please-prepare-to-close');
      
      const canCloseIp = await ipReadyPromise;
      // もしIP側でキャンセルされたら、ここで終了シーケンスを完全に中断
      if (!canCloseIp) {
        isQuitting = false;
        return;
      }
    }

    // --- 2. メインウィンドウの未保存だけを問い合わせる ---
    let confirmQuit = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const hasChanges = await mainWindow.webContents.executeJavaScript(
        'window.electronAPI.checkForUnsavedChanges()', true
      ).catch(() => false); // ウィンドウが応答しない場合は、変更なしと見なす

      if (hasChanges) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['変更を破棄して終了', 'キャンセル'],
          defaultId: 1,
          cancelId: 1,
          title: '未保存の変更',
          message: 'メインエディタに保存されていない変更があります。本当に終了しますか？',
        });
        if (choice.response === 1) { // キャンセルが押された
          confirmQuit = false;
        }
      }
    }

    // --- ユーザーがキャンセルしたら、ここで処理を完全に中断 ---
    if (!confirmQuit) {
      isQuitting = false;
      return;
    }

    // --- ステップ3: すべての確認が取れたので、アプリを終了する ---
    if (confirmQuit) {

    // a) 他のすべてのサブウィンドウを閉じる
    BrowserWindow.getAllWindows().forEach(win => {
      if (win !== mainWindow) {
        win.destroy();
      }
    });

    // b) メインウィンドウにセッション保存を依頼
    if (mainWindow && !mainWindow.isDestroyed()) {
      const sessionSavedPromise = new Promise<void>(resolve => {
        ipcMain.once('session-saved', () => resolve());
      });
      mainWindow.webContents.send('request-session-save');
      await sessionSavedPromise;
    

        // c) 最後に、メインウィンドウの最終的な状態を保存する
        const isFullscreen = mainWindow.isFullScreen();
        store.set('isFullscreen', isFullscreen);
        // フルスクリーンでない場合のみ、boundsを保存
        if (!isFullscreen) {
          store.set('windowBounds', mainWindow.getBounds());
        }    
      }

    app.exit(); // すべての準備が整ったので、アプリを終了

    } else {
      isQuitting = false;
      return;
    }    

  } catch (e) {
    console.error('Error during sequential before-quit sequence:', e);
    app.exit(); // エラーが起きても、アプリは終了させる
  }
});