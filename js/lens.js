export const FILTERS = [
  { id: 'none', name: '原相机', sw: 'linear-gradient(135deg,#d9d4cc,#9fa6ad)', p: {} },
  { id: 'glow', name: '微曝', sw: 'linear-gradient(135deg,#ffffff,#f1ece6)', p: { expo: .3785, contrast: .05, sat: -.2, hard: 1, blur: .12 } },
  { id: 'clear', name: '清透', sw: 'linear-gradient(135deg,#f4fbff,#cfe3f3)', p: { expo: .12, shadows: .5, highlights: -.1, contrast: .1, vib: .22, temp: -.035 } },
  { id: 'pale', name: '冷白皮', sw: 'linear-gradient(135deg,#fbf6fb,#dcd9ee)', p: { expo: .2, shadows: .45, highlights: -.15, contrast: .05, sat: -.06, vib: .1, temp: -.075, tint: .03, glow: .25 } },
  { id: 'cream', name: '奶油肌', sw: 'linear-gradient(135deg,#fff6ea,#f0d9c4)', p: { expo: .2, shadows: .4, highlights: -.3, contrast: -.06, sat: -.1, temp: .02, tint: .012, glow: .35 } },
  { id: 'fuji', name: '富士', sw: 'linear-gradient(135deg,#c9d6c6,#5c7a78)', p: { expo: -.04, shadows: .12, highlights: -.2, contrast: .16, sat: -.1, vib: -.06, temp: -.03, sr: -.012, sg: .012, sb: .016, hr: .016, hg: .008, hb: -.014, grain: .028 } },
  { id: 'ccd', name: 'CCD', sw: 'linear-gradient(135deg,#dfe9ff,#6f86c9)', p: { expo: .16, shadows: .1, contrast: .22, sat: .12, vib: .18, temp: -.055, tint: .018, sb: .02, glow: .45, grain: .04, vig: .16 } },
  { id: 'mono', name: '黑白', sw: 'linear-gradient(135deg,#f4f4f4,#3c3c3c)', p: { expo: .05, contrast: .14, sat: -1, grain: .04, vig: .18 } }
];
export const DECOS = [{ id: 0, name: '无' }, { id: 1, name: '波点' }, { id: 2, name: '光斑' }];

const VS = `attribute vec2 a;varying vec2 v;void main(){v=vec2(.5-a.x*.5,a.y*.5+.5);gl_Position=vec4(a,0.,1.);}`;
const FS = `precision highp float;
varying vec2 v;uniform sampler2D tex;uniform vec2 px;uniform float aspect,time;
uniform vec2 fc;uniform vec2 fp[6];uniform float fr,slim,smooth_,soft;
uniform float expo,contrast,sat,vib,temp,tint,shadows,highlights,glow,grain,vig,sr,sg,sb,hr,hg,hb,hard,blur;uniform int deco;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
void main(){
  vec2 uv=v;
  if(slim>0.){for(int i=0;i<6;i++){vec2 d=(uv-fp[i])*vec2(aspect,1.);float q=dot(d,d)/(fr*fr);if(q<1.){float w=1.-q;uv-=(fc-fp[i])*slim*w*w;}}}
  vec3 col=texture2D(tex,uv).rgb;
  vec3 bs=col,pb=col,wide=col;float ws=1.;
  vec2 ar=vec2(px.x/px.y,1.);
  for(int i=0;i<16;i++){
    float fi=float(i),an=fi*2.39996,r=sqrt((fi+.5)/16.);
    vec2 o=vec2(cos(an),sin(an))*r*ar;
    vec3 s=texture2D(tex,uv+o*(.011+.006*soft)).rgb;
    vec3 d=s-col;float w=exp(-dot(d,d)*70.);bs+=s*w;ws+=w;pb+=s;
    wide+=texture2D(tex,uv+o*.07).rgb;
  }
  bs/=ws;pb/=17.;wide/=17.;
  float cb=-.169*col.r-.331*col.g+.5*col.b,cr=.5*col.r-.419*col.g-.081*col.b;
  float skin=smoothstep(.0,.035,cr)*(1.-smoothstep(.14,.2,cr))*(1.-smoothstep(-.02,.02,cb))*smoothstep(-.22,-.16,cb);
  col=mix(col,bs,smooth_*(.35+.65*skin));col+=skin*smooth_*.03;
  col=mix(col,pb,min(1.,soft*.8+blur));
  col*=vec3(1.+temp,1.-tint,1.-temp);
  col*=pow(2.,expo);
  float l=luma(col);
  col*=1.+shadows*pow(1.-clamp(l,0.,1.),3.)*1.4+highlights*pow(clamp(l,0.,1.),3.)*.6;
  col=(col-.5)*(1.+contrast)+.5;
  l=luma(col);
  float mx=max(col.r,max(col.g,col.b)),mn=min(col.r,min(col.g,col.b));
  col=mix(vec3(l),col,max(0.,1.+sat+vib*(1.-clamp((mx-mn)*2.2,0.,1.))));
  float lc=clamp(l,0.,1.);
  col+=vec3(sr,sg,sb)*(1.-lc)*(1.-lc)*3.+vec3(hr,hg,hb)*lc*lc*3.;
  float wl=luma(wide)*pow(2.,expo);
  col+=wide*pow(clamp((wl-.5)/.5,0.,1.),1.6)*(glow*.42+soft*.12);
  vec3 t=max(col-.8,0.)/.2;col=mix(min(col,.8)+.2*t/(1.+t),clamp(col,0.,1.),hard);
  col*=1.-vig*smoothstep(.35,.95,length(v-.5)*1.25);
  float g=grain+soft*.1;
  if(g>0.){
    vec2 gp=floor(v/px/(1.+soft*.9))+floor(time*24.)*17.;
    float n=hash(gp)-.5;
    vec3 cn=vec3(hash(gp+3.1),hash(gp+7.3),hash(gp+11.7))-.5;
    col+=(n+cn*soft*.45)*g*(1.25-lc*.7);
  }
  if(deco==1){
    vec2 p=v*vec2(aspect,1.)*19.;p.x+=mod(floor(p.y),2.)*.5;
    float d=length(fract(p)-.5);
    float e=smoothstep(.37,.49,max(abs(v.x-.5),abs(v.y-.5)));
    col=mix(col,vec3(1.,.985,.93),(1.-smoothstep(.15,.18,d))*e*.9);
  }else if(deco==2){
    for(int i=0;i<9;i++){
      float fi=float(i);
      vec2 c=vec2(hash(vec2(fi,1.3)),hash(vec2(fi,7.7)));
      c+=vec2(sin(time*.25+fi*2.1),cos(time*.2+fi*1.3))*.05;
      c=mix(c,step(.5,c),.45);
      float rr=.05+.07*hash(vec2(fi,3.1));
      float d=length((v-c)*vec2(aspect,1.));
      float b=(1.-smoothstep(rr*.82,rr,d))*(.6+.4*smoothstep(rr*.5,rr,d));
      col+=b*mix(vec3(1.,.93,.75),vec3(1.,.82,.86),hash(vec2(fi,9.)))*(.1+.06*sin(time*.9+fi*3.));
    }
  }
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

export function createLens(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const loc = {}, U = n => loc[n] ??= gl.getUniformLocation(pr, n);
  const GRADE = ['expo', 'contrast', 'sat', 'vib', 'temp', 'tint', 'shadows', 'highlights', 'glow', 'grain', 'vig', 'sr', 'sg', 'sb', 'hr', 'hg', 'hb', 'hard', 'blur'];
  const cur = Object.fromEntries(GRADE.map(k => [k, 0]));
  let face = null, held = null, amt = 0;
  return {
    setFace(f) { face = f; if (f) held = f; },
    render(video, o, time) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      const target = (FILTERS.find(f => f.id === o.filter) || FILTERS[0]).p;
      for (const k of GRADE) { cur[k] += ((target[k] || 0) - cur[k]) * .18; gl.uniform1f(U(k), cur[k] + (k === 'expo' ? o.expo || 0 : 0)); }
      gl.uniform2f(U('px'), 1 / w, 1 / h); gl.uniform1f(U('aspect'), w / h); gl.uniform1f(U('time'), time % 1000);
      gl.uniform1f(U('smooth_'), o.smooth); gl.uniform1f(U('soft'), o.soft || 0); gl.uniform1i(U('deco'), o.deco);
      amt += ((face && o.slim > 0 ? o.slim : 0) - amt) * (face ? .25 : .08);
      if (held && amt > 0.004) {
        gl.uniform1f(U('slim'), amt * .045); gl.uniform2f(U('fc'), held.c[0], held.c[1]); gl.uniform1f(U('fr'), held.r);
        gl.uniform2fv(U('fp[0]'), new Float32Array(held.p));
      } else gl.uniform1f(U('slim'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

const JAW = [132, 172, 150, 361, 397, 379];
let fl = null, flP = null, last = null, lastSeen = 0, vel = null;
export const faceStat = { seen: 0, held: 0, lost: 0 };
const HOLD = 900;
export function loadFace() {
  return flP ||= (async () => {
    const base = new URL('../vendor/mp/', import.meta.url).href;
    const m = await import(base + 'vision_bundle.js');
    const fs = await m.FilesetResolver.forVisionTasks(base + 'wasm');
    const mk = delegate => m.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('../vendor/face_landmarker.task', import.meta.url).href, delegate }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .3, minFacePresenceConfidence: .3, minTrackingConfidence: .3 });
    try { fl = await mk('GPU'); } catch { fl = await mk('CPU'); }
    return true;
  })().catch(e => { flP = null; throw e; });
}
export function trackFace(video, ts) {
  if (!fl || !video.videoWidth) return null;
  let res = null; try { res = fl.detectForVideo(video, ts); } catch { }
  const lm = res && res.faceLandmarks && res.faceLandmarks[0];
  if (!lm) {
    if (last && ts - lastSeen < HOLD) {
      if (vel) { const d = Math.max(0, 1 - (ts - lastSeen) / 250); last = { c: last.c.map((x, i) => x + vel.c[i] * d), p: last.p.map((x, i) => x + vel.p[i % 2] * d), r: last.r }; }
      faceStat.held++; return last;
    }
    faceStat.lost++; last = null; vel = null; return null;
  }
  faceStat.seen++;
  const asp = video.videoWidth / video.videoHeight, P = i => [lm[i].x, 1 - lm[i].y];
  const f = { c: P(2), p: JAW.flatMap(P), r: Math.hypot((lm[234].x - lm[454].x) * asp, lm[234].y - lm[454].y) * .42 };
  if (last) {
    const move = Math.hypot(f.c[0] - last.c[0], f.c[1] - last.c[1]) / (f.r || 1);
    const k = Math.min(1, .45 + move * 6);
    const c = f.c.map((x, i) => last.c[i] + (x - last.c[i]) * k);
    vel = { c: [(c[0] - last.c[0]) * .5, (c[1] - last.c[1]) * .5], p: [(c[0] - last.c[0]) * .5, (c[1] - last.c[1]) * .5] };
    f.c = c; f.p = f.p.map((x, i) => last.p[i] + (x - last.p[i]) * k); f.r = last.r + (f.r - last.r) * Math.min(1, k);
  }
  lastSeen = ts;
  return last = f;
}
