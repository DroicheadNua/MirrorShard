 import Konva from 'konva';
let stage: Konva.Stage;
let layer: Konva.Layer;
let isInitialized = false;

// リンクの種類を定義
enum LinkType {
  LINE = 'line',
  ARROW = 'arrow',
  DOUBLE_ARROW = 'double_arrow',
}

// 座標オブジェクトの型を定義
type Vector2d = {
  x: number;
  y: number;
};

export function initializeIdeaProcessor() {
    if (isInitialized) {
    console.warn("initializeIdeaProcessor was called more than once. Aborting subsequent calls.");
    return;
  }
  isInitialized = true;
  console.log("--- initializeIdeaProcessor Started ---");

// --- 初期設定 ---
  stage = new Konva.Stage({
    container: 'ip-container',
    width: window.innerWidth,
    height: window.innerHeight,
  });
  layer = new Konva.Layer();
  stage.add(layer);

  const editorPane = document.getElementById('ip-editor-pane')!;
  const contentEditor = document.getElementById('ip-content-editor') as HTMLTextAreaElement;
  const konvaContainer = document.getElementById('ip-container')!;

  //  Konvaコンテナのサイズを監視し、ステージサイズを追従させる 
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      stage.width(width);
      stage.height(height);
    }
  });
  resizeObserver.observe(konvaContainer);  

// --- ウィンドウのリサイズ処理 ---
// ★ 実際の処理を、関数として切り出す
const handleResize = () => {
  stage.width(window.innerWidth);
  stage.height(window.innerHeight);
};

// ★ デバウンス化した関数を作成 (100ミリ秒 = 0.1秒待つ)
const debouncedResize = debounce(handleResize, 100);

// ★ イベントリスナーには、デバウンス化した関数を登録する
window.addEventListener('resize', debouncedResize);

// --- グローバルな状態管理 ---
let selectedShape: Konva.Group | null = null;
let currentFilePath: string | null = null; 
let isDirty = false;
let isHistoryEnabled = true;
let isTextEditing: boolean = false;
let isContentEditing: boolean = false;
let contentEditorJustClosed = false;
let currentlyEditingNodeId: string | null = null;
let isPanning = false;
let didPan = false; // ドラッグが発生したかを記録するフラグ
let lastPointerPosition: { x: number; y: number };
let selectionJustFinished = false;
const outlinePane = document.getElementById('ip-outline-content')!;
// ファイルごとではなく、単一の折りたたみ状態を管理
const outlineCollapsedState = new Map<string, boolean>(); // key: groupId, value: isCollapsed

// =================================================================
// ★ 主要な関数（リファクタリング済み）
// =================================================================

/**
 * 1. 新規ノード作成のエントリーポイント (ダブルクリックで呼ばれる)
 * @param pos 作成位置 (ローカル座標)
 * @param target Konvaのイベントターゲット
 */
function createNewNode(pos: Vector2d, target: Konva.Node) {
  const nodeData = {
    id: `node_${Date.now()}${Math.random()}`,
    x: pos.x,
    y: pos.y,
    text: 'New Text',
    width: 200, // 初期幅
    height: new Konva.Text({ text: 'New Text', fontSize: 16, padding: 8, width: 200 }).height(), // 初期高さ
  };
  const nodeGroup = buildNode(nodeData);

  // ダブルクリックされたのがグループノードの背景か、その子孫か？
  const parentGroup = target.findAncestor('.background-shape');
  if (parentGroup) {
    nodeGroup.moveTo(parentGroup);
    nodeGroup.setAttr('parentId', parentGroup.id());
    updateNodeVisuals(nodeGroup, false);
    // グループ内に作成されたので、位置を再調整
    // createNewNode に渡される pos は既にローカル座標なので、
    // グループの座標を引く必要はない。
  }

  enterEditMode(nodeGroup, true);
}

/**
 * 2. データからノードを復元するエントリーポイント (ロード時に呼ばれる)
 */
function createNodeFromData(nodeData: any) {
  // `buildNode`を呼び出す際に、`text`プロパティとして`nodeData.title`を渡す
  const nodeGroup = buildNode({
    id: nodeData.id,
    x: nodeData.x,
    y: nodeData.y,
    text: nodeData.title, // ★ 表示するのはtitle
    width: nodeData.width,
    height: nodeData.height
  });
  return nodeGroup;
}

// ★★★ 状態が変更されたときに「必ず」呼び出す関数 ★★★
function recordHistory(actionDescription: string) { // `actionDescription`はデバッグ用
  if (!isHistoryEnabled) return;
  markAsDirty();
  
  // ★ ステージの「データ」を取得し、文字列化して`main`に送る
  const currentData = _getCurrentStageData();
  const stateString = JSON.stringify(currentData);
  window.electronAPI.historyPush(stateString);

  console.log(`History Recorded: ${actionDescription}`);
}

// ★ テキストの変更に応じてノードサイズを調整する、再利用可能な関数を作成
function adjustNodeSize(textNode: Konva.Text) {
  const maxWidth = 200; // 折り返しの最大幅
  const padding = 8 * 2; // 左右のパディング合計

  // 一時的に幅の制限をなくして、テキスト本来の幅を計算
  textNode.width(undefined); 
  const textWidth = textNode.width();

  if (textWidth + padding > maxWidth) {
    // 最大幅を超える場合は、折り返しを有効にする
    textNode.width(maxWidth - padding);
  } else {
    // 超えない場合は、幅の制限は不要
    // （width(undefined)のまま）
  }
  
  const parentGroup = textNode.getParent();

  // ★ `parentGroup`がnullでないことを確認してから、次の処理に進む
  if (parentGroup) { 
    const backgroundRect = parentGroup.findOne<Konva.Rect>('.background');
    if (backgroundRect) {
      backgroundRect.width(textNode.width() + padding);
      backgroundRect.height(textNode.height() + padding);
      
      const links = (parentGroup as Konva.Group).getAttr('links') || [];
      links.forEach(linkGroup => {
        // ★ ここはもう、linkGroupが直接手元にあるので、そのまま渡すだけ
        updateLinkPoints(linkGroup as Konva.Group);
      });
    }
  }
}


/**
 * 3. 実際のノードオブジェクトを構築する共通ヘルパー関数
 */
function buildNode(nodeData: { id: string, x: number, y: number, text: string, width: number, height?: number }): Konva.Group {
  const isDarkMode = document.body.classList.contains('dark-mode');
  const colors = isDarkMode ? themes.dark : themes.light;
  const nodeGroup = new Konva.Group({
    id: nodeData.id,
    x: nodeData.x,
    y: nodeData.y,
    draggable: true,
  });
  nodeGroup.name('node-group');
  nodeGroup.setAttr('links', []);

  const textNode = new Konva.Text({
    name: 'text',
    text: nodeData.text,
    fontSize: 16,
    fontFamily: "'Klee Custom', serif-ja, serif",
    fill: colors.text,
    padding: 8,
    width: nodeData.width,
    lineHeight: 1.2,
  });

  const backgroundRect = new Konva.Rect({
    name: 'background',
    x: 0,
    y: 0,
    width: nodeData.width,
    height: textNode.height(),
    fill: colors.nodeBg,
    cornerRadius: 10,
  });
  
  // 動的なクリッピング領域を設定
  nodeGroup.clipFunc((ctx) => {
    ctx.beginPath();
    ctx.rect(0, 0, backgroundRect.width(), backgroundRect.height());
    ctx.closePath();
  });

  nodeGroup.add(backgroundRect, textNode);

  // --- イベントハンドラ ---

  // ノード自体のドラッグ移動
  nodeGroup.on('dragmove', () => {
    // ★ `nodeGroup`が、まさに親グループそのもの
    const links = nodeGroup.getAttr('links') as Konva.Group[]; 
    links.forEach(linkGroup => {
      updateLinkPoints(linkGroup);
    });
    layer.batchDraw();
  });
  
  nodeGroup.on('dragend', () => {
  if (transformer.nodes().length > 1) {
    return;
  }    
    recordHistory('Node moved');
  });

  layer.add(nodeGroup);
  // handle.hide();
  adjustNodeSize(textNode);
  return nodeGroup;
}

/**
 * テキスト編集を開始する関数
 * @param nodeGroup 対象のノード
 * @param isNew 新規作成ノードかどうかのフラグ
 */
function enterEditMode(nodeGroup: Konva.Group, isNew = false) {
  isTextEditing = true;
  updateButtonInteractivity(true);
  const textNode = nodeGroup.findOne<Konva.Text>('.text')!;
  const backgroundRect = nodeGroup.findOne<Konva.Rect>('.background')!;
  const textEditor = document.getElementById('ip-text-editor') as HTMLTextAreaElement;
  
  textNode.opacity(0);
  backgroundRect.opacity(0);

  layer.draw();
  
  textEditor.value = textNode.text();
  textEditor.style.display = 'block';
  textEditor.style.position = 'absolute';

  
  textEditor.focus();
  
  // ★ 新規作成の場合のみ、テキストを全選択する
  if (isNew) {
    textEditor.select();
  } else {
    // 既存ノードの編集時はカーソルを末尾に
    textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
  }

  const adjustHeight = () => {
    textEditor.style.height = 'auto';
    textEditor.style.height = textEditor.scrollHeight + 'px';
  };
  textEditor.addEventListener('input', adjustHeight);
  adjustHeight();

  // ★ 1. 現在のステージのスケールと位置を取得
  const scale = stage.scaleX();

  // 2. ノードの「見た目上」の矩形を取得
  const clientRect = backgroundRect.getClientRect();

  // ★ 3. テキストエリアの位置とサイズを、スケールを考慮して設定
  textEditor.style.top = clientRect.y + 24 +'px';

  const Pane = document.getElementById('ip-outline-pane')!;
  if (!Pane.classList.contains('hidden')) {  
  textEditor.style.left = clientRect.x + 165 + 'px';
  } else {
    textEditor.style.left = clientRect.x + 'px';
  }
  textEditor.style.width = clientRect.width/scale + 'px';
  textEditor.style.height = clientRect.height/scale + 'px';

  // ★ 4. CSSのtransformを使って、テキストエリア自体を拡大する
  //    これにより、paddingなども含めて綺麗にスケールされる
  textEditor.style.transform = `scale(${scale})`;
  textEditor.style.transformOrigin = 'top left'; // 拡大の基点を左上にする  

  // キーボードショートカット用のイベントハンドラ
  const handleKeyDown = (e: KeyboardEvent) => {
    // テキスト編集中は、グローバルなショートカット（削除など）が暴発しないように、
    // イベントの伝播をここで止める。
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
    }
    
    // Ctrl+Enter または Cmd+Enter で入力を確定
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // 念のため、ここでも止める
      textEditor.blur();
    }
    // Escapeキーでも入力を確定
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      textEditor.blur();
    }
  };
  textEditor.addEventListener('keydown', handleKeyDown);

  // 編集完了時の処理（blurイベント）
  textEditor.addEventListener('blur', () => {
    isTextEditing = false;
    updateButtonInteractivity(false);
  const oldText = textNode.text();
  const newText = textEditor.value;

  // a) 「新規作成」ノードの場合
  if (isNew) {
    textNode.text(newText);
    adjustNodeSize(textNode);
    recordHistory('Node created');
  }  
  // b) 既存ノードの編集の場合、テキストに変更があった場合のみ記録
  else if (oldText !== newText) {
    textNode.text(newText);
    adjustNodeSize(textNode);
    recordHistory('Node text changed');
  }    
    // ★ Listenerを両方とも削除する
    textEditor.removeEventListener('input', adjustHeight);
    textEditor.removeEventListener('keydown', handleKeyDown);

    textNode.text(textEditor.value);
    adjustNodeSize(textNode);

    textEditor.style.transform = 'scale(1)';
    textEditor.style.display = 'none';         
    textNode.opacity(1);
    backgroundRect.opacity(1);

    renderIpOutline();
    layer.draw();
  }, { once: true });
}

// ★ デバウンス用のヘルパー関数
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<F>): void => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };
}

// ★★★ オートセーブを実行するための関数 ★★★
const autoSaveChanges = debounce(() => {
  // 1. ファイルパスが存在し、かつ変更がある(`isDirty`)場合のみ実行
  if (currentFilePath && isDirty) {
    console.log('Auto-saving changes...');
    
    // 2. `saveToFile`を「上書き保存」モードで呼び出す
    //    `saveToFile`は、内部でIPC通信を行う非同期関数
    saveToFile(false).then(result => {
      if (result && result.success) {
        console.log('Auto-save successful.');
        // isDirtyフラグは、saveToFileの中で`markAsClean()`によってfalseにされる
      } else {
        console.error('Auto-save failed.');
      }
    });
  }
}, 2000); // 最後の操作から2秒後に実行


/**
 * isTextEditingフラグの状態に応じて、UIボタンの操作可否を更新する
 * @param isEditing テキスト編集中かどうか
 */
function updateButtonInteractivity(isEditing: boolean) {
  const buttonContainer = document.querySelector('.top-right-buttons');
  if (buttonContainer) {
    buttonContainer.classList.toggle('disabled', isEditing);
  }
}

//　コンテンツエディタ用

/**
 * コンテンツエディタを開き、指定されたノードの内容を表示する
 * @param nodeGroup 編集対象のノード
 */
function openContentEditor(nodeGroup: Konva.Group) {
  isContentEditing = true;
  isTextEditing = true;
  updateButtonInteractivity(true);
  stage.listening(false);
  // 既に何か編集中であれば、先に保存処理を行う
  if (currentlyEditingNodeId && currentlyEditingNodeId !== nodeGroup.id()) {
    saveContentChanges();
  }
  currentlyEditingNodeId = nodeGroup.id();
  let content = nodeGroup.getAttr('contentText') || '';
  let isInitialContent = false;
  if (!content.trim()) {
    content = 'New Content';
    isInitialContent = true;
  }  
  contentEditor.value = content;
  
  editorPane.classList.remove('hidden');
  contentEditor.focus();
  if (isInitialContent) {
    contentEditor.select();
  }  

  // イベントリスナー
  contentEditor.addEventListener('keydown', handleContentEditorKeyDown);
  //  blurイベントでは保存・終了処理を行わない
  //contentEditor.addEventListener('blur', closeContentEditor, { once: true });
}

/**
 * コンテンツエディタのキーボードイベントを処理する
 */
const handleContentEditorKeyDown = (e: KeyboardEvent) => {
  // DeleteキーやBackspaceキーが、ノード削除を暴発させないようにする
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.stopPropagation();
  }
  
  // Escapeキーで編集を終了する
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeContentEditor();
  }
};

/**
 * コンテンツエディタの変更を保存し、エディタを閉じる
 */
function saveContentChanges() {
  if (!currentlyEditingNodeId) return;

  const node = stage.findOne<Konva.Group>('#' + currentlyEditingNodeId);
  if (node) {
    const oldText = node.getAttr('contentText') || '';
    const newText = contentEditor.value;

    if (oldText !== newText) {
      node.setAttr('contentText', newText);
      recordHistory('Node content changed');
    }
  }
}

/**
 * 変更を保存してエディタを閉じる
 */
function closeContentEditor() {
    saveContentChanges();
    editorPane.classList.add('hidden');
    currentlyEditingNodeId = null;
    isContentEditing = false;
    isTextEditing = false;
    updateButtonInteractivity(false);
    stage.listening(true);
    contentEditorJustClosed = true;
    stage.container().focus();
    contentEditor.removeEventListener('keydown', handleContentEditorKeyDown);
}

// マークダウン変換関連

/**
 * 現在のキャンバスの状態をMarkdown文字列に変換する
 */
function generateMarkdownContent(): string {
  const groups = stage.find<Konva.Group>('.background-shape');
  const nodes = stage.find<Konva.Group>('.node-group');
  
  let markdown = '';
  const orphanNodes: Konva.Group[] = []; // 親がいないノードを格納

  // 1. まず、親がいないノードを特定する
  nodes.forEach(node => {
    if (!node.getAttr('parentId')) {
      orphanNodes.push(node);
    }
  });

  // 2. 各グループを処理
  groups.forEach(group => {
    const groupLabel = group.findOne<Konva.Text>('Text')?.text() || 'Untitled Group';
    markdown += `# ${groupLabel}\n\n`;

    // このグループに所属する子ノードを探して処理
    const childNodes = nodes.filter(n => n.getAttr('parentId') === group.id());

    childNodes.forEach(node => {
      markdown += convertNodeToMarkdown(node);
    });
  });

  // 3. 親がいないノードを "# Others" として処理
  if (orphanNodes.length > 0) {
    markdown += `# Others\n\n`;
    orphanNodes.forEach(node => {
      markdown += convertNodeToMarkdown(node);
    });
  }

  return markdown;
}

/**
 * 1つのノードをMarkdownのセクションに変換するヘルパー関数
 */
function convertNodeToMarkdown(node: Konva.Group): string {
  let section = '';
  const title = node.findOne<Konva.Text>('.text')?.text() || 'Untitled';
  const content = node.getAttr('contentText') || '';

  section += `## ${title}\n`;
  if (content.trim()) {
    section += `${content}\n`;
  }

  // リンク情報の処理
  const links = node.getAttr('links') as Konva.Group[];
  if (links && links.length > 0) {
    section += '\n'; // リンク情報との間に空行を入れる
    const uniqueLinks = new Set(links); // 重複を避ける

    uniqueLinks.forEach(linkGroup => {
        const linkNodes = linkGroup.getAttr('nodes') as Konva.Group[];
        const linkLabel = linkGroup.findOne<Konva.Text>('.link-label')?.text().trim() || '';

        // このリンクが、現在のノードから出ていくものか、入ってくるものかを判定
        const isOutgoing = linkNodes[0] === node;
        const otherNode = isOutgoing ? linkNodes[1] : linkNodes[0];
        const otherNodeTitle = otherNode.findOne<Konva.Text>('.text')?.text() || '...';
        
        let linkTypeSymbol = '';
        const type = linkGroup.getAttr('linkType');
        if (type === 'double_arrow') {
            linkTypeSymbol = 'interaction';
        } else if (type === 'arrow') {
            linkTypeSymbol = isOutgoing ? 'to' : 'from';
        } else {
            linkTypeSymbol = 'relation';
        }

        section += `【${linkTypeSymbol} ${otherNodeTitle}】`;
        if (linkLabel) {
            section += `:${linkLabel}`;
        }
        section += '\n';
    });
  }
  
  return section + '\n';
}

document.getElementById('ip-export-md-button')?.addEventListener('click', () => {
  const markdownContent = generateMarkdownContent();
  // ★★★ currentFilePath をそのまま渡す (nullの可能性もある) ★★★
  window.electronAPI.exportAsMarkdown(markdownContent, currentFilePath);
});

// アウトライン関連


document.getElementById('ip-toggle-outline-btn')?.addEventListener('click', () => {
  const Pane = document.getElementById('ip-outline-pane')!;
  Pane.classList.toggle('hidden');
  // アウトラインが表示されたら、内容を再生成する
  if (!Pane.classList.contains('hidden')) {
    renderIpOutline();
  }
});

document.getElementById('outline-expand-all')?.addEventListener('click', () => {
    setAllIpOutlineCollapsed(false);
});
document.getElementById('outline-collapse-all')?.addEventListener('click', () => {
    setAllIpOutlineCollapsed(true);
});

// アウトライン項目をクリックしたときの処理 (イベント委譲)
outlinePane.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // a) トグル（開閉）がクリックされた場合
    if (target.classList.contains('outline-toggle')) {
        const groupId = target.dataset.groupId;
        if (groupId) {
            const currentState = outlineCollapsedState.get(groupId) ?? false;
            outlineCollapsedState.set(groupId, !currentState);
            renderIpOutline(); // 状態を更新して再描画
        }
    }
    // b) ノードのテキストがクリックされた場合
    else if (target.closest('.outline-node')) {
        const nodeId = (target.closest('.outline-node') as HTMLElement).dataset.id;
        if (nodeId) {
            jumpToNode(nodeId);
        }
    }
});

/**
 * アウトラインパネルの内容を現在のステージの状態に基づいて再描画する
 */
function renderIpOutline() {
    outlinePane.innerHTML = '';
    const groups = [...stage.find<Konva.Group>('.background-shape')].sort((a, b) => {
        const textA = a.findOne<Konva.Text>('Text')?.text() || '';
        const textB = b.findOne<Konva.Text>('Text')?.text() || '';
        return textA.localeCompare(textB, 'ja'); // 日本語ソートを明示
    });

    const nodes = [...stage.find<Konva.Group>('.node-group')].sort((a, b) => {
        const textA = a.findOne<Konva.Text>('.text')?.text() || '';
        const textB = b.findOne<Konva.Text>('.text')?.text() || '';
        return textA.localeCompare(textB, 'ja');
    });

    const orphanNodes: Konva.Group[] = [];
    nodes.forEach(n => { if (!n.getAttr('parentId')) orphanNodes.push(n); });

    // --- グループ化されたノード ---
    groups.forEach(group => {
        const groupId = group.id();
        const isCollapsed = outlineCollapsedState.get(groupId) ?? false; // デフォルトは展開

        const groupWrapper = document.createElement('div');
        const groupHeader = document.createElement('div');
        groupHeader.className = 'outline-group-header';

        const toggle = document.createElement('span');
        toggle.className = 'outline-toggle';
        toggle.classList.toggle('collapsed', isCollapsed);
        toggle.textContent = '▼';
        toggle.dataset.groupId = groupId; // クリックで開閉するためにIDを保持

        const groupLabel = document.createElement('span');
        groupLabel.className = 'outline-group-label';
        groupLabel.textContent = group.findOne<Konva.Text>('Text')?.text() || '...';
        
        groupHeader.appendChild(toggle);
        groupHeader.appendChild(groupLabel);
        groupWrapper.appendChild(groupHeader);
        
        const nodeList = document.createElement('ul');
        nodeList.className = 'outline-node-list';
        if (isCollapsed) {
            nodeList.style.display = 'none';
        }

        nodes.filter(n => n.getAttr('parentId') === groupId).forEach(node => {
            nodeList.appendChild(createOutlineNodeEl(node));
        });
        groupWrapper.appendChild(nodeList);
        outlinePane.appendChild(groupWrapper);
    });

    // --- グループ化されていないノード ---
    if (orphanNodes.length > 0) {
        const groupId = 'others-group'; // 固定のID
        const isCollapsed = outlineCollapsedState.get(groupId) ?? false;

        const groupWrapper = document.createElement('div');
        const groupHeader = document.createElement('div');
        groupHeader.className = 'outline-group-header';

        const toggle = document.createElement('span');
        toggle.className = 'outline-toggle';
        toggle.classList.toggle('collapsed', isCollapsed);
        toggle.textContent = '▼';
        toggle.dataset.groupId = groupId; // IDをセット

        const groupLabel = document.createElement('span');
        groupLabel.className = 'outline-group-label';
        groupLabel.textContent = 'Others';
        
        groupHeader.appendChild(toggle);
        groupHeader.appendChild(groupLabel);
        groupWrapper.appendChild(groupHeader);
        
        const nodeList = document.createElement('ul');
        nodeList.className = 'outline-node-list';
        if (isCollapsed) {
            nodeList.style.display = 'none';
        }

        orphanNodes.forEach(node => {
            nodeList.appendChild(createOutlineNodeEl(node));
        });
        groupWrapper.appendChild(nodeList);
        outlinePane.appendChild(groupWrapper);
    }
}

function createOutlineNodeEl(node: Konva.Group): HTMLElement {
    const title = node.findOne<Konva.Text>('.text')?.text() || '...';
    const nodeEl = document.createElement('div');
    nodeEl.className = 'outline-node';
    nodeEl.textContent = title;
    nodeEl.dataset.id = node.id(); // ジャンプ用にIDを保持
    return nodeEl;
}

/**
 * 指定されたIDのノードが「表示領域の中央」に来るようにステージを移動する (最終確定版)
 * @param nodeId ジャンプ先のノードID
 */
function jumpToNode(nodeId: string) {
    const node = stage.findOne<Konva.Group>('#' + nodeId);
    if (!node) return;

    // 1. キャンバスのコンテナ要素を取得
    const container = stage.container(); // '#ip-container'

    // 2. 「目標地点」を計算：コンテナの画面上での中心座標
    const containerRect = container.getBoundingClientRect();
    const targetX = containerRect.left + containerRect.width / 2;
    const targetY = containerRect.top + containerRect.height / 2;

    // 3. 「現在地点」を計算：ノードの画面上での中心座標
    const nodeRect = node.getClientRect();
    const currentX = nodeRect.x + nodeRect.width / 2;
    const currentY = nodeRect.y + nodeRect.height / 2;

    // 4. 「移動量」を計算：画面上で移動すべきピクセル量
    const deltaX = targetX - currentX;
    const deltaY = targetY - currentY;

    // 5. ステージの現在位置に、移動量を加算して、新しい位置を決定
    const newPos = {
        x: stage.x() + deltaX,
        y: stage.y() + deltaY,
    };
    
    // 6. アニメーションで滑らかに移動
    new Konva.Tween({
        node: stage,
        duration: 0.3,
        x: newPos.x-250,
        y: newPos.y,
        easing: Konva.Easings.EaseInOut,
    }).play();
}

// すべて開く・すべて閉じる
function setAllIpOutlineCollapsed(isCollapsed: boolean) {
    // すべてのグループのIDをキーとして、状態を設定
    stage.find<Konva.Group>('.background-shape').forEach(group => {
        outlineCollapsedState.set(group.id(), isCollapsed);
    });
    // 'Others'グループの状態も設定
    outlineCollapsedState.set('others-group', isCollapsed);

    // 最後に再描画
    renderIpOutline();
}

// =================================================================
// ★ イベントリスナー
// =================================================================

// ★ スタイルを「非選択」状態に戻すためのヘルパー関数
const resetStyle = (shape: Konva.Group) => {
    const colors = getCurrentThemeColors();

    // 先にリンクのスタイルリセットを処理する
    if (shape.name() === 'link-group') {
        const linkShape = shape.findOne<Konva.Line | Konva.Arrow>('.link-shape');
        if (linkShape) {
            linkShape.stroke(colors.link);
            linkShape.strokeWidth(2 / stage.scaleX()); // デフォルトの太さに戻す
            if (linkShape instanceof Konva.Arrow) {
                linkShape.fill(colors.link);
            }
        }
        // リンクグループの場合、これ以降の処理は不要なのでここで終了
        return;
    }

    // ノードグループの場合
    if (shape.name() === 'node-group') {
        // isSelected を false としてスタイルを更新するだけでOK
        updateNodeVisuals(shape, false);
        // ↓↓↓ 問題のコードはここにあったので、削除しました ↓↓↓
    } 
    
    // 背景図形（グループ）の場合
    else if (shape.name() === 'background-shape') {
        const rect = shape.findOne<Konva.Rect>('.background');
        if (!rect) return;
        const colors = getCurrentThemeColors();
        
        rect.fill('transparent');
        rect.stroke(colors.text);
        rect.strokeWidth(1);
        rect.strokeEnabled(true);
        shape.find('.resize-handle').forEach(handle => {
            handle.hide();
        });
    }
}

// ノード選択、リンク、編集、新規作成を担う統合イベントハンドラ
stage.on('click tap dblclick dbltap', (e) => {
  if (isContentEditing) return;
  if (selectionJustFinished) {
    selectionJustFinished = false; // フラグを消費して
    return; // 処理を中断
  }
  // --- 1. クリックされたオブジェクトを特定 ---
  const foundNode = e.target.findAncestor('.node-group');
  const foundShape = e.target.findAncestor('.background-shape');
  const foundLink = e.target.findAncestor('.link-group');

  const clickedNode = (foundNode instanceof Konva.Group) ? foundNode : null;
  const clickedShape = (foundShape instanceof Konva.Group) ? foundShape : null;
  const clickedLink = (foundLink instanceof Konva.Group) ? foundLink : null;
  const clickedObject = clickedLink || clickedNode || clickedShape;

// --- 2. ダブルクリック時の処理を最優先で判定 ---
  if (e.type === 'dblclick' || e.type === 'dbltap') {
    if (e.evt.button !== 0) {
      return;
    }    
    if (clickedShape) {
      const label = clickedShape.findOne<Konva.Text>('Text');
      if (label && e.target === label) {
        clickedShape.find('.resize-handle').forEach(h => h.hide());
        editShapeLabel(label);
        return; // 処理完了
      }
    }
    // 優先順位 1: 既存のテキストノードやリンクの編集
    if (clickedNode) {
      enterEditMode(clickedNode);
      return;
    }
    if (clickedLink) {
        const labelToEdit = clickedLink.findOne<Konva.Label>('.link-label-container');
        if (labelToEdit) {
          editLinkLabel(labelToEdit);
        }
        return;
    }

    // 優先順位 2: 新規ノード作成
    if (e.target === stage || e.target.name() === 'background') {
        const absolutePos = stage.getPointerPosition();
        if (!absolutePos) return;

        let transform;
        // ケースA: ステージの何もない部分がクリックされた場合
        if (e.target === stage) {
            transform = stage.getAbsoluteTransform().copy().invert();
        } 
        // ケースB: グループの背景がクリックされた場合
        else {
            const parentGroup = e.target.getParent();
            // 親グループが存在することを、念のため確認（ガード節）
            if (!parentGroup) return;
            transform = parentGroup.getAbsoluteTransform().copy().invert();
        }
        
        const localPos = transform.point(absolutePos);
        createNewNode(localPos, e.target);
        return;
    }
  }

  // --- 3. シングルクリック時のリンク作成処理 & ペアリング処理 ---
  const isCtrlOrCmd = e.evt.ctrlKey || e.evt.metaKey;
  const isShift = e.evt.shiftKey;

  // 既存リンクがあれば何もしない 
  if (selectedShape && selectedShape.name() === 'node-group' && clickedNode && (isCtrlOrCmd || isShift) && selectedShape !== clickedNode) {
    // 既存のリンクがあるかチェック
    const existingLink = findLink(selectedShape, clickedNode);
    if (existingLink) {
      console.log('既存のリンクがあるため、新しいリンクは作成しません。');
      return; // 既存リンクがある場合は何もしない
    }

    let linkType: LinkType;
    if (isCtrlOrCmd && isShift) { linkType = LinkType.DOUBLE_ARROW; }
    else if (isShift) { linkType = LinkType.ARROW; }
    else { linkType = LinkType.LINE; }
    
    // 新しいリンクを作成
    manageLink(selectedShape, clickedNode, linkType, '');
    return; // 処理完了
  }

  if (selectedShape && selectedShape.name() === 'node-group' && clickedShape && (isCtrlOrCmd || isShift)) {
      const nodeToPair = selectedShape;
      const targetGroup = clickedShape;

      // 【ペアリング解除: Shift + Click】
      if (isShift) {
          // もしノードがこのグループの子であれば、ペアリングを解除
          if (nodeToPair.getParent() === targetGroup) {
              const pos = nodeToPair.absolutePosition();
              nodeToPair.moveTo(layer);
              nodeToPair.absolutePosition(pos); // グローバル位置を維持
              nodeToPair.setAttr('parentId', null);
              updateNodeVisuals(nodeToPair, true); 
              renderIpOutline();
              recordHistory('Node unpaired');
          }
      } 
        // 【ペアリング: Ctrl + Click】
        else if (isCtrlOrCmd) {
            if (nodeToPair.getParent() !== targetGroup) {
                const pos = nodeToPair.absolutePosition();
                nodeToPair.moveTo(targetGroup);
                nodeToPair.absolutePosition(pos);
                
                const groupId = targetGroup.id();
                nodeToPair.setAttr('parentId', groupId);

                updateNodeVisuals(nodeToPair, true);
                renderIpOutline();
                recordHistory('Node paired');
            }
        }
      return; // 処理完了
  }  

  // --- 4. シングルクリック時の選択／選択解除処理 ---
  if (!clickedObject) { // 背景がクリックされた
    if (editorPane.classList.contains('hidden') === false) {
      closeContentEditor();
    }    
    if (selectedShape) {
      // 選択解除時に相方もリセットする
      if (selectedShape.name() === 'link-group') {
        const sibling = findSiblingByGeometry(selectedShape);
        if (sibling) {
          resetStyle(sibling);
        }
      }
      resetStyle(selectedShape); // 自分自身をリセット
    }
    selectedShape = null;

  } else if (selectedShape !== clickedObject) { // 別のオブジェクトがクリックされた
    // 古い選択を解除
    if (selectedShape) {
      // 選択解除時に相方もリセットする
      if (selectedShape.name() === 'link-group') {
        const sibling = findSiblingByGeometry(selectedShape);
        if (sibling) {
          resetStyle(sibling);
        }
      }
      resetStyle(selectedShape); // 自分自身をリセット
    }
    
    // ★ 新しい選択時のスタイル（塗りつぶし）
    selectedShape = clickedObject;
    applySelectionStyle(selectedShape);    
  }
  
  layer.draw();
});

// ノード/リンク削除 (Del/Backspace)
window.addEventListener('keydown', (e) => {
  // テキスト編集中でなければ削除処理を実行
  if (!isTextEditing && (e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
    e.preventDefault(); // デフォルトの動作（ブラウザの戻るなど）を抑制

  // --- グループノードが選択されている場合 ---
  if (selectedShape.name() === 'background-shape') {
    const groupToDelete = selectedShape;
    
    // a) このグループに所属するすべての子ノードを取得
    //    Konvaの親子関係で直接 'find' するのが最も確実
    const children = groupToDelete.find<Konva.Group>('.node-group');

    // b) 各子ノードのペアリングを解除
    //    配列をコピー([...children])してからループするのが安全
    [...children].forEach(node => {
        const pos = node.absolutePosition();
        node.moveTo(layer); // ルートレイヤーに移動
        node.absolutePosition(pos); // 見た目の位置を維持
        node.setAttr('parentId', null);
        updateNodeVisuals(node, false); // 選択されていない状態のスタイルに戻す
    });

    // c) 子ノードの処理が終わったら、グループノード自身を破棄
    groupToDelete.destroy();
    selectedShape = null;
    layer.draw();
    recordHistory('Group deleted (children preserved)'); // 履歴のメッセージも明確に
    return; // ★ 処理完了
  }

    if (selectedShape.name() === 'node-group') {
      
      // ★ `selectedShape`に接続されたリンクグループを、配列のコピーに対して処理
      const linksToDelete = [...selectedShape.getAttr('links')] as Konva.Group[];

      linksToDelete.forEach(linkGroup => {
        deleteLink(linkGroup);
      });
    } 

    else if (selectedShape.name() === 'link-group') {
      deleteLink(selectedShape);
      selectedShape = null; // 削除したので選択を解除
      layer.draw();
      recordHistory('Link deleted');
      return; // リンク削除後の処理はここで終了
    }

    selectedShape.destroy();
    selectedShape = null;
    layer.draw();
    recordHistory('Node deleted');
  }
});

/**
 * 2つのノード間にリンクがあるか探し、あればそのリンクを返す
 * (双方向矢印の場合、どちらか一方の方向のリンクがあれば見つける)
 */
function findLink(node1: Konva.Group, node2: Konva.Group): Konva.Group | undefined {
  const links1 = node1.getAttr('links') as Konva.Group[];
  return links1.find(linkGroup => {
    const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
    // linkGroupがnode1とnode2を結んでいるか、またはnode2とnode1を結んでいるかをチェック
    return (nodes && nodes[0] === node1 && nodes[1] === node2) ||
           (nodes && nodes[0] === node2 && nodes[1] === node1);
  });
}

function manageLink(node1: Konva.Group, node2: Konva.Group, type: LinkType, labelText?: string) {
  
  // 1. 既存のリンクグループを探す (双方向矢印の場合も考慮)
  const existingLinkGroup = findLink(node1, node2);

  // 2. もし既存のリンクグループがあれば、何もしない (トグル/線種変更廃止)
  if (existingLinkGroup) {
    console.log('manageLink: 既存のリンクがあるため、何もしません。');
    return;
  }

  // 3. 新しいリンクを作成する
  if (type === LinkType.DOUBLE_ARROW) {
    const linkGroup1 = createSingleLink(node1, node2, LinkType.ARROW, labelText);
    const linkGroup2 = createSingleLink(node2, node1, LinkType.ARROW, ''); // ラベルは片方だけ
    
    linkGroup1.setAttr('sibling', linkGroup2);
    linkGroup2.setAttr('sibling', linkGroup1);
    linkGroup1.setAttr('linkType', LinkType.DOUBLE_ARROW);
    linkGroup2.setAttr('linkType', LinkType.DOUBLE_ARROW);
  } else {
    createSingleLink(node1, node2, type, labelText);
  }
  
  layer.draw();
  recordHistory('Link created'); // リンク作成時のみ履歴を記録
}

/**
 * 1本のリンク（線または片方向矢印）を作成する内部関数
 */
function createSingleLink(node1: Konva.Group, node2: Konva.Group, type: LinkType.LINE | LinkType.ARROW, labelText?: string): Konva.Group {
  
  // 1. `link`変数を`let`で宣言
  let link: Konva.Line | Konva.Arrow;

  // 2. `commonAttrs`を復活させる
  const colors = getCurrentThemeColors(); // (テーマ対応も忘れずに)
  const commonAttrs = {
    stroke: colors.link,
    strokeWidth: 2,
    name: 'link-shape', // ★ 名前を変更
    hitStrokeWidth: 10,
  };

  const initialPoints = [0, 0, 0, 0]; // (仮の値、updateLinkPointsで更新される)

  // 3. `type`に応じて、`link`変数にインスタンスを代入
  if (type === LinkType.ARROW) {
    link = new Konva.Arrow({
      ...commonAttrs,
      points: initialPoints,
      fill: colors.link,
      pointerLength: 10,
      pointerWidth: 10,
    });
  } else { // LinkType.LINE
    link = new Konva.Line({
        ...commonAttrs,
        points: initialPoints,
    });
  }
  
  // 1. ラベルを作成
  const konvaLabel = new Konva.Label({
    name: 'link-label-container',
  });

  // 2. ラベルに、背景となる「タグ」を追加
  konvaLabel.add(
    new Konva.Tag({
      lineJoin: 'round',
      stroke: colors.text,
      strokeWidth: 1,
      //cornerRadius: 4,
      fill: colors.labelBackground,
    })
  );
  
  // 3. ラベルに、表示する「テキスト」を追加
  konvaLabel.add(
    new Konva.Text({
      text: (labelText && labelText.trim() !== '') ? labelText : ' ',
      name: 'link-label', // テキスト自体の名前
      fontSize: 12,
      fontFamily: "'Klee Custom', serif-ja, serif",
      fill: colors.text,
      padding: 3,
    })
  );

  // 5. グループを作成し、`link`と`konvaLabel`を追加
  const linkGroup = new Konva.Group({
    name: 'link-group',
    id: `link_${Date.now()}${Math.random()}`,
  });
  linkGroup.add(link, konvaLabel);
  
  // 6. 重要な情報をグループに集約
  linkGroup.setAttr('nodes', [node1, node2]);
  linkGroup.setAttr('linkType', type); // ★ `type`情報も保存しておく

  linkGroup.on('mouseenter', () => {
    //  selectedShapeがリンク自身でもenterLeaveイベントが発火するため、選択中の場合は何もしないように変更 
    if (selectedShape === linkGroup) return; 
    const linkShape = linkGroup.findOne('.link-shape') as Konva.Line;
    linkShape.strokeWidth(4 / stage.scaleX());
    
    const sibling = findSibling(linkGroup); // linkGroupからsiblingを探すように変更
    if (sibling) {
      sibling.findOne<Konva.Line | Konva.Arrow>('.link-shape')?.strokeWidth(4 / stage.scaleX()); // ★ 兄弟も太くする
    }
    
    stage.container().style.cursor = 'pointer';
    layer.draw();
  });
  linkGroup.on('mouseleave', () => {
    // selectedShapeがリンク自身でもenterLeaveイベントが発火するため、選択中の場合は何もしないように変更 
    if (selectedShape === linkGroup) return; 
    const linkShape = linkGroup.findOne('.link-shape') as Konva.Line;
    linkShape.strokeWidth(2 / stage.scaleX());

    const sibling = findSibling(linkGroup); // linkGroupからsiblingを探すように変更
    if (sibling) {
      sibling.findOne<Konva.Line | Konva.Arrow>('.link-shape')?.strokeWidth(2 / stage.scaleX()); // ★ 兄弟も元に戻す
    }
    
    stage.container().style.cursor = 'default';
    layer.draw();
  });

  // 8. レイヤーに追加し、位置を更新
  layer.add(linkGroup);
  linkGroup.zIndex(1);
  updateLinkPoints(linkGroup);
  
  // 9. ノードとの関連付け
  node1.getAttr('links').push(linkGroup);
  node2.getAttr('links').push(linkGroup);

  // 10. ★★★ `Konva.Group`を返す ★★★
  return linkGroup;
}

// リンクを完全に削除するヘルパー関数
/**
 * リンクグループとその関連付けを完全に削除する
 * @param linkGroup 削除対象のリンクグループ
 */
function deleteLink(linkGroup: Konva.Group) {
  const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
  if (nodes && nodes.length === 2) {
    const node1 = nodes[0];
    const node2 = nodes[1];

    // ノードからリンクの参照を削除
    if (node1 && node1.getAttr('links')) {
      node1.setAttr('links', node1.getAttr('links').filter((l: Konva.Group) => l !== linkGroup));
    }
    if (node2 && node2.getAttr('links')) {
      node2.setAttr('links', node2.getAttr('links').filter((l: Konva.Group) => l !== linkGroup));
    }
  }

  // 双方向リンクの兄弟も削除
  const sibling = linkGroup.getAttr('sibling');
  if (sibling && sibling.destroy) {
    // 兄弟からもこのリンクの参照を削除（無限ループ防止）
    const siblingNodes = sibling.getAttr('nodes') as Konva.Group[];
    if (siblingNodes && siblingNodes.length === 2) {
      if (siblingNodes[0] && siblingNodes[0].getAttr('links')) {
        siblingNodes[0].setAttr('links', siblingNodes[0].getAttr('links').filter((l: Konva.Group) => l !== sibling));
      }
      if (siblingNodes[1] && siblingNodes[1].getAttr('links')) {
        siblingNodes[1].setAttr('links', siblingNodes[1].getAttr('links').filter((l: Konva.Group) => l !== sibling));
      }
    }
    sibling.destroy();
  }

  linkGroup.destroy();
  layer.draw(); // 描画更新
}


function editLinkLabel(labelContainer: Konva.Label) { 
    const labelNode = labelContainer.findOne<Konva.Text>('.link-label');
    const tag = labelContainer.findOne<Konva.Tag>('Tag');
  if (!labelNode) return;
  isTextEditing = true;
  updateButtonInteractivity(true);

  // 1. HTMLの編集用input要素を取得 (これは共通)
  const labelEditor = document.getElementById('ip-label-editor') as HTMLTextAreaElement;
  const isDarkMode = document.body.classList.contains('dark-mode');
  const colors = isDarkMode ? themes.dark : themes.light;  
  
  // 2. KonvaのTextノードを一時的に非表示にする
  labelNode.opacity(0);
  if(tag)tag.opacity(0);
  layer.draw(); // 非表示を反映

  // 3. input要素を、Textノードの真上に表示する (このロジックもほぼ共通)
  const stageBox = stage.container().getBoundingClientRect();
  const textPosition = labelContainer.absolutePosition();
  const scale = stage.scaleX(); 
  
  labelEditor.value = labelNode.text();
  labelEditor.style.display = 'block';
  labelEditor.style.position = 'absolute';

  // 1. 位置 (ズームの影響を受けるabsolutePositionをそのまま使う)
  labelEditor.style.top = (stageBox.top + textPosition.y) + 'px';
  labelEditor.style.left = (stageBox.left + textPosition.x) + 'px';

  // 2. サイズ (こちらもズームの影響を受ける)
  //    ラベルの幅に少し余裕を持たせると、入力しやすい
  const editorWidth = Math.max(labelNode.fontSize() * scale*8, labelNode.width() * scale);
  labelEditor.style.width = editorWidth + 'px';
  const editorHeight = Math.max(labelNode.fontSize() * scale*1.5, labelNode.height() * scale);
  labelEditor.style.height = editorHeight + 'px';

  // 3. フォント関連 (見た目をKonvaのTextと一致させる)
  labelEditor.style.fontSize = (labelNode.fontSize() * scale) + 'px';
  labelEditor.style.fontFamily = labelNode.fontFamily();
  labelEditor.style.lineHeight = String(labelNode.lineHeight());
  labelEditor.style.color = colors.text;
  
  // 4. その他 (見た目を整える)
  labelEditor.style.border = `1px solid ${colors.text}`;
  labelEditor.style.padding = '2px';
  labelEditor.style.margin = '2px';
  labelEditor.style.background = colors.labelBackground;
  labelEditor.style.zIndex = '9000'; // 最前面に表示

  // ★ テキストエリアの高さを、内容に合わせて自動調整する
  const adjustHeight = () => {
    // 一度高さをリセットしないと、縮小がうまく機能しない
    labelEditor.style.height = 'auto';
    labelEditor.style.height = labelEditor.scrollHeight + 'px';
  };
  // `input`イベント（＝ユーザーが何かを入力するたび）に、この関数を紐付ける
  labelEditor.addEventListener('input', adjustHeight);
  
  // ★ 編集開始時に一度呼び出して、現在のテキスト量に合わせた初期の高さを設定する
  adjustHeight(); 

  labelEditor.focus();
  // ★ もし、テキストが半角スペース（＝初期状態）なら、全選択する
  if (labelNode.text().trim() === '') {
    labelEditor.select();
  } else {
    labelEditor.setSelectionRange(labelEditor.value.length, labelEditor.value.length);
  }
  

  // 4. 編集完了時の処理を定義する (blurとkeydownイベント)
  const finishEdit = () => {
    isTextEditing = false;
    updateButtonInteractivity(false);
  const oldText = labelNode.text();
  let newText = labelEditor.value;
  // ★ 編集終了時に、もし空文字列なら、半角スペースに置き換える
  if (newText.trim() === '') {
    newText = ' ';
  }  

    const linkGroup = labelContainer.getParent() as Konva.Group;
    const sibling = linkGroup.getAttr('sibling') as Konva.Group | undefined;

    // 最終的にテキストが設定された、本当のリンクグループを特定する
    let targetLinkGroup: Konva.Group;

    if (sibling && sibling.id() < linkGroup.id()) {
        labelNode.text(' '); // 自分のテキストは空に
        sibling.findOne<Konva.Text>('.link-label')?.text(newText);
        targetLinkGroup = sibling; // テキストが設定されたのは相方
    } else {
        labelNode.text(newText);
        targetLinkGroup = linkGroup; // テキストが設定されたのは自分
    }

    // テキストが「本当に」変更された場合のみ、履歴を記録
    if (oldText !== newText) {
      recordHistory('Link label changed');
    }
    
    // --- ラベルの幅に合わせてタグのサイズを調整 ---
    const targetLabelContainer = targetLinkGroup.findOne<Konva.Label>('.link-label-container');
    const targetLabelNode = targetLinkGroup.findOne<Konva.Text>('.link-label');
    const targetTag = targetLabelContainer?.findOne<Konva.Tag>('Tag');
    if (targetTag && targetLabelNode) {
        targetTag.width(targetLabelNode.width() + targetLabelNode.padding() * 2);
        targetTag.height(targetLabelNode.height() + targetLabelNode.padding() * 2);
    }

    // --- リンクの位置を更新 ---
    updateLinkPoints(linkGroup);
    if (sibling) updateLinkPoints(sibling);
    
    // テキストが更新された方のリンクグループ全体を、レイヤーの最前面に移動させる
    targetLinkGroup.moveToTop();

    labelEditor.style.display = 'none';
    labelNode.opacity(1);
    if(tag)tag.opacity(1);
    layer.draw(); // 最終的な表示を反映
    
    // イベントリスナーを解除 (重要)
    labelEditor.removeEventListener('blur', finishEdit);
    labelEditor.removeEventListener('keydown', handleKeyDown);
    labelEditor.removeEventListener('input', adjustHeight);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // 1. DeleteやBackspaceキーが、ノード削除などのグローバルショートカットを
    //    誤爆させないようにする
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
    }
    // 2. Ctrl+Enter または Cmd+Enter で入力を確定
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      labelEditor.blur(); 
    }
    // 3. Escapeキーでも入力を確定
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      labelEditor.blur();
    }
  };

  labelEditor.addEventListener('blur', finishEdit);
  labelEditor.addEventListener('keydown', handleKeyDown);
}

/**
 * 指定されたリンクの端点座標を、接続されているノードに合わせて更新する（交点計算版）
 */
function updateLinkPoints(linkGroup: Konva.Group) {
  const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
  if (!nodes || nodes.length !== 2) return;
  
  const node1 = nodes[0];
  const node2 = nodes[1];

  // 1. 各ノードの「見た目上」の絶対的な矩形を取得
  //    これは、ステージの左上隅を(0,0)とした、ズームとパンが適用済みの矩形
  const rect1_absolute = node1.getClientRect();
  const rect2_absolute = node2.getClientRect();

  // 2. この「見た目上」の矩形を使って、交点を計算
  //    この計算自体は、ズームされた世界で行われるが、それで正しい
  const intersections_absolute = getIntersections(rect1_absolute, rect2_absolute);

  // 3. ★★★ ステージの変換を「逆算」するための計算機（逆行列）を取得 ★★★
  const transform = stage.getAbsoluteTransform().copy().invert();

  // 4. ★★★ 計算された「見た目上」の交点を、逆行列を使って
  // ★★★ レイヤーの「ローカル座標」に変換する ★★★
  const start_local = transform.point(intersections_absolute.start);
  const end_local = transform.point(intersections_absolute.end);

  // 5. 変換された「ローカル座標」を、linkとlabelに適用する
  const link = linkGroup.findOne<Konva.Line>('.link-shape');
  const konvaLabel = linkGroup.findOne<Konva.Label>('.link-label-container');
  if (!link || !konvaLabel) return;

  // ラベルの中から、実際のTextオブジェクトを取得
  const labelText = konvaLabel.findOne<Konva.Text>('.link-label');

  //  Textオブジェクトが存在し、かつその中身が空かスペースだけなら、
  //    ラベルコンテナ(`Konva.Label`)全体を非表示にする
  if (labelText && labelText.text().trim() === '') {
    konvaLabel.opacity(0);
  } else {
    // そうでなければ、表示する
    konvaLabel.opacity(1);
    // ラベルの幅に合わせてタグのサイズを調整するロジック
    const tag = konvaLabel.findOne<Konva.Tag>('Tag');
    if (tag && labelText) {
      tag.width(labelText.width() + labelText.padding() * 2);
      tag.height(labelText.height() + labelText.padding() * 2);
    }
  }  

  // a) `link`のpointsは、親である`linkGroup`のローカル座標で指定
  //    `linkGroup`自身の座標が(0,0)なら、これはレイヤー座標と一致
  link.points([
    start_local.x, 
    start_local.y, 
    end_local.x, 
    end_local.y
  ]);

  // b) `konvaLabel`の位置も、ローカル座標で指定
  const midPoint_local = {
    x: (start_local.x + end_local.x) / 2,
    y: (start_local.y + end_local.y) / 2,
  };
  konvaLabel.position({
    x: midPoint_local.x - konvaLabel.width() / 2,
    y: midPoint_local.y - konvaLabel.height() / 2,
  });

  // 6. リンクの線幅は、見た目の太さを一定に保つために、スケールで補正する
  //    (もし、ズームに合わせて太さが変わる方が自然なら、この補正は不要)
  const scale = stage.scaleX();
  if (selectedShape === linkGroup) {
    link.strokeWidth(4 / scale); // 選択中は太いまま
  } else {
    link.strokeWidth(2 / scale); // 非選択時は通常の太さ
  }
  
  // batchDrawは、この関数を呼び出す側でまとめて行うのが理想
}

/**
 * 現在のキャンバスの内容をHTMLファイルとして書き出す
 */
function exportAsHtml() {
    // 既存の選択状態を解除して、クリーンな画像を生成
    if (selectedShape) resetStyle(selectedShape);
    if (transformer.visible()) transformer.nodes([]);
    layer.draw();

  // --- 書き出し範囲の計算（修正版） ---
  const allNodes = stage.find('.node-group');
  // リンクとグループの矩形も範囲計算に含める
  const allShapes = [...allNodes, ...stage.find('.background-shape'), ...stage.find('.link-group')];
  if (allShapes.length === 0) {
    alert('書き出すコンテンツがありません。');
    // 何も書き出さない場合は、選択状態を元に戻す
    if (selectedShape) {
        const rect = selectedShape.findOne<Konva.Rect>('.background');
        if (selectedShape.name() === 'link-group') {
          // リンクの場合は再度選択スタイルを適用
          const linkShape = selectedShape.findOne<Konva.Line | Konva.Arrow>('.link-shape');
          if (linkShape) {
            const colors = getCurrentThemeColors();
            linkShape.stroke(colors.selection);
            linkShape.strokeWidth(4 / stage.scaleX());
            if (linkShape instanceof Konva.Arrow) {
              linkShape.fill(colors.selection);
            }
          }
        } else if (rect) {
            rect.strokeEnabled(true);
        }

        layer.draw();
    }
    return;
  }

  // ★ 複数の矩形領域を結合するロジック
  let box = allShapes[0].getClientRect();
  allShapes.forEach(shape => {
    const shapeRect = shape.getClientRect();
    const right = Math.max(box.x + box.width, shapeRect.x + shapeRect.width);
    const bottom = Math.max(box.y + box.height, shapeRect.y + shapeRect.height);
    box.x = Math.min(box.x, shapeRect.x);
    box.y = Math.min(box.y, shapeRect.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  });
  
  const padding = 20;
  const exportArea = {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };

    // 2. Konvaで、背景が「透明」な画像データを生成
    stage.toDataURL({
        ...exportArea,
        pixelRatio: 2,
        callback: (url) => {
            if (!url) {
                alert('画像の書き出しに失敗しました。');
                return;
            }

            // 3. mainプロセスに、画像データとファイルパスを渡す
            window.electronAPI.exportAsHtml(url, currentFilePath);
        }
    });
}

 /**
 * 現在のキャンバスの内容を画像ファイルとして書き出す
 * @param format 'png' または 'jpeg'
 */
function exportAsImageAndSendToMain(format: 'png' | 'jpeg' | 'pdf') {
    // 1.既存の選択状態を一時的に解除して、クリーンな画像を生成
    if (selectedShape) resetStyle(selectedShape);
    if (transformer.visible()) transformer.nodes([]);
    layer.draw();

    // 2.書き出し範囲を全要素を囲む矩形として計算
    const allShapes = [...stage.find('.node-group'), ...stage.find('.background-shape')];
    if (allShapes.length === 0) {
        alert('書き出すコンテンツがありません。');
        return;
    }

    let box = allShapes[0].getClientRect();
    allShapes.forEach(shape => {
        const nodeRect = shape.getClientRect();
        const right = Math.max(box.x + box.width, nodeRect.x + nodeRect.width);
        const bottom = Math.max(box.y + box.height, nodeRect.y + nodeRect.height);
        box.x = Math.min(box.x, nodeRect.x);
        box.y = Math.min(box.y, nodeRect.y);
        box.width = right - box.x;
        box.height = bottom - box.y;
    });

    const padding = 20;
    const exportArea = {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + padding * 2,
        height: box.height + padding * 2,
    };
    
    stage.toDataURL({
        ...exportArea,
        pixelRatio: 2,
        mimeType: `image/${format}`,
        callback: (url) => {
            if (!url) {
                alert('画像の書き出しに失敗しました。');
                return;
            }
            // 3. メモリ上に、合成用の新しい<canvas>を作成
            const offscreenCanvas = document.createElement('canvas');
            const ctx = offscreenCanvas.getContext('2d')!;
            
            // pixelRatioを考慮したキャンバスサイズに設定
            offscreenCanvas.width = exportArea.width * 2;
            offscreenCanvas.height = exportArea.height * 2;

            // 4. 背景色を決定し、キャンバスを塗りつぶす
            const isDarkMode = document.body.classList.contains('dark-mode');
            ctx.fillStyle = isDarkMode ? '#333333' : 'antiquewhite';
            ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

            // 5. Konvaが生成した透明PNG画像を、Imageオブジェクトとして読み込む
            const konvaImage = new Image();
            konvaImage.onload = () => {
                // 6. 背景の上に、Konvaの画像を重ねて描画する
                ctx.drawImage(konvaImage, 0, 0);

                // 7. 合成後のキャンバスから、最終的なData URLを生成
                const finalDataUrl = offscreenCanvas.toDataURL('image/png'); // PDFでも元画像はPNGでOK

                if (format === 'pdf') {
                    // PDFの場合は、mainプロセスに画像データを送ってPDF化を依頼
                    window.electronAPI.exportAsPdf(finalDataUrl, currentFilePath);
                } else {
                    // PNG/JPEGの場合は、従来通り画像として保存を依頼
                    window.electronAPI.exportAsImage(finalDataUrl, format, currentFilePath);
                }
            };
            konvaImage.src = url;
        }
    });
}

/**
 * 2つのノードを結ぶ直線と、各ノードの境界との交点を計算する（最終安定版・型安全）
 * @param node1 始点ノード
 * @param node2 終点ノード
 * @returns { start: Vector2d, end: Vector2d } 交点の座標
 */
function getIntersections(
  rect1: { x: number, y: number, width: number, height: number }, // ★ 1. 引数をKonva.Groupから矩形オブジェクトに変更
  rect2: { x: number, y: number, width: number, height: number }  // ★ 2. こちらも同様に変更
): { start: Vector2d; end: Vector2d } {

    const center1: Vector2d = { x: rect1.x + rect1.width / 2, y: rect1.y + rect1.height / 2 };
    const center2: Vector2d = { x: rect2.x + rect2.width / 2, y: rect2.y + rect2.height / 2 };

    // 中心点から境界までの交点を計算する、シンプルで堅牢な内部関数
    // ★引数を単純な数値型に限定し、undefinedの可能性を排除
    const getIntersection = (width: number, height: number, from: Vector2d, to: Vector2d): Vector2d => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        // 幅と高さの半分
        const w = width / 2;
        const h = height / 2;

        // ゼロ除算を避ける
        if (dx === 0 && dy === 0) return from;
        
        // ★ tの計算を、dxやdyが0の場合も安全なように修正
        let t = Infinity;
        if (dx !== 0) t = Math.min(t, Math.abs(w / dx));
        if (dy !== 0) t = Math.min(t, Math.abs(h / dy));
        
        return {
            x: from.x + dx * t,
            y: from.y + dy * t,
        };
    };

    // 各ノードの境界との交点を計算
    // ★ getIntersectionに、rectオブジェクトではなく、widthとheightの値を直接渡す
    const intersection1 = getIntersection(rect1.width, rect1.height, center1, center2);
    const intersection2 = getIntersection(rect2.width, rect2.height, center2, center1);

    return { start: intersection1, end: intersection2 };
}

function _updateTitle() {
  const el = document.getElementById('ip-filename-display');
  if (el) {
    const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : 'Untitled';

    el.textContent = `${fileName}`;
  }
  window.electronAPI.notifyTitleChange(currentFilePath);
}
  function markAsDirty() {
    if (!isDirty) { isDirty = true; }
    autoSaveChanges();
  }
  function markAsClean() {
    if (isDirty) { isDirty = false; }
  }

function _getCurrentStageData() {
  // --- 1. Nodes ---
  const nodesData: any[] = [];
  stage.find<Konva.Group>('.node-group').forEach(node => {
    const rect = node.findOne<Konva.Rect>('.background');
    const textNode = node.findOne<Konva.Text>('.text');

    // 必須データがなければスキップ
    if (!rect || !textNode) return;

    nodesData.push({
      id: node.id(),
      x: node.x(),
      y: node.y(),
      width: rect.width(),
      height: rect.height(),
      title: textNode.text(),
      contentText: node.getAttr('contentText') || '',
      // ★★★ ここで parentId を確実に取得・保存します ★★★
      parentId: node.getAttr('parentId') || null 
    });
  });

  // --- 2. Groups ---
  const groupsData: any[] = [];
  stage.find<Konva.Group>('.background-shape').forEach(group => {
    const rect = group.findOne<Konva.Rect>('.background');
    const label = group.findOne<Konva.Text>('Text');

    if (!rect || !label) return;
    
    groupsData.push({
      id: group.id(),
      x: group.x(),
      y: group.y(),
      width: rect.width(),
      height: rect.height(),
      label: label.text(),
    });
  });

  // --- 3. Links ---
  const linksData: any[] = [];
  stage.find<Konva.Group>('.link-group').forEach(linkGroup => {
    const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
    const type = linkGroup.getAttr('linkType');
    const label = linkGroup.findOne<Konva.Text>('.link-label');
    const sibling = linkGroup.getAttr('sibling');

    if (sibling && sibling.id() < linkGroup.id()) {
      return;
    }

    if (nodes && nodes.length === 2 && type) {
      linksData.push({
        id: linkGroup.id(), 
        from: nodes[0].id(),
        to: nodes[1].id(),
        type: type,
        label: label ? label.text() : '',
      });
    }
  });

  // --- 4. Final Data Object ---
  return {
    nodes: nodesData,
    links: linksData,
    groups: groupsData,
  };
}

/**
 * 現在の状態を.mrsdファイルとして保存する
 */
async function saveToFile(isSaveAs = false): Promise<any> {

  const saveData = _getCurrentStageData();

  // --- 3. 正しいデータオブジェクトをmainプロセスに送信する ---
  const filePathToSave = isSaveAs ? null : currentFilePath;

  try {
    // ★ IPC呼び出しの結果を、そのままreturnする
    const result = await window.electronAPI.saveIdeaProcessorFile(filePathToSave, saveData);

    if (result.success && result.path) {
      currentFilePath = result.path; 
      markAsClean(); // ★ 保存成功時にisDirtyフラグをリセット
      _updateTitle();
      console.log('保存成功:', currentFilePath);
    } else if (result.cancelled) {
      console.log('保存がキャンセルされました。');
    } else {
      console.error('保存に失敗しました:', result.error);
    }
    
    return result; // ★★★ `main`プロセスからの結果を、この関数の呼び出し元に返す

  } catch (error) {
    console.error('saveToFile関数でIPC呼び出し中にエラー:', error);
    // ★ エラーが発生した場合も、失敗したことを示すオブジェクトを返す
    return { success: false, error: (error instanceof Error) ? error.message : String(error) };
  }
}

// リセット処理を行う関数
function resetWindow() {
    // 1. Renderer側でズームとパンをリセット
    stage.position({ x: 0, y: 0 });
    stage.scale({ x: 1, y: 1 });
    stage.draw();

    // 2. Mainプロセスに、ウィンドウの位置とサイズのリセットを依頼
    window.electronAPI.resetIpWindow();
}

// --- Save As...ボタンのイベントリスナー ---
document.getElementById('ip-save-as-button')?.addEventListener('click', () => {
  saveToFile(true); 
});

document.getElementById('ip-close-btn')?.addEventListener('click', () => {
  window.electronAPI.toggleIPWindow(); 
});
document.getElementById('ip-fullscreen-btn')?.addEventListener('click', () => {
  window.electronAPI.requestToggleFullscreen(); 
});
document.getElementById('ip-reset-window-btn')?.addEventListener('click', resetWindow);

// /**
//  * ファイルから読み込んだデータでステージを再構築する
//  */
function recreateStage(data: any) {
  // ★ 履歴記録を一時停止
  isHistoryEnabled = false;
  
  // 1. まず、ステージを完全に更地にする
  layer.find('.node-group, .link-group, .background-shape').forEach(node => {
    node.destroy();
  });
  selectedShape = null;

  try {
    const createdNodes = new Map<string, Konva.Group>();
    const createdGroups = new Map<string, Konva.Group>();

    // ★★★ 2. 描画順序を、`zIndex`に従って、完全に制御する ★★★
    
    // a) まず、背景である「グループ」をすべて作成・追加
    if (data.groups && Array.isArray(data.groups)) {
      data.groups.forEach(groupData => {
        // `createGroupFromData`は、内部で`createBackgroundShape`を呼び出し、
        // そこでリスナーも設定されるので、これで正しい
        const group = createGroupFromData(groupData);
        createdGroups.set(group.id(), group); // マップに追加
      });
    }

    // b) 次に、「通常ノード」をすべて作成・追加
    if (data.nodes && Array.isArray(data.nodes)) {
      data.nodes.forEach(nodeData => {
        const nodeGroup = createNodeFromData(nodeData);
        nodeGroup.setAttr('contentText', nodeData.contentText || '');
        // parentIdを属性として一時保存
      if (nodeData.parentId) {
        nodeGroup.setAttr('parentId', nodeData.parentId);
      }
        // `createNodeFromData`は`layer.add`を呼ばないので、ここで呼ぶ
        layer.add(nodeGroup); 
        createdNodes.set(nodeData.id, nodeGroup);
      });
    }

    // 全ノード作成後に親子関係を再構築 
    createdNodes.forEach(node => {
      const parentId = node.getAttr('parentId');
      if (parentId) {
        const parentGroup = createdGroups.get(parentId);
        if (parentGroup) {
          node.moveTo(parentGroup);
          updateNodeVisuals(node, false);  // 枠線も復元
        }
      }
    });    

    // c) 最後に、「リンク」をすべて作成・追加

    if (data.links && Array.isArray(data.links)) {
      data.links.forEach(linkData => {
        const fromNode = createdNodes.get(linkData.from);
        const toNode = createdNodes.get(linkData.to);
        if (fromNode && toNode) {
          // `manageLink`は履歴を記録してしまうので、ここでは呼ばない。
          // `createSingleLink`を直接呼ぶのが、より安全。
          if (linkData.type === LinkType.DOUBLE_ARROW) {
              const lg1 = createSingleLink(fromNode, toNode, LinkType.ARROW, linkData.label);
              const lg2 = createSingleLink(toNode, fromNode, LinkType.ARROW, '');
              lg1.setAttr('sibling', lg2); lg2.setAttr('sibling', lg1);
              lg1.setAttr('linkType', LinkType.DOUBLE_ARROW); lg2.setAttr('linkType', LinkType.DOUBLE_ARROW);
          } else {
              createSingleLink(fromNode, toNode, linkData.type, linkData.label);
          }
        }
      });
    }
    //　力技
    if (data.edges && Array.isArray(data.edges)) {
      data.edges.forEach(edgeData => {
        const fromNode = createdNodes.get(edgeData.fromNode);
        const toNode = createdNodes.get(edgeData.toNode);
        
        if (fromNode && toNode) {
          if (edgeData.type === LinkType.DOUBLE_ARROW) {
              // `findSibling`に頼るのではなく、セーブデータに含まれる
              // 2本の逆向き矢印を、それぞれ確実に再創造する
              // (セーブデータは、DOUBLE_ARROWを1つのedgeとして記録しているので、
              //  このロジックは、それを2本のARROWに変換して生成する)
              const lg1 = createSingleLink(fromNode, toNode, LinkType.ARROW, edgeData.label);
              const lg2 = createSingleLink(toNode, fromNode, LinkType.ARROW, '');
              lg1.setAttr('sibling', lg2); lg2.setAttr('sibling', lg1);
              lg1.setAttr('linkType', LinkType.DOUBLE_ARROW); lg2.setAttr('linkType', LinkType.DOUBLE_ARROW);
          } else {
              createSingleLink(fromNode, toNode, edgeData.type, edgeData.label);
          }
        }
      });
    }    

  } catch (error) {
    console.error('recreateStageでエラーが発生:', error);
  }

  // 3. すべてのオブジェクトが配置された後で、最後に一度だけ描画
  layer.draw();
  window.electronAPI.notifyRendererIsReady();
  // 4. 履歴記録を再開する
  isHistoryEnabled = true;
  
  // ★ `recreateStage`は、新しい履歴を「記録しない」。
  //    記録するのは、`load-data`リスナーや`undo`/`redo`の責務。
}

// Loadボタンのイベントリスナー
document.getElementById('ip-load-button')?.addEventListener('click', () => {
  window.electronAPI.ideaOpenFile();
});
// 新規作成ボタンのハンドラ
document.getElementById('ip-new-file-button')?.addEventListener('click', () => {
  handleNewFile();
});

// エクスポート関連

const exportButton = document.getElementById('ip-export-button')!;
const exportMenu = document.getElementById('ip-export-menu')!;

// エクスポートボタンをクリックしたら、メニューの表示/非表示を切り替える
exportButton.addEventListener('click', (e) => {
  e.stopPropagation(); // イベントが window まで伝播しないようにする
  exportMenu.classList.toggle('hidden');
});

// メニュー項目をクリックしたときの処理
exportMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('export-item')) {
    const format = target.dataset.format;

    if (format === 'html') {
      exportAsHtml();
    } else if (format === 'md') {
      const markdownContent = generateMarkdownContent();
      window.electronAPI.exportAsMarkdown(markdownContent, currentFilePath);
    }
    else if (format === 'png') {
      exportAsImageAndSendToMain('png');
    }    
    else if (format === 'pdf') {
      exportAsImageAndSendToMain('pdf');
    }    
    else if (format === 'send-to-editor') {
        const markdownContent = generateMarkdownContent();
        window.electronAPI.sendMarkdownToEditor(markdownContent);
    }

    exportMenu.classList.add('hidden'); // 処理を実行したらメニューを閉じる
  }
});

// ウィンドウのどこかをクリックしたら、メニューを閉じる (UX向上のため)
window.addEventListener('click', () => {
  if (!exportMenu.classList.contains('hidden')) {
    exportMenu.classList.add('hidden');
  }
});

// --- ★ テーマ情報をJavaScriptで一元管理 ---
const themes = {
  light: {
    text: '#111111',
    link: '#333333',
    selection: '#cb0707ff',
    nodeBg: 'transparent', 
    labelBackground:'#cccccc',
//    pairedBorder: '#888888',
    pairedBg: 'rgba(120, 120, 120, 0.2)'
  },
  dark: {
    text: '#cccccc', 
    link: '#cccccc',
    selection: '#d31010ff',
    nodeBg: 'transparent',
    labelBackground:'#444444',
//    pairedBorder: '#cccccc', 
    pairedBg: 'rgba(155, 155, 155, 0.3)'
  }
};

/**
 * 現在のテーマ（ライトかダークか）に基づいて、色のセットを返す
 */
function getCurrentThemeColors() {
  const isDarkMode = document.body.classList.contains('dark-mode');
  return isDarkMode ? themes.dark : themes.light;
}

/**
 * ノードの視覚スタイルを、現在の状態（ペアリング、選択）に基づいて更新する
 * @param nodeGroup 対象のノード
 * @param isSelected 選択されているか
 */
function updateNodeVisuals(nodeGroup: Konva.Group, isSelected: boolean) {
    const backgroundRect = nodeGroup.findOne<Konva.Rect>('.background');
    if (!backgroundRect) return;

    const colors = getCurrentThemeColors();
    const isPaired = !!nodeGroup.getAttr('parentId');

    // 枠線は常に無効
    backgroundRect.strokeEnabled(false);

    // 背景の塗りつぶしを決定
    if (isSelected) {
        const selectionRgb = Konva.Util.getRGB(colors.selection);
        backgroundRect.fill(`rgba(${selectionRgb.b}, ${selectionRgb.g}, ${selectionRgb.r}, 0.3)`);
    } else if (isPaired) {
        backgroundRect.fill(colors.pairedBg);
    } else {
        backgroundRect.fill(colors.nodeBg);
    }
}

/**
 * 指定されたシェイプに選択状態のスタイルを適用する
 * @param shape 対象のKonva.Group (ノード、グループ、リンク)
 */
function applySelectionStyle(shape: Konva.Group) {
  const colors = getCurrentThemeColors();

  if (shape.name() === 'link-group') {
    // リンク自身のスタイルを適用
    const linkShape = shape.findOne<Konva.Line | Konva.Arrow>('.link-shape');
    if (linkShape) {
      linkShape.stroke(colors.selection);
      linkShape.strokeWidth(4 / stage.scaleX());
      if (linkShape instanceof Konva.Arrow) {
        linkShape.fill(colors.selection);
      }
    }
    // ジオメトリで相方を探し、スタイルを適用
    const sibling = findSiblingByGeometry(shape);
    if (sibling) {
      const siblingShape = sibling.findOne<Konva.Line | Konva.Arrow>('.link-shape');
      if (siblingShape) {
        siblingShape.stroke(colors.selection);
        siblingShape.strokeWidth(4 / stage.scaleX());
        if (siblingShape instanceof Konva.Arrow) {
          siblingShape.fill(colors.selection);
        }
      }
    }
    } else if (shape.name() === 'node-group') {
        updateNodeVisuals(shape, true);
    } else if (shape.name() === 'background-shape') {
    // ノードや背景図形の場合の選択スタイル
    const rect = shape.findOne<Konva.Rect>('.background');
    if (rect) {
        rect.strokeEnabled(false);
        const selectionRgb = Konva.Util.getRGB(colors.selection);
        rect.fill(`rgba(${selectionRgb.b}, ${selectionRgb.g}, ${selectionRgb.r}, 0.3)`);
    }
    shape.find('.resize-handle').forEach(h => {
      h.show();
      h.listening(true);
    });
  }
}

/**
 * ステージ上の全オブジェクトの色を現在のテーマに合わせる
 */
function applyThemeToStage() {
  const isDarkMode = document.body.classList.contains('dark-mode');
  const colors = isDarkMode ? themes.dark : themes.light;

  // --- 1. グループ関連のスタイルを更新 ---
  stage.find<Konva.Group>('.background-shape').forEach(group => {
    const rect = group.findOne<Konva.Rect>('.background');
    const label = group.findOne<Konva.Text>('Text');
    // findOneに<Konva.Circle>と型引数を渡して、handleの型を正確にする
    const handle = group.findOne<Konva.Circle>('.resize-handle');

    if (rect) {
      rect.stroke(colors.text);
    }
    if (label) {
      label.fill(colors.text);
    }
    // handleが存在する場合のみ、fillを呼び出す
    if (handle) {
      handle.fill(colors.text);
    }
  });

  // --- 2. リンク関連のスタイルを更新 ---
  stage.find<Konva.Group>('.link-group').forEach(linkGroup => {
    const linkShape = linkGroup.findOne<Konva.Line | Konva.Arrow>('.link-shape');
    const labelContainer = linkGroup.findOne<Konva.Label>('.link-label-container');
    
    if (labelContainer) {
        const tag = labelContainer.findOne<Konva.Tag>('Tag');
        const text = labelContainer.findOne<Konva.Text>('.link-label');
        if (tag) {
            tag.fill(colors.labelBackground);
            tag.stroke(colors.text);
        }
        if (text) {
            text.fill(colors.text);
        }
    }
    
    if (linkShape) {
        if (selectedShape !== linkGroup) {
            linkShape.stroke(colors.link);
            if (linkShape instanceof Konva.Arrow) {
                linkShape.fill(colors.link);
            }
        }
    }
  });
  
  // --- 3. 全てのノードのスタイルを更新 ---
  stage.find<Konva.Group>('.node-group').forEach(nodeGroup => {
    const text = nodeGroup.findOne<Konva.Text>('.text');
    if (text) {
      text.fill(colors.text);
    }
    const isSelected = (selectedShape === nodeGroup);
    updateNodeVisuals(nodeGroup, isSelected);
  });
  
  // --- 4. 選択中のオブジェクトがあれば、選択スタイルを再適用 ---
  if (selectedShape) {
    applySelectionStyle(selectedShape);
  }

  // --- 5. 最後に一度だけ再描画 ---
  layer.draw();
}

// --- テーマ切り替えボタンのロジック ---
const themeToggleButton = document.getElementById('ip-theme-toggle-button');
if (themeToggleButton) {
  themeToggleButton.addEventListener('click', () => {
    window.electronAPI.toggleDarkMode(); 
  });
}

// ページ読み込み時にも一度テーマを適用
document.addEventListener('DOMContentLoaded', () => {
    // OSの設定などを将来的に反映させる場合はここにロジックを追加
    applyThemeToStage();
});

function createGroupFromData(groupData: any) {
  // createBackgroundShapeを流用してオブジェクトを作成
  const group = createBackgroundShape({ x: groupData.x, y: groupData.y });
  // ID、サイズ、テキストをロードしたデータで上書き
  group.id(groupData.id);
  group.findOne<Konva.Rect>('.background')?.size({ width: groupData.width, height: groupData.height });
  group.findOne<Konva.Text>('Text')?.text(groupData.label);
  
  return group;
}

stage.on('wheel', (e) => {
  // マウスホイールイベントのデフォルトの挙動（ページのスクロール）を止める
  e.evt.preventDefault();

  const scaleBy = 1.05;
  const oldScale = stage.scaleX();

  const pointer = stage.getPointerPosition();
  if (!pointer) return;

  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };
  
  // スクロール方向に応じて拡大・縮小
  const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

  stage.scale({ x: newScale, y: newScale });

  const newPos = {
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  };
  stage.position(newPos);
  stage.batchDraw();
  updateHtmlElementsScale(newScale);
});
document.getElementById('ip-zoom-reset-btn')?.addEventListener('click', () => {
  stage.scale({ x: 1, y: 1 });
  // 中央に戻すか、(0,0)に戻すかはお好みで
  stage.position({ x: 0, y: 0 }); 
  stage.batchDraw();
  updateHtmlElementsScale(1); 
});

const toggleOnTopBtn = document.getElementById('ip-toggle-on-top-btn');
if (toggleOnTopBtn) {
  // --- a) ボタンのクリックイベント ---
  toggleOnTopBtn.addEventListener('click', async () => {
    // mainにトグルを依頼し、変更後の状態を受け取る
    const isNowOnTop = await window.electronAPI.toggleIpAlwaysOnTop();
    // 受け取った状態で、ボタンの見た目を更新
    toggleOnTopBtn.style.opacity = isNowOnTop ? '1.0' : '0.5';
  });

  // --- b) 起動時に、mainから送られてくる初期状態を受け取る ---
  window.electronAPI.on('ip-always-on-top-changed', (isNowOnTop: boolean) => {
    toggleOnTopBtn.style.opacity = isNowOnTop ? '1.0' : '0.5';
  });
}

/**
 * HTML要素のフォントサイズを、Konvaのスケールに合わせて更新する
 * @param scale 現在のスケール
 */
function updateHtmlElementsScale(scale: number) {
    const contentEditor = document.getElementById('ip-content-editor');
    const filenameDisplay = document.getElementById('ip-filename-display');

    // 基本となるフォントサイズを定義
    const baseEditorFontSize = 16; // px
    const baseFilenameFontSize = 12; // px

    if (contentEditor) {
        contentEditor.style.fontSize = `${baseEditorFontSize * scale}px`;
    }
    if (filenameDisplay) {
        filenameDisplay.style.fontSize = `${baseFilenameFontSize * scale}px`;
    }
}

/**
 * ラベル付きの背景図形を作成する (新リサイズ機能版)
 */
function createBackgroundShape(pos: Vector2d) {
  const group = new Konva.Group({
    x: pos.x,
    y: pos.y,
    draggable: true,
    id: `group_${Date.now()}${Math.random()}`,
  });
  group.name('background-shape');

  const colors = getCurrentThemeColors();

  // 背景の四角形
  const rect = new Konva.Rect({
    name: 'background',
    width: 400,
    height: 300,
  fill: 'transparent', 
  stroke: colors.text,    
  strokeWidth: 1,     
  dash: [4, 4], 
    cornerRadius: 10,
  });

  // ラベル用のテキスト
  const label = new Konva.Text({
    text: 'グループ名',
    fontSize: 14,
    fontFamily: "'Klee Custom', serif-ja, serif",
    fill: colors.text,
    y:-25,
  });

  // ラベルのクリック判定用背景
  const labelBg = new Konva.Rect({
 //   width: label.width(), height: label.height(),
  });
  
  const labelGroup = new Konva.Group({ x: 10, y: -35 });
  labelGroup.add(labelBg, label);

  const handle = new Konva.Circle({
    name: 'resize-handle',
    x: rect.width(), y: rect.height(),
    radius: 8,
    fill: colors.text,
    opacity: 0.3,
    draggable: true,
    listening: false
  });

  group.add(rect, labelGroup, handle);
  layer.add(group);
  group.zIndex(0);
  rect.zIndex(0);         // 背景が一番後ろ
  labelGroup.zIndex(2);     // ラベルがその手前

  // --- イベントハンドラ ---

  let oldPos: { x: number, y: number };
  group.on('dragstart', () => { oldPos = group.position(); });
  group.on('dragend', () => {
    const newPos = group.position();
    if (oldPos.x !== newPos.x || oldPos.y !== newPos.y) {
      recordHistory('Group Moved'); 
    }
  });

  group.on('dragmove', () => {
    // 更新が必要なユニークなリンクを格納するためのSet
    const linksToUpdate = new Set<Konva.Group>();

    // このグループに所属するすべての子ノードを取得
    const children = group.find<Konva.Group>('.node-group');

    children.forEach(node => {
        // 各子ノードに接続されているリンクを取得
        const links = node.getAttr('links') as Konva.Group[];
        if (links) {
            links.forEach(link => {
                // Setに追加する（重複は自動的に無視される）
                linksToUpdate.add(link);
            });
        }
    });

    // Setに集められたユニークなリンクの位置をすべて更新
    linksToUpdate.forEach(link => {
        updateLinkPoints(link);
    });

    // layer.batchDraw() はKonvaがdragmove中に自動で行うので、ここでは不要な場合が多い
    // もし描画が追いつかない場合は layer.batchDraw() を有効にする
  });  

  // ★ ハンドルのドラッグでリサイズ
  handle.on('dragmove', () => {
    const minSize = 50;
    const newWidth = Math.max(minSize, handle.x());
    const newHeight = Math.max(minSize, handle.y());
    rect.width(newWidth);
    rect.height(newHeight);
    layer.batchDraw();
  });
  handle.on('dragend', () => {
    recordHistory('Group resized');
  });  
  handle.on('mouseenter', () => { stage.container().style.cursor = 'nwse-resize'; });
  handle.on('mouseleave', () => { stage.container().style.cursor = 'default'; });
  
  const updateHandlePosition = () => {
    handle.x(rect.width());
    handle.y(rect.height());
  };
  rect.on('widthChange', updateHandlePosition);
  rect.on('heightChange', updateHandlePosition);
  
  // --- 最小サイズの確保と、ホバーエフェクト ---
  const updateLabelVisuals = () => {
    const PADDING = 5; // 余白を定数として定義
    const minWidth = 80;
    const minHeight = 20;

    // a) 背景(labelBg)のサイズを、テキストの自然なサイズ＋余白で計算
    const bgWidth = Math.max(minWidth, label.width() + PADDING * 2);
    const bgHeight = Math.max(minHeight, label.height() + PADDING * 2);
    labelBg.size({ width: bgWidth, height: bgHeight });

    // b) テキスト(label)を、背景(labelBg)の中央に配置する
    label.position({
      x: (bgWidth - label.width()) / 2,
      y: (bgHeight - label.height()) / 2,
    });
  };

  label.on('textChange', updateLabelVisuals);
  updateLabelVisuals(); // 初期状態を反映

  // ホバー時に背景色を変える
  labelGroup.on('mouseenter', () => {
    // テーマに応じた、薄いハイライト色を定義
    const highlightColor = document.body.classList.contains('dark-mode')
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.05)';
    labelBg.fill(highlightColor);
    layer.draw(); // 即時反映
  });

  labelGroup.on('mouseleave', () => {
    labelBg.fill('transparent'); // 透明に戻す
    layer.draw();
  });

  labelGroup.on('dblclick dbltap', (e) => {
    e.cancelBubble = true; 
    e.evt.preventDefault();
    handle.hide();
    editShapeLabel(label); 
  });

  handle.hide();
  layer.draw();
//  recordHistory('Group created');
  return group;
}

// --- 範囲選択機能 ---

// (initializeIdeaProcessor の中に追加)

// --- 最終確定版：範囲選択機能 ---

// 1. 範囲選択と、選択後の操作の両方を担うTransformer
const transformer = new Konva.Transformer({
  visible: false,
  resizeEnabled: false,
  rotateEnabled: false,
  borderEnabled: false,
  anchorSize: 0,
});
layer.add(transformer);

// 2. 範囲選択の「ラバーバンド」兼「ドラッグハンドル」
const selectionRect = new Konva.Rect({
  fill: 'rgba(0, 123, 255, 0.5)', // ラバーバンド描画中の色
  visible: false,
  draggable: true, // 選択完了後にドラッグ可能にする
});
layer.add(selectionRect);

// 3. 状態変数
let selectionStartPos: { x: number; y: number } | null = null;
let isDraggingSelection = false; // ★ ドラッグ中かを判定する専用フラグ
let selectedNodes: Konva.Group[] = [];
let lastRectPos: { x: number; y: number };

// 4. イベントハンドラ
stage.on('mousedown', (e) => {
  if (isContentEditing) return;
  // 条件: 左クリック(0) かつ 背景がクリックされた場合
  if (e.evt.button === 0 && (e.target === stage || e.target.name() === 'background')) {
    // 既存の選択を解除
    transformer.nodes([]);
    selectionRect.visible(false);
    selectedNodes = [];
    
    // ドラッグ開始の「準備」だけを行う
    selectionStartPos = stage.getRelativePointerPosition();
    isDraggingSelection = false; // この時点ではまだドラッグではない
  }
});

stage.on('mousemove', (e) => {
  if (isContentEditing) return;
  if (!selectionStartPos) return;
  e.evt.preventDefault();

  // 最初のmousemoveで、ドラッグが確定する
  if (!isDraggingSelection) {
    isDraggingSelection = true;
    selectionRect.visible(true); // ここで初めて表示する
  }
  
  const pos = stage.getRelativePointerPosition()!;
  const x1 = selectionStartPos.x;
  const y1 = selectionStartPos.y;
  const x2 = pos.x;
  const y2 = pos.y;

  // ラバーバンドを描画
  selectionRect.setAttrs({
    fill: 'rgba(0, 123, 255, 0.5)', // 描画中の色
    strokeEnabled: false,
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
});

stage.on('mouseup', (e) => {
    if (contentEditorJustClosed) {
        contentEditorJustClosed = false;
        return;
    }  
  if (isContentEditing) return;
  // --- 1. 範囲選択の完了処理 ---
  if (selectionStartPos) {
    if (isDraggingSelection) { // ドラッグがあった場合のみ
      const box = selectionRect.getClientRect();
      selectedNodes = stage.find<Konva.Group>('.node-group').filter(node =>
        Konva.Util.haveIntersection(box, node.getClientRect())
      );

      if (selectedNodes.length > 0) {
        // a) Transformer にノードをアタッチして、視覚的な枠を表示
        transformer.nodes(selectedNodes);
        transformer.visible(true);

        // b) selectionRect を、ドラッグハンドルとして半透明にする
        selectionRect.setAttrs({
          fill: 'rgba(0, 123, 255, 0.2)',
          strokeEnabled: true,
          stroke: '#007bff',
          strokeWidth: 1,
        });
        selectionRect.moveToTop();
        transformer.moveToTop();

      } else {
        // 何も選択されなかったら、ラバーバンドは消す
        selectionRect.visible(false);
      }
    }
    // 状態をリセット
    selectionStartPos = null;
    isDraggingSelection = false;
    layer.draw();
    return; // 範囲選択処理はここで終了
  }

  // --- 2. 右クリックでのコンテンツエディタ表示 ---
  if (e.evt.button === 2) {
    if (!didPan) { // パンが発生しなかった場合
      const clickedNode = e.target.findAncestor('.node-group');
      if (clickedNode) {
        openContentEditor(clickedNode as Konva.Group);
      }
    }
    // パン状態を解除
    isPanning = false;
    stage.container().style.cursor = 'default';
  }
});

// --- 選択範囲全体のドラッグ処理 ---
selectionRect.on('dragstart', (e) => {
    // Transformerが表示されている（＝複数選択中）場合のみドラッグを許可
    if (!transformer.visible()) {
        selectionRect.stopDrag();
        e.cancelBubble = true;
        return;
    }
    lastRectPos = selectionRect.position();
    transformer.stopTransform();
});

selectionRect.on('dragmove', () => {
    const pos = selectionRect.position();
    const dx = pos.x - lastRectPos.x;
    const dy = pos.y - lastRectPos.y;

    selectedNodes.forEach(node => {
        node.move({ x: dx, y: dy });
    });

    lastRectPos = pos;
    //transformer.forceUpdate();

    // 更新が必要なユニークなリンクを格納するためのSet
    const linksToUpdate = new Set<Konva.Group>();

    // 選択されているすべてのノードから、関連するリンクを収集
    selectedNodes.forEach(node => {
        const links = node.getAttr('links') as Konva.Group[];
        if (links) {
            links.forEach(link => {
                linksToUpdate.add(link);
            });
        }
    });

    // Setに集められたユニークなリンクの位置をすべて更新
    linksToUpdate.forEach(link => {
        updateLinkPoints(link);
    });
});

selectionRect.on('dragend', () => {
    recordHistory('Moved multiple nodes');
});

stage.on('mousedown', (e) => {
    if (e.evt.button === 2 && isContentEditing ) {
      e.evt.preventDefault();
      e.evt.stopPropagation();
      closeContentEditor();
      return;
    } else  { if(isContentEditing) return;
    }    

  // 右クリック(2)の場合のみ
  if (e.evt.button === 2) {

    didPan = false; // mousedown時にリセット
    lastPointerPosition = stage.getPointerPosition()!;
    if (e.target !== stage && e.target.name() !== 'background') return;
    isPanning = true;    
    // クリック対象が背景なら、掴むカーソルに変更
    if (e.target === stage || e.target.name() === 'background') {
      stage.container().style.cursor = 'grabbing';
    }
  }
});

stage.on('mousemove', (_e) => {
  if (isContentEditing) return;
  if (!isPanning) return;
  
  didPan = true; // mousemoveが一度でも呼ばれたら、ドラッグと見なす
  const pos = stage.getPointerPosition();
  if (!pos) return;

  const dx = pos.x - lastPointerPosition.x;
  const dy = pos.y - lastPointerPosition.y;
  
  stage.position({
    x: stage.x() + dx,
    y: stage.y() + dy,
  });
  
  lastPointerPosition = pos;
  stage.batchDraw();
});

// --- ブラウザのデフォルト右クリックメニューを抑制 ---
stage.on('contextmenu', (e) => {
  e.evt.preventDefault();
});

/**
 * 背景図形のラベルを編集する関数
 */
function editShapeLabel(labelNode: Konva.Text) {
  isTextEditing = true;
  updateButtonInteractivity(true);
  // ★ 操作対象を #ip-label-editor に変更
  const labelEditor = document.getElementById('ip-label-editor') as HTMLTextAreaElement;
  
  const oldText = labelNode.text(); // ★ 編集開始前のテキストを保持
  labelNode.opacity(0);
  layer.draw();


  const stageBox = stage.container().getBoundingClientRect();
  const textPosition = labelNode.absolutePosition();
  const scale = stage.scaleX();
  const baseFontSize = labelNode.fontSize();
  const minWidth = baseFontSize * 8; // 最低幅
  const clientRect = labelNode.getClientRect(); // Text自身のClientRectを使う
  const newWidth = Math.max(minWidth, clientRect.width / scale);  
  
  labelEditor.value = labelNode.text().trim() === '' ? '' : labelNode.text();
  labelEditor.style.display = 'block';
  labelEditor.style.position = 'absolute';
  labelEditor.style.top = (stageBox.top + textPosition.y) + 'px';
  labelEditor.style.left = (stageBox.left + textPosition.x) + 'px';
  labelEditor.style.width = (newWidth * scale) + 'px'; 
  labelEditor.style.height = (clientRect.height * scale) + 'px';
  labelEditor.style.fontSize = (baseFontSize * scale) + 'px';
  labelEditor.focus();
  labelEditor.select();

  // ★ テキストエリアの高さを、内容に合わせて自動調整する
  const adjustHeight = () => {
    // 一度高さをリセットしないと、縮小がうまく機能しない
    labelEditor.style.height = 'auto';
    labelEditor.style.height = labelEditor.scrollHeight + 'px';
  };
  // `input`イベント（＝ユーザーが何かを入力するたび）に、この関数を紐付ける
  labelEditor.addEventListener('input', adjustHeight);
  
  // ★ 編集開始時に一度呼び出して、現在のテキスト量に合わせた初期の高さを設定する
  adjustHeight(); 

  const finishEdit = () => {
    isTextEditing = false;
    updateButtonInteractivity(false);
    const newTextRaw = labelEditor.value;
    // テキストが空なら、描画が崩れないように半角スペースを入れる
    const newText = newTextRaw.trim() === '' ? ' ' : newTextRaw;

    // 1. まず、Konvaオブジェクトのテキストを更新する
    labelNode.text(newText);
    
    // 2. テキストに「本当に」変更があった場合のみ、履歴を記録する
    if (oldText !== newText) {
      // 既にKonvaオブジェクトが更新された状態で履歴を記録
      recordHistory('Group label changed');
      renderIpOutline();
    }

    // 3. 最後に後片付け
    labelEditor.style.display = 'none';
    labelNode.opacity(1);
    
    if (selectedShape && selectedShape.name() === 'background-shape') {
      selectedShape.find('.resize-handle').forEach(h => h.show());
    }
    
    layer.draw();
    
    // イベントリスナーを必ず解除
    labelEditor.removeEventListener('blur', finishEdit);
    labelEditor.removeEventListener('keydown', handleKeyDown);
    labelEditor.removeEventListener('input', adjustHeight);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // 1. DeleteやBackspaceキーが、ノード削除などのグローバルショートカットを
    //    誤爆させないようにする
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation();
    }
    // 2. Ctrl+Enter または Cmd+Enter で入力を確定
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      labelEditor.blur(); 
    }
    // 3. Escapeキーでも入力を確定
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      labelEditor.blur();
    }
  };

  labelEditor.addEventListener('blur', finishEdit);
  labelEditor.addEventListener('keydown', handleKeyDown);
  labelEditor.addEventListener('input', adjustHeight);
}

// Create Groupボタンのリスナー
document.getElementById('ip-create-group-button')?.addEventListener('click', () => {
  createGroup();
});

function createGroup(){
  const absoluteCenter = {
    x: stage.width() / 2,
    y: stage.height() / 2,
  };
  const transform = stage.getAbsoluteTransform().copy().invert();
  const localCenter = transform.point(absoluteCenter);
  const finalPos = {
    x: localCenter.x - 200, 
    y: localCenter.y - 150,
  };
  createBackgroundShape(finalPos);
  recordHistory('Group created');
}



async function handleNewFile() {
  // 1. まず`renderer`側でDirtyチェック
  if (isDirty) {
    const result = await saveToFile(currentFilePath ? false : true);
    if (!result.success && !result.cancelled) {
      return; // ユーザーがキャンセルしたら、何もしない
    }
  }

  // 2. `main`に「新規ファイル処理（履歴リセットと、Untitled.mrsd作成）をお願いします」と依頼
  window.electronAPI.fileNew();
}

function findSibling(linkGroup: Konva.Group): Konva.Group | undefined {
  const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
  if (!nodes || nodes.length !== 2) return undefined;
  const [nodeA, nodeB] = nodes;

  const allLinkGroups = layer.find<Konva.Group>('.link-group');
  return allLinkGroups.find(otherLinkGroup => {
    if (otherLinkGroup === linkGroup) return false; // 自分自身は除外
    const otherNodes = otherLinkGroup.getAttr('nodes') as Konva.Group[];
    if (!otherNodes || otherNodes.length !== 2) return false;
    const [nodeC, nodeD] = otherNodes;
    // 逆方向のリンク（nodeB -> nodeA）を探す
    return (nodeC === nodeB && nodeD === nodeA);
  });
}

/**
 * ジオメトリ（両端ノードのID）に基づいて、双方向矢印の相方のリンクグループを探す
 * @param linkGroup 基準となるリンクグループ
 * @returns 見つかった相方のリンクグループ、またはundefined
 */
function findSiblingByGeometry(linkGroup: Konva.Group): Konva.Group | undefined {
  const nodes = linkGroup.getAttr('nodes') as Konva.Group[];
  if (!nodes || nodes.length !== 2) return undefined;

  // 自分の起点(A)と終点(B)のIDを取得
  const nodeA_id = nodes[0].id();
  const nodeB_id = nodes[1].id();

  // ステージ上の、他のすべてのリンクグループを検索
  const allLinks = stage.find<Konva.Group>('.link-group');
  
  return allLinks.find(otherLink => {
    // 自分自身は除外
    if (otherLink.id() === linkGroup.id()) return false;
    
    const otherNodes = otherLink.getAttr('nodes') as Konva.Group[];
    if (!otherNodes || otherNodes.length !== 2) return false;
    
    // 相手の起点(C)と終点(D)のIDを取得
    const nodeC_id = otherNodes[0].id();
    const nodeD_id = otherNodes[1].id();
    
    // (相手の起点が自分の終点) かつ (相手の終点が自分の起点) かをチェック
    return (nodeC_id === nodeB_id && nodeD_id === nodeA_id);
  });
}

async function undo() {
  if (isTextEditing) return;
  if (!isHistoryEnabled) return;
  isHistoryEnabled = false;
  
  try {
    const prevStateString = await window.electronAPI.historyUndo();
    if (prevStateString) {
      const data = JSON.parse(prevStateString);
      
      // `recreateStage`を、`load-data`と同じ「正規のルート」で呼び出す
      // (ここでは、IPCを介さず、直接関数を呼び出すのが最もシンプル)
      
      // 1. `currentFilePath`は変更しないので、`filePath`は`null`で良い
      const payload = {
        filePath: currentFilePath, // アンドゥでファイルパスは変わらない
        data: data,
      };
      
      // 2. `load-data`リスナーの「中身」を、直接実行する
      //    (これにより、`load-data`のロジックと完全に一貫性が保たれる)
      currentFilePath = payload.filePath;
      recreateStage(payload.data);
      markAsDirty(); // ★ アンドゥは「変更」なので、必ずダーティにする

    }
  } finally {
    isHistoryEnabled = true;
    transformer.nodes([]);
    selectionRect.visible(false);
    renderIpOutline();
    layer.draw();    
  }
}

// `redo`メソッド
async function redo() {
  if (isTextEditing) return;
  if (!isHistoryEnabled) return;
  isHistoryEnabled = false;
  
  try {
    const nextStateString = await window.electronAPI.historyRedo();
    if (nextStateString) {
      const data = JSON.parse(nextStateString);
      const payload = { filePath: currentFilePath, data: data };
      
      // ★ こちらも、`load-data`リスナーと全く同じ処理を実行
      currentFilePath = payload.filePath;
      recreateStage(payload.data);
      markAsDirty();
    }
  } finally {
    isHistoryEnabled = true;
    transformer.nodes([]);
    selectionRect.visible(false);
    renderIpOutline();
    layer.draw();    
  }
}

  window.electronAPI.on('trigger-ip-undo', () => {
     if (isTextEditing) return;
    undo();
  });
  window.electronAPI.on('trigger-ip-redo', () => {
     if (isTextEditing) return;
    redo();
  });
  window.electronAPI.on('toggle-ip-outline', () => {
    const Pane = document.getElementById('ip-outline-pane')!;
    Pane.classList.toggle('hidden');
    if (!Pane.classList.contains('hidden')) {
      renderIpOutline();
    }
  });


  // 1. 初期化データを受け取るリスナーを設置
  window.electronAPI.on('initialize-idea-processor', (data: { theme: string, zoomState: { scale: number, position: Vector2d } , filePathToLoad: string | null }) => {
    
    // a) テーマを適用
    if (data.theme === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    stage.scale({ x: data.zoomState.scale, y: data.zoomState.scale });
    stage.position(data.zoomState.position);    
  // b) もし、復元すべきファイルパスが指定されていたら...
  if (data.filePathToLoad) {
    // ★ `main`プロセスに、そのファイルを開くようにお願いする
    window.electronAPI.ideaOpenFileByPath(data.filePathToLoad);
  } else {
    _updateTitle();
    recordHistory('Initial empty state');
    window.electronAPI.notifyRendererIsReady();
  }    
  });

// キーボードショートカット

window.addEventListener('keydown', (e) => {

  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;

      // --- Undo: Ctrl + Z ---
      if (isCtrlOrCmd && e.key.toLowerCase() === 'z' && !isShift) {
        if (isTextEditing) {
          e.stopPropagation();
          window.electronAPI.requestNativeUndo();
          return;
        }
        e.preventDefault(); // ★ ブラウザのネイティブアンドゥを止める
        undo();
      }

      // --- Redo: Ctrl + Y or Ctrl + Shift + Z ---
      if (isCtrlOrCmd && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && isShift))) {
        if (isTextEditing) {
          window.electronAPI.requestNativeRedo();
          return;
        }
        e.preventDefault(); 
        redo();
      }

      // --- Ctrl + Shift + R を止める ---
      if (isCtrlOrCmd && e.key.toLowerCase() === 'r' && isShift) {
        e.preventDefault(); 
        console.log("リセット禁止");
        return;
      }

      // --- Creat New File: Ctrl + N ---
      if (isCtrlOrCmd && e.key.toLowerCase() === 'n' && !isShift) {
        e.preventDefault(); 
        handleNewFile();
      }        
      
      // --- Creat New Group: Ctrl + G ---
      if (isCtrlOrCmd && e.key.toLowerCase() === 'g' && !isShift) {
        e.preventDefault(); 
        createGroup();
      }        

      // --- Reset Window: Ctrl + R ---
      if (isCtrlOrCmd && e.key.toLowerCase() === 'r' && !isShift) {
        e.preventDefault(); 
        resetWindow();
      }      

      // ノード作成：Shift+Enter
      if (isShift && e.key === 'Enter' && !isTextEditing) {
        e.preventDefault();

        const scale = stage.scaleX();
        const stagePos = stage.position();
        let targetPos = {
          x: (-stagePos.x + stage.width() / 2) / scale,
          y: (-stagePos.y + stage.height() / 2) / scale,
        };

        let existingNode: Konva.Shape | null; // ★ `Shape | null`が正しい型
        const nodeHeight = 50;
        
        // `getIntersection`は、ピクセル単位でチェックするので、
        // ズームされた座標系でチェックする必要がある
        const absoluteTargetPos = {
            x: targetPos.x * scale + stagePos.x,
            y: targetPos.y * scale + stagePos.y,
        };

        do {
          existingNode = layer.getIntersection(absoluteTargetPos); // ★ `layer`で探すのがより正確
          if (existingNode && existingNode.findAncestor('.node-group')) {
            // ローカル座標系で、下にずらす
            targetPos.y += nodeHeight; 
            // チェック用の絶対座標も更新
            absoluteTargetPos.y += nodeHeight * scale;
          }
        } while (existingNode && existingNode.findAncestor('.node-group'));
        
        createNewNode(targetPos, stage);
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

  // エディタが表示されている時にEscapeキーが押されたら閉じる
  if (isContentEditing && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeContentEditor();
  }


},true);

// メインウィンドウでのテーマ変更に追従
window.electronAPI.onThemeUpdated((isDarkMode) => {
  console.log(`[Preview] Theme updated. Is dark mode: ${isDarkMode}`);
  document.body.classList.toggle('dark-mode', isDarkMode);
  applyThemeToStage();
});

  window.electronAPI.on('load-data', (payload) => {
    const { filePath, data } = payload;
    console.log('ロードデータを受信しました:', filePath, data);
    isHistoryEnabled = false;    
    currentFilePath = filePath;
    _updateTitle();     
    recreateStage(data);
    markAsClean();
    isHistoryEnabled = true;

    recordHistory("load-data");
    window.electronAPI.debugLog('record:load-data');
  });


// `main`からの`file:new`通知を受け取るリスナー
window.electronAPI.on('file:new', (newFilePath: string) => {
  // ★ `main`から、新しく作られた`Untitled.mrsd`のパスを受け取る
  currentFilePath = newFilePath;
  layer.destroyChildren();
  layer.draw();
  markAsClean(); 
  _updateTitle();
  recordHistory("new_file"); // ★ 空の盤面を、最初の履歴として記録
});

window.electronAPI.notifyReadyForData();
window.electronAPI.debugLog('initializeIdeaProcessorが、正常に呼び出されました。');

window.electronAPI.on('please-prepare-to-close', async () => {
  const zoomState = { scale: stage.scaleX(), position: stage.position() };

  const isUntitled = !currentFilePath || currentFilePath.endsWith('Untitled.mrsd');
  const isEmpty = stage.find('.node-group, .background-shape, .link-group').length === 0;

  // --- ケース1: Untitledで、中身が空ではない -> ユーザーに確認 ---
  if (isUntitled && !isEmpty) {
    const userResponse = await window.electronAPI.confirmSaveDialog('アイデアプロセッサ');
    if (userResponse === 'save') {
      const result = await saveToFile(true);
      window.electronAPI.notifyReadyToClose(result.success, zoomState, result.success ? result.path : currentFilePath);
    } else if (userResponse === 'discard') {
      window.electronAPI.notifyReadyToClose(true, zoomState, null);
    } else { // 'cancel'
      window.electronAPI.notifyReadyToClose(false, zoomState, currentFilePath);
    }
  } 
  // --- ケース2: Untitledで、中身も空 -> 何も聞かずに、次に開くパスをnullにする ---
  else if (isUntitled && isEmpty) {
    window.electronAPI.notifyReadyToClose(true, zoomState, null);
  }
  // --- ケース3: 通常ファイルで、変更がある
  else if (isDirty) {
    await saveToFile(false);
    window.electronAPI.notifyReadyToClose(true, zoomState, currentFilePath);
  }
  // --- ケース4: それ以外 (変更がない)
  else {
    window.electronAPI.notifyReadyToClose(true, zoomState, currentFilePath);
  }
});

// createSelectionGroup();

}