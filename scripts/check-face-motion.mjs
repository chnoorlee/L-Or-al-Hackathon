// Reproducible desktop cost check. This is not iPhone frame-rate evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'.artifacts/face-motion');
await mkdir(output,{recursive:true});
execFileSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--module','commonjs','--target','ES2020','--skipLibCheck','--types','miniprogram-api-typings','--outDir',resolve(output,'compiled'),resolve(root,'miniprogram/tryon/face-motion.ts'),resolve(root,'tests/fixtures/face106.ts')],{cwd:root,windowsHide:true});
const motion={},fixture={};
Function('exports',await readFile(resolve(output,'compiled/miniprogram/tryon/face-motion.js'),'utf8'))(motion);
Function('exports',await readFile(resolve(output,'compiled/tests/fixtures/face106.js'),'utf8'))(fixture);
const {FaceMotionTracker}=motion;
const {face106,texturedFaceFrame}=fixture;
const anchor=face106(),frames=Array.from({length:11},(_,i)=>texturedFaceFrame(160,i,i/2));
const framesMs=[],delayedAlignmentMs=[];
for(let repetition=0;repetition<60;repetition++) {
  const tracker=new FaceMotionTracker();tracker.push(frames[0],1000);tracker.seed(anchor,1000,1010);
  for(let i=1;i<frames.length;i++) {
    const before=performance.now(),result=tracker.push(frames[i],1000+i*33),elapsed=performance.now()-before;
    assert.ok(result);if(repetition>=10)framesMs.push(elapsed);
  }
  tracker.dispose();
  for(let i=0;i<frames.length;i++)tracker.push(frames[i],1000+i*33);
  const before=performance.now(),aligned=tracker.seed(anchor,1000,1330),elapsed=performance.now()-before;
  assert.ok(aligned&&Math.abs(aligned.tx-10)<.6&&Math.abs(aligned.ty-5)<.6);
  if(repetition>=10)delayedAlignmentMs.push(elapsed);tracker.dispose();
}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{samples:sorted.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)};};
const report={createdAt:new Date().toISOString(),environment:`Windows desktop Node ${process.version}`,fixture:'synthetic 160x160 textured translation; no native detector, camera or GPU',realPhoneValidated:false,passed:true,frameTracking:stats(framesMs),align330msDelayedResult:stats(delayedAlignmentMs),raw:{framesMs,delayedAlignmentMs}};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
const {raw,...summary}=report;console.log(JSON.stringify(summary,null,2));
