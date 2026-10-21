// Local QA only: generated camera frames, never opens hardware or uploads video.
if(new URLSearchParams(location.search).get('camera')==='mock'){
 let moving=false,frame=0,zoom=1;
 const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
 const ctx=canvas.getContext('2d');
 function draw(){
  ctx.fillStyle='#1a303b';ctx.fillRect(0,0,720,1280);ctx.save();ctx.translate(360,640);ctx.scale(zoom,zoom);ctx.translate(-360,-640);
  ctx.strokeStyle='#59727a';ctx.lineWidth=3;
  for(let i=0;i<720;i+=80){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,1280);ctx.stroke();}
  for(let i=0;i<1280;i+=80){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(720,i);ctx.stroke();}
  ctx.fillStyle='#d9edaa';ctx.fillRect(moving?40+(frame++*75)%420:270,500,200,340);ctx.fillStyle='#fff';ctx.font='24px system-ui';ctx.fillText('LOCAL CAMERA · '+zoom+'×',60,140);ctx.restore();
 }
 draw();setInterval(draw,80);
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
  const stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);let constraints={};
  track.getCapabilities=()=>({zoom:{min:.5,max:6,step:.1}});track.getSettings=()=>({...settings(),zoom});track.getConstraints=()=>constraints;
  track.applyConstraints=async next=>{constraints=next;zoom=next.zoom.exact;draw();};return stream;
 }});
 document.addEventListener('DOMContentLoaded',()=>{
  const button=document.createElement('button');button.textContent='模拟有人出发';button.id='qaDeparture';button.onclick=()=>{moving=!moving;button.textContent=moving?'停止模拟运动':'模拟有人出发';};document.getElementById('qa-banner').append(' · 相机也是本机生成画面 ',button);
 });
}
