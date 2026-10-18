// Synthetic color/texture fixture, never a real person or clinical benchmark.
// Self-contained so its source can run inside the native app service context.
export function createSyntheticFrame(width = 160, height = 180, shift = 0, hidden = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / width - shift, ny = y / height;
    const arm = ((nx - .5) / .32) ** 2 + ((ny - .58) / .8) ** 2 < 1;
    const patch = !hidden && ((nx - .43) / (.105 + .015 * Math.sin(ny * 40))) ** 2 + ((ny - .5) / .17) ** 2 < 1;
    const texture = Math.sin(x * 1.7 + y * 2.1) * 1.6 + Math.sin(x * .05) * 3;
    const shade = 1 - .14 * Math.abs(nx - .5) / .32;
    const rgb = !arm ? [239, 237, 233] : patch ? [226, 197, 178] : [170, 124, 98];
    data.set([...rgb.map(v => !arm ? v : Math.round(v * shade + texture)), 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
