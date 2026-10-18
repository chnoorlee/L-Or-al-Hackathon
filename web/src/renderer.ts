import { CATEGORIES, hexRgb, type Look, type Product } from './types';
import { MaskAtlas } from './geometry';
import type { Point } from './types';

const vertex = `attribute vec2 aPosition; varying vec2 uv; void main(){uv=(aPosition+1.0)*.5;gl_Position=vec4(aPosition.x,-aPosition.y,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv;uniform sampler2D image;uniform sampler2D masks;uniform sampler2D hairMask;
uniform vec4 layers[12];uniform float finishes[12];uniform float visibility;uniform float hairVisibility;uniform float split;uniform float original;uniform float mirror;uniform float skinLuma;
vec3 lin(vec3 c){return pow(c,vec3(2.2));}vec3 srgb(vec3 c){return pow(max(c,vec3(0.)),vec3(1./2.2));}
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){vec3 base=texture2D(image,uv).rgb;vec3 col=lin(base);float y=lum(col);
float shownX=mix(uv.x,1.-uv.x,mirror);float shown=(1.-original)*step(split,shownX);
for(int i=0;i<12;i++){
float index=float(i);vec2 cell=vec2(mod(index,4.),floor(index/4.));float mask=texture2D(masks,(cell+clamp(uv,vec2(.002),vec2(.998)))/vec2(4.,3.)).a;
float visible=visibility;
if(i==11){mask=texture2D(hairMask,uv).r;visible=hairVisibility;}
float alpha=mask*layers[i].a*visible*shown;vec3 target=lin(layers[i].rgb);float shade=clamp(y/max(skinLuma,.03),.18,1.8);
if(i==5||i==6){shade=clamp(y/max(skinLuma*.45,.025),.24,1.8);}
vec3 paint=target*pow(shade,.72);
if(i==11){paint=target*clamp(pow((y+.01)/.08,.65),.15,1.7);}
if(i==8||i==9||i==10)paint=target*clamp(shade,.5,1.2);
if(i==0||i==1){alpha*=smoothstep(.015,.09,y);}
float finish=finishes[i];
if(finish>.5){float shine=pow(clamp(y/max(skinLuma,.035),0.,1.),8.);paint+=vec3(shine*(finish>2.5?.12:finish>1.5?.065:.022));}
col=mix(col,clamp(paint,0.,1.),alpha);
}gl_FragColor=vec4(srgb(col),1.);}`;

export class MakeupRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private videoTexture: WebGLTexture;
  private maskTexture: WebGLTexture;
  private hairTexture: WebGLTexture;
  private buffer: WebGLBuffer;
  private atlas = new MaskAtlas();
  private uniforms = new Map<string, WebGLUniformLocation>();
  private valid = true;
  private disposed = false;
  constructor(readonly canvas: HTMLCanvasElement, onLost: () => void) {
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl)throw new Error('此浏览器未提供 WebGL，请使用新版 Safari 或 Chrome');
    this.gl=gl;
    const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'着色器编译失败');return s;};
    const p=gl.createProgram()!;const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'渲染器初始化失败');
    gl.useProgram(p);this.program=p;
    this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(p,'aPosition');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    const texture=(unit:number)=>{const t=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
    this.videoTexture=texture(0);this.maskTexture=texture(1);this.hairTexture=texture(2);this.updateMask([]);this.updateHairMask(new Uint8Array(1),1,1);
    gl.uniform1i(this.u('image'),0);gl.uniform1i(this.u('masks'),1);gl.uniform1i(this.u('hairMask'),2);gl.uniform1f(this.u('skinLuma'),.3);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.valid=false;if(!this.disposed)onLost();});
  }
  private u(name:string){let u=this.uniforms.get(name);if(!u){u=this.gl.getUniformLocation(this.program,name)!;this.uniforms.set(name,u);}return u;}
  setLook(look:Look,products:Product[]){
    const colors=new Float32Array(CATEGORIES.length*4),finishes=new Float32Array(CATEGORIES.length);
    CATEGORIES.forEach(([category],i)=>{const layer=look[category];const product=products.find(p=>p.id===layer?.productId);const shade=product?.shades.find(s=>s.id===layer?.shadeId);if(!layer||!shade)return;
      colors.set([...hexRgb(shade.hex),layer.strength/100],i*4);finishes[i]=['matte','satin','gloss','shimmer'].indexOf(layer.finish);});
    this.gl.uniform4fv(this.u('layers[0]'),colors);this.gl.uniform1fv(this.u('finishes[0]'),finishes);
  }
  setSkin(rgb:[number,number,number]) {this.gl.uniform1f(this.u('skinLuma'),rgb.reduce((s,c,i)=>s+Math.pow(c,2.2)*[.2126,.7152,.0722][i],0));}
  updateMask(points:Point[]){this.atlas.update(points);const g=this.gl;g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.maskTexture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,this.atlas.canvas);}
  updateHairMask(alpha:Uint8Array,width:number,height:number){const g=this.gl;g.activeTexture(g.TEXTURE2);g.bindTexture(g.TEXTURE_2D,this.hairTexture);g.pixelStorei(g.UNPACK_ALIGNMENT,1);g.texImage2D(g.TEXTURE_2D,0,g.LUMINANCE,width,height,0,g.LUMINANCE,g.UNSIGNED_BYTE,alpha);}
  draw(source:TexImageSource,width:number,height:number,visibility:number,split:number,original:boolean,mirror:boolean,hairVisibility=0){
    if(!this.valid)throw new Error('图形上下文已断开');
    const scale=Math.min(1,1280/Math.max(width,height));const w=Math.round(width*scale),h=Math.round(height*scale);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    const g=this.gl;g.viewport(0,0,w,h);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.videoTexture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,source);
    g.uniform1f(this.u('visibility'),visibility);g.uniform1f(this.u('hairVisibility'),hairVisibility);g.uniform1f(this.u('split'),split);g.uniform1f(this.u('original'),original?1:0);g.uniform1f(this.u('mirror'),mirror?1:0);g.drawArrays(g.TRIANGLES,0,6);
  }
  destroy(){this.disposed=true;this.valid=false;const g=this.gl;g.deleteBuffer(this.buffer);g.deleteTexture(this.videoTexture);g.deleteTexture(this.maskTexture);g.deleteTexture(this.hairTexture);g.deleteProgram(this.program);g.getExtension('WEBGL_lose_context')?.loseContext();}
}
