import './style.css';
import { DEFAULTS, HEIGHTS, SKELETON, validateSettings } from './engine.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createFile } from 'mp4box';

const $=id=>document.getElementById(id), video=$('video'),decoder=$('decoder'),overlay=$('overlay');
let selectedFile=null,selectedUrl=null,bundle=null,worker=null,busy=false,cancelled=false,exporting=false,exportAbort=null,showOverlay=true,framePage=0,runSerial=0;
let pending=new Map(),messageId=0,animation=null,lastOverlay=null,lastSettings={...DEFAULTS};
const isNumber=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=(v,d=1)=>isNumber(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const clock=t=>{t=Number.isFinite(t)?Math.max(0,t):0;return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;};
const base=()=>new URL(import.meta.env.BASE_URL,location.href);
function status(message,state='ready'){ $('status').textContent=message;$('status-line').dataset.state=state; }
function progress(value){$('progress').value=value;$('progress-text').textContent=Math.round(value)+'%';}
function showError(e){$('error').textContent=e.message??String(e);$('error').hidden=false;status('ยังวิเคราะห์ไม่สำเร็จ','error');}
function clearError(){$('error').hidden=true;$('error').textContent='';}
function setBusy(value){busy=value;$('analyze').hidden=value;$('cancel').hidden=!value;$('progress-wrap').hidden=!value;
  $('analyze').disabled=!selectedFile;for(const e of document.querySelectorAll('.setup input,.setup select,#choose-button,#reset-settings,#import-button,#manifest-button'))e.disabled=value;
  $('export-button').disabled=value||!bundle;$('play').disabled=value||!selectedUrl;$('seek').disabled=value||!selectedUrl;$('overlay-toggle').disabled=value||!bundle;
  if(value){video.pause();progress(0);clearError();} }
function settings(){const n=id=>Number($(id).value);
  const s={...DEFAULTS,height:n('height'),fps:n('fps'),excursion:n('excursion'),returnExcursion:n('return-excursion'),dwell:n('dwell'),interval:n('interval'),fov:n('fov'),calibStart:n('calib-start'),calibSeconds:n('calib-seconds'),autoCalibrate:$('auto-calibrate').checked,confirmLevel:$('confirm-level').value,expected:$('expected').value===''?null:n('expected')};
  validateSettings(s);if(s.expected!==null&&(!Number.isInteger(s.expected)||s.expected<0))throw Error('จำนวนจริงต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');return s;}
function resetSettings(){for(const [id,key]of Object.entries({height:'height',fps:'fps',excursion:'excursion','return-excursion':'returnExcursion',dwell:'dwell',interval:'interval',fov:'fov','calib-start':'calibStart','calib-seconds':'calibSeconds'}))$(id).value=DEFAULTS[key]??'';$('auto-calibrate').checked=true;$('confirm-level').value='waist';$('subject').value='custom';$('expected').value='';}
function loaded(el){return new Promise((resolve,reject)=>{
  if(el.readyState>=2&&isNumber(el.duration)&&el.duration>0)return resolve();
  const timeout=setTimeout(()=>done(Error('อ่านวิดีโอไม่สำเร็จ ลองใช้ไฟล์ MP4 แบบ H.264')),15000);
  const done=e=>{clearTimeout(timeout);el.removeEventListener('loadeddata',ok);el.removeEventListener('error',fail);e?reject(e):resolve();};
  const ok=()=>done(),fail=()=>done(Error('เบราว์เซอร์เปิดวิดีโอนี้ไม่ได้ ลองแปลงเป็น MP4 แบบ H.264'));
  el.addEventListener('loadeddata',ok,{once:true});el.addEventListener('error',fail,{once:true});
});}
async function seekVideo(el,t){if(Math.abs(el.currentTime-t)<.000001&&el.readyState>=2)return;
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>done(Error('อ่านเฟรมวิดีโอไม่สำเร็จ ลองเลือกไฟล์ใหม่')),10000);
    const done=e=>{clearTimeout(timeout);el.removeEventListener('seeked',ok);el.removeEventListener('error',fail);e?reject(e):resolve();};
    const ok=()=>done(),fail=()=>done(Error('อ่านวิดีโอไม่สำเร็จ'));el.addEventListener('seeked',ok,{once:true});el.addEventListener('error',fail,{once:true});el.currentTime=t;});}
async function readFps(file){
  let info=null,error=false;const mp4=createFile();mp4.onReady=i=>{info=i;};mp4.onError=()=>{error=true;};let offset=0,loops=0;
  while(offset<file.size&&!info&&!error&&loops++<64){const buffer=await file.slice(offset,Math.min(offset+2*1024*1024,file.size)).arrayBuffer();buffer.fileStart=offset;const next=mp4.appendBuffer(buffer);offset=next>offset?next:offset+buffer.byteLength;}
  mp4.flush();const track=info?.videoTracks?.[0];const fps=track?.nb_samples*track?.timescale/track?.duration;
  return fps>=5&&fps<=120?fps:null;
}
async function chooseFile(file){if(busy||exporting||!file)return;clearError();
  if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name)){showError(Error('เลือกไฟล์วิดีโอ MP4, MOV หรือ WebM'));return;}
  const serial=++runSerial;video.pause();if(selectedUrl)URL.revokeObjectURL(selectedUrl);selectedFile=file;selectedUrl=URL.createObjectURL(file);
  video.src=selectedUrl;decoder.src=selectedUrl;bundle=null;lastOverlay=null;framePage=0;resetResults();
  $('file-name').textContent=file.name;$('result-name').textContent=file.name+' · รอวิเคราะห์';$('analyze').disabled=true;status('กำลังเปิดคลิป…');
  try{await Promise.all([loaded(video),loaded(decoder)]);if(serial!==runSerial)return;
    if(!isNumber(video.duration)||video.duration<=0)throw Error('อ่านความยาววิดีโอไม่ได้ ลองแปลงเป็น MP4 ก่อน');
    video.hidden=false;overlay.hidden=false;$('empty-stage').hidden=true;$('seek').max=video.duration;$('play').disabled=false;$('seek').disabled=false;$('analyze').disabled=false;
    $('duration-label').textContent='ความยาว '+clock(video.duration);updatePlayback();
    status('คลิปพร้อมแล้ว · กดเริ่มวิเคราะห์');
    let fps=null;try{fps=await readFps(file);}catch{/* Non-MP4 input uses explicit sampling rate. */}
    if(serial!==runSerial)return;
    if(fps){$('fps').value=Math.round(fps*1000)/1000;$('fps-note').textContent='อ่านจากคลิป: '+fmt(fps,2)+' เฟรม/วินาที';}
    else {$('fps').value=30;$('fps-note').textContent='อ่านอัตราเฟรมไม่ได้ ใช้ 30 เฟรม/วินาที ปรับได้ตามคลิป';}
  }catch(e){if(serial===runSerial){selectedFile=null;$('analyze').disabled=true;showError(e);}}
}
function request(type,data={},transfer=[]){return new Promise((resolve,reject)=>{const id=++messageId;pending.set(id,{resolve,reject});worker.postMessage({id,type,...data},transfer);});}
function stopWorker(){worker?.terminate();worker=null;for(const p of pending.values())p.reject(Error('cancelled'));pending.clear();}
async function analyze(){if(busy||!selectedFile||exporting)return;
  let s;try{s=settings();if(s.calibStart>=video.duration)throw Error('เวลาเริ่มอ้างอิงต้องอยู่ภายในคลิป');}catch(e){showError(e);return;}
  const duration=video.duration;if(duration*s.fps>30000){showError(Error('คลิปนี้มีเฟรมมากเกินไป กรุณาตัดให้สั้นลงหรือลดอัตราวิเคราะห์ในตั้งค่าเพิ่มเติม'));return;}
  if(!window.Worker||!window.createImageBitmap){showError(Error('เบราว์เซอร์นี้ยังไม่รองรับการวิเคราะห์ ลองเปิดด้วย Chrome หรือ Edge รุ่นปัจจุบัน'));return;}
  cancelled=false;setBusy(true);lastSettings=s;status('กำลังเตรียมตัววิเคราะห์…','busy');
  const scale=Math.min(1,s.maxSide/Math.max(video.videoWidth,video.videoHeight)),width=Math.max(2,Math.floor(video.videoWidth*scale/2)*2),height=Math.max(2,Math.floor(video.videoHeight*scale/2)*2);
  try {
    worker=new Worker(new URL('analysis-worker.js',base()));
    worker.onmessage=({data})=>{if(data.type==='status'){status(data.message,'busy');return;}if(data.type==='progress'){progress(data.percent);return;}
      const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.type==='error'?p.reject(Error(data.message)):p.resolve(data);};
    worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message||'ตัววิเคราะห์หยุดทำงาน ลองรีเฟรชหน้าแล้วเริ่มใหม่'));pending.clear();};
    await request('init',{settings:s,width,height});
    const count=Math.ceil(duration*s.fps-1e-6);status('กำลังตรวจจับการเคลื่อนไหว…','busy');
    for(let i=0;i<count;i++) {
      if(cancelled)throw Error('cancelled');const t=Math.min(i/s.fps,duration-.0001);await seekVideo(decoder,t);if(cancelled)throw Error('cancelled');
      const bitmap=await createImageBitmap(decoder,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
      const result=await request('frame',{bitmap,time:i/s.fps},[bitmap]);
      if(i%5===0||i+1===count){progress(2+87*(i+1)/count);status(`ตรวจจับ ${i+1} / ${count} เฟรม`,'busy');
        video.currentTime=t;lastOverlay={xy:result.xy,observed:result.observed};drawOverlay(lastOverlay,width,height);$('time').textContent=clock(t)+' / '+clock(duration);}
    }
    const result=await request('finish',{name:selectedFile.name,duration});bundle=result.bundle;framePage=0;lastOverlay=null;
    renderResults();await seekVideo(video,0);updatePlayback();status('วิเคราะห์เสร็จแล้ว · คลิกรอบยกหรือกราฟเพื่อดูช่วงที่สนใจ','done');progress(100);
  }catch(e){if(cancelled||e.message==='cancelled'){status('ยกเลิกแล้ว · เริ่มวิเคราะห์ใหม่ได้');lastOverlay=null;updatePlayback();}else showError(e);}
  finally{stopWorker();setBusy(false);updatePlayback();}
}
function cancel(){if(exporting){exportAbort?.();return;}if(!busy)return;cancelled=true;stopWorker();status('กำลังยกเลิก…');}
function resetResults(){for(const id of ['live-count','live-h','live-v','live-twist','live-bend','live-weight'])$(id).textContent='—';$('live-zone').textContent='รอผลวิเคราะห์';
  for(const [id,unit]of [['total-count','ครั้ง'],['max-h','ซม.'],['max-twist','°']]){const el=$(id);el.replaceChildren(document.createTextNode('—'),Object.assign(document.createElement('small'),{textContent:unit}));}
  $('chart-empty').hidden=false;$('chart-content').hidden=true;$('lifts-list').replaceChildren();$('lifts-empty').hidden=false;$('lifts-empty').textContent='รายการรอบยกจะแสดงหลังวิเคราะห์';$('event-count').hidden=true;$('frames-body').replaceChildren();$('frame-range').textContent='ยังไม่มีข้อมูลรายเฟรม';$('prev-page').disabled=true;$('next-page').disabled=true;$('details-list').replaceChildren();$('export-button').disabled=true;$('overlay-toggle').disabled=true;
  const ctx=overlay.getContext('2d');ctx.clearRect(0,0,overlay.width,overlay.height);}
function renderResults(){const b=bundle,s=b.summary;
  $('result-name').textContent=s.video_name+' · '+(b.parameters.platform==='web'?'ผลวิเคราะห์บนเว็บ':'ผลที่บันทึกไว้');
  for(const [id,value,unit,d]of [['total-count',s.lift_count,'ครั้ง',0],['max-h',s.max_H_cm,'ซม.',1],['max-twist',s.max_twist_deg,'°',1]]) {
    $(id).replaceChildren(document.createTextNode(fmt(value,d)),Object.assign(document.createElement('small'),{textContent:unit}));}
  $('export-button').disabled=false;$('overlay-toggle').disabled=!selectedUrl;$('export-video').disabled=!selectedUrl||!window.MediaRecorder||!bundle.overlays?.length;
  $('chart-empty').hidden=true;$('chart-content').hidden=false;$('event-count').textContent=b.events.length;$('event-count').hidden=false;
  $('lifts-empty').hidden=b.events.length>0;$('lifts-empty').textContent='ไม่พบรอบยกตามเกณฑ์ที่ตั้งไว้';
  $('lifts-list').replaceChildren(...b.events.map(e=>{const button=document.createElement('button');button.type='button';button.className='lift-item';
    const number=document.createElement('span');number.className='lift-number';number.textContent=String(e.lift_number).padStart(2,'0');
    const text=document.createElement('span'),title=document.createElement('strong'),sub=document.createElement('small');title.textContent='รอบที่ '+e.lift_number;sub.textContent=fmt(e.counted_s,2)+' วินาที';text.append(title,sub);button.append(number,text);button.setAttribute('aria-label',`ดูรอบที่ ${e.lift_number} เวลา ${fmt(e.counted_s,2)} วินาที`);button.onclick=()=>jumpTo(e.counted_s);return button;}));
  const c=b.calibration,p=b.parameters;const pairs=[['ส่วนสูงผู้ยก',fmt(s.height_cm??p.height??c.height_cm,1)+' ซม.'],['อัตราวิเคราะห์',fmt(s.fps,2)+' เฟรม/วิ.'],['จำนวนเฟรม',fmt(s.frames_processed,0)],['ช่วงยืนอ้างอิง',fmt(c.start_s??s.actual_calib_start_s,2)+'–'+fmt(c.end_s??s.actual_calib_end_s,2)+' วิ.'],['การเลือกช่วงอ้างอิง',(c.selection_method??s.calibration_selection)==='requested'?'ตามเวลาที่กำหนด':'ค้นหาอัตโนมัติ'],['เฟรมที่คำนวณระยะได้',fmt(s.measurement_coverage_pct,1)+'%'],['ระยะเคลื่อนขั้นต่ำ',fmt(p.excursion??p.LIFT_MIN_EXCURSION_CM,1)+' ซม.'],['เวลายืนยันรอบ',fmt(p.dwell??p.LIFT_DWELL_S,2)+' วิ.']];
  if(isNumber(s.expected_lifts)){pairs.push(['จำนวนจริง',fmt(s.expected_lifts,0)+' ครั้ง'],['คลาดเคลื่อนจำนวนครั้ง',fmt(s.absolute_count_error,0)+' ครั้ง']);}
  pairs.push(['วิธีตรวจจับ','MediaPipe Pose Lite · IMAGE'],['แหล่งผล',p.platform==='web'?'วิเคราะห์ในเบราว์เซอร์':'นำเข้าจากไฟล์']);
  $('details-list').replaceChildren(...pairs.map(([name,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);return row;}));renderFramePage();drawChart();updatePlayback();
}
function nearestRow(t){if(!bundle?.frames.length)return -1;let lo=0,hi=bundle.frames.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(bundle.frames[mid].time_s<=t)lo=mid;else hi=mid-1;}return lo;}
function updatePlayback(){const t=video.currentTime||0,d=video.duration||0;$('seek').value=t;$('time').textContent=clock(t)+' / '+clock(d);$('frame-time').textContent=clock(t);
  $('play').setAttribute('aria-label',video.paused?'เล่นวิดีโอ':'หยุดวิดีโอ');$('play-icon').setAttribute('d',video.paused?'m9 5 10 7-10 7Z':'M8 5v14M16 5v14');
  if(busy){return;}const index=nearestRow(t),r=bundle?.frames[index];
  if(r){$('live-count').textContent=fmt(r.lift_count,0);$('live-h').textContent=fmt(r.H_cm);$('live-v').textContent=fmt(r.V_cm);$('live-twist').textContent=fmt(r.twist_deg);$('live-bend').textContent=fmt(r.trunk_bend_deg);$('live-weight').textContent=fmt(r.limit_kg,0);$('live-zone').textContent=r.zone&&r.reach_class?r.zone+' · ระยะ'+r.reach_class:'ไม่มีค่าระยะในเฟรมนี้';}
  const o=bundle?.overlays?.[index];drawOverlay(o,bundle?.width??video.videoWidth,bundle?.height??video.videoHeight);if(bundle)drawChart();
}
function drawOverlay(o,w,h,target=overlay,withVideo=false){if(!w||!h)return;const rect=target===overlay?$('video-stage').getBoundingClientRect():{width:video.videoWidth,height:video.videoHeight};
  if(target===overlay){const ratio=window.devicePixelRatio||1;target.width=Math.round(rect.width*ratio);target.height=Math.round(rect.height*ratio);}const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);
  const scale=Math.min(target.width/w,target.height/h),ox=(target.width-w*scale)/2,oy=(target.height-h*scale)/2;
  ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);if(withVideo)ctx.drawImage(video,0,0,w,h);
  if(o&&(showOverlay||withVideo)){
    ctx.lineWidth=Math.max(1.6,w/330);ctx.strokeStyle='#fbfff9';
    for(const [a,b]of SKELETON){const p=o.xy[a],q=o.xy[b];if(p?.every(Number.isFinite)&&q?.every(Number.isFinite)){ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();}}
    for(const i of new Set(SKELETON.flat())){const p=o.xy[i];if(p?.every(Number.isFinite)){ctx.fillStyle=o.observed[i]?'#8bdfae':'#ffcb75';ctx.beginPath();ctx.arc(...p,Math.max(2.5,w/170),0,2*Math.PI);ctx.fill();}}
    const m=o.measurement;if(m?.origin?.every(Number.isFinite)&&m?.hands?.every(Number.isFinite)){ctx.strokeStyle='#f6c461';ctx.lineWidth=Math.max(2,w/250);ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(...m.origin);ctx.lineTo(...m.hands);ctx.stroke();ctx.setLineDash([]);}
  }
  if(withVideo&&bundle){const r=bundle.frames[nearestRow(video.currentTime)];const size=Math.max(13,w/40);ctx.font=`600 ${size}px sans-serif`;ctx.fillStyle='#10241de0';ctx.fillRect(8,8,Math.min(w-16,size*24),size*4.3);ctx.fillStyle='#fff';if(r){ctx.fillText(`G07 | lifts ${r.lift_count}`,16,size*1.6);ctx.fillText(`H ${fmt(r.H_cm)} cm | V ${fmt(r.V_cm)} cm`,16,size*2.8);ctx.fillText(`Twist ${fmt(r.twist_deg)} deg | Demo ${fmt(r.limit_kg,0)} kg`,16,size*4);}}
  ctx.restore();
}
async function jumpTo(t){if(!selectedUrl){status('เลือกคลิปต้นฉบับเพื่อดูวิดีโอประกอบผล');return;}try{await seekVideo(video,Math.max(0,Math.min(t,video.duration)));updatePlayback();}catch(e){showError(e);}}
function renderFramePage(){const rows=bundle?.frames??[],start=framePage*20,end=Math.min(start+20,rows.length);$('frame-range').textContent=rows.length?`เฟรม ${start+1}–${end} จาก ${rows.length.toLocaleString('en-US')}`:'ยังไม่มีข้อมูลรายเฟรม';
  $('prev-page').disabled=framePage===0;$('next-page').disabled=end>=rows.length;
  $('frames-body').replaceChildren(...rows.slice(start,end).map(r=>{const tr=document.createElement('tr');for(const [k,d]of [['time_s',2],['H_cm',1],['V_cm',1],['twist_deg',1],['trunk_bend_deg',1],['lift_count',0]]){const td=document.createElement('td');td.textContent=fmt(r[k],d);tr.append(td);}tr.onclick=()=>jumpTo(r.time_s);return tr;}));}
function drawChart(){if(!bundle||$('panel-chart').hidden)return;const canvas=$('chart'),rect=canvas.getBoundingClientRect();if(rect.width<1)return;const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height,L=42,R=12,T=12,B=24,mode=$('chart-mode').value;
  const modes={reach:['H_cm','V_cm','ระยะเอื้อม H','ความสูงมือ V','ซม.'],angles:['twist_deg','trunk_bend_deg','มุมบิดตัว','มุมก้มลำตัว','องศา'],knees:['left_knee_deg','right_knee_deg','เข่าซ้าย','เข่าขวา','องศา'],count:['lift_count',null,'จำนวนครั้งสะสม',null,'ครั้ง']};
  const [a,b,la,lb,unit]=modes[mode];$('legend-a').lastChild.textContent=la;$('legend-b').hidden=!b;if(b)$('legend-b').lastChild.textContent=lb;$('chart-unit').textContent=unit;
  const rows=bundle.frames,values=rows.flatMap(r=>[r[a],b?r[b]:NaN]).filter(isNumber),max=Math.max(1,...values),ymax=Math.ceil(max*1.08/(mode==='count'?1:10))*(mode==='count'?1:10),ymin=Math.min(0,...values),dur=rows.at(-1).time_s||1;
  const x=t=>L+t/dur*(w-L-R),y=v=>T+(ymax-v)/(ymax-ymin)*(h-T-B);ctx.font='10px "Leelawadee UI",Tahoma,sans-serif';
  for(let i=0;i<=4;i++){const v=ymin+(ymax-ymin)*i/4,yy=y(v);ctx.strokeStyle='#dce4de';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,yy);ctx.lineTo(w-R,yy);ctx.stroke();ctx.fillStyle='#61776a';ctx.textAlign='right';ctx.fillText(fmt(v,0),L-8,yy+3);const tt=dur*i/4;ctx.textAlign='center';ctx.fillText(fmt(tt,1),x(tt),h-5);}
  ctx.strokeStyle='#b7c9bd';ctx.setLineDash([3,4]);for(const e of bundle.events){ctx.beginPath();ctx.moveTo(x(e.counted_s),T);ctx.lineTo(x(e.counted_s),h-B);ctx.stroke();}ctx.setLineDash([]);
  for(const [key,color]of [[a,'#126c61'],[b,'#4c76b4']]){if(!key)continue;ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.beginPath();let connected=false;for(const r of rows){if(!isNumber(r[key])){connected=false;continue;}if(connected)ctx.lineTo(x(r.time_s),y(r[key]));else ctx.moveTo(x(r.time_s),y(r[key]));connected=true;}ctx.stroke();}
  const xx=x(Math.min(video.currentTime||0,dur));ctx.strokeStyle='#8b5828';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,T);ctx.lineTo(xx,h-B);ctx.stroke();
}
function activateTab(name,focus=false){for(const tab of document.querySelectorAll('[role=tab]')){const active=tab.id==='tab-'+name;tab.setAttribute('aria-selected',active);tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;if(active&&focus)tab.focus();}$('chart-mode').hidden=name!=='chart';if(name==='chart')drawChart();}
const csvValue=v=>{if(v===null||v===undefined||typeof v==='number'&&!Number.isFinite(v))return '';let text=String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
function csv(rows,columns){const keys=columns??Object.keys(rows[0]??{});return '\ufeff'+[keys.join(','),...rows.map(r=>keys.map(k=>csvValue(r[k])).join(','))].join('\r\n');}
function safeName(){return (bundle?.summary.video_name??'G07').replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80)||'G07';}
function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();setTimeout(()=>a.remove(),1000);setTimeout(()=>URL.revokeObjectURL(url),60000);}
function closeExport(){$('export-menu').hidePopover?.();}
function exportZip(){if(!bundle)return;closeExport();const root=safeName()+'/',files={};
  for(const [name,data]of [['frames.csv',csv(bundle.frames)],['lifts.csv',csv(bundle.events,['lift_number','start_s','counted_s','low_V_cm','peak_V_cm','return_s'])],['summary.csv',csv([bundle.summary])],['calibration.json',JSON.stringify(bundle.calibration,null,2)],['parameters.json',JSON.stringify(bundle.parameters,null,2)],['web_result.json',JSON.stringify({version:1,summary:bundle.summary,width:bundle.width,height:bundle.height,overlays:bundle.overlays??[]})]])files[root+name]=strToU8(data);
  download(zipSync(files,{level:6}),safeName()+'_results.zip','application/zip');status('ดาวน์โหลดผลแล้ว · เก็บคลิปต้นฉบับไว้ใช้เปิดคู่กัน','done');}
function parseCsv(text){const lines=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))lines.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(Boolean))lines.push(row);const keys=(lines.shift()??[]).map(k=>k.replace(/^\ufeff/,''));return lines.map(values=>Object.fromEntries(keys.map((k,i)=>{const v=values[i]??'';return [k,v===''?null:/^(True|true)$/.test(v)?true:/^(False|false)$/.test(v)?false:Number.isFinite(Number(v))?Number(v):v];})));}
async function importManifest(file){if(!file||busy||exporting)return;clearError();try{
  if(file.size>5*1024*1024)throw Error('manifest ใหญ่เกิน 5 MB กรุณาเลือก CSV ข้อมูลผู้ยก');
  const rows=parseCsv(await file.text()),heights=Object.create(null);
  for(const r of rows){const id=String(r.subject_id??r.subject??'').trim(),height=r.subject_height_cm??r.height_cm;
    if(!id||id==='custom'||id.length>80||!isNumber(height)||height<50||height>250)continue;
    if(heights[id]!==undefined&&heights[id]!==height)throw Error('ส่วนสูงของ '+id+' ใน manifest ไม่ตรงกัน กรุณาตรวจ CSV');heights[id]=height;}
  const entries=Object.entries(heights).sort(([a],[b])=>a.localeCompare(b));if(!entries.length)throw Error('ไม่พบส่วนสูงใน CSV ต้องมีคอลัมน์ subject_id และ subject_height_cm');
  for(const key of Object.keys(HEIGHTS))delete HEIGHTS[key];Object.assign(HEIGHTS,heights);
  $('subject').replaceChildren(Object.assign(document.createElement('option'),{value:'custom',textContent:'กำหนดส่วนสูงเอง'}),...entries.map(([id,height])=>Object.assign(document.createElement('option'),{value:id,textContent:id+' · '+height+' ซม.'})));
  status('นำเข้าส่วนสูงแล้ว · เลือกผู้ยกจากรายการ');
}catch(e){showError(e);}}
async function importZip(file){if(!file||busy||exporting)return;clearError();try{if(file.size>250*1024*1024)throw Error('ไฟล์ผลใหญ่เกิน 250 MB กรุณาใช้ ZIP ที่มีเฉพาะผลวิเคราะห์');
  status('กำลังเปิดผลที่บันทึกไว้…');let total=0;const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{const allowed=/\/(frames\.csv|lifts\.csv|summary\.csv|calibration\.json|parameters\.json|web_result\.json)$/.test('/'+entry.name);if(allowed){total+=entry.originalSize;if(total>150*1024*1024)throw Error('ข้อมูลใน ZIP ใหญ่เกินไป');}return allowed;}});
  const summaryPath=Object.keys(files).find(p=>p.endsWith('summary.csv')&&files[p.replace(/summary\.csv$/,'frames.csv')]);if(!summaryPath)throw Error('ไม่พบ summary.csv และ frames.csv ใน ZIP นี้');
  const root=summaryPath.slice(0,-'summary.csv'.length),read=name=>files[root+name]?strFromU8(files[root+name]):'',json=name=>read(name)?JSON.parse(read(name)):{};
  const summary=parseCsv(read('summary.csv'))[0],frames=parseCsv(read('frames.csv')),events=parseCsv(read('lifts.csv'));
  if(!summary||typeof summary.video_name!=='string'||!Number.isInteger(summary.lift_count)||summary.lift_count<0||!frames.length||frames.length>30000||frames.some((r,i)=>!isNumber(r.time_s)||!Number.isInteger(r.lift_count)||r.lift_count<0||r.time_s<0||i>0&&r.time_s<=frames[i-1].time_s))throw Error('รูปแบบผลวิเคราะห์ไม่ถูกต้อง กรุณาเลือก ZIP ที่ส่งออกจาก G07');
  if(events.some(e=>!isNumber(e.counted_s)||!Number.isInteger(e.lift_number)))throw Error('รูปแบบรายการรอบยกไม่ถูกต้อง');
  const web=json('web_result.json'),calibration=json('calibration.json'),parameters=json('parameters.json');
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>v===null||isNumber(v));
  if(web.overlays&&(!Array.isArray(web.overlays)||web.overlays.length>30000||web.overlays.length>0&&(!isNumber(web.width)||!isNumber(web.height)||web.width<2||web.height<2||web.width>4096||web.height>4096)||web.overlays.some(o=>!o||!Array.isArray(o.xy)||o.xy.length!==33||!o.xy.every(point)||!Array.isArray(o.observed)||o.observed.length!==33||o.measurement&&(!point(o.measurement.origin)||!point(o.measurement.hands)))))throw Error('รูปแบบเส้นข้อต่อไม่ถูกต้อง');
  bundle={summary,frames,events,calibration,parameters,width:web.width,height:web.height,overlays:web.overlays??[]};framePage=0;
  // Keep a matching selected video; otherwise offer the original clip separately.
  if(selectedFile?.name!==summary.video_name){video.pause();video.removeAttribute('src');video.load();if(selectedUrl)URL.revokeObjectURL(selectedUrl);selectedUrl=null;selectedFile=null;$('file-name').textContent='เลือกคลิปต้นฉบับเพื่อดูคู่กับผล';$('analyze').disabled=true;$('play').disabled=true;$('seek').disabled=true;video.hidden=true;overlay.hidden=true;$('empty-stage').hidden=false;}
  renderResults();status(selectedUrl?'เปิดผลเดิมแล้ว':'เปิดผลเดิมแล้ว · เลือกคลิปชื่อเดียวกันเพื่อดูวิดีโอประกอบ','done');
  // Attach the original clip without discarding imported measurements.
  pendingImported=bundle;
}catch(e){showError(e);}}
let pendingImported=null;
async function attachOrChoose(file){const saved=pendingImported;if(saved&&file?.name===saved.summary.video_name){await chooseFile(file);if(selectedFile){bundle=saved;pendingImported=null;renderResults();status('เปิดคลิปพร้อมผลที่บันทึกไว้แล้ว','done');}}else{pendingImported=null;await chooseFile(file);}}
async function exportVideo(){if(!bundle||!selectedUrl||exporting||busy)return;closeExport();clearError();
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime){showError(Error('เบราว์เซอร์นี้ยังบันทึกวิดีโอ WebM ไม่ได้ ดาวน์โหลด ZIP แทนได้'));return;}
  exporting=true;$('cancel').hidden=false;$('cancel').textContent='หยุดบันทึก';video.pause();const old=video.currentTime,canvas=document.createElement('canvas');canvas.width=bundle.width;canvas.height=bundle.height;
  const stream=canvas.captureStream(Math.min(30,bundle.summary.fps)),recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000}),chunks=[];let stopped=false,timer;
  const savedControls=[...document.querySelectorAll('.setup input,.setup select,#choose-button,#analyze,#import-button,#export-button,#play,#seek')].map(el=>[el,el.disabled]);savedControls.forEach(([el])=>el.disabled=true);
  const finish=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||Error('บันทึกวิดีโอไม่สำเร็จ'));});
  try{await seekVideo(video,0);recorder.start(1000);status('กำลังบันทึกวิดีโอ · ใช้เวลาเท่าความยาวคลิป','busy');
    await new Promise((resolve,reject)=>{const ended=()=>{if(stopped)return;stopped=true;clearTimeout(timer);video.removeEventListener('ended',ended);resolve();};
      exportAbort=()=>{stopped=true;clearTimeout(timer);video.removeEventListener('ended',ended);reject(Error('recording_cancelled'));};
      video.addEventListener('ended',ended,{once:true});timer=setTimeout(()=>{if(!stopped){stopped=true;video.removeEventListener('ended',ended);reject(Error('บันทึกวิดีโอใช้เวลานานเกินไป ลองอีกครั้ง'));}},(video.duration+30)*1000);
      const draw=()=>{if(stopped)return;const i=nearestRow(video.currentTime);drawOverlay(bundle.overlays[i],bundle.width,bundle.height,canvas,true);requestAnimationFrame(draw);};draw();video.play().catch(reject);});
    recorder.stop();await finish;download(new Blob(chunks,{type:mime}),safeName()+'_analysed.webm',mime);status('ดาวน์โหลดวิดีโอแล้ว','done');
  }catch(e){if(e.message==='recording_cancelled')status('หยุดบันทึกแล้ว · ผลวิเคราะห์ยังอยู่');else showError(e);}finally{stopped=true;clearTimeout(timer);if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(t=>t.stop());video.pause();video.currentTime=old;exporting=false;exportAbort=null;$('cancel').hidden=true;$('cancel').textContent='ยกเลิก';savedControls.forEach(([el,value])=>el.disabled=value);updatePlayback();}
}

$('choose-button').onclick=()=>$('file-input').click();$('file-input').onchange=e=>{attachOrChoose(e.target.files[0]);e.target.value='';};$('subject').onchange=()=>{if(HEIGHTS[$('subject').value])$('height').value=HEIGHTS[$('subject').value];};$('height').oninput=()=>{$('subject').value='custom';};$('reset-settings').onclick=resetSettings;
$('manifest-button').onclick=()=>$('manifest-input').click();$('manifest-input').onchange=e=>{importManifest(e.target.files[0]);e.target.value='';};
$('analyze').onclick=analyze;$('cancel').onclick=cancel;$('import-button').onclick=()=>$('import-input').click();$('import-input').onchange=e=>{importZip(e.target.files[0]);e.target.value='';};
$('help-button').onclick=()=>{const open=$('help-panel').hidden;$('help-panel').hidden=!open;$('help-button').setAttribute('aria-expanded',open);if(open)$('help-panel').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
$('play').onclick=()=>{if(video.paused)video.play().catch(showError);else video.pause();};$('seek').oninput=()=>{video.currentTime=Number($('seek').value);updatePlayback();};
$('overlay-toggle').onclick=()=>{showOverlay=!showOverlay;$('overlay-toggle').setAttribute('aria-pressed',showOverlay);$('overlay-toggle').setAttribute('aria-label',showOverlay?'ซ่อนเส้นข้อต่อ':'แสดงเส้นข้อต่อ');updatePlayback();};
for(const event of ['timeupdate','seeked','play','pause','ended'])video.addEventListener(event,()=>{updatePlayback();if(event==='play'){const loop=()=>{updatePlayback();if(!video.paused)animation=requestAnimationFrame(loop);};cancelAnimationFrame(animation);animation=requestAnimationFrame(loop);}});
for(const tab of document.querySelectorAll('[role=tab]')){tab.onclick=()=>activateTab(tab.id.slice(4));tab.onkeydown=e=>{const tabs=[...document.querySelectorAll('[role=tab]')],i=tabs.indexOf(tab);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const j=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activateTab(tabs[j].id.slice(4),true);}};}
$('chart-mode').onchange=drawChart;$('chart').onclick=e=>{if(!bundle||busy)return;const rect=$('chart').getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(e.clientX-rect.left-42)/(rect.width-54)));jumpTo(ratio*bundle.frames.at(-1).time_s);};
$('prev-page').onclick=()=>{framePage--;renderFramePage();};$('next-page').onclick=()=>{framePage++;renderFramePage();};$('export-zip').onclick=exportZip;$('export-csv').onclick=()=>{closeExport();if(bundle)download(csv(bundle.frames),safeName()+'_frames.csv','text/csv;charset=utf-8');};$('export-video').onclick=exportVideo;
for(const type of ['dragover','dragenter'])$('dropzone').addEventListener(type,e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('dragging');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragging');if(type==='drop'&&!busy)attachOrChoose(e.dataTransfer.files[0]);});
new ResizeObserver(()=>{if(busy&&lastOverlay)drawOverlay(lastOverlay,decoder.videoWidth,decoder.videoHeight);else updatePlayback();}).observe($('results'));
window.addEventListener('beforeunload',e=>{if(busy||exporting){e.preventDefault();e.returnValue='';}});
// Test harnesses exercise the same visible UI; no hidden result injection API.
