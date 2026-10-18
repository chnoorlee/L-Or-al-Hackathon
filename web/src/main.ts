import './style.css';
import catalog from './data/catalog.json';
import { TryOnEngine } from './engine';
import { LocalCover, imagePoint, type CoverTool } from './local-cover';
import { PhotoView } from './photo-view';
import { canShareImage, initializeNative, nativeApp, shareImage } from './platform';
import { DEFAULT_STRENGTH, hexRgb, type Category, type Look, type Product } from './types';
import type { RgbColor } from '../../miniprogram/core/types';
import type { Formula } from '../../miniprogram/tryon/engine';

const products: Product[] = catalog.products.filter(p => p.category === 'foundation' || p.category === 'concealer');
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  camera: '<path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="4"/>',
  upload: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-6 4 4 3-4 5 6"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
  save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  heart: '<path d="M12 20 3.8 12a5.3 5.3 0 0 1 8.2-6.7A5.3 5.3 0 0 1 20.2 12z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  flip: '<path d="M4 8a8 8 0 0 1 14-2l2 2M20 3v5h-5M20 16a8 8 0 0 1-14 2l-2-2M4 21v-5h5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  compare: '<path d="M12 2v20M8 5H3v14h5M16 5h5v14h-5"/>',
}[name] || ''}</svg>`;
const rgbCss = (color?: RgbColor) => color ? `rgb(${color.r},${color.g},${color.b})` : '#e6e4ee';

document.querySelector('#app')!.innerHTML = `
<header class="masthead"><a class="wordmark" href="${import.meta.env.BASE_URL}" aria-label="EVEN TONE 匀色遮瑕工作室首页">EVEN TONE<span>匀色遮瑕工作室</span></a><div class="header-actions"><span class="local-note">${icon('shield')}照片留在你的设备</span><button id="open-library" class="icon-button" aria-label="收藏的遮瑕色号">${icon('heart')}</button></div></header>
<main class="workspace">
  <section class="mirror-section" aria-label="遮瑕预览工作区">
    <div class="mode-switch" role="group" aria-label="选择预览方式"><button id="local-mode" aria-pressed="true">${icon('upload')}照片局部遮瑕</button><button id="live-mode" aria-pressed="false">${icon('camera')}面部实时预览</button></div>
    <div class="mirror" id="mirror">
      <video id="video" playsinline autoplay muted hidden></video><canvas id="canvas" hidden aria-label="面部实时遮瑕预览"></canvas><canvas id="local-canvas" hidden tabindex="0" aria-label="照片选区：方向键移动定位点，回车取样；补涂时回车添加一笔。" aria-describedby="status"></canvas>
      <div class="start-screen" id="start-screen">
        <p class="eyebrow">YOUR SKIN. YOUR CHOICE.</p><h1>遮不遮，由你。<br/><span>想匀一点，先看一眼。</span></h1>
        <p class="intro">为白癜风与局部肤色差异人群设计。<br/>按你的意愿，预览更接近周围肤色的遮瑕。</p>
        <div class="skin-study" aria-label="A 为想遮盖的位置，B 为周围肤色，图形仅作取样示意">
          <svg class="skin-shape" viewBox="0 0 350 180" aria-hidden="true"><path d="M19 173C34 124 51 73 102 39c38-26 72-25 101-6 32 20 39 61 70 76 25 12 43 14 58 64" fill="#c5987d"/><path d="M89 129c-17-20-4-47 15-57 15-9 17-24 33-23 24 1 21 25 39 34 21 11 24 36 7 51-18 16-35 5-47 13-17 11-35-1-47-18" fill="#ead1b8"/><path d="M89 129c-17-20-4-47 15-57 15-9 17-24 33-23 24 1 21 25 39 34 21 11 24 36 7 51-18 16-35 5-47 13-17 11-35-1-47-18Z" fill="none" stroke="#6e5a97" stroke-width="1.5" stroke-dasharray="4 4"/><circle cx="136" cy="103" r="17" fill="#493c69"/><text x="136" y="108" text-anchor="middle" fill="white" font-size="15">A</text><circle cx="226" cy="127" r="17" fill="#285c58"/><text x="226" y="132" text-anchor="middle" fill="white" font-size="15">B</text></svg>
          <div class="sample-legend"><span><b>A</b>想遮盖的位置</span><span><b>B</b>周围肤色</span></div><small>取样示意 · 非真实遮瑕效果</small>
        </div>
        <button class="primary" id="start">${icon('upload')}选择照片，开始圈选${icon('arrow')}</button><button class="text-button" id="take-photo">${icon('camera')}拍一张皮肤照片</button><p class="privacy-small" id="start-hint">面部、手部、手臂等皮肤照片均可 · 不上传</p>
      </div>
      <div class="mirror-toolbar" id="mirror-toolbar" hidden><div><button class="glass-button" id="stop" aria-label="关闭预览并清除当前照片">${icon('close')}</button><span class="source-label" id="source-label">局部遮瑕</span></div><div><button class="glass-button" id="flip" aria-label="切换前后镜头">${icon('flip')}</button><button class="glass-button" id="mirror-toggle" aria-label="切换镜像">↔</button><button class="glass-button" id="download" aria-label="保存遮瑕预览">${icon('save')}</button></div></div>
      <div class="photo-instruction" id="photo-instruction" hidden></div><div id="keyboard-cursor" aria-hidden="true" hidden>＋</div>
      <div class="compare-line" id="compare-line" hidden><span>原图</span><span>遮瑕预览</span></div>
      <div class="mirror-bottom" id="mirror-bottom" hidden><button id="hold-original" class="glass-pill">按住看原图</button><button id="compare" class="glass-pill" aria-pressed="false">${icon('compare')}分屏对比</button></div>
      <div class="split-control" id="split-control" hidden><label for="split">对比位置</label><input id="split" type="range" min="0" max="100" value="50"/></div>
    </div>
    <div id="photo-view" class="photo-view" role="group" aria-label="放大修整照片" hidden><button id="zoom-out" aria-label="缩小照片">−</button><output id="zoom-value" aria-live="polite">100%</output><button id="zoom-in" aria-label="放大照片">＋</button><button id="pan-photo" aria-pressed="false">拖动画面</button><button id="zoom-reset">还原视图</button></div>
    <div class="status-row"><span id="status" role="status" aria-live="polite">从一张照片开始，选择你想遮盖的区域。</span><button id="retry" hidden>重试定位</button></div>
    <div class="source-actions" id="source-actions" hidden><button id="change-photo">${icon('upload')}换张照片</button><button id="edit-region">重新修整选区</button><button id="save-preview">${icon('save')}保存预览</button></div>
    <p class="simulation-note">视觉模拟，不用于诊断，也不代表具体商品的实际遮盖效果。</p>
  </section>
  <aside class="cover-desk" aria-label="遮瑕设置">
    <div class="desk-heading"><p class="eyebrow">A LITTLE CLOSER TO YOU</p><h2>只遮你想遮的地方。</h2><p>以周围肤色为参考，保留属于你的肌肤纹理。</p></div>
    <div id="local-workflow">
      <ol class="steps" aria-label="局部遮瑕步骤"><li id="step-photo" aria-current="step"><span>01</span>选照片</li><li id="step-region"><span>02</span>圈选与取色</li><li id="step-effect"><span>03</span>看遮瑕效果</li></ol>
      <section class="sample-section" id="sample-section"><div class="section-heading"><h3>两处取样，一个参考</h3><span id="sample-progress">准备开始</span></div><p id="sample-help" class="help">选一张光线均匀、没有滤镜的照片，同时保留想遮盖的位置和周围皮肤。</p>
        <div class="sample-pair"><button id="sample-a" class="sample-card" disabled><span class="sample-dot" id="color-a">A</span><span><b>想遮盖的位置</b><small id="a-label">先在照片上点选</small></span></button><span class="pair-arrow" aria-hidden="true">→</span><button id="sample-b" class="sample-card" disabled><span class="sample-dot" id="color-b">B</span><span><b>周围肤色</b><small id="b-label">作为目标颜色</small></span></button></div>
      </section>
      <section id="region-editor" hidden><div class="section-heading"><h3>让选区刚刚好</h3><button id="undo" class="text-button">${icon('undo')}撤销</button></div><p class="help">紫色是选区。检查边缘，避开眼睛、嘴唇、鼻孔、头发和背景，再确认。</p>
        <div class="segmented" id="tools" role="group" aria-label="修整选区"><button data-tool="add" aria-pressed="true">＋ 补涂</button><button data-tool="erase" aria-pressed="false">− 擦除</button><button data-tool="region" aria-pressed="false">加选相似区域</button></div>
        <div class="range-label"><label for="brush-size">笔刷大小</label><output id="brush-value">中</output></div><input id="brush-size" type="range" min="1" max="10" value="3.5" step="0.5"/>
        <details class="fine-details"><summary>重新辅助圈选</summary><p class="help">调整识别范围后重新圈选，会替换当前选区；可撤销。更多斑块可用“加选相似区域”。</p><div class="range-label"><label for="tolerance">颜色范围</label><output id="tolerance-value">18</output></div><input id="tolerance" type="range" min="5" max="40" value="18"/><div class="inline-actions"><button id="resegment" class="secondary">重新圈选</button><button id="clear-region" class="text-button">清空选区</button></div></details>
        <button id="confirm-region" class="primary full">确认选区，看遮瑕效果${icon('arrow')}</button>
      </section>
      <div class="getting-started" id="getting-started"><span class="tiny-label">你的选择，始终在你手中</span><div><b>01</b><p>圈出想遮盖的位置<small>自动辅助圈选，也可以手动修整。</small></p></div><div><b>02</b><p>参考周围的肤色<small>不追求更白，只靠近你选择的颜色。</small></p></div><div><b>03</b><p>找到舒服的遮盖程度<small>轻透或更匀，随时对比原图。</small></p></div></div>
    </div>
    <div id="live-help" class="live-help" hidden><p class="eyebrow">FACE PREVIEW</p><h3>看看底妆，随面部而动。</h3><p>实时预览全脸底妆或眼下遮瑕。想单独遮盖某块皮肤，请使用“照片局部遮瑕”。</p><p class="help">正面入镜、光线均匀；全脸底妆避开眼睛、眉毛、唇部和鼻部。</p></div>
    <section id="effect-controls" hidden aria-label="遮瑕效果调整"><div class="section-heading"><h3 id="effect-title">更接近周围肤色</h3><span class="selection-badge" id="selection-badge">只作用于选区</span></div>
      <div class="target-color" id="target-color"><i id="target-swatch"></i><div><b id="target-name">B · 周围肤色</b><small id="target-note">以这次照片里的取样为参考</small></div><button id="use-reference" class="text-button">恢复 B 肤色</button></div>
      <div class="range-label"><label for="strength">遮盖强度</label><output id="strength-value">78%</output></div><input id="strength" type="range" min="0" max="100" value="78"/><div class="range-ends"><span>保留更多原本肤色</span><span>更接近目标色</span></div>
      <div id="local-adjustments"><div class="segmented formulas" id="formulas" role="group" aria-label="模拟遮盖方式"><button data-formula="sheer" aria-pressed="false">轻透</button><button data-formula="concealer" aria-pressed="true">匀色遮盖</button><button data-formula="soft" aria-pressed="false">柔和纹理</button></div><div class="range-label"><label for="feather">边缘柔和度</label><output id="feather-value">4</output></div><input id="feather" type="range" min="0" max="16" value="4"/>
      <details class="fine-details"><summary>微调参考肤色</summary><p class="help">只调整 B 参考色。商品色样请在下方切换。</p><div class="range-label"><label for="warmth">偏冷 ↔ 偏暖</label><output id="warmth-value">0</output></div><input id="warmth" type="range" min="-30" max="30" value="0"/><div class="range-label"><label for="brightness">稍深 ↔ 稍浅</label><output id="brightness-value">0</output></div><input id="brightness" type="range" min="-30" max="30" value="0"/></details></div>
    </section>
    <details class="product-details" id="product-details" hidden><summary><span>试一款遮瑕产品<small>可选 · 公开色样参考</small></span><span aria-hidden="true">＋</span></summary><div class="product-content">
      <div class="segmented" id="categories" role="group" aria-label="选择产品部位"></div><div class="product-selector"><label for="product-select">产品</label><select id="product-select"></select></div>
      <article class="product-card"><div class="product-mark" aria-hidden="true"><svg viewBox="0 0 50 76"><rect x="12" y="24" width="26" height="47" rx="5" fill="currentColor"/><path d="M16 24V13h18v11M21 13V6h20" fill="none" stroke="currentColor" stroke-width="6"/><path d="M18 46h14m-14 6h9" stroke="white" stroke-width="1.5"/></svg></div><div class="product-copy"><span id="region-label"></span><h3 id="product-name"></h3><p id="shade-name"></p><a id="product-link" target="_blank" rel="noopener noreferrer">品牌官网色号详情 ↗</a></div><button id="favorite" class="icon-button" aria-label="收藏当前色号" aria-pressed="false">${icon('heart')}</button></article>
      <div class="shade-heading"><span>切换色号 <small id="shade-count"></small></span><button id="match-skin" class="text-button">找相近色样</button></div><div class="shade-rail" id="shades" role="group" aria-label="遮瑕商品色号"></div><div id="live-layers" hidden><div id="layers" class="layer-list"></div><button id="reset" class="text-button">清除全部底妆</button></div><p class="color-note">色样来自品牌官网，未做实物显色标定；相近色不等于匹配推荐。请结合线下试色。</p>
    </div></details>
    <div class="privacy-card">${icon('shield')}<p><b>照片只在此刻，为你所用。</b><span>在本机处理，不上传、不自动保存。<br/>关闭预览，即清除当前照片。</span></p></div>
  </aside>
</main>
<footer><span>EVEN TONE · 遮瑕是一种选择，不是必须。</span><button id="about">隐私与使用说明</button></footer>
<input type="file" id="photo-file" accept="image/*" hidden/>
<input type="file" id="camera-file" accept="image/*" capture="environment" hidden/>
<dialog id="about-dialog"><div class="dialog-heading"><h2>关于匀色遮瑕工作室</h2><button class="icon-button" data-close aria-label="关闭说明">${icon('close')}</button></div><p>为白癜风与局部肤色差异人群提供自主遮瑕预览。不判断皮肤疾病，也不提供治疗建议；遮盖或保留，都由你决定。</p><p><b>照片局部遮瑕：</b>点选 A 想遮盖的位置，再点选 B 周围皮肤。系统按颜色相似度辅助圈选，不识别疾病。请手动检查并修整选区，尤其要避开五官、头发及背景。照片预览最长边为 640 像素。</p><p><b>面部实时预览：</b>支持单人全脸底妆与眼下遮瑕。暂不支持身体斑块实时追踪；强侧脸、遮挡和暗光可能影响贴合。</p><p><b>隐私：</b>相机与照片仅在当前设备处理，不上传服务器。切到后台会关闭相机；照片在关闭预览、切换模式或离开页面时清除。只有你点“保存预览”才生成可下载图片。色号收藏只保存商品编号。</p><p><b>颜色与商品：</b>页面是视觉模拟，不能保证真实遮盖力或持妆效果。公开商品信息来自 L’Oréal Paris 美国官网，数据日期 ${escape(catalog.generatedAt.slice(0, 10))}，可通过各色号详情核对。本项目是独立黑客松原型，非品牌官方服务。</p></dialog>
<dialog id="library-dialog"><div class="dialog-heading"><h2>收藏的遮瑕色号</h2><button class="icon-button" data-close aria-label="关闭收藏">${icon('close')}</button></div><div id="favorites-list"></div><p class="color-note">只保存产品色号，不保存皮肤照片或取样颜色。</p></dialog>
<dialog id="export-dialog"><div class="dialog-heading"><h2>保存遮瑕预览</h2><button class="icon-button" data-close aria-label="关闭照片">${icon('close')}</button></div><img id="export-image" alt="你确认的遮瑕预览"/><button class="primary full" id="share-preview" hidden>保存或分享图片</button><a class="secondary export-download" id="export-link" download="even-tone-cover.png">下载图片</a><p class="color-note">通过系统菜单保存或分享；分享对象由你选择。App 仅在你分享时缓存导出图片，下次启动清理。网页也可长按图片保存。</p></dialog>
<div class="toast" id="toast" role="status" hidden></div>`;

let mode: 'local' | 'live' = 'local';
let sourceMode = 'idle', compare = false, held = false, engine: TryOnEngine | undefined;
let active: Category = 'concealer';
let look: Look = {};
const chosen = new Map<string, string>();
let localProduct: { productId: string; shadeId: string } | undefined;
let favorites: string[] = [];
try { const f = JSON.parse(localStorage.getItem('even-tone-favorites') || '[]'); if (Array.isArray(f)) favorites = f.filter(x => typeof x === 'string'); } catch { /* Optional storage never blocks preview. */ }
let toastTimer = 0, exportUrl = '', sourceEpoch = 0;
let exportBlob: Blob | undefined;
let sharing = false;
const photoView = new PhotoView();
let panPoint = { x: 0, y: 0 };
const local = new LocalCover($('#local-canvas'), renderWorkflow, toast);
const cursor = { x: 0.5, y: 0.5 };
let pointerId: number | undefined;
let displayedStep = local.step;

function toast(message: string) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('#toast').hidden = true, 5000);
}
function status(text: string, state = 'idle') { $('#status').textContent = text; $('#status').dataset.state = state; }
function clearExport() {
  $<HTMLDialogElement>('#export-dialog').close();
  $('#export-image').removeAttribute('src'); $('#export-link').removeAttribute('href');
  if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = '';
  exportBlob = undefined;
}
function canCompare() { return mode === 'local' ? local.step === 'preview' && local.ready : sourceMode !== 'idle'; }
function displaySource() {
  const hasSource = mode === 'local' ? local.ready : sourceMode !== 'idle';
  $('#mirror').classList.toggle('has-source', hasSource);
  $('#start-screen').hidden = hasSource;
  $('#mirror-toolbar').hidden = !hasSource; $('#source-actions').hidden = !hasSource;
  $('#source-label').textContent = mode === 'local' ? '局部遮瑕 · 本机照片' : '面部底妆 · LIVE';
  $('#flip').hidden = $('#mirror-toggle').hidden = mode === 'local';
  $('#change-photo').hidden = mode !== 'local';
  $('#take-photo').hidden = mode !== 'local';
  $('#photo-view').hidden = mode !== 'local' || !local.ready || local.step === 'preview';
  $('#edit-region').hidden = mode !== 'local' || local.step !== 'preview';
  $<HTMLButtonElement>('#download').disabled = $<HTMLButtonElement>('#save-preview').disabled = !canCompare();
  $('#photo-instruction').hidden = mode !== 'local' || !local.ready || local.step === 'preview';
  $('#mirror-bottom').hidden = !canCompare();
  updateCompare();
}
function renderWorkflow() {
  if (mode !== 'local') return;
  if (displayedStep !== local.step) {
    $('.cover-desk').scrollTop = 0;
    displayedStep = local.step;
  }
  const ready = local.ready, editing = local.step === 'edit', preview = local.step === 'preview';
  $('#local-workflow').hidden = false;
  $('#sample-section').hidden = preview;
  $('#getting-started').hidden = ready;
  $('#region-editor').hidden = !editing;
  $('#effect-controls').hidden = $('#product-details').hidden = !preview;
  const stepIndex = !ready ? 0 : preview ? 2 : 1;
  ['#step-photo', '#step-region', '#step-effect'].forEach((id, i) => {
    $(id).classList.toggle('complete', i < stepIndex);
    if (i === stepIndex) $(id).setAttribute('aria-current', 'step'); else $(id).removeAttribute('aria-current');
  });
  $<HTMLButtonElement>('#sample-a').disabled = !ready;
  $<HTMLButtonElement>('#sample-b').disabled = !local.a;
  $('#sample-a').classList.toggle('active', ready && local.step === 'a');
  $('#sample-b').classList.toggle('active', ready && local.step === 'b');
  $('#color-a').style.background = rgbCss(local.aColor); $('#color-b').style.background = rgbCss(local.bColor);
  $('#a-label').textContent = local.a ? '已取样 · 点击重选' : '先在照片上点选';
  $('#b-label').textContent = local.b ? '已取样 · 点击重选' : '作为目标颜色';
  const instructions = { a: '点选 A：你想遮盖的位置', b: '点选 B：附近想参考的肤色', edit: '紫色为选区 · 拖动补涂或擦除', preview: '选区已确认 · 调整遮盖强度，随时比较原图' };
  $('#photo-instruction').textContent = instructions[local.step];
  $('#sample-progress').textContent = !ready ? '准备开始' : !local.a ? 'A / B 待取样' : !local.b ? 'A 已选 · B 待选' : 'A / B 已选';
  $('#sample-help').textContent = !ready ? '选一张光线均匀、没有滤镜的照片，同时保留想遮盖的位置和周围皮肤。' : local.step === 'a' ? '在照片上点一下想遮盖的位置；下一步再选择周围肤色。' : local.step === 'b' ? '选区外、相同光线下的一小块皮肤，是这次遮瑕的颜色参考。' : '取样颜色来自原图。重新取样会清除当前选区。';
  if (ready) status(instructions[local.step], preview ? 'tracking' : 'idle');
  $<HTMLButtonElement>('#undo').disabled = !local.canUndo;
  $<HTMLButtonElement>('#confirm-region').disabled = !local.selectedPixels;
  $('#confirm-region').innerHTML = `${local.selectedPixels ? '确认选区，看遮瑕效果' : '请先补涂想遮盖的区域'}${icon('arrow')}`;
  $('#tools').querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === local.tool)));
  $<HTMLInputElement>('#brush-size').disabled = local.tool === 'region';
  $<HTMLInputElement>('#brush-size').value = String(local.radius * 100);
  $('#brush-value').textContent = `${local.radius < .03 ? '细' : local.radius < .06 ? '中' : '粗'} · ${Number((local.radius * 100).toFixed(1))}`;
  $<HTMLInputElement>('#tolerance').value = String(local.tolerance);
  $('#tolerance-value').textContent = String(local.tolerance);
  displaySource(); updateAdjustments();
}
function getProduct() {
  const id = mode === 'live' ? look[active]?.productId ?? chosen.get(active) : chosen.get(active);
  return products.find(p => p.id === id) || products.find(p => p.category === active)!;
}
function getShade() {
  const p = getProduct(); const id = mode === 'local' ? localProduct?.shadeId : look[active]?.shadeId;
  return p.shades.find(s => s.id === id) || p.shades[0];
}
function apply(product: Product, shadeId: string) {
  chosen.set(product.category, product.id); active = product.category as Category;
  const shade = product.shades.find(s => s.id === shadeId)!;
  if (mode === 'local') {
    localProduct = { productId: product.id, shadeId };
    const [r, g, b] = hexRgb(shade.hex).map(x => x * 255); local.target = { r, g, b }; local.draw();
  } else {
    look[active] = { productId: product.id, shadeId, strength: look[active]?.strength ?? DEFAULT_STRENGTH[active], finish: product.finish as 'matte' | 'satin' };
    engine?.setLook(look, products);
  }
  renderProducts(); updateAdjustments();
}
function updateAdjustments() {
  const isLocal = mode === 'local';
  $('#local-adjustments').hidden = !isLocal; $('#target-color').hidden = !isLocal;
  $('#effect-title').textContent = isLocal ? '找到舒服的遮盖程度' : '调整当前底妆';
  $('#selection-badge').textContent = isLocal ? '只作用于选区' : active === 'foundation' ? '全脸皮肤' : '眼下区域';
  const strength = isLocal ? local.options.strength : look[active]?.strength ?? DEFAULT_STRENGTH[active];
  $<HTMLInputElement>('#strength').value = String(strength); $('#strength-value').textContent = `${strength}%`;
  const b = local.bColor;
  const target = local.target || (b ? { r: Math.max(0, Math.min(255, b.r + local.options.brightness + local.options.warmth * .35)), g: Math.max(0, Math.min(255, b.g + local.options.brightness)), b: Math.max(0, Math.min(255, b.b + local.options.brightness - local.options.warmth * .45)) } : undefined);
  $('#target-swatch').style.background = rgbCss(target);
  $('#target-name').textContent = localProduct ? products.find(p => p.id === localProduct!.productId)!.shades.find(s => s.id === localProduct!.shadeId)!.name : 'B · 周围肤色';
  $('#target-note').textContent = localProduct ? '当前使用商品网页色样' : '以这次照片里的取样为参考';
  $('#use-reference').hidden = !localProduct && local.options.warmth === 0 && local.options.brightness === 0;
  for (const name of ['feather', 'warmth', 'brightness'] as const) {
    $<HTMLInputElement>(`#${name}`).value = String(local.options[name]); $(`#${name}-value`).textContent = String(local.options[name]);
    if (name !== 'feather') $<HTMLInputElement>(`#${name}`).disabled = !!localProduct;
  }
  $('#formulas').querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.formula === local.options.formula)));
}
function renderProducts() {
  const p = getProduct(), s = getShade();
  const selectedId = mode === 'local' ? localProduct?.shadeId : look[active]?.shadeId;
  $('#categories').innerHTML = [['concealer', mode === 'local' ? '遮瑕产品' : '眼下遮瑕'], ['foundation', mode === 'local' ? '底妆产品' : '全脸底妆']].map(([id, name]) => `<button data-category="${id}" aria-pressed="${active === id}">${name}</button>`).join('');
  $('#product-select').innerHTML = products.filter(x => x.category === active).map(x => `<option value="${escape(x.id)}" ${x.id === p.id ? 'selected' : ''}>${escape(x.name)}</option>`).join('');
  $('#product-name').textContent = p.name; $('#shade-name').textContent = s.name;
  $('#region-label').textContent = mode === 'local' ? (selectedId === s.id ? '用于当前选区' : '选择色号后用于选区') : (look[active] ? '当前图层已开启' : '选择色号开启图层');
  $<HTMLAnchorElement>('#product-link').href = s.url;
  $('.product-mark').style.color = s.hex;
  $('#shade-count').textContent = `${p.shades.length} 色`;
  $('#shades').innerHTML = p.shades.map(shade => `<button class="swatch" style="--swatch:${escape(shade.hex)}" data-shade="${escape(shade.id)}" aria-label="${escape(shade.name)}" aria-pressed="${selectedId === shade.id}"><span></span><small>${escape(shade.name)}</small></button>`).join('');
  $('#favorite').setAttribute('aria-pressed', String(favorites.includes(s.id)));
  $('#live-layers').hidden = mode === 'local';
  $('#layers').innerHTML = (['foundation', 'concealer'] as const).filter(c => look[c]).map(c => `<button data-remove="${c}" class="layer-chip">${c === 'foundation' ? '全脸底妆' : '眼下遮瑕'} ×<span class="sr-only">移除此层</span></button>`).join('');
}
function stop() {
  photoView.reset(); updatePhotoView();
  sourceEpoch++; engine?.pause(); local.clear(); localProduct = undefined;
  sourceMode = 'idle'; pointerId = undefined; compare = held = false;
  $('#video').hidden = true; $('#canvas').hidden = true;
  $('#keyboard-cursor').hidden = true; $('#retry').hidden = true;
  $('#mirror').classList.remove('mirrored'); clearExport();
  $('.cover-desk').scrollTop = 0;
  if (mode === 'local') renderWorkflow(); else displaySource();
  status(mode === 'local' ? '当前照片已清除，可重新选择照片。' : '镜头已关闭，点击打开实时预览。');
}
function chooseMode(next: 'local' | 'live') {
  if (next === mode) return;
  stop(); mode = next;
  $('#local-mode').setAttribute('aria-pressed', String(mode === 'local')); $('#live-mode').setAttribute('aria-pressed', String(mode === 'live'));
  $('#local-workflow').hidden = mode !== 'local'; $('#live-help').hidden = mode !== 'live';
  $('#effect-controls').hidden = mode === 'local'; $('#product-details').hidden = mode === 'local';
  $<HTMLDetailsElement>('#product-details').open = mode === 'live';
  $('#start').innerHTML = mode === 'local' ? `${icon('upload')}选择照片，开始圈选${icon('arrow')}` : `${icon('camera')}打开面部实时预览${icon('arrow')}`;
  $('#start-hint').textContent = mode === 'local' ? '面部、手部、手臂等皮肤照片均可 · 不上传' : '点击后请求相机权限 · 仅支持面部实时预览';
  if (mode === 'live') {
    active = 'foundation';
    if (!look.foundation && !look.concealer) apply(getProduct(), getProduct().shades[0].id);
  } else { active = 'concealer'; renderWorkflow(); }
  renderProducts(); updateAdjustments(); displaySource();
  status(mode === 'local' ? '选择照片后，点选 A 区和 B 肤色。' : '打开镜头，选择底妆色号，观察面部实时效果。');
}
function ensureEngine() {
  if (engine) return engine;
  engine = new TryOnEngine($('#video'), $('#canvas'), s => {
    if (mode !== 'live') return;
    status(s.text.replace('选择商品开始试色', '选择遮瑕色号').replace('换色即时生效', '底妆随面部移动'), s.state);
    $('#retry').hidden = s.state !== 'error';
  }, (next, mirrored) => {
    if (mode !== 'live') return;
    sourceMode = next; $('#video').hidden = next === 'idle';
    $('#mirror').classList.toggle('mirrored', mirrored); displaySource();
  });
  engine.setLook(look, products); return engine;
}
async function startCamera() { try { await ensureEngine().startCamera(); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } }
$('#local-mode').onclick = () => chooseMode('local'); $('#live-mode').onclick = () => chooseMode('live');
$('#start').onclick = () => mode === 'local' ? $('#photo-file').click() : void startCamera();
$('#change-photo').onclick = () => $('#photo-file').click();
$('#take-photo').onclick = () => $('#camera-file').click();
const loadPhoto = async (e: Event) => {
  const input = e.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file) return;
  stop(); const epoch = sourceEpoch; status('正在本机打开照片…');
  try { if (await local.load(file) && epoch === sourceEpoch) { renderWorkflow(); renderProducts(); } }
  catch (error) { if (epoch === sourceEpoch) { status('照片未能打开，请换一张 JPG 或 PNG 照片。', 'error'); toast(error instanceof Error ? error.message : String(error)); } }
};
$<HTMLInputElement>('#photo-file').onchange = loadPhoto;
$<HTMLInputElement>('#camera-file').onchange = loadPhoto;
$('#sample-a').onclick = () => { localProduct = undefined; compare = held = false; local.resample('a'); renderProducts(); };
$('#sample-b').onclick = () => { localProduct = undefined; compare = held = false; local.resample('b'); renderProducts(); };
$('#tools').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]'); if (t) { photoView.pan = false; updatePhotoView(); local.tool = t.dataset.tool as CoverTool; renderWorkflow(); } };
$('#undo').onclick = () => local.undo(); $('#clear-region').onclick = () => local.clearRegion();
$('#resegment').onclick = () => local.segment();
$('#confirm-region').onclick = () => { photoView.reset(); updatePhotoView(); local.confirm(); };
$('#edit-region').onclick = () => { compare = held = false; local.edit(); };
$<HTMLInputElement>('#tolerance').oninput = e => { local.tolerance = Number((e.target as HTMLInputElement).value); $('#tolerance-value').textContent = String(local.tolerance); };
$<HTMLInputElement>('#brush-size').oninput = e => { const v = Number((e.target as HTMLInputElement).value); local.radius = v / 100; $('#brush-value').textContent = `${v < 3 ? '细' : v < 6 ? '中' : '粗'} · ${v}`; };

function pointAt(e: PointerEvent) {
  const rect = $('#local-canvas').getBoundingClientRect(), canvas = $<HTMLCanvasElement>('#local-canvas');
  return imagePoint(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, canvas.width, canvas.height);
}
function updatePhotoView() {
  const box = $('#mirror'); photoView.resize(box.clientWidth, box.clientHeight);
  $('#local-canvas').style.transform = photoView.transform;
  $('#local-canvas').style.cursor = photoView.pan ? 'grab' : 'crosshair';
  $('#zoom-value').textContent = `${Math.round(photoView.zoom * 100)}%`;
  $<HTMLButtonElement>('#zoom-out').disabled = photoView.zoom === 1;
  $<HTMLButtonElement>('#zoom-in').disabled = photoView.zoom === 4;
  $<HTMLButtonElement>('#pan-photo').disabled = photoView.zoom === 1;
  $('#pan-photo').setAttribute('aria-pressed', String(photoView.pan));
  $('#pan-photo').textContent = photoView.pan ? '返回取样 / 修边' : '拖动画面';
  $('#keyboard-cursor').hidden = true;
}
$('#zoom-in').onclick = () => { photoView.scale(.5, $('#mirror').clientWidth, $('#mirror').clientHeight); updatePhotoView(); };
$('#zoom-out').onclick = () => { photoView.scale(-.5, $('#mirror').clientWidth, $('#mirror').clientHeight); updatePhotoView(); };
$('#zoom-reset').onclick = () => { photoView.reset(); updatePhotoView(); };
$('#pan-photo').onclick = () => { photoView.pan = !photoView.pan; updatePhotoView(); };
$('#local-canvas').onpointerdown = e => {
  if (pointerId !== undefined || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const point = pointAt(e); if (!point && !photoView.pan) return;
  e.preventDefault(); pointerId = e.pointerId; $('#keyboard-cursor').hidden = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  panPoint = { x: e.clientX, y: e.clientY };
  if (!photoView.pan && point) local.begin(point);
};
$('#local-canvas').onpointermove = e => {
  if (e.pointerId !== pointerId) return;
  if (photoView.pan) {
    photoView.move(e.clientX - panPoint.x, e.clientY - panPoint.y, $('#mirror').clientWidth, $('#mirror').clientHeight);
    panPoint = { x: e.clientX, y: e.clientY }; updatePhotoView();
  } else { const point = pointAt(e); if (point) local.move(point); }
};
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#local-canvas').addEventListener(event, () => { pointerId = undefined; local.end(); });
function positionCursor() {
  const box = $('#mirror').getBoundingClientRect(), canvas = $<HTMLCanvasElement>('#local-canvas'), rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  $('#keyboard-cursor').style.left = `${rect.left - box.left + (rect.width - canvas.width * scale) / 2 + cursor.x * canvas.width * scale}px`;
  $('#keyboard-cursor').style.top = `${rect.top - box.top + (rect.height - canvas.height * scale) / 2 + cursor.y * canvas.height * scale}px`;
}
$('#local-canvas').onkeydown = e => {
  if (!local.ready || local.step === 'preview') return;
  const delta = e.shiftKey ? .05 : .01;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault(); cursor.x = Math.max(0, Math.min(1, cursor.x + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0)));
    cursor.y = Math.max(0, Math.min(1, cursor.y + (e.key === 'ArrowDown' ? delta : e.key === 'ArrowUp' ? -delta : 0)));
    $('#keyboard-cursor').hidden = false; positionCursor();
  } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); local.begin(cursor); local.end(); }
};
$('#local-canvas').onfocus = () => { if (local.step !== 'preview') { $('#keyboard-cursor').hidden = false; positionCursor(); } };
$('#local-canvas').onblur = () => $('#keyboard-cursor').hidden = true;

$('#categories').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-category]'); if (t) { active = t.dataset.category as Category; renderProducts(); updateAdjustments(); } };
$<HTMLSelectElement>('#product-select').onchange = e => { const p = products.find(p => p.id === (e.target as HTMLSelectElement).value)!; apply(p, p.shades[0].id); };
$('#shades').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-shade]'); if (t) { const scroll = $('#shades').scrollLeft; apply(getProduct(), t.dataset.shade!); $('#shades').scrollLeft = scroll; } };
$<HTMLInputElement>('#strength').oninput = e => {
  const value = Number((e.target as HTMLInputElement).value);
  if (mode === 'local') { local.options.strength = value; local.draw(); }
  else { if (!look[active]) apply(getProduct(), getShade().id); look[active]!.strength = value; engine?.setLook(look, products); }
  $('#strength-value').textContent = `${value}%`;
};
for (const name of ['feather', 'warmth', 'brightness'] as const) $<HTMLInputElement>(`#${name}`).oninput = e => { local.options[name] = Number((e.target as HTMLInputElement).value); updateAdjustments(); local.draw(); };
$('#formulas').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-formula]'); if (t) { local.options.formula = t.dataset.formula as Formula; updateAdjustments(); local.draw(); } };
$('#use-reference').onclick = () => { localProduct = undefined; local.target = undefined; local.options.warmth = local.options.brightness = 0; updateAdjustments(); renderProducts(); local.draw(); };
$('#layers').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]'); if (t) { delete look[t.dataset.remove as Category]; engine?.setLook(look, products); renderProducts(); updateAdjustments(); } };
$('#reset').onclick = () => { look = {}; engine?.setLook(look, products); renderProducts(); updateAdjustments(); };
$('#match-skin').onclick = () => {
  const skin = mode === 'local' ? local.bColor ? [local.bColor.r, local.bColor.g, local.bColor.b].map(x => x / 255) : undefined : engine?.skin();
  if (!skin) { toast(mode === 'local' ? '请先取样周围的 B 肤色' : '请先打开镜头，让脸部完整入镜'); return; }
  const p = getProduct(); const ranked = p.shades.map(s => ({ s, d: hexRgb(s.hex).reduce((n, c, i) => n + (c - skin[i]) ** 2, 0) })).sort((a, b) => a.d - b.d);
  apply(p, ranked[0].s.id); toast('已选择相近网页色样；这不是实物配色结果，请再线下试色。');
};

function positionCompare() {
  const mirror = $('#mirror'), canvas = $<HTMLCanvasElement>(mode === 'local' ? '#local-canvas' : '#canvas');
  const width = Math.min(mirror.clientWidth, mirror.clientHeight * canvas.width / Math.max(1, canvas.height));
  $('#compare-line').style.left = `${(mirror.clientWidth - width) / 2 + width * Number($<HTMLInputElement>('#split').value) / 100}px`;
}
function updateCompare() {
  const enabled = canCompare(), split = enabled && compare ? Number($<HTMLInputElement>('#split').value) / 100 : -1;
  if (mode === 'local') local.compare(split, enabled && held); else engine?.setCompare(split, enabled && held);
  $('#compare').setAttribute('aria-pressed', String(compare));
  $('#compare-line').hidden = $('#split-control').hidden = !enabled || !compare || held;
  positionCompare();
}
new ResizeObserver(() => { updatePhotoView(); positionCompare(); positionCursor(); }).observe($('#mirror'));
new MutationObserver(positionCompare).observe($('#canvas'), { attributes: true, attributeFilter: ['width', 'height'] });
$('#compare').onclick = () => { compare = !compare; updateCompare(); }; $('#split').oninput = updateCompare;
$('#hold-original').onpointerdown = e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); held = true; updateCompare(); };
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#hold-original').addEventListener(event, () => { held = false; updateCompare(); });
$('#hold-original').onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); held = true; updateCompare(); } };
$('#hold-original').onkeyup = $('#hold-original').onblur = () => { held = false; updateCompare(); };
$('#flip').onclick = () => void engine?.flip(); $('#mirror-toggle').onclick = () => engine?.toggleMirror();
$('#stop').onclick = stop; $('#retry').onclick = () => engine?.retry();
async function savePreview() {
  if ($<HTMLDialogElement>('#export-dialog').open) return;
  const epoch = sourceEpoch;
  try {
    const blob = mode === 'local' ? await local.snapshot() : await engine!.snapshot();
    if (epoch !== sourceEpoch || $<HTMLDialogElement>('#export-dialog').open) return;
    clearExport(); exportBlob = blob; exportUrl = URL.createObjectURL(blob); $<HTMLImageElement>('#export-image').src = exportUrl;
    $('#share-preview').hidden = !canShareImage(blob); $('#export-link').hidden = nativeApp;
    $<HTMLAnchorElement>('#export-link').href = exportUrl; $<HTMLDialogElement>('#export-dialog').showModal();
  } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
}
$('#download').onclick = $('#save-preview').onclick = savePreview;
$('#share-preview').onclick = async () => {
  if (!exportBlob || sharing) return;
  sharing = true; $<HTMLButtonElement>('#share-preview').disabled = true;
  try { await shareImage(exportBlob); }
  catch (error) { if (!(error instanceof Error && /abort|cancel|canceled/i.test(error.message))) toast(nativeApp ? '分享未完成，请重试。' : '分享未完成，请重试或使用下载图片。'); }
  finally { sharing = false; $<HTMLButtonElement>('#share-preview').disabled = false; }
};
$<HTMLDialogElement>('#export-dialog').addEventListener('close', () => {
  if ($<HTMLDialogElement>('#export-dialog').open) return;
  if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = '';
  exportBlob = undefined;
  $('#export-image').removeAttribute('src'); $('#export-link').removeAttribute('href');
});
function persistFavorites() { try { localStorage.setItem('even-tone-favorites', JSON.stringify(favorites)); } catch { toast('浏览器不允许保存收藏，本次预览仍可使用。'); } }
$('#favorite').onclick = () => { const id = getShade().id; favorites = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]; persistFavorites(); renderProducts(); };
function renderLibrary() {
  const items = products.flatMap(p => p.shades.filter(s => favorites.includes(s.id)).map(s => ({ p, s })));
  $('#favorites-list').innerHTML = items.length ? items.map(({ p, s }) => `<div class="library-item"><button data-product="${escape(p.id)}" data-shade="${escape(s.id)}"><i style="background:${escape(s.hex)}"></i><span>${escape(s.name)}<small>${escape(p.name)}</small></span></button><button data-unfavorite="${escape(s.id)}" aria-label="取消收藏 ${escape(s.name)}">×</button></div>`).join('') : '<p class="help">在产品色号旁点击心形，就能留住这次选择。</p>';
}
$('#open-library').onclick = () => { renderLibrary(); $<HTMLDialogElement>('#library-dialog').showModal(); };
$('#library-dialog').onclick = e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!t) return;
  if (t.dataset.product) {
    if (mode === 'local' && local.step !== 'preview') { toast('先完成照片取样与选区，或切换到面部实时预览。'); return; }
    apply(products.find(p => p.id === t.dataset.product)!, t.dataset.shade!);
    $<HTMLDetailsElement>('#product-details').open = true; $<HTMLDialogElement>('#library-dialog').close();
  }
  if (t.dataset.unfavorite) { favorites = favorites.filter(x => x !== t.dataset.unfavorite); persistFavorites(); renderLibrary(); renderProducts(); }
};
$('#about').onclick = () => $<HTMLDialogElement>('#about-dialog').showModal();
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => b.onclick = () => b.closest('dialog')!.close());
document.addEventListener('visibilitychange', () => { if (document.hidden) { held = false; updateCompare(); if (mode === 'live') engine?.pause(); } });
window.addEventListener('pagehide', stop);
void initializeNative(() => { held = false; updateCompare(); engine?.pause(); }, () => {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (dialog) { dialog.close(); return true; }
  if (local.ready || sourceMode !== 'idle') { stop(); return true; }
  return false;
}).catch(() => toast('系统状态监听未启动；离开预览前请点击关闭镜头。'));
renderWorkflow(); renderProducts();
