/**
 * Auxiliary browser layout review of trusted, local WXML/WXSS only.
 * This is not a WeChat renderer, compiler, interaction test, or skin-color test.
 * Fixtures and screenshots stay outside miniprogramRoot. No user photos are read.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { DEFAULT_RENDER, fixture as tryonFixture } from './tryon-fixture.mjs';
import { fitLivePreview } from '../miniprogram/tryon/live-layout.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.artifacts/ui-review');
await mkdir(output, { recursive: true });
const globalStyles = (await readFile(resolve(root, 'miniprogram/app.wxss'), 'utf8')).replace(/^\uFEFF/, '');
const sources = {};
const illustration = `data:image/svg+xml;base64,${Buffer.from(await readFile(resolve(root, 'miniprogram/assets/tone-mirror.svg'))).toString('base64')}`;
for (const name of ['entry', 'sample', 'result', 'studio', 'live']) {
  const base = resolve(root, 'miniprogram/pages', name, 'index');
  const [template, styles, source] = await Promise.all([
    readFile(`${base}.wxml`, 'utf8'), readFile(`${base}.wxss`, 'utf8'),
    readFile(`${base}.ts`, 'utf8'),
  ]);
  const match = source.match(/  data: (\{[\s\S]*?\r?\n  \}),/);
  assert(match, `Missing page data: ${name}`);
  // Only the project's own data initializer is evaluated, with an empty catalog.
  const initial = vm.runInNewContext(`(${match[1]})`, { PRODUCTION_CATALOG: [], DEFAULT_RENDER, DEFAULT_FACE_LOOK: { foundation: true, lipstick: false, blush: false, lipStrength: 65, blushStrength: 35, lipFinish: 'satin' } }, { timeout: 1000 });
  const resolvedStyles = name === 'live' ? styles.replace('@import "../studio/index.wxss";', sources.studio.styles) : styles;
  sources[name] = { template: template.replaceAll('/assets/tone-mirror.svg', illustration), styles: resolvedStyles, initial };
}
const allStyles = globalStyles + Object.values(sources).map(s => s.styles).join('\n');
const defined = new Set([...allStyles.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
// These three variables are set by the actual marker geometry code.
['--ring-size', '--caption-offset-y', '--caption-shift-x'].forEach(v => defined.add(v));
for (const [, variable] of allStyles.matchAll(/var\((--[\w-]+)/g)) {
  assert(defined.has(variable), `Undefined CSS variable: ${variable}`);
}

const fixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><path fill="#ac7e70" d="M0 0h300v600H0z"/><path fill="#d2ad96" d="M300 0h300v600H300z"/><rect x="75" y="480" width="450" height="55" fill="white"/><text x="300" y="515" text-anchor="middle" font-family="Arial" font-size="24" fill="#151515">SYNTHETIC LAYOUT FIXTURE</text></svg>`;
const imagePath = `data:image/svg+xml;base64,${Buffer.from(fixtureSvg).toString('base64')}`;
const colors = {
  coverColor: '#AC7E70', referenceColor: '#D2AD96',
  coverColorText: '#AC7E70', referenceColorText: '#D2AD96',
  coverSwatchStyle: 'background-color:#AC7E70', referenceSwatchStyle: 'background-color:#D2AD96',
};
const sample = {
  ...colors, imagePath, layoutReady: true, zoom: 1, zoomText: '100%',
  activeMarker: 'reference', activeMarkerText: 'B 周边肤色',
  hasCover: true, hasReference: true, canAnalyze: true, canUndo: true,
  canMoveActiveMarker: true, cannotShrink: false, cannotGrow: false,
  coverStateText: '已选择', referenceStateText: '已选择',
  promptText: '两处已选好，可拖动圆框或微调后查看取样结果',
  photoLayerStyle: 'width:100%;height:100%', imageStyle: 'width:100%;height:100%;object-fit:contain',
  coverMarkerStyle: 'left:30%;top:45%;--ring-size:45px;--caption-offset-y:35px;--caption-shift-x:0px',
  referenceMarkerStyle: 'left:70%;top:45%;--ring-size:45px;--caption-offset-y:35px;--caption-shift-x:0px',
};
const result = {
  ...colors, imagePath, resultTitle: '本次取样',
  conclusionText: '两处颜色已提取，B 是你选择的目标参考色。',
  emptyTitle: '商品色号尚未接入',
  emptyCopy: '本次已完成照片取色。当前还没有可用的商品色号，重拍或调整取样不会补齐商品数据；无需为此反复尝试。',
  photoFrameStyle: 'width:100%;aspect-ratio:1',
  coverMarkerStyle: 'left:30%;top:45%;width:16%;height:16%',
  referenceMarkerStyle: 'left:70%;top:45%;width:16%;height:16%',
};
const cases = [
  { name: 'entry', page: 'entry' },
  { name: 'entry-guide', page: 'entry', data: { guideExpanded: true } },
  { name: 'entry-privacy', page: 'entry', data: { privacyDialogVisible: true } },
  { name: 'entry-error', page: 'entry', data: { errorMessage: '相机权限未开启，请打开设置后重试。', canOpenSettings: true } },
  { name: 'entry-busy', page: 'entry', data: { isBusy: true, pendingSource: 'album' } },
  { name: 'sample', page: 'sample', data: sample },
  { name: 'sample-empty', page: 'sample', data: { imagePath, photoLayerStyle: sample.photoLayerStyle, imageStyle: sample.imageStyle, layoutReady: true } },
  { name: 'sample-fine', page: 'sample', data: { ...sample, fineTuneExpanded: true } },
  { name: 'sample-busy', page: 'sample', data: { ...sample, isAnalyzing: true, analysisStageText: '正在分析取样颜色' } },
  { name: 'result', page: 'result', data: result },
  { name: 'result-photo', page: 'result', data: { ...result, imageExpanded: true } },
  { name: 'result-warning', page: 'result', data: { ...result, qualityText: 'A、B 区可能存在过曝或欠曝，颜色参考可能受影响。若看到反光或阴影，可返回调整取样。' } },
  { name: 'result-cleared', page: 'result', data: { cleared: true } },
  { name: 'studio-region', page: 'studio', data: { ready: true, selectedPixels: 700, notice: '金色轮廓内是将要试妆的区域，请确认并修正。' }, pixels: 'region' },
  { name: 'studio-makeup', page: 'studio', data: { ready: true, panel: 'makeup', outline: false, split: 42, shadeHex: '#a47a61' }, pixels: 'makeup' },
  { name: 'studio-fine', page: 'studio', data: { ready: true, panel: 'makeup', fineTune: true, outline: false, shadeHex: '#a47a61' }, pixels: 'makeup' },
  { name: 'studio-cleared', page: 'studio', data: { cleared: true, notice: '本次图片已清除，请重新选择。' } },
  { name: 'live-off', page: 'live' },
  { name: 'live-tracking', page: 'live', data: { cameraEnabled: true, hasFrame: true, phase: 'live', status: '实时试妆中 · 请缓慢移动，保持光线和距离稳定。' }, pixels: 'live' },
  { name: 'live-fine', page: 'live', data: { cameraEnabled: true, hasFrame: true, phase: 'live', fineTune: true, status: '实时试妆中 · 请缓慢移动，保持光线和距离稳定。' }, pixels: 'live' },
  { name: 'live-lost', page: 'live', data: { trackingMode: 'region', cameraEnabled: true, hasFrame: true, phase: 'lost', status: '跟踪已中断，已撤去妆效。请保持稳定并重新校准。' }, pixels: 'original' },
  { name: 'live-lips', page: 'live', data: { cameraEnabled: true, hasFrame: true, phase: 'live', category: 'lipstick', status: '妆效随你而动 · 可叠加底妆、唇色与腮红' }, pixels: 'original' },
  { name: 'live-blush', page: 'live', data: { cameraEnabled: true, hasFrame: true, phase: 'live', category: 'blush', status: '妆效随你而动 · 可叠加底妆、唇色与腮红' }, pixels: 'original' },
  { name: 'live-face-unavailable', page: 'live', data: { cameraEnabled: true, hasFrame: true, gpu: true, phase: 'view', error: '人脸跟踪启动失败（代码 2003000）人脸跟踪会话暂不可用，请点击重试跟踪。', status: '妆效尚未显示 · 人脸跟踪需要重试', look: { ...sources.live.initial.look, lipstick: true, blush: true } }, pixels: 'original' },
];
for (const width of [320, 430]) {
  for (const item of cases.filter(c => ['entry', 'sample', 'result', 'studio-region', 'studio-makeup', 'live-tracking', 'live-face-unavailable'].includes(c.name))) {
    cases.push({ ...item, name: `${item.name}-${width}`, width });
  }
}
for (const width of [320, 375, 430]) {
  for (const item of cases.filter(c => ['entry', 'entry-guide', 'entry-privacy', 'sample-fine', 'result', 'studio-region', 'studio-makeup', 'studio-fine', 'live-off', 'live-tracking', 'live-fine'].includes(c.name))) {
    cases.push({ ...item, name: `${item.name}-${width}-large-text`, width, fontSize: 32 });
  }
}
for (const item of cases.filter(c => ['entry', 'entry-privacy', 'sample-fine', 'live-tracking', 'live-lips', 'live-blush'].includes(c.name))) {
  cases.push({ ...item, name: `${item.name}-short-screen`, width: 320, height: 568 });
}

const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || 'msedge', headless: true });
const report = { kind: 'auxiliary-browser-layout-only', nativeWeChatValidated: false, fixture: 'synthetic-color-blocks-and-illustration', cases: [] };
try {
  for (const item of cases) {
    const width = item.width || 375;
    const page = await browser.newPage({ viewport: { width, height: item.height || 812 }, reducedMotion: 'reduce' });
    // Prevent the layout check from fetching any remote resources.
    await page.route(/^https?:\/\//, route => route.abort());
    const source = sources[item.page];
    const data = { ...source.initial, ...item.data };
    if (item.page === 'live' && data.hasFrame) {
      const size = fitLivePreview(tryonFixture.width, tryonFixture.height, width, (item.height || 812) - 32, data.trackingMode === 'face');
      data.canvasWidth = size.width; data.canvasHeight = size.height;
    }
    const styles = (globalStyles + '\n' + source.styles)
      .replace(/(-?\d+(?:\.\d+)?)rpx\b/g, (_, n) => `${Number(n) / 7.5}vw`)
      .replace(/(^|\n)\uFEFF?page\s*\{/g, '$1body {');
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>辅助排版预览</title><style>
      html{font-size:${item.fontSize || 16}px}body{margin:0}view,movable-area,movable-view,scroll-view,block{display:block}
      text{display:inline}cover-view{display:block}button{font:inherit;cursor:pointer;border:0;margin:0;padding:0 14px}img{display:block;object-fit:contain}canvas{display:block}
      slider{display:block;height:24px;background:linear-gradient(var(--review-slider-color,#70552d),var(--review-slider-color,#70552d)) center/100% 3px no-repeat;position:relative}slider:after{content:'';position:absolute;left:50%;top:0;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #999}switch{display:block;width:50px;height:28px;border-radius:16px;background:#aaa}camera{display:block;background:#e4e2df}
      ${styles}
      .review-banner{padding:8px 12px;background:#f7f7f6;color:#626262;font:11px/1.4 Arial,sans-serif;text-align:center}
    </style></head><body><aside class="review-banner">浏览器辅助排版 · 非微信运行截图 · 图像及色值均为测试夹具</aside><main id="review-root"></main></body></html>`);
    await page.evaluate(({ template, data }) => {
      const root = document.querySelector('#review-root');
      root.innerHTML = template.replace(/<page-meta\b[^>]*\/>/g, '')
        .replace(/<(canvas|camera|slider|switch)\b([^>]*?)\/>/g, '<$1$2></$1>')
        .replace(/<camera\b/g, '<view').replace(/<\/camera>/g, '</view>')
        .replace(/<image\b/g, '<img').replace(/<\/image>/g, '');
      // Evaluate only expressions from the trusted workspace template.
      const evaluate = value => Function(...Object.keys(data), `return (${value.replace(/^\{\{|\}\}$/g, '')})`)(...Object.values(data));
      const interpolate = value => value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression) ?? ''));
      function render(parent) {
        let matched = false;
        for (const child of [...parent.childNodes]) {
          if (child.nodeType === Node.TEXT_NODE) { child.textContent = interpolate(child.textContent); continue; }
          if (!(child instanceof Element)) continue;
          if (child.hasAttribute('wx:if')) {
            matched = Boolean(evaluate(child.getAttribute('wx:if')));
            if (!matched) { child.remove(); continue; }
          } else if (child.hasAttribute('wx:elif') || child.hasAttribute('wx:else')) {
            const show = !matched && (!child.hasAttribute('wx:elif') || Boolean(evaluate(child.getAttribute('wx:elif'))));
            if (!show) { child.remove(); continue; }
            matched = true;
          } else { matched = false; }
          if (child.hasAttribute('wx:for')) throw new Error('Active loops need an explicit layout fixture');
          for (const attribute of [...child.attributes]) {
            if (attribute.name.startsWith('wx:')) { child.removeAttribute(attribute.name); continue; }
            const value = interpolate(attribute.value);
            if (attribute.name === 'disabled' && value === 'false') child.removeAttribute('disabled');
            else child.setAttribute(attribute.name, value);
          }
          if (child.tagName === 'SLIDER') child.style.setProperty('--review-slider-color', child.getAttribute('activecolor') || '#70552d');
          render(child);
        }
      }
      render(root);
    }, { template: source.template, data });
    if (item.pixels) await page.evaluate(({ fixture, kind }) => {
      const canvas = document.querySelector('#tryonCanvas, #liveCanvas');
      const height = canvas.getBoundingClientRect().width * fixture.height / fixture.width;
      if (canvas.id !== 'liveCanvas') { canvas.style.height = `${height}px`; canvas.parentElement.style.height = `${height}px`; }
      canvas.width = fixture.width; canvas.height = fixture.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(fixture[kind]), fixture.width, fixture.height), 0, 0);
    }, { fixture: tryonFixture, kind: item.pixels });
    await page.evaluate(() => document.fonts.ready);
    if (item.name.startsWith('live-face-unavailable')) {
      const recovery = await page.locator('.tracking-error').boundingBox();
      const controls = await page.locator('.category-list').boundingBox();
      assert(recovery && controls && recovery.y + recovery.height <= controls.y, 'Tracking errors must appear before the controls');
      assert.equal(await page.locator('button[bindtap="onRetryFace"]').count(), 1);
      assert.equal(await page.locator('.category-list').textContent(), '底妆待显示唇色待显示腮红待显示');
    }
    const measurements = await page.evaluate(() => {
      if (!getComputedStyle(document.body).getPropertyValue('--ink').trim()) throw new Error('Global page styles were not applied');
      const width = innerWidth;
      const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
      const overflow = [...document.querySelectorAll('#review-root *')].filter(element => {
        if (!visible(element) || element.closest('.sr-only,.processing-canvas')) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > width + 1;
      }).map(element => element.className || element.tagName);
      const smallButtons = [...document.querySelectorAll('button')].filter(visible).filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width < 43.9 || rect.height < 43.9;
      }).map(element => element.textContent.trim());
      const clippedText = [...document.querySelectorAll('text,button')].filter(visible).filter(element => {
        if (element.closest('.sr-only') || !element.clientWidth) return false;
        return element.scrollWidth > element.clientWidth + 1;
      }).map(element => element.className || element.tagName);
      const action = document.querySelector('#entry-live')?.getBoundingClientRect();
      return { width, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, overflow, smallButtons, clippedText, firstActionBottom: action?.bottom };
    });
    const screenshot = `${item.name}.png`;
    await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
    await writeFile(resolve(output, `${item.name}.html`), await page.content());
    let mirrorWhileSelecting;
    if (item.page === 'live' && data.hasFrame && data.trackingMode === 'face') {
      await page.locator('.shade-list').evaluate(element => element.scrollIntoView({ block: 'end' }));
      mirrorWhileSelecting = await page.evaluate(() => {
        const stage = document.querySelector('.live-stage').getBoundingClientRect();
        const mirror = document.querySelector('.mirror-viewport').getBoundingClientRect();
        const shades = document.querySelector('.shade-list').getBoundingClientRect();
        return { frameAspect: stage.width / stage.height, stageTop: stage.top, stageBottom: stage.bottom,
          shadesTop: shades.top, shadesBottom: shades.bottom,
          passed: stage.top >= -1 && stage.bottom <= innerHeight && shades.top >= mirror.bottom - 1 && shades.bottom <= innerHeight + 1 };
      });
      mirrorWhileSelecting.passed &&= Math.abs(mirrorWhileSelecting.frameAspect - tryonFixture.width / tryonFixture.height) < .001;
      await page.screenshot({ path: resolve(output, `${item.name}-selecting.png`) });
    }
    report.cases.push({ name: item.name, fontSize: item.fontSize || 16, screenshot, ...measurements, mirrorWhileSelecting });
    await page.close();
  }
  const overview = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  const panels = await Promise.all(['entry', 'studio-makeup', 'live-tracking'].map(async (name, i) => {
    const bytes = await readFile(resolve(output, `${name}.png`));
    return `<figure><figcaption>${['01 你的随身试妆镜', '02 照片妆效工作室', '03 摄像头模式布局'][i]}</figcaption><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${name} 辅助排版预览"></figure>`;
  }));
  await overview.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>EVEN TONE 界面预览</title><style>
    *{box-sizing:border-box}body{margin:0;padding:36px;background:#f3f3f1;color:#151515;font-family:Arial,'Microsoft YaHei',sans-serif}
    h1{margin:0 0 10px;font-size:26px;font-weight:500;letter-spacing:2px}p{font-size:14px;color:#626262;line-height:1.7;margin:0 0 24px}
    main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}figure{margin:0}figcaption{font-size:14px;padding:12px 0;border-top:2px solid #d8bb87}img{width:100%;display:block;border:1px solid #e4e2df}
  </style></head><body><h1>EVEN TONE · 虚拟试妆界面预览</h1><p>浏览器辅助渲染，未经过微信原生运行验收。图像为合成插画，妆效由本地算法生成；不是真人测试或商品效果证据。</p><main>${panels.join('')}</main></body></html>`);
  await overview.screenshot({ path: resolve(output, 'overview.png'), fullPage: true });
  await writeFile(resolve(output, 'overview.html'), await overview.content());
  await overview.close();
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const failures = report.cases.filter(c => c.overflow.length || c.smallButtons.length || c.clippedText.length || c.scrollWidth > c.width || c.mirrorWhileSelecting?.passed === false);
console.log(JSON.stringify({ output, cases: report.cases.length, failures }, null, 2));
assert.equal(failures.length, 0, 'Auxiliary layout issues; see report.json and screenshots');
