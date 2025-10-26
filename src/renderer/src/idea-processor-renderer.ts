// 1. CSSのインポートはここで行う
import './assets/idea-processor.css';

// 2. ★ `idea-processor.ts`から、初期化用の関数を「export」するように変更する
import { initializeIdeaProcessor } from './scripts/idea-processor'; 

// 3. ★ DOMContentLoadedイベントを待つ
//    これにより、HTMLのすべての要素が解析され、準備が整ったことが保証される
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // ★ CSS Font Loading API を使う
    await document.fonts.load('16px "Klee Custom"'); // チェックしたいフォントとサイズを指定
    console.log('Klee Customフォントの読み込みが完了しました。');

    // ★ フォントがロードされてから、Konvaの初期化を実行する
    initializeIdeaProcessor();

  } catch (error) {
    console.error('フォントの読み込みに失敗しました:', error);
    // フォントがなくても、初期化は実行する
    initializeIdeaProcessor();
  }
});