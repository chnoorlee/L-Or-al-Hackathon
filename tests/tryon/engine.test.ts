import { describe, expect, it } from "vitest";
import { srgbToLab } from "../../miniprogram/core/color";
import { DEFAULT_RENDER, PREVIEW_MAX_EDGE, resizeForPreview, TryOnEngine } from "../../miniprogram/tryon/engine";

const cover = { r: 227, g: 198, b: 181 }, reference = { r: 158, g: 111, b: 86 };
function fixture(same = false) {
  const width = 100, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const selected = ((x - 32) ** 2 + (y - 40) ** 2 < 15 ** 2) || (x > 80 && y < 16);
    const rgb = selected && !same ? cover : reference;
    data.set([rgb.r, rgb.g, rgb.b, 255], (y * width + x) * 4);
  }
  const engine = new TryOnEngine({ width, height, data }, { x: 0.32, y: 0.5, radius: 0.1 },
    { x: 0.65, y: 0.5, radius: 0.1 }, srgbToLab(same ? reference : cover), srgbToLab(reference), reference);
  return { engine, data };
}

describe("interactive color region and cosmetic simulation", () => {
  it("selects only the connected seed-colored area, leaving unrelated same-color background untouched", () => {
    const { engine } = fixture();
    const result = engine.segment(18, undefined, false, false);
    expect(result.reason).toBe("selected");
    expect(result.selectedPixels).toBeGreaterThan(600);
    expect(result.selectedPixels).toBeLessThan(720);
    expect(engine.mask[40 * 100 + 32]).toBe(255);
    expect(engine.mask[10 * 100 + 90]).toBe(0);
    expect(engine.mask[40 * 100 + 65]).toBe(0);
    expect(engine.canUndo).toBe(false);
  });
  it("allows another disconnected area to be added and undone", () => {
    const { engine } = fixture();
    engine.segment();
    const before = engine.mask.slice();
    engine.segment(18, { x: 0.9, y: 0.1 }, true);
    expect(engine.mask[10 * 100 + 90]).toBe(255);
    engine.undo();
    expect(engine.mask).toEqual(before);
  });
  it("returns an explicit ambiguous-color result instead of painting the whole image", () => {
    const { engine } = fixture(true);
    expect(engine.segment().reason).toBe("similar_samples");
    expect(engine.selectedPixels).toBe(0);
  });
  it("renders only inside the mask without altering original pixels or alpha", () => {
    const { engine, data } = fixture();
    const original = data.slice();
    engine.segment();
    const output = engine.render({ ...DEFAULT_RENDER, mode: "effect", outline: false, strength: 100 });
    for (let i = 0; i < engine.mask.length; i++) {
      if (!engine.mask[i]) expect(output.slice(i * 4, i * 4 + 4)).toEqual(data.slice(i * 4, i * 4 + 4));
      expect(output[i * 4 + 3]).toBe(data[i * 4 + 3]);
    }
    expect(Array.from(output.slice((40 * 100 + 32) * 4, (40 * 100 + 32) * 4 + 3))).toEqual([158, 111, 86]);
    expect(data).toEqual(original);
  });
  it("restores exact original for zero strength, original view, and the left half of split view", () => {
    const { engine, data } = fixture(); engine.segment();
    expect(engine.render({ ...DEFAULT_RENDER, mode: "original" })).toEqual(data);
    expect(engine.render({ ...DEFAULT_RENDER, mode: "effect", strength: 0, outline: false })).toEqual(data);
    const split = engine.render({ ...DEFAULT_RENDER, split: 50 });
    for (let y = 0; y < 80; y++) expect(split.slice(y * 400, y * 400 + 200)).toEqual(data.slice(y * 400, y * 400 + 200));
  });
  it("creates continuous brush strokes, erases, and restores one complete gesture", () => {
    const { engine } = fixture(); engine.checkpoint();
    engine.brush({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 0.03, false);
    for (let x = 10; x < 90; x++) expect(engine.mask[40 * 100 + x]).toBe(255);
    const before = engine.mask.slice(); engine.checkpoint();
    engine.brush({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.06, true);
    expect(engine.mask[40 * 100 + 50]).toBe(0);
    engine.undo(); expect(engine.mask).toEqual(before);
    engine.undo(); expect(engine.selectedPixels).toBe(0);
  });
  it("softens edges inward without bleeding into unselected pixels", () => {
    const { engine } = fixture(); engine.segment();
    const hard = engine.render({ ...DEFAULT_RENDER, mode: "effect", outline: false, feather: 0 });
    const soft = engine.render({ ...DEFAULT_RENDER, mode: "effect", outline: false, feather: 8 });
    const edge = (40 * 100 + 18) * 4;
    expect(soft[edge]).toBeGreaterThan(hard[edge]);
    const outside = (40 * 100 + 17) * 4;
    expect(soft[outside]).toBe(engine.source[outside]);
  });
  it("bounds working dimensions and preserves aspect ratio", () => {
    const preview = resizeForPreview({ width: 1280, height: 640, data: new Uint8ClampedArray(1280 * 640 * 4) });
    expect(preview.width).toBe(PREVIEW_MAX_EDGE); expect(preview.height).toBe(PREVIEW_MAX_EDGE / 2);
  });
  it("rejects corrupt dimensions and non-finite controls", () => {
    expect(() => resizeForPreview({ width: 10, height: 10, data: [] })).toThrow();
    const { engine } = fixture();
    expect(() => engine.segment(NaN)).toThrow();
    expect(() => engine.render({ ...DEFAULT_RENDER, strength: NaN })).toThrow();
  });
  it("bounds undo history and wipes local pixels when disposed", () => {
    const { engine } = fixture();
    for (let i = 0; i < 20; i++) engine.clear();
    let undoCount = 0; while (engine.undo()) undoCount++;
    expect(undoCount).toBe(6);
    engine.dispose(); expect(engine.source.every(v => v === 0)).toBe(true);
    expect(() => engine.render({ ...DEFAULT_RENDER })).toThrow("cleared");
  });
});
