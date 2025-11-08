// --- 型定義 ---
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// --- DOM要素の取得 ---
const chatLog = document.getElementById('chat-log')!;
const chatForm = document.getElementById('chat-form')!;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const aiCloseBtn = document.getElementById('ai-close-btn');
const aiFullscreenBtn = document.getElementById('ai-fullscreen-btn');
const saveLogBtn = document.getElementById('ai-save-log-btn');
const saveLogOWBtn = document.getElementById('ai-save-overwrite-btn');
const loadLogBtn = document.getElementById('ai-load-log-btn');
const clearLogBtn = document.getElementById('ai-clear-log-btn');
const chatContainer = document.getElementById('chat-container')!;
const TRANSPARENT_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// ... (他のボタン要素への参照)

// --- アプリケーションの状態 ---
let isEditing = false; 
let isRegenerating = false;
let chatHistory: ChatMessage[] = [];
let aiChatSettings = {
    userName: 'User', userIcon: '',
    assistantName: 'AI', assistantIcon: '',
};
let chatIsDirty = false;
(window as any).chatIsDirtyState = chatIsDirty;

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', async () => {
  await updateGlobalSettings();
  // 1. mainから、現在のテーマ設定を受け取る (フリッカー防止)
  const isDarkMode = await window.electronAPI.getStoreValue('isDarkMode', false);
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
  }

  // 2. 過去のチャットセッションを復元 (もし実装するなら)
  // chatHistory = await window.electronAPI.loadAiChatSession();
  renderFullChatLog();

  // 3. イベントリスナーを設定
  chatForm.addEventListener('submit', handleFormSubmit);
  aiCloseBtn?.addEventListener('click', () => {
    // mainプロセスに、このウィンドウを閉じるよう依頼する
    window.electronAPI.closeAiChatWindow();
  });

  aiFullscreenBtn?.addEventListener('click', () => {
    // mainプロセスに、このウィンドウの最大化をトグルするよう依頼する
    window.electronAPI.requestToggleFullscreen();
  });

  // 保存ボタン 
  saveLogBtn?.addEventListener('click', () => {
      window.electronAPI.saveAiChatLog(chatHistory, 'pastel');
      chatIsDirty = false;
      (window as any).chatIsDirtyState = chatIsDirty;
  });
  saveLogOWBtn?.addEventListener('click', () => {
      window.electronAPI.saveAiChatLogOverwrite(chatHistory);
      chatIsDirty = false;
      (window as any).chatIsDirtyState = chatIsDirty;
  });  

  // 読み込みボタン
  loadLogBtn?.addEventListener('click', async () => {
      const history = await window.electronAPI.loadAiChatLog();
      if (history) {
          chatHistory = history;
          renderFullChatLog();
          chatIsDirty = false;
          (window as any).chatIsDirtyState = chatIsDirty;
      }
  });

  // ログ消去ボタン
  clearLogBtn?.addEventListener('click', () => {
      handleClear();
  });  

  // a) テーマ変更に追従
  window.electronAPI.onThemeUpdated((isDarkMode) => {
    document.body.classList.toggle('dark-mode', isDarkMode);
  });

  // b) フォントサイズ変更に追従
  window.electronAPI.onGlobalFontSizeChange((action) => {
    // 現在のフォントサイズを取得
    const currentSize = parseFloat(window.getComputedStyle(document.body).fontSize);
    let newSize = currentSize;

    if (action === 'increase') newSize += 1;
    if (action === 'decrease') newSize -= 1;
    if (action === 'reset') newSize = 15; 
    if (action === 'reset20') newSize = 20;

    document.body.style.fontSize = `${newSize}px`;
  });


  // c) キーボードショートカット 
  window.addEventListener('keydown', (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    // もし、入力エリアにフォーカスがあれば、ショートカットは発動させない
    if (document.activeElement === messageInput) {
      return;
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
    // ダークモード
    if (isCtrlOrCmd && e.code === 'KeyT') {
      e.preventDefault();
      window.electronAPI.toggleDarkMode(); 
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

  messageInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleFormSubmit(new Event('submit'));
    }
  });

    // 入力エリアの自動伸縮機能 
  if (messageInput) {
    const maxHeight = 240; 
    messageInput.addEventListener('input', () => {
      // a) 一旦高さをリセットして、現在の内容でのscrollHeightを計算させる
      messageInput.style.height = 'auto';
      // b) 計算された高さが、最大高さを超えていなければ、その高さを適用
      const newHeight = Math.min(messageInput.scrollHeight, maxHeight);
      messageInput.style.height = `${newHeight}px`;
    });
  }

    // --- mainプロセスからの指令を待ち受けるリスナー ---
    window.electronAPI.on('trigger-ai-chat-clear', () => {
      handleClear();
    });

    window.electronAPI.on('trigger-ai-chat-load', async () => {
      const history = await window.electronAPI.loadAiChatLog();
      if (history) {
        chatHistory = history;
        renderFullChatLog();
        // (セッション保存)
      }
    });

    window.electronAPI.on('trigger-ai-chat-save', () => {
      window.electronAPI.saveAiChatLog(chatHistory, 'pastel');
      chatIsDirty = false;
      (window as any).chatIsDirtyState = chatIsDirty;      
    });

    window.electronAPI.on('trigger-ai-chat-overwrite-save', () => {
      window.electronAPI.saveAiChatLogOverwrite(chatHistory);
      chatIsDirty = false;
      (window as any).chatIsDirtyState = chatIsDirty;      
    });

    window.electronAPI.on('trigger-ai-chat-to-editor', () => {
        // 1. 現在のチャット履歴を、テキスト形式に変換
        const textContent = chatHistory.map(m => 
            `■ ${m.role === 'user' ? 'User' : 'AI'}\n\n${m.content}`
        ).join('\n\n---\n\n');
        
        // 2. mainプロセスに、タイトルと内容を送る
        window.electronAPI.sendChatToEditor('AI Chat Log', textContent);
    });

    window.electronAPI.on('load-ai-chat-session', async (filePath: string) => {
        // mainに、そのファイルを読み込んでパースするよう依頼
        const history = await window.electronAPI.loadAiChatLogByPath(filePath); 
        if (history) {
            chatHistory = history;
            renderFullChatLog();
        }
    });

    window.electronAPI.on('ai-chat-settings-updated', async () => {
      await updateGlobalSettings();
      renderFullChatLog(); // アイコンや名前が変わる可能性があるので、ログも再描画
});

    window.electronAPI.on('request-chat-dirty-state', () => {
      window.electronAPI.responseChatDirtyState(chatIsDirty);
    });

});

// --- UI更新 ---
async function renderFullChatLog() {
    chatLog.innerHTML = '';
    
    // ★ 描画の前に、最新の設定を一度だけ取得する
    await updateGlobalSettings();

    // ★ シンプルに、chatHistoryをループして、addMessageToLogを呼び出すだけ
    chatHistory.forEach((message, index) => {
        if (message.role === 'system') return;
        addMessageToLog(message.role, message.content, index);
    });
}

async function updateGlobalSettings() {
    aiChatSettings.userName = await window.electronAPI.getStoreValue('aiChatUserName', 'User');
    aiChatSettings.userIcon = await window.electronAPI.getStoreValue('aiChatUserIconDataUrl', '');
    aiChatSettings.assistantName = await window.electronAPI.getStoreValue('aiChatAssistantName', 'AI');
    aiChatSettings.assistantIcon = await window.electronAPI.getStoreValue('aiChatAssistantIconDataUrl', '');
}

function addMessageToLog(role: 'user' | 'assistant', content: string, id: number): HTMLElement {
    const messageRow = document.createElement('div');
    messageRow.className = `message-row ${role}`;
    messageRow.dataset.messageId = String(id);

    // 1. すべてを内包する「アバター」コンテナを作成
    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'avatar-container';

    // 2. アイコンを作成
    const icon = document.createElement('img');
    icon.className = 'message-icon';
    let iconSrc = role === 'user' ? aiChatSettings.userIcon : aiChatSettings.assistantIcon;
    // もしパスがなければ、透明な画像を使う
    if (!iconSrc) {
        iconSrc = TRANSPARENT_ICON;
    }
    icon.src = iconSrc;

    // 3. アクションボタンを作成 (常時表示)
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  if (role === 'user') {
    // --- ユーザーメッセージ用のボタン ---
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn btn-edit';
    editBtn.title = '編集';
    editBtn.onclick = () => handleEdit(id); // ★

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn btn-delete';
    deleteBtn.title = 'このメッセージ以降を削除';
    deleteBtn.onclick = () => handleDelete(id); // ★

    actions.append(editBtn, deleteBtn);
  } else {
    // --- AIメッセージ用のボタン ---
    const regenBtn = document.createElement('button');
    regenBtn.className = 'action-btn btn-regenerate';
    regenBtn.title = '再生成';
    regenBtn.onclick = () => handleRegenerate(id); // ★

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn btn-copy';
    copyBtn.title = '内容をコピー';
    copyBtn.onclick = () => {
        window.electronAPI.writeToClipboard(content);
    };
    
  actions.append(regenBtn, copyBtn);
  }
 
    // 4. アバターコンテナに、アイコンとボタンを格納
    avatarContainer.append(icon, actions);

    // 5. メッセージ本体を作成
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    const senderName = document.createElement('div');
    senderName.className = 'message-sender';
    // ★ グローバル変数から、同期的に値を取得
    senderName.textContent = role === 'user' ? aiChatSettings.userName : aiChatSettings.assistantName;

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    messageBubble.textContent = content;

    messageContent.append(senderName, messageBubble);  

    // 6. 最終的な組み立て
messageRow.append(avatarContainer, messageContent);

  chatLog.appendChild(messageRow);
  chatLog.scrollTop = chatLog.scrollHeight;
  return messageRow;
}

async function handleClear() {
    const confirmed = await window.electronAPI.confirmDialog('現在のチャットログをすべて消去しますか？');
    if (confirmed) {
        chatHistory = [];
        renderFullChatLog();
        window.electronAPI.setStoreValue('lastAiChatSessionPath', null);
        chatIsDirty = true;
        (window as any).chatIsDirtyState = chatIsDirty;
    }
}

// ★ 編集 (handleEdit)
function handleEdit(id: number) {
    if (isEditing) return;
    isEditing = true;
    updateUiLockState();

    // 1. 対象のメッセージのDOM要素を取得
    const row = chatLog.querySelector(`[data-message-id='${id}']`);
    if (!row) { isEditing = false; return; }
    const bubble = row.querySelector('.message-bubble') as HTMLElement | null;
    if (!bubble) { isEditing = false; return; }
    
    // 2. 元のテキストを保持し、バブルを非表示に
    const originalContent = chatHistory[id].content;
    bubble.style.display = 'none';

    // 3. 編集用のtextareaとボタンを作成 
    const editContainer = document.createElement('div');
    editContainer.className = 'edit-container';
    
    const textarea = document.createElement('textarea');
    textarea.value = originalContent;
    textarea.rows = 3; // 初期サイズ
    
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'OK';
    saveBtn.onclick = async () => {
        const newText = textarea.value.trim();
        if (newText && newText !== originalContent) {
            // a) 履歴を切り捨てる
            chatHistory = chatHistory.slice(0, id); 
            // b) 新しい内容で、新しいメッセージとして追加する方が、履歴管理としてよりクリーン
            chatHistory.push({ role: 'user', content: newText }); 
            chatIsDirty = true;
            (window as any).chatIsDirtyState = chatIsDirty;
            // c) UIを再描画
            renderFullChatLog();
            // d) AIに応答をリクエスト
            await requestAiResponse();
        } else {
            // 変更がなければ、元に戻すだけ
            bubble.style.display = 'block';
            editContainer.remove();
        }
        isEditing = false;
        updateUiLockState();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
        bubble.style.display = 'block';
        editContainer.remove();
        isEditing = false;
        updateUiLockState();
    };

    textarea.className = 'cyber-text';
    editContainer.className = 'cyber-container';
    saveBtn.className = 'cyber-button';
    cancelBtn.className = 'cyber-button';

    buttonContainer.append(saveBtn, cancelBtn);
    editContainer.append(textarea, buttonContainer);
    
    // 4. バブルの代わりに、編集UIを挿入
    bubble.parentElement?.appendChild(editContainer);
    textarea.focus();
}

// ★ このメッセージ以降を削除 (handleDelete)
async function handleDelete(id: number) {
  // ユーザーに確認を求める (mainプロセス経由)
  const confirmed = await window.electronAPI.confirmDialog('このメッセージ以降の履歴をすべて削除しますか？');
  if (confirmed) {
    chatHistory = chatHistory.slice(0, id); // ユーザーのメッセージは残す
    chatIsDirty = true;
    (window as any).chatIsDirtyState = chatIsDirty;
    renderFullChatLog();
    // (セッション保存のロジックも、ここに追加)
  }
}

// ★ 再生成 (handleRegenerate)
async function handleRegenerate(id: number) {
  if (isRegenerating) return;
  try {
    isRegenerating = true;
    updateUiLockState();
  // 履歴を、このAIの発言の「前」の状態に戻す
  chatHistory = chatHistory.slice(0, id);
  chatIsDirty = true;
  (window as any).chatIsDirtyState = chatIsDirty;
  const allMessageRows = chatLog.querySelectorAll('.message-row');
  allMessageRows.forEach(row => {
    const rowId = parseInt((row as HTMLElement).dataset.messageId || '-1', 10);
    // 削除基点となったメッセージID「以降」の要素を、すべて取り除く
    if (rowId >= id) {
      row.remove();
    }
  });
  // AIに応答をリクエストする（これは、新しい「思考中」バルーンを追加するだけ）
  await requestAiResponse();
    } finally {
    isRegenerating = false;
    updateUiLockState();
  }
}

function updateUiLockState() {
    const isLocked = isEditing || isRegenerating;

    // a) 上部のボタンコンテナ
    const topButtons = document.querySelector('.top-right-buttons') as HTMLElement;
    if (topButtons) {
        topButtons.style.pointerEvents = isLocked ? 'none' : 'auto';
        topButtons.style.opacity = isLocked ? '0.5' : '1.0';
    }

    // b) 送信フォーム
    const sendButton = document.getElementById('send-btn') as HTMLButtonElement;
    if (sendButton) sendButton.disabled = isLocked;
    if (messageInput) messageInput.disabled = isLocked;

    // c) メッセージごとのアクションボタン
    document.querySelectorAll('.action-btn').forEach(btn => {
        (btn as HTMLButtonElement).disabled = isLocked;
    });
}

function showNotification(message) {
    const container = document.getElementById('notification-container');
    const notification = document.createElement('div');
    notification.className = 'toast-notification';
    notification.textContent = message;
    if(!container)return;
    container.appendChild(notification);
    
    // 表示アニメーション
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // 3秒後に消える
    setTimeout(() => {
        notification.classList.remove('show');
        // アニメーションが終わったらDOMから削除
        notification.addEventListener('transitionend', () => notification.remove());
    }, 3000);
}

// --- イベントハンドラ ---
async function handleFormSubmit(e: Event) {
  e.preventDefault();
  const userInput = messageInput.value.trim();
  if (!userInput) return;
  
  chatHistory.push({ role: 'user', content: userInput });
  chatIsDirty = true;
  (window as any).chatIsDirtyState = chatIsDirty;
  addMessageToLog('user', userInput, chatHistory.length - 1);
  messageInput.value = '';
  
  // 高さリセット
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  
  await requestAiResponse();
}

// --- 右クリックメニュー ---
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  
  // どのテキストが選択されているかをチェック
  const selection = window.getSelection()?.toString();
  
  // メニューの設計図を作成
  const blueprint = [
    { id: 'ai-chat-clear', label: '新規作成 (ログをクリア)' },
    { type: 'separator' },
    { id: 'ai-chat-load', label: 'ログを読み込む...' },
    { id: 'ai-chat-save', label: 'ログを名前を付けて保存...' },
    { id: 'ai-chat-to-editor', label: 'メインエディタに送る' },
    { type: 'separator' },
    // 選択中のテキストがある場合のみ「コピー」を有効にする
    { role: 'copy', label: 'コピー', enabled: !!selection },
    { role: 'paste', label: '貼り付け' },
    { type: 'separator' },
    { id: 'ai-chat-close', label: 'ウィンドウを閉じる' },
  ];
  
  // mainプロセスに、この設計図を渡して、メニューの表示を依頼
  window.electronAPI.showContextMenuFromBlueprint(blueprint);
});




// ★★★ AI対話ロジック ★★★
async function requestAiResponse() {
  const selectedApi = await window.electronAPI.getStoreValue('selectedApi', 'gemini');
  
  const thinkingRow = addMessageToLog('assistant', '...', chatHistory.length);
  const thinkingBubble = thinkingRow.querySelector('.message-bubble');
  if (thinkingBubble) (thinkingBubble as HTMLElement).textContent = '...';

  try {
    let result;
    // 最後のユーザーメッセージを取得 
    const lastUserMessage = chatHistory.findLast(m => m.role === 'user');
    if (!lastUserMessage) throw new Error("No user message to respond to.");

    // それ以前の履歴を取得
    const historyContext = chatHistory.slice(0, -1);
    
    // --- API呼び出しの分岐 ---
    if (selectedApi === 'gemini') {
      const apiKey = await window.electronAPI.getStoreValue('geminiApiKey', '');
      if (!apiKey) throw new Error('Gemini API Key not set.');
      result = await window.electronAPI.requestGeminiResponse(apiKey, historyContext, lastUserMessage.content);
    
    } else if (selectedApi === 'lm-studio') {
      result = await window.electronAPI.requestLmStudioResponse(chatHistory); // LM Studioは全履歴を送る    
    } 

    // --- 応答の処理 ---
    if (result?.success && result.text) {
      chatHistory.push({ role: 'assistant', content: result.text });
      chatIsDirty = true;
      (window as any).chatIsDirtyState = chatIsDirty;
      thinkingRow.remove();
      addMessageToLog('assistant', result.text, chatHistory.length - 1);
      // (セッション保存のロジックも、ここに)
    } else {
      throw new Error(result?.error || `Unknown error from ${selectedApi}`);
    }
  } catch (error) {
    if (thinkingBubble) (thinkingBubble as HTMLElement).textContent = `エラー: ${error}`;
  }
}