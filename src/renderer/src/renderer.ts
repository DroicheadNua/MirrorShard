// src/renderer/src/renderer.ts

// --- [エリア 1: Imports] ---
import '../assets/main.css';
import { EditorState, Compartment, Transaction } from '@codemirror/state';
import { EditorView, keymap,} from '@codemirror/view';
import { history, historyKeymap, cursorDocStart, cursorDocEnd } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { TYPE_SOUND_BASE64 } from './scripts/type-sound';
import type { SelectionRange, StateEffect } from '@codemirror/state';

// --- [エリア 2: 型定義] ---
interface ProjectFile {
  id: string;
  filePath: string | null;
  title: string;
  state: EditorState;
  isDirty: boolean;
  encoding: string;
  eol: 'LF' | 'CRLF';
  encodingWarning?: string; 
}
interface AppState {
  projectFiles: ProjectFile[];
  activeFileId: string | null;
}

// --- [エリア 3: グローバル変数 & 状態管理] ---
let view: EditorView;
const outlineCollapsedState = new Map<string, Map<string, boolean>>();
let state: AppState = { projectFiles: [], activeFileId: null };

// 機能ごとの状態変数
let availablefonts: string[] = [];
let currentFontIndex = 0;
let isFocusMode = false;
let isZenMode = false;
let isTypeSoundEnabled = true;
let isPreviewOpen = false;
let currentFontSize = 16;
const PREVIEW_TEXT_LIMIT = 500000;
const audioEl = new Audio();
let availablebgms: string[] = [];
let currentbgmIndex = -1;
let availablebgs: string[] = [];
let currentbgIndex = 0;

// CodeMirror & DOM
const themeCompartment = new Compartment();
const fontFamily = new Compartment();
const fontSizeCompartment = new Compartment();
const highlightingCompartment = new Compartment();
const typeSound = new Audio(`data:audio/wav;base64,${TYPE_SOUND_BASE64}`);
typeSound.volume = 0.1;

// デバウンス/スロットリング用タイマー
let outlineUpdateTimeout: NodeJS.Timeout;
let previewUpdateTimeout: NodeJS.Timeout;
let rafId = 0;

const createFontTheme = (fontFamilyValue: string) => {
  // 渡されたフォントファミリー名をそのまま使う（引用符は不要。CSSエンジンが処理する）
  // ただし、CSSのカスタムプロパティ経由などで使う場合はサニタイズが必要になることもある
  const newFontFamily = fontFamilyValue; 
  console.log(`[FontTheme] Creating theme for font: ${fontFamilyValue}`);
  return EditorView.theme({
    // .cm-editor全体に適用
    // '&' は .cm-editor を指す
    '&': {
      fontFamily: fontFamilyValue,
      height: "100%", // ★ 親要素(#container)の高さに追従する
    },
    '.cm-scroller': {
      overflow: "auto" // ★ CodeMirrorの内部スクローラーを有効化
    },
    // コンテンツ部分には!importantでテーマの指定を強制的に上書き
    '.cm-content': {
      fontFamily: `${newFontFamily} !important`,
      caretColor: 'var(--editor-caret-color) !important',
      lineHeight: '1.6 !important', 
    },
    // ガター（行番号）部分にも適用
    '.cm-gutters': {
      fontFamily: newFontFamily
    }
  });
};
const myLightTheme = EditorView.theme({
  '&': {
    color: '#333333',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(0, 0, 0, 0.1) !important',
  },
  '.cm-composition-underline': {
    textDecorationColor: '#333333',
  },
  '& ::-webkit-scrollbar': {
    width: '18px', // 少し太くして掴みやすく
  },
  '& ::-webkit-scrollbar-track': {
    backgroundColor: 'transparent', // ★ 背景を透明に
  },
  '& ::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(0, 0, 0, 0.15)', // ★ バーの色を少し濃く
    borderRadius: '9px',
    border: '3px solid transparent', // バーの周りに透明な余白を作る
    backgroundClip: 'content-box',
    minHeight: '40px'
  },
  '& ::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },  
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },  
  '.cm-scroller': {
    paddingBottom: '50vh',
  },
}, { dark: false });
const dynamicFontTheme = createFontTheme('sans-serif');
const myDarkTheme = EditorView.theme({
  // '&'はエディタのルート要素 .cm-editor を指す
  '&': {
    color: '#DDDDDD', // --editor-text-color
    backgroundColor: 'transparent', // CSSの背景を透過させる
  },
  '& .cm-line': { color: '#DDDDDD' },
  // エディタのフォーカス時の枠線
  '&.cm-focused': {
    outline: 'none',
  },
  // 選択範囲の背景色
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#555555 !important', // 少し濃いめのグレーなど
  },
  // 行番号などのガター部分
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: '#888888',
    border: 'none',
  },
  // ★★★ 変換中のアンダーラインの色 ★★★
  '.cm-composition-underline': {
    textDecorationColor: '#DDDDDD', // テキストの色と同じにする
  },
  // ★ スクロールバーのスタイルを追加
  '& ::-webkit-scrollbar': {
    width: '18px', // 少し太くして掴みやすく
  },
  '& ::-webkit-scrollbar-track': {
    backgroundColor: 'transparent', // ★ 背景を透明に
  },
  '& ::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(255, 255, 255, 0.15)', // ★ バーの色を少し濃く
    borderRadius: '9px',
    border: '3px solid transparent', // バーの周りに透明な余白を作る
    backgroundClip: 'content-box',
    minHeight: '40px'
  },
  '& ::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },  
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },  
    '.cm-scroller': {
    paddingBottom: '50vh',
  },
}, {dark: true});

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: '#0550AE', fontWeight: 'bold' } // 例: GitHubの青
]);
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: '#82AAFF', fontWeight: 'bold' } // 例: 明るい青
]);

const cursorTheme = EditorView.theme({
  // 最も内側の要素を直接狙う
  '.cm-cursorLayer': {
    height: 'auto !important',
  },  
  '.cm-cursorLayer .cm-cursor': {
    borderLeft: '2px solid var(--editor-caret-color) !important',
    // ★ 高さを親要素（行）の高さに強制的に合わせる
    width: '2px !important',
  },
  '.cm-dropCursor': {
    // ... 同様に !important を付ける
  },
  '.cm-content': {
    caretColor: 'var(--editor-caret-color)',
    // ★ ここにも行の高さを指定
    lineHeight: 1.6
  }
});

/** 新しいEditorStateを生成する */
const createNewState = (doc: string): EditorState => {
    const fontFile = availablefonts[currentFontIndex];
    const currentCssFontFamily = fontFile 
        ? `my-editor-font-${fontFile.replace(/[^a-zA-Z0-9]/g, '-')}` 
        : 'sans-serif';  
    // ★★★ 毎回、最新のグローバルな状態を使って、拡張機能を"その場"で構築する ★★★
    return EditorState.create({
        doc,
        extensions: [
            // --- 機能 ---
            history(),
            keymap.of([
                ...historyKeymap,
                ...searchKeymap,
                { key: 'Mod-ArrowUp', run: (v) => { cursorDocStart(v); v.dispatch({ effects: EditorView.scrollIntoView(0, { y: "start" }) }); return true; } },
                { key: 'Mod-ArrowDown', run: (v) => { cursorDocEnd(v); v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) }); return true; } },
                { key: 'Ctrl-o', run: () => { openFileAction(); return true; } },
                { key: 'Ctrl-s', run: () => { saveFileAction(false); return true; } }, 
            ]),
            EditorView.lineWrapping,
            markdown({ base: markdownLanguage }),
            search({
              top: true, // 検索パネルを上部に
              
              // ★ 公式ドキュメントにある、スクロール挙動をカスタマイズするオプション
              scrollToMatch: (range: SelectionRange, _view: EditorView): StateEffect<unknown> => {
                // EditorView.scrollIntoViewを使って、中央揃えのスクロールエフェクトを生成して返す
                return EditorView.scrollIntoView(range.from, { y: 'center' });
              }
            }),            
            EditorState.transactionFilter.of(tr => {
              // もしトランザクションがカーソル位置を変更するものでなければ、何もしない
              if (!tr.selection) return tr;

              // ドキュメントの最後の位置を取得
              const docEnd = tr.newDoc.length;
              // 新しいカーソル位置
              const newPos = tr.selection.main.head;

              // もし、新しいカーソル位置がドキュメントの末尾を超えていたら...
              if (newPos > docEnd) {
                // トランザクションを書き換えて、カーソル位置を末尾に強制する
                return {
                  ...tr,
                  selection: { anchor: docEnd }
                };
              }
              
              // 問題なければ、元のトランザクションをそのまま通す
              return tr;
            }),            
            EditorView.updateListener.of((update) => {
                if (!update.docChanged && !update.selectionSet && !update.geometryChanged) return;
                
                const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);

                if (update.docChanged && activeFile) {
                    if (!activeFile.isDirty) {
                        activeFile.isDirty = true;
                        updateUI();
                    }
                    if (isTypeSoundEnabled && update.transactions.some(tr => tr.annotation(Transaction.userEvent))) {
                        typeSound.currentTime = 0;
                        typeSound.play().catch(() => {});
                    }
                }
                if (update.docChanged) {
                    clearTimeout(outlineUpdateTimeout);
                    outlineUpdateTimeout = setTimeout(updateUI, 300);
                }
                if (update.selectionSet || update.geometryChanged) {
                    if (rafId) cancelAnimationFrame(rafId);
                    rafId = requestAnimationFrame(() => {
                        updateOutlineHighlight(update.view);
                        updateBreadcrumbs(update.view);
                        rafId = 0;
                    });
                }
                if (update.docChanged || update.selectionSet) {
                    clearTimeout(previewUpdateTimeout);
                    previewUpdateTimeout = setTimeout(updatePreview, 300);
               
                  }
                if (update.docChanged || update.selectionSet || update.geometryChanged) {
                updateStatusBar();
              }             
            }),

            // --- 見た目（現在のグローバルな状態を反映）---
            cursorTheme,
            themeCompartment.of(document.body.classList.contains('dark-mode') ? myDarkTheme : myLightTheme),
            fontFamily.of(createFontTheme(currentCssFontFamily)),
            fontSizeCompartment.of(EditorView.theme({ '&': { fontSize: `${currentFontSize}px` } })),
            highlightingCompartment.of(syntaxHighlighting(document.body.classList.contains('dark-mode') ? darkHighlightStyle : lightHighlightStyle)),
        ]
    });
};


// --- [エリア 4: アクション関数 (Stateを変更する唯一の場所)] ---

/**
 * 現在のカーソル位置から、見出しの階層情報（パンくずリスト）を生成する
 */
const updateBreadcrumbs = (view: EditorView) => {
  const breadcrumbsEl = document.getElementById('status-breadcrumbs');
  if (!breadcrumbsEl) return;

  const pos = view.state.selection.main.head;
  const currentLineNumber = view.state.doc.lineAt(pos).number;
  const doc = view.state.doc;

  const path: string[] = [];
  let lastFoundLevel = 0;

  // カーソル行から、ドキュメントの先頭に向かって一行ずつスキャン
  for (let i = currentLineNumber; i >= 1; i--) {
    const line = doc.line(i);
    const match = line.text.match(/^(#+)\s+(.*)/);

    if (match) {
      const level = match[1].length;
      const title = match[2].trim();

      // より上位（または同じレベル）の見出しが見つかったら、それをパスに追加
      if (level < lastFoundLevel || lastFoundLevel === 0) {
        path.unshift(title); // 配列の先頭に追加
        lastFoundLevel = level;
      }
      // 最上位の見出し(#)を見つけたら、スキャンを終了
      if (level === 1) {
        break;
      }
    }
  }
  
  // 生成されたパスを、' > ' で繋いで表示
  breadcrumbsEl.textContent = path.join(' > ');
};

/**
 * 指定されたファイルパスまたはBase64データからフォントを生成し、エディタに適用する
 * @param data - ファイルパスか、Base64データを含むオブジェクト
 */
async function applyFont(data: { path?: string; cssFontFamily?: string; base64?: string; format?: string }) {
  let { path, cssFontFamily, format } = data;
  let base64: string | null = data.base64 || null;

  try {
    // もしパスしか渡されなければ、Base64データをmainから取得
    if (path && !base64) {
      base64 = await window.electronAPI.getFontBase64(path);
      if (!base64) throw new Error('Base64 data is null');
      const family = path.split(/[\\/]/).pop()?.split('.').slice(0, -1).join('.') || 'system-font';
      cssFontFamily = `system-font-${family.replace(/[\s]/g, '_')}`;
      format = path.split('.').pop()?.toLowerCase() || 'truetype';
    }
    
    if (!cssFontFamily || !base64 || !format) throw new Error('Insufficient font data');

    // @font-faceを生成・適用
    const styleEl = document.getElementById('system-font-styles') || document.createElement('style');
    styleEl.id = 'system-font-styles';
    const fontUrl = `data:font/${format};base64,${base64}`;
    styleEl.textContent = `
      @font-face { font-family: '${cssFontFamily}'; src: url('${fontUrl}'); }
    `;
    document.head.appendChild(styleEl);
    
    await document.fonts.load(`16px "${cssFontFamily}"`);
    
    // CodeMirrorに適用
    const newFontTheme = createFontTheme(cssFontFamily);
    view.dispatch({ effects: fontFamily.reconfigure(newFontTheme) });
    document.documentElement.style.setProperty('--current-editor-font', cssFontFamily);

  } catch (e) { console.error(`Failed to apply font:`, e); }
}


/** UIの再描画を行う */
const updateUI = () => {
  if (!view) return;
  const position = view.state.selection.main.head;
  const lineNumber = view.state.doc.lineAt(position).number;
  updateOutline(lineNumber);
  updateBreadcrumbs(view)
  updateStatusBar();
};

/** ファイルを切り替える */
const switchFile = (fileId: string | null) => {
  console.log(`[switchFile] Switching to file: ${fileId}`);
    // 1. 現在のファイルの状態を保存
    const currentFile = state.projectFiles.find(f => f.id === state.activeFileId);
    if (currentFile && view) {
        currentFile.state = view.state;
    }

    state.activeFileId = fileId;
    const activeFile = state.projectFiles.find(f => f.id === fileId);

    //  2. ステータスバーを、"新しい"アクティブファイルの"正しい"情報で更新する 
    updateStatusBar();
    
    const encodingEl = document.getElementById('status-encoding');
    const eolEl = document.getElementById('status-eol');
    if (encodingEl && eolEl) {
        if (activeFile) {
            // ★ activeFile.encoding は、analyzeFileが返した正しい値を持っている
            encodingEl.textContent = activeFile.encoding;
            eolEl.textContent = activeFile.eol;
        } else {
            encodingEl.textContent = '-';
            eolEl.textContent = '-';
        }
    }    

    if (activeFile) {
        // 3. アウトラインの状態を初期化
        if (!outlineCollapsedState.has(activeFile.id)) {
            const fileState = new Map<string, boolean>();
            const lines = activeFile.state.doc.toString().split('\n');
            lines.forEach((line, i) => {
              const match = line.match(/^(#+)\s+(.*)/);
              if (match) {
                const headingKey = `${activeFile.id}:${i + 1}:${match[2]}`;
                fileState.set(headingKey, true);
              }
            });
            outlineCollapsedState.set(activeFile.id, fileState);
        }
        // 4. EditorViewの状態を丸ごと入れ替え
        if (view) {
          console.log(`[switchFile] Setting state for ${activeFile.title}`);
            // 1. 次のタブの保存された状態を取得
            const nextState = activeFile.state;
            
            // 2. その状態が持つカーソル位置（selection）を覚えておく
            const nextSelection = nextState.selection;
            
            // 3. まず、EditorViewの内部状態を、テキストとアンドゥ履歴で更新
            view.setState(nextState);
            view.dispatch({
              effects: [
                themeCompartment.reconfigure(document.body.classList.contains('dark-mode') ? myDarkTheme : myLightTheme),
                highlightingCompartment.reconfigure(syntaxHighlighting(document.body.classList.contains('dark-mode') ? darkHighlightStyle : lightHighlightStyle)),
                fontSizeCompartment.reconfigure(EditorView.theme({ '&, .cm-content': { fontSize: `${currentFontSize}px` } })),
                fontFamily.reconfigure(createFontTheme(document.documentElement.style.getPropertyValue('--current-editor-font') || 'sans-serif'))
              ],
              selection: nextSelection, // ★★★ ここでカーソル位置を復元 ★★★
              filter: false,
            });            
        }
     //  activeFile.isDirty = false;
        view.focus();
        //  次の描画フレームで、現在のカーソル位置を中央にスクロール
        requestAnimationFrame(() => {
            view.dispatch({
                effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" })
            });
        });     
    } else if (view) {
        view.setState(createNewState(''));
    }
    console.log('[switchFile] Switch complete.');
    // 5. 最後にUIを更新
    updateUI();
};


/** 新しいファイルを追加する */
const addNewFile = () => {
  const newFile: ProjectFile = {
    id: crypto.randomUUID(),
    filePath: null,
    title: `Untitled-${state.projectFiles.length + 1}`,
    state: createNewState(''),
    isDirty: false,
    encoding: 'utf8',
    eol: 'LF',
    encodingWarning: undefined,
  };
  state.projectFiles.push(newFile);
  switchFile(newFile.id);
};

/** ファイルを開くダイアログを表示する */
const openFileAction = async () => {
  if (state.projectFiles.length === 1 && state.projectFiles[0].filePath === null && state.projectFiles[0].state.doc.length === 0) {
    state.projectFiles = [];
    state.activeFileId = null;
  }
  const result = await window.electronAPI.openFile();
  if (result) {
    const existingFile = state.projectFiles.find(f => f.filePath === result.filePath);
  if (result.warning) {
    window.electronAPI.showEncodingWarningDialog(result.warning);
  }    
    if (existingFile) {
      switchFile(existingFile.id);
      return;
    }
    const title = result.filePath.split(/[\\/]/).pop() || 'Untitled';
    const newFile: ProjectFile = {
      id: crypto.randomUUID(),
      filePath: result.filePath,
      title,
      state: createNewState(result.content),
      isDirty: false,
      encoding: result.encoding,
      eol: result.eol,
      encodingWarning: result.warning,
    };
    state.projectFiles.push(newFile);
    switchFile(newFile.id);
  }
};

/** 指定されたパスのファイルを読み込み、タブに表示・切り替えする */
const openFileAndSwitch = async (filePath: string) => {
    if (state.projectFiles.length === 1 && state.projectFiles[0].filePath === null && state.projectFiles[0].state.doc.length === 0) {
        state.projectFiles = [];
        state.activeFileId = null;
    }
    const existingFile = state.projectFiles.find(f => f.filePath === filePath);
    if (existingFile) {
        switchFile(existingFile.id);
        return;
    }
    try {
        window.electronAPI.addToHistory(filePath);
        const result = await window.electronAPI.readFile(filePath);
        if (result) {
            if (result.warning) {
              window.electronAPI.showEncodingWarningDialog(result.warning);
            }          
            const title = filePath.split(/[\\/]/).pop() || 'Untitled';
            const newFile: ProjectFile = {
                id: crypto.randomUUID(),
                filePath,
                title,
                state: createNewState(result.content),
                isDirty: false,
                encoding: result.encoding,
                eol: result.eol,
                encodingWarning: result.warning,
            };
            state.projectFiles.push(newFile);
            switchFile(newFile.id);
        }
    } catch (e) { console.error(`Failed to open file: ${filePath}`, e); }
};

/** 指定されたパスのファイルをバックグラウンドでタブとして開く */
const openFileInBackground = async (filePath: string) => {
    const existingFile = state.projectFiles.find(f => f.filePath === filePath);
    if (existingFile) return;
    try {
        const result = await window.electronAPI.readFile(filePath);
        if (result) {
            const title = filePath.split(/[\\/]/).pop() || 'Untitled';
            const newFile: ProjectFile = {
                id: crypto.randomUUID(),
                filePath,
                title,
                state: createNewState(result.content),
                isDirty: false,
                encoding: result.encoding,
                eol: result.eol,
            };
            state.projectFiles.push(newFile);
            updateUI();
        }
    } catch (e) { console.error(`Failed to open file in background: ${filePath}`, e); }
};

/** ファイルを保存する */
const saveFileAction = async (forceDialog: boolean = false) => {
    const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
    if (!activeFile) return;
  if (activeFile.encodingWarning) {
    const confirmed = await window.electronAPI.confirmSaveWithEncodingWarning(activeFile.title);
    if (!confirmed) {
      return; // ユーザーがキャンセルしたら、保存しない
    }
  }
    const content = view.state.doc.toString();
    const filePath = forceDialog ? null : activeFile.filePath;
    const options = { encoding: activeFile.encoding, eol: activeFile.eol };

    // ★★★ ログ1: 送信するデータを表示 ★★★
    console.log('[Renderer] Sending save request with options:', options);

    const result = await window.electronAPI.saveFile(filePath, content, options);

    if (result.success && result.path) {
        // --- 成功した場合 ---
        activeFile.filePath = result.path;
        activeFile.title = result.path.split(/[\\/]/).pop() || 'Untitled';
        activeFile.isDirty = false;
        activeFile.state = view.state;
        updateUI();
    } else if (result.cancelled) {
        // --- ユーザーがキャンセルした場合 ---
        console.log('[Save] Save action was cancelled by the user.');
        // 何もせず、静かに処理を終了する
    } else {
        // --- 予期せぬエラーで失敗した場合 ---
        console.error(`[Save] Save action failed: ${result.error}`);
        // ここでユーザーに「保存に失敗しました」とアラートを出しても良い
    }
};

/** ファイルを閉じる */
const closeFile = async (fileIdToClose: string) => {
  const fileToClose = state.projectFiles.find(f => f.id === fileIdToClose);
  if (!fileToClose) return;

  // ★★★ 未保存の場合、mainに確認ダイアログを依頼する ★★★
  if (fileToClose.isDirty) {
    const confirmed = await window.electronAPI.confirmCloseTab(fileToClose.title);
    if (!confirmed) {
      return; // キャンセルされたら、何もしない
    }
  }
    const indexToClose = state.projectFiles.findIndex(f => f.id === fileIdToClose);
    if (indexToClose === -1) return;
    state.projectFiles.splice(indexToClose, 1);
    if (state.projectFiles.length === 0) {
        addNewFile();
        return;
    }
    if (state.activeFileId === fileIdToClose) {
        const newIndex = Math.max(0, indexToClose - 1);
        switchFile(state.projectFiles[newIndex].id);
    } else {
        updateUI();
    }
};

const showEditorContextMenu = (targetView: EditorView) => {
  window.electronAPI.getRecentFiles().then(recentFiles => {
    const hasSelection = !targetView.state.selection.main.empty;
    const blueprint = [  
      {
        label: '最近使ったファイルから開く',
        submenu: recentFiles.length > 0
          ? recentFiles.map(file => ({ 
            id: 'open-recent', 
            label: file.basename, 
            path: file.path 
          }))
          : [{ label: '（履歴なし）', enabled: false }]
      },
        { type: 'separator' },
        { id: 'open-file', label: 'ファイルを開く...' },
        { id: 'save-file', label: 'ファイルを保存...' },
        { id: 'save-as-file', label: '名前を付けて保存...' },
        { type: 'separator' },
        { id: 'undo', label: '元に戻す' },
        // ...
        { id: 'cut', label: '切り取り', enabled: hasSelection },
        { id: 'copy', label: 'コピー', enabled: hasSelection },
        { id: 'paste', label: '貼り付け' },
        { id: 'select-all', label: 'すべて選択' },];
          window.electronAPI.showContextMenuFromBlueprint(blueprint);
        });
      };


const cycleTab = (direction: 'next' | 'previous') => {
  if (state.projectFiles.length <= 1) return;
  const currentIndex = state.projectFiles.findIndex(f => f.id === state.activeFileId);
  if (currentIndex === -1) return;

  let nextIndex: number;
  if (direction === 'next') {
    nextIndex = (currentIndex + 1) % state.projectFiles.length;
  } else {
    nextIndex = (currentIndex - 1 + state.projectFiles.length) % state.projectFiles.length;
  }
  
  const nextFileId = state.projectFiles[nextIndex].id;
  switchFile(nextFileId);
};

const updatePreview = () => {
  if (!isPreviewOpen || !view) return; // プレビューが開いていなければ何もしない
  let content = view.state.doc.toString();
  const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
  const fontSizeNumber = currentFontSize;
  // 巨大ファイルのチェック
  if (content.length > PREVIEW_TEXT_LIMIT) {
    content = content.substring(0, PREVIEW_TEXT_LIMIT);
  }
  
  window.electronAPI.updatePreview({ content, lineNumber, fontsize: fontSizeNumber });
};

const updateStatusBar = () => {
    const encodingEl = document.getElementById('status-encoding');
    const eolEl = document.getElementById('status-eol');
    const statsEl = document.getElementById('status-stats'); 
    if (!encodingEl || !eolEl || !statsEl) return;
    
    const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
    if (activeFile && view) { // ★ viewが存在することも確認
        // エンコーディングと改行コード
        //    activeFile.encoding が string であることを保証する
        encodingEl.textContent = typeof activeFile.encoding === 'string' ? activeFile.encoding.toUpperCase() : 'UNKNOWN';
        eolEl.textContent = activeFile.eol || '-';

        // ★★★ 統計情報の計算と表示 ★★★
        const doc = view.state.doc;
        const totalLines = doc.lines;
        const cursorPos = view.state.selection.main.head;
        const currentLineNumber = doc.lineAt(cursorPos).number;
        // 2バイト文字も1文字としてカウント
        const totalChars = doc.length; 
        
        // 1250/2500L (50%) 形式
        const percent = totalLines > 0 ? Math.round((currentLineNumber / totalLines) * 100) : 0;
        statsEl.textContent = `${currentLineNumber}/${totalLines}L (${percent}%) ${totalChars}C`;
        
    } else {
        encodingEl.textContent = '-';
        eolEl.textContent = '-';
        statsEl.textContent = '0L 0C'; // ★
    }
};


const setZenMode = (enabled: boolean) => {
  isZenMode = enabled;
  document.body.classList.toggle('zen-mode', isZenMode);
  window.electronAPI.setZenModeState(isZenMode);
  const outlinePanel = document.getElementById('outline-panel');
  if (outlinePanel) {
    // 1. Zenモードに入る時 (enabled: true)
    if (isZenMode) {
      // アウトラインを"必ず"非表示にする
      outlinePanel.classList.add('hidden-by-shortcut');
    }
    // 2. Zenモードを抜ける時 (enabled: false)
    else {
      // アウトラインを"必ず"表示する
      outlinePanel.classList.remove('hidden-by-shortcut');
    }
  }
};

const toggleOutlinePanelVisibility = () => {
  const outlinePanel = document.getElementById('outline-panel');
  if (outlinePanel) {
    outlinePanel.classList.toggle('hidden-by-shortcut');
  }
};

/**
 * プレビューウィンドウを開く/トグルするアクション関数
 */
const openPreview = async () => {
  const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
  if (!activeFile) return;

  // 1. プレビューが既に開いている場合は、閉じる命令を送るだけ
  if (isPreviewOpen) {
    window.electronAPI.togglePreviewWindow();
    isPreviewOpen = false; 
  } else {

  // 2. コンテンツとカーソル位置を取得
  let content = activeFile.state.doc.toString();
  const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
  const fontSizeNumber = currentFontSize;
  
  // 3. 巨大ファイルの警告と切り詰め
  if (content.length > PREVIEW_TEXT_LIMIT) {
    const confirmed = await window.electronAPI.confirmLargeFilePreview(content.length);
    if (!confirmed) {
      return; // キャンセルされたら、ここで処理を中断
    }
    content = content.substring(0, PREVIEW_TEXT_LIMIT);
  }

  // 4. 現在のフォント情報を取得
  const fontFile = availablefonts[currentFontIndex];
  const currentFontName = `my-editor-font-${fontFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const data = {
      initialContent: { content, fontsize: fontSizeNumber, lineNumber },
      fontsInfo: { availablefonts, currentFontName },
    };  

  // 5. メインプロセスに、プレビューウィンドウを開くための全ての情報を渡す
  window.electronAPI.openPreviewWindow({
    initialContent: {
      content: content,
      fontsize: fontSizeNumber,
      lineNumber: lineNumber,
    },
    fontsInfo: {
      availablefonts: availablefonts,
      currentFontName: currentFontName,
    },
  });
  
  window.electronAPI.openPreviewWindow(data);
  isPreviewOpen = true;
}
};

/**
 * アウトラインのアクティブな行のハイライトだけを更新する、軽量な関数
 */
const updateOutlineHighlight = (targetView: EditorView) => {
  const outlineContainer = document.getElementById('outline-container');
  if (!outlineContainer) return;
  
  const position = targetView.state.selection.main.head;
  const currentLineNumber = targetView.state.doc.lineAt(position).number;

  // 1. まず、すべてのアクティブクラスを削除
  outlineContainer.querySelectorAll('.outline-item-wrapper.active').forEach(el => {
    el.classList.remove('active');
  });

  // 2. 現在の行が含まれる見出しを探す
  const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
  if (!activeFile) return;

  const lines = activeFile.state.doc.toString().split('\n');
  const headings = lines.map((line, i) => ({ match: line.match(/^(#+)\s+(.*)/), lineNumber: i + 1 }))
                        .filter(({ match }) => match)
                        .map(({ lineNumber }) => ({ lineNumber }));

  let activeHeadingLine = 0;
  for (const heading of headings) {
    if (heading.lineNumber <= currentLineNumber) {
      activeHeadingLine = heading.lineNumber;
    } else {
      break;
    }
  }

  // 3. 見つかった見出しに対応するDOM要素に、アクティブクラスを追加
  if (activeHeadingLine > 0) {
    const activeItemWrapper = outlineContainer.querySelector(`li[data-line-number='${activeHeadingLine}'] > .outline-item-wrapper`);
    activeItemWrapper?.classList.add('active');
  }
};

/** アウトラインの開閉状態をすべて設定する */
const setAllHeadingsCollapsed = (fileId: string | null, collapsed: boolean) => {
  if (!fileId) return;
  const activeFile = state.projectFiles.find(f => f.id === fileId);
  if (!activeFile) return;

  let fileState = outlineCollapsedState.get(fileId);
  if (!fileState) {
    fileState = new Map<string, boolean>();
    outlineCollapsedState.set(fileId, fileState);
  }

  const lines = activeFile.state.doc.toString().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#+)\s+(.*)/);
    if (match) {
      const headingKey = `${fileId}:${i + 1}:${match[2]}`;
      fileState.set(headingKey, collapsed);
    }
  }
  updateUI();
};

const updateFontSize = (newSize: number) => {
  currentFontSize = Math.max(8, Math.min(newSize, 72));
  const newFontSizeTheme = EditorView.theme({
    '&, .cm-content': {
      fontSize: `${currentFontSize}px`,
    }
  });
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(newFontSizeTheme)
  });
  // ストアに保存
  window.electronAPI.setfontsize(currentFontSize);
    if (isPreviewOpen) {
    window.electronAPI.updatePreviewfontsize(currentFontSize);
  }
};

const applyTheme = (isDarkMode: boolean) => {
  // 1. 自分自身のUIを更新
  document.body.classList.toggle('dark-mode', isDarkMode);
  if (view) {
    view.dispatch({ 
      effects: [
        // テーマを入れ替える
        themeCompartment.reconfigure(isDarkMode ? myDarkTheme : myLightTheme),
        // ★★★ ハイライトスタイルも入れ替える ★★★
        highlightingCompartment.reconfigure(syntaxHighlighting(isDarkMode ? darkHighlightStyle : lightHighlightStyle))
      ]
    });
  }
  
  // 2. Focusモードとの連動 (これはUIロジックなので、ここにあってOK)
  if (isDarkMode && isFocusMode) {
    toggleFocusMode();
  }
};

const cycleFont = async (targetIndex?: number) => {
    // 1. もし、現在システムフォントが適用されているなら、まずそれを解除する
    //    `getAppliedSystemFontPath`はmainに問い合わせるので、asyncにする
    const appliedSystemFontPath = await window.electronAPI.getAppliedSystemFontPath();
    if (appliedSystemFontPath) {
        console.log('[FontManager] System font override detected. Clearing it.');
        // a. ストアからシステムフォントの設定を削除するよう、mainにお願いする
        await window.electronAPI.setAppliedSystemFontPath(null);
        // b. サイクルフォントのインデックスをリセットする
        currentFontIndex = -1; // -1にしておけば、次の行の+1でインデックス0から始まる
    }  

  if (availablefonts.length === 0) return;

  // インデックスを更新
  // targetIndexが指定されていればそれに、なければ次のインデックスに
    currentFontIndex = (targetIndex !== undefined)
        ? targetIndex
        : (currentFontIndex + 1) % availablefonts.length;
  const nextFontFile = availablefonts[currentFontIndex]; // 変数名を 'nextFontFile' に変更
  
  // ★★★ ここが修正ポイント ★★★
  // ファイル名（文字列）から、CSSで安全なファミリー名を生成
  const cssFontFamily = `my-editor-font-${nextFontFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
  console.log(`[cycleFont] Cycling to index ${currentFontIndex}`);
  try {
    // @font-faceを生成。メインプロセスにデータを要求する必要はない。
    // safe-resourceプロトコルがすべてを解決してくれる。
    const fontUrl = `safe-resource://fonts/${encodeURIComponent(nextFontFile)}`;
    const styleEl = document.getElementById('dynamic-font-styles') || document.createElement('style');
    styleEl.id = 'dynamic-font-styles';
    styleEl.textContent = `
      @font-face {
        font-family: '${cssFontFamily}';
        src: url('${fontUrl}');
      }
    `;
    document.head.appendChild(styleEl);
 

    // document.fonts.load()で待機
    await document.fonts.load(`16px "${cssFontFamily}"`);
    console.log(`Font loaded: ${cssFontFamily}`);
    document.documentElement.style.setProperty('--current-editor-font', cssFontFamily);
    // CodeMirrorに適用
    const newFontTheme = createFontTheme(cssFontFamily);
    console.log(`[cycleFont] Applying font theme: ${cssFontFamily}`);
    view.dispatch({ 
      effects: [
        fontFamily.reconfigure(newFontTheme),
        // ★ フォーカスを確実に当てるためのエフェクトを追加
      ]
    });
    view.focus()


    if (isPreviewOpen) {
      window.electronAPI.updatePreviewFont(cssFontFamily);
    }    

    // 設定を保存
    window.electronAPI.setFontIndex(currentFontIndex);

  } catch (error) {
    console.error("Failed to cycle font:", error);
  }
};
const cyclebg = () => {
  window.electronAPI.setCustomPath({ type: 'background', path: null });
  if (availablebgs.length === 0) return;
  document.body.classList.remove(`bg-index-${currentbgIndex}`);  
  currentbgIndex = (currentbgIndex + 1) % availablebgs.length;
  document.body.classList.add(`bg-index-${currentbgIndex}`);
  window.electronAPI.setbgIndex(currentbgIndex);
  document.body.style.removeProperty('background-image'); 
};
const cyclebgm = async () => {
  window.electronAPI.setCustomPath({ type: 'bgm', path: null });
  if (availablebgms.length === 0) return;
  currentbgmIndex = (currentbgmIndex + 1) % availablebgms.length;
  const bgmFile = availablebgms[currentbgmIndex];
  
  try {
    // 1. mainからBufferを取得
    const buffer = await window.electronAPI.getBgmBuffer(bgmFile);
    if (!buffer) throw new Error('BGM buffer is null');

    // 1. 受け取ったデータ (Uint8Array) を、文字コードの文字列に変換
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    
    // 2. その文字列を、btoa()でBase64にエンコード
    const base64 = window.btoa(binary);

    // 3. data: URLを生成
    const dataUrl = `data:audio/mpeg;base64,${base64}`;
    
    // 4. <audio>要素に設定して再生
    audioEl.src = dataUrl;
    audioEl.loop = true;
    await audioEl.play();
      document.getElementById('bgm-play-pause-btn')!.textContent = '❚❚';
      // 状態をストアに保存
      window.electronAPI.setbgmIndex(currentbgmIndex);
      window.electronAPI.setbgmPausedState(false);
    } catch (error) {
      console.error("bgm cycle play failed:", error);
      document.getElementById('bgm-play-pause-btn')!.textContent = '▶';
      window.electronAPI.setbgmPausedState(true);
    }
  };
const togglePlayPausebgm = async () => {
  console.log('[BGM] togglePlayPausebgm called.');
  
  if (audioEl.paused) {
    if (!audioEl.src && availablebgms.length > 0) {
      console.log('[BGM] No src, starting cycle...');
      await cyclebgm();
      return;
    }
    
    console.log(`[BGM] Attempting to play: ${audioEl.src}`);
    try {
      const playPromise = audioEl.play();
      console.log('[BGM] audioEl.play() returned a promise.');

      // タイムアウトを設定して、永遠のawaitを防ぐ
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Play promise timed out after 5 seconds')), 5000)
      );
      
      // 実際の再生とタイムアウトを競争させる
      await Promise.race([playPromise, timeoutPromise]);
      
      console.log('[BGM] Play promise resolved successfully.');
      document.getElementById('bgm-play-pause-btn')!.textContent = '❚❚';
    } catch (error) {
      // ★★★ ここに表示されるエラーが、真犯人です ★★★
      console.error("[BGM] Play failed:", error);
      document.getElementById('bgm-play-pause-btn')!.textContent = '▶';
    }
  } else {
    console.log('[BGM] Pausing...');
    audioEl.pause();
    document.getElementById('bgm-play-pause-btn')!.textContent = '▶';
  }
  
  window.electronAPI.setbgmPausedState(audioEl.paused);
};
const toggleTypeSound = () => {
    isTypeSoundEnabled = !isTypeSoundEnabled;
    const btn = document.getElementById('typesound-toggle-btn');
    if (btn) {
      btn.style.opacity = isTypeSoundEnabled ? '1.0' : '0.4';
    }
    window.electronAPI.setTypeSoundState(isTypeSoundEnabled);    
    console.log(`Type sound ${isTypeSoundEnabled ? 'ENABLED' : 'DISABLED'}`);
  };    

const toggleFocusMode = () => {
  isFocusMode = !isFocusMode;
  document.body.classList.toggle('focus-mode', isFocusMode);
  // ... (SnowEditorのコードにあった、スクロールバーの太さ変更などもここに)
  window.electronAPI.setFocusModeState(isFocusMode);
};

// --- [エリア 5: UI描画 & CodeMirrorテーマ] ---
const updateOutline = (currentLineNumber: number = 0) => {
    const outlineContainer = document.getElementById('outline-container');
    if (!outlineContainer) return;

    // イベント委任のために、コンテナに一度だけリスナーを設定（後述）

    outlineContainer.innerHTML = '';
    const fileListUl = document.createElement('ul');
    fileListUl.className = 'file-list';

    state.projectFiles.forEach(file => {
      const fileLi = document.createElement('li');
      fileLi.className = 'file-item';
      const fileNameDiv = document.createElement('div');
      fileNameDiv.className = 'file-name';

      const fileNameSpan = document.createElement('span');
      fileNameSpan.textContent = file.title;
      if (file.isDirty) fileNameSpan.textContent += ' *';
      fileNameSpan.addEventListener('click', () => switchFile(file.id));

      const TabCloseBtn = document.createElement('button');
      TabCloseBtn.className = 'close-tab-btn';
      TabCloseBtn.textContent = '×';
      TabCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFile(file.id);
      });

      fileNameDiv.appendChild(fileNameSpan);
      fileNameDiv.appendChild(TabCloseBtn);
      fileLi.appendChild(fileNameDiv);
      
      if (file.id === state.activeFileId) {
        fileLi.classList.add('active');
        const lines = file.state.doc.toString().split('\n');
        const headings = lines.map((line, i) => ({ line, i: i + 1 }))
                              .map(({ line, i }) => ({ match: line.match(/^(#+)\s+(.*)/), lineNumber: i }))
                              .filter(({ match }) => match)
                              .map(({ match, lineNumber }) => ({ text: match![2], level: match![1].length, lineNumber }));

        if (headings.length > 0) {
          const buildTreeDom = (parentElement: HTMLElement, parentLevel: number, startIndex: number): number => {
            const ul = document.createElement('ul');
            let i = startIndex;
            while (i < headings.length) {
              const heading = headings[i];
              if (heading.level > parentLevel) {
                const li = document.createElement('li');
                li.dataset.lineNumber = String(heading.lineNumber);
                const headingKey = `${file.id}:${heading.lineNumber}:${heading.text}`;
                li.dataset.headingKey = headingKey;                 
                const fileState = outlineCollapsedState.get(file.id);
                const isCollapsed = fileState?.get(li.dataset.headingKey) ?? true;
                li.dataset.collapsed = String(isCollapsed);

                const wrapper = document.createElement('div');
                wrapper.className = 'outline-item-wrapper';
                const nextHeadingLine = headings.find(h => h.lineNumber > heading.lineNumber)?.lineNumber || Infinity;
                if (currentLineNumber >= heading.lineNumber && currentLineNumber < nextHeadingLine) {
                  wrapper.classList.add('active');
                }
                
                const toggle = document.createElement('span');
                toggle.className = 'outline-toggle';
                toggle.classList.toggle('collapsed', isCollapsed);
                
                const text = document.createElement('span');
                text.className = 'outline-text';
                text.textContent = heading.text;
                // textへのリスナーはイベント委任で処理するので不要

                wrapper.appendChild(toggle);
                wrapper.appendChild(text);
                li.appendChild(wrapper);
                
                const childEndIndex = buildTreeDom(li, heading.level, i + 1);
                
                if (childEndIndex === i + 1) {
                  toggle.classList.add('empty');
                  toggle.innerHTML = '&bull;';
                } else {
                  toggle.textContent = '▼';
                }
                
                ul.appendChild(li);
                i = childEndIndex;
              } else {
                break;
              }
            }
            if (ul.hasChildNodes()) parentElement.appendChild(ul);
            return i;
          };
          buildTreeDom(fileLi, 0, 0);
        }
      }
      fileListUl.appendChild(fileLi);
    });
    outlineContainer.appendChild(fileListUl);
};







// --- [エリア 6: メイン実行ブロック (アプリケーションの起動)] ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. DOM要素をすべて取得 & ガード節
    const editorContainer = document.getElementById('container');
    const outlineContainer = document.getElementById('outline-container');
    // ... (すべてのボタンを取得)
    if (!editorContainer || !outlineContainer /* ... */) {
        console.error('FATAL: Core UI elements not found. App cannot start.');
        return;
    }

    // 2. CodeMirrorを初期化
    view = new EditorView({
        state: EditorState.create({
            doc: '',
            extensions: [
                history(),
                keymap.of([
                    ...historyKeymap,
                    ...searchKeymap,
                    { key: 'Mod-ArrowUp', run: (v) => { cursorDocStart(v); v.dispatch({ effects: EditorView.scrollIntoView(0, { y: "start" }) }); return true; }},
                    { key: 'Mod-ArrowDown', run: (v) => { cursorDocEnd(v); v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) }); return true; }},
                    { key: 'Ctrl-o', run: () => { openFileAction(); return true; } },
                    { key: 'Ctrl-s', run: () => { saveFileAction(); return true; } },
                ]),
                EditorView.lineWrapping,
                markdown({ base: markdownLanguage }),
                cursorTheme,
                themeCompartment.of(myLightTheme),
                fontFamily.of(dynamicFontTheme),
                fontSizeCompartment.of(EditorView.theme({ '&': { fontSize: `${currentFontSize}px` } })),
                highlightingCompartment.of(syntaxHighlighting(lightHighlightStyle)),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
                        if (activeFile) {
                            if (!activeFile.isDirty) {
                                activeFile.isDirty = true;
                                updateUI();
                            }
                        }
                        if (isTypeSoundEnabled && update.transactions.some(tr => tr.annotation(Transaction.userEvent))) {
                            typeSound.currentTime = 0;
                            typeSound.play().catch(() => {});
                        }
                    }
                    if (update.selectionSet || update.geometryChanged) {
                        if (rafId) cancelAnimationFrame(rafId);
                        rafId = requestAnimationFrame(() => {
                            updateOutlineHighlight(update.view);
                            updateBreadcrumbs(update.view);
                            rafId = 0;
                        });
                    }
                    if (update.docChanged || update.selectionSet) {
                        clearTimeout(previewUpdateTimeout);
                        previewUpdateTimeout = setTimeout(updatePreview, 300);
                    }
                    if (update.docChanged || update.selectionSet || update.geometryChanged) {
                        updateStatusBar();
                    }                     
                }),
            ],
        }),
        parent: editorContainer,
    });

    // 3. すべてのイベントリスナーを登録
    await initializeApp();

    // 4. 準備完了をメインプロセスに通知
    window.electronAPI.rendererReady();
});

/**
 * すべての非同期初期化とイベントリスナー登録を行う
 */
async function initializeApp() {
    // DOM要素の取得
    const newFileBtn = document.getElementById('new-file-btn');
    const openFileBtn = document.getElementById('open-file-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');
    const outlineContainer = document.getElementById('outline-container');
    const decreaseFontBtn = document.getElementById('decrease-font-btn');
    const resetFontBtn = document.getElementById('reset-font-btn');
    const increaseFontBtn = document.getElementById('increase-font-btn');
    const previewBtn = document.getElementById('preview-btn');
    const darkModeBtn = document.getElementById('dark-mode-btn');
    const minimizeBtn = document.getElementById('minimize-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const closeBtn = document.getElementById('close-btn');
    const openResourcesBtn = document.getElementById('open-resources-btn');
    const mainContent = document.getElementById('main-content');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const bgCycleBtn = document.getElementById('bg-cycle-btn');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const zenModeBtn = document.getElementById('zen-mode-btn');
    const cycleFontBtn = document.getElementById('cycle-font-btn');
    const bgmCycleBtn = document.getElementById('bgm-cycle-btn');
    const bgmPlayPauseBtn = document.getElementById('bgm-play-pause-btn');
    const typeSoundToggleBtn = document.getElementById('typesound-toggle-btn');
    const timeEl = document.getElementById('status-time');
    const settingsBtn = document.getElementById('settings-btn');
    const exportBtn = document.getElementById('export-btn');

    if (!outlineContainer || !collapseAllBtn /* ... */) {
        console.error("Initialization failed: UI elements are missing.");
        return;
    }

    // UIボタンのイベントリスナー
    newFileBtn?.addEventListener('click', addNewFile);
    openFileBtn?.addEventListener('click', openFileAction);
    collapseAllBtn.addEventListener('click', () => setAllHeadingsCollapsed(state.activeFileId, true));
    expandAllBtn?.addEventListener('click', () => setAllHeadingsCollapsed(state.activeFileId, false));
    bgCycleBtn?.addEventListener('click', cyclebg);
    cycleFontBtn?.addEventListener('click', () => cycleFont());
    minimizeBtn?.addEventListener('click', () => window.electronAPI.minimizeWindow());
    fullscreenBtn?.addEventListener('click', () => window.electronAPI.toggleFullScreen());
    closeBtn?.addEventListener('click', () => window.electronAPI.closeWindow());
    zenModeBtn?.addEventListener('click', () => {
      // 現在の状態を反転させた状態を、setZenModeに渡す
      setZenMode(!isZenMode); 
    });
    focusModeBtn?.addEventListener('click', toggleFocusMode);
    settingsBtn?.addEventListener('click', () => {
      window.electronAPI.toggleSettingsWindow(); 
    });    
    bgmCycleBtn?.addEventListener('click', cyclebgm);
    bgmPlayPauseBtn?.addEventListener('click', togglePlayPausebgm);
    typeSoundToggleBtn?.addEventListener('click', toggleTypeSound);
    decreaseFontBtn?.addEventListener('click', () => updateFontSize(currentFontSize - 1));
    resetFontBtn?.addEventListener('click', () => updateFontSize(16)); // デフォルトサイズにリセット
    increaseFontBtn?.addEventListener('click', () => updateFontSize(currentFontSize + 1));
    previewBtn?.addEventListener('click', openPreview);
    openResourcesBtn?.addEventListener('click', () => {
    window.electronAPI.openResourcesFolder();
  });
    darkModeBtn?.addEventListener('click', () => {
    window.electronAPI.toggleDarkMode(); 
  });
exportBtn?.addEventListener('click', () => {
  const activeFile = state.projectFiles.find(f => f.id === state.activeFileId);
  if (activeFile?.filePath) {
    window.electronAPI.openExportWindow(activeFile.filePath); 
  } else {
    alert('ファイルを一度保存してください。');
  }
});

    mainContent?.addEventListener('contextmenu', (event) => {
      // 1. イベントの発生源が、エディタかその子孫であるかをチェック
      const editorRootEl = view.dom;
      if (editorRootEl.contains(event.target as Node)) {
        // もしエディタ内部なら、CodeMirror自身のハンドラに任せるので何もしない
        return;
      }
      
      // 2. イベントの発生源が、アウトラインかその子孫であるかをチェック
      const outlinePanel = document.getElementById('outline-panel');
      if (outlinePanel?.contains(event.target as Node)) {
        // アウトライン上ではメニューを出さない、という仕様ならここでreturn
        // もしアウトライン上でもエディタと同じメニューを出したいなら、このifは不要
      
        return;
      }
      
      // 3. 上記以外（余白など）で右クリックされた場合
      event.preventDefault();
      showEditorContextMenu(view); // エディタのコンテキストメニューを出す
    });  

    // イベント委任リスナー
    outlineContainer.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const toggle = target.closest('.outline-toggle');
      const text = target.closest('.outline-text');
      
      // トグルのクリック処理
      if (toggle && !toggle.classList.contains('empty')) {
        const li = toggle.closest('li');
        const headingKey = li?.dataset.headingKey;
        if (li && headingKey && state.activeFileId) {
          const fileState = outlineCollapsedState.get(state.activeFileId);
          const currentState = fileState?.get(headingKey) ?? true;
          const newState = !currentState;
          fileState?.set(headingKey, newState);
          li.dataset.collapsed = String(newState);
          toggle.classList.toggle('collapsed', newState);
        }
      }
      
      // テキストのクリック処理
      if (text) {
          const li = text.closest('li');
          const headingKey = li?.dataset.headingKey;
          if (headingKey) {
              const [, lineNumberStr] = headingKey.split(':');
              const lineNumber = parseInt(lineNumberStr, 10);
              const line = view.state.doc.line(lineNumber);
              view.dispatch({
                selection: { anchor: line.from },
                effects: EditorView.scrollIntoView(line.from, { y: "center" })
              });
              view.focus();
          }
      }
    });  
    document.body.addEventListener('contextmenu', (event) => {
      // クリックされた場所が、エディタかその子孫であるかをまず確認
      if (!view.dom.contains(event.target as Node)) {
        // エディタ外なら何もしない（OSのデフォルトメニューなどを表示）
        return;
      }
  
  // エディタ内（ウィジェットや余白も含む）なら、必ずメニューを表示
  event.preventDefault();
  
  // 既存の showEditorContextMenu を呼び出す
  showEditorContextMenu(view);
});

    // IPCリスナー
    window.electronAPI.onOpenFile(openFileAndSwitch);
    window.electronAPI.onOpenFileInNewTab(openFileInBackground);
    window.electronAPI.onTriggerNewFile(addNewFile);
    window.electronAPI.onTriggerOpenFile(() => {
      openFileAction();
    });
    window.electronAPI.onTriggerSaveFile(() => {
      saveFileAction(); 
    });
    window.electronAPI.onTriggerSaveAsFile(() => {
      saveFileAction(true); 
    });  
    window.electronAPI.onTriggerSnowToggle(() => {
    // ★ プレビューウィンドウに「雪の状態を切り替えて」とお願いする
    window.electronAPI.togglePreviewSnow();
    });
    window.electronAPI.onTriggerbgCycle(cyclebg);  
    window.electronAPI.onTriggerFontCycle(() => cycleFont());
    window.electronAPI.onTriggerZenMode(() => {
      setZenMode(!isZenMode);
    });
    window.electronAPI.onToggleOutlineShortcut(() => {
      toggleOutlinePanelVisibility();
    });  
    window.electronAPI.onTriggerFocusMode(toggleFocusMode);
    window.electronAPI.onTriggerbgmCycle(cyclebgm);
    window.electronAPI.onTriggerbgmPlayPause(togglePlayPausebgm);
    window.electronAPI.onTriggerTypeSoundToggle(toggleTypeSound);  
    window.electronAPI.onTriggerTogglePreview(() => {openPreview();});
  window.electronAPI.onChangefontsize((action) => {
      if (action === 'increase') updateFontSize(currentFontSize + 1);
      if (action === 'decrease') updateFontSize(currentFontSize - 1);
      if (action === 'reset') updateFontSize(16);
      if (action === 'reset20') updateFontSize(20);
  });  
  window.electronAPI.onRequestUnsavedChangesCheck(() => {
    const hasChanges = state.projectFiles.some(f => f.isDirty);
    console.log(`[Renderer] Responding to unsaved check. Has changes: ${hasChanges}`);
    window.electronAPI.responseUnsavedChanges(hasChanges);
  });
  window.electronAPI.onRequestSessionSave(() => {
    const filePaths = state.projectFiles.map(f => f.filePath);
    // mainにセッションデータを送信
    window.electronAPI.sessionSave(filePaths.filter((p): p is string => p !== null));
    // 保存が終わったことをmainに"通知"
    window.electronAPI.sessionSaved();
    console.log('[Renderer] Session data sent. Notifying main process.');
  });
    window.electronAPI.onThemeUpdated((isDarkMode) => {
    applyTheme(isDarkMode);
  });
  // プレビューウィンドウが（ユーザーによって×ボタンで）閉じられたことをmainから通知してもらう
  window.electronAPI.onPreviewHasBeenClosed(() => {
    console.log('[Renderer] Preview window was closed.');
    isPreviewOpen = false; // 状態を同期する
  });
  // プレビューウィンドウからフォントサイズ変更の要求が来た場合（プレビュー側でのCtrl+/-など）
  window.electronAPI.onPreviewfontsizeChange((size) => {
      updateFontSize(size); // 既存のフォントサイズ変更関数を呼ぶ
  });
  window.electronAPI.onCycleTab((direction) => {
    cycleTab(direction);
  });
  window.electronAPI.onApplySystemFontFromSettings(async (fontData) => {
    console.log(`[Renderer] Applying system font from settings: ${fontData.cssFontFamily}`);
    // ★ 共通関数を呼び出すだけ
    await applyFont(fontData); 
  });



// ★★★ settingsウィンドウからの、直接のメッセージを受け取る ★★★
window.interop.onMainMessage('revert-to-cycle-bgm', () => {
  console.log('[Renderer] Reverting to cycle BGM...');
  cyclebgm();
});

// ★ settingsウィンドウからの「サイクルに戻して」というメッセージを受け取る
window.interop.onMainMessage('revert-to-cycle-bg', () => {
  console.log('[Renderer] Reverting to cycle background...');  
  // ★★★ 1. 強力なインラインスタイルを、"完全に削除"する ★★★
  document.body.style.removeProperty('background-image');  
  // ★★★ 2. サイクル機能を、改めて呼び出す ★★★
  //    (これにより、正しい.bg-index-Nクラスが、再びbodyに適用される)
  cyclebg();
});

window.interop.onMainMessage('apply-custom-bgm', async (filePath) => {
  console.log('[Renderer] Applying custom BGM from path:', filePath);
  // ★ 既存の、安全なdata:URL生成ロジックをここで実行
  const dataUrl = await window.electronAPI.getBgmDataUrl(filePath);
  if (dataUrl) {
    audioEl.src = dataUrl;
    audioEl.play().catch(() => {});
    document.getElementById('bgm-play-pause-btn')!.textContent = '❚❚';
    window.electronAPI.setbgmPausedState(false);
  }
});

window.interop.onMainMessage('apply-custom-background', async (filePath) => {
  console.log('[Renderer] Applying custom background from path:', filePath);
  
  // 1. まず、既存のサイクル用クラスをすべて削除
  document.body.className = document.body.className.replace(/\s?bg-index-\d+/g, '');

  // 2. mainに、data: URLを要求する
  const dataUrl = await window.electronAPI.getBackgroundDataUrl(filePath);
  
  if (dataUrl) {
    // 3. ★★★ インラインスタイルで、背景画像を"直接"上書きする ★★★
    document.body.style.backgroundImage = `url('${dataUrl}')`;
  }
});


  window.electronAPI.onRequestExportWindow(() => {
  const exportBtn = document.getElementById('export-btn');
  exportBtn?.click(); // 既存のボタンのクリックイベントをプログラムから発火させる
});


  if (timeEl) {
    // 最初に一度時刻を設定
    const updateTime = () => {
      const now = new Date();
      timeEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };
    updateTime();
    // ★ 1分ごとに更新すれば十分
    setInterval(updateTime, 60000); 
  }

    // 非同期の状態初期化

  // ★★★ まず、サイクル用のフォントリストを"必ず"読み込んでおく ★★★
  availablefonts = await window.electronAPI.getFontList();    
  // ★★★ 1. まず、保存されたシステムフォントがあるかチェック ★★★
  const appliedSystemFontPath = await window.electronAPI.getAppliedSystemFontPath();
  let fontInitializedBySystemFont = false;

  if (appliedSystemFontPath) {
    console.log(`[Init] Applying saved system font: ${appliedSystemFontPath}`);
    await applyFont({ path: appliedSystemFontPath }); 
    fontInitializedBySystemFont = true;
  }
  
  // ★ 2. なければ、通常のサイクルフォントを初期化
  //    (availablefontsは既に読み込み済み)
  if (!fontInitializedBySystemFont && availablefonts.length > 0) {
    currentFontIndex = (await window.electronAPI.getFontIndex() || 0) - 1;
    await cycleFont();
  }

    const isDarkMode = await window.electronAPI.getDarkModeState();
    applyTheme(isDarkMode);
    
  isFocusMode = await window.electronAPI.getFocusModeState();
  if (isFocusMode) {
    document.body.classList.add('focus-mode');
  }

  isZenMode = await window.electronAPI.getZenModeState();
  if (isZenMode) {
    // ★ 初期化時も、setZenModeを呼ぶことで状態の整合性を保つ
    setZenMode(true); 
  }

// ★背景とBGMの初期化  
//  1. まず、ストアに保存されたカスタムパスがあるか確認
  const customPaths = await window.electronAPI.getCustomPaths();

// 2. 背景の初期化
// a) サイクル機能はどちらにせよ初期化（これをしないとサイクル機能が機能しない）
  console.log('[Init] Initializing cycle backgrounds...');
  availablebgs = await window.electronAPI.getbgList();
  if (availablebgs.length > 0) {
    // b. @font-faceと同じ要領で、背景画像用の<style>タグを生成
    const bgStyleEl = document.createElement('style');
    bgStyleEl.id = 'dynamic-background-styles';
    bgStyleEl.textContent = availablebgs.map((bgFile, index) => {
      // safe-resourceプロトコルで、安全にローカルファイルを参照
      const bgUrl = `safe-resource://background/${encodeURIComponent(bgFile)}`;
      // body.bg-index-N というクラスが適用されたときのスタイルを定義
      return `
        body.bg-index-${index} {
          background-image: url('${bgUrl}');
        }
      `;
    }).join('\n');
    document.head.appendChild(bgStyleEl);
    // 保存されたインデックスを読み込む
    const savedbgIndex = await window.electronAPI.getbgIndex();
    currentbgIndex = savedbgIndex ?? 0;    
  }
  // b) カスタム背景があれば最優先で適用
  if (customPaths.background) {
  console.log('[Init] Applying custom background:', customPaths.background);
    const dataUrl = await window.electronAPI.getBackgroundDataUrl(customPaths.background);
    if (dataUrl) {
      document.body.style.backgroundImage = `url('${dataUrl}')`;
      document.body.className = document.body.className.replace(/\s?bg-index-\d+/, '');
    }
  } else {
  // c) なければ従来のサイクル背景を適用
  document.body.classList.add(`bg-index-${currentbgIndex}`);
}


// 3. BGMの初期化
let initialBgmLoaded = false;
// a) サイクル機能はどちらにせよ初期化
  console.log('[Init] Initializing cycle BGM...');
  availablebgms = await window.electronAPI.getbgmList();
  const savedbgmindex = await window.electronAPI.getbgmIndex();

  if (savedbgmindex > -1 && savedbgmindex < availablebgms.length) {
    currentbgmIndex = savedbgmindex;
    const bgmFile = availablebgms[currentbgmIndex];
    
    // 起動時にも、BGMデータをBufferとして取得する
    const buffer = await window.electronAPI.getBgmBuffer(bgmFile);
    if (buffer) {
      // 取得したBufferから、data: URLを生成
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
      }
      const base64 = window.btoa(binary);
      let dataUrl = `data:audio/mpeg;base64,${base64}`;

      // <audio>要素に、再生可能なソースを設定
      audioEl.src = dataUrl;
      audioEl.loop = true;
      initialBgmLoaded = true;
      console.log(`[Init] BGM loaded successfully: ${bgmFile}`);
    }
  }

    // b) カスタムBGMがあれば適用
  if (customPaths.bgm) {
    console.log('[Init] Applying custom BGM:', customPaths.bgm);
    // ★ 1. mainに、data: URLを直接問い合わせ、"完了を待つ"
    let dataUrl = await window.electronAPI.getBgmDataUrl(customPaths.bgm);
    
    if (dataUrl) {
      // ★ 2. 確実にsrcを設定してから、フラグを立てる
      audioEl.src = dataUrl;
      audioEl.loop = true;
      initialBgmLoaded = true;
    }
  } 

  // 4. 再生状態の復元 (共通)
  const isbgmpaused = await window.electronAPI.getbgmPausedState();
  if (bgmPlayPauseBtn) {
    bgmPlayPauseBtn.textContent = isbgmpaused ? '▶' : '❚❚';
  }
  // もし「再生状態」で、かつ「ソースの読み込みに成功」していれば、再生を試みる
  if (!isbgmpaused && initialBgmLoaded) {
    try { 
      await audioEl.play(); 
      console.log('[Init] BGM auto-play started.');
    } catch(e) { 
      console.warn("BGM auto-play was blocked by the browser.");
      // 自動再生がブロックされた場合は、UIをポーズ状態に戻すのが親切
      if (bgmPlayPauseBtn) bgmPlayPauseBtn.textContent = '▶';
      window.electronAPI.setbgmPausedState(true);
    }
  }

  // b) タイプ音の初期化
  isTypeSoundEnabled = await window.electronAPI.getTypeSoundState();
  if (typeSoundToggleBtn) typeSoundToggleBtn.style.opacity = isTypeSoundEnabled ? '1.0' : '0.4';
  // フォントサイズ初期化
  const savedSize = await window.electronAPI.getfontsize();
  if (savedSize) updateFontSize(savedSize);  
    
    view.focus();
}