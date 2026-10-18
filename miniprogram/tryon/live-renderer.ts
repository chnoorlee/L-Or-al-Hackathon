import { srgbChannelToLinear } from "../core/color";
import type { NormalizedCircle, PixelBuffer } from "../core/types";
import type { MakeupLayer, RenderOptions } from "./engine";
import { DEFAULT_FACE_LOOK, type FaceLayer, type FaceLook } from "./face-makeup";
import type { FaceTransform } from "./face-motion";

export interface GLCanvas {
  width: number;
  height: number;
  getContext(type: "webgl", options?: object): WebGLRenderingContext | null;
}

export const LIVE_VERTEX = `attribute vec2 position;
varying vec2 uv;
void main() { uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5); gl_Position=vec4(position,0.0,1.0); }`;
export const LIVE_FRAGMENT = `precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform sampler2D region;
uniform sampler2D faceMasks;
uniform vec3 faceUvX;
uniform vec3 faceUvY;
uniform float faceMode;
uniform vec3 faceEnabled;
uniform vec3 lipShade;
uniform vec3 blushShade;
uniform float lipLuminance;
uniform float lipStrength;
uniform float blushStrength;
uniform float satin;
uniform vec3 shade;
uniform float coverLuminance;
uniform float strength;
uniform float textureAmount;
uniform float feather;
uniform float split;
uniform float mode;
uniform float outline;
uniform vec2 frameScale;
uniform vec3 markerA;
uniform vec3 markerB;
vec3 linearize(vec3 c) { return mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c)); }
vec3 encode(vec3 c) { c=clamp(c,0.0,1.0); return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c)); }
void main() {
  vec4 source=texture2D(image,uv);
  float ringA=abs(length((uv-markerA.xy)*frameScale)-markerA.z);
  float ringB=abs(length((uv-markerB.xy)*frameScale)-markerB.z);
  if (markerB.z>0.0 && ringB<=0.01) { gl_FragColor=vec4(ringB<=0.006 ? vec3(112.0,85.0,45.0)/255.0 : vec3(1.0),source.a); return; }
  if (markerA.z>0.0 && ringA<=0.01) { gl_FragColor=vec4(ringA<=0.006 ? vec3(150.0,43.0,67.0)/255.0 : vec3(1.0),source.a); return; }
  if (faceMode>0.5) {
    if (mode>1.5 || (mode>0.5 && uv.x<split)) { gl_FragColor=source; return; }
    vec3 coordinate=vec3(uv,1.0);
    vec2 maskUv=vec2(dot(faceUvX,coordinate),dot(faceUvY,coordinate));
    float inside=step(0.0,maskUv.x)*step(maskUv.x,1.0)*step(0.0,maskUv.y)*step(maskUv.y,1.0);
    vec3 masks=texture2D(faceMasks,maskUv).rgb*inside;
    vec3 original=linearize(source.rgb), color=original;
    float luma=dot(original,vec3(0.2126,0.7152,0.0722));
    // Keep shading and fine texture. Compress only the excess brightness of pale patches.
    float ratio=luma/max(coverLuminance,0.005);
    float light=clamp(1.0+(ratio-1.0)*textureAmount,0.25,1.6);
    light=mix(light,min(light,1.12),smoothstep(1.2,1.8,ratio)*0.7);
    color=mix(color,shade*light,masks.r*strength*faceEnabled.r);
    float cheekLight=clamp(luma/max(coverLuminance,0.005),0.3,1.5);
    color=mix(color,blushShade*cheekLight,masks.b*blushStrength*faceEnabled.b);
    float lipLight=clamp(luma/max(lipLuminance,0.005),0.2,2.0);
    vec3 lip=lipShade*(1.0+(lipLight-1.0)*mix(0.58,0.92,satin));
    lip+=vec3(max(lipLight-1.15,0.0)*0.07*satin);
    color=mix(color,lip,masks.g*lipStrength*faceEnabled.g);
    gl_FragColor=vec4(encode(color),source.a); return;
  }
  float edge=texture2D(region,uv).r*255.0;
  if (mode>1.5 || (mode>0.5 && uv.x<split) || edge<0.5) { gl_FragColor=source; return; }
  vec3 color=linearize(source.rgb);
  float light=clamp(1.0+(dot(color,vec3(0.2126,0.7152,0.0722))/coverLuminance-1.0)*textureAmount,0.3,1.8);
  float alpha=strength*(feather<0.01 ? 1.0 : clamp(edge/feather,0.0,1.0));
  vec3 result=encode(mix(color,shade*light,alpha));
  if (outline>0.5 && edge<=1.0) result=vec3(216.0,187.0,135.0)/255.0;
  gl_FragColor=vec4(result,source.a);
}`;

/** Full-resolution camera texture + small mask. Controls only change uniforms. */
export class LiveRenderer {
  private readonly gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private vertices: WebGLBuffer | null = null;
  private image: WebGLTexture | null = null;
  private region: WebGLTexture | null = null;
  private faceMasks: WebGLTexture | null = null;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private reference = { r: 0, g: 0, b: 0 };
  private luminance = 1;
  private hasImage = false;
  private hasLayer = false;
  private faceMode = false;
  private lipLuminance = .1;
  private faceUvX: [number, number, number] = [1, 0, 0];
  private faceUvY: [number, number, number] = [0, 1, 0];
  private disposed = false;
  constructor(private readonly canvas: GLCanvas) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl || typeof gl.createShader !== "function") throw new Error("WebGL unavailable");
    this.gl = gl;
    try {
      this.program = gl.createProgram();
      if (!this.program) throw new Error("Cannot create live shader");
      for (const [type, source] of [[gl.VERTEX_SHADER, LIVE_VERTEX], [gl.FRAGMENT_SHADER, LIVE_FRAGMENT]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Cannot create live shader");
        gl.shaderSource(shader, source); gl.compileShader(shader);
        const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (compiled) gl.attachShader(this.program, shader);
        gl.deleteShader(shader);
        if (!compiled) throw new Error("Live shader compilation failed");
      }
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("Live shader link failed");
      gl.useProgram(this.program);
      this.vertices = gl.createBuffer(); this.image = gl.createTexture(); this.region = gl.createTexture(); this.faceMasks = gl.createTexture();
      if (!this.vertices || !this.image || !this.region || !this.faceMasks) throw new Error("Live renderer allocation failed");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(this.program, "position");
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      for (const name of ["image", "region", "shade", "coverLuminance", "strength", "textureAmount", "feather", "split", "mode", "outline", "frameScale", "markerA", "markerB", "faceMasks", "faceUvX", "faceUvY", "faceMode", "faceEnabled", "lipShade", "blushShade", "lipLuminance", "lipStrength", "blushStrength", "satin"])
        this.locations.set(name, gl.getUniformLocation(this.program, name));
      for (const [unit, texture] of [[0, this.image], [1, this.region], [2, this.faceMasks]] as const) {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.uniform1i(this.location("image"), 0); gl.uniform1i(this.location("region"), 1);
      gl.uniform1i(this.location("faceMasks"), 2);
      this.setFaceLayer(null);
      this.setLayer(null);
    } catch (error) { this.dispose(); throw error; }
  }
  private location(name: string) { return this.locations.get(name) ?? null; }
  upload(frame: PixelBuffer) {
    if (this.disposed) throw new Error("Live renderer cleared");
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.data.length !== frame.width * frame.height * 4)
      throw new Error("Invalid live frame");
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error("Live graphics context lost");
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width; this.canvas.height = frame.height;
    }
    gl.viewport(0, 0, frame.width, frame.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const bytes = frame.data instanceof Uint8ClampedArray || frame.data instanceof Uint8Array ?
      new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength) : Uint8Array.from(frame.data);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    this.hasImage = true;
  }
  setLayer(layer: MakeupLayer | null) {
    if (this.disposed) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.region);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, layer?.width ?? 1, layer?.height ?? 1,
      0, gl.LUMINANCE, gl.UNSIGNED_BYTE, layer?.distances ?? new Uint8Array(1));
    this.hasLayer = !!layer;
    this.faceMode = false;
    this.reference = layer ? { ...layer.reference } : { r: 0, g: 0, b: 0 };
    this.luminance = layer?.coverLuminance ?? 1;
  }
  setFaceLayer(layer: FaceLayer | null) {
    if (this.disposed) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.faceMasks);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layer?.width ?? 1, layer?.height ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer?.masks ?? new Uint8Array(4));
    this.faceMode = !!layer; this.hasLayer = !!layer;
    this.reference = layer ? { ...layer.skin } : { r: 0, g: 0, b: 0 };
    this.luminance = layer?.skinLuminance ?? 1; this.lipLuminance = layer?.lipLuminance ?? .1;
    this.setFaceTransform(null);
  }
  setFaceTransform(transform: FaceTransform | null) {
    if (!transform) { this.faceUvX = [1, 0, 0]; this.faceUvY = [0, 1, 0]; return; }
    const { a, b, tx, ty, width, height } = transform, determinant = a * a + b * b;
    if (![a, b, tx, ty, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || determinant < .01)
      throw new Error("Invalid face motion");
    // Inverse similarity in normalized UV; width/height preserves portrait rotation.
    this.faceUvX = [a / determinant, b * height / width / determinant, (-a * tx - b * ty) / width / determinant];
    this.faceUvY = [-b * width / height / determinant, a / determinant, (b * tx - a * ty) / height / determinant];
  }
  draw(options: RenderOptions, markers: readonly NormalizedCircle[] = [], look: FaceLook = DEFAULT_FACE_LOOK) {
    if (this.disposed || !this.hasImage) return;
    const gl = this.gl, bound = (n: number, low: number, high: number) => Math.max(low, Math.min(high, Number.isFinite(n) ? n : low));
    gl.useProgram(this.program);
    const w = bound(options.warmth, -30, 30), b = bound(options.brightness, -30, 30);
    const rgb = [this.reference.r + b + .35*w, this.reference.g + b, this.reference.b + b - .45*w].map(v => srgbChannelToLinear(bound(v, 0, 255)));
    gl.uniform3f(this.location("shade"), rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(this.location("coverLuminance"), Math.max(.005, this.luminance));
    gl.uniform1f(this.location("strength"), bound(options.strength, 0, 100)/100*(options.formula === "sheer" ? .55 : 1));
    gl.uniform1f(this.location("textureAmount"), options.formula === "soft" ? .58 : options.formula === "sheer" ? 1 : .86);
    gl.uniform1f(this.location("feather"), bound(options.feather, 0, 16));
    gl.uniform1f(this.location("split"), bound(options.split, 0, 100)/100);
    gl.uniform1f(this.location("mode"), !this.hasLayer || options.mode === "original" ? 2 : options.mode === "split" ? 1 : 0);
    gl.uniform1f(this.location("outline"), options.outline ? 1 : 0);
    gl.uniform1f(this.location("faceMode"), this.faceMode ? 1 : 0);
    gl.uniform3f(this.location("faceUvX"), ...this.faceUvX);
    gl.uniform3f(this.location("faceUvY"), ...this.faceUvY);
    gl.uniform3f(this.location("faceEnabled"), look.foundation ? 1 : 0, look.lipstick ? 1 : 0, look.blush ? 1 : 0);
    for (const [name, color] of [["lipShade", look.lipColor], ["blushShade", look.blushColor]] as const)
      gl.uniform3f(this.location(name), ...[color.r, color.g, color.b].map(v => srgbChannelToLinear(bound(v, 0, 255))) as [number, number, number]);
    gl.uniform1f(this.location("lipLuminance"), this.lipLuminance);
    gl.uniform1f(this.location("lipStrength"), bound(look.lipStrength, 0, 100) / 100);
    gl.uniform1f(this.location("blushStrength"), bound(look.blushStrength, 0, 100) / 100 * .55);
    gl.uniform1f(this.location("satin"), look.lipFinish === "satin" ? 1 : 0);
    const short = Math.min(this.canvas.width, this.canvas.height);
    gl.uniform2f(this.location("frameScale"), this.canvas.width / short, this.canvas.height / short);
    for (const [index, name] of ["markerA", "markerB"].entries()) {
      const marker = markers[index];
      gl.uniform3f(this.location(name), marker?.x ?? 0, marker?.y ?? 0, marker?.radius ?? 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  clear() {
    if (this.disposed) return;
    this.setLayer(null);
    this.setFaceLayer(null);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.hasImage = false;
  }
  dispose() {
    if (this.disposed) return;
    const gl = this.gl;
    gl.deleteTexture(this.image); gl.deleteTexture(this.region); gl.deleteTexture(this.faceMasks); gl.deleteBuffer(this.vertices); gl.deleteProgram(this.program);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    this.hasImage = false; this.hasLayer = false; this.disposed = true;
  }
}
