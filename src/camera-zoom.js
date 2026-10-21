/** Zoom the live camera track, so preview and recorded frames stay identical. */
export class CameraZoom {
 constructor({onChange=()=>{},onTransition=()=>{}}={}){this.onChange=onChange;this.onTransition=onTransition;this.generation=0;this.attach(null);}
 attach(track){
  this.generation++;this.track=track;this.pending=null;this.operation=null;
  this.state={supported:false,min:1,max:1,step:.1,value:1,busy:false,error:''};
  try{
   const range=track?.getCapabilities?.().zoom,value=track?.getSettings?.().zoom;
   if(track?.applyConstraints&&Number.isFinite(range?.min)&&Number.isFinite(range?.max)&&range.min>0&&range.max>range.min&&Number.isFinite(value)){
    this.state={...this.state,supported:true,min:range.min,max:range.max,step:Number.isFinite(range.step)&&range.step>0?range.step:.01,value};
   }
  }catch{/* Unsupported camera capabilities leave the control unavailable. */}
  this.onChange(this.state);
 }
 normalize(value){const {min,max,step}=this.state;return Math.max(min,Math.min(max,Number((min+Math.round((value-min)/step)*step).toFixed(6))));}
 set(value){
  if(!this.state.supported||!Number.isFinite(value))return Promise.resolve();
  const target=this.normalize(value);
  if(!this.operation&&Math.abs(this.state.value-target)<Math.max(.000001,this.state.step/2))return Promise.resolve();
  this.pending=target;if(this.operation)return this.operation;
  const track=this.track,generation=this.generation,current=()=>this.track===track&&this.generation===generation;
  const operation=Promise.resolve().then(async()=>{
   if(!current())return;
   this.state.busy=true;this.state.error='';this.onTransition();this.onChange(this.state);
   try{
    while(current()&&this.pending!==null){
     const target=this.pending;this.pending=null;
     if(Math.abs(this.state.value-target)<Math.max(.000001,this.state.step/2))continue;
     await track.applyConstraints({...track.getConstraints?.(),zoom:{exact:target}});
     if(!current())return;
     const actual=track.getSettings?.().zoom;
     if(!Number.isFinite(actual))throw new Error('Zoom setting unavailable');
     this.state.value=actual;
     if(Math.abs(actual-target)>Math.max(.02,this.state.step))throw new Error('Zoom setting not applied');
     this.onChange(this.state);
    }
   }catch{
    if(current()){
     this.pending=null;const actual=track.getSettings?.().zoom;if(Number.isFinite(actual))this.state.value=actual;
     this.state.error='未能调整相机变焦，请重试。';
    }
   }finally{
    if(current()){this.state.busy=false;this.onTransition();this.onChange(this.state);}
    if(this.operation===operation)this.operation=null;
   }
  });
  this.operation=operation;return operation;
 }
}
