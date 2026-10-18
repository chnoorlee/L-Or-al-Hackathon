import { srgbToLab } from '../../miniprogram/core/color';
import type { NormalizedCircle, Point, RgbColor } from '../../miniprogram/core/types';
import { DEFAULT_RENDER, TryOnEngine as RegionEngine, type RenderOptions } from '../../miniprogram/tryon/engine';

export type CoverStep = 'a' | 'b' | 'edit' | 'preview';
export type CoverTool = 'add' | 'erase' | 'region';

/** Object-fit: contain coordinates. Letterbox clicks must never become skin samples. */
export function imagePoint(x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number): Point | null {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  const px = (x - (width - w) / 2) / w, py = (y - (height - h) / 2) / h;
  return Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px <= 1 && py >= 0 && py <= 1 ? { x: px, y: py } : null;
}

export class LocalCover {
  step: CoverStep = 'a';
  tool: CoverTool = 'add';
  tolerance = 18;
  radius = 0.035;
  options: RenderOptions = { ...DEFAULT_RENDER, mode: 'effect', outline: false };
  a?: NormalizedCircle;
  b?: NormalizedCircle;
  aColor?: RgbColor;
  bColor?: RgbColor;
  target?: RgbColor;
  private source?: ImageData;
  private region?: RegionEngine;
  private generation = 0;
  private frame = 0;
  private last?: Point;
  private held = false;
  private split = -1;

  constructor(private canvas: HTMLCanvasElement, private changed: () => void, private message: (text: string) => void) {}
  get ready() { return !!this.source; }
  get hasRegion() { return !!this.region; }
  get canUndo() { return !!this.region?.canUndo; }
  get selectedPixels() { return this.region?.selectedPixels ?? 0; }

  async load(file: File): Promise<boolean> {
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的照片');
    this.clear();
    const generation = this.generation;
    const image = await createImageBitmap(file);
    try {
      if (generation !== this.generation) return false;
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      this.canvas.width = Math.max(1, Math.round(image.width * scale));
      this.canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      this.source = context.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.hidden = false;
      this.changed();
      this.draw();
      return true;
    } finally { image.close(); }
  }

  clear() {
    this.generation++;
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.region?.dispose(); this.region = undefined;
    this.source?.data.fill(0); this.source = undefined;
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.hidden = true;
    this.a = this.b = this.aColor = this.bColor = undefined;
    this.target = undefined; this.step = 'a'; this.last = undefined;
    this.held = false; this.split = -1; this.tolerance = 18; this.radius = 0.035; this.tool = 'add';
    this.options = { ...DEFAULT_RENDER, mode: 'effect', outline: false };
  }

  resample(which: 'a' | 'b') {
    if (!this.source) return;
    this.region?.dispose(); this.region = undefined;
    this.b = this.bColor = undefined;
    if (which === 'a') this.a = this.aColor = undefined;
    this.step = this.a ? 'b' : 'a'; this.last = undefined;
    this.target = undefined;
    this.changed(); this.draw();
  }

  private sample(point: Point): RgbColor | undefined {
    if (!this.source) return;
    const { width, height, data } = this.source;
    const x = Math.min(width - 1, Math.floor(point.x * width)), y = Math.min(height - 1, Math.floor(point.y * height));
    const radius = Math.max(1, Math.round(Math.min(width, height) * 0.012));
    const channels: number[][] = [[], [], []];
    for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
        const offset = (yy * width + xx) * 4;
        if (data[offset + 3] === 255) for (let c = 0; c < 3; c++) channels[c].push(data[offset + c]);
      }
    }
    if (!channels[0].length) return;
    const [r, g, b] = channels.map(c => c.sort((a, b) => a - b)[Math.floor(c.length / 2)]);
    return { r, g, b };
  }

  begin(point: Point) {
    if (!this.source || this.step === 'preview') return;
    if (this.step === 'a' || this.step === 'b') {
      const color = this.sample(point);
      if (!color) { this.message('这里是透明背景，请点选皮肤位置'); return; }
      const circle = { ...point, radius: 0.025 };
      if (this.step === 'a') { this.a = circle; this.aColor = color; this.step = 'b'; }
      else {
        const distance = Math.hypot((point.x - this.a!.x) * this.source.width, (point.y - this.a!.y) * this.source.height);
        if (distance < 0.05 * Math.min(this.source.width, this.source.height)) {
          this.message('请在选区外点一处周围皮肤，作为 B 肤色参考'); return;
        }
        this.b = circle; this.bColor = color;
        this.region = new RegionEngine(this.source, this.a!, this.b, srgbToLab(this.aColor!), srgbToLab(color), color);
        this.step = 'edit'; this.segment(false);
      }
    } else if (this.region) {
      if (this.tool === 'region') {
        const result = this.region.segment(this.tolerance, point, true);
        if (result.reason !== 'selected') this.message('此处与 A 的颜色不同，可用“补涂”手动加入');
      } else {
        this.region.checkpoint(); this.last = point;
        this.region.brush(point, point, this.radius, this.tool === 'erase');
      }
    }
    this.changed(); this.draw();
  }

  move(point: Point) {
    if (!this.last || !this.region || this.step !== 'edit') return;
    this.region.brush(this.last, point, this.radius, this.tool === 'erase');
    this.last = point; this.draw();
  }
  end() { this.last = undefined; this.changed(); }
  undo() { this.region?.undo(); this.changed(); this.draw(); }
  clearRegion() { this.region?.clear(); this.changed(); this.draw(); }
  segment(remember = true) {
    const result = this.region?.segment(this.tolerance, undefined, false, remember);
    if (!result) return;
    if (result.reason === 'similar_samples') this.message('A、B 颜色很接近，请重新取样，或用“补涂”手动圈选');
    else if (!result.selectedPixels) this.message('未圈出区域，可用“补涂”手动圈选');
    else if (result.touchesEdge) this.message('选区接近照片边缘，请检查是否圈入背景，用“擦除”修正');
    this.changed(); this.draw();
  }
  confirm() {
    if (!this.selectedPixels) { this.message('请先补涂至少一处想遮盖的区域'); return; }
    this.step = 'preview'; this.changed(); this.draw();
  }
  edit() { if (this.region) { this.step = 'edit'; this.changed(); this.draw(); } }
  compare(split: number, held: boolean) { this.split = split; this.held = held; this.draw(); }

  private pixels(exporting = false): Uint8ClampedArray | undefined {
    if (!this.source) return;
    if (!this.region || (!exporting && this.step !== 'preview')) return this.source.data.slice();
    return this.region.render({ ...this.options,
      mode: this.held ? 'original' : this.split >= 0 ? 'split' : 'effect', split: Math.max(0, this.split) * 100,
    }, this.target);
  }
  draw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const data = this.pixels();
      if (!data || !this.source) return;
      if (this.step === 'edit' && this.region) {
        for (let i = 0; i < this.region.mask.length; i++) if (this.region.mask[i]) {
          data[i * 4] = data[i * 4] * 0.6 + 112 * 0.4;
          data[i * 4 + 1] = data[i * 4 + 1] * 0.6 + 88 * 0.4;
          data[i * 4 + 2] = data[i * 4 + 2] * 0.6 + 182 * 0.4;
        }
      }
      const context = this.canvas.getContext('2d')!;
      const frame = context.createImageData(this.canvas.width, this.canvas.height);
      frame.data.set(data);
      context.putImageData(frame, 0, 0);
      if (this.step !== 'preview') for (const [label, point] of [['A', this.a], ['B', this.b]] as const) {
        if (!point) continue;
        const x = point.x * this.canvas.width, y = point.y * this.canvas.height;
        const r = Math.max(9, Math.min(this.canvas.width, this.canvas.height) * 0.023);
        context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2);
        context.fillStyle = label === 'A' ? '#493c69' : '#285c58'; context.fill();
        context.strokeStyle = 'white'; context.lineWidth = 2; context.stroke();
        context.fillStyle = 'white'; context.font = `bold ${r * 1.2}px sans-serif`;
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, x, y);
      }
    });
  }
  async snapshot(): Promise<Blob> {
    if (this.step !== 'preview' || !this.source) throw new Error('先确认选区，再保存遮瑕预览');
    const canvas = document.createElement('canvas');
    canvas.width = this.canvas.width; canvas.height = this.canvas.height;
    const context = canvas.getContext('2d')!;
    const frame = context.createImageData(canvas.width, canvas.height);
    frame.data.set(this.pixels(true)!);
    context.putImageData(frame, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      canvas.width = canvas.height = 0;
      if (blob) resolve(blob); else reject(new Error('图片生成失败，请再试一次'));
    }, 'image/png'));
  }
}
