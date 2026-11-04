// Compare distributed background regions. Capping each region's error keeps a
// nearby rider or an occlusion from dominating the camera estimate.
function estimateCameraShift(frame,previous,width,height){
 const radius=8,stride=3;
 const tiles=[];
 for(let row=0;row<3;row++)for(let col=0;col<4;col++){
  const left=Math.max(radius,Math.ceil(width*col/4));
  const right=Math.min(width-radius,Math.ceil(width*(col+1)/4));
  const top=Math.max(radius,Math.ceil(height*row/3));
  const bottom=Math.min(height-radius,Math.ceil(height*(row+1)/3));
  const points=[];
  let low=255,high=0;
  for(let y=top;y<bottom;y+=stride)for(let x=left;x<right;x+=stride){
   const at=y*width+x,value=frame[at];
   points.push(at);low=Math.min(low,value);high=Math.max(high,value);
  }
  if(points.length&&high-low>=24)tiles.push({row,col,points});
 }
 if(tiles.length<4)return null;
 function score(dx,dy){
  const offset=dy*width+dx;
  const errors=tiles.map(({points})=>{
   let error=0;
   for(const at of points)error+=Math.min(40,Math.abs(frame[at]-previous[at-offset]));
   return error/points.length;
  });
  return {dx,dy,errors};
 }
 const base=score(0,0);
 // Stable or nearly identical frames need no search.
 if(base.errors.filter(error=>error>=3).length<4)return null;
 let best=null,bestGain=0;
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  if(!dx&&!dy)continue;
  const candidate=score(dx,dy);
  let votes=0,rows=0,cols=0,gain=0;
  for(let i=0;i<tiles.length;i++){
   const before=base.errors[i],after=candidate.errors[i];
   gain+=Math.max(-8,Math.min(8,before-after));
   if(before-after>=2&&after<=before*.6){
    votes++;rows|=1<<tiles[i].row;cols|=1<<tiles[i].col;
   }
  }
  if(votes>=Math.max(4,Math.ceil(tiles.length*.5))&&(rows&(rows-1))&&(cols&(cols-1))&&gain>bestGain){
   best=candidate;bestGain=gain;
  }
 }
 return best;
}

/** Local motion inside the frame, with learned tolerance for small background jitter. */
export class FrameMotionDetector {
 constructor({width=160,height=90,edgeRatio=.1,minChangedPixels=3}={}){
  this.width=width;this.height=height;this.edgeRatio=edgeRatio;this.minChangedPixels=minChangedPixels;this.reset();
 }
 reset(){
  this.previous=null;this.startedAt=null;
  this.localMotion=[];
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
  if(!old||learning){
   this.localMotion=[];
   return {moving:false,cameraMoving:false,ready:false,changedRatio:0,completionMoving:false,localDeparture:false};
  }
  const shift=left>=8&&top>=8?estimateCameraShift(frame,old,w,h):null;
  const offset=shift?shift.dy*w+shift.dx:0;
  // Keep the motion history in the current frame's coordinates.
  if(shift)for(const point of this.localMotion){point.x+=shift.dx;point.y+=shift.dy;}
  let drift=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)drift+=frame[y*w+x]-old[y*w+x-offset];
  drift/=count;
  const mask=new Uint8Array(n);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
   const k=y*w+x;
   const before=old[k-offset];
   if(Math.abs(frame[k]-before-drift)<=18)continue;
   const low=this.low[k]-12,high=this.high[k]+12;
   if(frame[k]>=low&&frame[k]<=high&&before>=low&&before<=high)continue;
   mask[k]=1;
  }
  // Count connected changes and measure their overall spread and center.
  const queue=new Int32Array(n);let maxComponent=0,qualifiedPixels=0;
  let minX=w,minY=h,maxX=0,maxY=0,sumX=0,sumY=0;
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
   if(size<this.minChangedPixels)continue;
   qualifiedPixels+=size;
   for(let i=0;i<size;i++){
    const x=queue[i]%w,y=Math.floor(queue[i]/w);
    minX=Math.min(minX,x);minY=Math.min(minY,y);
    maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    sumX+=x;sumY+=y;
   }
  }
  const localized=maxComponent>=Math.ceil(count*.006)
   &&maxX-minX+1<=(right-left)*.65&&maxY-minY+1<=(bottom-top)*.7;
  const localDeparture=this.confirmLocalMotion(localized?{x:sumX/qualifiedPixels,y:sumY/qualifiedPixels,time:now}:null);
  return {localDeparture,moving:maxComponent>=this.minChangedPixels,cameraMoving:!!shift,ready:true,
   changedRatio:qualifiedPixels/count,
   completionMoving:qualifiedPixels>=Math.max(this.minChangedPixels,Math.ceil(count*.002))};
 }
 confirmLocalMotion(point){
  if(!point){this.localMotion=[];return false;}
  const history=this.localMotion;
  const previous=history.at(-1);
  if(previous&&(point.time-previous.time>350||Math.hypot(point.x-previous.x,point.y-previous.y)>this.width*.25))history.length=0;
  history.push(point);
  while(point.time-history[0].time>700)history.shift();
  const first=history[0];
  if(history.length<3||point.time-first.time<350)return false;
  const displacement=Math.hypot(point.x-first.x,point.y-first.y);
  let distance=0;
  for(let i=1;i<history.length;i++)distance+=Math.hypot(history[i].x-history[i-1].x,history[i].y-history[i-1].y);
  // A small oscillation may change many pixels, but does not travel consistently.
  return displacement>=this.width*.035&&displacement>=distance*.75;
 }
}
