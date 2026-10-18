import { MakeupRenderer } from './renderer';
import { HairTracker } from './hair';
import { LandmarkFilter, sampleSkin, validFace } from './geometry';
import type { Look, Point, Product } from './types';

export interface EngineStatus { state: 'idle'|'loading'|'tracking'|'searching'|'error'|'paused'; text: string; latency?: number; backend?: string }
export class TryOnEngine {
  private worker?: Worker;
  private ready = false;
  private busy = false;
  private busyAt = 0;
  private initAt = 0;
  private epoch = 0;
  private stream?: MediaStream;
  private photo?: ImageBitmap;
  private frame = 0;
  private lastCapture = 0;
  private lastResult = 0;
  private lastVideoTime = -1;
  private dirty = true;
  private points: Point[] = [];
  private filter = new LandmarkFilter();
  private renderer: MakeupRenderer;
  private hair: HairTracker;
  private backend = '';
  private lastStatus = '';
  private facing: 'user'|'environment' = 'user';
  private mirror = true;
  private split = -1;
  private original = false;
  private mode: 'idle'|'camera'|'photo' = 'idle';
  private skinAt = 0;
  private latency = 0;
  private warmed = false;
  private renderFailed = false;
  constructor(readonly video: HTMLVideoElement, readonly canvas: HTMLCanvasElement,
    private onStatus: (s:EngineStatus)=>void, private onMode: (mode:string, mirror:boolean)=>void,
    onHairStatus: (text:string)=>void = ()=>{}) {
    this.renderer = new MakeupRenderer(canvas,()=>{this.renderFailed=true;this.canvas.hidden=true;this.fail('图形渲染已暂停，请刷新页面恢复；相机原画仍可查看');});
    this.hair = new HairTracker((alpha,width,height)=>{this.renderer.updateHairMask(alpha,width,height);this.dirty=true;},onHairStatus);
    this.tick = this.tick.bind(this);
  }
  private status(state:EngineStatus['state'],text:string){
    if(this.lastStatus===`${state}:${text}`)return;
    this.lastStatus=`${state}:${text}`;this.onStatus({state,text,latency:this.latency,backend:this.backend});
  }
  private init(){
    if(this.worker)return;
    this.warmed=false;this.initAt=performance.now();this.status('loading','正在准备试妆，镜头可正常移动…');
    const worker=this.worker=new Worker(`${import.meta.env.BASE_URL}face-worker.js`);
    worker.onerror=()=>{if(worker===this.worker)this.fail('试妆模型未能加载。请检查网络后重试');};
    worker.onmessage=({data})=>{
      if(worker!==this.worker)return;
      if(data.type==='loading'){this.status('loading',String(data.text));return;}
      if(data.type==='ready'){this.ready=true;this.backend=data.backend;this.status('searching','请让一张脸完整入镜');if(this.photo)void this.detect(true);return;}
      this.busy=false;
      if(data.type==='error'&&data.token===undefined){this.fail(`模型启动失败，请重试。${String(data.message).slice(0,100)}`);return;}
      if(data.token!==this.epoch){if(this.mode==='photo'&&this.ready)void this.detect(true);return;}
      if(data.type==='error'){this.fail(`定位失败，请重新开启试妆。${String(data.message).slice(0,100)}`);return;}
      if(data.type!=='result')return;
      this.warmed=true;
      const now=performance.now();this.latency=now-data.timestamp;
      if(this.mode!=='photo'&&this.latency>350){this.clearMask();this.status('searching','定位处理较慢，暂时显示原画');return;}
      if(validFace(data.points)){
        this.points=this.mode==='photo'?data.points:this.filter.update(data.points,data.timestamp);
        this.renderer.updateMask(this.points);this.lastResult=now;this.dirty=true;this.canvas.hidden=false;
        if(now-this.skinAt>1200||this.mode==='photo'){const skin=sampleSkin(this.source!,this.points);if(skin)this.renderer.setSkin(skin);this.skinAt=now;}
        this.status('tracking',this.mode==='photo'?'照片已定位 · 选择商品开始试色':'已跟随面部 · 换色即时生效');
      }else{this.clearMask();this.status('searching',this.mode==='photo'?'没有找到完整人脸，请换一张清晰正面照片':'请让一张脸完整入镜');}
    };
    worker.postMessage({type:'init'});
  }
  private clearMask(){this.points=[];this.lastResult=0;this.filter.reset();this.renderer.updateMask([]);this.dirty=true;}
  private fail(message:string){this.worker?.terminate();this.worker=undefined;this.ready=false;this.busy=false;this.clearMask();this.status('error',message);}
  private get source():HTMLVideoElement|ImageBitmap|undefined{return this.mode==='photo'?this.photo:this.mode==='camera'&&this.video.readyState>=2?this.video:undefined;}
  private async detect(photo=false){
    const source=this.source;
    if(!source||!this.ready||this.busy||!this.worker)return;
    this.busy=true;const epoch=this.epoch,worker=this.worker;const timestamp=performance.now();this.busyAt=timestamp;this.lastCapture=timestamp;
    try{
      const width=source instanceof HTMLVideoElement?source.videoWidth:source.width,height=source instanceof HTMLVideoElement?source.videoHeight:source.height;
      const ratio=Math.min(1,640/Math.max(width,height));
      const bitmap=await createImageBitmap(source,{resizeWidth:Math.max(1,Math.round(width*ratio)),resizeHeight:Math.max(1,Math.round(height*ratio))});
      if(worker!==this.worker){bitmap.close();return;}
      if(epoch!==this.epoch){bitmap.close();this.busy=false;if(this.mode==='photo'&&this.ready)void this.detect(true);return;}
      worker.postMessage({type:'detect',token:epoch,timestamp,photo,bitmap},[bitmap]);
    }catch(e){if(worker!==this.worker)return;this.busy=false;if(epoch!==this.epoch){if(this.mode==='photo'&&this.ready)void this.detect(true);return;}this.fail(`无法读取画面，请重试。${e instanceof Error?e.message:''}`);}
  }
  private tick(now:number){
    this.frame=requestAnimationFrame(this.tick);
    if(this.mode==='idle')return;
    // Includes the first network download; inference retains its short, separate watchdog.
    if(this.worker&&!this.ready&&now-this.initAt>180000)this.fail('模型下载或启动超时，请检查网络后重试');
    if(this.busy&&now-this.busyAt>(this.warmed?2500:15000))this.fail('定位响应超时，已恢复原画；请重试');
    const source=this.source;if(!source)return;
    this.hair.step(source,this.mode==='photo',now);
    if(this.mode==='camera'&&this.video.currentTime!==this.lastVideoTime){this.dirty=true;this.lastVideoTime=this.video.currentTime;}
    if(this.mode==='camera'&&now-this.lastCapture>=33)void this.detect();
    const age=now-this.lastResult;
    const visibility=this.points.length?(this.mode==='photo'?1:Math.max(0,Math.min(1,(350-age)/150))):0;
    if(this.mode==='camera'&&age>350&&this.points.length){this.clearMask();this.status('searching','正在重新定位 · 镜头保持实时');}
    if(!this.dirty||this.renderFailed)return;
    this.dirty=false;
    const width=source instanceof HTMLVideoElement?source.videoWidth:source.width,height=source instanceof HTMLVideoElement?source.videoHeight:source.height;
    try{this.renderer.draw(source,width,height,visibility,this.split,this.original,this.mirror,this.hair.visibility(now,this.mode==='photo'));}catch{this.renderFailed=true;this.canvas.hidden=true;this.fail('妆效渲染失败，请刷新页面；相机原画仍可查看');}
  }
  private begin(){if(!this.frame)this.frame=requestAnimationFrame(this.tick);this.init();}
  async startCamera(){
    this.stopSource();const epoch=this.epoch;
    if(!window.isSecureContext){this.status('error','相机需要 HTTPS 安全链接。电脑可用 localhost，手机请用 HTTPS 地址打开');return;}
    if(!navigator.mediaDevices?.getUserMedia){this.status('error','此浏览器不支持相机，请在 Safari 或 Chrome 中打开');return;}
    this.status('loading','请允许使用相机');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:this.facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.video.srcObject=stream;this.mode='camera';this.mirror=this.facing==='user';
      this.onMode(this.mode,this.mirror);await this.video.play();
      if(epoch!==this.epoch)return;
      stream.getVideoTracks()[0].addEventListener('ended',()=>{if(this.stream===stream){this.stopSource();this.status('paused','相机已断开，请重新打开');}});
      this.canvas.hidden=false;this.begin();
    }catch(e){if(epoch!==this.epoch)return;this.stopSource();const name=e instanceof Error?e.name:'';this.status('error',name==='NotAllowedError'?'相机未获允许，请在浏览器设置中允许相机，或上传照片':name==='NotFoundError'?'未找到相机，可以上传照片试妆':'相机无法启动，请关闭占用相机的其他应用后重试');}
  }
  async loadPhoto(file:File){
    if(!file.type.startsWith('image/')||file.size>20*1024*1024)throw new Error('请选择小于 20 MB 的图片');
    this.pause();const epoch=this.epoch;
    this.status('loading','正在读取照片…');
    let decoded:ImageBitmap;
    try{decoded=await createImageBitmap(file);}catch{
      if(epoch!==this.epoch)return;
      this.status('idle','图片无法读取，请重新选择 JPG、PNG 或 WebP');
      throw new Error('无法读取这张图片，请选择 JPG、PNG 或 WebP');
    }
    if(epoch!==this.epoch){decoded.close();return;}
    const ratio=Math.min(1,1600/Math.max(decoded.width,decoded.height));
    let photo:ImageBitmap;
    try{photo=ratio<1?await createImageBitmap(decoded,{resizeWidth:Math.round(decoded.width*ratio),resizeHeight:Math.round(decoded.height*ratio)}):decoded;}
    catch{if(epoch!==this.epoch)return;this.status('idle','照片处理失败，请选择较小的图片');throw new Error('照片处理失败，请选择较小的图片');}
    finally{if(ratio<1)decoded.close();}
    if(epoch!==this.epoch){photo.close();return;}
    this.photo=photo;
    this.mode='photo';this.mirror=false;this.onMode(this.mode,this.mirror);this.canvas.hidden=false;this.begin();this.dirty=true;
    if(this.ready)void this.detect(true);
  }
  setLook(look:Look,products:Product[]){this.renderer.setLook(look,products);this.hair.setEnabled(Boolean(look.hair));this.dirty=true;}
  setCompare(split:number,original:boolean){this.split=split;this.original=original;this.dirty=true;}
  toggleMirror(){this.mirror=!this.mirror;this.onMode(this.mode,this.mirror);this.dirty=true;}
  async flip(){this.facing=this.facing==='user'?'environment':'user';await this.startCamera();}
  retry(){if(this.mode==='idle'){void this.startCamera();return;}this.hair.reset();this.worker?.terminate();this.worker=undefined;this.ready=false;this.busy=false;this.init();}
  skin(){return this.source?sampleSkin(this.source,this.points):null;}
  async snapshot():Promise<Blob>{
    if(!this.source)throw new Error('请先打开镜头或上传照片');
    const epoch=this.epoch;
    // Force an up-to-date composite; the exported image has the same split/mirror settings as the view.
    this.dirty=true;await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    if(this.renderFailed||this.canvas.hidden||epoch!==this.epoch)throw new Error('当前画面无法保存，请重新打开试妆');
    const output=document.createElement('canvas');output.width=this.canvas.width;output.height=this.canvas.height;
    const c=output.getContext('2d')!;if(this.mirror){c.translate(output.width,0);c.scale(-1,1);}c.drawImage(this.canvas,0,0);
    return new Promise((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(new Error('保存失败，请重试')),'image/png'));
  }
  stopSource(){
    this.hair.reset();
    this.epoch++;this.stream?.getTracks().forEach(t=>t.stop());this.stream=undefined;this.video.pause();this.video.srcObject=null;
    this.photo?.close();this.photo=undefined;this.mode='idle';this.clearMask();this.canvas.hidden=true;this.onMode('idle',false);this.lastVideoTime=-1;
  }
  pause(){this.stopSource();this.worker?.terminate();this.worker=undefined;this.ready=false;this.busy=false;cancelAnimationFrame(this.frame);this.frame=0;this.status('paused','相机已关闭 · 点击重新开启');}
  destroy(){this.pause();this.renderer.destroy();}
}
