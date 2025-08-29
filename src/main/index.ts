// src/main/index.ts
import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, protocol } from 'electron'
import { join, basename, extname } from 'path'
import jschardet from 'jschardet'
import { electronApp, is } from '@electron-toolkit/utils'
import AdmZip from 'adm-zip'
import Store from 'electron-store'
import { promises as fsPromises, existsSync, writeFileSync, readFileSync, statSync, cpSync } from 'fs'
import iconv from 'iconv-lite'

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
    windowBounds: undefined    
  }
});
const userDataPath = app.getPath('userData');
const iconPath = join(__dirname, '../../resources/icon.png');
const historyFilePath = join(userDataPath, 'history.json');
const MAX_HISTORY = 10;
const PREVIEW_TEXT_LIMIT = 500000;
let previewWindow: BrowserWindow | null = null;
let shortcutWindow: BrowserWindow | null = null;
let isQuitting = false;
let fileToOpenOnStartup: string | null = null;

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
  } catch (e) {
    console.error('FATAL: Failed to ensure user resources:', e);
    dialog.showErrorBox('リソースファイルのコピーに失敗しました', `エラー:`);
    app.quit();
  }
}
async function analyzeFile(filePath: string): Promise<{ content: string; encoding: string; eol: 'LF' | 'CRLF' }> {
    const buffer = await fsPromises.readFile(filePath);
    
    // ★★★ BOMチェックを最優先で行う ★★★
    if (buffer.length >= 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            // UTF-16 LE BOMが見つかった場合
            const content = iconv.decode(buffer, 'utf16le');
            const eol = content.includes('\r\n') ? 'CRLF' : 'LF';
            return { content: content.replace(/\r\n/g, '\n'), encoding: 'utf16le', eol };
        }
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            // UTF-16 BE BOM
            const content = iconv.decode(buffer, 'utf16be');
            const eol = content.includes('\r\n') ? 'CRLF' : 'LF';
            return { content: content.replace(/\r\n/g, '\n'), encoding: 'utf16be', eol };
        }
        if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
            // UTF-8 BOM
            const content = iconv.decode(buffer, 'utf8');
            const eol = content.includes('\r\n') ? 'CRLF' : 'LF';
            return { content: content.replace(/\r\n/g, '\n'), encoding: 'utf8', eol };
        }
    }
    
    // ★ BOMがない場合、jschardetによる推測を行う
    const detResult = jschardet.detect(buffer);
    let encoding = 'utf8';
    if (detResult && detResult.encoding && detResult.confidence > 0.9 && iconv.encodingExists(detResult.encoding)) {
        encoding = detResult.encoding.toLowerCase();
    }
    
    // 最後のフォールバック
    try {
        const content = iconv.decode(buffer, encoding);
        const eol = content.includes('\r\n') ? 'CRLF' : 'LF';
        return { content: content.replace(/\r\n/g, '\n'), encoding, eol };
    } catch (e) {
        // もしデコードに失敗したら、最終手段としてUTF-8で開く
        console.warn(`Decoding with ${encoding} failed. Falling back to UTF-8.`);
        const content = iconv.decode(buffer, 'utf8');
        const eol = content.includes('\r\n') ? 'CRLF' : 'LF';
        return { content: content.replace(/\r\n/g, '\n'), encoding: 'utf8', eol };
    }
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

  const isMac = process.platform === 'darwin'

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
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
  click: () => {
    // 最もアクティブなウィンドウに命令を送る
    BrowserWindow.getFocusedWindow()?.webContents.send('trigger-open-file');
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
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
submenu: [
  {
    label: '文字を大きく',
    accelerator: 'CmdOrCtrl+=',
    click: () => {
      // 現在フォーカスされているウィンドウに命令を送る
      BrowserWindow.getFocusedWindow()?.webContents.send('change-font-size', 'increase');
    }
  },
  {
    label: '文字を小さく',
    accelerator: 'CmdOrCtrl+-',
    click: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('change-font-size', 'decrease');
    }
  },
  {
    label: '文字サイズをリセット',
    accelerator: 'CmdOrCtrl+0',
    click: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('change-font-size', 'reset');
    }
  },
  {
    label: '文字サイズを20に',
    accelerator: 'CmdOrCtrl+9',
    click: () => {
      BrowserWindow.getFocusedWindow()?.webContents.send('change-font-size', 'reset20');
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
        BrowserWindow.getFocusedWindow()?.webContents.send('toggle-outline-shortcut');
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
        { role: 'togglefullscreen' as const }
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
    }
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
  } else {
    // ★ 親ウィンドウ（メインウィンドウ）を取得
    const parentWindow = BrowserWindow.getAllWindows().find(w => w.isVisible());
    if (!parentWindow) return; // 親がいなければ開かない

    // ★ 親のサイズを取得
    const parentBounds = parentWindow.getBounds();

    shortcutWindow = new BrowserWindow({
      // ★ 親の高さに合わせ、幅は少し狭くする
      width: Math.max(Math.round(parentBounds.width * 0.9)),
      height: Math.max( Math.round(parentBounds.height * 0.9)), 
      title: 'Shortcut Keys',
      parent: parentWindow, // 親を指定
      modal: true,
      frame: false,
      show: false,
      // webPreferences: { ... } // preloadは不要
    });
    shortcutWindow.webContents.on('did-finish-load', () => {
      if (process.platform === 'darwin') { // もしmacOSなら
        const css = `.mac-only { display: inline !important; }`;
        shortcutWindow?.webContents.insertCSS(css);
      }
    });
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

    shortcutWindow.on('ready-to-show', () => shortcutWindow?.show());
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
  const mainWindowOptions: Electron.BrowserWindowConstructorOptions = {
  ...(savedBounds || { width: 900, height: 670 }),
  minWidth: 640,
  minHeight: 480,  
  show: true,
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

const mainWindow = new BrowserWindow(mainWindowOptions);  

  // ウィンドウが移動/リサイズされたら、"debounce"して保存する
  let saveBoundsTimeout: NodeJS.Timeout;
  const saveBounds = () => {
    if (!mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', () => { clearTimeout(saveBoundsTimeout); saveBoundsTimeout = setTimeout(saveBounds, 1000); });
  mainWindow.on('move', () => { clearTimeout(saveBoundsTimeout); saveBoundsTimeout = setTimeout(saveBounds, 1000); });

  mainWindow.webContents.on('did-finish-load', () => {
    if (filePath) {
      mainWindow.webContents.send('open-file', filePath)
    }
  })

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

// --- [エリア 3: IPCハンドラ] ---
function setupIpcHandlers(): void {

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
  ipcMain.handle('file:saveFile', async (_event, filePath: string | null, content: string, 
    options: { encoding: string; eol: 'LF' | 'CRLF' }) => {
    let finalPath = filePath;
    if (!finalPath) {
      const { canceled, filePath: newFilePath } = await dialog.showSaveDialog({
      title: '名前を付けて保存',
      defaultPath: 'untitled.txt',
      filters: [
        { name: 'Text File', extensions: ['txt'] },        
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]});
      if (canceled || !newFilePath) return null;
      finalPath = newFilePath;
    }
    try {
      const contentToSave = options.eol === 'CRLF' ? content.replace(/\n/g, '\r\n') : content;
      const buffer = iconv.encode(contentToSave, options.encoding || 'utf8');
      await fsPromises.writeFile(finalPath, buffer);
      addToHistory(finalPath);
      buildMenu();
      return finalPath;
    } catch (e) { console.error(`Failed to save file: ${finalPath}`, e); }
    return null;
  });
  ipcMain.on('add-to-history', (_event, filePath: string) => { addToHistory(filePath); buildMenu(); });
  ipcMain.on('files-dropped', (_event, filePaths: string[]) => { filePaths.forEach(openFileInWindow); });
  ipcMain.on('session-save', (_event, filePaths: string[]) => {
    store.set('sessionFilePaths', filePaths.filter((p): p is string => p !== null));
  });

  // --- ウィンドウ操作 ---
  ipcMain.on('quit-app', () => app.quit());
  ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('window-toggle-fullscreen', () => {
    const window = BrowserWindow.getFocusedWindow();
    if (!window) return;  
    // 1. もし、OSがLinuxで、かつ、対象がプレビューウィンドウなら...
    if (process.platform === 'linux' && window === previewWindow) {    
      // a. フルスクリーンではなく、"最大化"をトグルする
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }    
    } else {
      // 2. それ以外のOS、またはメインウィンドウなら、これまで通りフルスクリーンをトグルする
      window.setFullScreen(!window.isFullScreen());
    }
  });
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
  previewWindow = new BrowserWindow({
    ...(savedBounds || { width: 800, height: 600 }),
  minWidth: 480,
  minHeight: 320,      
    parent: parentWindow || undefined, 
    show: false, 
    frame: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  });
  if (savedIsFullscreen) {
  previewWindow.setFullScreen(true);
}
  previewWindow.on('ready-to-show', () => previewWindow?.show());
  previewWindow.on('close', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    // ★ フルスクリーン状態を取得して保存
    const isFullscreen = previewWindow.isFullScreen();
    store.set('previewIsFullscreen', isFullscreen);
    // フルスクリーン状態では、正しいウィンドウサイズが取得できないことがあるので、
    // フルスクリーンでない場合のみ、サイズを保存する
    if (!isFullscreen) {
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
      const finalData = {
        ...data,
        isDarkMode: store.get('isDarkMode', false) // electron-storeから最新の状態を取得
      };
      previewWindow?.webContents.send('initialize-preview', finalData);
    });
      previewWindow.on('show', () => {
      parentWindow?.focus();
    });
  });
  ipcMain.on('toggle-preview-window', () => { previewWindow?.close(); });
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
    const history = loadHistory(); // SnowEditorの履歴管理関数
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
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('change-font-size', action);
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

  // --- マウス & タブサイクル ---
  // (createWindow内の app-command で処理されるので、ここでは不要)

  // --- 降雪エフェクト ---
  ipcMain.on('toggle-preview-snow', () => { previewWindow?.webContents.send('trigger-snow-toggle'); });
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

  const mainWindow = BrowserWindow.getAllWindows().find(win => win.isVisible() && win !== previewWindow);

  // 1. まず、プレビューウィンドウが存在すれば、問答無用で閉じて、完了を待つ
  if (previewWindow && !previewWindow.isDestroyed()) {
    console.log('[Main] Closing preview window first...');
    await new Promise<void>(resolve => {
      previewWindow!.once('closed', () => resolve());
      previewWindow!.close();
    });
    console.log('[Main] Preview window closed.');
  }

  // プレビューがなくなった状態で、メインウィンドウの処理に進む
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit();
    return;
  }
  
  try {
    // 2. メインウィンドウにだけ、未保存確認を行う
    const hasUnsavedChangesPromise = new Promise<boolean>(resolve => {
      ipcMain.once('response-unsaved-changes', (_event, hasChanges) => resolve(hasChanges));
    });
    mainWindow.webContents.send('request-unsaved-changes-check');
    const hasUnsavedChanges = await hasUnsavedChangesPromise;

    let confirmQuit = true;
    if (hasUnsavedChanges) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['変更を破棄して終了', 'キャンセル'],
        defaultId: 1,
        title: '未保存の変更',
        message: '保存されていない変更があります。本当に終了しますか？',
        cancelId: 1,
      });
      if (choice.response === 1) {
        confirmQuit = false;
      }
    }

    if (confirmQuit) {
      // 3. メインウィンドウにだけ、セッション保存を要求する
      const sessionSavedPromise = new Promise<void>(resolve => {
        ipcMain.once('session-saved', () => resolve());
      });
      mainWindow.webContents.send('request-session-save');
      await sessionSavedPromise;
      
      app.quit();
    } else {
      isQuitting = false;
    }
  } catch (e) {
    console.error('Error during before-quit sequence:', e);
    app.quit();
  }
});