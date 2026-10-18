import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWechatClient } from './wechat-mcp.mjs';
import { createSyntheticFrame } from './native-fixture.mjs';

// Runs against the authorized local IDE. Clears the current development session.
// Camera acquisition/permission are mocked; the page, tracker and canvas are real.
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const liveOnly = process.argv.includes('--live-only');
const photoCamera = process.argv.includes('--photo-camera');
if (liveOnly && photoCamera) throw new Error('--photo-camera cannot be combined with --live-only');
const output = resolve(project, photoCamera ? '.artifacts/native-photo-camera' : '.artifacts/native-smoke');
const photoSource = photoCamera ? 'camera' : 'album';
const skipScreenshots = process.argv.includes('--skip-screenshots');
await mkdir(output, { recursive: true });
const client = await createWechatClient();
const report = {
  startedAt: new Date().toISOString(), environment: 'WeChat DevTools native simulator',
  scope: liveOnly ? 'live-only' : 'photo-and-live',
  fixture: 'synthetic color/texture illustration; no patient or product data',
  realCameraValidated: false, productCalibrationValidated: false,
  photoMock: liveOnly ? null : 'chooseMedia returns a synthetic PNG made by native canvas',
  photoSource: liveOnly ? null : photoSource,
  liveMocks: ['authorize', 'createCameraContext / onCameraFrame; 160x180 synthetic frames'],
  checks: [], screenshots: [], cleanup: [], passed: false,
};
const mocks = new Set();
const call = (name, args = {}) => {
  if (process.env.NATIVE_TRACE) console.log(`[native] ${name} ${args.action || ''}`);
  return client.call(name, { project, ...args });
};
const evaluate = async (fnSource, args = []) => {
  const source = typeof fnSource === 'string' ? fnSource : fnSource.toString();
  const wrapped = `async function(...args) {
    try { const value = await (${source})(...args); return value === undefined ? null : value; }
    catch(error) { return { __nativeTestError: String(error), stack: error.stack }; }
  }`;
  const value = (await call('automation_evaluate', { action: 'evaluate', fnSource: wrapped, args })).result.result;
  if (value?.__nativeTestError) throw new Error(`${value.__nativeTestError}\n${value.stack || ''}`);
  return value;
};
// Read the active page in the app service: DevTools may retain a stale page
// object in automation_page_action after a native navigation or recompilation.
const data = () => evaluate(function() { return getCurrentPages().slice(-1)[0].data; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  console.log(`Waiting: ${label}`);
  const deadline = Date.now() + 20_000;
  let state;
  do {
    state = await data();
    if (predicate(state)) return state;
    await pause(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}; state=${JSON.stringify(state)}`);
}
function check(name, condition, evidence) {
  report.checks.push({ name, passed: !!condition, evidence });
  assert.ok(condition, `${name}: ${JSON.stringify(evidence)}`);
  console.log(`PASS ${name}`);
}
async function screenshot(name) {
  if (skipScreenshots) return;
  await call('simulator_screenshot', { path: resolve(output, `${name}.png`), optimize: false });
  report.screenshots.push(`${name}.png`);
}
async function mock(method, payload) {
  // Register before dispatch so an ambiguous response still triggers restoration.
  mocks.add(method);
  await call('automation_wx_api', { action: 'mock', method, ...payload });
}
async function navigate(action, url) {
  await call('automation_navigate', { action, ...(url ? { url } : {}), wait: 1 });
}

try {
  // A restore without a matching mock can delete the native API in this IDE.
  // Reopen the project to discard an interrupted run's overrides completely.
  await call('close_project_window');
  await call('open_project_window', { windowMode: 'fullMode' });
  try { await navigate('reLaunch', '/pages/entry/index'); }
  catch (error) {
    // A newly opened IDE window can expose MCP before its automator is ready.
    // Only retry this idempotent initial navigation for that specific failure.
    if (!String(error).includes('waitForAutomatorReady timeout')) throw error;
    await pause(1500);
    await navigate('reLaunch', '/pages/entry/index');
  }
  if (!liveOnly) {
  await screenshot('01-entry');
  await call('automation_element_action', { action: 'tap', selector: '#entry-guide-toggle', wait: 0.3 });
  const expandedGuide = await data();
  check('entry guide opens on demand', expandedGuide.guideExpanded === true, { expanded: expandedGuide.guideExpanded });
  await call('automation_element_action', { action: 'tap', selector: '#entry-guide-toggle', wait: 0.3 });
  check('entry guide collapses without starting a photo session', !(await data()).guideExpanded, {});
  const fixture = await evaluate(`async function() {
    const p = getCurrentPages().slice(-1)[0], canvas = await p.getNormalizationCanvas();
    const frame = (${createSyntheticFrame.toString()})(320, 360);
    canvas.width = frame.width; canvas.height = frame.height;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(frame.width, frame.height);
    image.data.set(frame.data); ctx.putImageData(image, 0, 0);
    return new Promise((resolve, reject) => wx.canvasToTempFilePath({canvas, fileType:'png', success:r=>resolve({path:r.tempFilePath}), fail:reject}, p));
  }`);
  await mock('chooseMedia', { functionDeclaration: `function(options) {
    getApp().__nativePhotoRequest = { sourceType: options.sourceType, mediaType: options.mediaType, count: options.count };
    return ${JSON.stringify({ tempFiles: [{ tempFilePath: fixture.path, fileType: 'image', size: 50000 }], type: 'image' })};
  }` });
  await call('automation_element_action', { action: 'tap', selector: photoCamera ? '#entry-camera' : '#entry-album', wait: 1 });
  await waitFor(s => s.layoutReady, 'sample image layout');
  const photoRequest = await evaluate(function() {
    const request = getApp().__nativePhotoRequest; delete getApp().__nativePhotoRequest; return request;
  });
  check('photo button requests the selected native image source', photoRequest?.sourceType?.length === 1 && photoRequest.sourceType[0] === photoSource && photoRequest.mediaType?.length === 1 && photoRequest.mediaType[0] === 'image' && photoRequest.count === 1, photoRequest);
  const samples = await evaluate(async function() {
    const p = getCurrentPages().slice(-1)[0];
    const tap = async x => {
      const rect = await p.measureImageRect();
      p.onImageTap({ touches: [], changedTouches: [{ clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * .5 }] });
    };
    await tap(.43); await new Promise(r => setTimeout(r, 300));
    p.onSelectMarker({ currentTarget: { dataset: { marker: 'reference' } } });
    await tap(.69); await new Promise(r => setTimeout(r, 300));
    return { canAnalyze: p.data.canAnalyze, a: p.data.coverCircle, b: p.data.referenceCircle };
  });
  check('native photo decoding and A/B sampling', samples.canAnalyze && samples.a && samples.b, samples);
  await screenshot('02-sample');
  await call('automation_element_action', { action: 'tap', selector: '.sample-actions .primary-button', wait: 1 });
  const studio = await waitFor(s => s.ready && s.selectedPixels > 0, 'photo segmentation');
  check('native region segmentation', !studio.error, { selectedPixels: studio.selectedPixels, shade: studio.shadeHex });
  await screenshot('03-region');
  const undo = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0], initial = p.data.selectedPixels;
    p.onClear(); const cleared = p.data.selectedPixels;
    p.onConfirmRegion(); const emptyPanel = p.data.panel;
    p.onUndo(); return { initial, cleared, emptyPanel, restored: p.data.selectedPixels };
  });
  check('empty region cannot confirm; undo restores selection', undo.cleared === 0 && undo.emptyPanel === 'region' && undo.restored === undo.initial, undo);
  const makeup = await evaluate(async function() {
    const p = getCurrentPages().slice(-1)[0]; p.onConfirmRegion();
    for (const formula of ['sheer', 'soft', 'concealer']) {
      p.onChoice({ currentTarget: { dataset: { key: 'formula', value: formula } } });
      await new Promise(r => setTimeout(r, 120));
      if (p.data.formula !== formula || p.data.error) throw new Error('Template failed: ' + formula);
    }
    p.onControl({ currentTarget: { dataset: { key: 'strength' } }, detail: { value: 85 } });
    p.onChoice({ currentTarget: { dataset: { key: 'mode', value: 'split' } } });
    await new Promise(r => setTimeout(r, 200));
    return { panel: p.data.panel, formula: p.data.formula, strength: p.data.strength, mode: p.data.mode, error: p.data.error };
  });
  check('three native makeup templates and split preview', makeup.panel === 'makeup' && makeup.mode === 'split' && makeup.strength === 85 && !makeup.error, makeup);
  await screenshot('04-makeup');
  await call('automation_element_action', { action: 'tap', selector: '#studio-fine-toggle', wait: 0.3 });
  const expandedFine = await data();
  check('photo fine controls expand without resetting makeup', expandedFine.fineTune === true && expandedFine.strength === 85 && expandedFine.formula === 'concealer', { fineTune: expandedFine.fineTune, strength: expandedFine.strength, formula: expandedFine.formula });
  await screenshot('04b-makeup-fine');
  await call('automation_element_action', { action: 'tap', selector: '#studio-fine-toggle', wait: 0.3 });
  check('photo fine controls collapse without resetting makeup', !(await data()).fineTune && (await data()).strength === 85, {});
  await navigate('navigateBack');
  await evaluate(function() { getCurrentPages().slice(-1)[0].onAnalyze(); return true; });
  const result = await waitFor(s => s.emptyTitle === '商品色号尚未接入', 'result page');
  check('native sample result without invented commerce', !result.showCommerceAction, { cover: result.coverColorText, reference: result.referenceColorText, commerce: result.showCommerceAction });
  await screenshot('05-result');
  await navigate('navigateBack');
  await evaluate(function() { getCurrentPages().slice(-1)[0].onTryOn(); return true; });
  await waitFor(s => s.ready, 'studio return');
  await evaluate(async function() { await getCurrentPages().slice(-1)[0].onFinish(); return true; });
  await pause(1000);
  const clearedPage = await evaluate(function() { return getCurrentPages().slice(-1)[0].route; });
  check('finish clears photo session and returns to entry', clearedPage === 'pages/entry/index', clearedPage);
  await call('automation_wx_api', { action: 'restore', method: 'chooseMedia' }); mocks.delete('chooseMedia');
  }

  console.log('Starting native live pipeline with explicitly synthetic frames.');
  await mock('authorize', { result: { errMsg: 'authorize:ok' } });
  await mock('createCameraContext', { functionDeclaration: `function() {
    return { onCameraFrame(callback) {
      const state = getApp().__nativeSmoke = { shift: 0, hidden: false, frames: 0, stopped: false };
      const emit = () => {
        const frame = (${createSyntheticFrame.toString()})(160, 180, state.shift, state.hidden);
        state.frames++; callback({width:frame.width, height:frame.height, data:frame.data.buffer});
      };
      return { start() { state.timer = setInterval(emit, 200); emit(); }, stop() { clearInterval(state.timer); state.stopped = true; } };
    }};
  }` });
  await navigate('navigateTo', '/pages/live/index');
  await evaluate(function() { getCurrentPages().slice(-1)[0].onTrackingMode({currentTarget:{dataset:{value:'region'}}}); return true; });
  await evaluate(async function() {
    const p = getCurrentPages().slice(-1)[0]; p.onEnableCamera();
    await new Promise(r => setTimeout(r, 500)); p.onCameraReady(); return true;
  });
  await waitFor(s => s.hasFrame && s.phase === 'view', 'synthetic camera frames');
  const calibration = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0]; p.onFreeze();
    // The actual preview uses this 160:180 aspect ratio; no canvas node crosses the automation bridge.
    const width = p.data.canvasHeight * 160 / 180;
    const tap = x => p.onSample({ touches: [], changedTouches: [{ x: width * x, y: p.data.canvasHeight * .5 }] });
    tap(.43); tap(.69);
    return { phase: p.data.phase, error: p.data.error };
  });
  check('native live freeze / A-B / outline confirmation', calibration.phase === 'review' && !calibration.error, calibration);
  await screenshot('06-live-calibration');
  console.log('Starting tracking after calibration.');
  await evaluate(function() { const p = getCurrentPages().slice(-1)[0]; p.onStartTracking(); return { phase: p.data.phase }; });
  await waitFor(s => s.phase === 'live', 'tracking started');
  console.log('Moving the synthetic target.');
  for (const shift of [.01, .02, .03]) {
    await evaluate(function(value) { getApp().__nativeSmoke.shift = value; return { shift: getApp().__nativeSmoke.shift }; }, [shift]);
    await pause(450);
  }
  await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0];
    p.onFormula({ currentTarget: { dataset: { value: 'soft' } } });
    p.onControl({ currentTarget: { dataset: { key: 'strength' } }, detail: { value: 65 } });
    return true;
  });
  await pause(450);
  const tracking = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0];
    return { phase: p.data.phase, hasFrame: p.data.hasFrame, formula: p.data.formula, strength: p.data.strength, gpu: p.data.gpu, frames: getApp().__nativeSmoke.frames, error: p.data.error };
  });
  check('native live rendering follows small synthetic movements', tracking.phase === 'live' && tracking.formula === 'soft' && tracking.strength === 65 && tracking.frames > 5 && !tracking.error, tracking);
  await screenshot('07-live-tracking');
  const comparison = await evaluate(function() {
    // Run the real handlers in the native app service. Continuous-frame UI taps
    // currently time out in this IDE's automation bridge; this is not tap proof.
    const p = getCurrentPages().slice(-1)[0]; p.onCompare(); p.onHoldOriginal();
    const held = p.data.holdingOriginal; p.onReleaseOriginal();
    p.onShade({currentTarget:{dataset:{value:'warm'}}});
    return {mode:p.data.mode,held,released:!p.data.holdingOriginal,warmth:p.data.warmth,gpu:p.data.gpu};
  });
  check('native GPU and comparison / shade handlers (not physical taps)', comparison.gpu && comparison.mode === 'split' && comparison.held && comparison.released && comparison.warmth === 12, comparison);
  await screenshot('07b-live-split');
  await evaluate(function() { getApp().__nativeSmoke.hidden = true; return true; });
  const lost = await waitFor(s => s.phase === 'lost', 'tracking loss');
  check('occlusion removes makeup while looking for the region', lost.hasFrame && lost.phase === 'lost', { phase: lost.phase, status: lost.status });
  // Screenshot latency must not turn a short occlusion into an expired track.
  await evaluate(function() { getApp().__nativeSmoke.hidden = false; return true; });
  await pause(600);
  const recovered = await waitFor(s => s.phase === 'live', 'local region recovery');
  check('short occlusion recovers after stable local detections', recovered.phase === 'live', { phase: recovered.phase });
  await screenshot('09-live-returned');
  const stopped = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0]; p.stopCamera();
    return { enabled: p.data.cameraEnabled, frame: p.data.hasFrame, phase: p.data.phase, listenerStopped: getApp().__nativeSmoke.stopped };
  });
  check('stop clears native preview and camera listener', !stopped.enabled && !stopped.frame && stopped.phase === 'off' && stopped.listenerStopped, stopped);
  await screenshot('10-live-stopped');
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  const cleanupSteps = [
    ['stop synthetic frame source', () => evaluate(function() {
      const p = getCurrentPages().slice(-1)[0]; if (p.route === 'pages/live/index') p.stopCamera();
      if (getApp().__nativeSmoke) { clearInterval(getApp().__nativeSmoke.timer); delete getApp().__nativeSmoke; }
      delete getApp().__nativePhotoRequest;
      return true;
    })],
    ...[...mocks].map(method => [`restore ${method}`, () => call('automation_wx_api', { action: 'restore', method })]),
    ['close development runtime', () => call('close_project_window')],
    ['reopen development runtime', () => call('open_project_window', { windowMode: 'fullMode' })],
    ['verify native APIs restored', async () => {
      await navigate('reLaunch', '/pages/entry/index');
      const state = await evaluate(function() {
        return { authorize: typeof wx.authorize, createCameraContext: typeof wx.createCameraContext,
          chooseMedia: typeof wx.chooseMedia, syntheticState: !!getApp().__nativeSmoke || !!getApp().__nativePhotoRequest };
      });
      assert.ok(!state.syntheticState && ['authorize', 'createCameraContext', 'chooseMedia'].every(key => state[key] === 'function'), JSON.stringify(state));
    }],
  ];
  for (const [name, action] of cleanupSteps) {
    try { await action(); report.cleanup.push({ name, passed: true }); }
    catch (error) { report.cleanup.push({ name, passed: false, error: String(error) }); report.passed = false; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = resolve(output, liveOnly ? 'report-live.json' : 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Native report: ${reportPath}`);
}
