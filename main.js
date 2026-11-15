// Fly Hunt — browser pseudo-AR (3DOF) demo for Househeat
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const ROUND = 60;
const HIT_R = 0.2;           // generous hit radius around the fly (m)
const CAM_FOV_LONG = 69;     // iPhone main (1x) camera FOV across the long side (deg)

// ---------------- renderer / scenes ----------------
const canvas = $('gl');
const video = $('cam');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.03, 120);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 5, 3); scene.add(sun);

const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a99, 2.3));
const vmSun = new THREE.DirectionalLight(0xffffff, 1.5); vmSun.position.set(1, 2, 2); vmScene.add(vmSun);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);

let baseFov = 62, zoom = 1, scoped = false;

// ---------------- virtual room (no-camera fallback) ----------------
const room = buildRoom(); scene.add(room);
function buildRoom() {
  const g = new THREE.Group();
  const W = 14, H = 3.2, D = 14, floorY = -1.5;
  const wm = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.BackSide });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D),
    [wm(0xd8cdb8), wm(0xcfc2aa), wm(0xf4f1ea), wm(0x8a6a4a), wm(0xdcd2be), wm(0xc6b9a0)]);
  box.position.y = floorY + H / 2; g.add(box);
  const grid = new THREE.GridHelper(W, 14, 0x6b4f35, 0x775a3e); grid.position.y = floorY + 0.005; g.add(grid);
  const furn = (w, h, d, c, x, z, y0 = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c }));
    m.position.set(x, floorY + y0 + h / 2, z); g.add(m); return m;
  };
  furn(3.2, 0.45, 1.1, 0x3d5a80, 0, -6.3); furn(3.2, 0.6, 0.3, 0x34507a, 0, -6.7, 0.45);       // couch
  furn(0.3, 0.3, 1.1, 0x34507a, -1.6, -6.3, 0.45); furn(0.3, 0.3, 1.1, 0x34507a, 1.6, -6.3, 0.45);
  furn(1.3, 0.05, 0.8, 0x8d6e63, 3, -2, 0.72); furn(0.08, 0.72, 0.08, 0x6d4c41, 2.45, -2.3); furn(0.08, 0.72, 0.08, 0x6d4c41, 3.55, -1.7);
  furn(2, 2, 0.45, 0x5d4037, -6.75, 1.5);                                                        // shelf
  for (let i = 0; i < 4; i++) furn(1.9, 0.04, 0.4, 0x4e342e, -6.75, 1.5, 0.45 + i * 0.45);
  furn(0.45, 0.5, 0.45, 0xb0643c, 5.5, 5.5); const plant = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
  plant.position.set(5.5, floorY + 1.0, 5.5); g.add(plant);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ color: 0xaedcff }));
  win.position.set(6.98, 0.3, -1); win.rotation.y = -Math.PI / 2; g.add(win);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x111418 }));
  tv.position.set(0, 0.2, 6.98); tv.rotation.y = Math.PI; g.add(tv);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = floorY + 0.01; g.add(rug);
  return g;
}

// ---------------- the fly ----------------
function buildFly() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.55, metalness: 0.15 });
  const abd = new THREE.MeshStandardMaterial({ color: 0x2f7a4a, roughness: 0.25, metalness: 0.55 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xd0201a, roughness: 0.25, emissive: 0x3a0000 });
  const legM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const wingM = new THREE.MeshPhongMaterial({ color: 0xddeeff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, shininess: 90, depthWrite: false });
  const sph = (r, m) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
  const thorax = sph(0.05, body); thorax.scale.set(1, 0.9, 1.15); g.add(thorax);
  const ab = sph(0.055, abd); ab.scale.set(0.95, 0.8, 1.5); ab.position.set(0, -0.005, -0.1); g.add(ab);
  const head = sph(0.04, body); head.position.set(0, 0.005, 0.075); g.add(head);
  for (const s of [-1, 1]) { const e = sph(0.03, eye); e.position.set(0.03 * s, 0.015, 0.088); e.scale.set(0.9, 1.1, 0.9); g.add(e); }
  const legGeo = new THREE.CylinderGeometry(0.004, 0.003, 0.09, 5);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(legGeo, legM); l.position.set(0.04 * s, -0.05, 0.035 - i * 0.035);
    l.rotation.z = s * 0.7; l.rotation.x = (i - 1) * 0.45; g.add(l);
  }
  const shape = new THREE.Shape(); shape.absellipse(0.08, 0, 0.085, 0.032, 0, Math.PI * 2, false, 0);
  const wingGeo = new THREE.ShapeGeometry(shape, 20); wingGeo.rotateX(-Math.PI / 2);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.02 * s, 0.04, 0.0);
    const w = new THREE.Mesh(wingGeo, wingM); w.scale.x = s; w.rotation.y = 0.4 * s;
    pivot.add(w); g.add(pivot); wings.push({ pivot, s });
  }
  g.userData.wings = wings;
  return g;
}

const fly = {
  obj: buildFly(), pos: new V3(0, 0, -4), vel: new V3(), target: new V3(0, 0, -4), jitter: new V3(), heading: new V3(0, 0, -1),
  alive: true, deadT: 0, aimT: 0, react: 0.5, escapeT: 0, hoverT: 0, retargetT: 0, jitterT: 0, cruise: 1.6, aimed: false, speed: 0, flap: 0,
};
scene.add(fly.obj);

function randomPoint(around) {
  for (let i = 0; i < 12; i++) {
    const r = rand(3, 6), az = rand(0, Math.PI * 2), y = rand(-1.0, 1.2);
    const h = Math.sqrt(Math.max(r * r - y * y, 4));
    const p = new V3(Math.cos(az) * h, y, Math.sin(az) * h);
    if (!around || p.distanceTo(around) < 5) return p;
  }
  return new V3(rand(-4, 4), rand(-1, 1.2), rand(-4, 4)).setLength(4);
}
function clampBounds(p) {
  const r = Math.hypot(p.x, p.z);
  if (r < 2.3) { const k = 2.3 / Math.max(r, 1e-3); p.x *= k; p.z *= k; if (r < 1e-3) p.z = -2.3; }
  if (r > 6.5) { const k = 6.5 / r; p.x *= k; p.z *= k; }
  p.y = clamp(p.y, -1.2, 1.3);
  return p;
}
function respawnFly(inFront) {
  const f = fly;
  if (inFront) {
    const fwd = new V3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = clamp(fwd.y, -0.2, 0.25);
    f.pos.copy(fwd.normalize().multiplyScalar(4));
  } else f.pos.copy(randomPoint());
  clampBounds(f.pos);
  f.vel.set(0, 0, 0); f.target.copy(randomPoint(f.pos)); f.alive = true; f.deadT = 0; f.aimT = 0; f.escapeT = 0;
  f.react = rand(0.35, 0.75); f.cruise = rand(1.2, 2.0) * (1 + 0.5 * clamp(elapsed / ROUND, 0, 1));
  f.obj.visible = true; f.obj.rotation.set(0, 0, 0);
}
function escapeFly(to) {
  const f = fly, view = to.clone().normalize();
  const side = new V3().crossVectors(view, new V3(0, 1, 0)).normalize().multiplyScalar(Math.random() < 0.5 ? -1 : 1);
  const d = side.addScaledVector(view, rand(0.2, 0.7)).add(new V3(0, rand(-0.4, 0.6), 0)).normalize();
  f.target.copy(f.pos).addScaledVector(d, rand(2.5, 4)); clampBounds(f.target);
  f.escapeT = rand(0.45, 0.7); f.aimT = 0; f.react = rand(0.35, 0.75); f.hoverT = 0;
  if (state === 'playing') { stats.dodges++; const s = toScreen(f.pos); if (s.on) popup('dodged!', s.x, s.y - 30, 'small'); }
}

const tmpV = new V3(), desired = new V3(), camFwd = new V3();
function updateFly(dt, t) {
  const f = fly;
  if (!f.alive) {
    f.deadT += dt; f.vel.y -= 9.8 * dt; f.pos.addScaledVector(f.vel, dt);
    f.obj.position.copy(f.pos); f.obj.rotation.x += dt * 14; f.obj.rotation.z += dt * 9;
    f.obj.scale.setScalar(Math.max(0.01, 1 - f.deadT * 0.8));
    if (f.deadT > 0.7) f.obj.visible = false;
    if (f.deadT > 1.1) { f.obj.scale.setScalar(1); respawnFly(false); }
    return;
  }
  const to = tmpV.copy(f.pos).sub(camera.position); const dist = to.length();
  const ang = camFwd.angleTo(to);
  f.aimed = ang < Math.atan(0.45 / dist);
  if (f.aimed && state === 'playing') f.aimT += dt; else f.aimT = Math.max(0, f.aimT - dt * 0.5);
  if (f.escapeT <= 0 && f.aimT > f.react) escapeFly(to);

  f.escapeT -= dt; f.hoverT -= dt; f.retargetT -= dt; f.jitterT -= dt;
  const escaping = f.escapeT > 0;
  if (!escaping && (f.retargetT <= 0 || f.pos.distanceTo(f.target) < 0.5)) {
    if (Math.random() < 0.3) f.hoverT = rand(0.4, 1.4);
    f.target.copy(randomPoint(f.pos)); f.retargetT = rand(1.5, 4);
  }
  if (f.jitterT <= 0) {
    f.jitter.set(rand(-1, 1), rand(-0.6, 0.6), rand(-1, 1)).multiplyScalar(escaping ? 0.5 : 1.8);
    f.jitterT = rand(0.08, 0.3);
  }
  const speed = escaping ? 7.5 : (f.hoverT > 0 ? 0.3 : f.cruise);
  desired.copy(f.target).sub(f.pos); if (desired.lengthSq() > 1e-4) desired.normalize();
  desired.multiplyScalar(speed).add(f.jitter);
  f.vel.lerp(desired, 1 - Math.exp(-(escaping ? 10 : 3.2) * dt));
  f.pos.addScaledVector(f.vel, dt); clampBounds(f.pos);
  f.speed = f.vel.length();
  f.heading.lerp(f.vel, 1 - Math.exp(-8 * dt));
  f.obj.position.copy(f.pos); f.obj.position.y += Math.sin(t * 9) * 0.015;
  if (f.heading.lengthSq() > 1e-4) f.obj.lookAt(tmpV.copy(f.obj.position).add(f.heading));
  f.flap += dt * 60;
  for (const w of f.obj.userData.wings) w.pivot.rotation.z = w.s * Math.sin(f.flap * 2.6) * 0.9;
}

// ---------------- toy blasters (view model) ----------------
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,230,80,.95)'); g.addColorStop(1, 'rgba(255,120,0,0)');
  x.fillStyle = g; x.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 26 : 62; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.fill(); return new THREE.CanvasTexture(c);
})();
function buildBlaster(kind) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  const cyl = (r1, r2, l, s = 20) => new THREE.CylinderGeometry(r1, r2, l, s);
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const orange = m(0xff6d00), R = Math.PI / 2;
  let tipZ = -0.2;
  if (kind === 'pistol') {
    add(B(0.06, 0.07, 0.2), m(0x29b6f6), 0, 0, 0);
    add(cyl(0.018, 0.018, 0.1), m(0xffeb3b), 0, 0.005, -0.14, R);
    add(cyl(0.023, 0.023, 0.025), orange, 0, 0.005, -0.2, R);
    add(B(0.045, 0.11, 0.055), m(0x7c4dff), 0, -0.08, 0.055, 0.25);
    add(B(0.012, 0.03, 0.12), m(0x7c4dff), 0, 0.045, 0.0);
    tipZ = -0.215;
  } else if (kind === 'rapid') {
    add(B(0.08, 0.08, 0.26), m(0x66bb6a), 0, 0, 0);
    add(cyl(0.05, 0.05, 0.06), m(0xffeb3b), 0, -0.06, -0.04, 0, 0, R);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; add(cyl(0.011, 0.011, 0.12), m(0x00bcd4), Math.cos(a) * 0.02, Math.sin(a) * 0.02, -0.18, R); }
    add(cyl(0.034, 0.034, 0.025), orange, 0, 0, -0.245, R);
    add(B(0.045, 0.11, 0.055), m(0xff7043), 0, -0.09, 0.08, 0.25);
    add(cyl(0.03, 0.03, 0.09), m(0xffeb3b), 0, 0.06, 0.03, R);
    tipZ = -0.26;
  } else if (kind === 'shotgun') {
    add(B(0.09, 0.075, 0.28), m(0xff4081), 0, 0, 0);
    add(cyl(0.035, 0.035, 0.12), m(0xffeb3b), 0, 0.01, -0.19, R);
    add(cyl(0.055, 0.036, 0.045), orange, 0, 0.01, -0.27, R);
    add(B(0.07, 0.045, 0.1), m(0x00e5ff), 0, -0.05, -0.14);
    add(B(0.05, 0.11, 0.06), m(0x7c4dff), 0, -0.09, 0.09, 0.25);
    tipZ = -0.3;
  } else {
    add(B(0.05, 0.06, 0.34), m(0xab47bc), 0, 0, 0);
    add(cyl(0.012, 0.012, 0.3), m(0xffeb3b), 0, 0.005, -0.3, R);
    add(cyl(0.02, 0.02, 0.025), orange, 0, 0.005, -0.46, R);
    add(cyl(0.022, 0.022, 0.15), m(0x00bcd4), 0, 0.055, -0.02, R);
    add(B(0.04, 0.1, 0.05), m(0xffeb3b), 0, -0.075, 0.07, 0.25);
    add(B(0.045, 0.07, 0.12), m(0x7c4dff), 0, -0.01, 0.22);
    tipZ = -0.48;
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, tipZ); g.add(muzzle);
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  fl.scale.setScalar(kind === 'shotgun' ? 0.16 : 0.1); fl.position.copy(muzzle.position).z -= 0.03; fl.visible = false; g.add(fl);
  g.userData = { muzzle, flash: fl };
  g.visible = false; vmRoot.add(g);
  return g;
}
const WEAPONS = {
  pistol: { cooldown: 0.25, pellets: 1, spread: 0.5, auto: false, haptic: 12 },
  rapid: { cooldown: 0.09, pellets: 1, spread: 2.2, auto: true, haptic: 8 },
  shotgun: { cooldown: 0.7, pellets: 9, spread: 6, auto: false, haptic: 35 },
  sniper: { cooldown: 0.9, pellets: 1, spread: 3.5, auto: false, haptic: 30 },
};
for (const k in WEAPONS) WEAPONS[k].model = buildBlaster(k);
let weaponId = 'pistol';
let recoil = 0, flashT = 0;

// ---------------- foam darts (cosmetic, hits are hitscan) ----------------
const darts = [];
const dartGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8); dartGeo.rotateX(Math.PI / 2);
const tipGeo = new THREE.SphereGeometry(0.015, 8, 6);
const dartMat = new THREE.MeshBasicMaterial({ color: 0xff6d00 }), tipMat = new THREE.MeshBasicMaterial({ color: 0x2979ff });
function spawnDart(from, to) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(dartGeo, dartMat)); const tip = new THREE.Mesh(tipGeo, tipMat); tip.position.z = -0.045; g.add(tip);
  g.position.copy(from); g.lookAt(to); g.rotateY(Math.PI); // dart -z points forward after flip
  const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
  scene.add(g); darts.push({ g, dir, life: Math.min(len / 45, 0.4) });
}
function updateDarts(dt) {
  for (let i = darts.length - 1; i >= 0; i--) {
    const d = darts[i]; d.life -= dt; d.g.position.addScaledVector(d.dir, 45 * dt);
    if (d.life <= 0) { scene.remove(d.g); darts.splice(i, 1); }
  }
}

// ---------------- audio ----------------
const audio = { ctx: null };
function initAudio() {
  if (audio.ctx) { audio.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try {
    const c = new AC(); audio.ctx = c;
    const u = c.createBufferSource(); u.buffer = c.createBuffer(1, 1, 22050); u.connect(c.destination); u.start(0);
    c.resume();
    const master = c.createGain(); master.gain.value = 0.85; master.connect(c.destination); audio.master = master;
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; audio.noise = nb;
    // synthesized buzz: two detuned saws + vibrato + wingbeat tremolo -> bandpass -> HRTF panner
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 200;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 204;
    const lfo = c.createOscillator(); lfo.frequency.value = 6.5; const lfoG = c.createGain(); lfoG.gain.value = 14;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    const mix = c.createGain(); mix.gain.value = 0.3; o1.connect(mix); o2.connect(mix);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.7;
    const trem = c.createGain(); trem.gain.value = 0.75;
    const am = c.createOscillator(); am.frequency.value = 31; const amG = c.createGain(); amG.gain.value = 0.25; am.connect(amG); amG.connect(trem.gain);
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 1.4; p.maxDistance = 40;
    const out = c.createGain(); out.gain.value = 0;
    mix.connect(bp); bp.connect(trem); trem.connect(p); p.connect(out); out.connect(master);
    [o1, o2, lfo, am].forEach((o) => o.start());
    Object.assign(audio, { o1, o2, panner: p, buzzOut: out });
  } catch (e) { console.warn('audio init failed', e); }
}
function tone({ type = 'square', f0, f1, dur, vol = 0.2, delay = 0 }) {
  const c = audio.ctx; if (!c) return; const t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.03);
}
function noise({ dur, vol = 0.3, freq = 1500, type = 'lowpass', q = 0.7, delay = 0 }) {
  const c = audio.ctx; if (!c) return; const t = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = audio.noise;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(audio.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
}
const sfx = {
  fire(id) {
    if (id === 'pistol') { tone({ f0: 950, f1: 240, dur: 0.12, vol: 0.16 }); noise({ dur: 0.05, vol: 0.2, freq: 3000, type: 'highpass' }); }
    else if (id === 'rapid') { tone({ f0: 1300, f1: 500, dur: 0.06, vol: 0.09 }); }
    else if (id === 'shotgun') { noise({ dur: 0.25, vol: 0.55, freq: 900 }); tone({ type: 'sine', f0: 170, f1: 50, dur: 0.22, vol: 0.4 }); }
    else { tone({ type: 'sawtooth', f0: 1900, f1: 120, dur: 0.35, vol: 0.17 }); noise({ dur: 0.12, vol: 0.3, freq: 3000, type: 'bandpass' }); }
  },
  splat() {
    noise({ dur: 0.18, vol: 0.6, freq: 700 }); tone({ type: 'sine', f0: 520, f1: 90, dur: 0.2, vol: 0.3 });
    tone({ type: 'triangle', f0: 1320, f1: 1320, dur: 0.12, vol: 0.14, delay: 0.06 }); tone({ type: 'triangle', f0: 1760, f1: 1760, dur: 0.2, vol: 0.14, delay: 0.13 });
  },
  tick() { tone({ f0: 1000, f1: 1000, dur: 0.05, vol: 0.08 }); },
  end() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.2, vol: 0.15, delay: i * 0.11 })); },
};
const invQ = new Q();
function updateBuzz() {
  const c = audio.ctx; if (!c || !audio.panner) return; const t = c.currentTime;
  invQ.copy(camera.quaternion).invert();
  const rel = tmpV.copy(fly.pos).sub(camera.position).applyQuaternion(invQ); // camera space == default listener frame
  const p = audio.panner;
  if (p.positionX) { p.positionX.setTargetAtTime(rel.x, t, 0.02); p.positionY.setTargetAtTime(rel.y, t, 0.02); p.positionZ.setTargetAtTime(rel.z, t, 0.02); }
  else p.setPosition(rel.x, rel.y, rel.z);
  const f = 185 + fly.speed * 14 + (fly.escapeT > 0 ? 60 : 0);
  audio.o1.frequency.setTargetAtTime(f, t, 0.05); audio.o2.frequency.setTargetAtTime(f * 1.02, t, 0.05);
  const vol = !fly.alive ? 0 : state === 'playing' ? 1 : 0.35;
  audio.buzzOut.gain.setTargetAtTime(vol, t, 0.08);
}

// ---------------- haptics ----------------
const hapticLbl = $('hapticLbl');
function haptic(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); return; } catch (e) {} }
  try { hapticLbl.click(); } catch (e) {} // iOS 18+ Safari: toggling a <input switch> gives a light tap
}

// ---------------- camera / orientation ----------------
let mode = 'none'; // 'gyro' | 'drag' | 'mouse'
let devOri = null, oriEvents = 0, screenAngle = 0, yaw = 0, pitch = 0;
window.addEventListener('deviceorientation', (e) => { if (e.alpha == null) return; devOri = e; oriEvents++; });
function readScreenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  screenAngle = a * DEG;
}
const qDev = new Q(), qTmp = new Q(), q1 = new Q(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new V3(0, 0, 1), eul = new THREE.Euler();
let firstOri = true;
function updateCameraOrientation() {
  if (mode === 'gyro' && devOri) {
    eul.set(devOri.beta * DEG, devOri.alpha * DEG, -devOri.gamma * DEG, 'YXZ');
    qDev.setFromEuler(eul); qDev.multiply(q1); qDev.multiply(qTmp.setFromAxisAngle(zee, -screenAngle));
    if (firstOri) { camera.quaternion.copy(qDev); firstOri = false; } else camera.quaternion.slerp(qDev, 0.6);
  } else {
    eul.set(pitch, yaw, 0, 'YXZ'); camera.quaternion.setFromEuler(eul);
  }
  camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
}
function computeBaseFov() {
  const W = innerWidth, H = innerHeight;
  if (video.classList.contains('on') && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight, T = Math.tan(CAM_FOV_LONG / 2 * DEG);
    const tH = vw >= vh ? T * vh / vw : T;               // tan(half vertical FOV) of the video frame
    const s = Math.max(W / vw, H / vh);                   // object-fit: cover scale
    baseFov = 2 * Math.atan(tH * H / (vh * s)) / DEG;
  } else baseFov = W > H ? 60 : 72;
  applyFov();
}
function applyFov() {
  camera.fov = 2 * Math.atan(Math.tan(baseFov / 2 * DEG) / zoom) / DEG;
  camera.updateProjectionMatrix();
  video.style.transform = zoom > 1.001 ? `scale(${zoom})` : '';
}
function layoutViewmodel() {
  const a = innerWidth / innerHeight, z = -0.55;
  const hh = -z * Math.tan(25 * DEG), hw = hh * a;
  vmRoot.position.set(hw * (a < 1 ? 0.45 : 0.5), -hh * 0.55, z);
  vmRoot.userData.base = vmRoot.position.clone();
  vmRoot.scale.setScalar(a < 1 ? 0.42 : 0.6);
  vmRoot.rotation.set(0.04, 0.08, 0);
}
function onResize() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H);
  camera.aspect = vmCam.aspect = W / H; vmCam.updateProjectionMatrix();
  readScreenAngle(); computeBaseFov(); layoutViewmodel();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
video.addEventListener('loadedmetadata', computeBaseFov);
video.addEventListener('resize', computeBaseFov);

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Camera needs HTTPS. Using a virtual room.'); return false; }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = s; video.classList.add('on');
    try { await video.play(); } catch (e) {}
    return true;
  } catch (e) { toast('Camera blocked. Using a virtual room.'); return false; }
}
const waitOri = (ms) => new Promise((res) => { const t0 = performance.now(); const chk = () => { if (oriEvents > 0) res(true); else if (performance.now() - t0 > ms) res(false); else setTimeout(chk, 50); }; chk(); });

// ---------------- game state ----------------
let state = 'menu', elapsed = 0, timeLeft = ROUND, score = 0, lastTick = 0, lastShot = 0, triggerHeld = false;
const stats = { shots: 0, hits: 0, kills: 0, dodges: 0 };
let best = +(localStorage.getItem('flyhunt.best') || 0);
$('best').textContent = best;
if (!isTouch) $('deskNote').textContent = 'Desktop: click to lock the mouse, move to look, click to fire. Keys 1–4 switch blasters. Right-click or Z for the scope, wheel to zoom.';

let started = false;
async function begin(useCam) {
  initAudio();
  let oriP = Promise.resolve('granted');
  if (isTouch && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    oriP = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
  const camP = (useCam && isTouch) ? startCamera() : Promise.resolve(false);
  $('start').classList.add('hidden');
  const [ori, camOk] = await Promise.all([oriP, camP]);
  if (isTouch) {
    mode = (ori === 'granted' && await waitOri(1000)) ? 'gyro' : 'drag';
    if (mode === 'drag') toast('Motion sensors unavailable. Drag to look, tap to fire.');
  } else { mode = 'mouse'; canvas.requestPointerLock && canvas.requestPointerLock(); }
  room.visible = !camOk;
  started = true;
  onResize();
  updateCameraOrientation();
  startRound();
}
$('startBtn').addEventListener('click', () => begin(true));
$('nocamBtn').addEventListener('click', () => begin(false));
$('againBtn').addEventListener('click', () => { initAudio(); $('over').classList.add('hidden'); if (mode === 'mouse') canvas.requestPointerLock && canvas.requestPointerLock(); startRound(); });

function startRound() {
  state = 'playing'; elapsed = 0; timeLeft = ROUND; score = 0; lastTick = 0;
  Object.assign(stats, { shots: 0, hits: 0, kills: 0, dodges: 0 });
  respawnFly(true); updateHud();
}
function endRound() {
  state = 'over'; triggerHeld = false; setZoom(1); sfx.end();
  const nh = score > best; if (nh) { best = score; localStorage.setItem('flyhunt.best', best); }
  $('overTitle').textContent = nh ? 'NEW HIGH SCORE!' : 'TIME!';
  $('finalScore').textContent = score;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  $('finalStats').innerHTML = `🪰 Flies splatted: <b>${stats.kills}</b><br>🎯 Accuracy: <b>${acc}%</b> (${stats.hits}/${stats.shots})<br>💨 Dodges: <b>${stats.dodges}</b><br>${nh ? '<span class="nh">🏆 Best ever!</span>' : `Best: <b>${best}</b>`}`;
  $('best').textContent = best;
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => $('over').classList.remove('hidden'), 400);
}
function updateHud() {
  $('score').textContent = score;
  const tl = Math.ceil(timeLeft); $('time').textContent = tl;
  $('time').parentElement.classList.toggle('low', tl <= 10);
}

// ---------------- shooting ----------------
function coneDir(maxAng) {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * maxAng;
  return new V3(Math.sin(r) * Math.cos(a), Math.sin(r) * Math.sin(a), -Math.cos(r));
}
function muzzleWorld() {
  const m = WEAPONS[weaponId].model.userData.muzzle; vmScene.updateMatrixWorld();
  const ndc = m.getWorldPosition(new V3()).project(vmCam);
  if (scoped) ndc.set(0, -0.15, 0.5);
  return new V3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(0.35).add(camera.position);
}
function tryFire() {
  if (state !== 'playing') return;
  const now = performance.now() / 1000, w = WEAPONS[weaponId];
  if (now - lastShot < w.cooldown) return;
  lastShot = now; fire(w);
}
function fire(w) {
  stats.shots++;
  const toFly = fly.pos.clone().sub(camera.position); const dist = toFly.length(); toFly.normalize();
  const hitAng = Math.atan(HIT_R / dist);
  const spread = (weaponId === 'sniper' && scoped) ? 0.05 : w.spread;
  const from = muzzleWorld();
  let minAng = Infinity;
  for (let i = 0; i < w.pellets; i++) {
    const d = coneDir(spread * DEG).applyQuaternion(camera.quaternion);
    const ang = d.angleTo(toFly); minAng = Math.min(minAng, ang);
    const hitThis = fly.alive && ang < hitAng;
    if (i < 4) spawnDart(from, camera.position.clone().addScaledVector(d, hitThis ? dist : 14));
  }
  sfx.fire(weaponId); haptic(w.haptic);
  recoil = Math.min(1, recoil + (weaponId === 'rapid' ? 0.35 : 1));
  flashT = 0.06; const fl = $('flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 50);
  if (fly.alive && minAng < hitAng) killFly(dist);
  else if (fly.alive && minAng < Math.atan(1.0 / dist) && fly.escapeT <= 0) escapeFly(fly.pos.clone().sub(camera.position));
}
function killFly(dist) {
  stats.hits++; stats.kills++;
  let pts = 100 + Math.round(dist * 20); const tags = [];
  if (weaponId === 'sniper' && scoped) { pts = Math.round(pts * 1.5); tags.push('SNIPED'); }
  if (fly.escapeT > 0) { pts += 75; tags.push('TRICK SHOT'); }
  score += pts; updateHud();
  const s = toScreen(fly.pos); popup(`+${pts}${tags.length ? ' ' + tags.join(' ') : ''}`, s.on ? s.x : innerWidth / 2, s.on ? s.y : innerHeight / 2);
  fly.alive = false; fly.deadT = 0; fly.vel.set(rand(-0.5, 0.5), 1.2, rand(-0.5, 0.5));
  sfx.splat(); setTimeout(() => haptic(40), 60);
  const ch = $('crosshair'); ch.classList.add('hit'); setTimeout(() => ch.classList.remove('hit'), 150);
}

// ---------------- weapons & zoom UI ----------------
const ZOOMS = [1, 3, 6, 10];
function setZoom(z) {
  zoom = clamp(z, 1, 12);
  scoped = weaponId === 'sniper' && zoom > 1.25;
  if (!scoped) zoom = 1;
  document.body.classList.toggle('scoped', scoped);
  $('scope').classList.toggle('hidden', !scoped);
  $('zoomBtn').classList.toggle('on', scoped);
  $('zoomBtn').textContent = scoped ? `🔭 ${zoom.toFixed(zoom < 10 ? 1 : 0).replace('.0', '')}x` : '🔭 Scope';
  $('zoomLabel').textContent = `${zoom.toFixed(1).replace('.0', '')}x`;
  applyFov();
}
function cycleZoom() {
  if (weaponId !== 'sniper') selectWeapon('sniper');
  const i = ZOOMS.findIndex((z) => z >= zoom - 0.01 && z <= zoom + 0.01);
  setZoom(ZOOMS[(i + 1) % ZOOMS.length] || 3);
}
function selectWeapon(id) {
  weaponId = id; triggerHeld = false;
  for (const k in WEAPONS) WEAPONS[k].model.visible = k === id;
  document.querySelectorAll('.wbtn').forEach((b) => b.classList.toggle('sel', b.dataset.w === id));
  $('zoomBtn').classList.toggle('hidden', id !== 'sniper');
  setZoom(1);
  tone({ type: 'triangle', f0: 600, f1: 900, dur: 0.07, vol: 0.08 });
}
document.querySelectorAll('.wbtn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); selectWeapon(b.dataset.w); }));
$('zoomBtn').addEventListener('click', (e) => { e.stopPropagation(); cycleZoom(); });
$('recenter').addEventListener('click', (e) => { e.stopPropagation(); if (fly.alive) { respawnFly(true); fly.react = 0.9; } });
selectWeapon('pistol');

// ---------------- input ----------------
const pointers = new Map(); let pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault(); if (!started) return;
  if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume();
  if (mode === 'mouse') {
    if (document.pointerLockElement !== canvas) { if (state === 'playing') canvas.requestPointerLock && canvas.requestPointerLock(); return; }
    if (e.button === 2) { cycleZoom(); return; }
    if (e.button === 0) { triggerHeld = true; tryFire(); }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  if (pointers.size === 2) {
    triggerHeld = false; const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; return;
  }
  if (pointers.size === 1 && mode === 'gyro') { triggerHeld = true; tryFire(); }
});
canvas.addEventListener('pointermove', (e) => {
  if (mode === 'mouse') return;
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.sx, p.y - p.sy) > 10) p.moved = true;
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (weaponId !== 'sniper' && d / pinch.d > 1.15) { selectWeapon('sniper'); pinch.z = 1; }
    if (weaponId === 'sniper') setZoom(clamp(Math.max(pinch.z, 1) * d / pinch.d, 1, 12));
    return;
  }
  if (mode === 'drag' && pointers.size === 1) {
    const k = 0.005 / zoom; yaw += dx * k; pitch = clamp(pitch + dy * k, -1.45, 1.45);
  }
});
const endPointer = (e) => {
  if (mode === 'mouse') { triggerHeld = false; return; }
  const p = pointers.get(e.pointerId); if (!p) return;
  if (mode === 'drag' && !p.moved && pointers.size === 1 && !pinch) tryFire();
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) triggerHeld = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
window.addEventListener('mouseup', () => { if (mode === 'mouse') triggerHeld = false; });
document.addEventListener('mousemove', (e) => {
  if (mode !== 'mouse' || document.pointerLockElement !== canvas) return;
  const k = 0.0022 / zoom; yaw -= e.movementX * k; pitch = clamp(pitch - e.movementY * k, -1.45, 1.45);
});
window.addEventListener('wheel', (e) => { if (mode === 'mouse' && weaponId === 'sniper') setZoom((scoped ? zoom : 1) * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: true });
window.addEventListener('keydown', (e) => {
  const map = { Digit1: 'pistol', Digit2: 'rapid', Digit3: 'shotgun', Digit4: 'sniper' };
  if (map[e.code]) selectWeapon(map[e.code]);
  else if (e.code === 'KeyZ') cycleZoom();
  else if (e.code === 'KeyR') $('recenter').click();
  else if (e.code === 'Space' && state === 'playing') { triggerHeld = true; tryFire(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') triggerHeld = false; });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------------- HUD helpers ----------------
function toScreen(p) {
  const v = p.clone().project(camera);
  const inFront = tmpV.copy(p).sub(camera.position).dot(camFwd) > 0;
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, on: inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, ndc: v };
}
function popup(text, x, y, cls = '') {
  const d = document.createElement('div'); d.className = 'pop ' + cls; d.textContent = text;
  d.style.left = clamp(x, 80, innerWidth - 80) + 'px'; d.style.top = clamp(y, 60, innerHeight - 60) + 'px';
  $('pops').appendChild(d); setTimeout(() => d.remove(), 950);
}
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500); }
const arrow = $('arrow'), tri = arrow.querySelector('.tri'), arrowDist = $('arrowDist'), bracket = $('bracket'), crosshair = $('crosshair');
function updateIndicators() {
  const dist = fly.pos.distanceTo(camera.position);
  $('distVal').textContent = fly.alive ? `${dist.toFixed(1)} m` : 'splat!';
  const s = toScreen(fly.pos);
  crosshair.classList.toggle('lock', fly.alive && fly.aimed);
  if (fly.alive && s.on) {
    arrow.classList.add('hidden');
    const px = clamp(Math.atan(0.25 / dist) / (camera.fov * DEG / 2) * innerHeight, 30, 220);
    bracket.classList.remove('hidden'); bracket.classList.toggle('lock', fly.aimed);
    bracket.style.width = bracket.style.height = px + 'px';
    bracket.style.left = s.x + 'px'; bracket.style.top = s.y + 'px';
  } else {
    bracket.classList.add('hidden');
    if (!fly.alive) { arrow.classList.add('hidden'); return; }
    invQ.copy(camera.quaternion).invert();
    const c = tmpV.copy(fly.pos).sub(camera.position).applyQuaternion(invQ);
    let x = c.x, y = c.y; if (Math.hypot(x, y) < 1e-3) { x = 0; y = -1; }
    const cx = innerWidth / 2, cy = innerHeight / 2, m = 46;
    const k = Math.min((cx - m) / Math.max(Math.abs(x), 1e-6), (cy - m - 30) / Math.max(Math.abs(y), 1e-6));
    const px = cx + x * k, py = cy - y * k, ang = Math.atan2(-y, x);
    arrow.classList.remove('hidden');
    arrow.style.transform = `translate(${px}px,${py}px)`;
    tri.style.transform = `rotate(${ang}rad)`;
    arrowDist.style.left = (-Math.cos(ang) * 46) + 'px'; arrowDist.style.top = (-Math.sin(ang) * 40) + 'px';
    arrowDist.textContent = `${dist.toFixed(1)} m`;
  }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  updateCameraOrientation();
  if (state === 'playing') {
    elapsed += dt; timeLeft = Math.max(0, ROUND - elapsed);
    const sec = Math.ceil(timeLeft);
    if (sec <= 5 && sec !== lastTick && sec > 0) { lastTick = sec; sfx.tick(); }
    updateHud();
    if (triggerHeld && WEAPONS[weaponId].auto) tryFire();
    if (timeLeft <= 0) endRound();
  }
  updateFly(dt, t); updateDarts(dt); updateBuzz(); updateIndicators();

  // view model: bob, recoil, flash
  recoil = Math.max(0, recoil - dt * 6); flashT -= dt;
  const base = vmRoot.userData.base;
  if (base) {
    vmRoot.position.set(base.x + Math.sin(t * 1.6) * 0.003, base.y + Math.sin(t * 3.2) * 0.003, base.z + recoil * 0.05);
    vmRoot.rotation.x = 0.04 + recoil * 0.25;
  }
  const m = WEAPONS[weaponId].model; m.userData.flash.visible = flashT > 0;
  if (flashT > 0) m.userData.flash.material.rotation = Math.random() * 6;

  renderer.clear();
  renderer.render(scene, camera);
  if (!scoped) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
onResize();
camFwd.set(0, 0, -1);
frame();
// small hook for automated testing / debugging in the console
window.flyHunt = { fly, camera, get state() { return state; }, get score() { return score; }, fireNow: () => { lastShot = 0; tryFire(); } };
