import { describe, expect, it } from "vitest";
import { buildFaceLayer } from "../../miniprogram/tryon/face-makeup";
import { face106, faceFrame } from "../fixtures/face106";

describe("106-point makeup masks (synthetic geometry, not model accuracy)", () => {
  it("keeps eyes, brows, mouth interior and background untouched; separates lips and cheeks", () => {
    const layer = buildFaceLayer(faceFrame(), [face106()])!;
    expect(layer).not.toBeNull();
    const at = (x: number, y: number, channel = 0) => layer.masks[(Math.floor(y * 256) * 256 + Math.floor(x * 256)) * 4 + channel];
    for (const [x,y] of [[.37,.4],[.63,.4],[.37,.32],[.5,.69],[.05,.5],[.5,.45],[.5,.55],[.46,.56]]) for (let c=0;c<3;c++) expect(at(x,y,c)).toBe(0);
    expect(at(.5,.72,1)).toBeGreaterThan(100); expect(at(.5,.72)).toBe(0);
    expect(at(.36,.56)).toBeGreaterThan(200); expect(at(.36,.56,2)).toBeGreaterThan(50);
    expect(at(.5,.45,2)).toBeLessThan(10);
    expect(layer.skin).toEqual({r:158,g:111,b:86});
  });
  it("follows rotation, scale and translation without using a fixed ellipse", () => {
    const angle=.25, transform=(x:number,y:number)=>({x:.52+((x-.5)*Math.cos(angle)-(y-.5)*Math.sin(angle))*.8,y:.48+((x-.5)*Math.sin(angle)+(y-.5)*Math.cos(angle))*.8});
    const layer=buildFaceLayer(faceFrame(),[face106(transform)])!;
    const lip=transform(.5,.72), eye=transform(.37,.4);
    expect(layer.masks[(Math.floor(lip.y*256)*256+Math.floor(lip.x*256))*4+1]).toBeGreaterThan(50);
    expect(layer.masks[(Math.floor(eye.y*256)*256+Math.floor(eye.x*256))*4]).toBe(0);
  });
  it.each([[68,42,30],[158,111,86],[230,196,174]])("samples the observed skin rather than a fixed light palette (%s)", (...skin) => {
    const layer=buildFaceLayer(faceFrame(256,skin),[face106()])!;
    expect(layer.skin).toEqual({r:skin[0],g:skin[1],b:skin[2]}); expect(Number.isFinite(layer.skinLuminance)).toBe(true);
  });
  it("rejects multiple/missing faces, low confidence, incomplete points, huge buffers and a face too small", () => {
    const image=faceFrame(), anchor=face106();
    expect(buildFaceLayer(image,[])).toBeNull(); expect(buildFaceLayer(image,[anchor,anchor])).toBeNull();
    anchor.confidence[52]=.1; expect(buildFaceLayer(image,[anchor])).toBeNull();
    expect(buildFaceLayer(image,[{...face106(),points:[]}])).toBeNull();
    expect(buildFaceLayer(faceFrame(321),[face106()])).toBeNull();
    expect(buildFaceLayer(image,[face106((x,y)=>({x:.5+(x-.5)*.1,y:.5+(y-.5)*.1}))])).toBeNull();
    expect(buildFaceLayer(image,[face106((x,y)=>({x:x===.5?NaN:x,y}))])).toBeNull();
  });
  it("ignores optional unused pupil points but still validates the nose and mouth used for cutouts", () => {
    const anchor = face106();
    anchor.points[104] = {x:0,y:0}; anchor.points[105] = {x:NaN,y:NaN}; anchor.confidence[104] = 0; anchor.confidence[105] = 0;
    expect(buildFaceLayer(faceFrame(), [anchor])).not.toBeNull();
    anchor.confidence[80] = .1; expect(buildFaceLayer(faceFrame(), [anchor])).toBeNull();
    anchor.confidence[80] = 1; anchor.points[99] = {x:0,y:0}; expect(buildFaceLayer(faceFrame(), [anchor])).toBeNull();
  });
  it("does not edit input frames/landmarks and does not produce hard opaque edges", () => {
    const image=faceFrame(), anchor=face106(), before=image.data.slice(), original=structuredClone(anchor);
    const layer=buildFaceLayer(image,[anchor])!;
    expect(image.data).toEqual(before); expect(anchor).toEqual(original);
    expect(layer.masks.some((v,i)=>i%4===0 && v>0 && v<255)).toBe(true);
  });
  it("clears transparent pixels from skin, lips and blush before feathering", () => {
    const image = faceFrame(), anchor = face106();
    const opaque = buildFaceLayer(image, [anchor])!;
    const targets = [[.36, .56, 0], [.5, .72, 1]];
    for (const [x, y, channel] of targets) {
      const i = (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4;
      expect(opaque.masks[i + channel]).toBeGreaterThan(0);
      image.data[i + 3] = 249;
    }
    const layer = buildFaceLayer(image, [anchor])!;
    for (const [x, y] of targets) {
      const i = (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4;
      expect([...layer.masks.subarray(i, i + 4)]).toEqual([0, 0, 0, 0]);
    }
  });
});
