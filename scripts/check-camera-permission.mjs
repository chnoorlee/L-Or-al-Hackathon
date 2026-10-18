// Observe one real permission attempt in the authorized local development IDE.
// No authorization or frame mocks; this is not a physical-camera acceptance test.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWechatClient } from './wechat-mcp.mjs';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(project, '.artifacts/native-camera');
await mkdir(output, { recursive: true });
const client = await createWechatClient();
const call = (name, args = {}) => client.call(name, { project, ...args });
const evaluate = async fn => (await call('automation_evaluate', { action: 'evaluate', fnSource: fn.toString() })).result.result;
const report = { observedAt: new Date().toISOString(), environment: 'WeChat DevTools native simulator', mocks: [], realCameraValidated: false };
try {
  // Never restore APIs that this process has not mocked: this IDE can delete
  // them instead of restoring them. A new project window provides native APIs.
  await call('close_project_window');
  await call('open_project_window', { windowMode: 'fullMode' });
  report.apiPresence = await evaluate(function() {
    return { authorize: typeof wx.authorize, createCameraContext: typeof wx.createCameraContext };
  });
  if (Object.values(report.apiPresence).some(type => type !== 'function')) throw new Error('Native camera APIs unavailable before permission attempt');
  await call('automation_navigate', { action: 'reLaunch', url: '/pages/live/index', wait: 1 });
  await call('automation_element_action', { action: 'tap', selector: '.primary-button', wait: 0 });
  report.interaction = 'native enable-camera button tap';
  report.initial = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0];
    return { pending: p.data.cameraPending, enabled: p.data.cameraEnabled, phase: p.data.phase, error: p.data.error };
  });
  await new Promise(resolve => setTimeout(resolve, 11_500));
  report.afterWait = await evaluate(function() {
    const p = getCurrentPages().slice(-1)[0];
    return { pending: p.data.cameraPending, enabled: p.data.cameraEnabled, phase: p.data.phase,
      hasFrame: p.data.hasFrame, gpu: p.data.gpu, renderMs: p.data.renderMs,
      privacyVisible: p.data.privacyVisible, status: p.data.status, error: p.data.error };
  });
  await call('simulator_screenshot', { path: resolve(output, 'permission-result.png'), optimize: false });
  console.log(JSON.stringify(report.afterWait));
} catch (error) {
  report.error = String(error); process.exitCode = 1;
} finally {
  try {
    await evaluate(function() { const p = getCurrentPages().slice(-1)[0]; if (p.route === 'pages/live/index') p.stopCamera(); return true; });
    report.cameraStoppedAfterProbe = true;
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Permission observation: ${resolve(output, 'report.json')}`);
}
