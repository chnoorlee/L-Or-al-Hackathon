// Read only public product facts and website hex swatches. These are NOT measured cosmetic colors.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = 'https://www.lorealparisusa.com';
const sections = [
  ['lipstick', 'lip-color/lipstick'], ['gloss', 'lip-color/lip-gloss'],
  ['foundation', 'face/foundation-makeup'], ['concealer', 'face/concealer'],
  ['blush', 'face/blush'], ['bronzer', 'face/bronzer'], ['highlighter', 'face/highlighters'],
  ['eyeshadow', 'eye/eye-shadow'], ['eyeliner', 'eye/eyeliner'],
  ['brow', 'eye/eyebrow'], ['mascara', 'eye/mascara'],
  ['hair', '/hair-color/permanent'],
];
const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const products = [];
const errors = [];
for (const [category, path] of sections) {
  const prefix = path.startsWith('/') ? path : `/makeup/${path}`;
  const listing = await fetch(origin + prefix);
  if (!listing.ok) { errors.push({ path, error: `listing ${listing.status}` }); continue; }
  const html = await listing.text();
  const candidates = [...new Set([...html.matchAll(/\/(?:makeup|hair-color)\/[a-z0-9/-]+/g)].map(m => m[0]))]
    .filter(link => link.startsWith(`${prefix}/`) && link.split('/').length === prefix.split('/').length + 1);
  // A bounded sample of product families, not a mirror of the website. Variant duplicates are collapsed.
  const seen = new Set();
  let count = 0;
  for (const candidate of candidates.slice(0, 16)) {
    if (count >= 4) break;
    try {
      const response = await fetch(origin + candidate);
      if (!response.ok) continue;
      const page = await response.text();
      const match = page.match(/<oap-product-variant-selector\s[^>]*:variants='([^']+)'/);
      if (!match) continue;
      const variants = JSON.parse(decode(match[1]));
      const shades = variants.filter(v => /^#[0-9a-f]{6}$/i.test(v.hex) && v.ean && v.value && typeof v.url === 'string' && new URL(v.url, origin).origin === origin)
        .map(v => ({ id: v.ean, name: v.value, hex: v.hex.toUpperCase(), url: new URL(v.url, origin).href }));
      if (!shades.length || shades.some(s => seen.has(s.id))) continue;
      const jsonBlocks = [...page.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      let info;
      for (const block of jsonBlocks) { try { const value = JSON.parse(block[1]); if (value['@type'] === 'Product') info = value; } catch {} }
      if (!info?.name) continue;
      shades.forEach(s => seen.add(s.id));
      const finish = /matte/i.test(info.name) ? 'matte' : /shimmer|metallic/i.test(info.name) ? 'shimmer' : category === 'gloss' ? 'gloss' : 'satin';
      products.push({ id: `${category}-${shades[0].id}`, category, name: decode(info.name), finish,
        url: response.url, shades, source: { url: response.url, retrievedAt: new Date().toISOString(),
          htmlSha256: createHash('sha256').update(page).digest('hex'), colorBasis: 'official-website-hex-swatch-not-physical-calibration' } });
      count++;
      console.log(`${category}: ${info.name} (${shades.length})`);
    } catch (e) { errors.push({ candidate, error: String(e) }); }
  }
}
if (sections.some(([category]) => !products.some(p => p.category === category))) throw new Error('Incomplete category catalog; existing file left unchanged');
await mkdir('web/src/data', { recursive: true });
await writeFile('web/src/data/catalog.json', JSON.stringify({ generatedAt: new Date().toISOString(),
  purpose: 'Visual try-on using public website swatches. Not a calibrated recommendation catalog.', products, importNotes: errors }, null, 2));
console.log(`Imported ${products.length} products / ${products.reduce((n, p) => n + p.shades.length, 0)} shades. Notes: ${errors.length}`);
