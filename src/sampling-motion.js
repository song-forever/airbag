/** Analysis-only temporal proposal, NOT a person/action/takeoff detector.
 * Input pixels and times only; this module never reads labels or filenames.
 * Unknown is intentional when the local episode cannot be separated safely.
 */
const median = values => { values.sort((a,b)=>a-b); return values[Math.floor(values.length/2)]||0; };
function blur(frame,w,h){
 const out=new Uint8Array(frame.length);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=frame[(y+dy)*w+x+dx];
  out[y*w+x]=Math.round(sum/9);
 }
 return out;
}
function cameraShift(a,b,w,h){
 const radius=6,tiles=[];
 for(let row=0;row<3;row++)for(let col=0;col<4;col++){
  const points=[];let lo=255,hi=0;
  for(let y=Math.max(radius,Math.ceil(h*row/3));y<Math.min(h-radius,Math.ceil(h*(row+1)/3));y+=3)
   for(let x=Math.max(radius,Math.ceil(w*col/4));x<Math.min(w-radius,Math.ceil(w*(col+1)/4));x+=3){const k=y*w+x;points.push(k);lo=Math.min(lo,a[k]);hi=Math.max(hi,a[k]);}
  if(points.length&&hi-lo>=24)tiles.push({points,row,col});
 }
 if(tiles.length<4)return {dx:0,dy:0,accepted:false,votes:0};
 function score(dx,dy){
  const offset=dy*w+dx,diffs=[];
  for(const tile of tiles)for(let i=0;i<tile.points.length;i+=3){const k=tile.points[i];diffs.push(a[k]-b[k-offset]);}
  const drift=median(diffs);
  return {dx,dy,drift,errors:tiles.map(({points})=>{let error=0;for(const k of points)error+=Math.min(40,Math.abs(a[k]-b[k-offset]-drift));return error/points.length;})};
 }
 const base=score(0,0);
 if(base.errors.filter(e=>e>=3).length<4)return {...base,accepted:false,votes:0};
 let best=null,bestGain=0;
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  if(!dx&&!dy)continue;
  const candidate=score(dx,dy);let votes=0,rows=0,cols=0,gain=0;
  for(let i=0;i<tiles.length;i++){
   const before=base.errors[i],after=candidate.errors[i];gain+=Math.max(-8,Math.min(8,before-after));
   if(before-after>=2&&after<=before*.6){votes++;rows|=1<<tiles[i].row;cols|=1<<tiles[i].col;}
  }
  if(votes>=Math.max(4,Math.ceil(tiles.length*.5))&&(rows&(rows-1))&&(cols&(cols-1))&&gain>bestGain){best={...candidate,votes};bestGain=gain;}
 }
 return best?{...best,accepted:true}:{...base,accepted:false,votes:0};
}
export function observeMotion(current,previous,{width:w,height:h,time}={}){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<18||h<18||!Number.isFinite(time)||time<0
  ||current?.length!==w*h||previous?.length!==w*h)return null;
 const a=blur(current,w,h),b=blur(previous,w,h),n=w*h;
 const shift=cameraShift(a,b,w,h),offset=shift.dy*w+shift.dx;
 const border=8,diffs=[];
 for(let y=border;y<h-border;y+=3)for(let x=border;x<w-border;x+=3){const k=y*w+x;diffs.push(a[k]-b[k-offset]);}
 const drift=median(diffs),mask=new Uint8Array(n),queue=new Int32Array(n),components=[];
 let changed=0;const occupied=new Set();
 for(let y=border;y<h-border;y++)for(let x=border;x<w-border;x++){
  const k=y*w+x;if(Math.abs(a[k]-b[k-offset]-drift)>18){mask[k]=1;changed++;occupied.add(Math.floor(y/h*3)*4+Math.floor(x/w*4));}
 }
 for(let y=border;y<h-border;y++)for(let x=border;x<w-border;x++){
  const k=y*w+x;if(!mask[k])continue;
  let size=1,minX=x,maxX=x,minY=y,maxY=y,sumX=0,sumY=0;queue[0]=k;mask[k]=0;
  for(let i=0;i<size;i++){
   const at=queue[i],cx=at%w,cy=Math.floor(at/w);sumX+=cx;sumY+=cy;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=cx+dx,ny=cy+dy,ni=ny*w+nx;
    if(nx>=border&&nx<w-border&&ny>=border&&ny<h-border&&mask[ni]){mask[ni]=0;queue[size++]=ni;}
   }
  }
  if(size<Math.max(5,Math.ceil(n*.0004)))continue;
  const bw=(maxX-minX+1)/w,bh=(maxY-minY+1)/h;
  if(bw>.75||bh>.75||bw*bh>.45)continue;
  components.push({pixels:size,x:minX/w,y:minY/h,w:bw,h:bh,cx:sumX/size/w,cy:sumY/size/h});
 }
 components.sort((a,b)=>b.pixels-a.pixels);
 const global=changed/n>.35||(occupied.size>=10&&changed/n>.15);
 const top=components[0];
 return {time,energy:global?0:(top?.pixels||0)/n,component:top||null,changedRatio:changed/n,global,
  cameraShift:{dx:shift.dx,dy:shift.dy,accepted:shift.accepted,votes:shift.votes},brightnessDrift:drift};
}
export function estimateMotionEpisode(observations,{duration}={}){
 if(!Number.isFinite(duration)||duration<=0||!Array.isArray(observations)
  ||observations.some((o,i)=>!o||!Number.isFinite(o.time)||o.time<0||o.time>duration
   ||!Number.isFinite(o.energy)||o.energy<0||(i>0&&o.time<=observations[i-1].time)))
  return {window:null,confidence:'unknown',reason:'invalid-input',peakEnergy:0};
 const values=observations.filter(o=>!o.global&&o.component),peak=Math.max(0,...values.map(o=>o.energy));
 const unknown=reason=>({window:null,confidence:'unknown',reason,peakEnergy:peak});
 if(values.length<4||peak<.002)return unknown('insufficient-local-motion');
 // Frame-difference energy cannot distinguish a large nearby rider travelling
 // away from a jump at the far end. Refuse a frame-tall foreground component.
 // This is an applicability guard, not a takeoff/landing test.
 const peakComponent=values.reduce((a,b)=>a.energy>b.energy?a:b).component;
 if(peakComponent.h>.5||peakComponent.w>.65)return unknown('large-foreground-motion');
 const threshold=Math.max(.001,peak*.15),active=observations.filter(o=>o.energy>=threshold),episodes=[];
 for(const o of active){
  let episode=episodes.at(-1);
  if(!episode||o.time-episode.at(-1).time>.26)episodes.push(episode=[]);
  episode.push(o);
 }
 const proposals=episodes.filter(e=>e.length>=4&&e.at(-1).time-e[0].time>=.3).map(e=>{
  const x=e.map(o=>o.component.cx),y=e.map(o=>o.component.cy);
  return {frames:e,start:e[0].time,end:e.at(-1).time,energy:e.reduce((s,o)=>s+o.energy,0),travel:Math.hypot(Math.max(...x)-Math.min(...x),Math.max(...y)-Math.min(...y))};
 }).filter(e=>e.travel>=.05).sort((a,b)=>b.energy-a.energy);
 if(!proposals.length)return unknown('no-persistent-travel');
 const best=proposals[0],other=proposals[1],total=proposals.reduce((s,e)=>s+e.energy,0),concentration=best.energy/total;
 if(other&&other.energy>=best.energy*.65)return {...unknown('multiple-comparable-episodes'),proposals:proposals.map(({frames,...x})=>x)};
 const start=Math.max(0,best.start-.3),end=Math.min(duration,best.end+.35);
 if(end-start>duration*.95)return {...unknown('motion-spans-whole-clip'),unexpanded:[best.start,best.end]};
 const movingCamera=best.frames.filter(o=>o.cameraShift.accepted).length/best.frames.length;
 // Quantization must not round a fractional video endpoint beyond duration.
 return {window:{start:Math.max(0,Number(start.toFixed(3))),end:Math.min(duration,Number(end.toFixed(3)))},confidence:'medium',reason:'dominant-local-motion-episode',
  unexpanded:[best.start,best.end],peakEnergy:peak,threshold,concentration,travel:best.travel,movingCameraFraction:movingCamera,
  proposals:proposals.map(({frames,...x})=>x)};
}


/** Read an already-seeked video frame. Never seeks or retains video frames.
 * A disabled/unsupported canvas returns null without drawing anything.
 * At most one 192-long-side grayscale frame survives an observe() call.
 */
export function createMotionScout({createCanvas=()=>globalThis.document?.createElement('canvas')}={}){
 let canvas=null,context=null,previous=null,previousTime=null,width=0,height=0,disabled=false,disposed=false;
 const release=()=>{
  previous=null;previousTime=null;context=null;
  if(canvas){try{canvas.width=0;canvas.height=0;}catch{}}
  canvas=null;width=0;height=0;
 };
 const disable=()=>{disabled=true;release();return null;};
 return {
  observe(video,time){
   if(disabled||disposed)return null;
   if(!Number.isFinite(time)||time<0||!Number.isInteger(video?.videoWidth)||!Number.isInteger(video?.videoHeight)
    ||video.videoWidth<=0||video.videoHeight<=0)return null;
   try{
    if(!canvas){
     canvas=createCanvas();
     context=canvas?.getContext?.('2d',{alpha:false,willReadFrequently:true});
     if(typeof context?.getImageData!=='function'||typeof context?.drawImage!=='function')return disable();
    }
    const scale=Math.min(1,192/Math.max(video.videoWidth,video.videoHeight));
    const nextWidth=Math.max(2,Math.round(video.videoWidth*scale/2)*2);
    const nextHeight=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
    if(nextWidth!==width||nextHeight!==height){
     width=nextWidth;height=nextHeight;canvas.width=width;canvas.height=height;previous=null;previousTime=null;
    }
    if(width<18||height<18)return disable();
    if(previousTime!==null&&time<=previousTime){previous=null;previousTime=null;}
    context.drawImage(video,0,0,width,height);
    const pixels=context.getImageData(0,0,width,height)?.data,n=width*height;
    if(pixels?.length!==n*4)return disable();
    const gray=new Uint8Array(n);
    for(let i=0;i<n;i++){const p=i*4;gray[i]=(pixels[p]*77+pixels[p+1]*150+pixels[p+2]*29+128)>>8;}
    const result=previous?observeMotion(gray,previous,{width,height,time}):null;
    previous=gray;previousTime=time;
    return result;
   }catch{return disable();}
  },
  dispose(){disposed=true;release();},
 };
}
