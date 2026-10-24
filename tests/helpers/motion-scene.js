export const WIDTH=160;
export const HEIGHT=90;

// A stationary indoor ramp: hard black/white rails, wall panels and a diagonal
// ramp edge. Bilinear translation changes edge pixels without moving a person.
const background=new Uint8Array(WIDTH*HEIGHT);
for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
 let value=52+x*.11+y*.12;
 if((x>=29&&x<33)||(x>=121&&x<125))value=235;
 if(y>=23&&y<27&&x>=20&&x<140)value=224;
 if(y>=68&&y<72&&x>=20&&x<140)value=15;
 if(x>42&&x<116&&y>51-(x-42)*.24)value=184;
 if(x>=51&&x<76&&y>=31&&y<44)value=18;
 if(x>=80&&x<110&&y>=31&&y<44)value=231;
 background[y*WIDTH+x]=Math.round(value);
}
const sample=(x,y)=>background[Math.max(0,Math.min(HEIGHT-1,y))*WIDTH+Math.max(0,Math.min(WIDTH-1,x))];

// Rectangle coordinates use the 160×90 motion buffer, not camera pixels.
// clipX emulates a wall occluding the rider until they emerge past its edge.
export function scene({dx=0,dy=0,rider=null,clipX=-Infinity,edgePatch=null}={}){
 const frame=new Uint8Array(WIDTH*HEIGHT);
 for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
  const sourceX=x-dx,sourceY=y-dy,x0=Math.floor(sourceX),y0=Math.floor(sourceY),fx=sourceX-x0,fy=sourceY-y0;
  frame[y*WIDTH+x]=Math.round((1-fy)*((1-fx)*sample(x0,y0)+fx*sample(x0+1,y0))+fy*((1-fx)*sample(x0,y0+1)+fx*sample(x0+1,y0+1)));
 }
 for(const box of [rider,edgePatch].filter(Boolean))for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){
  if(x>=Math.max(0,clipX)&&x<WIDTH&&y>=0&&y<HEIGHT)frame[y*WIDTH+x]=box.value??248;
 }
 return frame;
}
export function rgba(gray){
 const pixels=new Uint8Array(gray.length*4);
 for(let j=0;j<gray.length;j++){const i=j*4;pixels[i]=pixels[i+1]=pixels[i+2]=gray[j];pixels[i+3]=255;}
 return pixels;
}
export const jitterOffsets=[{dx:0,dy:0},{dx:.3,dy:.2},{dx:-.25,dy:-.15},{dx:.2,dy:-.2},{dx:-.3,dy:.15}];
