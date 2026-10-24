const GLSL_ISO = `precision highp float;
uniform vec2 uCanvas;
uniform vec2 uView;
uniform vec2 uOrigin;
uniform float uK;
uniform vec4 uCam;
uniform float uTime;
vec2 viewOf(vec2 frag){return vec2(frag.x,uCanvas.y-frag.y)*(uView.x/uCanvas.x);}
vec2 project(vec3 p){return uOrigin+uK*vec2(p.x*uCam.x-p.y*uCam.y,(p.x*uCam.y+p.y*uCam.x)*uCam.z-p.z*uCam.w);}
vec3 towardViewer(){return vec3(uCam.y*uCam.w,uCam.x*uCam.w,uCam.z);}
vec3 rayOf(vec2 vb){vec2 q=(vb-uOrigin)/uK;return vec3(q.x*uCam.x,-q.x*uCam.y,-q.y/uCam.w);}
float pixelOf(){return (uView.x/uCanvas.x)/uK;}
vec3 lightDir(){return normalize(vec3(-uCam.x,uCam.y,1.2));}
vec3 onFloor(vec2 vb,float h){vec2 q=(vb-uOrigin)/uK;float b=(q.y+h*uCam.w)/uCam.z;return vec3(q.x*uCam.x+b*uCam.y,-q.x*uCam.y+b*uCam.x,h);}
vec3 onWallY(vec2 vb,float y){vec2 q=(vb-uOrigin)/uK;float x=(q.x+y*uCam.y)/uCam.x;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
vec3 onWallX(vec2 vb,float x){vec2 q=(vb-uOrigin)/uK;float y=(x*uCam.x-q.x)/uCam.y;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
float hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1.,0.)),f.x),mix(hash12(i+vec2(0.,1.)),hash12(i+vec2(1.,1.)),f.x),f.y);}
float noise3(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.-2.*f);
  float a=mix(mix(hash13(i),hash13(i+vec3(1.,0.,0.)),f.x),mix(hash13(i+vec3(0.,1.,0.)),hash13(i+vec3(1.,1.,0.)),f.x),f.y);
  float b=mix(mix(hash13(i+vec3(0.,0.,1.)),hash13(i+vec3(1.,0.,1.)),f.x),mix(hash13(i+vec3(0.,1.,1.)),hash13(i+vec3(1.,1.,1.)),f.x),f.y);
  return mix(a,b,f.z);}
float fbm2(vec2 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise2(p);p=p*2.07+vec2(17.1,9.2);a*=.5;}return s/.9375;}
float fbm3(vec3 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise3(p);p=p*2.07+vec3(17.1,9.2,4.7);a*=.5;}return s/.9375;}
float window(float x,float a,float b,float soft){return smoothstep(a-soft,a+soft,x)*(1.-smoothstep(b-soft,b+soft,x));}
vec3 tonemap(vec3 c,float exposure){return 1.-exp(-c*exposure);}
`;

const GLSL_TURN = `uniform vec3 uGroupX;
uniform vec3 uGroupY;
uniform vec3 uGroupZ;
uniform vec3 uGroupT;
uniform vec3 uCoverEdge[60];
uniform float uCoverCount[6];
vec3 toGroup(vec3 p){vec3 q=p-uGroupT;return vec3(dot(q,uGroupX),dot(q,uGroupY),dot(q,uGroupZ));}
vec3 toWorld(vec3 g){return uGroupT+g.x*uGroupX+g.y*uGroupY+g.z*uGroupZ;}
vec3 dirToGroup(vec3 d){return vec3(dot(d,uGroupX),dot(d,uGroupY),dot(d,uGroupZ));}
vec3 dirToWorld(vec3 d){return d.x*uGroupX+d.y*uGroupY+d.z*uGroupZ;}
float coverOf(vec2 vb,float soft){float c=0.;for(int p=0;p<6;p++){float n=uCoverCount[p];float inside=-1e4;for(int e=0;e<10;e++){if(float(e)>=n)break;vec3 h=uCoverEdge[p*10+e];inside=max(inside,h.x*vb.x+h.y*vb.y+h.z);}if(n>0.)c=max(c,1.-smoothstep(-soft,soft,inside));}return c;}
`;

function glslPose(name, prefix = `u${name}`) {
  return `uniform vec3 ${prefix}X;uniform vec3 ${prefix}Y;uniform vec3 ${prefix}Z;uniform vec3 ${prefix}T;
vec3 to${name}(vec3 p){vec3 q=p-${prefix}T;return vec3(dot(q,${prefix}X),dot(q,${prefix}Y),dot(q,${prefix}Z));}
vec3 from${name}(vec3 g){return ${prefix}T+g.x*${prefix}X+g.y*${prefix}Y+g.z*${prefix}Z;}
vec3 dirTo${name}(vec3 d){return vec3(dot(d,${prefix}X),dot(d,${prefix}Y),dot(d,${prefix}Z));}
vec3 dirFrom${name}(vec3 d){return d.x*${prefix}X+d.y*${prefix}Y+d.z*${prefix}Z;}
`;
}

function glCamera(projection) {
  const a = ((projection.azimuth ?? 45) * Math.PI) / 180;
  const e = ((projection.elevation ?? 30) * Math.PI) / 180;
  return {
    origin: [projection.origin[0], projection.origin[1]],
    k: projection.scale * Math.sqrt(1.6),
    cam: [Math.sin(a), Math.cos(a), Math.sin(e), Math.cos(e)],
  };
}

const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

function glLayer({ canvas, fragment, view, camera, uniforms = [], fixed = {}, extensions = [], maxRatio = 1.5, onError = (message) => console.error(message) }) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    onError(gl.getShaderInfoLog(shader));
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const enabled = extensions.filter((name) => gl.getExtension(name.replace(/^GL_/, "")));
  const fs = compile(gl.FRAGMENT_SHADER, enabled.map((name) => `#extension ${name} : enable\n`).join("") + GLSL_ISO + fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    onError(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const where = {};
  for (const name of ["uCanvas", "uView", "uOrigin", "uK", "uCam", "uTime", ...uniforms, ...Object.keys(fixed)]) where[name] = gl.getUniformLocation(program, name);
  const types = {};
  const active = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < active; index++) {
    const info = gl.getActiveUniform(program, index);
    if (info) types[info.name.replace(/\[0\]$/, "")] = info.type;
  }
  let painted = false;
  const fit = () => {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(maxRatio, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  const set = (name, value) => {
    const at = where[name];
    if (at === undefined || at === null) return;
    if (typeof value === "number") gl.uniform1f(at, value);
    else if (value.length > 4) {
      const data = value instanceof Float32Array ? value : new Float32Array(value);
      const type = types[name];
      if (type === gl.FLOAT_VEC2) gl.uniform2fv(at, data);
      else if (type === gl.FLOAT_VEC3) gl.uniform3fv(at, data);
      else if (type === gl.FLOAT_VEC4) gl.uniform4fv(at, data);
      else gl.uniform1fv(at, data);
    }
    else if (value.length === 1) gl.uniform1f(at, value[0]);
    else if (value.length === 2) gl.uniform2f(at, value[0], value[1]);
    else if (value.length === 3) gl.uniform3f(at, value[0], value[1], value[2]);
    else if (value.length === 4) gl.uniform4f(at, value[0], value[1], value[2], value[3]);
  };
  for (const [name, value] of Object.entries(fixed)) set(name, value);
  return {
    gl,
    extensions: enabled,
    set(values = {}) {
      for (const [name, value] of Object.entries(values)) set(name, value);
    },
    draw(values = {}, time = 0) {
      fit();
      gl.viewport(0, 0, canvas.width, canvas.height);
      set("uCanvas", [canvas.width, canvas.height]);
      set("uView", view);
      set("uOrigin", camera.origin);
      set("uK", camera.k);
      set("uCam", camera.cam);
      set("uTime", time);
      for (const [name, value] of Object.entries(values)) set(name, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      painted = true;
    },
    clear() {
      if (!painted) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      painted = false;
    },
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const burst = (age, rise, fall) => (age > 0 ? smooth(0, rise, age) * Math.exp(-Math.max(0, age - rise) / fall) : 0);

function settle(state, target, dt, seconds, calm = false) {
  if (calm) {
    state.x = target;
    state.v = 0;
    return false;
  }
  const w = 1 / seconds;
  for (let index = 0; index < 4; index++) {
    const h = dt / 4;
    state.v += (w * w * (target - state.x) - 2 * w * state.v) * h;
    state.x += state.v * h;
  }
  if (Math.abs(target - state.x) < 1e-4 && Math.abs(state.v) < 1e-4) {
    state.x = target;
    state.v = 0;
    return false;
  }
  return true;
}
const D = {"W":932,"H":900,"V":[0.7021227225941816,0.5485583912065974,0.4539904997395468],"EX":[0.8664266421630487,0.5034643553113938],"EY":[-1.108975530545763,0.39334946426322404],"EZ":[0,-1.2539225237206892],"camera":{"origin":[466,710.6377090182236],"k":1.4073101483323658,"cam":[0.6156614753256582,0.788010753606722,0.4539904997395468,0.8910065241883679]},"exit":[466,494.96303493827395],"zExit":172,"exitR":64.6,"coneTip":32,"plumeLength":140,"chamberBar":300,"vacuumTf":243.71426455023442,"backTf":13.714264550234432,"columns":[[-124,124],[124,-124]],"columnHalf":12.4,"columnTop":533,"pieces":{"gimbal":{"name":"Gimbal and thrust puck","say":"thrust mount · carries engine load into the stand"},"otp":{"name":"Oxygen turbopump","say":"oxygen turbopump · spun by oxygen-rich gas"},"orpb":{"name":"Oxygen-rich preburner","say":"oxygen-rich preburner · oxygen with a small fuel crossfeed"},"lox":{"name":"Oxygen duct and main valve","say":"oxygen duct · pump to preburner"},"chamber":{"name":"Injector and main chamber","say":"main chamber · the two hot gas streams mix"},"nozzle":{"name":"Nozzle","say":"nozzle · expansion accelerates the exhaust"},"ftp":{"name":"Methane turbopump and fuel-rich preburner","say":"methane turbopump · spun by fuel-rich gas"},"hotgas":{"name":"Hot-gas manifold","say":"hot-gas manifold · fuel-rich gas to the injector"},"downcomer":{"name":"Downcomer and main fuel valve","say":"downcomer · methane to the cooling jacket"},"plumbing":{"name":"Plumbing","say":"plumbing · 7 sense lines into a block · 9 feed, purge and igniter lines"},"controller":{"name":"Engine controller and harness","say":"engine controller · 7 cables"},"stand":{"name":"Stand","say":""}},"stagger":["nozzle","downcomer","controller","plumbing","lox","ftp","hotgas","chamber","orpb","otp","gimbal","stand"],"spring":{"stagger":0.035,"stiffness":64,"damping":14.2,"substeps":4},"order":["gimbal","otp","orpb","lox","controller","chamber","hotgas","ftp","downcomer","plumbing","nozzle"]};
const root = document.getElementById("raptor-explainer");
const stage = root.querySelector(".rp-stage");
const front = stage.querySelector(".rp-front");
const engine = front.querySelector(".rp-engine");
const canvas = stage.querySelector(".rp-plume");
const veilCanvas = stage.querySelector(".rp-veil");
const glowGroup = stage.querySelector(".rp-glow-g");
const flashVeil = stage.querySelector(".rp-flash");
const live = root.querySelector("[data-live]");
const readout = root.querySelector("[data-readout]");
const fireButton = root.querySelector("[data-fire]");
const fireLabel = root.querySelector("[data-fire-label]");
const partButtons = [...root.querySelectorAll(".rp-part")];
const still = matchMedia("(prefers-reduced-motion: reduce)");

const nodes = [...engine.querySelectorAll(".it")].map((el) => ({
  el,
  piece: el.dataset.piece,
  ride: el.dataset.ride || el.dataset.piece,
  key: Number(el.dataset.k),
  m: el.dataset.m.split(",").map(Number),
  index: Number(el.dataset.i),
  shown: "",
}));
for (const node of nodes) node.lift = node.m[0] * D.V[0] + node.m[1] * D.V[1] + node.m[2] * D.V[2];
let order = nodes.map((_, index) => index);

const IDS = Object.keys(D.pieces);
const STAGGER = D.stagger;
const SPRING = D.spring;
const piece = Object.fromEntries(IDS.map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const fmt = (value) => Math.round(value).toLocaleString("en-US");

const pct = (value) => `${(value * 100).toFixed(2)}%`;
stage.style.setProperty("--gx", pct(D.exit[0] / D.W));
stage.style.setProperty("--gy", pct((D.exit[1] + 6) / D.H));

let clock = 0;
let apart = false;
let selected = null;
let inside = false;
let leaveTimer = 0;
let touring = false;
let tourClock = -1;
let idleTimer = 0;
let visible = false;
let frame = 0;
let last = 0;
let jitter = [0, 0];

const VENT = 0.7;
const MAIN = 1.25;
const STEADY = 9;
const PREBURNER_PC = 0.13;
const LONGEST = D.plumeLength + 60;

const glide = () => ({ x: 0, v: 0 });
const burn = {
  on: false,
  armed: false,
  tour: false,
  t: -1,
  stopAt: Infinity,
  stopping: -1,
  pc: 0,
  pcRate: 0,
  hue: glide(),
  glowStop: null,
  lastGlow: 0,
  popped: false,
  phase: "",
  pre: glide(),
  vent: glide(),
  smoke: glide(),
  reach: glide(),
  splash: glide(),
  mainAt: -99,
  popAt: -99,
};


function say(text) {
  if (readout.textContent !== text) readout.textContent = text;
}

function describe() {
  const text = selected ? D.pieces[selected].say : burn.on ? "firing" : apart ? "apart · 11 assemblies" : "Assembled, cold";
  if (stage.getAttribute("aria-valuetext") !== text) stage.setAttribute("aria-valuetext", text);
}

function setApart(on) {
  if (apart === on) return;
  apart = on;
  const goal = on ? 1 : 0;
  let index = 0;
  for (const id of on ? STAGGER : [...STAGGER].reverse()) {
    if (!piece[id]) continue;
    if (piece[id].target === goal) piece[id].pending = null;
    else piece[id].pending = { value: goal, at: clock + (still.matches ? 0 : index++ * SPRING.stagger) };
  }
  describe();
  run();
}

function select(id) {
  if (id === "stand") id = null;
  if (selected === id) return;
  selected = id;
  for (const node of nodes) {
    if (id !== null && node.piece === id) node.el.setAttribute("data-on", "");
    else node.el.removeAttribute("data-on");
  }
  if (id) stage.setAttribute("data-focus", "");
  else stage.removeAttribute("data-focus");
  partButtons.forEach((button) => (button.dataset.part === id ? button.setAttribute("data-on", "") : button.removeAttribute("data-on")));
  stage.setAttribute("aria-valuenow", String(id ? D.order.indexOf(id) + 1 : 0));
  describe();
}

function steerSpring(state, dt, calm) {
  if (state.pending && clock >= state.pending.at) {
    state.target = state.pending.value;
    state.pending = null;
  }
  if (calm) {
    state.x = state.target;
    state.v = 0;
    return false;
  }
  for (let index = 0; index < SPRING.substeps; index++) {
    const h = dt / SPRING.substeps;
    state.v += ((state.target - state.x) * SPRING.stiffness - state.v * SPRING.damping) * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.target - state.x) < 2e-4 && Math.abs(state.v) < 2e-4) {
    state.x = state.target;
    state.v = 0;
    return state.pending !== null;
  }
  return true;
}

function place() {
  for (const node of nodes) {
    const share = piece[node.ride].x;
    const tx = (D.EX[0] * node.m[0] + D.EY[0] * node.m[1] + D.EZ[0] * node.m[2]) * share;
    const ty = (D.EX[1] * node.m[0] + D.EY[1] * node.m[1] + D.EZ[1] * node.m[2]) * share;
    const text = share === 0 ? "" : `translate(${tx.toFixed(2)} ${ty.toFixed(2)})`;
    if (text !== node.shown) {
      node.shown = text;
      if (text) node.el.setAttribute("transform", text);
      else node.el.removeAttribute("transform");
    }
  }
  const next = nodes.map((_, index) => index).sort((a, b) => nodes[a].key + nodes[a].lift * piece[nodes[a].ride].x - (nodes[b].key + nodes[b].lift * piece[nodes[b].ride].x));
  if (next.some((index, at) => index !== order[at])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    engine.appendChild(fragment);
    order = next;
  }
  const moved = Math.abs(jitter[0]) > 0.005 || Math.abs(jitter[1]) > 0.005;
  const shift = moved ? `translate(${jitter[0].toFixed(2)} ${jitter[1].toFixed(2)})` : "";
  engine.setAttribute("transform", shift);
  glowGroup.setAttribute("transform", shift);
}

const COMMON = `
uniform vec2 uJit;
uniform float uPc;
uniform float uHue;
uniform float uSmoke;
uniform float uVent;
uniform float uShockR;
uniform float uShockA;
uniform float uLight;
const float ZE=${D.zExit.toFixed(1)};
const float R0=${D.exitR.toFixed(1)};
const float PL=${D.plumeLength.toFixed(1)};
const float RB=132.;
const vec2 COL0=vec2(${D.columns[0][0].toFixed(1)},${D.columns[0][1].toFixed(1)});
const vec2 COL1=vec2(${D.columns[1][0].toFixed(1)},${D.columns[1][1].toFixed(1)});
const float COLH=${D.columnHalf.toFixed(1)};
const float COLTOP=${D.columnTop.toFixed(1)};
float ground(float r){
  if(r>56.)return 0.;
  if(r>48.)return 4.;
  if(r>43.)return mix(4.,8.,(48.-r)/5.);
  if(r>35.)return mix(8.,13.,(43.-r)/8.);
  if(r>25.)return mix(13.,19.,(35.-r)/10.);
  if(r>14.5)return mix(19.,25.,(25.-r)/10.5);
  if(r>6.)return mix(25.,29.5,(14.5-r)/8.5);
  if(r>2.)return mix(29.5,32.,(6.-r)/4.);
  return 32.;
}
bool solid(vec3 p){return p.z<ground(length(p.xy));}
float ringField(vec3 p){return length(vec2(length(p.xy)-68.,p.z-6.4))-2.1;}
vec2 groundHit(vec3 o,vec3 V){
  float tf=-o.z/V.z;
  float best=tf;
  if(length(o.xy)<56.5){
    float ta=(36.-o.z)/V.z;
    float prev=ta;
    for(int i=1;i<=28;i++){
      float t=mix(ta,tf,float(i)/28.);
      if(solid(o+t*V)){
        float lo=t;float hi=prev;
        for(int j=0;j<7;j++){float m=(lo+hi)*.5;if(solid(o+m*V))lo=m;else hi=m;}
        best=hi;
        break;
      }
      prev=t;
    }
  }
  float t6=(6.4-o.z)/V.z;
  if(abs(length((o+t6*V).xy)-68.)<12.){
    float t=(9.-o.z)/V.z;
    for(int i=0;i<14;i++){
      float d=ringField(o+t*V);
      if(d<.02)break;
      t-=d;
    }
    if(ringField(o+t*V)<.06&&t>best)return vec2(t,1.);
  }
  return vec2(best,0.);
}
float columnNear(vec3 o,vec3 V,vec2 c){
  vec3 lo=vec3(c-COLH,0.);
  vec3 hi=vec3(c+COLH,COLTOP);
  vec3 a=(lo-o)/V;
  vec3 b=(hi-o)/V;
  vec3 mn=min(a,b);
  vec3 mx=max(a,b);
  float tIn=max(mn.x,max(mn.y,mn.z));
  float tOut=min(mx.x,min(mx.y,mx.z));
  return tOut>tIn?tOut:-1e9;
}
float columnsNear(vec3 o,vec3 V){return max(columnNear(o,V,COL0),columnNear(o,V,COL1));}
float engineR(float z){
  float s=z-ZE;
  float b=36.+29.*(1.-pow(clamp(s,0.,120.)/120.,1.6))+3.;
  return mix(b,48.,smoothstep(108.,124.,s))*smoothstep(-6.,0.,s)*(1.-smoothstep(318.,330.,s));
}
float inFront(vec3 p,vec3 V){
  vec2 h=V.xy;
  float hl=length(h);
  float tau=-dot(p.xy,h)/(hl*hl);
  float d=length(p.xy+tau*h);
  float re=engineR(p.z+tau*V.z);
  float inside=1.-smoothstep(re-3.,re+3.,d);
  float surface=tau*hl+sqrt(max(re*re-d*d,0.));
  return inside*smoothstep(0.,5.,-surface);
}
float side(float front,float veil){return mix(1.-front,front,veil);}
float beyond(float t0,float tc,float sigma){return 1./(1.+exp(clamp(2.41*(t0-tc)/sigma,-30.,30.)));}
vec3 steamOf(vec3 g0,vec3 V,float tA,float u,float z0,float pf,float T,float veil){
  if(uSmoke<.0004&&uVent<.0004)return vec3(0.);
  float sE=uCam.z;
  float Hs=70.+60.*uSmoke;
  vec3 start=g0+tA*V;
  float steam=0.;
  float vapour=0.;
  for(int i=0;i<6;i++){
    float w=(float(i)+.5)/6.;
    vec3 p=start+(-Hs*log(w)/sE)*V;
    float r=length(p.xy);
    float lay=side(inFront(p,V),veil);
    float box=1.-smoothstep(120.,178.,max(abs(p.x),abs(p.y)));
    steam+=box*(.4+.6*exp(-pow((r-90.)/80.,2.)))*(1.-smoothstep(170.,330.,p.z))*lay;
    vapour+=exp(-pow(r/96.,2.))*(1.-smoothstep(40.,140.,p.z))*lay;
  }
  float layer=exp(-max(start.z,0.)/Hs)/6.;
  float b1=fbm2(vec2(u*.018+T*.03,z0*.016-T*.26+7.));
  float b2=fbm2(vec2(u*.045-T*.05,z0*.04-T*.5+2.));
  vec3 lit=mix(vec3(.3,.3,.33),vec3(.72,.4,.2),pf*exp(-max(z0,0.)/150.));
  return lit*(b1*.75+b2*.4)*smoothstep(.05,.6,b1)*steam*layer*uSmoke*1.05+vec3(.42,.47,.54)*(b2*.6+.4)*vapour*layer*uVent*.5;
}
float shellOf(float dist,float tc,float tAir,float rs,float w,vec3 e0,vec3 V,float veil){
  if(rs<.5)return 0.;
  float m=sqrt(max(rs*rs-dist*dist,0.));
  float edge=exp(-pow(max(dist-rs,0.)/w,2.));
  float limb=rs*w/sqrt(m*m+2.*rs*w)/sqrt(rs*w*.5);
  limb*=limb;
  float soft=w*2.+2.;
  float far=tc-m;
  float near=tc+m;
  float aFar=smoothstep(tAir-soft*.5,tAir+soft,far)*side(inFront(e0+far*V,V),veil);
  float aNear=smoothstep(tAir-soft*.5,tAir+soft,near)*side(inFront(e0+near*V,V),veil);
  return edge*limb*(aFar+aNear)*.5;
}
vec3 shockOf(float dist,float tc,float tAir,vec3 e0,vec3 V,float veil){
  if(uShockA<.0004)return vec3(0.);
  float rs=uShockR;
  float sw=1.8+max(rs-26.,0.)*.01;
  float lead=shellOf(dist,tc,tAir,rs,sw,e0,V,veil);
  float trail=shellOf(dist,tc,tAir,max(rs-sw*2.6,0.),sw*2.2,e0,V,veil)*.3;
  return vec3(.84,.88,1.)*(lead+trail)*.42*uShockA*(1.-smoothstep(170.,270.,rs));
}
vec4 inkOf(vec3 energy){
  vec3 col=tonemap(energy,1.15);
  float m=max(col.r,max(col.g,col.b));
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  col=max(col+n*smoothstep(0.,1.5/255.,m),0.);
  m=max(col.r,max(col.g,col.b));
  // Keep the paper flame saturated at its edges and pale in its hot core.
  // Hue comes from a normalized energy field; only coverage fades with power.
  float level=max(uPc,max(uVent*.13,uShockA));
  vec3 steady=tonemap(energy/max(level,.08),1.15);
  float hot=max(steady.r,max(steady.g,steady.b));
  vec3 hue=mix(vec3(1.,.44,.055),vec3(1.,.96,.78),smoothstep(.35,.88,hot));
  float alpha=.9*m;
  vec4 light=vec4(hue*alpha,alpha);
  return mix(vec4(col,m),light,uLight);
}
vec4 hazeInk(vec3 energy){
  float density=max(energy.r,max(energy.g,energy.b));
  float alpha=(1.-exp(-density*1.15))*.52;
  vec3 hue=mix(vec3(.74,.78,.82),vec3(.94,.95,.96),smoothstep(0.,1.2,density));
  return vec4(hue*alpha,alpha);
}
vec4 overInk(vec4 top,vec4 bottom){return top+bottom*(1.-top.a);}

struct Scene{vec3 V;vec3 g0;vec3 e0;vec3 hit;float tLow;float ring;float tCol;float tAir;float tAirE;float tLowE;float u;float z0;float s0;float dist;float tc;};
Scene sceneOf(vec2 vb){
  Scene S;
  S.V=towardViewer();
  float sE=uCam.z;
  S.g0=rayOf(vb);
  vec2 gh=groundHit(S.g0,S.V);
  S.tLow=gh.x;
  S.ring=gh.y;
  S.tCol=columnsNear(S.g0,S.V);
  S.tAir=max(S.tLow,S.tCol);
  S.hit=S.g0+S.tLow*S.V;
  S.e0=rayOf(vb-uJit);
  S.u=(vb.x-uJit.x-uOrigin.x)/uK;
  S.z0=S.e0.z;
  S.s0=ZE-S.z0;
  S.tLowE=S.tLow+(S.g0.z-S.e0.z)/sE;
  S.tAirE=S.tAir+(S.g0.z-S.e0.z)/sE;
  vec3 C=vec3(0.,0.,ZE-6.);
  S.tc=dot(C-S.e0,S.V);
  S.dist=length(S.e0+S.tc*S.V-C);
  return S;
}
`;

const PLUME = `${COMMON}
uniform float uGlow;
uniform float uPre;
uniform float uReach;
uniform float uSplash;
uniform float uFlash;
uniform float uRingR;
uniform float uRingA;
uniform float uPop;
uniform float uPopR;
float onDeck(vec2 p){return 1.-smoothstep(134.,150.,max(abs(p.x),abs(p.y)));}
float radiusAt(float s,float pf,float warm){
  float spread=.045+.12*(1.-pf);
  return R0*(1.-.07*pf*smoothstep(0.,40.,s)-.42*warm*smoothstep(0.,80.,s))+spread*max(s,0.);
}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  Scene S=sceneOf(vb);
  vec3 V=S.V;
  float sE=uCam.z;
  float cE=uCam.w;
  float tanE=sE/cE;
  float T=uTime;
  float pc=clamp(uPc,0.,1.);
  float pf=pc;
  float warm=1.-clamp(uHue,0.,1.);
  float glow=uGlow;
  float dith=hash12(gl_FragCoord.xy);
  vec3 col=vec3(0.);
  vec3 g0=S.g0;
  vec3 e0=S.e0;
  float u=S.u;
  float z0=S.z0;
  float s0=S.s0;
  vec3 hit=S.hit;
  float rho=length(hit.xy);
  vec2 dirH=hit.xy/max(rho,1e-3);

  float tongue=fbm2(vec2(u*.07,s0*.06-T*8.));
  float reach=uReach*(1.+(tongue-.5)*.55*warm);
  float rag=1.+1.6*warm;
  float lam=29.+7.*pf;
  float v0=19.+6.*pf;
  float cellOn=smoothstep(.4,.95,pf);

  if((glow>.0004||uVent>.0004)&&abs(u)<RB){
    float e=fbm2(vec2(u*.06+7.,s0*.03-T*4.6));
    float e2=fbm2(vec2(u*.16-3.,s0*.08-T*7.3));
    float streak=.86+.3*fbm2(vec2(u*.22,s0*.012-T*9.));
    float flick=(.94+.06*sin(T*97.+s0*.23))*(1.+uPre*warm*(tongue-.45)*.9);
    float mist=fbm2(vec2(u*.035+.4*T,s0*.022-T*.7));
    float halfChord=sqrt(max(RB*RB-u*u,0.))/cE;
    float ta=max(S.tAirE,-halfChord);
    float tb=min((ZE+2.-z0)/sE,halfChord);
    float dt=max(tb-ta,0.)/28.;
    vec3 sum=vec3(0.);
    vec3 cold=vec3(0.);
    for(int i=0;i<28;i++){
      float t=ta+(float(i)+dith)*dt;
      vec3 p=e0+t*V;
      float s=ZE-p.z;
      float r=length(p.xy);
      float keep=(1.-smoothstep(RB*.8,RB,r))*smoothstep(-.5,4.,s);
      float Rv=radiusAt(s,pf,warm);
      float Re=Rv*(1.+(e-.5)*.42*rag*smoothstep(4.,120.,s)+(e2-.5)*.1*rag*smoothstep(0.,40.,s));
      float rn=r/Re;
      float fade=(1.-smoothstep(reach-46.,reach,s))*keep;
      vec3 violet=mix(vec3(.86,.44,1.),vec3(1.,.5,.62),smoothstep(0.,150.,s)*.7);
      vec3 ember=mix(vec3(1.,.36,.07),vec3(1.,.7,.32),tongue);
      vec3 bodyCol=mix(violet,ember,warm);
      float fill=smoothstep(1.06,.72,rn);
      float wBody=dt*cE/(2.*Re);
      sum+=bodyCol*fill*wBody*(.26+.3*exp(-max(s,0.)/110.))*streak*flick*fade*2.;
      sum+=bodyCol*exp(-rn*rn*2.)*(dt*cE/(Re*1.25))*.22*fade;
      float rc=Rv*.34;
      sum+=mix(vec3(1.,.74,.9),vec3(1.,.8,.45),warm)*exp(-(r*r)/(rc*rc))*(dt*cE/(rc*1.772))*.34*(1.-.5*smoothstep(PL-30.,PL+10.,s))*fade;
      float rb=Rv*.62;
      sum+=mix(vec3(1.,.9,.76),vec3(1.,.78,.46),warm)*exp(-(r*r)/(rb*rb))*exp(-max(s,0.)/24.)*(dt*cE/(rb*1.772))*1.6*keep;
      float sw=Re*.24;
      float shell=exp(-pow((r-Re*.9)/sw,2.))*smoothstep(8.,150.,s)*(dt*cE/(sw*3.545));
      sum+=vec3(1.,.42,.12)*shell*mix(.8,.3,uLight)*(.35+1.1*e)*fade;
      sum+=vec3(1.,.8,.52)*smoothstep(PL-30.,PL+4.,s)*fill*wBody*.8*fade;
      for(int c=0;c<4;c++){
        float fc=float(c);
        float vc=v0+fc*lam+sin(T*47.+fc*2.3)*.6;
        float Rc=R0*(1.-.07*pf)+(.045+.12*(1.-pf))*vc;
        float amp=exp(-fc*.28)*cellOn*(1.-smoothstep(reach-70.,reach-10.,vc))*(1.-smoothstep(PL-24.,PL-6.,vc))*keep;
        float rm=Rc*.33;
        float ph=(s-vc)/(lam*.62);
        float taper=rm*(1.06-clamp(ph,0.,1.)*.8)+.6;
        float bead=exp(-pow(r/taper,2.)*2.)*exp(-max(ph,0.)*2.2)*smoothstep(-.16,.02,ph)*(1.-smoothstep(.7,1.,ph));
        sum+=vec3(1.,.82,.46)*bead*(dt*cE/(taper*1.25))*2.1*amp;
        float d=r/(Rc*.9)+abs(s-vc+lam*.08)/(lam*.5);
        sum+=vec3(1.,.5,.64)*pow(clamp(1.-d,0.,1.),2.2)*(dt*cE/(Rc*.9*.62))*1.05*amp;
      }
      float sigma=R0*(.85+max(s,0.)*.012);
      cold+=vec3(.5,.56,.64)*exp(-(r*r)/(sigma*sigma))*(dt*cE/(sigma*1.772))*smoothstep(0.,16.,s)*(1.-smoothstep(50.,170.,s))*keep;
    }
    col+=sum*glow;
    col+=cold*mist*uVent*.62;
  }

  if(glow>.0004){
    float sh=radiusAt(clamp(s0,0.,PL),pf,warm)*2.2;
    float span=2.6*sh/cE;
    float h0=max(S.tAirE,-span);
    float dh=max(span-h0,0.)/8.;
    float halo=0.;
    for(int i=0;i<8;i++){
      float t=h0+(float(i)+dith)*dh;
      float z=z0+t*sE;
      float rr=u*u+t*t*cE*cE;
      halo+=exp(-rr/(sh*sh))*exp(-max(ZE-z,0.)/240.)*smoothstep(0.,30.,z)*smoothstep(ZE+25.,ZE-15.,z);
    }
    col+=mix(vec3(.9,.42,.62),vec3(1.,.45,.16),warm)*halo*(dh*cE/(sh*1.772))*.16*glow;
  }
  for(int c=0;c<4;c++){
    float fc=float(c);
    float vc=v0+fc*lam+sin(T*47.+fc*2.3)*.6;
    float Rc=R0*(1.-.07*pf)+(.045+.12*(1.-pf))*vc;
    float amp=exp(-fc*.28)*cellOn*(1.-smoothstep(reach-70.,reach-10.,vc))*(1.-smoothstep(PL-24.,PL-6.,vc));
    float rm=Rc*.33;
    float q=length(vec2(u/rm,(s0-vc)/(rm*tanE+1.2)));
    col+=vec3(1.,.98,.9)*exp(-q*q*2.4)*2.6*amp*glow;
  }

  float dist=S.dist;
  col+=vec3(1.,.84,.64)*uFlash*(exp(-pow(dist/120.,2.))*.36*beyond(S.tAirE,S.tc,120.)+exp(-dist/30.)*1.5*beyond(S.tAirE,S.tc,30.));
  col+=shockOf(dist,S.tc,S.tAirE,e0,V,0.);

  float floorSeen=S.tCol>S.tLow?0.:1.;
  float deck=onDeck(hit.xy)*floorSeen;
  vec3 tube=hit-vec3(dirH*68.,6.4);
  float tubeLit=max(dot(normalize(tube),normalize(vec3(-dirH*68.,26.))),0.);
  float facing=mix(1.,.15+1.3*tubeLit,S.ring);
  float splash=uSplash*pf;
  if(splash>.0004||uRingA>.0004){
    float flow=fbm3(vec3(dirH*2.4,rho*.035-T*3.8));
    float flow2=noise3(vec3(dirH*5.1+9.,rho*.07-T*6.1));
    float reachS=56.+80.*splash;
    float sheet=exp(-pow(rho/reachS,1.5))*deck*facing;
    vec3 hot=mix(vec3(1.,.38,.1),vec3(1.,.82,.55),exp(-rho/26.));
    col+=hot*sheet*(.26+.56*flow+.22*flow2)*splash*.62;
    col+=vec3(1.,.88,.7)*exp(-pow(rho/40.,2.))*splash*.9*floorSeen;
    float dust=noise3(vec3(dirH*7.,rho*.05));
    float gw=4.+uRingR*.034;
    col+=vec3(1.,.8,.6)*exp(-pow((rho-uRingR)/gw,2.))*(.45+dust)*deck*facing*uRingA*.5;
    if(splash>.0004){
      float tS=(70.-g0.z)/sE;
      float dS=max(tS-S.tAir,0.)/10.;
      float curtain=0.;
      for(int i=0;i<10;i++){
        vec3 p=g0+(S.tAir+(float(i)+dith)*dS)*V;
        float r=length(p.xy);
        float h=max(p.z-ground(r),0.);
        curtain+=exp(-pow((r-reachS*.8)/(reachS*.34),2.))*exp(-h/26.)*onDeck(p.xy)*dS*sE/26.;
      }
      float lick=fbm2(vec2(u*.05+T*.3,z0*.06-T*1.4));
      col+=vec3(1.,.46,.16)*curtain*lick*.55*splash;
    }
  }

  vec3 steam=steamOf(g0,V,S.tAir,u,z0,pf,T,0.);
  if(uLight<.5) col+=steam;

  if(uPop>.0004){
    vec3 Cp=vec3(0.,0.,ZE-uPopR*.55);
    float tp=dot(Cp-e0,V);
    float pd=length(e0+tp*V-Cp);
    float pn=fbm2(vec2(u*.045,s0*.045-T*2.4));
    col+=vec3(1.,.46,.15)*exp(-pow(pd/uPopR,2.))*(.55+.7*pn)*smoothstep(ZE+24.,ZE-12.,z0)*beyond(S.tAirE,tp,uPopR)*uPop*.95;
  }

  gl_FragColor=uLight>.5?overInk(hazeInk(steam),inkOf(col)):inkOf(col);
}`;

const VEIL = `${COMMON}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  Scene S=sceneOf(vb);
  float pf=clamp(uPc,0.,1.);
  vec3 col=steamOf(S.g0,S.V,S.tAir,S.u,S.z0,pf,uTime,1.);
  col+=shockOf(S.dist,S.tc,S.tAirE,S.e0,S.V,1.);
  gl_FragColor=uLight>.5?hazeInk(col):inkOf(col);
}`;

const SHARED = ["uJit", "uPc", "uHue", "uSmoke", "uVent", "uShockR", "uShockA", "uLight"];
const layer = glLayer({
  canvas,
  fragment: PLUME,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: [...SHARED, "uGlow", "uPre", "uReach", "uSplash", "uFlash", "uRingR", "uRingA", "uPop", "uPopR"],
});
const veil = layer
  ? glLayer({
      canvas: veilCanvas,
      fragment: VEIL,
      view: [D.W, D.H],
      camera: D.camera,
      uniforms: SHARED,
    })
  : null;
if (layer) stage.setAttribute("data-gl", "");
let LIGHT = (root.closest(".iso") || document.body).dataset.theme === "light" || root.closest('[data-theme="light"]') ? 1 : 0;

let lastKey = "";
function paintPlume(values, active, veiled) {
  if (!layer) return;
  if (!active) {
    layer.clear();
    if (veil) veil.clear();
    lastKey = "";
    return;
  }
  const time = still.matches ? 0.8 : clock;
  const key = still.matches ? JSON.stringify(values) + veiled : "";
  if (key && key === lastKey) return;
  lastKey = key;
  layer.draw(values, time);
  if (!veil) return;
  if (veiled) veil.draw(values, time);
  else veil.clear();
}

function announce(phase) {
  if (burn.phase === phase) return;
  burn.phase = phase;
  if (live) live.textContent = phase;
}

function fireState(state) {
  if (state) fireButton.dataset.state = state;
  else delete fireButton.dataset.state;
}

function ignite(fromTour = false) {
  if (burn.on) return;
  setApart(false);
  select(null);
  burn.on = true;
  describe();
  burn.armed = true;
  burn.tour = fromTour;
  burn.t = 0;
  burn.stopping = -1;
  burn.glowStop = null;
  burn.popped = false;
  burn.stopAt = fromTour ? MAIN + 4.2 : MAIN + STEADY;
  fireState("armed");
  fireLabel.textContent = "Shut down";
  run();
}

function shutdown() {
  if (!burn.on || burn.stopping >= 0) return;
  burn.stopping = burn.t;
}

function pcTarget() {
  if (!burn.on || burn.armed || burn.stopping >= 0) return 0;
  if (burn.t >= MAIN) return 1;
  if (burn.t >= VENT) return PREBURNER_PC;
  return 0;
}

function stepBurn(dt, calm) {
  if (burn.on && burn.armed && IDS.every((id) => piece[id].x < 0.002 && !piece[id].pending)) {
    burn.armed = false;
    fireState("on");
    if (calm) burn.t = MAIN + 0.5;
  }
  const before = burn.t;
  if (burn.on && !burn.armed) burn.t += dt;
  const t = burn.t;
  if (burn.on && burn.stopping < 0 && t >= burn.stopAt) burn.stopping = t;
  const lit = burn.on && !burn.armed && burn.stopping < 0;
  if (lit && t >= MAIN && before < MAIN && !calm) burn.mainAt = clock;
  const target = pcTarget();
  if (calm) {
    burn.pc = target;
    burn.pcRate = 0;
  } else {
    const falling = burn.stopping >= 0;
    const stiff = falling ? 16 : target > PREBURNER_PC ? 20 : 64;
    const drag = falling ? 8.2 : 2 * Math.sqrt(stiff);
    for (let index = 0; index < 4; index++) {
      const h = dt / 4;
      burn.pcRate += ((target - burn.pc) * stiff - burn.pcRate * drag) * h;
      burn.pc = clamp(burn.pc + burn.pcRate * h, 0, 1);
    }
  }
  settle(burn.hue, lit && burn.pc > 0.2 ? 1 : 0, dt, lit ? 0.32 : 0.5, calm);
  const onset = smooth(0, 0.1, burn.pc);
  let glow = onset * (1.15 - 0.15 * burn.hue.x);
  if (burn.stopping >= 0 && !calm) {
    if (!burn.glowStop) burn.glowStop = { glow: burn.lastGlow ?? glow, onset: Math.max(onset, 1e-3), pc: Math.max(burn.pc, 1e-3) };
    const stop = burn.glowStop;
    glow = Math.min(stop.glow, stop.glow * Math.min(1, onset / stop.onset) * Math.sqrt(Math.min(1, burn.pc / stop.pc)));
  }
  if (!burn.on) glow = 0;
  burn.lastGlow = glow;
  settle(burn.pre, lit && t > VENT && t < MAIN + 0.1 ? 1 : 0, dt, lit && t < MAIN ? 0.06 : 0.12, calm);
  settle(burn.vent, lit && t < MAIN ? 1 : 0, dt, lit && t < MAIN ? 0.16 : 0.24, calm);
  settle(burn.reach, 72 * smooth(0, 0.12, burn.pc) + (LONGEST - 72) * smooth(0.16, 0.75, burn.pc), dt, burn.stopping >= 0 ? 0.12 : 0.07, calm);
  settle(burn.splash, smooth(0.35, 0.9, burn.pc) * smooth(D.plumeLength - 10, D.plumeLength + 40, burn.reach.x), dt, 0.16, calm);
  settle(burn.smoke, lit && t > MAIN + 0.4 ? 1 : 0, dt, lit ? 0.9 : 1.8, calm);
  if (burn.on && burn.stopping >= 0 && burn.pc < 0.2 && !burn.popped && !calm) {
    burn.popAt = clock;
    burn.popped = true;
  }
  if (burn.on && burn.stopping >= 0 && burn.pc < 0.003 && Math.abs(burn.pcRate) < 0.01 && t - burn.stopping > 0.9) {
    burn.on = false;
    burn.t = -1;
    burn.pc = 0;
    burn.pcRate = 0;
    burn.glowStop = null;
    fireState("");
    fireLabel.textContent = "Ignite";
    announce("cold");
    describe();
    if (burn.tour) tourClock = 0;
  }

  const sinceMain = clock - burn.mainAt;
  const sincePop = burn.popAt >= 0 ? clock - burn.popAt : -1;
  const flash = calm ? 0 : burst(sinceMain, 0.08, 0.13);
  const shockA = calm ? 0 : burst(sinceMain, 0.05, 0.12);
  const ringA = calm ? 0 : burst(sinceMain - 0.08, 0.08, 0.16);
  const pop = calm || sincePop < 0 ? 0 : burst(sincePop, 0.09, 0.2);
  const shake = calm ? 0 : 3.2 * burst(sinceMain, 0.05, 0.12);
  const hum = calm ? 0 : 0.32 * burn.pc * smooth(0.02, 0.12, burn.pc);
  jitter = [Math.sin(clock * 91) * hum + Math.sin(clock * 53) * shake, Math.cos(clock * 77) * hum * 0.7 + Math.cos(clock * 61) * shake];

  const values = {
    uJit: jitter,
    uPc: burn.pc,
    uHue: burn.hue.x,
    uGlow: glow,
    uLight: LIGHT,
    uPre: burn.pre.x,
    uVent: burn.vent.x,
    uSmoke: burn.smoke.x,
    uReach: burn.reach.x,
    uSplash: burn.splash.x,
    uFlash: flash,
    uShockR: 26 + 900 * Math.max(0, sinceMain),
    uShockA: shockA,
    uRingR: 600 * Math.max(0, sinceMain - 0.08),
    uRingA: ringA,
    uPop: pop,
    uPopR: 24 + 70 * (1 - Math.exp(-Math.max(0, sincePop) / 0.25)),
  };
  const active = burn.pc > 1e-3 || burn.pre.x > 1e-3 || burn.vent.x > 1e-3 || burn.smoke.x > 1e-3 || flash > 1e-3 || shockA > 1e-3 || ringA > 1e-3 || pop > 1e-3 || (sinceMain > 0 && sinceMain < 0.6);
  paintPlume(values, active, burn.smoke.x > 1e-3 || burn.vent.x > 1e-3 || shockA > 1e-3);

  const rim = clamp(burn.pc * 0.85 + burn.pre.x * 0.45 * smooth(0, 0.05, burn.pc) + flash * 0.6 + pop * 0.7, 0, 1);
  stage.style.setProperty("--rim", rim.toFixed(3));
  stage.style.setProperty("--deck-glow", clamp(burn.pc * 0.9 * burn.splash.x + flash * 0.5 + burn.pre.x * 0.12 * smooth(0, 0.05, burn.pc) + pop * 0.25, 0, 1).toFixed(3));
  flashVeil.style.opacity = (flash * 0.32).toFixed(3);
  stage.style.transform = shake > 0.01 ? `translate(${(Math.sin(clock * 47) * shake * 0.5).toFixed(2)}px, ${(Math.cos(clock * 59) * shake * 0.5).toFixed(2)}px)` : "";

  if (burn.on) {
    const bar = fmt(burn.pc * 100);
    const thrust = fmt(Math.max(0, D.vacuumTf * burn.pc - D.backTf));
    if (burn.armed) {
      say("closing up · arming");
      announce("arming");
    } else if (burn.stopping >= 0) {
      say(burn.pc > 0.01 ? `shutdown · ${bar}% pressure` : "shutdown · purging");
      announce("shutdown");
    } else if (t < VENT) {
      say("chill-down · venting");
      announce("chill-down, venting");
    } else if (t < MAIN) {
      say(`spin-up · preburners lit · ${bar}% pressure`);
      announce("preburners lit");
    } else {
      say(`Model pressure ${bar}% · main burn`);
      announce("main stage");
    }
  }
  return burn.on || active;
}

const TOUR_STEP = 1.5;
function tourAt(time) {
  const apartFrom = 0.4;
  const listFrom = apartFrom + 0.9;
  const listTo = listFrom + D.order.length * TOUR_STEP;
  const fire = listTo + 1.4;
  if (time < apartFrom) return { apart: false, part: null, fire: false };
  if (time < listFrom) return { apart: true, part: null, fire: false };
  if (time < listTo) return { apart: true, part: D.order[Math.floor((time - listFrom) / TOUR_STEP)], fire: false };
  if (time < fire) return { apart: false, part: null, fire: false };
  return { apart: false, part: null, fire: true };
}

function quietTour() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inside || burn.on) return quietTour();
    touring = false;
    tourClock = -0.6;
    run();
  }, 60000);
}

function idleText() {
  if (selected) return D.pieces[selected].say;
  const moving = IDS.some((id) => Math.abs(piece[id].x - piece[id].target) > 0.002 || piece[id].pending);
  if (moving) return apart ? "taking apart" : "closing up";
  return apart ? "apart · 11 assemblies" : "Cold · educational model";
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  lessonTick(dt);
  if (touring && !burn.on) {
    tourClock += dt;
    const step = tourAt(tourClock);
    setApart(step.apart);
    select(step.part);
    if (step.fire) ignite(true);
  }
  let moving = false;
  for (const id of IDS) if (steerSpring(piece[id], dt, calm)) moving = true;
  const burning = stepBurn(dt, calm);
  place();
  if (!burn.on) say(idleText());
  frame = visible && (moving || burning || touring || (lessonPlaying && !still.matches)) ? requestAnimationFrame(tick) : 0;
}

function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: "120px 0px" },
).observe(stage);

function pieceAt(event) {
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const item = hit && hit.closest ? hit.closest(".it") : null;
  return item ? item.dataset.piece : null;
}

stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  inside = true;
  clearTimeout(leaveTimer);
  quietTour();
  if (burn.on) return;
  if (apart) select(pieceAt(event));
  run();
});

stage.addEventListener("pointerleave", () => {
  inside = false;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    if (inside) return;
    if (!explicitApart) { select(null); setApart(false); highlightLesson(); }
  }, 260);
});

stage.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || burn.on) return;
  quietTour();
  const id = pieceAt(event);
  if (!id || id === "stand") {
    select(null);
    setApart(!apart);
  } else {
    setApart(true);
    select(id);
  }
  run();
});

fireButton.addEventListener("click", () => {
  quietTour();
  if (burn.on) shutdown();
  else ignite(false);
  run();
});

partButtons.forEach((button) => {
  const show = () => {
    if (burn.on) return;
    stopLesson();
    quietTour();
    clearTimeout(leaveTimer);
    explicitApart = true;
    explodeButton.textContent="Assemble";explodeButton.setAttribute("aria-pressed","true");
    setApart(true);
    select(button.dataset.part);
    run();
  };
  const hide = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (inside || partButtons.some((other) => other.matches(":hover, :focus-visible"))) return;
      select(null);
      setApart(false);
    }, 260);
  };




  button.addEventListener("click", show);
});

stage.addEventListener("keydown", (event) => {
  const index = selected ? D.order.indexOf(selected) : -1;
  let next = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(D.order.length - 1, index + 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = D.order.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    quietTour();
    explicitApart=false;
    explodeButton.textContent="Explode view";explodeButton.setAttribute("aria-pressed","false");
    if (burn.on) shutdown();
    select(null);
    setApart(false);
    run();
    return;
  } else if (event.key === "i" || event.key === "I" || event.key === "Enter") {
    event.preventDefault();
    quietTour();
    if (burn.on) shutdown();
    else ignite(false);
    run();
    return;
  } else if (event.key === " ") {
    event.preventDefault();
    quietTour();
    if (!burn.on) {explicitApart=!apart;setApart(explicitApart);explodeButton.textContent=explicitApart?"Assemble":"Explode view";explodeButton.setAttribute("aria-pressed",String(explicitApart));}
    if (!apart) select(null);
    run();
    return;
  }
  if (next === null || burn.on) return;
  event.preventDefault();
  quietTour();
  explicitApart=true;
  explodeButton.textContent="Assemble";explodeButton.setAttribute("aria-pressed","true");
  setApart(true);
  select(D.order[next]);
  run();
});

if (still.matches) touring = false;
const narrow = matchMedia("(hover: none), (max-width: 480px)");
const hint = root.querySelector(".rp-hint");
const wording = () => hint && (hint.textContent = narrow.matches ? "Tap to take apart" : "Hover the engine to take it apart");
wording();
narrow.addEventListener("change", wording);
window.addEventListener("resize", () => {
  lastKey = "";
  run();
});
place();
say(idleText());
// Conceptual sequence: both turbine circuits operate simultaneously during firing.
const LESSONS = [
  {title:'Two liquids. Two pumps.', short:'Pump', parts:['otp','ftp','lox','downcomer'], text:'Liquid oxygen and liquid methane enter separate turbopumps. Each pump raises its liquid’s pressure enough to feed the high-pressure engine.', fact:'A turbine extracts energy from hot gas to turn a shaft. That shaft drives a pump which pressurizes incoming liquid; the turbine gas and pumped liquid are distinct streams.', trail:'Liquid feeds → pumps → high-pressure liquid'},
  {title:'Burn a little. Move a lot.', short:'Preburn', parts:['orpb','ftp','plumbing'], text:'Most oxygen enters an oxygen-rich preburner with a small methane crossfeed. Most methane enters a fuel-rich preburner with a small oxygen crossfeed.', fact:'The mixtures are deliberately far from balanced. Limited combustion makes large flows of warm gas without exposing the turbines to main-chamber temperatures.', trail:'Oxygen-rich branch + fuel-rich branch'},
  {title:'The gas powers its own supply.', short:'Drive', parts:['otp','ftp','hotgas'], text:'Each preburner’s high-pressure gas expands through a turbine, driving its pump. Both turbine exhaust streams still have enough pressure to enter the main chamber.', fact:'Full-flow: the main propellant supply collectively passes through these two turbine circuits. Turbine exhaust is kept for combustion, rather than discarded through a separate exhaust.', trail:'Preburners → turbines → injector'},
  {title:'Fuel protects the metal.', short:'Cool', parts:['downcomer','nozzle','chamber'], text:'Methane travels through cooling passages around the hot chamber and nozzle, absorbing heat before continuing through the fuel circuit.', fact:'This is regenerative cooling: heat moves from the wall into propellant that the engine will burn anyway. The outer ribs suggest the jacket; internal channels are not shown.', trail:'Pumped methane → cooling jacket → fuel circuit'},
  {title:'Two streams become one flame.', short:'Combine', parts:['hotgas','orpb','chamber'], text:'At the injector, the oxygen-rich and fuel-rich gases finally mix. Their remaining reactants burn together, releasing most of the energy in the main chamber.', fact:'Staged combustion means combustion first powers the pumps, then continues in the main chamber. The six lesson steps describe flow relationships, not a real startup timeline.', trail:'Hot oxygen-rich gas + hot fuel-rich gas → main combustion'},
  {title:'Expand the gas. Measure the force.', short:'Thrust', parts:['nozzle','gimbal'], text:'Hot gas accelerates through the narrow throat and expands through the bell. Its downward momentum produces upward thrust, carried through the mount into the stand’s load cell.', fact:'The deflector redirects the exhaust; deluge water protects the stand and suppresses sound. A rocket does not need to push against the ground or the air.', trail:'Chamber → throat → nozzle → exhaust'}
];
let lessonIndex = 0;
let lessonPlaying = !still.matches;
let lessonTime = 0;
let explicitApart = false;
const lessonButtons = [...root.querySelectorAll('[data-lesson]')];
const titleEl = root.querySelector('[data-lesson-title]');
const textEl = root.querySelector('[data-lesson-text]');
const factEl = root.querySelector('[data-lesson-fact]');
const trailEl = root.querySelector('[data-trail]');
const countEl = root.querySelector('[data-step-count]');
const tourButton = root.querySelector('[data-tour]');
const explodeButton = root.querySelector('[data-explode]');
function highlightLesson() {
  const ids = LESSONS[lessonIndex].parts;
  stage.setAttribute('data-focus','');
  nodes.forEach(n => n.el.toggleAttribute('data-on', ids.includes(n.piece)));
}
function showLesson(index, manual=true) {
  lessonIndex = (index + LESSONS.length) % LESSONS.length;
  const item = LESSONS[lessonIndex];
  titleEl.textContent = item.title;
  textEl.textContent = item.text;
  factEl.textContent = item.fact;
  trailEl.textContent = item.trail;
  countEl.textContent = `${String(lessonIndex+1).padStart(2,'0')} / 06`;
  lessonButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===lessonIndex)));
  selected = null;
  highlightLesson();
  if (manual) { stopLesson(); quietTour(); }
  run();
}
function stopLesson() { lessonPlaying=false; tourButton.textContent='Play lesson'; tourButton.setAttribute('aria-pressed','false'); }
lessonButtons.forEach((b,i)=>b.addEventListener('click',()=>showLesson(i)));
root.querySelector('[data-next]').addEventListener('click',()=>showLesson(lessonIndex+1));
root.querySelector('[data-prev]').addEventListener('click',()=>showLesson(lessonIndex-1));
tourButton.addEventListener('click',()=>{
  quietTour();
  if (lessonPlaying) stopLesson();
  else { lessonPlaying=true;lessonTime=0;tourButton.textContent='Pause lesson';tourButton.setAttribute('aria-pressed','true');run(); }
});
explodeButton.addEventListener('click',()=>{
  quietTour(); stopLesson();
  if (burn.on) shutdown();
  explicitApart=!explicitApart;
  if (!burn.on) setApart(explicitApart);
  explodeButton.setAttribute('aria-pressed',String(explicitApart));
  explodeButton.textContent=explicitApart?'Assemble':'Explode view';
  highlightLesson();run();
});
function lessonTick(dt) {
  if (lessonPlaying && !still.matches) {
    lessonTime+=dt;
    if (lessonTime>9) {lessonTime=0;showLesson(lessonIndex+1,false);}
  }
  if (!burn.on && explicitApart && !apart) setApart(true);
}
root.querySelector('[data-theme-toggle]').addEventListener('click',()=>{
  const lightNow = (root.closest(".iso") || document.body).dataset.theme!=='light';
  (root.closest(".iso") || document.body).dataset.theme=lightNow?'light':'dark';
  LIGHT=lightNow?1:0;
  root.querySelector('[data-theme-toggle]').textContent=lightNow?'Dark paper':'Light paper';
  lastKey='';run();
});
fireButton.addEventListener('click',()=>{
  stopLesson();explicitApart=false;
  explodeButton.textContent='Explode view';explodeButton.setAttribute('aria-pressed','false');
});
showLesson(0,false);
if(lessonPlaying){tourButton.textContent="Pause lesson";tourButton.setAttribute("aria-pressed","true");}

