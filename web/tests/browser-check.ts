// Development-only integration checks. This module is never imported by the production entrypoint.
// The caller supplies an image already loaded in the local app; no image or landmarks leave this browser.
import { MakeupRenderer } from '../src/renderer';
import { MaskAtlas, LandmarkFilter, sampleSkin, validFace } from '../src/geometry';
import { TryOnEngine } from '../src/engine';
import { CATEGORIES, sanitizeLook, type Finish, type Look, type Point, type Product } from '../src/types';
import catalog from '../src/data/catalog.json';

export async function runBrowserChecks(source: HTMLCanvasElement) {
  const checks: {name:string;pass:boolean;detail?:unknown}[]=[];
  const check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});};
  const products:Product[]=catalog.products;
  const canvas=document.createElement('canvas'),renderer=new MakeupRenderer(canvas,()=>{});
  const worker=new Worker('/face-worker.js');
  let token=0;
  const message=(data:unknown,transfer:Transferable[]=[])=>new Promise<any>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Real model timeout')),45000);
    worker.onmessage=e=>{if(e.data.type==='loading')return;clearTimeout(timeout);e.data.type==='error'?reject(new Error(e.data.message)):resolve(e.data);};
    worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};worker.postMessage(data,transfer);
  });
  const detect=async(image:CanvasImageSource,photo=true)=>{
    const bitmap=await createImageBitmap(image,{resizeWidth:480,resizeHeight:640});
    return message({type:'detect',bitmap,photo,timestamp:performance.now(),token:++token},[bitmap]);
  };
  const copy=()=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d',{willReadFrequently:true})!;x.drawImage(canvas,0,0);return x.getImageData(0,0,c.width,c.height).data;};
  const original=document.createElement('canvas');original.width=480;original.height=640;original.getContext('2d')!.drawImage(source,0,0,480,640);
  let realPoints:Point[]=[];
  try {
    const start=performance.now(),ready=await message({type:'init'});
    check('real-worker-initialization',ready.type==='ready',{backend:ready.backend,milliseconds:Math.round(performance.now()-start)});
    const result=await detect(original);realPoints=result.points;
    check('real-photo-landmarks',validFace(realPoints),{count:realPoints.length,duration:result.duration});
    if(!validFace(realPoints))return {checks,passed:false};
    const skin=sampleSkin(original,realPoints);if(skin)renderer.setSkin(skin);
    renderer.updateMask(realPoints);renderer.setLook({},products);renderer.draw(original,480,640,1,-1,false,false);const base=copy();
    const mean=(pixels:Uint8ClampedArray,region:(x:number,y:number)=>boolean)=>{let sum=0,n=0;for(let y=0;y<640;y++)for(let x=0;x<480;x++){if(!region(x,y))continue;const i=(y*480+x)*4;sum+=Math.abs(pixels[i]-base[i])+Math.abs(pixels[i+1]-base[i+1])+Math.abs(pixels[i+2]-base[i+2]);n+=3;}return sum/Math.max(n,1);};
    const lip=products.find(p=>p.category==='lipstick'&&p.name.includes('Satin'))!,shade=lip.shades.find(s=>s.name.startsWith('300'))!;
    const look:Look={lipstick:{productId:lip.id,shadeId:shade.id,strength:90,finish:'satin'}};
    renderer.setLook(look,products);renderer.draw(original,480,640,1,-1,false,false);const lips=copy();
    const center=realPoints[0],bottom=realPoints[17],halfWidth=Math.abs(realPoints[61].x-realPoints[291].x)/2;
    const lipBox=(x:number,y:number)=>Math.abs(x/480-center.x)<halfWidth*1.2&&y/640>center.y-.01&&y/640<bottom.y+.01;
    const lipDelta=mean(lips,lipBox),outsideDelta=mean(lips,(x,y)=>!lipBox(x,y));
    check('lip-color-visible-and-localized',lipDelta>3&&outsideDelta<.2,{lipDelta,outsideDelta});
    renderer.draw(original,480,640,1,.5,false,false);const split=copy();
    check('split-left-is-original',mean(split,(x)=>x<238)<.1);
    renderer.draw(original,480,640,1,.5,false,true);const mirrored=copy();
    check('mirrored-split-right-source-is-original',mean(mirrored,(x)=>x>242)<.1);
    renderer.draw(original,480,640,1,-1,true,false);check('hold-original-clears-all-color',mean(copy(),()=>true)<.1);
    renderer.setLook({},products);renderer.draw(original,480,640,1,-1,false,false);check('remove-layer-restores-image',mean(copy(),()=>true)<.1);
    const atlas=new MaskAtlas();atlas.update(realPoints);const ax=atlas.canvas.getContext('2d')!;
    const alpha=(layer:number,x:number,y:number)=>ax.getImageData((layer%4)*256+Math.min(255,Math.max(0,Math.round(x*256))),Math.floor(layer/4)*256+Math.min(255,Math.max(0,Math.round(y*256))),1,1).data[3];
    const eye=realPoints[468],nose=realPoints[4],mouth={x:(realPoints[13].x+realPoints[14].x)/2,y:(realPoints[13].y+realPoints[14].y)/2};
    check('foundation-excludes-eyes-nose-mouth',alpha(0,eye.x,eye.y)===0&&alpha(0,nose.x,nose.y)===0&&alpha(0,mouth.x,mouth.y)===0);
    // Force an open mouth in the measured geometry; the inner opening must stay transparent.
    const open=realPoints.map(p=>({...p}));[14,87,178,88,95,317,402,318,324].forEach(i=>open[i].y+=.02);[17,84,181,91,146,314,405,321,375].forEach(i=>open[i].y+=.03);
    atlas.update(open);check('open-mouth-not-painted',alpha(5,mouth.x,mouth.y+.01)===0);atlas.update(realPoints);
    const nonempty=CATEGORIES.filter(([c])=>c!=='hair').map((c,i)=>{const data=ax.getImageData((i%4)*256,Math.floor(i/4)*256,256,256).data;let n=0;for(let k=3;k<data.length;k+=4)if(data[k]>8)n++;return {category:c[0],pixels:n};});
    check('all-eleven-regions-have-masks',nonempty.every(x=>x.pixels>0),nonempty);
    const foundation=products.find(p=>p.category==='foundation')!;
    const finishPixels=(['matte','satin','gloss','shimmer'] as Finish[]).map(finish=>{
      renderer.setLook({foundation:{productId:foundation.id,shadeId:foundation.shades[0].id,strength:65,finish}},products);
      renderer.draw(original,480,640,1,-1,false,false);return copy();
    });
    const finishDifferences=finishPixels.slice(1).map((pixels,index)=>pixels.reduce((count,value,i)=>count+(value!==finishPixels[index][i]?1:0),0));
    check('four-finishes-produce-distinct-pixels',finishDifferences.every(count=>count>100),finishDifferences);
    const stacked:Look={};CATEGORIES.forEach(([category])=>{const p=products.find(p=>p.category===category)!;stacked[category]={productId:p.id,shadeId:p.shades[0].id,strength:65,finish:'satin'};});
    renderer.setLook(stacked,products);renderer.draw(original,480,640,1,-1,false,false);
    check('multi-product-compositing-visible',mean(copy(),()=>true)>.5);
    check('webgl-no-errors',canvas.getContext('webgl')!.getError()===0);
    const frames: {dx:number;detected:boolean;error?:number;duration:number}[]=[];
    for(const dx of [-.06,0,.06]){
      const moved=document.createElement('canvas');moved.width=480;moved.height=640;const c=moved.getContext('2d')!;c.fillStyle='#888';c.fillRect(0,0,480,640);c.drawImage(original,dx*480,0);
      const r=await detect(moved,false);const ok=validFace(r.points);frames.push({dx,detected:ok,error:ok?Math.abs(r.points[1].x-realPoints[1].x-dx):undefined,duration:r.duration});
    }
    check('real-model-tracks-translated-portrait',frames.every(f=>f.detected&&f.error!<.035),frames);
    const blank=document.createElement('canvas');blank.width=480;blank.height=640;
    const missing=await detect(blank);check('blank-frame-has-no-face',missing.points.length===0);
    const filtered=new LandmarkFilter();filtered.update(realPoints,1);const afterGap=filtered.update(realPoints.map(p=>({...p,x:p.x+.1})),600);check('tracking-gap-does-not-retain-old-position',Math.abs(afterGap[1].x-realPoints[1].x-.1)<1e-6);
    check('saved-look-rejects-invalid-shade-and-category',Object.keys(sanitizeLook({foundation:look.lipstick,lipstick:{...look.lipstick,shadeId:'not-a-product'}},products)).length===0);
  } finally {worker.terminate();renderer.destroy();}
  return {checks,passed:checks.every(c=>c.pass),kind:'real-model-on-user-provided-photo-and-synthetic-translation',phoneValidated:false};
}

export async function runHairChecks(source:HTMLCanvasElement){
  const checks:{name:string;pass:boolean;detail?:unknown}[]=[];
  const check=(name:string,pass:boolean,detail?:unknown)=>checks.push({name,pass,detail});
  const worker=new Worker('/hair-worker.js'),canvas=document.createElement('canvas'),renderer=new MakeupRenderer(canvas,()=>{});
  const message=(data:unknown,transfer:Transferable[]=[])=>new Promise<any>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Hair model timeout')),45000);
    worker.onmessage=e=>{if(e.data.type==='loading')return;clearTimeout(timeout);e.data.type==='error'?reject(new Error(e.data.message)):resolve(e.data);};
    worker.onerror=e=>{clearTimeout(timeout);reject(new Error(e.message));};worker.postMessage(data,transfer);
  });
  const segment=async(image:HTMLCanvasElement,photo:boolean)=>{const bitmap=await createImageBitmap(image);return message({type:'detect',bitmap,photo,timestamp:performance.now(),token:1},[bitmap]);};
  const pixels=()=>{const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d')!;ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
  const centroid=(r:any)=>{let x=0,n=0;for(let i=0;i<r.alpha.length;i++)if(r.alpha[i]>128){x+=(i%r.width)/r.width;n++;}return x/Math.max(1,n);};
  try{
    const ready=await message({type:'init'});check('real-hair-worker-initialization',ready.type==='ready',{backend:ready.backend});
    const mask=await segment(source,true);check('hair-model-finds-hair',mask.count>100,{width:mask.width,height:mask.height,pixels:mask.count});
    renderer.setLook({},catalog.products);renderer.draw(source,source.width,source.height,0,-1,false,false);const base=pixels();
    const product=catalog.products.find(p=>p.category==='hair')!,shade=product.shades.find(s=>parseInt(s.hex.slice(1,3),16)>150)||product.shades[0];
    renderer.updateHairMask(mask.alpha,mask.width,mask.height);renderer.setLook({hair:{productId:product.id,shadeId:shade.id,strength:95,finish:'satin'}},catalog.products);
    renderer.draw(source,source.width,source.height,0,-1,false,false,1);const colored=pixels();let inside=0,ni=0,outside=0,no=0;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const a=mask.alpha[Math.min(mask.height-1,Math.floor(y/source.height*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(x/source.width*mask.width))],i=(y*source.width+x)*4;
      const d=(Math.abs(colored[i]-base[i])+Math.abs(colored[i+1]-base[i+1])+Math.abs(colored[i+2]-base[i+2]))/3;
      if(a>200){inside+=d;ni++;}if(a===0){outside+=d;no++;}
    }
    check('hair-color-visible-with-background-preserved',inside/ni>3&&outside/no<.5,{hairDelta:inside/ni,backgroundDelta:outside/no});
    renderer.draw(source,source.width,source.height,0,-1,false,false,0);const hidden=pixels();
    check('expired-hair-mask-removes-color',hidden.every((v,i)=>v===base[i]));
    const moved=document.createElement('canvas');moved.width=source.width;moved.height=source.height;const c=moved.getContext('2d')!;c.fillStyle='#888';c.fillRect(0,0,moved.width,moved.height);c.drawImage(source,.06*source.width,0);
    const next=await segment(moved,false),dx=centroid(next)-centroid(mask);check('hair-follows-translated-video-frame',next.count>100&&Math.abs(dx-.06)<.035,{dx});
    const blank=document.createElement('canvas');blank.width=480;blank.height=640;blank.getContext('2d')!.fillStyle='#888';blank.getContext('2d')!.fillRect(0,0,480,640);
    const empty=await segment(blank,false);check('blank-frame-has-no-hair',empty.count===0,{count:empty.count});
    check('hair-webgl-no-errors',canvas.getContext('webgl')!.getError()===0);
  }finally{worker.terminate();renderer.destroy();}
  return {checks,passed:checks.every(c=>c.pass),kind:'real-hair-model-on-user-photo-and-synthetic-translation',phoneValidated:false};
}

export async function runCameraChecks(source:HTMLCanvasElement){
  const checks:{name:string;pass:boolean;detail?:unknown}[]=[];
  const camera=document.createElement('canvas');camera.width=480;camera.height=640;
  const c=camera.getContext('2d')!;let t=0,drawLoop=0;
  const draw=()=>{t++;c.fillStyle='#888';c.fillRect(0,0,480,640);c.drawImage(source,Math.sin(t/30)*20,0,480,640);c.fillStyle=`rgb(${t%256},${255-t%256},80)`;c.fillRect(0,0,30,30);drawLoop=requestAnimationFrame(draw);};draw();
  const stream=camera.captureStream(30),video=document.createElement('video'),output=document.createElement('canvas');
  video.muted=true;video.playsInline=true;
  // A detached video can advance currentTime without presenting new decoded frames.
  // Match the production page by keeping the media element attached and visible.
  const fixture=document.createElement('div');fixture.style.cssText='position:fixed;inset:0;z-index:100;background:#fff;display:flex;align-items:flex-start;pointer-events:none';
  video.style.cssText=output.style.cssText='width:48%;height:auto;max-height:80vh;object-fit:contain';fixture.append(video,output);document.body.append(fixture);
  const getUserMedia=navigator.mediaDevices.getUserMedia,OriginalWorker=window.Worker;
  let suppress=false;const statuses:{state:string;text:string}[]=[];
  const check=(name:string,pass:boolean,detail?:unknown)=>checks.push({name,pass,detail});
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  navigator.mediaDevices.getUserMedia=async()=>stream;
  // Deliberately lose worker replies after real tracking starts: the camera must not freeze.
  window.Worker=class extends OriginalWorker{constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',e=>{if(suppress&&e.data.type==='result')e.stopImmediatePropagation();});}};
  const engine=new TryOnEngine(video,output,s=>statuses.push(s),()=>{});
  try {
    const p=catalog.products.find(p=>p.category==='lipstick')!;engine.setLook({lipstick:{productId:p.id,shadeId:p.shades[0].id,strength:85,finish:'satin'}},catalog.products);
    await engine.startCamera();const deadline=performance.now()+40000;
    while(!statuses.some(s=>s.state==='tracking')&&performance.now()<deadline&&!statuses.some(s=>s.state==='error'))await wait(100);
    check('camera-stream-reaches-real-tracking',statuses.some(s=>s.state==='tracking'),statuses);
    const before=video.currentTime;await wait(600);check('video-keeps-advancing-during-tracking',video.currentTime>before+.2);
    suppress=true;await wait(3000);
    const stalledAt=video.currentTime;await wait(400);
    check('video-keeps-advancing-after-inference-timeout',video.currentTime>stalledAt+.1,{from:stalledAt,to:video.currentTime});
    check('timeout-reports-error',statuses.some(s=>s.state==='error'&&s.text.includes('超时')));
    const g=output.getContext('webgl')!,pixels=new Uint8Array(4),probe=document.createElement('canvas');probe.width=480;probe.height=640;const px=probe.getContext('2d')!;
    const sample=()=>{g.readPixels(10,output.height-10,1,1,g.RGBA,g.UNSIGNED_BYTE,pixels);px.drawImage(video,0,0,480,640);return {render:[...pixels],video:[...px.getImageData(10,10,1,1).data],source:[...c.getImageData(10,10,1,1).data],t,hidden:output.hidden};};
    const first=sample(),refreshDeadline=performance.now()+6000;
    // The embedded test browser may throttle rAF. Wait for new source frames,
    // rather than treating two reads of the same source frame as a renderer stall.
    while(t<first.t+4&&performance.now()<refreshDeadline)await wait(100);
    const second=sample();
    check('render-keeps-changing-after-timeout',g.getError()===0&&first.render[3]===255&&second.render[3]===255&&Math.abs(first.render[0]-second.render[0])>2,{from:first,to:second});
    engine.pause();check('close-stops-every-camera-track',stream.getTracks().every(t=>t.readyState==='ended'));
  } finally {engine.destroy();cancelAnimationFrame(drawLoop);stream.getTracks().forEach(t=>t.stop());fixture.remove();navigator.mediaDevices.getUserMedia=getUserMedia;window.Worker=OriginalWorker;}
  return {checks,passed:checks.every(c=>c.pass),kind:'generated-camera-stream-real-model-plus-injected-worker-timeout',phoneValidated:false};
}
