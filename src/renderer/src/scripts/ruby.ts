/**
 * ルビタグのテンプレート。
 * @constant
 * @type {string}
 */
const rubyTemplate = "<ruby>$1<rt>$2</rt></ruby>";

/**
 * ルビタグのための正規表現パターンとその置換テキストのリスト。
 * 各要素は以下のプロパティを持つオブジェクトです:
 *   - `pattern`: ルビの検出に使われる正規表現パターン。正規表現オブジェクトまたは文字列が必要です。
 *   - `replacement`: `pattern`にマッチした部分の置換テキスト。文字列が必要です。
 * 
 * @constant
 * @type {Array<{pattern: (RegExp|string), replacement: string}>}
 */
const rubyRegexList = [
	{ pattern: /[\|｜](.+?)《(.+?)》/g, replacement: rubyTemplate },
	{ pattern: /[\|｜](.+?)（(.+?)）/g, replacement: rubyTemplate },
	{ pattern: /[\|｜](.+?)\((.+?)\)/g, replacement: rubyTemplate },
	{ pattern: /\[\[rb:(.+?) &gt; (.+?)\]\]/g, replacement: rubyTemplate },
	{ pattern: /([\p{sc=Han}]+)《(.+?)》/gu, replacement: rubyTemplate },
	{ pattern: /([\p{sc=Han}]+)（([\p{sc=Hiragana}\p{sc=Katakana}ー～]+?)）/gu, replacement: rubyTemplate },
	{ pattern: /([\p{sc=Han}]+)\(([\p{sc=Hiragana}\p{sc=Katakana}ー～]+?)\)/gu, replacement: rubyTemplate },
	{ pattern: /[\|｜]《(.+?)》/g, replacement: "《$1》" },
	{ pattern: /[\|｜]（(.+?)）/g, replacement: "（$1）" },
	{ pattern: /[\|｜]\((.+?)\)/g, replacement: "($1)" }
];

/**
 * ルビタグのための正規表現マップのリスト。
 * @constant
 * @type {Array<Object>}
 */


/**
 * 与えられた文字列の中のルビタグを置換する。
 *
 * @param {string} str - ルビタグを置換する対象の文字列。
 * @returns {string} - ルビタグが置換された文字列。
 */


/**
 * 記事を更新し、そのHTMLコンテンツのルビタグを置換する。
 *
 * @param {HTMLElement} el - 更新する記事のHTML要素。
 */
const updateArticle = (el: HTMLElement) => {
  // TreeWalkerを使って、要素内のテキストノードだけを走査する
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  
  const nodesToProcess: Node[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    nodesToProcess.push(currentNode);
    currentNode = walker.nextNode();
  }

  nodesToProcess.forEach(node => {
    const text = node.nodeValue;
    if (!text) return;

    // テキストにルビのパターンが含まれているかチェック
    const hasRuby = rubyRegexList.some(r => r.pattern.test(text));
    if (!hasRuby) return;

    // ルビ変換後のHTMLを生成
    let processedHtml = text;
    rubyRegexList.forEach(r => {
      // 正規表現のlastIndexをリセット
      r.pattern.lastIndex = 0;
      processedHtml = processedHtml.replace(r.pattern, r.replacement);
    });

    // テキストノードを、ルビ変換後のHTMLを含むspan要素に置き換える
    const replacementNode = document.createElement('span');
    replacementNode.innerHTML = processedHtml;
    
    // replacementNodeの全ての子を、元のテキストノードの前に挿入
    while (replacementNode.firstChild) {
      node.parentNode?.insertBefore(replacementNode.firstChild, node);
    }
    // 元のテキストノードを削除
    node.parentNode?.removeChild(node);
  });
};

export default updateArticle;