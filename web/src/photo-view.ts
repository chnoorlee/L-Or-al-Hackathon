/** Display-only magnification. Source pixels and exported resolution stay unchanged. */
export class PhotoView {
  zoom = 1;
  x = 0;
  y = 0;
  pan = false;

  reset() { this.zoom = 1; this.x = this.y = 0; this.pan = false; }
  resize(width: number, height: number) {
    if (this.zoom === 1) { this.x = this.y = 0; this.pan = false; return; }
    const limitX = width * (this.zoom - 1) / 2;
    const limitY = height * (this.zoom - 1) / 2;
    this.x = Math.max(-limitX, Math.min(limitX, this.x));
    this.y = Math.max(-limitY, Math.min(limitY, this.y));
  }
  scale(delta: number, width: number, height: number) {
    this.zoom = Math.max(1, Math.min(4, this.zoom + delta));
    this.resize(width, height);
  }
  move(dx: number, dy: number, width: number, height: number) {
    this.x += dx; this.y += dy; this.resize(width, height);
  }
  get transform() { return `translate(${this.x}px, ${this.y}px) scale(${this.zoom})`; }
}
