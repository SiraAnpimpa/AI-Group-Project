// Classic worker: MediaPipe's WASM loader uses importScripts.
let engine, detector, cvReady, smoother, records=[], settings, width, height;
self.onmessage=async({data})=>{
  const {id,type}=data;
  try {
    if(type==='init') {
      engine=await import('./runtime/engine.js');
      settings=data.settings;engine.validateSettings(settings);width=data.width;height=data.height;
      self.postMessage({id,type:'status',message:'กำลังเตรียมตัววิเคราะห์…'});
      importScripts('./runtime/vision_bundle.js','./runtime/opencv.js');
      cvReady=await self.cv;
      if(!cvReady.solvePnP||!cvReady.Rodrigues)throw Error('โหลดชุดคำนวณไม่ครบ กรุณารีเฟรชแล้วลองใหม่');
      const files=await Vision.FilesetResolver.forVisionTasks(new URL('./runtime/wasm',self.location.href).href);
      detector=await Vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./models/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'IMAGE',numPoses:1});
      smoother=new engine.PoseSmoother(width,height,settings.confidence);records=[];
      self.postMessage({id,type:'ready'});
    } else if(type==='frame') {
      let result;try{result=detector.detect(data.bitmap);}finally{data.bitmap.close();}
      const landmarks=result.landmarks?.[0],worlds=result.worldLandmarks?.[0];
      const xy=Array.from({length:33},(_,i)=>landmarks?[landmarks[i].x*width,landmarks[i].y*height]:[NaN,NaN]);
      const world=Array.from({length:33},(_,i)=>worlds?[worlds[i].x,worlds[i].y,worlds[i].z]:[NaN,NaN,NaN]);
      const conf=Array.from({length:33},(_,i)=>landmarks?Math.min(landmarks[i].visibility??0,landmarks[i].presence??1):0);
      const record={...smoother.update(xy,world,conf),time_s:data.time,frame_number:records.length+1};records.push(record);
      self.postMessage({id,type:'frame',xy:record.xy,observed:record.observed});
    } else if(type==='finish') {
      self.postMessage({id,type:'status',message:'กำลังเทียบสเกลและสรุปผล…'});
      const calibration=engine.chooseCalibration(cvReady,records,settings,width,height);
      const counter=new engine.LiftCounter(settings),frames=[],overlays=[];let previous=null;
      for(let i=0;i<records.length;i++) {
        const result=engine.measureFrame(cvReady,records[i],calibration,settings,previous,counter);previous=result.pose;
        frames.push(result.row);overlays.push({xy:records[i].xy,observed:records[i].observed,measurement:result.overlay});
        if(i%150===0)self.postMessage({id,type:'progress',percent:90+9*i/records.length});
      }
      const summary=engine.summarize(frames,counter.events,calibration,settings,data.name);
      const parameters={...settings,DETECTOR_MODE:'IMAGE',COUNT_SIGNAL:'image',app_version:'1.0.0',platform:'web',mediapipe_version:'1.1.0',opencv_version:'5.0.0',source_duration_s:data.duration};
      self.postMessage({id,type:'result',bundle:{summary,frames,events:counter.events,calibration,parameters,overlays,width,height}});
      detector.close();detector=null;records=[];
    }
  }catch(error){self.postMessage({id,type:'error',message:error?.message??String(error)});}
};
