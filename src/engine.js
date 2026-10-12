// Calculation rules ported from G07 LiftDesk / Colab v2. Units: cm, seconds, degrees.
// Subject presets are populated from a manifest selected locally by the user.
export const HEIGHTS = Object.create(null);
export const DEFAULTS = { height: null, fps: 30, excursion: 20, returnExcursion: 18, dwell: .12, interval: .6,
  gap: .4, fov: 70, confidence: .5, calibStart: 0, calibSeconds: 1.5,
  autoCalibrate: true, confirmLevel: 'waist', bodyConfirmation: true, maxSide: 960 };
export const SKELETON = [[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[15,17],[15,19],
  [12,14],[14,16],[16,18],[16,20],[23,25],[25,27],[27,29],[27,31],[29,31],
  [24,26],[26,28],[28,30],[28,32],[30,32],[0,11],[0,12]];
const FEET = [29,30,31,32], LOWER = [27,28,...FEET], PNP = [0,11,12,13,14,23,24,25,26,...LOWER];
export const WEIGHTS = [[29,18,14],[32,23,18],[41,25,18],[31,23,16]];
export const ZONES = ['เหนือไหล่','เอว–ไหล่','เข่า–เอว','ต่ำกว่าเข่า'];
export const REACHES = ['ใกล้','ปานกลาง','ไกล'];
const finite = p => Array.isArray(p) && p.every(Number.isFinite);
const add = (a,b) => a.map((x,i)=>x+b[i]);
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const mul = (a,s) => a.map(x=>x*s);
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const norm = a => Math.hypot(...a);
const unit = a => norm(a)>1e-8 ? mul(a,1/norm(a)) : a.map(()=>NaN);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const deg = x => x*180/Math.PI;
const angle = (a,b) => deg(Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b))))));
export const mean = values => { const a=values.filter(Number.isFinite); return a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN; };
export const median = values => { const a=values.filter(Number.isFinite).sort((a,b)=>a-b); return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:NaN; };
const std = a => Math.sqrt(mean(a.map(x=>(x-mean(a))**2)));
const meanPoint = (points,ids) => points[0].map((_,d)=>mean(ids.map(i=>points[i][d])));
const medianPoint = points => points[0].map((_,d)=>median(points.map(p=>p[d])));
const project = (p,K) => [K.f*p[0]/p[2]+K.cx,K.f*p[1]/p[2]+K.cy];
const transpose = a => a[0].map((_,i)=>a.map(row=>row[i]));
const matmul = (a,b) => a.map(row=>transpose(b).map(col=>dot(row,col)));

export function validateSettings(s) {
  for (const k of ['height','fps','excursion','returnExcursion','dwell','interval','gap','fov','confidence','calibStart','calibSeconds'])
    if (!Number.isFinite(s[k])) throw Error('กรอกค่าตั้งค่าเป็นตัวเลขให้ครบ');
  if(s.height<50||s.height>250) throw Error('ส่วนสูงต้องอยู่ระหว่าง 50–250 ซม.');
  if(s.fps<5||s.fps>120) throw Error('อัตราวิเคราะห์ต้องอยู่ระหว่าง 5–120 เฟรมต่อวินาที');
  if(s.excursion<=0||s.returnExcursion<=0||s.returnExcursion>s.excursion||s.dwell<0||s.interval<0||s.gap<=0) throw Error('ตรวจเกณฑ์ระยะและช่วงเวลานับรอบ ระยะลดมือต้องไม่เกินระยะยกขึ้น');
  if(s.fov<30||s.fov>120||s.confidence<=0||s.confidence>1) throw Error('ตรวจมุมมองกล้องและเกณฑ์ความมั่นใจ');
  if(s.calibStart<0||s.calibSeconds<.2||s.calibSeconds>30) throw Error('ตรวจช่วงยืนอ้างอิง: ความยาว 0.2–30 วินาที');
}

// Same constant-velocity Kalman prediction and gating as the desktop tracker.
class PointTracker {
  constructor(w,h,confidence) { Object.assign(this,{w,h,confidence,gate:Math.max(25,.04*Math.hypot(w,h)),history:[],missing:0}); }
  init(x,y) { this.state=[x,y,0,0]; this.P=[[25,0,0,0],[0,25,0,0],[0,0,400,0],[0,0,0,400]]; }
  update(p,conf) {
    const [x,y]=p; const good=conf>=this.confidence&&x>=0&&x<this.w&&y>=0&&y<this.h;
    let point=null,observed=false;
    if(!this.state) { if(good){this.init(x,y);point=[x,y];observed=true;} }
    else {
      const F=[[1,0,1,0],[0,1,0,1],[0,0,1,0],[0,0,0,1]], Q=[[4,0,8,0],[0,4,0,8],[8,0,16,0],[0,8,0,16]];
      this.state=[this.state[0]+this.state[2],this.state[1]+this.state[3],this.state[2],this.state[3]];
      this.P=matmul(matmul(F,this.P),transpose(F)).map((r,i)=>r.map((v,j)=>v+Q[i][j]));
      if(good&&Math.hypot(x-this.state[0],y-this.state[1])<=this.gate) {
        const A=this.P[0][0]+25,B=this.P[0][1],C=this.P[1][0],D=this.P[1][1]+25, det=A*D-B*C;
        const gain=this.P.map(r=>[(r[0]*D-r[1]*C)/det,(-r[0]*B+r[1]*A)/det]);
        const error=[x-this.state[0],y-this.state[1]], old=this.P;
        this.state=this.state.map((v,i)=>v+dot(gain[i],error));
        this.P=old.map((r,i)=>r.map((v,j)=>v-gain[i][0]*old[0][j]-gain[i][1]*old[1][j]));
        point=[x,y]; observed=true; this.missing=0;
      } else {
        this.missing++;
        if(this.missing<=5&&this.state[0]>=0&&this.state[0]<this.w&&this.state[1]>=0&&this.state[1]<this.h) point=this.state.slice(0,2);
        else {this.state=null;this.history=[];this.missing=0;}
      }
    }
    if(!point) return {point:[NaN,NaN],observed:false};
    this.history.push(point);if(this.history.length>4)this.history.shift();
    return {point:meanPoint(this.history,this.history.map((_,i)=>i)),observed};
  }
}
export class PoseSmoother {
  constructor(w,h,confidence=.5) {this.trackers=Array.from({length:33},()=>new PointTracker(w,h,confidence));this.world=[];}
  update(xy,world,conf) {
    const points=xy.map((p,i)=>this.trackers[i].update(p,conf[i]));
    if(!world.some(finite))this.world=[];else {this.world.push(world);if(this.world.length>5)this.world.shift();}
    return {xy:points.map(p=>p.point),observed:points.map(p=>p.observed),conf,
      world:Array.from({length:33},(_,i)=>[0,1,2].map(d=>mean(this.world.map(w=>w[i][d]))))};
  }
}
export function extraAngles(world) {
  const hip=meanPoint(world,[23,24]), shoulder=meanPoint(world,[11,12]);
  return {trunk_bend_deg:angle(sub(shoulder,hip),sub(hip,meanPoint(world,LOWER))),
    left_knee_deg:angle(sub(world[23],world[25]),sub(world[27],world[25])),
    right_knee_deg:angle(sub(world[24],world[26]),sub(world[28],world[26]))};
}
function twist(world) {
  const axis=unit(sub(meanPoint(world,[23,24]),meanPoint(world,LOWER)));
  let hip=sub(world[24],world[23]), shoulder=sub(world[12],world[11]);
  hip=unit(sub(hip,mul(axis,dot(hip,axis))));shoulder=unit(sub(shoulder,mul(axis,dot(shoulder,axis))));
  return deg(Math.atan2(dot(cross(hip,shoulder),axis),dot(hip,shoulder)));
}

export function solvePose(cv,P,xy,observed,K,previous=null) {
  const ids=PNP.filter(i=>observed[i]&&finite(P[i])&&finite(xy[i]));
  if(ids.length<6)return null;
  const mats=[];const mat=(r,c,type,data)=>{const m=cv.matFromArray(r,c,type,data);mats.push(m);return m;};
  try {
    const obj=mat(ids.length,3,cv.CV_64F,ids.flatMap(i=>P[i])), img=mat(ids.length,2,cv.CV_64F,ids.flatMap(i=>xy[i]));
    const camera=mat(3,3,cv.CV_64F,[K.f,0,K.cx,0,K.f,K.cy,0,0,1]);
    const dist=mat(4,1,cv.CV_64F,[0,0,0,0]),rv=mat(3,1,cv.CV_64F,previous?.rvec??[0,0,0]),tv=mat(3,1,cv.CV_64F,previous?.t??[0,0,0]);
    if(!cv.solvePnP(obj,img,camera,dist,rv,tv,!!previous,cv.SOLVEPNP_ITERATIVE))return null;
    const rot=new cv.Mat();mats.push(rot);cv.Rodrigues(rv,rot);
    const R=Array.from({length:3},(_,i)=>Array.from(rot.data64F.slice(i*3,i*3+3))),t=Array.from(tv.data64F),rvec=Array.from(rv.data64F);
    const transformed=ids.map(i=>add(R.map(r=>dot(r,P[i])),t));
    if(!finite(t)||transformed.some(p=>!finite(p)||p[2]<=1))return null;
    const error=Math.sqrt(mean(transformed.map((p,j)=>norm(sub(project(p,K),xy[ids[j]]))**2)));
    if(error>.04*Math.hypot(K.cx*2,K.cy*2))return null;
    return {R,t,rvec,reprojection_px:error};
  } catch {return null;} finally {mats.forEach(m=>m.delete());}
}
function toCamera(xy,P,pose,K) {
  return P.map((p,i)=>{const cam=add(pose.R.map(r=>dot(r,p)),pose.t);return finite(xy[i])?[(xy[i][0]-K.cx)*cam[2]/K.f,(xy[i][1]-K.cy)*cam[2]/K.f,cam[2]]:cam;});
}
function bodyFrame(C,up,floor=null) {
  const ankle=meanPoint(C,[27,28]);let side=sub(C[24],C[23]);side=unit(sub(side,mul(up,dot(side,up))));
  let front=unit(cross(side,up));if(dot(sub(meanPoint(C,[31,32]),meanPoint(C,[29,30])),front)<0)front=mul(front,-1);
  const drop=floor?dot(sub(floor,ankle),up):Math.min(...FEET.map(i=>dot(sub(C[i],ankle),up)).filter(Number.isFinite));
  const O=add(ankle,mul(up,drop));return finite(O)&&finite(front)?{O,up,side,front}:null;
}
function bodyCoords(p,b) {const d=sub(p,b.O);return [dot(d,b.front),dot(d,b.up),dot(d,b.side)];}

export function calibrate(cv,samples,height,w,h,fov=70) {
  if(samples.length<5)throw Error('ช่วงอ้างอิงต้องเห็นผู้ยกเต็มตัวอย่างน้อย 5 เฟรม');
  const distances=samples.map(s=>Math.max(...FEET.map(i=>s.xy[i][1]).filter(Number.isFinite))-s.xy[0][1]).filter(x=>x>10);
  if(!distances.length||std(distances)/mean(distances)>.1)throw Error('เลือกช่วงที่ยืนตรงนิ่งและเห็นจมูกถึงเท้าครบ');
  const K={f:Math.max(w,h)/2/Math.tan(fov*Math.PI/360),cx:w/2,cy:h/2};
  const worldHeights=samples.map(({world})=>{
    const axis=unit(sub(meanPoint(world,[23,24]),meanPoint(world,LOWER)));
    return Math.max(...FEET.map(i=>dot(sub(world[0],world[i]),axis)))*100;
  }).filter(x=>x>20&&Number.isFinite(x));
  if(!worldHeights.length)throw Error('ข้อมูลข้อต่อในช่วงอ้างอิงไม่เพียงพอ');
  const c={height_cm:height,K,cm_per_px:height*.905/median(distances),world_scale:height*.905/median(worldHeights)};
  const CList=[],axes=[];let pose=null;
  for(const s of samples) {
    const P=s.world.map(p=>mul(p,100*c.world_scale));pose=solvePose(cv,P,s.xy,s.observed,K,pose);if(!pose)continue;
    const C=toCamera(s.xy,P,pose,K),axis=unit(sub(meanPoint(C,[23,24]),meanPoint(C,LOWER)));
    if(finite(axis)&&[11,12,23,24,25,26,27,28,...FEET].every(i=>finite(C[i]))) {CList.push(C);axes.push(axis);}
  }
  if(CList.length<Math.max(5,Math.floor(samples.length/3)))throw Error('เทียบสเกลไม่สำเร็จ เลือกช่วงยืนตรงที่เห็นทั้งตัวแล้วลองอีกครั้ง');
  c.up=unit(meanPoint(axes,axes.map((_,i)=>i)));
  const floors=CList.map(C=>bodyFrame(C,c.up)?.O).filter(Boolean);if(!floors.length)throw Error('หาระดับพื้นในช่วงอ้างอิงไม่ได้');
  c.floor=medianPoint(floors);const knees=[],hips=[],shoulders=[];
  for(const C of CList) {const b=bodyFrame(C,c.up,c.floor);if(!b)continue;
    knees.push(bodyCoords(meanPoint(C,[25,26]),b)[1]);hips.push(bodyCoords(meanPoint(C,[23,24]),b)[1]);shoulders.push(bodyCoords(meanPoint(C,[11,12]),b)[1]);}
  c.knee_cm=median(knees);c.shoulder_cm=median(shoulders);c.waist_cm=median(hips)+.3*(c.shoulder_cm-median(hips));
  const twists=samples.map(s=>twist(s.world)*Math.PI/180).filter(Number.isFinite);
  c.twist_baseline=deg(Math.atan2(mean(twists.map(Math.sin)),mean(twists.map(Math.cos))));c.valid_calibration_frames=CList.length;
  if(![c.cm_per_px,c.world_scale,c.knee_cm,c.waist_cm,c.shoulder_cm,c.twist_baseline].every(Number.isFinite)||!(0<c.knee_cm&&c.knee_cm<c.waist_cm&&c.waist_cm<c.shoulder_cm&&c.shoulder_cm<height*1.15))
    throw Error('ระดับร่างกายจากช่วงอ้างอิงไม่สมเหตุสมผล ลองเลือกช่วงยืนตรงใหม่');
  return c;
}
function usable(s) {return s.observed[0]&&FEET.some(i=>s.observed[i])&&PNP.filter(i=>s.observed[i]).length>=6&&s.world.every(finite);}
function heightPixels(s) {return Math.max(...FEET.map(i=>s.xy[i][1]).filter(Number.isFinite))-s.xy[0][1];}
export function chooseCalibration(cv,records,s,w,h) {
  const requested=records.filter(r=>r.time_s>=s.calibStart&&r.time_s<s.calibStart+s.calibSeconds&&usable(r));
  let error;
  try {
    if(requested.length<Math.max(5,Math.round(s.calibSeconds*s.fps*.4)))throw Error('เห็นผู้ยกเต็มตัวไม่เพียงพอ');
    return {...calibrate(cv,requested,s.height,w,h,s.fov),start_s:s.calibStart,end_s:s.calibStart+s.calibSeconds,selection_method:'requested'};
  } catch(e) {error=e;if(!s.autoCalibrate)throw e;}
  const all=records.filter(r=>r.time_s<10&&usable(r));
  const heights=all.map(heightPixels).sort((a,b)=>a-b),pos=(heights.length-1)*.9;
  const href=heights[Math.floor(pos)]*(1-pos%1)+heights[Math.ceil(pos)]*(pos%1);
  for(const seconds of [...new Set([s.calibSeconds,Math.min(1,s.calibSeconds),Math.min(.6,s.calibSeconds)])].sort((a,b)=>b-a)) {
    const candidates=[];
    for(let tick=0;tick<=Math.floor((Math.min(10,records.at(-1).time_s+1/s.fps)-seconds)*10+1e-6);tick++) {
      const start=tick/10,samples=all.filter(r=>r.time_s>=start&&r.time_s<start+seconds),h= samples.map(heightPixels),hm=median(h);
      if(samples.length<Math.max(5,Math.ceil(seconds*s.fps*.75))||hm<.9*href||std(h)/hm>.04)continue;
      const upright=samples.map(r=>extraAngles(r.world)).map(p=>p.trunk_bend_deg<=20&&p.left_knee_deg>=145&&p.right_knee_deg>=145);
      if(mean(upright.map(Number))<.8)continue;
      const centers=samples.map(r=>meanPoint(r.xy,[11,12,23,24]));
      const speed=median(centers.slice(1).map((p,i)=>norm(sub(p,centers[i]))/(samples[i+1].time_s-samples[i].time_s)))/hm;
      if(!Number.isFinite(speed)||speed>.08)continue;
      candidates.push({start,seconds,samples,score:std(h)/hm+.1*speed+.0001*start});
    }
    for(const a of candidates.sort((a,b)=>a.score-b.score)) {
      try{return {...calibrate(cv,a.samples,s.height,w,h,s.fov),start_s:a.start,end_s:a.start+a.seconds,selection_method:'automatic_upright_window'};}catch{/* Try next upright window. */}
    }
  }
  throw Error('ไม่พบช่วงยืนตรงนิ่งใน 10 วินาทีแรก เลือกเวลาเริ่มอ้างอิงในตั้งค่าเพิ่มเติมแล้วลองใหม่ ('+error.message+')');
}

export class LiftCounter {
  constructor(s=DEFAULTS) {Object.assign(this,{excursion:s.excursion,returnExcursion:s.returnExcursion??s.excursion,dwell:s.dwell,interval:s.interval,gap:s.gap,count:0,events:[],lastCount:-Infinity,lastTime:null,lastValid:null,window:[]});this.reset();}
  reset() {this.state='SEEK_LOW';this.trough=null;this.peak=null;this.troughTime=null;this.since=null;this.window=[];}
  update(t,value,confirmed=true) {
    if(this.lastTime!==null&&t<=this.lastTime)throw Error('เวลาในตัวนับรอบต้องเพิ่มขึ้น');this.lastTime=t;
    if(!Number.isFinite(value)){this.since=null;if(this.lastValid!==null&&t-this.lastValid>this.gap)this.reset();return false;}
    if(this.lastValid!==null&&t-this.lastValid>this.gap)this.reset();this.lastValid=t;
    this.window.push([t,value]);while(this.window.length&&t-this.window[0][0]>.1)this.window.shift();
    const v=median(this.window.map(x=>x[1]));
    if(this.trough===null){this.trough=v;this.troughTime=t;return false;}
    if(this.state==='SEEK_LOW') {
      if(v<this.trough){this.trough=v;this.troughTime=t;}
      if(!(confirmed&&v-this.trough>=this.excursion&&t-this.lastCount>=this.interval)){this.since=null;return false;}
      this.since??=t;if(t-this.since+1e-9<this.dwell)return false;
      this.count++;this.lastCount=t;this.peak=v;this.state='SEEK_RETURN';this.since=null;
      this.events.push({lift_number:this.count,start_s:this.troughTime,counted_s:t,low_V_cm:this.trough,peak_V_cm:v,return_s:NaN});return true;
    }
    this.peak=Math.max(this.peak,v);this.events.at(-1).peak_V_cm=this.peak;
    if(this.peak-v<this.returnExcursion){this.since=null;return false;}
    this.since??=t;if(t-this.since+1e-9>=this.dwell){this.events.at(-1).return_s=t;this.state='SEEK_LOW';this.trough=v;this.troughTime=t;this.since=null;}
    return false;
  }
}
export function measureFrame(cv,r,c,s,previous,counter) {
  const P=r.world.map(p=>mul(p,100*c.world_scale)),pose=solvePose(cv,P,r.xy,r.observed,c.K,previous);
  const row={frame_number:r.frame_number,time_s:r.time_s,fps:s.fps,pose_valid:!!pose,measurement_valid:false,
    H_cm:NaN,V_cm:NaN,orientation_deg:NaN,twist_deg:NaN,reprojection_px:pose?.reprojection_px??NaN,
    zone:null,reach_class:null,limit_kg:NaN,visible_hands:0,
    ...extraAngles(r.world.map((p,i)=>r.conf[i]>=s.confidence?p:[NaN,NaN,NaN]))};
  if([11,12,23,24].every(i=>r.conf[i]>=s.confidence))row.twist_deg=Math.abs(((twist(r.world)-c.twist_baseline+540)%360)-180);
  let m=null;
  if(pose) {
    const C=toCamera(r.xy,P,pose,c.K),b=bodyFrame(C,c.up,c.floor),d=sub(C[24],C[23]),yaw=Math.abs(deg(Math.atan2(d[2],d[0])));
    row.orientation_deg=Math.min(yaw,180-yaw);
    const hands=[[15,17,19],[16,18,20]].filter(ids=>r.observed[ids[0]]&&ids.filter(i=>r.observed[i]).length>=2);
    if(b&&hands.length) {
      const hand=meanPoint(hands.map(ids=>meanPoint(C,ids)),hands.map((_,i)=>i)),coords=bodyCoords(hand,b),H=Math.hypot(coords[0],coords[2]),V=coords[1];
      if(Number.isFinite(H)&&Number.isFinite(V)&&V>=-10&&V<=s.height*1.5&&H<=s.height) {
        const ri=V>=c.shoulder_cm?0:V>=c.waist_cm?1:V>=c.knee_cm?2:3,ci=H<17.78?0:H<30.48?1:2;
        Object.assign(row,{measurement_valid:true,H_cm:H,V_cm:V,zone:ZONES[ri],reach_class:REACHES[ci],limit_kg:WEIGHTS[ri][ci],visible_hands:hands.length});
        m={row:ri,col:ci,origin:project(b.O,c.K),hands:meanPoint(hands.map(ids=>meanPoint(r.xy,ids)),hands.map((_,i)=>i))};
      }
    }
  }
  const floor=project(c.floor,c.K),up=unit(sub(project(add(c.floor,mul(c.up,30)),c.K),floor));
  const hands=[15,16].filter(i=>r.observed[i]&&finite(r.xy[i])),hipIds=[23,24].filter(i=>r.observed[i]&&finite(r.xy[i])),shoulderIds=[11,12].filter(i=>r.observed[i]&&finite(r.xy[i]));
  row.count_signal_cm=hands.length?dot(sub(meanPoint(r.xy,hands),floor),up)*c.cm_per_px:NaN;row.count_body_level=NaN;
  if(hands.length&&hipIds.length&&shoulderIds.length) {
    const hip=meanPoint(r.xy,hipIds),axis=sub(meanPoint(r.xy,shoulderIds),hip);
    if(dot(axis,axis)>=25)row.count_body_level=dot(sub(meanPoint(r.xy,hands),hip),up)/Math.max(dot(axis,up),norm(axis)*.5);
  }
  row.hand_body_confirmed=!s.bodyConfirmation||s.confirmLevel==='none'||Number.isFinite(row.count_body_level)&&row.count_body_level>=(s.confirmLevel==='waist'?.3:0);
  row.lift_event=counter.update(r.time_s,row.count_signal_cm,row.hand_body_confirmed);row.lift_count=counter.count;row.lift_state=counter.state;
  return {row,pose,overlay:m};
}
export function summarize(frames,events,calibration,settings,name) {
  const valid=frames.filter(r=>r.measurement_valid),finiteValues=k=>frames.map(r=>r[k]).filter(Number.isFinite);
  const max=k=>finiteValues(k).length?Math.max(...finiteValues(k)):null;
  return {video_name:name,height_cm:settings.height,frames_processed:frames.length,fps:settings.fps,
    analysis_duration_s:frames.length/settings.fps,lift_count:events.length,measurement_coverage_pct:100*valid.length/Math.max(1,frames.length),
    max_H_cm:max('H_cm'),max_twist_deg:max('twist_deg'),min_demo_limit_kg:valid.length?Math.min(...valid.map(r=>r.limit_kg)):null,
    actual_calib_start_s:calibration.start_s,actual_calib_end_s:calibration.end_s,calibration_selection:calibration.selection_method,
    expected_lifts:settings.expected??null,absolute_count_error:settings.expected===null||settings.expected===undefined?null:Math.abs(events.length-settings.expected),status:valid.length?'ok':'no_valid_measurements'};
}
