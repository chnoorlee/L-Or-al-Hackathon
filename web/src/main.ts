import './style.css';
import catalog from './data/catalog.json';
import { TryOnEngine } from './engine';
import { CATEGORIES, DEFAULT_STRENGTH, hexRgb, sanitizeLook, type Category, type Finish, type Look, type Product } from './types';

const products:Product[]=catalog.products;
const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icon=(name:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${{
  camera:'<path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="4"/>',
  upload:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-6 4 4 3-4 5 6"/>',
  reset:'<path d="M4 8a9 9 0 1 1-1 7M4 3v5h5"/>',save:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  heart:'<path d="M12 20 3.8 12a5.3 5.3 0 0 1 8.2-6.7A5.3 5.3 0 0 1 20.2 12z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', flip:'<path d="M4 8a8 8 0 0 1 14-2l2 2M20 3v5h-5M20 16a8 8 0 0 1-14 2l-2-2M4 21v-5h5"/>',
  compare:'<path d="M12 2v20M8 5H3v14h5M16 5h5v14h-5"/>',layers:'<path d="m12 3 10 5-10 5L2 8zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
}[name]||''}</svg>`;
function pack(category:string,color='#a65b6b'){
  const c=escape(color);
  if(category==='hair')return `<svg viewBox="0 0 70 100" aria-hidden="true"><rect x="15" y="10" width="40" height="82" rx="3" fill="#202024"/><path d="M19 36q16-18 32 0v44H19z" fill="${c}"/><path d="M24 23h22M24 28h16" stroke="#c6a17f"/></svg>`;
  if(category==='lipstick'||category==='gloss')return `<svg viewBox="0 0 70 100" aria-hidden="true"><rect x="20" y="51" width="30" height="43" rx="2" fill="#202024"/><path d="M26 51V26q0-7 18-17v42" fill="${c}"/><path d="M23 51h24v9H23z" fill="#c6a17f"/><path d="M25 65h20" stroke="#c6a17f"/></svg>`;
  if(['brow','eyeliner','mascara'].includes(category))return `<svg viewBox="0 0 70 100" aria-hidden="true"><path d="M29 14h12v76H29z" fill="#202024"/><path d="m29 14 6-12 6 12" fill="${c}"/><path d="M29 65h12v8H29z" fill="#c6a17f"/></svg>`;
  if(['foundation','concealer','highlighter'].includes(category))return `<svg viewBox="0 0 70 100" aria-hidden="true"><rect x="16" y="29" width="38" height="64" rx="5" fill="${c}"/><rect x="21" y="15" width="28" height="16" fill="#202024"/><path d="M28 15V8h25v6H36v4" fill="#202024"/><path d="M23 56h24M25 62h20" stroke="#fffdf9"/></svg>`;
  return `<svg viewBox="0 0 70 100" aria-hidden="true"><circle cx="35" cy="54" r="31" fill="#202024"/><circle cx="35" cy="54" r="24" fill="${c}"/><path d="M18 38q17-12 34 0" fill="none" stroke="#ffffff70"/></svg>`;
}
document.querySelector('#app')!.innerHTML=`
<header class="masthead"><a class="wordmark" href="${import.meta.env.BASE_URL}" aria-label="EVEN TONE 首页">EVEN TONE<span>YOUR MAKEUP, IN MOTION.</span></a><div class="header-actions"><span class="local-note">画面仅在本机处理</span><button id="open-library" class="icon-button" aria-label="收藏与已存妆容">${icon('heart')}</button></div></header>
<main class="workspace"><section class="mirror-section" aria-label="试妆镜头">
  <div class="mirror" id="mirror"><video id="video" playsinline autoplay muted></video><canvas id="canvas" hidden aria-label="虚拟妆效画面"></canvas>
    <div class="start-screen" id="start-screen"><div class="mirror-monogram" aria-hidden="true">e<span>.</span></div><p class="eyebrow">THE VIRTUAL BEAUTY STUDIO</p><h1>这一抹，<br/>随你而动。</h1><p>挑一支唇膏，换一个色号。<br/>在自己的脸上，找到今天的妆容。</p><button class="primary" id="start-camera">${icon('camera')}打开实时镜头</button><button class="text-button" id="start-photo">${icon('upload')}上传照片试妆</button><span class="privacy-small">开启后才请求相机权限 · 不上传你的照片</span></div>
    <div class="mirror-toolbar" id="mirror-toolbar" hidden><div><button class="glass-button" id="stop" aria-label="关闭镜头">${icon('close')}</button><span class="live-label" id="source-label">LIVE</span></div><div><button class="glass-button" id="flip" aria-label="切换前后镜头">${icon('flip')}</button><button class="glass-button" id="mirror-toggle" aria-label="切换镜像">↔</button><button class="glass-button" id="download" aria-label="保存试妆照片">${icon('save')}</button></div></div>
    <div class="compare-line" id="compare-line" hidden><span>原图</span><span>试妆</span><i>↔</i></div>
    <div class="mirror-bottom" id="mirror-bottom" hidden><button id="hold-original" class="glass-pill">按住看原图</button><button id="compare" class="glass-pill" aria-pressed="false">${icon('compare')}分屏对比</button></div>
    <div class="split-control" id="split-control" hidden><label for="split">移动对比线</label><input id="split" type="range" min="0" max="100" value="50"/></div>
  </div>
  <div class="status-row"><div><span id="status" role="status" aria-live="polite">打开镜头或上传照片，即可开始试妆</span><small id="hair-status" role="status" hidden></small></div><button id="retry" hidden>重新尝试</button></div>
  <div class="source-actions"><button id="camera-source">${icon('camera')}实时镜头</button><button id="photo-source">${icon('upload')}换张照片</button><button id="save-look">${icon('layers')}保存妆容</button></div>
</section>
<aside class="beauty-desk" aria-label="商品与色号"><div class="desk-heading"><div><p class="eyebrow">MAKE IT YOURS</p><h2>你的试妆台</h2></div></div>
<nav class="categories" id="categories" aria-label="彩妆部位"></nav>
<div class="product-selector"><label for="product-select">选择商品</label><select id="product-select"></select></div>
<article class="product-card"><div class="product-pack" id="product-pack"></div><div class="product-copy"><span id="region-label" class="eyebrow"></span><h3 id="product-name"></h3><p id="shade-name"></p><a id="product-link" target="_blank" rel="noopener noreferrer">官网商品详情 ↗</a></div><button class="icon-button favorite" id="favorite" aria-label="收藏当前色号" aria-pressed="false">${icon('heart')}</button></article>
<div class="shade-heading"><span>选择色号 <small id="shade-count"></small></span><button id="match-skin" class="text-button" hidden>找相近肤色</button></div><div class="shade-rail" id="shades" role="group" aria-label="商品色号"></div>
<div class="adjustments"><div class="strength-label"><label for="strength">妆效浓度</label><output id="strength-value">78%</output></div><input id="strength" type="range" min="0" max="100" value="78"/><div class="finish-row"><label for="finish">模拟质感</label><select id="finish"><option value="matte">柔雾</option><option value="satin">缎光</option><option value="gloss">水光</option><option value="shimmer">微光</option></select><button id="remove-layer" class="text-button">移除此层</button></div></div>
<section class="look-section" aria-label="当前叠妆"><div class="look-heading"><span>我的叠妆 <small id="layer-count"></small></span><button id="reset" class="text-button" aria-label="清除全部妆效">${icon('reset')}清除全部</button></div><div id="layers" class="layer-list"></div></section>
<p class="color-note">色号取自品牌官网色样，屏幕试色仅供参考。光线、肤色与实物妆效会有差异。</p>
</aside></main>
<footer><span>EVEN TONE · 独立试妆原型，非品牌官方服务</span><button id="about">隐私与色号来源</button></footer>
<input type="file" id="photo-file" accept="image/*" hidden/>
<dialog id="library-dialog"><div class="dialog-heading"><h2>我的收藏</h2><button class="icon-button" data-close aria-label="关闭收藏">${icon('close')}</button></div><div id="favorites-list"></div><h3>已存妆容</h3><div id="saved-looks"></div><p class="color-note">只在当前浏览器保存商品选择，不保存人脸或照片。</p></dialog>
<dialog id="about-dialog"><div class="dialog-heading"><h2>关于这面试妆镜</h2><button class="icon-button" data-close aria-label="关闭说明">${icon('close')}</button></div><p>相机画面与上传照片只在当前设备上用于试妆，不发送到服务器。离开页面或切到后台会关闭相机。保存图片仅在你点击保存时生成下载。</p><p>商品名称、色号和网页色样来自 L’Oréal Paris 美国官网。点击商品详情可核对来源；本工具未获得实物显色标定，不能替代线下试色。睫毛为示意效果，不预测实际增长或卷翘。</p><p>当前采用单人面部定位。强侧脸、手部遮挡、头发遮脸和暗光仍可能影响贴合，请在均匀光线下使用。</p><p>数据日期：${escape(catalog.generatedAt.slice(0,10))}。${products.length} 款商品，${products.reduce((n,p)=>n+p.shades.length,0)} 个色号。</p><a href="https://www.lorealparisusa.com/virtual-try-on-makeup" target="_blank" rel="noopener noreferrer">参考体验 ↗</a><p class="color-note">MediaPipe Face Landmarker · Apache-2.0。所有模型与脚本随本站提供。</p></dialog>
<dialog id="export-dialog"><div class="dialog-heading"><h2>保存试妆照片</h2><button class="icon-button" data-close aria-label="关闭照片">${icon('close')}</button></div><img id="export-image" alt="当前试妆效果"/><a class="primary" id="export-link" download="even-tone.png">下载图片</a><p class="color-note">iPhone 可长按图片保存到照片，或点下载。图片不会上传。</p></dialog>
<div class="toast" id="toast" role="status" hidden></div>`;

let active:Category='lipstick';
const defaultProduct=products.find(p=>p.category==='lipstick'&&p.name.includes('Satin'))!;
const chosen=new Map<string,string>([[active,defaultProduct.id]]);
const initialShade=defaultProduct.shades.find(s=>s.name.startsWith('843'))||defaultProduct.shades[0];
let look:Look={lipstick:{productId:defaultProduct.id,shadeId:initialShade.id,strength:78,finish:'satin'}};
let engine:TryOnEngine|undefined,compare=false,held=false,currentMode='idle';
let favorites:string[]=[],saved:{id:string;name:string;look:Look}[]=[];
try{const f=JSON.parse(localStorage.getItem('even-tone-favorites')||'[]');if(Array.isArray(f))favorites=f.filter(x=>typeof x==='string');const s=JSON.parse(localStorage.getItem('even-tone-looks')||'[]');if(Array.isArray(s))saved=s.filter(x=>x&&typeof x.name==='string'&&typeof x.id==='string').map(x=>({...x,look:sanitizeLook(x.look,products)})).slice(0,12);}catch{/* Corrupt/unavailable storage never prevents camera use. */}
let toastTimer=0,exportUrl='';
let renderedCategory:Category|undefined;
function toast(message:string){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('#toast').hidden=true,3500);}
function persist(){try{localStorage.setItem('even-tone-favorites',JSON.stringify(favorites));localStorage.setItem('even-tone-looks',JSON.stringify(saved));return true;}catch{toast('浏览器不允许本地保存，这次选择仍可继续使用');return false;}}
function getProduct(){return products.find(p=>p.id===(look[active]?.productId||chosen.get(active)))||products.find(p=>p.category===active)!;}
function getShade(){const p=getProduct();return p.shades.find(s=>s.id===look[active]?.shadeId)||p.shades[0];}
function apply(product:Product,shadeId:string){look[active]={productId:product.id,shadeId,strength:look[active]?.strength??DEFAULT_STRENGTH[active],finish:product.finish as Finish};chosen.set(active,product.id);render();}
function render(){
  const p=getProduct(),s=getShade(),layer=look[active];
  const categories=$('#categories'),categoryScroll=categories.scrollLeft;
  $('#categories').innerHTML=CATEGORIES.filter(([id])=>products.some(p=>p.category===id)).map(([id,name])=>`<button data-category="${id}" aria-pressed="${id===active}">${name}${look[id]?'<i aria-label="已叠加"></i>':''}</button>`).join('');
  categories.scrollLeft=categoryScroll;
  if(renderedCategory!==active){const selected=categories.querySelector<HTMLElement>('[aria-pressed="true"]')!;categories.scrollLeft=selected.offsetLeft-categories.offsetLeft-categories.clientWidth/2+selected.offsetWidth/2;renderedCategory=active;}
  $('#product-select').innerHTML=products.filter(x=>x.category===active).map(x=>`<option value="${escape(x.id)}" ${x.id===p.id?'selected':''}>${escape(x.name)}</option>`).join('');
  $('#product-pack').innerHTML=pack(active,s.hex);$('#product-name').textContent=p.name;$('#shade-name').textContent=s.name;
  $('#region-label').textContent=`${CATEGORIES.find(c=>c[0]===active)![2]} · ${layer?'已叠加':'未叠加'}`;
  $<HTMLAnchorElement>('#product-link').href=s.url;$('#shade-count').textContent=`${p.shades.length} 色`;
  $('#shades').innerHTML=p.shades.map(shade=>`<button class="swatch" style="--swatch:${escape(shade.hex)}" data-shade="${escape(shade.id)}" aria-label="${escape(shade.name)}" aria-pressed="${layer?.shadeId===shade.id}"><span></span><small>${escape(shade.name)}</small></button>`).join('');
  const rail=$('#shades'),selected=rail.querySelector<HTMLElement>('[aria-pressed="true"]');
  if(selected)rail.scrollLeft=selected.offsetLeft-rail.offsetLeft-rail.clientWidth/2+selected.offsetWidth/2;
  $<HTMLInputElement>('#strength').value=String(layer?.strength??DEFAULT_STRENGTH[active]);$('#strength-value').textContent=`${layer?.strength??DEFAULT_STRENGTH[active]}%`;
  $<HTMLSelectElement>('#finish').value=layer?.finish||p.finish;$<HTMLButtonElement>('#remove-layer').disabled=!layer;
  $('#favorite').setAttribute('aria-pressed',String(favorites.includes(s.id)));$('#match-skin').hidden=!['foundation','concealer'].includes(active);
  const entries=CATEGORIES.filter(([id])=>look[id]);$('#layer-count').textContent=String(entries.length);
  $('#layers').innerHTML=entries.length?entries.map(([id,name])=>{const l=look[id]!;const pr=products.find(p=>p.id===l.productId)!;const sh=pr.shades.find(s=>s.id===l.shadeId)!;return `<div class="layer-chip"><button data-layer="${id}" title="${escape(sh.name)}"><i style="background:${escape(sh.hex)}"></i>${name}</button><button data-remove="${id}" aria-label="移除${name}">×</button></div>`;}).join(''):'<p class="empty-look">选一个色号，开始你的第一层妆效。</p>';
  engine?.setLook(look,products);
}
function ensureEngine(){
  if(engine)return engine;
  engine=new TryOnEngine($('#video'),$('#canvas'),s=>{$('#status').textContent=s.text;$('#status').dataset.state=s.state;$('#retry').hidden=s.state!=='error';},(mode,mirror)=>{
    currentMode=mode;$('#mirror').classList.toggle('mirrored',mirror);$('#mirror').classList.toggle('has-source',mode!=='idle');
    $('#start-screen').hidden=mode!=='idle';$('#mirror-toolbar').hidden=mode==='idle';$('#mirror-bottom').hidden=mode==='idle';$('#source-label').textContent=mode==='photo'?'PHOTO':'LIVE';
    $('#flip').hidden=mode!=='camera';$('#split-control').hidden=mode==='idle'||!compare;$('#compare-line').hidden=mode==='idle'||!compare;
    if(mode==='idle'){held=false;updateCompare();}
  },text=>{$('#hair-status').textContent=text;$('#hair-status').hidden=!text;});engine.setLook(look,products);return engine;
}
async function startCamera(){try{await ensureEngine().startCamera();}catch(e){toast(String(e));}}
$('#start-camera').onclick=startCamera;$('#camera-source').onclick=startCamera;
for(const id of ['#start-photo','#photo-source'])$(id).onclick=()=>$('#photo-file').click();
$<HTMLInputElement>('#photo-file').onchange=async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{await ensureEngine().loadPhoto(file);}catch(e){toast(e instanceof Error?e.message:String(e));}finally{input.value='';}};
$('#categories').onclick=e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-category]');if(target){active=target.dataset.category as Category;render();}};
$<HTMLSelectElement>('#product-select').onchange=e=>{const p=products.find(p=>p.id===(e.target as HTMLSelectElement).value)!;apply(p,p.shades[0].id);};
$('#shades').onclick=e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-shade]');if(target){const scroll=$('#shades').scrollLeft;apply(getProduct(),target.dataset.shade!);$('#shades').scrollLeft=scroll;}};
$<HTMLInputElement>('#strength').oninput=e=>{const strength=Number((e.target as HTMLInputElement).value);if(!look[active])apply(getProduct(),getShade().id);look[active]!.strength=strength;$<HTMLInputElement>('#strength').value=String(strength);$('#strength-value').textContent=`${strength}%`;engine?.setLook(look,products);};
$<HTMLSelectElement>('#finish').onchange=e=>{const finish=(e.target as HTMLSelectElement).value as Finish;if(!look[active])apply(getProduct(),getShade().id);look[active]!.finish=finish;render();};
$('#remove-layer').onclick=()=>{delete look[active];render();};$('#reset').onclick=()=>{look={};render();toast('已清除全部妆效');};
$('#layers').onclick=e=>{const t=(e.target as HTMLElement).closest<HTMLElement>('button');if(t?.dataset.remove){delete look[t.dataset.remove as Category];render();}else if(t?.dataset.layer){active=t.dataset.layer as Category;render();}};
function positionCompare(){const mirror=$('#mirror'),canvas=$<HTMLCanvasElement>('#canvas');const width=Math.min(mirror.clientWidth,mirror.clientHeight*canvas.width/Math.max(1,canvas.height));$('#compare-line').style.left=`${(mirror.clientWidth-width)/2+width*Number($<HTMLInputElement>('#split').value)/100}px`;}
function updateCompare(){engine?.setCompare(compare?Number($<HTMLInputElement>('#split').value)/100:-1,held);$('#compare').setAttribute('aria-pressed',String(compare));$('#compare-line').hidden=!compare||currentMode==='idle';$('#split-control').hidden=!compare||currentMode==='idle';positionCompare();}
new ResizeObserver(positionCompare).observe($('#mirror'));
new MutationObserver(positionCompare).observe($('#canvas'),{attributes:true,attributeFilter:['width','height']});
$('#compare').onclick=()=>{compare=!compare;updateCompare();};$('#split').oninput=updateCompare;
$('#hold-original').onpointerdown=e=>{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);held=true;updateCompare();};
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('#hold-original').addEventListener(event,()=>{held=false;updateCompare();});
$('#hold-original').onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();held=true;updateCompare();}};$('#hold-original').onkeyup=()=>{held=false;updateCompare();};$('#hold-original').onblur=()=>{held=false;updateCompare();};
$('#flip').onclick=()=>void engine?.flip();$('#mirror-toggle').onclick=()=>engine?.toggleMirror();$('#stop').onclick=()=>engine?.pause();$('#retry').onclick=()=>engine?.retry();
$('#favorite').onclick=()=>{const id=getShade().id;favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];persist();render();};
function renderLibrary(){
  const items=products.flatMap(p=>p.shades.filter(s=>favorites.includes(s.id)).map(s=>({p,s})));
  $('#favorites-list').innerHTML=items.length?items.map(({p,s})=>`<div class="library-item"><button data-favorite-product="${escape(p.id)}" data-favorite-shade="${escape(s.id)}"><i style="background:${escape(s.hex)}"></i><span>${escape(s.name)}<small>${escape(p.name)}</small></span></button><button data-unfavorite="${escape(s.id)}" aria-label="取消收藏 ${escape(s.name)}">×</button></div>`).join(''):'<p class="empty-look">点击商品旁的心形，收藏喜欢的色号。</p>';
  $('#saved-looks').innerHTML=saved.length?saved.map(s=>`<div class="library-item"><button data-saved="${escape(s.id)}">${escape(s.name)}<small>${Object.keys(s.look).length} 层妆效</small></button><button data-delete-look="${escape(s.id)}" aria-label="删除妆容 ${escape(s.name)}">×</button></div>`).join(''):'<p class="empty-look">搭配好妆容后，点击“保存妆容”。</p>';
}
$('#open-library').onclick=()=>{renderLibrary();$<HTMLDialogElement>('#library-dialog').showModal();};
$('#library-dialog').onclick=e=>{const t=(e.target as HTMLElement).closest<HTMLElement>('button');if(!t)return;
  if(t.dataset.favoriteProduct){const p=products.find(p=>p.id===t.dataset.favoriteProduct)!;active=p.category as Category;apply(p,t.dataset.favoriteShade!);$<HTMLDialogElement>('#library-dialog').close();}
  if(t.dataset.unfavorite){favorites=favorites.filter(x=>x!==t.dataset.unfavorite);persist();renderLibrary();render();}
  if(t.dataset.saved){look=sanitizeLook(saved.find(s=>s.id===t.dataset.saved)!.look,products);render();$<HTMLDialogElement>('#library-dialog').close();toast('已恢复妆容');}
  if(t.dataset.deleteLook){saved=saved.filter(s=>s.id!==t.dataset.deleteLook);persist();renderLibrary();}
};
$('#save-look').onclick=()=>{if(!Object.keys(look).length){toast('先选择至少一个色号');return;}const now=new Date();saved.unshift({id:crypto.randomUUID(),name:`${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`,look:structuredClone(look)});saved=saved.slice(0,12);if(persist())toast('妆容已保存在此浏览器');};
$('#about').onclick=()=>$<HTMLDialogElement>('#about-dialog').showModal();document.querySelectorAll<HTMLElement>('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog')!.close());
$('#download').onclick=async()=>{try{const blob=await engine!.snapshot();if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=URL.createObjectURL(blob);$<HTMLImageElement>('#export-image').src=exportUrl;$<HTMLAnchorElement>('#export-link').href=exportUrl;$<HTMLDialogElement>('#export-dialog').showModal();}catch(e){toast(e instanceof Error?e.message:String(e));}};
$('#match-skin').onclick=()=>{const skin=engine?.skin();if(!skin){toast('请先让脸部完整入镜或上传照片');return;}const p=getProduct();const ranked=p.shades.map(s=>({s,d:hexRgb(s.hex).reduce((n,c,i)=>n+(c-skin[i])**2,0)})).sort((a,b)=>a.d-b.d);apply(p,ranked[0].s.id);toast('已选当前光线下的相近网页色样，请再对照实物');};
document.addEventListener('visibilitychange',()=>{if(document.hidden){held=false;engine?.pause();}});
window.addEventListener('pagehide',()=>{engine?.pause();if(exportUrl)URL.revokeObjectURL(exportUrl);});
render();
