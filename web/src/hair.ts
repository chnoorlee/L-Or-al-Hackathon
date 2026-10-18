/** Independent, single-flight segmentation. Slow hair inference never gates the camera or face worker. */
export class HairTracker {
  private worker?: Worker;
  private enabled = false;
  private ready = false;
  private busy = false;
  private failed = false;
  private generation = 0;
  private startedAt = 0;
  private captureAt = 0;
  private resultAt = 0;
  private photoDone = false;
  private photo = false;
  private warmed = false;
  private lastStatus = '';
  constructor(private mask: (alpha: Uint8Array, width: number, height: number) => void,
    private onStatus: (text: string) => void) {}
  private status(text: string) { if (text !== this.lastStatus) { this.lastStatus = text; this.onStatus(text); } }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.reset(); this.enabled = enabled;
    this.status(enabled ? '发色将在画面开启后定位' : '');
  }
  reset() {
    this.generation++; this.worker?.terminate(); this.worker = undefined; this.ready = this.busy = this.failed = this.warmed = false;
    this.photoDone = false; this.resultAt = this.captureAt = 0; this.mask(new Uint8Array(1), 1, 1);
    this.status('');
  }
  private fail() {
    this.worker?.terminate(); this.worker = undefined; this.ready = this.busy = false; this.failed = true; this.resultAt = 0;
    this.mask(new Uint8Array(1), 1, 1); this.status('发色定位未完成；可移除后重新选择，面部试妆可继续');
  }
  visibility(now: number, photo: boolean) { return this.resultAt ? (photo ? 1 : Math.max(0, Math.min(1, (400 - (now - this.resultAt)) / 150))) : 0; }
  step(source: HTMLVideoElement | ImageBitmap, photo: boolean, now: number) {
    if (!this.enabled || this.failed) return;
    this.photo = photo;
    if (!this.worker) {
      const worker = this.worker = new Worker(`${import.meta.env.BASE_URL}hair-worker.js`);
      this.startedAt = now; this.status('正在准备发色试妆…');
      worker.onerror = () => { if (this.worker === worker) this.fail(); };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if (data.type === 'loading') { this.status(String(data.text)); return; }
        if (data.type === 'ready') { this.ready = true; return; }
        this.busy = false;
        if (data.type === 'error') { this.fail(); return; }
        if (data.token !== this.generation) return;
        this.warmed = true;
        if (!this.photo && performance.now() - data.timestamp > 400) { this.status('发色定位较慢，暂不叠加'); return; }
        this.photoDone = this.photo;
        this.mask(data.alpha, data.width, data.height); this.resultAt = data.count ? data.timestamp : 0;
        this.status(data.count ? '发色已随头发定位' : '请让头发完整入镜');
      };
      worker.postMessage({ type: 'init' }); return;
    }
    if ((!this.ready && now - this.startedAt > 180000) || (this.busy && now - this.captureAt > (this.warmed ? 2500 : 15000))) { this.fail(); return; }
    if (!this.ready || this.busy || (photo && this.photoDone) || now - this.captureAt < 80) return;
    this.busy = true; this.captureAt = now;
    const generation = this.generation, worker = this.worker;
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    const scale = Math.min(1, 512 / Math.max(width, height));
    void createImageBitmap(source, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) })
      .then(bitmap => {
        if (generation !== this.generation || worker !== this.worker) { bitmap.close(); return; }
        worker.postMessage({ type: 'detect', token: generation, timestamp: now, photo, bitmap }, [bitmap]);
      }).catch(() => { if (generation === this.generation && worker === this.worker) this.fail(); });
  }
}
