import { createHash } from 'node:crypto';
import { cp, mkdir, copyFile, access, writeFile, readFile } from 'node:fs/promises';
const model='public/models/pose_landmarker_lite.task';
try{await access(model);}catch{
  const response=await fetch('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task');
  if(!response.ok)throw Error('Model download failed: '+response.status);
  await mkdir('public/models',{recursive:true});await writeFile(model,new Uint8Array(await response.arrayBuffer()));
}
if(createHash('sha256').update(await readFile(model)).digest('hex')!=='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a')throw Error('Unexpected model file. Remove public/models/pose_landmarker_lite.task and install again.');
await mkdir('public/runtime', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/runtime/wasm', { recursive: true });
await copyFile('node_modules/@techstark/opencv-js/dist/opencv.js', 'public/runtime/opencv.js');
await copyFile('node_modules/@mediapipe/tasks-vision/vision_bundle.js', 'public/runtime/vision_bundle.js');
await copyFile('src/engine.js', 'public/runtime/engine.js');
await cp('licenses', 'public/licenses', { recursive: true }).catch(e=>{if(e.code!=='ENOENT')throw e;});
await copyFile('THIRD_PARTY_NOTICES.md', 'public/THIRD_PARTY_NOTICES.md').catch(e=>{if(e.code!=='ENOENT')throw e;});
