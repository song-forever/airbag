/** Detect small changes inside the frame; edge motion is deliberately ignored. */
export class FrameMotionDetector {
 constructor({width=160,height=90,edgeRatio=.1,minChangedPixels=3}={}){
  this.width=width;this.height=height;this.edgeRatio=edgeRatio;this.minChangedPixels=minChangedPixels;this.reset();
 }
 reset(){this.previous=null;}
 update(frame,now){
  const {width:w,height:h}=this;
  if(frame.length!==w*h||!Number.isFinite(now))throw new TypeError('Invalid motion frame or timestamp');
  const old=this.previous;this.previous=new Uint8Array(frame);
  if(!old)return {moving:false,cameraMoving:false,ready:false,changedRatio:0,completionMoving:false};
  const left=Math.ceil(w*this.edgeRatio),top=Math.ceil(h*this.edgeRatio);
  const right=w-left,bottom=h-top,count=(right-left)*(bottom-top);
  let drift=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)drift+=frame[y*w+x]-old[y*w+x];
  drift/=count;
  let changed=0;
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
   if(Math.abs(frame[y*w+x]-old[y*w+x]-drift)>18)changed++;
  }
  // Keep a small pixel/noise floor, without requiring 5% of the entire image
  // or rejecting motion as camera shake. Completion uses a separate 0.2%
  // activity floor so tiny start-level noise does not keep a clip alive.
  return {moving:changed>=this.minChangedPixels,cameraMoving:false,ready:true,changedRatio:changed/count,completionMoving:changed>=Math.max(this.minChangedPixels,Math.ceil(count*.002))};
 }
}
