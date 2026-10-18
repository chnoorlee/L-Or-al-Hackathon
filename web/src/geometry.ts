import type { Point } from './types';
// Ordered loops for the documented MediaPipe 478-point face mesh. Inner lips are a hole, never painted.
export const FACE = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export const LIPS = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
export const MOUTH = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
export const EYES = [[33,160,158,133,153,144],[362,385,387,263,373,380]];
export const BROWS = [[70,63,105,66,107,55,65,52,53,46],[336,296,334,293,300,276,283,282,295,285]];
export const NOSE = [168,193,122,196,3,51,48,64,98,97,2,326,327,294,278,281,248,419,351,417];
export const UPPER_LIDS = [[33,246,161,160,159,158,157,173,133],[362,398,384,385,386,387,388,466,263]];
export const EYE_SHADOW = [[33,246,161,160,159,158,157,173,133,55,65,52,53,46],[362,398,384,385,386,387,388,466,263,276,283,282,295,285]];

export function validFace(points: Point[]): boolean {
  return points.length >= 468 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    && Math.hypot(points[234].x - points[454].x, points[234].y - points[454].y) > .075;
}

/** One Euro filtering: suppress stationary jitter, increase response during motion. */
export class LandmarkFilter {
  private previous: Point[] = [];
  private velocity: Point[] = [];
  private time = 0;
  reset() { this.previous = []; this.velocity = []; this.time = 0; }
  update(points: Point[], time: number): Point[] {
    if (this.previous.length !== points.length || time - this.time > 300) {
      this.previous = points.map(p => ({ ...p })); this.velocity = points.map(() => ({ x: 0, y: 0, z: 0 })); this.time = time;
      return this.previous;
    }
    const dt = Math.max(.001, (time - this.time) / 1000);
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const output = points.map((p, i) => {
      const out = { ...p };
      for (const axis of ['x', 'y', 'z'] as const) {
        const v = (p[axis] - this.previous[i][axis]) / dt;
        this.velocity[i][axis] += alpha(1) * (v - this.velocity[i][axis]);
        out[axis] = this.previous[i][axis] + alpha(3 + 25 * Math.abs(this.velocity[i][axis])) * (p[axis] - this.previous[i][axis]);
      }
      return out;
    });
    this.previous = output; this.time = time; return output;
  }
}

export function sampleSkin(source: CanvasImageSource, points: Point[]): [number, number, number] | null {
  if (!validFace(points)) return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(source, 0, 0, 128, 128);
  const data = ctx.getImageData(0, 0, 128, 128).data;
  const channels: number[][] = [[], [], []];
  for (const index of [50,101,118,119,280,330,347,348]) {
    const p = points[index]; const x = Math.max(2, Math.min(125, Math.round(p.x * 128))); const y = Math.max(2, Math.min(125, Math.round(p.y * 128)));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const offset = ((y + dy) * 128 + x + dx) * 4;
      for (let c = 0; c < 3; c++) channels[c].push(data[offset + c] / 255);
    }
  }
  return channels.map(c => c.sort((a,b) => a-b)[Math.floor(c.length / 2)]) as [number, number, number];
}

/** All masks share the source image coordinate system. CSS mirror applies to both video and overlay. */
export class MaskAtlas {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  readonly tile = 256;
  constructor() { this.canvas.width = 1024; this.canvas.height = 768; this.ctx = this.canvas.getContext('2d')!; }
  update(points: Point[]) {
    const c = this.ctx, size = this.tile;
    c.clearRect(0,0,1024,768);
    if (!validFace(points)) return;
    const xy = (p: Point) => [p.x * size, p.y * size];
    const faceWidth = Math.hypot(points[234].x-points[454].x,points[234].y-points[454].y)*size;
    const loop = (indices: number[], expansion = 1) => {
      const mid = indices.reduce((a,i) => ({x:a.x+points[i].x/indices.length,y:a.y+points[i].y/indices.length}),{x:0,y:0});
      c.beginPath();
      indices.forEach((i,j) => { const p = points[i]; const x=(mid.x+(p.x-mid.x)*expansion)*size,y=(mid.y+(p.y-mid.y)*expansion)*size; if(!j)c.moveTo(x,y);else c.lineTo(x,y); }); c.closePath(); c.fill();
    };
    const hole = (indices: number[], expansion=1) => { c.save(); c.shadowBlur=0;c.globalCompositeOperation='destination-out';loop(indices,expansion);c.restore(); };
    const ellipse = (indices: number[], rx: number, ry: number, opacity = 1) => {
      const p=indices.reduce((a,i)=>({x:a.x+points[i].x/indices.length,y:a.y+points[i].y/indices.length}),{x:0,y:0});
      const angle=Math.atan2(points[263].y-points[33].y,points[263].x-points[33].x);
      c.save();c.translate(p.x*size,p.y*size);c.rotate(angle);c.scale(rx*faceWidth,ry*faceWidth);
      const g=c.createRadialGradient(0,0,.12,0,0,1);g.addColorStop(0,`rgba(255,255,255,${opacity})`);g.addColorStop(.45,`rgba(255,255,255,${opacity*.75})`);g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();
    };
    for(let layer=0;layer<11;layer++) {
      c.save();c.translate((layer%4)*size,Math.floor(layer/4)*size);c.beginPath();c.rect(0,0,size,size);c.clip();
      c.fillStyle='white';c.strokeStyle='white';c.lineJoin='round';c.lineCap='round';c.shadowColor='white';c.shadowBlur=Math.max(.5,faceWidth*.008);
      if(layer===0) { loop(FACE); EYES.forEach(e=>hole(e,1.25));BROWS.forEach(e=>hole(e,1.1));hole(LIPS,1.13);hole(NOSE,1.03); }
      if(layer===1) { ellipse([101,118,119],.14,.09);ellipse([330,347,348],.14,.09);EYES.forEach(e=>hole(e,1.22));hole(NOSE,1.1); }
      if(layer===2) { ellipse([123,147],.17,.13);ellipse([352,376],.17,.13); }
      if(layer===3) { ellipse([50,101,205],.18,.12);ellipse([280,330,425],.18,.12); }
      if(layer===4) { ellipse([116,117,118],.13,.055);ellipse([345,346,347],.13,.055); }
      if(layer===5||layer===6) {loop(LIPS);hole(MOUTH,1.02);}
      if(layer===7) {EYE_SHADOW.forEach(e=>loop(e));EYES.forEach(e=>hole(e,1.08));BROWS.forEach(e=>hole(e,1.02));}
      if(layer===8) BROWS.forEach(e=>loop(e));
      if(layer===9||layer===10) {
        for(const indices of UPPER_LIDS) {
          // Eyeliner follows the eyelid; mascara is a restrained stylized lash preview.
          const eye=points[indices[4]],lower=points[indices===UPPER_LIDS[0]?145:374];
          if(Math.abs(lower.y-eye.y)<.003) continue;
          c.lineWidth=Math.max(.5,faceWidth*(layer===9?.009:.006));c.beginPath();
          indices.forEach((id,j)=>{ const [x,y]=xy(points[id]);if(!j)c.moveTo(x,y);else c.lineTo(x,y); });c.stroke();
          if(layer===10) indices.slice(1,-1).forEach((id,j)=>{const [x,y]=xy(points[id]);c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+(j-3)*.22,y-faceWidth*.018,x+(j-3)*.38,y-faceWidth*.032);c.stroke();});
        }
      }
      // Restrict cheek cosmetics to the detected facial contour, even during head turns.
      if(layer>=1&&layer<=4) {c.shadowBlur=0;c.globalCompositeOperation='destination-in';loop(FACE);}
      c.restore();
    }
  }
}
