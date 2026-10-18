export const CATEGORIES = [
  ['foundation', '粉底', '面部皮肤'], ['concealer', '遮瑕', '眼下与局部'],
  ['bronzer', '修容', '面颊外侧'], ['blush', '腮红', '双颊'], ['highlighter', '高光', '颧骨'],
  ['lipstick', '唇膏', '嘴唇'], ['gloss', '唇彩', '嘴唇'], ['eyeshadow', '眼影', '上眼睑'],
  ['brow', '眉妆', '眉毛'], ['eyeliner', '眼线', '上睫毛根部'], ['mascara', '睫毛', '上睫毛'],
  ['hair', '发色', '头发'],
] as const;
export type Category = typeof CATEGORIES[number][0];
export type Finish = 'matte' | 'satin' | 'gloss' | 'shimmer';
export interface Point { x: number; y: number; z: number }
export interface Shade { id: string; name: string; hex: string; url: string }
export interface Product { id: string; category: string; name: string; finish: string; url: string; shades: Shade[];
  source: { url: string; retrievedAt: string; htmlSha256: string; colorBasis: string } }
export interface Layer { productId: string; shadeId: string; strength: number; finish: Finish }
export type Look = Partial<Record<Category, Layer>>;
export const DEFAULT_STRENGTH: Record<Category, number> = { foundation: 45, concealer: 55, bronzer: 28, blush: 40,
  highlighter: 32, lipstick: 78, gloss: 40, eyeshadow: 50, brow: 48, eyeliner: 80, mascara: 75, hair: 70 };
export function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
export function sanitizeLook(input: unknown, products: Product[]): Look {
  if (!input || typeof input !== 'object') return {};
  const output: Look = {};
  for (const [category] of CATEGORIES) {
    const layer = (input as Look)[category];
    if (!layer || typeof layer !== 'object') continue;
    const product = products.find(p => p.id === layer.productId && p.category === category);
    if (!product?.shades.some(s => s.id === layer.shadeId)) continue;
    output[category] = { productId: product.id, shadeId: layer.shadeId,
      strength: Number.isFinite(layer.strength) ? Math.max(0, Math.min(100, layer.strength)) : DEFAULT_STRENGTH[category],
      finish: ['matte', 'satin', 'gloss', 'shimmer'].includes(layer.finish) ? layer.finish : 'satin' };
  }
  return output;
}
