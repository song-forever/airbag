/** Experimental one-attempt motion tracker for a fixed rear camera.
 * A detector supplies normalized person boxes. This does not classify landings.
 */
const area = r => r.w * r.h;
const center = r => ({x: r.x + r.w / 2, y: r.y + r.h / 2});
const bottom = r => r.y + r.h;
const distance = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
function normalize(r) {
  if (!r || ![r.x,r.y,r.w,r.h,r.score].every(Number.isFinite)) return null;
  if(r.w<=0 || r.h<=0 || r.score<0 || r.score>1) return null;
  const x=clamp(r.x,0,1), y=clamp(r.y,0,1);
  const w=clamp(r.x+r.w,0,1)-x, h=clamp(r.y+r.h,0,1)-y;
  return w>0 && h>0 ? {x,y,w,h,score:r.score} : null;
}
function iou(a,b) {
  const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
  const h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  const intersect=w*h;
  return intersect/Math.max(0.00001,area(a)+area(b)-intersect);
}
export class JumpTracker {
  constructor({maxDurationMs=18000,lostGraceMs=2200,minRecordingMs=4000}={}) {
    this.maxDurationMs=Math.max(4000,maxDurationMs);
    this.lostGraceMs=Math.max(500,lostGraceMs);
    this.minRecordingMs=clamp(minRecordingMs,1500,this.maxDurationMs);
    this.reset();
  }
  reset() {
    this.state='waiting'; this.reason='searching'; this.target=null;
    this.candidate=null; this.baseline=null; this.lastSeen=null;
    this.previousTime=null; this.departureSince=null; this.recordingStarted=null;
    this.receded=false; this.velocity={x:0,y:0}; this.arc=null; this.observedPhase='approach';
  }
  result(now) {
    return {state:this.state,target:this.target?{...this.target}:null,reason:this.reason,
      confidence:this.target?.score??0,
      elapsedMs:this.recordingStarted===null?0:Math.max(0,now-this.recordingStarted),
      observedPhase:this.observedPhase};
  }
  associate(detections,reference,now,lastSeen) {
    const previous=center(reference), gap=Math.max(0,now-lastSeen), dt=Math.min(gap,500);
    const predicted={x:previous.x+this.velocity.x*dt,y:previous.y+this.velocity.y*dt};
    const gate=Math.max(0.065,Math.hypot(reference.w,reference.h)*0.6)*(1+Math.min(gap/1500,0.35));
    let match=null,best=-Infinity;
    for(const r of detections) {
      const ratio=r.h/reference.h;
      if(ratio<0.43 || ratio>1.9) continue;
      const d=distance(center(r),predicted), overlap=iou(reference,r);
      if(d>gate || (overlap<0.02 && d>gate*0.6)) continue;
      const rank=overlap*1.8-d/gate-Math.abs(Math.log(ratio))*0.45+r.score*0.15;
      if(rank>best) {best=rank;match=r;}
    }
    return match;
  }
  update(input,nowMs) {
    if(!Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite monotonic timestamp');
    const now=Math.max(nowMs,this.previousTime??nowMs); this.previousTime=now;
    if(this.state==='complete') return this.result(now);
    const detections=(Array.isArray(input)?input:[]).map(normalize).filter(r=>r&&r.score>=0.3);
    if(this.state==='waiting') return this.findCandidate(detections,now);
    if(this.recordingStarted!==null && now-this.recordingStarted>=this.maxDurationMs) {
      this.state='complete';this.reason='max_duration';return this.result(now);
    }
    const match=this.associate(detections,this.target,now,this.lastSeen);
    if(!match) {
      const lostFor=now-this.lastSeen; this.reason='target_temporarily_lost';
      if(this.state==='locked' && lostFor>=900) {
        this.reset(); this.previousTime=now; this.reason='target_lost_before_departure';
      } else if(this.state==='recording' && this.receded && lostFor>=this.lostGraceMs
        && now-this.recordingStarted>=this.minRecordingMs) {
        this.state='complete';this.reason='target_lost_after_receding';
      }
      return this.result(now);
    }
    const delta=now-this.lastSeen;
    if(delta>0) {
      const a=center(this.target),b=center(match);
      this.velocity.x=this.velocity.x*0.6+(b.x-a.x)/delta*0.4;
      this.velocity.y=this.velocity.y*0.6+(b.y-a.y)/delta*0.4;
    }
    this.target=match;this.lastSeen=now;
    if(this.state==='locked') this.detectDeparture(now);
    if(this.state==='recording') this.detectCompletion(now);
    return this.result(now);
  }
  findCandidate(detections,now) {
    const eligible=detections.filter(r=>r.score>=0.45 && r.h>=0.26 && area(r)>=0.035);
    const match=this.candidate?this.associate(eligible,this.candidate.box,now,this.candidate.lastSeen):null;
    if(match) {
      this.candidate.box=match;this.candidate.lastSeen=now;this.target=match;this.reason='candidate';
      if(now-this.candidate.since>=500) {
        this.state='locked';this.reason='waiting_departure';
        this.baseline={...this.candidate.initial};this.lastSeen=now;this.candidate=null;
      }
      return this.result(now);
    }
    if(this.candidate && now-this.candidate.lastSeen<350) return this.result(now);
    const candidate=eligible.sort((a,b)=>area(b)*b.score-area(a)*a.score)[0];
    this.candidate=candidate?{box:candidate,initial:{...candidate},since:now,lastSeen:now}:null;
    this.target=candidate??null;this.reason=candidate?'candidate':'searching';
    return this.result(now);
  }
  detectDeparture(now) {
    const hr=this.target.h/this.baseline.h, wr=this.target.w/this.baseline.w;
    const ar=area(this.target)/area(this.baseline);
    const movement=distance(center(this.target),center(this.baseline));
    // Require shrinking in both dimensions: a squat can shorten the box and
    // move its center without the rider actually leaving the start.
    const departing=wr<=0.9 && hr<=0.9 && (ar<=0.72 || movement>=0.035);
    if(!departing) {this.departureSince=null;this.reason='waiting_departure';return;}
    if(this.departureSince===null) this.departureSince=now;
    if(now-this.departureSince>=250) {
      this.state='recording';this.reason='departed';this.recordingStarted=now;
    }
  }
  detectCompletion(now) {
    if(this.target.h/this.baseline.h<=0.5 && area(this.target)/area(this.baseline)<=0.3) this.receded=true;
    this.reason=this.receded?'receded':'tracking';
    if(!this.receded || now-this.recordingStarted<1200) return;
    this.observedPhase='receding';const c=center(this.target);
    if(!this.arc) {
      this.arc={startY:c.y,startBottom:bottom(this.target),minY:c.y,descendingSince:null,rose:false};return;
    }
    this.arc.minY=Math.min(this.arc.minY,c.y);
    if(this.arc.startY-this.arc.minY>=0.045) this.arc.rose=true;
    if(!this.arc.rose) return;
    this.observedPhase='rise';
    // Downward jitter is insufficient: require return near the earlier vertical
    // level. Occlusion behind the lip is handled by the disappearance grace.
    const descending=c.y-this.arc.minY>=Math.max(0.045,this.target.h*0.4)
      && bottom(this.target)>=this.arc.startBottom-0.015;
    if(!descending) {this.arc.descendingSince=null;return;}
    this.observedPhase='descent';
    if(this.arc.descendingSince===null) this.arc.descendingSince=now;
    if(now-this.arc.descendingSince>=400 && now-this.recordingStarted>=this.minRecordingMs) {
      this.state='complete';this.reason='visible_arc_finished';
    }
  }
}
