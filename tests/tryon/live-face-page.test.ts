import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { face106, faceFrame, texturedFaceFrame } from "../fixtures/face106";
import type { FaceLayer } from "../../miniprogram/tryon/face-makeup";

const gpu=vi.hoisted(()=>({upload:vi.fn(),draw:vi.fn(),setFaceLayer:vi.fn(),setFaceTransform:vi.fn(),setLayer:vi.fn(),clear:vi.fn(),dispose:vi.fn()}));
vi.mock("../../miniprogram/tryon/live-renderer",()=>({LiveRenderer:class{constructor(){return gpu;}}}));
type PageHarness={data:Record<string,any>;setData(values:object,callback?:()=>void):void;[key:string]:any};
let definition:PageHarness,page:PageHarness,frameCallback:(frame:object)=>void;
const destroy=vi.fn(),stop=vi.fn();
let anchors:unknown[],delay:number,startError:number|null,resultEvent:string;
beforeAll(async()=>{vi.stubGlobal("Page",(value:PageHarness)=>{definition=value;});await import("../../miniprogram/pages/live/index");});
beforeEach(()=>{
  vi.useFakeTimers(); for(const fn of Object.values(gpu))fn.mockReset();destroy.mockReset();stop.mockReset();
  anchors=[face106()];delay=15;startError=null;resultEvent="updateAnchors";
  vi.stubGlobal("wx",{getWindowInfo:()=>({windowWidth:375,windowHeight:724}),authorize:({success}:{success:()=>void})=>success(),
    createCameraContext:()=>({onCameraFrame:(callback:typeof frameCallback)=>{frameCallback=callback;return{start(){},stop};}}),
    createVKSession:()=>{const events:Record<string,(anchors:unknown[])=>void>={};return{on(name:string,callback:(anchors:unknown[])=>void){events[name]=callback;},off(){},start(callback:(e:number|null)=>void){callback(startError);},detectFace(){const callback=events[resultEvent];setTimeout(()=>callback(anchors),delay);},destroy};},
  });
  const canvas={width:256,height:256,getContext:()=>({clearRect(){}})};
  page={...definition,data:structuredClone(definition.data),setData(values,callback){Object.assign(this.data,values);callback?.();},
    createSelectorQuery(){const query={select:()=>query,fields:()=>query,exec:(cb:(items:object[])=>void)=>cb([{node:canvas,width:256}])};return query;}};
  page.onLoad();page.onReady();
});
afterEach(()=>{page.onUnload();vi.useRealTimers();vi.unstubAllGlobals();});
function emit(shift=0){const frame=texturedFaceFrame(160,shift);frameCallback({...frame,data:frame.data.buffer});return frame;}
async function start(){page.onEnableCamera();page.onCameraReady();emit();await vi.advanceTimersByTimeAsync(20);}
const choose=(value:string)=>({currentTarget:{dataset:{value}}});
describe("automatic face page with simulated SDK results",()=>{
  it("starts without A/B calibration, layers colors, and redraws without waiting for a camera frame",async()=>{
    await start();expect(page.data).toMatchObject({trackingMode:"face",phase:"live",devicePosition:"front"});
    gpu.draw.mockClear();page.onCategory(choose("lipstick"));page.onColor(choose("berry"));
    page.onCategory(choose("blush"));page.onColor(choose("peach"));
    expect(page.data.look).toMatchObject({foundation:true,lipstick:true,blush:true});expect(gpu.draw).toHaveBeenCalledTimes(2);
    page.onLayerToggle();expect(page.data.look.blush).toBe(false);expect(page.data.look.lipstick).toBe(true);
    page.onHoldOriginal();expect(gpu.draw.mock.lastCall![0].mode).toBe("original");page.onReleaseOriginal();expect(gpu.draw.mock.lastCall![0].mode).toBe("effect");
    expect(JSON.stringify(page.data)).not.toMatch(/frameBuffer|masks|points|confidence/);
  });
  it("keeps the latest video flowing during delayed inference, then aligns the old mask to it",async()=>{
    delay=330;
    page.onEnableCamera();page.onCameraReady();emit();
    for(let i=1;i<=9;i++){await vi.advanceTimersByTimeAsync(33);emit(i);}
    expect(gpu.upload).toHaveBeenCalledTimes(10);expect(gpu.draw).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(34);expect(page.data.phase).toBe("live");
    expect(gpu.upload).toHaveBeenCalledTimes(10); // Result callbacks must never rewind the video.
    expect(gpu.setFaceTransform.mock.lastCall![0].tx).toBeCloseTo(9,0);
    const latest=emit(10);expect(gpu.upload.mock.lastCall![0].data).toEqual(latest.data);
    expect(page.data.phase).toBe("live");expect(gpu.setFaceTransform.mock.lastCall![0].tx).toBeCloseTo(10,0);
  });
  it("withdraws stale, missing and multiple-face results; a fresh valid result restores makeup",async()=>{
    await start();await vi.advanceTimersByTimeAsync(251);expect(page.data.phase).toBe("view");expect(gpu.setFaceLayer).toHaveBeenLastCalledWith(null);
    anchors=[];emit();await vi.advanceTimersByTimeAsync(20);expect(page.data.phase).toBe("view");
    await vi.advanceTimersByTimeAsync(100);anchors=[face106(),face106()];emit();await vi.advanceTimersByTimeAsync(20);expect(page.data.status).toContain("一张脸");
    await vi.advanceTimersByTimeAsync(100);anchors=[face106()];emit();await vi.advanceTimersByTimeAsync(20);expect(page.data.phase).toBe("live");
    await vi.advanceTimersByTimeAsync(100);delay=950;emit();
    for(let i=0;i<29;i++){await vi.advanceTimersByTimeAsync(33);emit();}
    expect(page.data.phase).toBe("view");expect(page.data.status).toContain("更新定位");
  });
  it("clears temporary masks after upload and ignores late callbacks after hide or mode change",async()=>{
    const held:FaceLayer[]=[];gpu.setFaceLayer.mockImplementation(layer=>{if(layer)held.push(layer);});
    await start();expect(held[0].masks.every(v=>v===0)).toBe(true);
    await vi.advanceTimersByTimeAsync(40);emit();page.onHide();const draws=gpu.draw.mock.calls.length;
    await vi.advanceTimersByTimeAsync(50);expect(gpu.draw).toHaveBeenCalledTimes(draws);expect(destroy).toHaveBeenCalledOnce();expect(page.data.hasFrame).toBe(false);
    page.onShow();await start();page.onTrackingMode(choose("region"));expect(destroy).toHaveBeenCalledTimes(2);expect(page.data.trackingMode).toBe("region");
  });
  it("releases held-original state when tracking is lost so recovery displays the selected makeup",async()=>{
    await start();page.onHoldOriginal();expect(page.data.holdingOriginal).toBe(true);
    await vi.advanceTimersByTimeAsync(251);expect(page.data.holdingOriginal).toBe(false);
    emit();await vi.advanceTimersByTimeAsync(20);expect(page.data.phase).toBe("live");
    expect(gpu.draw.mock.lastCall![0].mode).toBe("effect");
  });
  it("reports unsupported native inference and keeps local selection available",async()=>{
    startError=2000004;await start();expect(page.data.phase).toBe("view");expect(page.data.error).toContain("不支持");
    page.onTrackingMode(choose("region"));page.onCameraReady();emit();page.onFreeze();expect(page.data.phase).toBe("sampleA");expect(page.data.error).toBe("");
  });
  it("recovers in place from a startup failure, receives addAnchors and preserves the chosen colors",async()=>{
    startError=2003000;await start();expect(page.data.error).toContain("2003000");
    page.onCategory(choose("lipstick"));page.onColor(choose("berry"));
    expect(gpu.draw.mock.lastCall![0].mode).toBe("original");
    startError=null;resultEvent="addAnchors";page.onRetryFace();
    expect(page.data.error).toBe("");expect(page.data.phase).toBe("view");expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(40);emit();await vi.advanceTimersByTimeAsync(20);
    expect(page.data.phase).toBe("live");expect(page.data.lipShade).toBe("berry");expect(gpu.draw.mock.lastCall![0].mode).toBe("effect");
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("does not retry a healthy session or restart tracking after the page is hidden",async()=>{
    await start();page.onRetryFace();expect(destroy).not.toHaveBeenCalled();
    page.onHide();const count=gpu.draw.mock.calls.length;page.onRetryFace();
    await vi.advanceTimersByTimeAsync(1000);expect(destroy).toHaveBeenCalledOnce();expect(gpu.draw).toHaveBeenCalledTimes(count);
    expect(page.data.cameraEnabled).toBe(false);
  });
  it("fits a portrait frame beside makeup controls and maps split gestures to its displayed width",async()=>{
    page.onEnableCamera();page.onCameraReady();
    frameCallback({width:240,height:320,data:new Uint8ClampedArray(240*320*4).buffer});
    expect(page.data.canvasHeight).toBeCloseTo(724*.42);
    expect(page.data.canvasWidth/page.data.canvasHeight).toBeCloseTo(240/320);
    page.setData({phase:"live",mode:"split"});
    page.onSplitMove({touches:[{x:page.data.canvasWidth*.75,y:120}]});
    expect(page.data.split).toBe(75);
    page.stopCamera();expect(page.data.canvasWidth).toBe(0);
  });
});
