import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve('web/public/vendor');
await mkdir(root, { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', resolve(root, 'wasm'), { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/vision_bundle.js', resolve(root, 'vision_bundle.js'));
const models = [
  { file: 'face_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff' },
  { file: 'hair_segmenter.tflite', url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite', sha256: '2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84' },
];
const provenance = [];
for (const { file, url: modelUrl, sha256: expectedHash } of models) {
const modelPath = resolve(root, file);
let model;
try { model = await readFile(modelPath); } catch {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Model download: ${response.status}`);
  model = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(model).digest('hex') !== expectedHash) throw new Error('Unexpected model checksum');
  await writeFile(modelPath, model);
}
if (createHash('sha256').update(model).digest('hex') !== expectedHash) throw new Error('Local model checksum mismatch; restore the pinned model before building');
provenance.push({ file, modelUrl, sha256: expectedHash, bytes: model.length });
}
const license = await fetch('https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE');
if (!license.ok) throw new Error('Cannot retrieve MediaPipe license');
await writeFile(resolve(root, 'LICENSE'), await license.text());
await writeFile(resolve(root, 'provenance.json'), JSON.stringify({
  library: '@mediapipe/tasks-vision@1.1.1', license: 'Apache-2.0', models: provenance,
}, null, 2));
console.log(`Prepared ${provenance.length} pinned local models; runtime never needs a third-party CDN.`);
