// Original EVEN TONE mark. Generate binary artwork without external assets.
import { writeFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, bytes, tail]);
}
function png(size, inset = false, splash = false) {
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let px = (x / size - .5) / (splash ? .24 : inset ? .65 : 1), py = (y / size - .5) / (splash ? .24 : inset ? .65 : 1);
    let color = splash ? [248, 249, 252] : [64, 54, 88];
    const ellipse = (cx, cy, rx, ry) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1;
    if (ellipse(-.075, .015, .25, .30)) color = [196, 153, 128];
    if (ellipse(.09, -.055, .15, .19) || ellipse(.145, .09, .14, .11)) color = [237, 213, 186];
    // Two contrasting but connected skin-tone shapes express choice and continuity.
    if (Math.abs(py - .035) < .016 && px > -.205 && px < .025) color = [64, 54, 88];
    if (Math.abs(py + .045) < .016 && px > -.205 && px < .025) color = [64, 54, 88];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    color.forEach((c, i) => rows[offset + i] = c);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  for (const name of ['ic_launcher', 'ic_launcher_round']) writeFileSync(`android/app/src/main/res/mipmap-${density}/${name}.png`, png(48 * scale));
  writeFileSync(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, png(108 * scale, true));
}
writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', png(1024));
for (const name of readdirSync('ios/App/App/Assets.xcassets/Splash.imageset').filter(n => n.endsWith('.png'))) {
  writeFileSync(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, png(2732, false, true));
}
console.log('Original app icons and iOS launch artwork generated.');
