// Synthetic illustration only: no human photo, no medical or product-efficacy evidence.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const compiled = resolve(root, '.artifacts/tryon-compiled');
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--module', 'commonjs', '--target', 'ES2020', '--skipLibCheck', '--outDir', compiled, resolve(root, 'miniprogram/tryon/engine.ts')], { cwd: root, windowsHide: true });
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const js = readFileSync(path, 'utf8');
  vm.runInNewContext(js, { exports, require: specifier => load(resolve(dirname(path), `${specifier}.js`)) }, { filename: path });
  return exports;
}
const { TryOnEngine, DEFAULT_RENDER } = load(resolve(compiled, 'tryon/engine.js'));
const { srgbToLab } = load(resolve(compiled, 'core/color.js'));
export { DEFAULT_RENDER };
const width = 320, height = 360;
const data = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const nx = x / width, ny = y / height;
  const arm = ((nx - .5) / .32) ** 2 + ((ny - .58) / .8) ** 2 < 1;
  const patch = ((nx - .43) / (.105 + .015 * Math.sin(ny * 40))) ** 2 + ((ny - .5) / .17) ** 2 < 1;
  const texture = Math.sin(x * 1.7 + y * 2.1) * 1.6 + Math.sin(x * .05) * 3;
  const shade = 1 - .14 * Math.abs(nx - .5) / .32;
  const rgb = !arm ? [239, 237, 233] : patch ? [226, 197, 178] : [170, 124, 98];
  data.set([...rgb.map(v => !arm ? v : Math.round(v * shade + texture)), 255], (y * width + x) * 4);
}
const a = { x: .43, y: .5, radius: .045 }, b = { x: .69, y: .5, radius: .045 };
function rgbAt(point) { const i = (Math.floor(point.y * height) * width + Math.floor(point.x * width)) * 4; return { r: data[i], g: data[i+1], b: data[i+2] }; }
const engine = new TryOnEngine({ width, height, data }, a, b, srgbToLab(rgbAt(a)), srgbToLab(rgbAt(b)), rgbAt(b));
engine.segment();
export const fixture = {
  width, height, original: Array.from(data),
  region: Array.from(engine.render({ ...DEFAULT_RENDER, mode: 'effect', strength: 0, outline: true })),
  makeup: Array.from(engine.render({ ...DEFAULT_RENDER, mode: 'split', split: 42, outline: false })),
  live: Array.from(engine.render({ ...DEFAULT_RENDER, mode: 'effect', outline: false })),
};
engine.dispose();
