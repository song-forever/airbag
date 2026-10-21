/** Local motion in a fixed scene, with global camera shifts filtered first. */
export class FrameMotionDetector {
 constructor({width=160,height=90,threshold=.05,settleMs=700,shakeCooldownMs=1000}={}){
  this.width=width;this.height=height;this.threshold=threshold;this.settleMs=settleMs;this.shakeCooldownMs=shakeCooldownMs;this.reset();
 }
 reset(){this.previous=null;this.readyAt=0;}
 update(frame,now){
  const {width:w,height:h}=this;
  if(frame.length!==w*h||!Number.isFinite(now))throw new TypeError('Invalid motion frame or timestamp');
  const old=this.previous;this.previous=new Uint8Array(frame);
  if(!old){this.readyAt=now+this.settleMs;return {moving:false,cameraMoving:false,ready:false,changedRatio:0};}
  let drift=0;for(let i=0;i<frame.length;i++)drift+=frame[i]-old[i];drift/=frame.length;
  const cells=new Uint32Array(12),sizes=new Uint32Array(12);let changed=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const cell=Math.min(2,Math.floor(y*3/h))*4+Math.min(3,Math.floor(x*4/w));sizes[cell]++;
   if(Math.abs(frame[y*w+x]-old[y*w+x]-drift)>18){changed++;cells[cell]++;}
  }
  const ratio=changed/frame.length;
  let cameraMoving=false;
  if(ratio>=this.threshold){
   const cost=(dx,dy)=>{let total=0,matching=0,count=0;
    for(let y=9;y<h-9;y+=4)for(let x=9;x<w-9;x+=4){const delta=Math.abs(frame[(y+dy)*w+x+dx]-old[y*w+x]-drift);total+=Math.min(delta,36);if(delta<=18)matching++;count++;}
    return {error:total/count,matching:matching/count};
   };
   const base=cost(0,0);let best=base,dxBest=0,dyBest=0;
   for(let dy=-8;dy<=8;dy++)for(let dx=-8;dx<=8;dx++){
    if(!dx&&!dy)continue;const candidate=cost(dx,dy);
    if(candidate.error<best.error){best=candidate;dxBest=dx;dyBest=dy;}
   }
   const shifted=(dxBest!==0||dyBest!==0)&&base.error-best.error>2&&best.error<base.error*.65&&best.matching>.65;
   const broad=cells.reduce((n,count,i)=>n+(count/sizes[i]>.18?1:0),0)>=9;
   cameraMoving=shifted||broad;
  }
  if(cameraMoving)this.readyAt=now+this.shakeCooldownMs;
  const ready=now>=this.readyAt;
  return {moving:ready&&!cameraMoving&&ratio>=this.threshold,cameraMoving,ready,changedRatio:ratio};
 }
}
