/** Local motion inside the frame, with learned tolerance for small background jitter. */
export class FrameMotionDetector {
 constructor({width=160,height=90,edgeRatio=.1,minChangedPixels=3}={}){
  this.width=width;this.height=height;this.edgeRatio=edgeRatio;this.minChangedPixels=minChangedPixels;this.reset();
 }
 reset(){
  this.previous=null;this.startedAt=null;
  this.low=new Uint8Array(this.width*this.height).fill(255);
  this.high=new Uint8Array(this.width*this.height);
 }
 update(frame,now,{learning:learnOverride}={}){
  const {width:w,height:h}=this,n=w*h;
  if(frame.length!==n||!Number.isFinite(now))throw new TypeError('Invalid motion frame or timestamp');
  const old=this.previous;this.previous=new Uint8Array(frame);this.startedAt??=now;
  const left=Math.max(1,Math.ceil(w*this.edgeRatio)),top=Math.max(1,Math.ceil(h*this.edgeRatio));
  const right=Math.min(w-1,w-left),bottom=Math.min(h-1,h-top),count=(right-left)*(bottom-top);
  const learning=learnOverride??(now-this.startedAt<2000);
  // Learn during the app's two-second warmup. A one-pixel neighbourhood
  // tolerates small background edge shifts without rejecting the entire frame.
  if(learning||!old){
   for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const k=y*w+x;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const value=frame[k+dy*w+dx];
     this.low[k]=Math.min(this.low[k],value);this.high[k]=Math.max(this.high[k],value);
    }
   }
  }
  if(!old||learning)return {moving:false,cameraMoving:false,ready:false,changedRatio:0,completionMoving:false};
  let drift=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)drift+=frame[y*w+x]-old[y*w+x];
  drift/=count;
  const mask=new Uint8Array(n);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
   const k=y*w+x;
   if(Math.abs(frame[k]-old[k]-drift)<=18)continue;
   const low=this.low[k]-12,high=this.high[k]+12;
   if(frame[k]>=low&&frame[k]<=high&&old[k]>=low&&old[k]<=high)continue;
   mask[k]=1;
  }
  // Scattered compression pixels do not add up to a moving target. Keep
  // connected local changes; do not impose a five-percent frame-area gate.
  const queue=new Int32Array(n);let maxComponent=0,qualifiedPixels=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
   const k=y*w+x;if(!mask[k])continue;
   let size=1;queue[0]=k;mask[k]=0;
   for(let i=0;i<size;i++){
    const at=queue[i],cx=at%w,cy=Math.floor(at/w);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const nx=cx+dx,ny=cy+dy,ni=ny*w+nx;
     if(nx>=left&&nx<right&&ny>=top&&ny<bottom&&mask[ni]){mask[ni]=0;queue[size++]=ni;}
    }
   }
   maxComponent=Math.max(maxComponent,size);
   if(size>=this.minChangedPixels)qualifiedPixels+=size;
  }
  return {moving:maxComponent>=this.minChangedPixels,cameraMoving:false,ready:true,
   changedRatio:qualifiedPixels/count,
   completionMoving:qualifiedPixels>=Math.max(this.minChangedPixels,Math.ceil(count*.002))};
 }
}
