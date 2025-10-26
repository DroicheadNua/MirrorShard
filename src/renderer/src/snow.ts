// src/renderer/src/snow.ts

// requestAnimationFrameのポリフィル
const requestAnimFrame = (function(){
    const w = window as any;
  return  w.requestAnimationFrame       ||
          w.webkitRequestAnimationFrame ||
          w.mozRequestAnimationFrame    ||
          function( callback: FrameRequestCallback ){
            window.setTimeout(callback, 1000 / 60);
          };
})();

/**
 * 雪のエフェクトを開始し、それを停止するための関数を返す
 * @param masthead 雪を降らせる親となるHTML要素
 * @returns 停止用の関数
 */
export function startSnowing(masthead: HTMLElement): () => void {

    const COUNT = 200;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let width = masthead.clientWidth;
    let height = masthead.clientHeight;
    let animationFrameId: number;

    // Snowflakeクラスの定義
    const Snowflake = function (this: any) {
      this.x = 0;
      this.y = 0;
      this.vy = 0;
      this.vx = 0;
      this.r = 0;
      this.o = 0;
      this.reset = () => {
        this.x = Math.random() * width;
        this.y = Math.random() * -height;
        this.vy = 0.2 + Math.random() * 1;// 雪の速度。元は 0.5 + Math.random() * 2
        this.vx = 0.3 - Math.random();
        this.r = 0.5 + Math.random() * 1.5;
        this.o = 0.3 + Math.random() * 0.5;
      };
      this.reset();
    } as any;

    canvas.style.position = 'absolute';
    canvas.style.left = canvas.style.top = '0';
    canvas.style.pointerEvents = 'none'; // クリックイベントを透過させる
    canvas.style.zIndex = '100'; // コンテンツの手前、UIの奥

    const snowflakes: any[] = [];
    for (let i = 0; i < COUNT; i++) {
      snowflakes.push(new Snowflake());
    }
  
    function update() {
      ctx.clearRect(0, 0, width, height);
  
      for (let i = 0; i < COUNT; i++) {
        const snowflake = snowflakes[i];
        snowflake.y += snowflake.vy;
        snowflake.x += snowflake.vx;
  
        ctx.globalAlpha = snowflake.o;
        ctx.beginPath();
        ctx.arc(snowflake.x, snowflake.y, snowflake.r, 0, Math.PI * 2, false);
        ctx.closePath();
        ctx.fill();
  
        if (snowflake.y > height) {
          snowflake.reset();
        }
      }
      animationFrameId = requestAnimFrame(update);
    }
  
    function onResize() {
      width = masthead.clientWidth;
      height = masthead.clientHeight;
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = '#FFF' 
    }

    onResize();
    window.addEventListener('resize', onResize);
    masthead.appendChild(canvas);
    
    update();

    // このアニメーションを停止するためのクリーンアップ関数を返す
    return () => {
      console.log('Stopping snow animation.');
      window.removeEventListener('resize', onResize);
      window.cancelAnimationFrame(animationFrameId);
      if (canvas.parentElement) {
        masthead.removeChild(canvas);
      }
    };
}