import test from 'node:test';
import assert from 'node:assert/strict';
import cvPromise from '@techstark/opencv-js';
import { DEFAULTS, LiftCounter, validateSettings, solvePose, extraAngles } from '../src/engine.js';

test('a held high position counts once until the hand returns',()=>{
  const counter=new LiftCounter(DEFAULTS);
  for(let i=0;i<90;i++)counter.update(i/30,i<10?0:40,true);
  assert.equal(counter.count,1);assert.equal(counter.events[0].lift_number,1);
  for(let i=90;i<110;i++)counter.update(i/30,0,true);
  for(let i=110;i<140;i++)counter.update(i/30,40,true);
  assert.equal(counter.count,2);assert.ok(Number.isFinite(counter.events[0].return_s));
});
test('unconfirmed hand motion and brief spikes do not count',()=>{
  const counter=new LiftCounter(DEFAULTS);
  for(let i=0;i<60;i++)counter.update(i/30,i<10?0:40,false);
  assert.equal(counter.count,0);
  const spike=new LiftCounter(DEFAULTS);
  for(let i=0;i<100;i++)spike.update(i/30,i===20?45:0,true);
  assert.equal(spike.count,0);
});
test('long gaps clear motion evidence and timestamps must increase',()=>{
  const counter=new LiftCounter(DEFAULTS);
  counter.update(0,0);counter.update(.1,30);counter.update(1,NaN);counter.update(2,40);
  assert.equal(counter.count,0);assert.equal(counter.state,'SEEK_LOW');
  assert.throws(()=>counter.update(2,0),/เวลา/);
});
test('actual-count comparison is not an input to the counter',()=>{
  const a=new LiftCounter({...DEFAULTS,expected:3}),b=new LiftCounter({...DEFAULTS,expected:999});
  for(let i=0;i<300;i++){const signal=Math.floor(i/30)%2?40:0;a.update(i/30,signal);b.update(i/30,signal);}
  assert.equal(a.count,5);assert.deepEqual(a.events,b.events);
});
test('settings reject missing, non-finite and out-of-range values',()=>{
  validateSettings({...DEFAULTS,height:180});
  for(const settings of [{...DEFAULTS},{...DEFAULTS,height:0},{...DEFAULTS,height:NaN},{...DEFAULTS,height:180,excursion:0},{...DEFAULTS,height:180,calibSeconds:31}])assert.throws(()=>validateSettings(settings));
});
test('PnP recovers a known perspective camera with independent 3D points',async()=>{
  const cv=await cvPromise,K={f:800,cx:480,cy:270};
  const P=Array.from({length:33},(_,i)=>[(i%4)*12-18,Math.floor(i/4)*9-30,((i*7)%5)*4]);
  const xy=P.map(p=>[K.f*(p[0]+10)/(p[2]+400)+K.cx,K.f*(p[1]-20)/(p[2]+400)+K.cy]);
  const pose=solvePose(cv,P,xy,Array(33).fill(true),K);
  assert.ok(pose);assert.ok(pose.reprojection_px<1e-5);
  assert.ok(Math.abs(pose.t[2]-400)<.001);
  assert.equal(solvePose(cv,P,xy,Array(33).fill(false),K),null);
});
test('straight joints and upright trunk have known geometric angles',()=>{
  const world=Array.from({length:33},()=>[0,0,0]);
  for(const i of [11,12])world[i]=[i===11?-1:1,-2,0];
  world[23]=[-1,0,0];world[24]=[1,0,0];world[25]=[-1,1,0];world[26]=[1,1,0];
  for(const i of [27,29,31])world[i]=[-1,2,0];for(const i of [28,30,32])world[i]=[1,2,0];
  const a=extraAngles(world);assert.equal(a.trunk_bend_deg,0);assert.equal(a.left_knee_deg,180);assert.equal(a.right_knee_deg,180);
});
test('separate return threshold avoids merging two controlled lifts',()=>{
  const c=new LiftCounter(DEFAULTS);
  for(let i=0;i<120;i++){const value=i<15?0:i<45?40:i<75?21:45;c.update(i/30,value);}
  assert.equal(c.count,2);
});
