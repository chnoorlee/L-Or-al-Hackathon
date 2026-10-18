// Invoke the installed official compilers without changing IDE security settings.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.artifacts/wechat-compile');
await mkdir(output, { recursive: true });
const bin = process.env.WECHAT_COMPILER_DIR || 'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
const { pages } = JSON.parse(await readFile(resolve(root, 'miniprogram/app.json'), 'utf8'));
const report = { kind: 'installed-official-template-compilers', nativeRuntimeValidated: false, checks: [] };
for (const [exe, extension, inputs] of [['wcc', 'wxml', pages.map(p => `${p}.wxml`)], ['wcsc', 'wxss', ['app.wxss', ...pages.map(p => `${p}.wxss`)] ]]) {
  const result = spawnSync(resolve(bin, `${exe}.exe`), ['-o', resolve(output, `${exe}-compiled.js`), ...inputs], { cwd: resolve(root, 'miniprogram'), encoding: 'utf8', windowsHide: true });
  report.checks.push({ compiler: exe, inputs, exitCode: result.status, diagnostics: result.stderr, error: result.error?.message });
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.checks.some(check => check.exitCode !== 0 || check.error)) process.exitCode = 1;
