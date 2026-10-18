import type { FaceAnchor } from "../../miniprogram/tryon/face-detector";

/** Synthetic geometry in Tencent's documented layout. Not inference/accuracy evidence. */
export function face106(transform = (x: number, y: number) => ({ x, y })): FaceAnchor {
  const points = Array.from({ length: 106 }, () => ({ x: .5, y: .5 }));
  const set = (indices: number[], coordinates: number[][]) => indices.forEach((id, i) => { points[id] = { x: coordinates[i][0], y: coordinates[i][1] }; });
  for (let i = 0; i < 33; i++) { const t = Math.PI - i * Math.PI / 32; points[i] = { x: .5 + .28 * Math.cos(t), y: .32 + .53 * Math.sin(t) }; }
  set([33,34,35,36,37,64,65,66,67], [[.30,.34],[.33,.31],[.37,.30],[.41,.32],[.44,.34],[.33,.35],[.37,.34],[.40,.35],[.42,.36]]);
  set([38,39,40,41,42,68,69,70,71], [[.56,.34],[.59,.32],[.63,.30],[.67,.31],[.70,.34],[.58,.36],[.60,.35],[.63,.34],[.67,.35]]);
  set([43,44,45,46,47,48,49,50,51,80,81,82,83], [[.5,.36],[.5,.43],[.5,.49],[.5,.55],[.44,.56],[.47,.58],[.5,.59],[.53,.58],[.56,.56],[.46,.53],[.54,.53],[.47,.56],[.53,.56]]);
  set([52,53,72,54,55,56,73,57], [[.30,.40],[.33,.38],[.37,.375],[.40,.38],[.43,.4],[.40,.42],[.37,.425],[.33,.42]]);
  set([58,59,75,60,61,62,76,63], [[.57,.4],[.60,.38],[.63,.375],[.67,.38],[.70,.40],[.67,.42],[.63,.425],[.60,.42]]);
  set([84,85,86,87,88,89,90,91,92,93,94,95], [[.39,.68],[.42,.65],[.46,.64],[.5,.65],[.54,.64],[.58,.65],[.61,.68],[.58,.71],[.54,.73],[.5,.735],[.46,.73],[.42,.71]]);
  set([96,97,98,99,100,101,102,103], [[.42,.68],[.46,.668],[.5,.67],[.54,.668],[.58,.68],[.54,.70],[.5,.705],[.46,.70]]);
  return { points: points.map(p => transform(p.x, p.y)), confidence: Array(106).fill(1), origin: { x: .22, y: .2 }, size: { width: .56, height: .65 } };
}
export function faceFrame(size = 256, skin = [158, 111, 86]) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const lip = x / size > .38 && x / size < .62 && y / size > .63 && y / size < .75;
    data.set([...(lip ? [139, 78, 82] : skin), 255], (y * size + x) * 4);
  }
  return { width: size, height: size, data };
}

/** Artificial texture for motion tests only; not a photograph or model result. */
export function texturedFaceFrame(size = 160, shiftX = 0, shiftY = 0, angle = 0, scale = 1) {
  const image = faceFrame(size), c = Math.cos(angle), s = Math.sin(angle);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x - size / 2 - shiftX, v = y - size / 2 - shiftY;
    const xx = (c * u + s * v) / scale + size / 2, yy = (-s * u + c * v) / scale + size / 2;
    const value = Math.round(14 * Math.sin(xx * .57) + 13 * Math.cos(yy * .49) + 11 * Math.sin((xx + yy) * .37));
    const i = (y * size + x) * 4;
    image.data[i] = 158 + value; image.data[i + 1] = 111 + value; image.data[i + 2] = 86 + value;
  }
  return image;
}
