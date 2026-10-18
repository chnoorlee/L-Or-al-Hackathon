// Actual WebGL execution against the CPU reference, using synthetic pixels only.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.artifacts/live-renderer');
await mkdir(output, { recursive: true });
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--module', 'commonjs', '--target', 'ES2020', '--skipLibCheck', '--types', 'miniprogram-api-typings', '--outDir', resolve(output,'compiled'), resolve(root,'miniprogram/tryon/live-renderer.ts'), resolve(root,'miniprogram/tryon/canvas.ts')], { cwd: root, windowsHide: true, stdio: 'inherit' });
const modules = {};
for (const name of ['core/color','tryon/engine','tryon/polygon-mask','tryon/face-makeup','tryon/live-renderer','tryon/canvas']) modules[name] = await readFile(resolve(output,`compiled/${name}.js`),'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<canvas id="live"></canvas>');
  const report = await page.evaluate(modules => {
    const cache = {};
    const load = name => {
      if (cache[name]) return cache[name];
      const exports = cache[name] = {};
      const require = path => load(path.replace('../core/','core/').replace('./','tryon/'));
      Function('exports','require',modules[name])(exports,require); return exports;
    };
    const {TryOnEngine, DEFAULT_RENDER} = load('tryon/engine'), {srgbToLab} = load('core/color'), {LiveRenderer} = load('tryon/live-renderer'), {withSampleMarkers} = load('tryon/canvas');
    const width=96,height=80,data=new Uint8ClampedArray(width*height*4);
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const selected = Math.hypot(x+.5-32,y+.5-37)<15;
      // Asymmetric texture detects vertical flips and channel mistakes.
      const rgb=selected?[227,198,181]:[158,111,86];
      data.set([...rgb.map(v=>v+Math.round(Math.sin(x*.13+y*.31)*3)),255],(y*width+x)*4);
    }
    const a={x:32/width,y:37/height,radius:.06}, b={x:.8,y:.5,radius:.06};
    const engine=new TryOnEngine({width,height,data},a,b,srgbToLab({r:227,g:198,b:181}),srgbToLab({r:158,g:111,b:86}),{r:158,g:111,b:86});
    engine.segment();
    const canvas=document.querySelector('canvas'), renderer=new LiveRenderer(canvas), gl=canvas.getContext('webgl');
    const read = () => {
      const width=canvas.width,height=canvas.height;
      const raw=new Uint8Array(width*height*4), pixels=new Uint8ClampedArray(raw.length);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);
      for(let y=0;y<height;y++) pixels.set(raw.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);
      return pixels;
    };
    renderer.upload({width,height,data}); renderer.setLayer(engine.layer());
    const cases=[];
    for(const formula of ['sheer','concealer','soft']) for(const mode of ['original','effect','split']) {
      const options={...DEFAULT_RENDER,formula,mode,outline:false,split:47,strength:87,warmth:11,brightness:-3};
      renderer.draw(options); const actual=read(), expected=engine.render(options);
      let maxError=0,changed=0,outsideChanges=0;
      for(let i=0;i<actual.length;i++) {
        maxError=Math.max(maxError,Math.abs(actual[i]-expected[i]));
        if(actual[i]!==data[i]) {changed++; if(!engine.mask[Math.floor(i/4)]) outsideChanges++;}
      }
      cases.push({formula,mode,maxError,changed,outsideChanges,error:gl.getError()});
    }
    renderer.draw({...DEFAULT_RENDER,strength:0,outline:false,mode:'effect'});
    const zeroStrengthExact=read().every((v,i)=>v===data[i]);
    renderer.setLayer(null); renderer.draw({...DEFAULT_RENDER,mode:'effect'});
    const missingMaskExact=read().every((v,i)=>v===data[i]);
    // Calibration must be visible inside the canvas without changing sampled pixels.
    const sampleSource=data.slice(), expectedMarkers=withSampleMarkers(data,width,height,[a,b]);
    renderer.draw({...DEFAULT_RENDER,mode:'original'},[a,b]);
    const marked=read();let markerError=0,markerPixels=0;
    for(let i=0;i<marked.length;i++) {
      markerError=Math.max(markerError,Math.abs(marked[i]-expectedMarkers[i]));
      if(marked[i]!==data[i]) markerPixels++;
    }
    renderer.draw({...DEFAULT_RENDER,mode:'original'});
    const calibrationMarkers={maxError:markerError,changedChannels:markerPixels,
      samplePixelsUnchanged:data.every((v,i)=>v===sampleSource[i]),
      removedExactly:read().every((v,i)=>v===data[i]),error:gl.getError()};
    // The live camera texture is larger than its analysis mask, as on a phone.
    const largeWidth=240,largeHeight=200,largeData=new Uint8ClampedArray(largeWidth*largeHeight*4);
    for(let y=0;y<largeHeight;y++) for(let x=0;x<largeWidth;x++) {
      const from=(Math.floor(y/2.5)*width+Math.floor(x/2.5))*4;
      largeData.set(data.subarray(from,from+4),(y*largeWidth+x)*4);
    }
    renderer.upload({width:largeWidth,height:largeHeight,data:largeData});renderer.setLayer(engine.layer());
    renderer.draw({...DEFAULT_RENDER,mode:'effect',outline:false,strength:0});
    const fullResolutionOriginalExact=read().every((v,i)=>v===largeData[i]);
    renderer.draw({...DEFAULT_RENDER,mode:'effect',outline:false,strength:90});
    const largePixels=read();let largeChanged=0,farOutsideChanges=0;
    for(let y=0;y<largeHeight;y++) for(let x=0;x<largeWidth;x++) {
      const i=(y*largeWidth+x)*4;
      if([0,1,2].some(c=>largePixels[i+c]!==largeData[i+c])) {
        largeChanged++;
        if(Math.hypot((x+.5)/2.5-32,(y+.5)/2.5-37)>17) farOutsideChanges++;
      }
    }
    const mixedResolution={frame:[largeWidth,largeHeight],mask:[width,height],fullResolutionOriginalExact,changedPixels:largeChanged,farOutsideChanges,error:gl.getError()};
    // Independent layer invariants, using a synthetic RGB mask rather than claimed face inference.
    const {DEFAULT_FACE_LOOK}=load('tryon/face-makeup');
    renderer.upload({width,height,data});
    const faceMasks=new Uint8Array(width*height*4);
    for(let y=10;y<70;y++) for(let x=10;x<86;x++) {
      const i=(y*width+x)*4, eye=y>=20&&y<28, lips=y>=48&&y<60&&x>=36&&x<61;
      if(!eye&&!lips) faceMasks[i]=255;
      if(lips&&(y<52||y>=56)) faceMasks[i+1]=255; // mouth interior remains untouched
      if(!eye&&!lips&&y>=34&&y<44&&(x<32||x>64)) faceMasks[i+2]=180;
    }
    renderer.setFaceLayer({width,height,masks:faceMasks,skin:{r:168,g:120,b:94},skinLuminance:.18,lipLuminance:.2});
    const faceCases=[];
    for(const selected of ['foundation','lipstick','blush','all','none']) {
      const look={...DEFAULT_FACE_LOOK,foundation:selected==='foundation'||selected==='all',lipstick:selected==='lipstick'||selected==='all',blush:selected==='blush'||selected==='all'};
      renderer.draw({...DEFAULT_RENDER,mode:'effect',outline:false},[],look);
      const pixels=read();let changed=0,outside=0;
      for(let i=0;i<pixels.length;i+=4) if([0,1,2].some(c=>pixels[i+c]!==data[i+c])) {
        changed++;
        const active=(look.foundation&&faceMasks[i])||(look.lipstick&&faceMasks[i+1])||(look.blush&&faceMasks[i+2]);
        if(!active) outside++;
      }
      faceCases.push({selected,changed,outside,error:gl.getError()});
    }
    const all={...DEFAULT_FACE_LOOK,lipstick:true,blush:true};
    renderer.draw({...DEFAULT_RENDER,mode:'split',split:50},[],all); const faceSplit=read();
    const faceSplitOriginalExact=faceSplit.every((v,i)=>Math.floor(i/4)%width>=width/2||v===data[i]);
    renderer.draw({...DEFAULT_RENDER,mode:'original'},[],all);const faceOriginalExact=read().every((v,i)=>v===data[i]);
    renderer.draw({...DEFAULT_RENDER,mode:'effect',strength:0},[],{...all,lipStrength:0,blushStrength:0});const faceZeroExact=read().every((v,i)=>v===data[i]);
    // Non-square frames expose aspect-ratio errors in inverse rotation/scale UVs.
    const motionCases=[];
    for(const [angle,scale,tx,ty] of [[0,1,7,4],[.08,1.04,3,-2],[-.06,.97,-4,3]]) {
      const a=Math.cos(angle)*scale,b=Math.sin(angle)*scale,d=a*a+b*b;
      renderer.setFaceTransform({a,b,tx,ty,width,height});
      renderer.draw({...DEFAULT_RENDER,mode:'effect',strength:100},[],{...DEFAULT_FACE_LOOK,foundation:true});
      const pixels=read();let changed=0,outside=0,protectedPixels=0;
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const mx=(a*(x+.5-tx)+b*(y+.5-ty))/d-.5, my=(-b*(x+.5-tx)+a*(y+.5-ty))/d-.5;
        let covered=false;
        for(const yy of [Math.floor(my),Math.ceil(my)]) for(const xx of [Math.floor(mx),Math.ceil(mx)])
          if(xx>=0&&xx<width&&yy>=0&&yy<height&&faceMasks[(yy*width+xx)*4]) covered=true;
        const i=(y*width+x)*4, differs=[0,1,2].some(c=>pixels[i+c]!==data[i+c]);
        if(differs) {changed++;if(!covered)outside++;} else if(!covered) protectedPixels++;
      }
      motionCases.push({angle,scale,tx,ty,changed,outside,protectedPixels,error:gl.getError()});
    }
    renderer.setFaceTransform({a:1,b:0,tx:width*2,ty:0,width,height});
    renderer.draw({...DEFAULT_RENDER,mode:'effect'},[],all);const movedOffscreenExact=read().every((v,i)=>v===data[i]);
    // Video uploads keep advancing while the same moving mask stays installed.
    const updatedData=data.map((v,i)=>i%4===3?v:Math.min(255,v+7));
    renderer.upload({width,height,data:updatedData});renderer.draw({...DEFAULT_RENDER,mode:'original'},[],all);
    const currentVideoExact=read().every((v,i)=>v===updatedData[i]);
    renderer.upload({width,height,data});
    renderer.setFaceLayer(null);renderer.draw({...DEFAULT_RENDER,mode:'effect'},[],all);const faceLostExact=read().every((v,i)=>v===data[i]);
    const faceLayers={cases:faceCases,motionCases,movedOffscreenExact,currentVideoExact,faceSplitOriginalExact,faceOriginalExact,faceZeroExact,faceLostExact};
    renderer.clear(); const cleared=read().every((v,i)=>i%4===3||v===0);
    renderer.dispose();engine.dispose();
    return {environment:'Desktop Edge WebGL; synthetic RGB fixture',realPhoneValidated:false,cases,zeroStrengthExact,missingMaskExact,calibrationMarkers,mixedResolution,faceLayers,cleared};
  }, modules);
  report.passed = report.cases.every(c=>c.maxError<=1 && c.outsideChanges===0 && c.error===0 && (c.mode==='original'||c.changed>0)) && report.zeroStrengthExact && report.missingMaskExact && report.calibrationMarkers.maxError<=1 && report.calibrationMarkers.changedChannels>0 && report.calibrationMarkers.samplePixelsUnchanged && report.calibrationMarkers.removedExactly && report.calibrationMarkers.error===0 && report.mixedResolution.fullResolutionOriginalExact && report.mixedResolution.changedPixels>0 && report.mixedResolution.farOutsideChanges===0 && report.mixedResolution.error===0 && report.cleared;
  report.passed &&= report.faceLayers.cases.every(c=>c.outside===0 && c.error===0 && (c.selected==='none'?c.changed===0:c.changed>0)) && ['faceSplitOriginalExact','faceOriginalExact','faceZeroExact','faceLostExact'].every(k=>report.faceLayers[k]);
  report.passed &&= report.faceLayers.motionCases.every(c=>c.outside===0 && c.changed>0 && c.protectedPixels>0 && c.error===0) && report.faceLayers.movedOffscreenExact && report.faceLayers.currentVideoExact;
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  assert.ok(report.passed,'GPU differs from CPU reference or failed cleanup');
} finally { await browser.close(); }
