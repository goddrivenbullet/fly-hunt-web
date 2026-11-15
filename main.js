// Fly Hunt — browser pseudo-AR (3DOF) demo for Househeat: detailed toy-blaster viewmodel, ADS, and WebRTC multiplayer
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Net as PeerNet, LocalNet, makeCode, cleanCode } from './net.js';
const Net = new URLSearchParams(location.search).get('net') === 'local' ? LocalNet : PeerNet;

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const DEG = Math.PI / 180, R90 = Math.PI / 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (x) => x * x * (3 - 2 * x);
const moveTo = (v, t, s) => (v < t ? Math.min(t, v + s) : Math.max(t, v - s));
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const ROUND = 60;
const HIT_R = 0.2;           // generous hit radius around the fly (m)
const AV_R = 0.38;           // hit radius around a duel avatar (m)
const CAM_FOV_LONG = 69;     // iPhone main (1x) camera FOV across the long side (deg)
const WHITE = new THREE.Color(1, 1, 1);

// ---------------- renderer / scenes ----------------
const canvas = $('gl');
const video = $('cam');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.03, 120);
const hemi = new THREE.HemisphereLight(0xffffff, 0x556070, 2.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 5, 3); scene.add(sun);
const flashLight = new THREE.PointLight(0xffc06a, 0, 14, 2); scene.add(flashLight);

const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
const vmHemi = new THREE.HemisphereLight(0xffffff, 0x6a6a99, 1.6); vmScene.add(vmHemi);
const vmKey = new THREE.DirectionalLight(0xffffff, 1.8); vmKey.position.set(-1, 2.2, 1.2); vmScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0xbfe3ff, 0.8); vmRim.position.set(1.5, 0.6, -2); vmScene.add(vmRim);
const vmFlash = new THREE.PointLight(0xffb74d, 0, 1.5, 2); vmScene.add(vmFlash);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex; vmScene.environment = envTex;

let baseFov = 62, zoom = 1, camOn = false;

// ---------------- lighting matched to the camera feed ----------------
const feedCv = document.createElement('canvas'); feedCv.width = feedCv.height = 8;
const feedCtx = feedCv.getContext('2d', { willReadFrequently: true });
const lightT = { sky: new THREE.Color(0xfff2e0), ground: new THREE.Color(0xb8a890), lum: 0.62 };
const lightC = { sky: lightT.sky.clone(), ground: lightT.ground.clone(), lum: 0.62 };
function sampleFeed() {
  if (!camOn || video.readyState < 2) return;
  try {
    feedCtx.drawImage(video, 0, 0, 8, 8); const d = feedCtx.getImageData(0, 0, 8, 8).data;
    const acc = (r0, r1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = r0; y < r1; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return [r / n / 255, g / n / 255, b / n / 255]; };
    const top = acc(0, 4), bot = acc(4, 8);
    const lum = 0.2126 * (top[0] + bot[0]) / 2 + 0.7152 * (top[1] + bot[1]) / 2 + 0.0722 * (top[2] + bot[2]) / 2;
    const norm = (c) => { const m = Math.max(c[0], c[1], c[2], 0.05); return new THREE.Color().setRGB(c[0] / m, c[1] / m, c[2] / m, THREE.SRGBColorSpace).lerp(WHITE, 0.45); };
    lightT.sky.copy(norm(top)); lightT.ground.copy(norm(bot)).multiplyScalar(0.75); lightT.lum = clamp(lum * 1.15, 0.08, 1);
  } catch (e) {}
}
function applyLights(dt) {
  const k = 1 - Math.exp(-3 * dt);
  lightC.sky.lerp(lightT.sky, k); lightC.ground.lerp(lightT.ground, k); lightC.lum += (lightT.lum - lightC.lum) * k;
  const L = lightC.lum;
  hemi.color.copy(lightC.sky); hemi.groundColor.copy(lightC.ground); hemi.intensity = 0.5 + 2.0 * L;
  sun.intensity = 0.4 + 1.6 * L;
  vmHemi.color.copy(lightC.sky); vmHemi.groundColor.copy(lightC.ground); vmHemi.intensity = 0.4 + 1.7 * L;
  vmKey.color.copy(lightC.sky); vmKey.intensity = 0.5 + 2.0 * L; vmRim.intensity = 0.3 + 0.9 * L;
  scene.environmentIntensity = vmScene.environmentIntensity = 0.25 + 0.85 * L;
}

// ---------------- virtual room (no-camera fallback) ----------------
const room = buildRoom(); scene.add(room);
function buildRoom() {
  const g = new THREE.Group();
  const W = 14, H = 3.2, D = 14, floorY = -1.5;
  const wm = (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.BackSide });
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [wm(0xd8cdb8), wm(0xcfc2aa), wm(0xf4f1ea), wm(0x8a6a4a), wm(0xdcd2be), wm(0xc6b9a0)]);
  box.position.y = floorY + H / 2; g.add(box);
  const grid = new THREE.GridHelper(W, 14, 0x6b4f35, 0x775a3e); grid.position.y = floorY + 0.005; g.add(grid);
  const furn = (w, h, d, c, x, z, y0 = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.set(x, floorY + y0 + h / 2, z); g.add(m); return m; };
  furn(3.2, 0.45, 1.1, 0x3d5a80, 0, -6.3); furn(3.2, 0.6, 0.3, 0x34507a, 0, -6.7, 0.45);
  furn(0.3, 0.3, 1.1, 0x34507a, -1.6, -6.3, 0.45); furn(0.3, 0.3, 1.1, 0x34507a, 1.6, -6.3, 0.45);
  furn(1.3, 0.05, 0.8, 0x8d6e63, 3, -2, 0.72); furn(0.08, 0.72, 0.08, 0x6d4c41, 2.45, -2.3); furn(0.08, 0.72, 0.08, 0x6d4c41, 3.55, -1.7);
  furn(2, 2, 0.45, 0x5d4037, -6.75, 1.5);
  for (let i = 0; i < 4; i++) furn(1.9, 0.04, 0.4, 0x4e342e, -6.75, 1.5, 0.45 + i * 0.45);
  furn(0.45, 0.5, 0.45, 0xb0643c, 5.5, 5.5);
  const plant = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshLambertMaterial({ color: 0x2e7d32 })); plant.position.set(5.5, floorY + 1.0, 5.5); g.add(plant);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), new THREE.MeshBasicMaterial({ color: 0xaedcff })); win.position.set(6.98, 0.3, -1); win.rotation.y = -Math.PI / 2; g.add(win);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x111418 })); tv.position.set(0, 0.2, 6.98); tv.rotation.y = Math.PI; g.add(tv);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshLambertMaterial({ color: 0xc0392b })); rug.rotation.x = -Math.PI / 2; rug.position.y = floorY + 0.01; g.add(rug);
  return g;
}

// ---------------- seeded RNG (shared fly in Fly Race) ----------------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let frand = Math.random;
const frr = (a, b) => a + frand() * (b - a);

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
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(legGeo, legM); l.position.set(0.04 * s, -0.05, 0.035 - i * 0.035); l.rotation.z = s * 0.7; l.rotation.x = (i - 1) * 0.45; g.add(l); }
  const shape = new THREE.Shape(); shape.absellipse(0.08, 0, 0.085, 0.032, 0, Math.PI * 2, false, 0);
  const wingGeo = new THREE.ShapeGeometry(shape, 20); wingGeo.rotateX(-Math.PI / 2);
  const wings = [];
  for (const s of [-1, 1]) { const pivot = new THREE.Group(); pivot.position.set(0.02 * s, 0.04, 0.0); const w = new THREE.Mesh(wingGeo, wingM); w.scale.x = s; w.rotation.y = 0.4 * s; pivot.add(w); g.add(pivot); wings.push({ pivot, s }); }
  g.userData.wings = wings;
  return g;
}
const fly = {
  obj: buildFly(), pos: new V3(0, 0, -4), vel: new V3(), target: new V3(0, 0, -4), jitter: new V3(), heading: new V3(0, 0, -1),
  alive: true, deadT: 0, aimT: 0, react: 0.5, escapeT: 0, hoverT: 0, retargetT: 0, jitterT: 0, cruise: 1.6, aimed: false, speed: 0, flap: 0, n: 0,
  net: { p: new V3(0, 0, -4), v: new V3(), at: 0 },
};
scene.add(fly.obj);

function randomPoint(around) {
  for (let i = 0; i < 12; i++) {
    const r = frr(3, 6), az = frr(0, Math.PI * 2), y = frr(-1.0, 1.2);
    const h = Math.sqrt(Math.max(r * r - y * y, 4));
    const p = new V3(Math.cos(az) * h, y, Math.sin(az) * h);
    if (!around || p.distanceTo(around) < 5) return p;
  }
  return new V3(frr(-4, 4), frr(-1, 1.2), frr(-4, 4)).setLength(4);
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
  if (inFront) { const fwd = new V3(0, 0, -1).applyQuaternion(qBase); fwd.y = clamp(fwd.y, -0.2, 0.25); f.pos.copy(fwd.normalize().multiplyScalar(4)); }
  else f.pos.copy(randomPoint());
  clampBounds(f.pos);
  f.vel.set(0, 0, 0); f.target.copy(randomPoint(f.pos)); f.alive = true; f.deadT = 0; f.aimT = 0; f.escapeT = 0; f.n++;
  f.react = frr(0.35, 0.75); f.cruise = frr(1.2, 2.0) * (1 + 0.5 * clamp(elapsedFrac(), 0, 1));
  f.obj.visible = gameMode() !== 'duel'; f.obj.rotation.set(0, 0, 0); f.obj.scale.setScalar(1);
  if (mp.on && mp.host) sendFly(true);
}
function escapeFly(to) {
  const f = fly, view = to.clone().normalize();
  const side = new V3().crossVectors(view, new V3(0, 1, 0)).normalize().multiplyScalar(frand() < 0.5 ? -1 : 1);
  const d = side.addScaledVector(view, frr(0.2, 0.7)).add(new V3(0, frr(-0.4, 0.6), 0)).normalize();
  f.target.copy(f.pos).addScaledVector(d, frr(2.5, 4)); clampBounds(f.target);
  f.escapeT = frr(0.45, 0.7); f.aimT = 0; f.react = frr(0.35, 0.75); f.hoverT = 0;
  if (state === 'playing') { stats.dodges++; const s = toScreen(f.pos); if (s.on) popup('dodged!', s.x, s.y - 30, 'small'); }
}
function flyDeadStep(dt) {
  const f = fly;
  f.deadT += dt; f.vel.y -= 9.8 * dt; f.pos.addScaledVector(f.vel, dt);
  f.obj.position.copy(f.pos); f.obj.rotation.x += dt * 14; f.obj.rotation.z += dt * 9;
  f.obj.scale.setScalar(Math.max(0.01, 1 - f.deadT * 0.8));
  if (f.deadT > 0.7) f.obj.visible = false;
}
function flapWings(dt) { fly.flap += dt * 60; for (const w of fly.obj.userData.wings) w.pivot.rotation.z = w.s * Math.sin(fly.flap * 2.6) * 0.9; }

const tmpV = new V3(), tmpV2 = new V3(), desired = new V3(), camFwd = new V3(0, 0, -1);
// authoritative fly simulation (solo, or host in Fly Race)
function updateFly(dt, t) {
  const f = fly;
  if (!f.alive) { flyDeadStep(dt); if (f.deadT > 1.1) respawnFly(false); return; }
  // aim check: me, plus every remote player's aim in Fly Race
  let aimed = false; const to = tmpV.copy(f.pos).sub(camera.position); const dist = to.length();
  const lockA = Math.atan(0.45 / dist);
  f.aimed = camFwd.angleTo(to) < lockA; aimed = f.aimed;
  if (mp.on) for (const p of mp.players.values()) if (p.id !== mp.myId && p.connected && p.fwd && p.fwd.angleTo(to) < lockA) aimed = true;
  if (aimed && state === 'playing') f.aimT += dt; else f.aimT = Math.max(0, f.aimT - dt * 0.5);
  if (f.escapeT <= 0 && f.aimT > f.react) escapeFly(to);

  f.escapeT -= dt; f.hoverT -= dt; f.retargetT -= dt; f.jitterT -= dt;
  const escaping = f.escapeT > 0;
  if (!escaping && (f.retargetT <= 0 || f.pos.distanceTo(f.target) < 0.5)) { if (frand() < 0.3) f.hoverT = frr(0.4, 1.4); f.target.copy(randomPoint(f.pos)); f.retargetT = frr(1.5, 4); }
  if (f.jitterT <= 0) { f.jitter.set(frr(-1, 1), frr(-0.6, 0.6), frr(-1, 1)).multiplyScalar(escaping ? 0.5 : 1.8); f.jitterT = frr(0.08, 0.3); }
  const speed = escaping ? 7.5 : (f.hoverT > 0 ? 0.3 : f.cruise);
  desired.copy(f.target).sub(f.pos); if (desired.lengthSq() > 1e-4) desired.normalize();
  desired.multiplyScalar(speed).add(f.jitter);
  f.vel.lerp(desired, 1 - Math.exp(-(escaping ? 10 : 3.2) * dt));
  f.pos.addScaledVector(f.vel, dt); clampBounds(f.pos);
  orientFly(dt, t);
}
function orientFly(dt, t) {
  const f = fly; f.speed = f.vel.length();
  f.heading.lerp(f.vel, 1 - Math.exp(-8 * dt));
  f.obj.position.copy(f.pos); f.obj.position.y += Math.sin(t * 9) * 0.015;
  if (f.heading.lengthSq() > 1e-4) f.obj.lookAt(tmpV2.copy(f.obj.position).add(f.heading));
  flapWings(dt);
}
// client-side replica of the host's fly (Fly Race)
function updateFlyReplica(dt, t) {
  const f = fly;
  if (!f.alive) { flyDeadStep(dt); return; }
  const age = clamp(hostNow() - f.net.at, 0, 0.25);
  tmpV.copy(f.net.p).addScaledVector(f.net.v, age);
  f.pos.lerp(tmpV, 1 - Math.exp(-14 * dt)); f.vel.copy(f.net.v);
  const to = tmpV2.copy(f.pos).sub(camera.position); f.aimed = camFwd.angleTo(to) < Math.atan(0.45 / to.length());
  orientFly(dt, t);
}

// ---------------- toy blasters: detailed viewmodels ----------------
const RB = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
const cylZ = (rRear, rFront, len, seg = 24) => { const g = new THREE.CylinderGeometry(rRear, rFront, len, seg); g.rotateX(R90); return g; };
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
const matCache = new Map();
const cached = (k, make) => { if (!matCache.has(k)) matCache.set(k, make()); return matCache.get(k); };
const plastic = (color, extra = {}) => cached('p' + color + JSON.stringify(extra), () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22, ...extra }));
const rubber = (color) => cached('r' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 }));
const glowMat = (color) => cached('g' + color, () => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
const M = {
  tip: plastic(0xff5a00, { emissive: 0xff3d00, emissiveIntensity: 0.35 }),
  dark: rubber(0x23262d), grip: rubber(0x2c2f38), glove: rubber(0x34373f), sleeve: rubber(0x2f4f6f), knuckle: plastic(0xff7a00),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x0a2a55, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.5, iridescence: 0.6 }),
};
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; }
function canvasTex(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const flashTex = canvasTex(128, (x) => {
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,230,80,.95)'); g.addColorStop(1, 'rgba(255,120,0,0)');
  x.fillStyle = g; x.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 26 : 62; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } x.fill();
});
const dotTex = canvasTex(64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,60,60,1)'); g.addColorStop(0.45, 'rgba(255,0,0,.35)'); g.addColorStop(1, 'rgba(255,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
const glintTex = canvasTex(64, (x) => { x.translate(32, 32); const g = x.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(200,230,255,.7)'); g.addColorStop(1, 'rgba(150,200,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 32, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(-32, -1.5, 64, 3); x.fillRect(-1.5, -32, 3, 64); });
const addSprite = (parent, tex, color, size, x, y, z, additive = true) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false })); s.position.set(x, y, z); s.scale.setScalar(size); parent.add(s); return s; };

function rail(parent, len, y, z, w = 0.022) {
  add(parent, RB(w, 0.006, len, 0.0015), M.dark, 0, y + 0.003, z);
  const n = Math.floor(len / 0.011);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(w + 0.003, 0.004, 0.0045), M.dark, n);
  const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { o.position.set(0, y + 0.008, z - len / 2 + 0.0055 + i * 0.011); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); }
  parent.add(inst); return y + 0.010;
}
function triggerGroup(parent, z, y, mat) {
  add(parent, new THREE.TorusGeometry(0.017, 0.0035, 8, 20, Math.PI), mat, 0, y, z, 0, R90, Math.PI);
  add(parent, RB(0.004, 0.016, 0.006, 0.0015), M.tip, 0, y - 0.004, z - 0.002, 0.25);
}
function holoSight(parent, z, y0, color) {
  const hood = plastic(color), winW = 0.03, winH = 0.03, wy = y0 + 0.012 + winH / 2;
  add(parent, RB(0.032, 0.011, 0.054, 0.003), M.dark, 0, y0 + 0.0055, z);
  add(parent, RB(0.006, winH + 0.01, 0.036, 0.002), hood, -(winW / 2 + 0.003), wy, z);
  add(parent, RB(0.006, winH + 0.01, 0.036, 0.002), hood, winW / 2 + 0.003, wy, z);
  add(parent, RB(winW + 0.018, 0.007, 0.04, 0.003), hood, 0, wy + winH / 2 + 0.004, z);
  add(parent, RB(0.01, 0.006, 0.012, 0.002), M.tip, winW / 2 + 0.007, y0 + 0.012, z + 0.012);
  add(parent, new THREE.PlaneGeometry(winW, winH), new THREE.MeshPhysicalMaterial({ color: 0x9fffe8, transparent: true, opacity: 0.07, roughness: 0.02, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }), 0, wy, z - 0.012);
  const dot = addSprite(parent, dotTex, 0xff3030, 0.0075, 0, wy, z - 0.0125); dot.material.depthTest = false; dot.renderOrder = 10; dot.material.opacity = 0;
  return { sightY: wy, rearZ: z + 0.02, dot };
}
function scopeTube(parent, y, z) {
  const g = new THREE.Group(); g.position.set(0, y, z); parent.add(g);
  const body = plastic(0x263238, { roughness: 0.45, clearcoat: 0.4 }), acc = plastic(0x00bcd4);
  add(g, cylZ(0.016, 0.016, 0.17, 28), body);
  add(g, cylZ(0.016, 0.027, 0.05, 28), body, 0, 0, -0.11);
  add(g, cylZ(0.022, 0.016, 0.045, 28), body, 0, 0, 0.105);
  add(g, cylZ(0.023, 0.023, 0.012, 28), acc, 0, 0, 0.128);
  add(g, cylZ(0.028, 0.028, 0.01, 28), acc, 0, 0, -0.137);
  add(g, new THREE.CylinderGeometry(0.011, 0.011, 0.02, 20), acc, 0, 0.024, 0);
  add(g, new THREE.CylinderGeometry(0.011, 0.011, 0.02, 20), acc, 0.024, 0, 0, 0, 0, R90);
  for (const zz of [-0.05, 0.05]) { add(g, RB(0.012, 0.03, 0.014, 0.003), M.dark, 0, -0.024, zz); add(g, new THREE.TorusGeometry(0.0175, 0.0035, 8, 24), M.dark, 0, 0, zz); }
  add(g, new THREE.CircleGeometry(0.0245, 32), M.lens, 0, 0, -0.1425, 0, Math.PI, 0);
  add(g, new THREE.CircleGeometry(0.0195, 32), M.lens, 0, 0, 0.1345);
  const glint = addSprite(g, glintTex, 0xffffff, 0.022, 0.006, 0.006, 0.137);
  return { sightY: y, rearZ: z + 0.1345, glint };
}
function hands(b, gripPos, gripRot, support) {
  const h = new THREE.Group(); h.position.copy(gripPos); h.rotation.x = gripRot; b.add(h);
  add(h, RB(0.048, 0.072, 0.032, 0.012), M.glove, 0.007, -0.004, 0.03);
  for (let i = 0; i < 3; i++) add(h, capsule(0.0095, 0.03), M.glove, 0.003, -0.008 - i * 0.021, -0.029, 0, 0, R90);
  add(h, RB(0.014, 0.05, 0.004, 0.002), M.knuckle, 0.024, -0.004, 0.047);
  add(h, capsule(0.0085, 0.032), M.glove, -0.024, 0.03, -0.004, R90 - 0.15, 0, 0);
  add(h, capsule(0.0078, 0.03), M.glove, 0.021, 0.046, -0.024, R90, 0, 0);
  add(h, new THREE.CylinderGeometry(0.026, 0.03, 0.07, 16), M.glove, 0.006, -0.05, 0.05, -0.55);
  add(h, new THREE.CylinderGeometry(0.033, 0.04, 0.32, 16), M.sleeve, 0.012, -0.14, 0.17, -0.9);
  if (!support) return;
  const s = new THREE.Group(); s.position.copy(support.pos); (support.parent || b).add(s);
  if (support.type === 'cup') {
    s.rotation.x = gripRot;
    add(s, RB(0.022, 0.07, 0.05, 0.01), M.glove, -0.03, -0.01, 0.005);
    for (let i = 0; i < 3; i++) add(s, capsule(0.009, 0.026), M.glove, -0.005, -0.012 - i * 0.02, -0.044, 0, 0, R90);
    add(s, new THREE.CylinderGeometry(0.033, 0.04, 0.32, 16), M.sleeve, -0.07, -0.15, 0.12, -0.9, 0, 0.5);
  } else {
    add(s, RB(0.05, 0.022, 0.075, 0.01), M.glove, 0, -0.03, 0);
    for (let i = 0; i < 3; i++) add(s, capsule(0.0088, 0.022), M.glove, -0.031, -0.012, -0.024 + i * 0.022, 0, 0, 0.2);
    add(s, capsule(0.0085, 0.03), M.glove, 0.03, -0.012, 0.0, R90, 0, 0);
    add(s, new THREE.CylinderGeometry(0.033, 0.04, 0.34, 16), M.sleeve, -0.07, -0.16, 0.13, -0.85, 0, 0.55);
  }
}
function finishBlaster(o, kind) {
  o.flash = addSprite(o.g, flashTex, 0xffffff, kind === 'shotgun' ? 0.16 : 0.1, o.muzzle.x, o.muzzle.y, o.muzzle.z - 0.03); o.flash.visible = false;
  o.magHome = o.mag.position.clone();
  o.g.visible = false; vmRoot.add(o.g);
  return o;
}
function buildZapper() {
  const g = new THREE.Group(), body = plastic(0x29b6f6), frame = plastic(0x7c4dff), acc = plastic(0xffd600);
  const slide = new THREE.Group(); g.add(slide);
  add(slide, RB(0.042, 0.036, 0.19, 0.006), body, 0, 0.022, 0);
  for (let i = 0; i < 5; i++) add(slide, RB(0.0436, 0.022, 0.0035, 0.001), M.dark, 0, 0.022, 0.058 + i * 0.008);
  add(slide, RB(0.004, 0.012, 0.035, 0.0015), M.dark, 0.0205, 0.027, -0.005);
  add(slide, RB(0.03, 0.006, 0.014, 0.0015), M.dark, 0, 0.0425, 0.085);
  add(slide, RB(0.009, 0.012, 0.01, 0.0015), M.dark, -0.0085, 0.051, 0.085);
  add(slide, RB(0.009, 0.012, 0.01, 0.0015), M.dark, 0.0085, 0.051, 0.085);
  for (const s of [-1, 1]) add(slide, new THREE.SphereGeometry(0.0016, 8, 6), glowMat(0xffffff), 0.0085 * s, 0.053, 0.0902);
  add(slide, RB(0.0045, 0.012, 0.008, 0.001), M.dark, 0, 0.046, -0.088);
  add(slide, new THREE.SphereGeometry(0.0021, 8, 6), glowMat(0x76ff03), 0, 0.0505, -0.0835);
  add(g, RB(0.04, 0.03, 0.165, 0.006), frame, 0, -0.009, 0.012);
  add(g, RB(0.026, 0.008, 0.06, 0.002), M.dark, 0, -0.027, -0.045);
  for (let i = 0; i < 4; i++) add(g, RB(0.029, 0.004, 0.005, 0.001), M.dark, 0, -0.031, -0.068 + i * 0.014);
  add(g, cylZ(0.011, 0.011, 0.03), acc, 0, 0.018, -0.105);
  add(g, cylZ(0.0145, 0.0145, 0.02), M.tip, 0, 0.018, -0.128);
  triggerGroup(g, 0.012, -0.024, frame);
  const gripPos = new V3(0, -0.072, 0.065), gripRot = -0.26;
  add(g, RB(0.036, 0.1, 0.048, 0.01), M.grip, gripPos.x, gripPos.y, gripPos.z, gripRot);
  add(g, RB(0.039, 0.068, 0.03, 0.006), frame, gripPos.x, gripPos.y + 0.004, gripPos.z + 0.002, gripRot);
  const mag = new THREE.Group(); mag.position.copy(gripPos); mag.rotation.x = gripRot; g.add(mag);
  add(mag, RB(0.028, 0.09, 0.036, 0.004), acc, 0, -0.012, 0);
  add(mag, RB(0.04, 0.012, 0.052, 0.003), M.tip, 0, -0.056, 0.002);
  hands(g, gripPos, gripRot, { type: 'cup', pos: gripPos.clone() });
  return finishBlaster({ g, muzzle: new V3(0, 0.018, -0.14), eject: new V3(0.024, 0.03, -0.005), sightY: 0.051, rearZ: 0.09, eye: 0.27,
    mag, magDir: new V3(0, -Math.cos(gripRot), -Math.sin(gripRot)), action: slide, actionType: 'slide', travel: 0.022 }, 'pistol');
}
function buildBuzzer() {
  const g = new THREE.Group(), body = plastic(0x66bb6a), acc = plastic(0xffd600), cy = plastic(0x00e5ff);
  add(g, RB(0.056, 0.06, 0.25, 0.008), body, 0, 0, 0);
  add(g, RB(0.058, 0.02, 0.12, 0.005), cy, 0, -0.022, -0.06);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) add(g, RB(0.003, 0.014, 0.008, 0.001), M.dark, 0.0285 * s, 0.006, -0.085 + i * 0.016);
  const top = rail(g, 0.2, 0.03, 0.0);
  const holo = holoSight(g, 0.035, top, 0xff6d00);
  add(g, cylZ(0.02, 0.02, 0.09, 24), M.dark, 0, 0.005, -0.17);
  for (let i = 0; i < 3; i++) add(g, new THREE.TorusGeometry(0.02, 0.0028, 8, 24), acc, 0, 0.005, -0.14 - i * 0.025);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; add(g, cylZ(0.006, 0.006, 0.03, 10), cy, Math.cos(a) * 0.009, 0.005 + Math.sin(a) * 0.009, -0.225); }
  add(g, cylZ(0.024, 0.024, 0.016, 24), M.tip, 0, 0.005, -0.235);
  const bolt = new THREE.Group(); g.add(bolt);
  add(bolt, RB(0.012, 0.01, 0.03, 0.003), acc, 0.033, 0.015, -0.02);
  add(bolt, new THREE.SphereGeometry(0.007, 12, 8), M.tip, 0.042, 0.015, -0.03);
  const mag = new THREE.Group(); mag.position.set(0, -0.05, -0.035); g.add(mag);
  add(mag, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 32), acc, 0, -0.025, 0, 0, 0, R90);
  add(mag, new THREE.CylinderGeometry(0.03, 0.03, 0.054, 24), M.tip, 0, -0.025, 0, 0, 0, R90);
  add(mag, RB(0.026, 0.03, 0.03, 0.004), M.dark, 0, 0.01, 0);
  const gripPos = new V3(0, -0.072, 0.075), gripRot = -0.22;
  add(g, RB(0.034, 0.09, 0.044, 0.01), M.grip, gripPos.x, gripPos.y, gripPos.z, gripRot);
  triggerGroup(g, 0.03, -0.03, body);
  const fg = new V3(0, -0.06, -0.13);
  add(g, RB(0.026, 0.065, 0.03, 0.01), M.grip, fg.x, fg.y, fg.z);
  const stock = new THREE.Group(); g.add(stock);
  add(stock, RB(0.012, 0.012, 0.07, 0.004), M.dark, 0, 0.012, 0.155);
  add(stock, RB(0.012, 0.012, 0.07, 0.004), M.dark, 0, -0.024, 0.155);
  add(stock, RB(0.03, 0.07, 0.02, 0.006), cy, 0, -0.008, 0.195);
  hands(g, gripPos, gripRot, { type: 'under', pos: new V3(fg.x, fg.y - 0.0, fg.z) });
  return finishBlaster({ g, muzzle: new V3(0, 0.005, -0.245), eject: new V3(0.03, 0.02, 0.01), sightY: holo.sightY, rearZ: holo.rearZ, eye: 0.25,
    dot: holo.dot, stock, mag, magDir: new V3(0, -1, 0), action: bolt, actionType: 'bolt', travel: 0.02 }, 'rapid');
}
function buildSplatter() {
  const g = new THREE.Group(), body = plastic(0xff4081), acc = plastic(0xffd600), cy = plastic(0x00e5ff);
  add(g, RB(0.066, 0.066, 0.22, 0.01), body, 0, 0, 0.02);
  add(g, cylZ(0.022, 0.022, 0.2, 24), acc, 0, 0.012, -0.17);
  add(g, cylZ(0.024, 0.038, 0.04, 24), M.tip, 0, 0.012, -0.29);
  add(g, cylZ(0.014, 0.014, 0.17, 16), M.dark, 0, -0.02, -0.15);
  const pump = new THREE.Group(); g.add(pump);
  add(pump, RB(0.054, 0.042, 0.11, 0.012), cy, 0, -0.022, -0.17);
  for (let i = 0; i < 5; i++) add(pump, RB(0.056, 0.035, 0.004, 0.001), M.dark, 0, -0.022, -0.21 + i * 0.02);
  const top = rail(g, 0.12, 0.033, 0.02);
  const holo = holoSight(g, 0.045, top, 0x7c4dff);
  for (let i = 0; i < 4; i++) { add(g, cylZ(0.008, 0.008, 0.036, 12), plastic(0xff1744), -0.036, 0.012 - i * 0.0165, 0.03); add(g, cylZ(0.0085, 0.0085, 0.008, 12), acc, -0.036, 0.012 - i * 0.0165, 0.051); }
  const mag = new THREE.Group(); mag.position.set(0, -0.05, 0.0); g.add(mag);
  add(mag, RB(0.05, 0.03, 0.07, 0.006), M.tip, 0, 0, 0);
  for (let i = -1; i <= 1; i++) add(mag, cylZ(0.0075, 0.0075, 0.072, 12), acc, i * 0.016, -0.012, 0);
  const gripPos = new V3(0, -0.08, 0.1), gripRot = -0.3;
  add(g, RB(0.036, 0.09, 0.046, 0.01), M.grip, gripPos.x, gripPos.y, gripPos.z, gripRot);
  triggerGroup(g, 0.06, -0.038, body);
  const stock = new THREE.Group(); g.add(stock);
  add(stock, RB(0.05, 0.07, 0.13, 0.012), body, 0, -0.02, 0.19);
  add(stock, RB(0.054, 0.076, 0.016, 0.006), M.dark, 0, -0.02, 0.258);
  hands(g, gripPos, gripRot, { type: 'under', pos: new V3(0, -0.02, -0.17), parent: pump });
  return finishBlaster({ g, muzzle: new V3(0, 0.012, -0.31), eject: new V3(0.035, 0.012, 0.0), sightY: holo.sightY, rearZ: holo.rearZ, eye: 0.26,
    dot: holo.dot, stock, mag, magDir: new V3(0, -1, 0), action: pump, actionType: 'pump', travel: 0.05 }, 'shotgun');
}
function buildLongShot() {
  const g = new THREE.Group(), body = plastic(0xab47bc), acc = plastic(0xffd600), cy = plastic(0x00bcd4);
  add(g, RB(0.048, 0.052, 0.26, 0.008), body, 0, 0, 0);
  add(g, RB(0.052, 0.03, 0.36, 0.008), plastic(0x7c4dff), 0, -0.03, -0.03);
  add(g, cylZ(0.011, 0.011, 0.36, 20), acc, 0, 0.008, -0.31);
  for (let i = 0; i < 3; i++) add(g, new THREE.TorusGeometry(0.0115, 0.002, 6, 18), M.dark, 0, 0.008, -0.2 - i * 0.07);
  add(g, RB(0.03, 0.022, 0.04, 0.004), M.dark, 0, 0.008, -0.5);
  add(g, cylZ(0.016, 0.016, 0.025, 20), M.tip, 0, 0.008, -0.53);
  const top = rail(g, 0.22, 0.026, 0.0);
  const sc = scopeTube(g, top + 0.034, 0.0);
  const bolt = new THREE.Group(); bolt.position.set(0.026, 0.01, 0.07); g.add(bolt);
  add(bolt, new THREE.CylinderGeometry(0.004, 0.004, 0.035, 10), M.dark, 0.017, 0, 0, 0, 0, R90);
  add(bolt, new THREE.SphereGeometry(0.009, 14, 10), M.tip, 0.036, 0, 0);
  const mag = new THREE.Group(); mag.position.set(0, -0.06, -0.02); g.add(mag);
  add(mag, RB(0.032, 0.05, 0.06, 0.005), acc, 0, 0, 0);
  add(mag, RB(0.036, 0.008, 0.066, 0.003), M.tip, 0, -0.027, 0);
  const gripPos = new V3(0, -0.075, 0.09), gripRot = -0.3;
  add(g, RB(0.034, 0.09, 0.044, 0.01), M.grip, gripPos.x, gripPos.y, gripPos.z, gripRot);
  triggerGroup(g, 0.05, -0.045, body);
  const stock = new THREE.Group(); g.add(stock);
  add(stock, RB(0.04, 0.075, 0.16, 0.012), body, 0, -0.025, 0.24);
  add(stock, RB(0.03, 0.02, 0.1, 0.006), cy, 0, 0.022, 0.22);
  add(stock, RB(0.044, 0.08, 0.016, 0.006), M.dark, 0, -0.025, 0.322);
  for (const s of [-1, 1]) add(g, cylZ(0.004, 0.004, 0.16, 8), M.dark, 0.012 * s, -0.05, -0.2);
  hands(g, gripPos, gripRot, { type: 'under', pos: new V3(0, -0.03, -0.13) });
  return finishBlaster({ g, muzzle: new V3(0, 0.008, -0.545), eject: new V3(0.03, 0.02, 0.06), sightY: sc.sightY, rearZ: sc.rearZ, eye: 0.085,
    glint: sc.glint, stock, mag, magDir: new V3(0, -1, 0), action: bolt, actionType: 'boltAction', travel: 0.045 }, 'sniper');
}

const WEAPONS = {
  pistol: { name: 'Zapper', build: buildZapper, mag: 12, cooldown: 0.2, pellets: 1, spread: 0.7, adsSpread: 0.2, auto: false, haptic: 12, adsZoom: 1.2, adsTime: 0.15, kick: [0.035, 0.16, 0.7], reloadTime: 1.1, dmg: 25 },
  rapid: { name: 'Buzzer', build: buildBuzzer, mag: 40, cooldown: 0.085, pellets: 1, spread: 2.2, adsSpread: 0.8, auto: true, haptic: 8, adsZoom: 1.35, adsTime: 0.2, kick: [0.014, 0.05, 0.28], reloadTime: 1.7, dmg: 9 },
  shotgun: { name: 'Splatter', build: buildSplatter, mag: 6, cooldown: 0.75, pellets: 9, spread: 6, adsSpread: 4.2, auto: false, haptic: 35, adsZoom: 1.3, adsTime: 0.22, kick: [0.07, 0.32, 1.8], reloadTime: 1.6, dmg: 11 },
  sniper: { name: 'Long Shot', build: buildLongShot, mag: 5, cooldown: 1.0, pellets: 1, spread: 3.5, adsSpread: 0.03, auto: false, haptic: 30, adsZoom: 1.25, adsTime: 0.28, kick: [0.08, 0.38, 2.2], reloadTime: 1.9, dmg: 70, scope: true },
};
for (const k in WEAPONS) { const w = WEAPONS[k]; w.id = k; w.ammo = w.mag; w.model = w.build(); }
let weaponId = 'pistol';

// ---------------- viewmodel feel: ADS, sway, breathing, bob, recoil, actions, reload ----------------
const vm = { ads: 0, adsWant: false, recoil: 0, recoilYaw: 0, punchP: 0, punchY: 0, lagX: 0, lagY: 0, bobPhase: 0, walk: 0, walkT: 0,
  raise: 1, reload: null, act: null, holdT: 0, gaspT: 0, breathCD: 0, flashT: 0 };
let scopeZoom = 3, swayYaw = 0, swayPitch = 0, scopeVis = 0;
const hip = { pos: new V3(), s: 1 };
const vmPos = new V3(), adsPos = new V3();
function layoutViewmodel() {
  const a = innerWidth / innerHeight;
  vmCam.fov = a < 1 ? 64 : 50; vmCam.aspect = a; vmCam.updateProjectionMatrix();
  const z = -0.42, hh = -z * Math.tan(vmCam.fov / 2 * DEG), hw = hh * a;
  hip.s = a < 1 ? 0.7 : 0.9;
  hip.pos.set(hw * (a < 1 ? 0.46 : 0.5), -hh * (a < 1 ? 0.5 : 0.56), z);
}
function updateViewmodel(dt, t) {
  const w = WEAPONS[weaponId], m = w.model;
  const want = vm.adsWant && !vm.reload && vm.raise >= 1 && canFire(true) ? 1 : 0;
  vm.ads = moveTo(vm.ads, want, dt / w.adsTime);
  const e = ease(vm.ads);
  // breathing (sniper hold-breath)
  const wasHolding = vm.holdT > 0;
  vm.holdT = Math.max(0, vm.holdT - dt); vm.gaspT -= dt; vm.breathCD -= dt;
  if (wasHolding && vm.holdT === 0) { vm.gaspT = 1.2; vm.breathCD = 2.5; tone({ type: 'sine', f0: 300, f1: 180, dur: 0.25, vol: 0.05 }); }
  const breath = vm.holdT > 0 ? 0.1 : vm.gaspT > 0 ? 2.0 : 1;
  // walk energy (device motion)
  vm.walkT *= Math.exp(-2.5 * dt);
  vm.walk += (vm.walkT - vm.walk) * (1 - Math.exp(-4 * dt));
  if (vm.walk > 0.03) vm.bobPhase += dt * (7 + 3 * vm.walk);
  const bobA = vm.walk * (1 - 0.65 * e);
  // base pose: hip -> ADS (sight line on the view axis)
  const s = hip.s;
  adsPos.set(0, -s * m.sightY, -(m.eye + s * m.rearZ));
  vmPos.lerpVectors(hip.pos, adsPos, e);
  let rx = 0.03 * (1 - e), ry = 0.08 * (1 - e), rz = 0;
  // idle sway
  const sw = (1 - 0.85 * e) * breath;
  vmPos.x += Math.sin(t * 1.1) * 0.0032 * sw; vmPos.y += (Math.sin(t * 2.2) * 0.002 + Math.sin(t * 1.6) * 0.0018) * sw;
  rx += Math.sin(t * 1.6) * 0.006 * sw; ry += Math.sin(t * 1.1) * 0.008 * sw; rz += Math.sin(t * 0.9) * 0.005 * sw;
  // walk bob
  vmPos.x += Math.sin(vm.bobPhase) * 0.009 * bobA; vmPos.y -= Math.abs(Math.cos(vm.bobPhase)) * 0.011 * bobA; rz += Math.sin(vm.bobPhase) * 0.025 * bobA;
  // look lag
  vm.lagX *= Math.exp(-9 * dt); vm.lagY *= Math.exp(-9 * dt);
  const lg = 1 - 0.8 * e;
  vmPos.x += vm.lagX * lg; vmPos.y += vm.lagY * lg; ry += vm.lagX * 1.5 * lg; rx -= vm.lagY * 1.5 * lg;
  // recoil kick + recovery
  vm.recoil *= Math.exp(-13 * dt);
  const kr = vm.recoil * (1 - 0.45 * e);
  vmPos.z += kr * w.kick[0]; vmPos.y += kr * w.kick[0] * 0.25; rx += kr * w.kick[1]; ry += kr * vm.recoilYaw;
  // weapon raise after switching
  vm.raise = Math.min(1, vm.raise + dt / 0.28); const rr = 1 - ease(vm.raise); vmPos.y -= rr * 0.15; rx -= rr * 0.6;
  // reload animation: tilt, mag out, new mag in
  if (vm.reload) {
    const R = vm.reload; R.t += dt; const p = R.t / w.reloadTime, k = Math.sin(Math.PI * clamp(p, 0, 1));
    rz += k * 0.55; rx += k * 0.22; vmPos.y -= k * 0.025; vmPos.x -= k * 0.015;
    let d = 0; if (p >= 0.15 && p < 0.4) d = ease((p - 0.15) / 0.25) * 0.2; else if (p >= 0.4 && p < 0.55) d = 0.2; else if (p >= 0.55 && p < 0.8) d = (1 - ease((p - 0.55) / 0.25)) * 0.2;
    m.mag.position.copy(m.magHome).addScaledVector(m.magDir, d); m.mag.visible = !(p > 0.4 && p < 0.55);
    if (!R.out && p >= 0.15) { R.out = true; sfx.magOut(); }
    if (!R.in && p >= 0.8) { R.in = true; sfx.magIn(); haptic(10); }
    if (p >= 1) { w.ammo = w.mag; vm.reload = null; m.mag.position.copy(m.magHome); m.mag.visible = true; }
    updateAmmo();
  }
  vmRoot.position.copy(vmPos); vmRoot.rotation.set(rx, ry, rz); vmRoot.scale.setScalar(s);
  // slide / bolt / pump animation
  if (vm.act) {
    const A = vm.act; A.t += dt; const tt = A.t; let done = false;
    if (m.actionType === 'slide' || m.actionType === 'bolt') {
      const dur = m.actionType === 'slide' ? 0.1 : 0.07, p = tt / dur;
      m.action.position.z = p < 1 ? m.travel * (p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65) : 0; done = p >= 1;
    } else if (m.actionType === 'pump') {
      const p = (tt - 0.14) / 0.4;
      m.action.position.z = p > 0 && p < 1 ? Math.sin(Math.PI * p) * m.travel : 0;
      if (!A.ej && p > 0.45) { A.ej = true; ejectShell(); sfx.pump(); }
      done = p >= 1;
    } else {
      const p = (tt - 0.2) / 0.6, q = p * 4;
      if (p > 0 && p < 1) {
        m.action.rotation.x = 0; m.action.rotation.z = (q < 1 ? q : q < 3 ? 1 : 4 - q) * 1.1;
        m.action.position.z = 0.07 + (q < 1 ? 0 : q < 2 ? q - 1 : q < 3 ? 3 - q : 0) * m.travel;
        if (!A.ej && q >= 1.7) { A.ej = true; ejectShell(); }
        if (!A.snd && q >= 1) { A.snd = true; sfx.bolt(); }
      } else { m.action.rotation.z = 0; m.action.position.z = 0.07; }
      done = p >= 1;
    }
    if (done) vm.act = null;
  }
  if (m.stock) m.stock.visible = vm.ads < 0.55;
  if (m.dot) m.dot.material.opacity = clamp((vm.ads - 0.45) * 2.2, 0, 1);
  if (m.glint) m.glint.material.opacity = (0.35 + 0.35 * Math.sin(t * 3)) * (1 - e);
  // muzzle flash sprite + light
  vm.flashT -= dt;
  m.flash.visible = vm.flashT > 0;
  if (vm.flashT > 0) { m.flash.material.rotation = Math.random() * 6; m.flash.scale.setScalar((w.id === 'shotgun' ? 0.16 : 0.1) * rand(0.8, 1.2)); }
  const fk = Math.max(0, vm.flashT / 0.06);
  vmFlash.intensity = 0.35 * fk; if (fk > 0) vmFlash.position.copy(m.muzzle).applyMatrix4(m.g.matrixWorld);
  flashLight.intensity = 25 * fk; flashLight.position.copy(camera.position).addScaledVector(camFwd, 0.6);
  // aim sway applied to the real aim (camera) while aiming
  const aimA = e * (w.scope ? 0.32 : 0.07) * DEG * breath;
  swayYaw = aimA * (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 1.9)) + Math.sin(vm.bobPhase) * 0.15 * DEG * bobA;
  swayPitch = aimA * (0.8 * Math.sin(t * 1.27) + 0.6 * Math.sin(t * 1.6 + 1)) - Math.abs(Math.cos(vm.bobPhase)) * 0.12 * DEG * bobA;
  vm.punchP *= Math.exp(-9 * dt); vm.punchY *= Math.exp(-9 * dt);
  // zoom + scope overlay
  scopeVis = w.scope ? clamp((vm.ads - 0.72) / 0.22, 0, 1) : 0;
  let z = 1 + ((w.scope ? 1.25 : w.adsZoom) - 1) * e;
  if (scopeVis > 0) z = THREE.MathUtils.lerp(z, scopeZoom, ease(scopeVis));
  setZoomValue(z);
  const sc = $('scope'); sc.style.opacity = scopeVis.toFixed(3); sc.classList.toggle('vis', scopeVis > 0);
  if (scopeVis > 0) { $('scopeVigShift').style.transform = `translate(${(-vm.punchY / DEG * 6 + swayYaw / DEG * 30).toFixed(1)}px,${(vm.punchP / DEG * 10 - swayPitch / DEG * 30).toFixed(1)}px)`; }
  m.g.visible = scopeVis < 0.98;
  document.body.classList.toggle('ads', vm.ads > 0.15);
  $('adsBtn').classList.toggle('on', vm.adsWant);
  const showBreath = w.scope && vm.ads > 0.5;
  $('breathBtn').classList.toggle('hidden', !showBreath); $('zoomBtn').classList.toggle('hidden', !showBreath);
  if (showBreath) { const b = $('breathBtn'); b.classList.toggle('on', vm.holdT > 0); b.disabled = vm.breathCD > 0 && vm.holdT <= 0; b.textContent = vm.holdT > 0 ? `🫁 ${vm.holdT.toFixed(1)}s` : vm.breathCD > 0 ? '🫁 …' : '🫁 Hold'; }
}
function holdBreath() { if (vm.holdT > 0 || vm.breathCD > 0 || vm.ads < 0.5) return; vm.holdT = 3; tone({ type: 'sine', f0: 200, f1: 320, dur: 0.2, vol: 0.05 }); }
function setAds(on) { vm.adsWant = !!on; }
function startReload() {
  const w = WEAPONS[weaponId];
  if (vm.reload || w.ammo >= w.mag || state === 'over') return;
  vm.reload = { t: 0 }; vm.adsWant = false; triggerHeld = false; updateAmmo();
}
function updateAmmo() {
  const w = WEAPONS[weaponId], el = $('ammo');
  $('ammoNum').textContent = w.ammo;
  const rl = !!vm.reload;
  $('ammoBar').style.width = (rl ? clamp(vm.reload.t / w.reloadTime, 0, 1) * 100 : w.ammo / w.mag * 100) + '%';
  el.classList.toggle('reloading', rl); el.classList.toggle('low', !rl && w.ammo <= Math.ceil(w.mag * 0.25));
  $('ammoHint').textContent = rl ? 'RELOADING' : w.ammo === 0 ? 'TAP TO RELOAD' : 'RELOAD';
}

// ---------------- ejected foam-dart shells ----------------
const shells = [];
{
  const bodyG = cylZ(0.0062, 0.0062, 0.03, 10), capG = new THREE.SphereGeometry(0.0066, 10, 8);
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group(); add(g, bodyG, plastic(0x2979ff)); add(g, capG, M.tip, 0, 0, -0.016);
    g.visible = false; vmScene.add(g); shells.push({ g, v: new V3(), spin: new V3(), life: 0 });
  }
}
let shellIdx = 0;
function ejectShell() {
  const m = WEAPONS[weaponId].model; if (scopeVis > 0.9) return;
  const s = shells[shellIdx++ % shells.length];
  m.g.updateWorldMatrix(true, false);
  s.g.position.copy(m.eject).applyMatrix4(m.g.matrixWorld);
  s.v.set(rand(0.45, 0.8), rand(0.6, 1.0), rand(-0.05, 0.25)); s.spin.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
  s.life = 0.8; s.g.visible = true; s.g.scale.setScalar(vmRoot.scale.x);
}
function updateShells(dt) {
  for (const s of shells) { if (s.life <= 0) continue; s.life -= dt; s.v.y -= 3.5 * dt; s.g.position.addScaledVector(s.v, dt); s.g.rotation.x += s.spin.x * dt; s.g.rotation.y += s.spin.y * dt; s.g.rotation.z += s.spin.z * dt; if (s.life <= 0) s.g.visible = false; }
}

// ---------------- foam darts in the world (cosmetic; hits are hitscan) ----------------
const darts = [];
const dartGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8); dartGeo.rotateX(Math.PI / 2);
const tipGeo = new THREE.SphereGeometry(0.015, 8, 6);
const dartMat = new THREE.MeshBasicMaterial({ color: 0xff6d00 }), tipMat = new THREE.MeshBasicMaterial({ color: 0x2979ff });
function spawnDart(from, to, color) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(dartGeo, color ? new THREE.MeshBasicMaterial({ color }) : dartMat)); const tip = new THREE.Mesh(tipGeo, tipMat); tip.position.z = -0.045; g.add(tip);
  g.position.copy(from); g.lookAt(to); g.rotateY(Math.PI);
  const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
  scene.add(g); darts.push({ g, dir, life: Math.min(len / 45, 0.4) });
}
function updateDarts(dt) {
  for (let i = darts.length - 1; i >= 0; i--) { const d = darts[i]; d.life -= dt; d.g.position.addScaledVector(d.dir, 45 * dt); if (d.life <= 0) { scene.remove(d.g); darts.splice(i, 1); } }
}

// ---------------- fly splat effect ----------------
const goo = [];
{
  const gG = new THREE.IcosahedronGeometry(0.022, 0);
  const mats = [0x9ccc65, 0xcddc39, 0x7cb342, 0xffee58].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, emissive: c, emissiveIntensity: 0.2 }));
  for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(gG, mats[i % mats.length]); m.visible = false; scene.add(m); goo.push({ m, v: new V3(), life: 0, s: 1 }); }
}
const splatTex = canvasTex(128, (x) => {
  x.translate(64, 64); x.fillStyle = 'rgba(160,210,60,.95)';
  x.beginPath(); for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2, r = (i % 2 ? 26 : 44) + Math.random() * 14; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.fill();
  x.fillStyle = 'rgba(230,255,120,.9)'; x.beginPath(); x.arc(-8, -8, 14, 0, 7); x.fill();
  for (let i = 0; i < 8; i++) { const a = Math.random() * 7, r = 50 + Math.random() * 10; x.beginPath(); x.arc(Math.cos(a) * r, Math.sin(a) * r, 4 + Math.random() * 4, 0, 7); x.fill(); }
});
const splatSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: splatTex, transparent: true, depthWrite: false })); splatSprite.visible = false; scene.add(splatSprite);
let splatT = 1;
function splatAt(p) {
  for (const g of goo) { g.m.visible = true; g.m.position.copy(p); g.v.set(rand(-1, 1), rand(-0.6, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 3.4)); g.v.y += 0.8; g.life = rand(0.45, 0.9); g.s = rand(0.6, 1.7); g.m.scale.setScalar(g.s); }
  splatSprite.position.copy(p); splatSprite.material.rotation = Math.random() * 6; splatT = 0; splatSprite.visible = true;
}
function updateSplat(dt) {
  for (const g of goo) { if (g.life <= 0) continue; g.life -= dt; g.v.y -= 7 * dt; g.m.position.addScaledVector(g.v, dt); g.m.scale.setScalar(g.s * Math.max(0.05, g.life * 1.4)); g.m.rotation.x += dt * 8; if (g.life <= 0) g.m.visible = false; }
  if (splatSprite.visible) { splatT += dt; const k = splatT / 0.5; splatSprite.scale.setScalar(0.15 + 0.9 * ease(clamp(splatT / 0.22, 0, 1))); splatSprite.material.opacity = 1 - clamp(k, 0, 1); if (k >= 1) splatSprite.visible = false; }
}
function hitMarker(kill) { const h = $('hitmarker'); h.classList.remove('show', 'kill'); void h.offsetWidth; h.classList.add('show'); if (kill) h.classList.add('kill'); }

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
  hit() { tone({ type: 'triangle', f0: 1500, f1: 1500, dur: 0.06, vol: 0.12 }); },
  hurt() { tone({ type: 'sawtooth', f0: 220, f1: 90, dur: 0.18, vol: 0.2 }); noise({ dur: 0.12, vol: 0.3, freq: 500 }); },
  empty() { tone({ type: 'square', f0: 2400, f1: 1800, dur: 0.03, vol: 0.08 }); },
  magOut() { noise({ dur: 0.06, vol: 0.3, freq: 1400, type: 'bandpass', q: 2 }); tone({ type: 'triangle', f0: 500, f1: 300, dur: 0.06, vol: 0.08 }); },
  magIn() { noise({ dur: 0.05, vol: 0.35, freq: 1800, type: 'bandpass', q: 2 }); noise({ dur: 0.05, vol: 0.3, freq: 2400, type: 'bandpass', q: 2, delay: 0.09 }); },
  pump() { noise({ dur: 0.07, vol: 0.35, freq: 1200, type: 'bandpass', q: 1.5 }); noise({ dur: 0.07, vol: 0.35, freq: 1600, type: 'bandpass', q: 1.5, delay: 0.14 }); },
  bolt() { noise({ dur: 0.06, vol: 0.3, freq: 2200, type: 'bandpass', q: 2 }); noise({ dur: 0.06, vol: 0.3, freq: 1700, type: 'bandpass', q: 2, delay: 0.16 }); },
  tick() { tone({ f0: 1000, f1: 1000, dur: 0.05, vol: 0.08 }); },
  end() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, f1: f, dur: 0.2, vol: 0.15, delay: i * 0.11 })); },
};
const invQ = new Q();
function updateBuzz() {
  const c = audio.ctx; if (!c || !audio.panner) return; const t = c.currentTime;
  invQ.copy(camera.quaternion).invert();
  const rel = tmpV.copy(fly.pos).sub(camera.position).applyQuaternion(invQ);
  const p = audio.panner;
  if (p.positionX) { p.positionX.setTargetAtTime(rel.x, t, 0.02); p.positionY.setTargetAtTime(rel.y, t, 0.02); p.positionZ.setTargetAtTime(rel.z, t, 0.02); }
  else p.setPosition(rel.x, rel.y, rel.z);
  const f = 185 + fly.speed * 14 + (fly.escapeT > 0 ? 60 : 0);
  audio.o1.frequency.setTargetAtTime(f, t, 0.05); audio.o2.frequency.setTargetAtTime(f * 1.02, t, 0.05);
  const vol = (!fly.alive || gameMode() === 'duel') ? 0 : state === 'playing' ? 1 : 0.35;
  audio.buzzOut.gain.setTargetAtTime(vol, t, 0.08);
}

// ---------------- haptics ----------------
const hapticLbl = $('hapticLbl');
function haptic(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); return; } catch (e) {} }
  try { hapticLbl.click(); } catch (e) {}
}

// ---------------- camera / orientation / motion ----------------
let mode = 'none'; // 'gyro' | 'drag' | 'mouse'
let devOri = null, oriEvents = 0, screenAngle = 0, yaw = 0, pitch = 0;
window.addEventListener('deviceorientation', (e) => { if (e.alpha == null) return; devOri = e; oriEvents++; });
window.addEventListener('devicemotion', (e) => {
  const a = e.acceleration; if (!a || a.x == null) return;
  const mag = Math.hypot(a.x, a.y, a.z);
  vm.walkT = Math.max(vm.walkT, clamp((mag - 0.6) / 2.5, 0, 1));
});
function readScreenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  screenAngle = a * DEG;
}
const qBase = new Q(), qDev = new Q(), qTmp = new Q(), qOff = new Q(), q1 = new Q(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new V3(0, 0, 1);
const eul = new THREE.Euler(), eOff = new THREE.Euler(0, 0, 0, 'YXZ');
const prevFwd = new V3(0, 0, -1), baseFwd = new V3();
let firstOri = true;
function updateCameraOrientation() {
  if (mode === 'gyro' && devOri) {
    eul.set(devOri.beta * DEG, devOri.alpha * DEG, -devOri.gamma * DEG, 'YXZ');
    qDev.setFromEuler(eul); qDev.multiply(q1); qDev.multiply(qTmp.setFromAxisAngle(zee, -screenAngle));
    if (firstOri) { qBase.copy(qDev); firstOri = false; } else qBase.slerp(qDev, 0.6);
  } else { eul.set(pitch, yaw, 0, 'YXZ'); qBase.setFromEuler(eul); }
  // viewmodel look-lag from how far the aim moved this frame
  baseFwd.set(0, 0, -1).applyQuaternion(qBase);
  const rel = tmpV.copy(prevFwd).applyQuaternion(qTmp.copy(qBase).invert());
  vm.lagX = clamp(vm.lagX + rel.x * 0.35, -0.03, 0.03); vm.lagY = clamp(vm.lagY + rel.y * 0.35, -0.03, 0.03);
  prevFwd.copy(baseFwd);
  // recoil punch + aim sway on top of the device/mouse aim
  eOff.set(vm.punchP + swayPitch, vm.punchY + swayYaw, 0, 'YXZ');
  camera.quaternion.copy(qBase).multiply(qOff.setFromEuler(eOff));
  camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
}
function computeBaseFov() {
  const W = innerWidth, H = innerHeight;
  if (camOn && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight, T = Math.tan(CAM_FOV_LONG / 2 * DEG);
    const tH = vw >= vh ? T * vh / vw : T;
    const s = Math.max(W / vw, H / vh);
    baseFov = 2 * Math.atan(tH * H / (vh * s)) / DEG;
  } else baseFov = W > H ? 60 : 72;
  applyFov();
}
function applyFov() {
  camera.fov = 2 * Math.atan(Math.tan(baseFov / 2 * DEG) / zoom) / DEG;
  camera.updateProjectionMatrix();
  video.style.transform = zoom > 1.001 ? `scale(${zoom.toFixed(3)})` : '';
}
function setZoomValue(z) { if (Math.abs(z - zoom) < 1e-4) return; zoom = z; applyFov(); }
function onResize() {
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  readScreenAngle(); layoutViewmodel(); computeBaseFov();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
video.addEventListener('loadedmetadata', computeBaseFov);
video.addEventListener('resize', computeBaseFov);

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Camera needs HTTPS. Using a virtual room.'); return false; }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = s; video.classList.add('on'); camOn = true;
    try { await video.play(); } catch (e) {}
    return true;
  } catch (e) { toast('Camera blocked. Using a virtual room.'); return false; }
}
const waitOri = (ms) => new Promise((res) => { const t0 = performance.now(); const chk = () => { if (oriEvents > 0) res(true); else if (performance.now() - t0 > ms) res(false); else setTimeout(chk, 50); }; chk(); });
let permsDone = false;
// must be called from a user gesture: camera, motion, audio
async function ensurePerms(useCam) {
  initAudio();
  if (permsDone) return;
  let oriP = Promise.resolve('granted');
  if (isTouch && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    oriP = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
  if (isTouch && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function')
    DeviceMotionEvent.requestPermission().catch(() => {});
  const camP = (useCam && isTouch) ? startCamera() : Promise.resolve(false);
  const [ori, camOk] = await Promise.all([oriP, camP]);
  if (isTouch) {
    mode = (ori === 'granted' && await waitOri(1000)) ? 'gyro' : 'drag';
    if (mode === 'drag') toast('Motion sensors unavailable. Drag to look, tap to fire.');
  } else mode = 'mouse';
  room.visible = !camOk;
  permsDone = true; started = true;
  onResize(); updateCameraOrientation();
}
function lockMouse() { if (mode === 'mouse' && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} } }

// ---------------- game state ----------------
let state = 'menu', elapsed = 0, timeLeft = ROUND, score = 0, lastTick = 0, lastShot = 0, triggerHeld = false, started = false;
const stats = { shots: 0, hits: 0, kills: 0, dodges: 0 };
let best = +(localStorage.getItem('flyhunt.best') || 0);
$('best').textContent = best;
const gameMode = () => (mp.on ? mp.mode : 'solo');
const elapsedFrac = () => (mp.on && state === 'playing' ? 1 - (mp.roundEnd - hostNow()) / ROUND : elapsed / ROUND);
function canFire(forAds) {
  if (forAds) return started && state !== 'over';
  return state === 'playing' && !(gameMode() === 'duel' && !mp.meAlive);
}
if (!isTouch) $('deskNote').textContent = 'Desktop: click to lock the mouse, move to look, click to fire. Hold right-click (or Z) to aim down sights, wheel = scope zoom, Shift = hold breath, R = reload, 1–4 = blasters, F = call the fly.';

function resetLoadout() { for (const k in WEAPONS) WEAPONS[k].ammo = WEAPONS[k].mag; vm.reload = null; updateAmmo(); }
function startSoloRound() {
  state = 'playing'; elapsed = 0; timeLeft = ROUND; score = 0; lastTick = 0;
  Object.assign(stats, { shots: 0, hits: 0, kills: 0, dodges: 0 });
  resetLoadout(); respawnFly(true); updateHud(); lockMouse();
}
function endSoloRound() {
  state = 'over'; triggerHeld = false; vm.adsWant = false; sfx.end();
  const nh = score > best; if (nh) { best = score; localStorage.setItem('flyhunt.best', best); }
  $('overTitle').textContent = nh ? 'NEW HIGH SCORE!' : 'TIME!';
  $('finalScore').textContent = score;
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  $('finalStats').innerHTML = `🪰 Flies splatted: <b>${stats.kills}</b><br>🎯 Accuracy: <b>${acc}%</b> (${stats.hits}/${stats.shots})<br>💨 Dodges: <b>${stats.dodges}</b><br>${nh ? '<span class="nh">🏆 Best ever!</span>' : `Best: <b>${best}</b>`}`;
  $('best').textContent = best; $('againBtn').classList.remove('hidden'); $('overLobby').classList.add('hidden'); $('overWait').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => $('over').classList.remove('hidden'), 400);
}
function updateHud() {
  if (mp.on) { const me = mp.players.get(mp.myId); score = me ? me.score : 0; }
  $('score').textContent = score;
  const tl = Math.ceil(timeLeft); $('time').textContent = state === 'playing' ? tl : (mp.on ? '–' : tl);
  $('time').parentElement.classList.toggle('low', state === 'playing' && tl <= 10);
}

// ---------------- shooting ----------------
function coneDir(maxAng) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * maxAng; return new V3(Math.sin(r) * Math.cos(a), Math.sin(r) * Math.sin(a), -Math.cos(r)); }
function muzzleWorld() {
  const m = WEAPONS[weaponId].model; vmScene.updateMatrixWorld();
  const ndc = m.muzzle.clone().applyMatrix4(m.g.matrixWorld).project(vmCam);
  if (scopeVis > 0.5) ndc.set(0, -0.12, 0.5);
  return new V3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(0.35).add(camera.position);
}
function tryFire() {
  if (!canFire()) return;
  const w = WEAPONS[weaponId], now = performance.now() / 1000;
  if (vm.reload || vm.raise < 0.9) return;
  if (now - lastShot < w.cooldown) return;
  if (w.ammo <= 0) { lastShot = now; sfx.empty(); if (!w.auto) triggerHeld = false; startReload(); return; }
  lastShot = now; w.ammo--; updateAmmo(); fire(w);
  if (w.ammo === 0) setTimeout(() => { if (w.ammo === 0 && weaponId === w.id && !vm.reload) startReload(); }, 380);
}
function fire(w) {
  stats.shots++;
  const ads = vm.ads > 0.8, spread = ads ? w.adsSpread : w.spread;
  const from = muzzleWorld(), dirs = [];
  for (let i = 0; i < w.pellets; i++) dirs.push(coneDir(spread * DEG).applyQuaternion(camera.quaternion));
  sfx.fire(w.id); haptic(w.haptic);
  vm.recoil = Math.min(1.2, vm.recoil + (w.id === 'rapid' ? 0.45 : 1)); vm.recoilYaw = rand(-1, 1) * w.kick[1] * 0.3;
  vm.punchP += w.kick[2] * DEG * (ads ? 0.6 : 1); vm.punchY += rand(-0.3, 0.3) * w.kick[2] * DEG;
  vm.flashT = 0.06; vm.act = { t: 0 };
  if (w.model.actionType === 'slide' || w.model.actionType === 'bolt') ejectShell();
  if (scopeVis < 0.5) { const fl = $('flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 50); }
  const mode = gameMode();
  if (mode === 'duel') {
    for (const d of dirs.slice(0, 4)) spawnDart(from, camera.position.clone().addScaledVector(d, 14));
    const msg = { t: 'shot', ht: hostNow(), w: w.id, a: ads ? 1 : 0, d: dirs.map((d) => [r4(d.x), r4(d.y), r4(d.z)]) };
    if (mp.host) hostResolveShot(mp.myId, msg); else mp.net.send(msg);
    return;
  }
  const toFly = fly.pos.clone().sub(camera.position), dist = toFly.length(); toFly.normalize();
  const hitAng = Math.atan(HIT_R / dist);
  let minAng = Infinity;
  dirs.forEach((d, i) => { const ang = d.angleTo(toFly); minAng = Math.min(minAng, ang); if (i < 4) spawnDart(from, camera.position.clone().addScaledVector(d, fly.alive && ang < hitAng ? dist : 14)); });
  if (fly.alive && fly.obj.visible && minAng < hitAng) {
    let pts = 100 + Math.round(dist * 20); const tags = [];
    if (w.scope && scopeVis > 0.5) { pts = Math.round(pts * 1.5); tags.push('SNIPED'); }
    if (fly.escapeT > 0) { pts += 75; tags.push('TRICK SHOT'); }
    if (mode === 'solo') killFlySolo(pts, tags);
    else if (mp.host) hostClaim(mp.myId, fly.n, pts, tags);
    else { mp.net.send({ t: 'claim', n: fly.n, pts, tags }); hitMarker(false); sfx.hit(); }
  } else if (fly.alive && minAng < Math.atan(1.0 / dist) && fly.escapeT <= 0) {
    if (mode === 'solo' || mp.host) escapeFly(fly.pos.clone().sub(camera.position)); else mp.net.send({ t: 'startle', n: fly.n });
  }
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
function splatFly(p) { fly.alive = false; fly.deadT = 0; fly.pos.copy(p); fly.vel.set(rand(-0.5, 0.5), 1.2, rand(-0.5, 0.5)); splatAt(p); sfx.splat(); }
function killFlySolo(pts, tags) {
  stats.hits++; stats.kills++; score += pts; updateHud();
  const s = toScreen(fly.pos); popup(`+${pts}${tags.length ? ' ' + tags.join(' ') : ''}`, s.on ? s.x : innerWidth / 2, s.on ? s.y : innerHeight / 2);
  splatFly(fly.pos.clone()); hitMarker(true); setTimeout(() => haptic(40), 60); vm.punchP += 0.3 * DEG;
}

// ---------------- weapons UI ----------------
const ZOOMS = [3, 6, 10];
function cycleZoom() { const i = ZOOMS.findIndex((z) => Math.abs(z - scopeZoom) < 0.05); scopeZoom = ZOOMS[(i + 1) % ZOOMS.length]; zoomUi(); tone({ type: 'triangle', f0: 900, f1: 1100, dur: 0.05, vol: 0.06 }); }
function zoomUi() { const t = `${(Math.round(scopeZoom * 10) / 10)}x`; $('zoomBtn').textContent = '🔭 ' + t; $('zoomLabel').textContent = t; }
function selectWeapon(id) {
  if (id === weaponId && vm.raise >= 1) return;
  weaponId = id; triggerHeld = false; vm.reload = null; vm.act = null; vm.ads = 0; vm.adsWant = false; vm.raise = 0; vm.recoil = 0;
  for (const k in WEAPONS) { const m = WEAPONS[k].model; m.g.visible = k === id; m.mag.position.copy(m.magHome); m.mag.visible = true; if (m.actionType === 'boltAction') { m.action.rotation.z = 0; m.action.position.z = 0.07; } else m.action.position.z = 0; }
  document.querySelectorAll('.wbtn').forEach((b) => b.classList.toggle('sel', b.dataset.w === id));
  updateAmmo(); tone({ type: 'triangle', f0: 600, f1: 900, dur: 0.07, vol: 0.08 });
}
document.querySelectorAll('.wbtn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); selectWeapon(b.dataset.w); }));
$('zoomBtn').addEventListener('click', (e) => { e.stopPropagation(); cycleZoom(); });
$('adsBtn').addEventListener('click', (e) => { e.stopPropagation(); initAudio(); setAds(!vm.adsWant); });
$('breathBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); holdBreath(); });
$('ammo').addEventListener('click', (e) => { e.stopPropagation(); startReload(); });
$('recenter').addEventListener('click', (e) => { e.stopPropagation(); if (gameMode() === 'solo' && fly.alive) { respawnFly(true); fly.react = 0.9; } else toast(gameMode() === 'duel' ? 'Follow the arrow to find your rival.' : 'Shared fly: follow the arrow!'); });
weaponId = '';
selectWeapon('pistol'); vm.raise = 1;

// ================= MULTIPLAYER (PeerJS / WebRTC, host-authoritative) =================
const SLOT_COLORS = ['#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#e040fb', '#ff9100'];
const SLOT_ORDER = [0, 3, 1, 4, 2, 5];
const WIDX = ['pistol', 'rapid', 'shotgun', 'sniper'];
const myCid = sessionStorage.getItem('flyhunt.cid') || (() => { const c = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('flyhunt.cid', c); return c; })();
const mp = { on: false, host: false, mode: 'race', code: '', net: null, players: new Map(), myId: myCid, myName: '', offset: 0, samples: [], ping: 0,
  roundEnd: 0, state: 'lobby', meAlive: true, hp: 100, txPose: 0, txFly: 0, txPlayers: 0, txPing: 0, reconnecting: false, reconnectUntil: 0, lost: false };
function hostNow() { return performance.now() / 1000 + (mp.on && !mp.host ? mp.offset : 0); }
const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function arenaPos(slot, t, out = new V3()) {
  const base = SLOT_ORDER[slot % 6] * Math.PI / 3;
  const phi = base + 0.5 * Math.sin(0.33 * t + slot * 1.7);
  return out.set(3 * Math.cos(phi), 0.3 * Math.sin(0.45 * t + slot * 2.1), 3 * Math.sin(phi));
}
const playerList = () => [...mp.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths, hp: p.hp, alive: p.alive, slot: p.slot, connected: p.connected, ping: p.ping }));
function newPlayer(id, name, slot) { return { id, name, score: 0, kills: 0, deaths: 0, hp: 100, alive: true, slot, connected: true, ping: 0, peer: null, q: new Q(), fwd: new V3(0, 0, -1), ads: 0, w: 'pistol', respawnAt: 0 }; }
function freeSlot() { const used = new Set([...mp.players.values()].map((p) => p.slot)); for (let i = 0; i < 6; i++) if (!used.has(i)) return i; return mp.players.size % 6; }
function emit(msg) { mp.net.broadcast(msg); onHostMsg(msg); }   // host: send to everyone and apply locally
function broadcastPlayers() { if (!mp.host) return; mp.txPlayers = 0; const msg = { t: 'players', list: playerList(), mode: mp.mode, st: mp.state }; mp.net.broadcast(msg); renderPlayersUi(); }
function getName() {
  const el = $('nameInput'); let n = (el.value || '').trim().slice(0, 14);
  if (!n) { toast('Enter your name first'); el.focus(); return null; }
  localStorage.setItem('flyhunt.name', n); mp.myName = n; return n;
}
$('nameInput').value = localStorage.getItem('flyhunt.name') || '';

const netHandlers = {
  onData: (d, from) => { if (!d || typeof d !== 'object') return; if (mp.host) onClientMsg(d, from); else onHostMsg(d); },
  onClose: (peer) => { for (const p of mp.players.values()) if (p.peer === peer && p.connected) { p.connected = false; toast(`${p.name} disconnected`); broadcastPlayers(); } },
  onHostClose: () => { if (!mp.on) return; startReconnect(); },
  onError: (e) => { console.warn('net error', e && e.type, e); if (!mp.host && e && e.type === 'peer-unavailable' && mp.reconnecting) {/* retry loop handles it */} },
};

// ---- host side ----
async function createRoom(modeSel) {
  const name = getName(); if (!name) return;
  const permP = ensurePerms($('useCam').checked);
  setNet('🟡 Creating room…');
  const net = new Net(netHandlers); let code = null;
  for (let i = 0; i < 4 && !code; i++) { const c = makeCode(5); try { code = await net.host(c); } catch (e) { if (!e || e.type !== 'unavailable-id') { toast('Could not reach the PeerJS broker. Check your connection.'); setNet(''); return; } } }
  if (!code) { toast('Could not create a room. Try again.'); setNet(''); return; }
  await permP;
  Object.assign(mp, { on: true, host: true, mode: modeSel, code, net, state: 'lobby', meAlive: true, hp: 100, lost: false });
  mp.players.clear(); const me = newPlayer(mp.myId, name, 0); mp.players.set(me.id, me);
  frand = mulberry32(hashStr(code));
  history.replaceState(null, '', `?room=${code}${Net === LocalNet ? '&net=local' : ''}`);
  enterLobby();
}
function onClientMsg(d, peer) {
  const p = [...mp.players.values()].find((x) => x.peer === peer);
  switch (d.t) {
    case 'hello': {
      let pl = mp.players.get(d.cid);
      const rejoin = !!pl;
      if (!pl) { pl = newPlayer(d.cid, String(d.name || 'Player').slice(0, 14), freeSlot()); mp.players.set(pl.id, pl); }
      pl.peer = peer; pl.connected = true; pl.name = String(d.name || pl.name).slice(0, 14);
      mp.net.sendTo(peer, { t: 'welcome', you: pl.id, code: mp.code, mode: mp.mode, st: mp.state, end: mp.roundEnd, h: hostNow(), list: playerList(), fly: flyMsg() });
      toast(`${pl.name} ${rejoin ? 'rejoined' : 'joined'}`); broadcastPlayers();
      break;
    }
    case 'ping': mp.net.sendTo(peer, { t: 'pong', c: d.c, h: hostNow() }); break;
    case 'pose': if (p) { p.q.set(d.q[0], d.q[1], d.q[2], d.q[3]); p.fwd.set(0, 0, -1).applyQuaternion(p.q); p.ads = d.a; p.w = WIDX[d.w] || 'pistol'; p.ping = d.pg | 0; } break;
    case 'claim': if (p) hostClaim(p.id, d.n, d.pts | 0, Array.isArray(d.tags) ? d.tags.slice(0, 2) : []); break;
    case 'startle': if (d.n === fly.n && fly.alive && fly.escapeT <= 0) escapeFly(fly.pos.clone().sub(camera.position)); break;
    case 'shot': if (p) hostResolveShot(p.id, d); break;
  }
}
function flyMsg() { return { t: 'fly', n: fly.n, p: [r4(fly.pos.x), r4(fly.pos.y), r4(fly.pos.z)], v: [r4(fly.vel.x), r4(fly.vel.y), r4(fly.vel.z)], al: fly.alive ? 1 : 0, e: fly.escapeT > 0 ? 1 : 0, h: hostNow() }; }
function sendFly() { if (mp.on && mp.host && mp.mode === 'race') { mp.txFly = 0; mp.net.broadcast(flyMsg()); } }
function hostClaim(id, n, pts, tags) {
  const pl = mp.players.get(id);
  if (!pl || mp.state !== 'playing' || n !== fly.n || !fly.alive) return;
  pts = clamp(pts, 0, 400); pl.score += pts; pl.kills++;
  emit({ t: 'kill', n, by: id, pts, tags, p: [r4(fly.pos.x), r4(fly.pos.y), r4(fly.pos.z)] });
  broadcastPlayers();
}
function hostResolveShot(id, s) {
  const sh = mp.players.get(id); if (!sh || !sh.alive || mp.state !== 'playing' || !Array.isArray(s.d)) return;
  const W = WEAPONS[s.w] || WEAPONS.pistol; const ht = clamp(+s.ht || hostNow(), hostNow() - 0.5, hostNow());
  const o = arenaPos(sh.slot, ht), dmgBy = new Map(), d = new V3(), c = new V3();
  for (const dv of s.d.slice(0, 12)) {
    d.set(dv[0], dv[1], dv[2]).normalize(); let bestT = Infinity, target = null;
    for (const p of mp.players.values()) {
      if (p.id === id || !p.alive || !p.connected) continue;
      arenaPos(p.slot, ht, c).sub(o); const tt = c.dot(d); if (tt <= 0) continue;
      if (c.lengthSq() - tt * tt < AV_R * AV_R && tt < bestT) { bestT = tt; target = p; }
    }
    if (target) dmgBy.set(target, (dmgBy.get(target) || 0) + (W.scope && s.a ? 100 : W.dmg));
  }
  mp.net.broadcast({ t: 'fx', by: id, d: s.d.slice(0, 3) }, sh.peer || undefined);
  if (id !== mp.myId) onHostMsg({ t: 'fx', by: id, d: s.d.slice(0, 3) });
  for (const [p, dmg] of dmgBy) {
    p.hp = Math.max(0, p.hp - dmg); const k = p.hp <= 0;
    if (k) { p.alive = false; p.deaths++; sh.kills++; sh.score += 100; p.respawnAt = hostNow() + 3; }
    emit({ t: 'hit', by: id, to: p.id, dmg, hp: p.hp, k: k ? 1 : 0 });
  }
  if (dmgBy.size) broadcastPlayers();
}
function hostStartRound() {
  if (!mp.host) return;
  for (const p of mp.players.values()) Object.assign(p, { score: 0, kills: 0, deaths: 0, hp: 100, alive: true });
  mp.roundEnd = hostNow() + ROUND; mp.state = 'playing';
  if (mp.mode === 'race') respawnFly(true);
  emit({ t: 'start', mode: mp.mode, end: mp.roundEnd });
  broadcastPlayers();
}
function hostTick(dt) {
  const now = hostNow();
  if (mp.state === 'playing') {
    if (now >= mp.roundEnd) { mp.state = 'over'; emit({ t: 'end', list: playerList(), mode: mp.mode }); broadcastPlayers(); }
    if (mp.mode === 'duel') for (const p of mp.players.values()) if (!p.alive && now >= p.respawnAt) { p.alive = true; p.hp = 100; emit({ t: 'respawn', id: p.id }); broadcastPlayers(); }
  }
  mp.txFly += dt; mp.txPose += dt; mp.txPlayers += dt;
  if (mp.mode === 'race' && mp.txFly >= 1 / 15) sendFly();
  if (mp.txPose >= 0.08) {
    mp.txPose = 0; const me = mp.players.get(mp.myId);
    if (me) { me.q.copy(camera.quaternion); me.ads = vm.ads > 0.5 ? 1 : 0; me.w = weaponId; }
    mp.net.broadcast({ t: 'poses', l: [...mp.players.values()].map((p) => [p.id, r4(p.q.x), r4(p.q.y), r4(p.q.z), r4(p.q.w), p.ads ? 1 : 0, WIDX.indexOf(p.w)]) });
  }
  if (mp.txPlayers >= 1) broadcastPlayers();
}

// ---- client side ----
async function joinRoom() {
  const name = getName(); if (!name) return;
  const code = cleanCode($('codeInput').value);
  if (code.length < 4) { toast('Enter the 4–6 letter room code'); $('codeInput').focus(); return; }
  const permP = ensurePerms($('useCam').checked);
  setNet('🟡 Connecting to ' + code + '…');
  const net = new Net(netHandlers);
  Object.assign(mp, { on: true, host: false, code, net, state: 'lobby', mode: 'race', meAlive: true, hp: 100, lost: false, reconnecting: false, samples: [] });
  mp.players.clear();
  try { await net.join(code); } catch (e) { net.close(); mp.on = false; setNet(''); toast(`Couldn't reach room ${code}. Check the code, or the host may have left.`); return; }
  await permP;
  net.send({ t: 'hello', cid: mp.myId, name });
  history.replaceState(null, '', `?room=${code}${Net === LocalNet ? '&net=local' : ''}`);
  enterLobby();
}
function startReconnect() {
  if (mp.reconnecting) return;
  mp.reconnecting = true; mp.reconnectUntil = performance.now() + 40000; setNet('🟡 Reconnecting…');
  const attempt = () => {
    if (!mp.on || mp.host) return;
    mp.net.reconnect().then(() => { mp.reconnecting = false; mp.net.send({ t: 'hello', cid: mp.myId, name: mp.myName }); toast('Reconnected'); })
      .catch(() => { if (performance.now() < mp.reconnectUntil) setTimeout(attempt, 2500); else { mp.reconnecting = false; mp.lost = true; setNet('🔴 Host left'); toast('Lost the host. Leave the room to play solo.'); } });
  };
  setTimeout(attempt, 800);
}
function clientTick(dt) {
  if (!mp.net.connected) return;
  mp.txPing += dt; mp.txPose += dt;
  if (mp.txPing >= 2) { mp.txPing = 0; mp.net.send({ t: 'ping', c: performance.now() / 1000 }); }
  if (mp.txPose >= 0.08) { mp.txPose = 0; const q = camera.quaternion; mp.net.send({ t: 'pose', q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)], a: vm.ads > 0.5 ? 1 : 0, w: WIDX.indexOf(weaponId), pg: Math.round(mp.ping) }); }
}
function applyList(list) {
  const seen = new Set();
  for (const s of list) {
    seen.add(s.id); let p = mp.players.get(s.id);
    if (!p) { p = newPlayer(s.id, s.name, s.slot); mp.players.set(s.id, p); }
    Object.assign(p, s);
  }
  for (const id of [...mp.players.keys()]) if (!seen.has(id)) mp.players.delete(id);
  const me = mp.players.get(mp.myId); if (me && !mp.host) { mp.meAlive = me.alive; mp.hp = me.hp; }
  renderPlayersUi();
}
// messages from the host (also applied locally on the host via emit)
function onHostMsg(d) {
  switch (d.t) {
    case 'welcome':
      mp.offset = d.h - performance.now() / 1000; mp.myId = d.you; mp.mode = d.mode; mp.state = d.st; mp.roundEnd = d.end;
      applyList(d.list); if (d.fly) onHostMsg(d.fly);
      mp.net.send({ t: 'ping', c: performance.now() / 1000 });
      setNet('🟢 ' + mp.code);
      if (d.st === 'playing') beginMpRound(); else enterLobby();
      break;
    case 'pong': {
      const now = performance.now() / 1000, rtt = now - d.c;
      mp.ping = mp.ping ? mp.ping * 0.6 + rtt * 400 : rtt * 1000;
      mp.samples.push({ rtt, off: d.h + rtt / 2 - now }); if (mp.samples.length > 8) mp.samples.shift();
      mp.offset = mp.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
      break;
    }
    case 'players': if (!mp.host) { mp.mode = d.mode; if (d.st) mp.state = d.st; applyList(d.list); } break;
    case 'poses': if (mp.host) break; for (const r of d.l) { const p = mp.players.get(r[0]); if (!p || p.id === mp.myId) continue; p.q.set(r[1], r[2], r[3], r[4]); p.fwd.set(0, 0, -1).applyQuaternion(p.q); p.ads = r[5]; p.w = WIDX[r[6]] || 'pistol'; } break;
    case 'mode': mp.mode = d.mode; renderPlayersUi(); break;
    case 'fly':
      if (mp.host) break;
      if (d.n !== fly.n || (d.al && !fly.alive)) { fly.n = d.n; fly.alive = !!d.al; if (fly.alive) { fly.pos.set(d.p[0], d.p[1], d.p[2]); fly.obj.visible = mp.mode === 'race'; fly.obj.scale.setScalar(1); fly.obj.rotation.set(0, 0, 0); fly.deadT = 0; } }
      fly.net.p.set(d.p[0], d.p[1], d.p[2]); fly.net.v.set(d.v[0], d.v[1], d.v[2]); fly.net.at = d.h; fly.escapeT = d.e ? 0.3 : 0;
      break;
    case 'kill': {
      const p = new V3(d.p[0], d.p[1], d.p[2]); splatFly(p);
      const pl = mp.players.get(d.by), s = toScreen(p), x = s.on ? s.x : innerWidth / 2, y = s.on ? s.y : innerHeight / 2;
      if (d.by === mp.myId) { stats.hits++; stats.kills++; popup(`+${d.pts}${d.tags && d.tags.length ? ' ' + d.tags.join(' ') : ''}`, x, y); hitMarker(true); setTimeout(() => haptic(40), 60); }
      else popup(`${pl ? pl.name : 'Someone'} +${d.pts}`, x, y, 'small');
      break;
    }
    case 'start': beginMpRound(d); break;
    case 'end': endMpRound(d); break;
    case 'hit': {
      const to = mp.players.get(d.to); if (to) { to.hp = d.hp; if (d.k) to.alive = false; }
      if (d.to === mp.myId) { mp.hp = d.hp; sfx.hurt(); haptic(60); dmgFlash(); vm.punchP += 1.2 * DEG; vm.punchY += rand(-1, 1) * DEG; if (d.k) { mp.meAlive = false; vm.adsWant = false; const by = mp.players.get(d.by); showDead(by ? by.name : 'someone'); } }
      if (d.by === mp.myId) { stats.hits++; hitMarker(!!d.k); sfx.hit(); if (d.k) stats.kills++; const av = avatars.get(d.to); if (av) { const s = toScreen(av.g.position); if (s.on) popup(d.k ? 'ELIMINATED +100' : `-${d.dmg}`, s.x, s.y - 40, d.k ? '' : 'small'); } }
      break;
    }
    case 'respawn': { const p = mp.players.get(d.id); if (p) { p.alive = true; p.hp = 100; } if (d.id === mp.myId) { mp.meAlive = true; mp.hp = 100; $('dead').classList.add('hidden'); resetLoadout(); } break; }
    case 'fx': {
      const p = mp.players.get(d.by); if (!p || d.by === mp.myId) break;
      const from = arenaPos(p.slot, hostNow()).add(new V3(0, -0.05, 0)), col = new THREE.Color(SLOT_COLORS[p.slot % 6]).getHex();
      for (const v of d.d) spawnDart(from, from.clone().addScaledVector(new V3(v[0], v[1], v[2]), 12), col);
      tone({ type: 'square', f0: 700, f1: 220, dur: 0.1, vol: 0.05 });
      break;
    }
  }
}
function beginMpRound(d) {
  if (d) { mp.mode = d.mode; mp.roundEnd = d.end; }
  mp.state = 'playing'; state = 'playing'; lastTick = 0; mp.meAlive = true; mp.hp = 100;
  Object.assign(stats, { shots: 0, hits: 0, kills: 0, dodges: 0 });
  resetLoadout(); hideOverlays(); $('dead').classList.add('hidden');
  fly.obj.visible = mp.mode === 'race' && fly.alive;
  lockMouse(); renderPlayersUi();
  toast(mp.mode === 'race' ? '🪰 FLY RACE! First to hit the fly scores.' : '⚔️ DUEL! Find your rivals and tag them.');
}
function endMpRound(d) {
  state = 'over'; mp.state = 'over'; triggerHeld = false; vm.adsWant = false; sfx.end();
  if (d && d.list && !mp.host) applyList(d.list);
  const list = [...mp.players.values()].sort((a, b) => b.score - a.score);
  const win = list[0];
  $('overTitle').textContent = win && win.id === mp.myId ? '🏆 YOU WIN!' : `${win ? win.name : '?'} WINS`;
  const me = mp.players.get(mp.myId); $('finalScore').textContent = me ? me.score : 0;
  $('finalStats').innerHTML = list.map((p, i) => `${i + 1}. <span style="color:${SLOT_COLORS[p.slot % 6]}">●</span> <b>${esc(p.name)}</b> ${p.score}${mp.mode === 'duel' ? ` (${p.kills}K/${p.deaths}D)` : ` (${p.kills} 🪰)`}${p.id === mp.myId ? ' ← you' : ''}`).join('<br>');
  $('againBtn').classList.toggle('hidden', !mp.host); $('overLobby').classList.toggle('hidden', !mp.host); $('overWait').classList.toggle('hidden', mp.host);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => $('over').classList.remove('hidden'), 400);
}
function leaveRoom() {
  if (mp.net) mp.net.close();
  mp.on = false; mp.players.clear(); state = 'menu'; frand = Math.random;
  for (const av of avatars.values()) scene.remove(av.g); avatars.clear();
  fly.obj.visible = true; if (!fly.alive) respawnFly(false);
  history.replaceState(null, '', location.pathname + (Net === LocalNet ? '?net=local' : ''));
  hideOverlays(); $('dead').classList.add('hidden'); $('start').classList.remove('hidden'); setNet(''); renderPlayersUi();
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- duel avatars ----
const avatars = new Map();
function makeAvatar(p) {
  const g = new THREE.Group(), col = new THREE.Color(SLOT_COLORS[p.slot % 6]);
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.1 });
  const head = new THREE.Group(); g.add(head);
  add(head, new THREE.SphereGeometry(0.2, 24, 18), bodyMat);
  add(head, RB(0.26, 0.09, 0.1, 0.03), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.08, metalness: 0.6 }), 0, 0.03, -0.15);
  add(head, RB(0.2, 0.012, 0.01, 0.004), glowMat(0x80ffff), 0, 0.03, -0.202);
  add(head, RB(0.05, 0.06, 0.22, 0.01), plastic(0xffd600), 0.19, -0.1, -0.12);
  add(head, cylZ(0.02, 0.02, 0.03, 12), M.tip, 0.19, -0.095, -0.245);
  add(g, new THREE.ConeGeometry(0.15, 0.34, 20), bodyMat, 0, -0.33, 0, Math.PI);
  add(g, new THREE.TorusGeometry(0.22, 0.014, 8, 32), glowMat(col.getHex()), 0, -0.56, 0, R90);
  const glint = addSprite(head, glintTex, 0xffffff, 0.35, 0.05, 0.05, -0.21); glint.visible = false;
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 80; const tex = new THREE.CanvasTexture(lc); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false })); label.scale.set(0.9, 0.28, 1); label.position.y = 0.45; label.renderOrder = 5; g.add(label);
  scene.add(g);
  return { g, head, glint, label, lc, tex, key: '' };
}
function drawLabel(av, p) {
  const key = `${p.name}|${p.hp}|${p.connected}`; if (key === av.key) return; av.key = key;
  const x = av.lc.getContext('2d'); x.clearRect(0, 0, 256, 80);
  x.fillStyle = 'rgba(10,12,30,.7)'; x.beginPath(); x.roundRect(4, 4, 248, 72, 16); x.fill();
  x.fillStyle = SLOT_COLORS[p.slot % 6]; x.font = 'bold 30px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText(p.name + (p.connected ? '' : ' (away)'), 128, 38);
  x.fillStyle = 'rgba(255,255,255,.2)'; x.fillRect(28, 52, 200, 12); x.fillStyle = p.hp > 50 ? '#69f0ae' : p.hp > 25 ? '#ffd740' : '#ff5252'; x.fillRect(28, 52, 2 * p.hp, 12);
  av.tex.needsUpdate = true;
}
const tq = new Q();
function updateAvatars(dt, t) {
  const duel = mp.on && mp.mode === 'duel';
  for (const [id, av] of avatars) if (!mp.players.has(id)) { scene.remove(av.g); avatars.delete(id); }
  if (!mp.on) return;
  for (const p of mp.players.values()) {
    if (p.id === mp.myId) continue;
    let av = avatars.get(p.id); if (!av) { av = makeAvatar(p); avatars.set(p.id, av); }
    av.g.visible = duel && p.alive;
    if (!av.g.visible) continue;
    arenaPos(p.slot, t, av.g.position); av.g.position.y += Math.sin(t * 2 + p.slot) * 0.04;
    av.head.quaternion.slerp(p.q, 1 - Math.exp(-12 * dt));
    av.glint.visible = p.w === 'sniper' && !!p.ads; if (av.glint.visible) av.glint.material.opacity = 0.6 + 0.4 * Math.sin(t * 9);
    drawLabel(av, p);
  }
}
function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const p of mp.players.values()) { if (p.id === mp.myId || !p.alive || !p.connected) continue; const av = avatars.get(p.id); if (!av) continue; const ang = camFwd.angleTo(tmpV.copy(av.g.position).sub(camera.position)); if (ang < bd) { bd = ang; best = av; } }
  return best;
}

// ---------------- menus, lobby, status ----------------
function hideOverlays() { for (const id of ['start', 'over', 'lobby']) $(id).classList.add('hidden'); }
function setNet(text) { const n = $('net'); n.textContent = text; n.classList.toggle('hidden', !text); }
function enterLobby() {
  state = 'lobby'; if (mp.host) mp.state = 'lobby';
  hideOverlays(); $('lobby').classList.remove('hidden'); $('dead').classList.add('hidden');
  const link = `${location.origin}${location.pathname}?room=${mp.code}${Net === LocalNet ? '&net=local' : ''}`;
  $('lobbyCode').textContent = mp.code; $('lobbyLink').textContent = link; $('lobbyLink').href = link;
  if (document.pointerLockElement) document.exitPointerLock();
  setNet('🟢 ' + mp.code); renderPlayersUi();
}
function renderPlayersUi() {
  const list = [...mp.players.values()].sort((a, b) => b.score - a.score || a.slot - b.slot);
  const row = (p) => `<div class="prow${p.connected ? '' : ' off'}"><span class="dot" style="background:${SLOT_COLORS[p.slot % 6]}"></span><b>${esc(p.name)}</b>${p.id === mp.myId ? ' <small>(you)</small>' : ''}<span class="sc">${p.score}${mp.mode === 'duel' ? ` · ${p.kills}K/${p.deaths}D` : ''}</span><span class="pg">${p.connected ? (p.id === mp.myId ? (mp.host ? 'host' : Math.round(mp.ping) + 'ms') : (p.ping ? p.ping + 'ms' : '')) : 'away'}</span></div>`;
  $('lobbyPlayers').innerHTML = list.map(row).join('') || '<i>Nobody yet</i>';
  $('lobbyModeName').textContent = mp.mode === 'race' ? '🪰 Fly Race' : '⚔️ Duel (FFA)';
  $('lobbyHost').classList.toggle('hidden', !mp.host); $('lobbyWait').classList.toggle('hidden', mp.host);
  $('modeRace').classList.toggle('sel', mp.mode === 'race'); $('modeDuel').classList.toggle('sel', mp.mode === 'duel');
  $('board').classList.toggle('hidden', !mp.on || state === 'lobby');
  $('board').innerHTML = list.map(row).join('');
  if (mp.on && !mp.reconnecting && !mp.lost) setNet(`🟢 ${mp.code} · ${mp.players.size}P${mp.host ? ' · host' : ` · ${Math.round(mp.ping)} ms`}`);
}
function showDead(by) { const d = $('dead'); d.innerHTML = `💥 Tagged by <b>${esc(by)}</b><br><small>Respawning…</small>`; d.classList.remove('hidden'); }
function dmgFlash() { const d = $('dmg'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }

$('startBtn').addEventListener('click', async () => { await ensurePerms(true); hideOverlays(); startSoloRound(); });
$('nocamBtn').addEventListener('click', async () => { await ensurePerms(false); hideOverlays(); startSoloRound(); });
$('createRace').addEventListener('click', () => createRoom('race'));
$('createDuel').addEventListener('click', () => createRoom('duel'));
$('joinBtn').addEventListener('click', () => joinRoom());
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('lobbyStartBtn').addEventListener('click', () => { initAudio(); hostStartRound(); });
$('modeRace').addEventListener('click', () => { if (!mp.host) return; mp.mode = 'race'; emit({ t: 'mode', mode: 'race' }); broadcastPlayers(); });
$('modeDuel').addEventListener('click', () => { if (!mp.host) return; mp.mode = 'duel'; emit({ t: 'mode', mode: 'duel' }); broadcastPlayers(); });
$('leaveBtn').addEventListener('click', leaveRoom);
$('overLeave').addEventListener('click', leaveRoom);
$('copyBtn').addEventListener('click', async () => { const link = $('lobbyLink').href; try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { toast(link); } });
$('shareBtn').addEventListener('click', async () => { const link = $('lobbyLink').href; if (navigator.share) { try { await navigator.share({ title: 'Fly Hunt', text: `Join my Fly Hunt room ${mp.code}`, url: link }); } catch (e) {} } else { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { toast(link); } } });
$('againBtn').addEventListener('click', () => { initAudio(); if (mp.on) { if (mp.host) hostStartRound(); } else { hideOverlays(); startSoloRound(); } });
$('overLobby').addEventListener('click', () => { if (mp.host) { enterLobby(); broadcastPlayers(); } });
const roomParam = cleanCode(new URLSearchParams(location.search).get('room'));
if (roomParam) { $('codeInput').value = roomParam; $('mpBox').classList.add('focus'); setTimeout(() => ($('nameInput').value ? $('joinBtn') : $('nameInput')).focus(), 300); $('joinHint').textContent = `You were invited to room ${roomParam}. Enter your name and tap Join.`; }

// ---------------- input ----------------
const pointers = new Map(); let pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'mouse' || !started) return;
  initAudio();
  if (document.pointerLockElement !== canvas) { if (state === 'playing' || state === 'lobby') lockMouse(); if (e.button !== 2) return; }
  if (e.button === 2) { setAds(true); return; }
  if (e.button === 0) { triggerHeld = true; tryFire(); }
});
window.addEventListener('mouseup', (e) => { if (mode !== 'mouse') return; if (e.button === 2) setAds(false); if (e.button === 0) triggerHeld = false; });
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  e.preventDefault(); if (!started) return;
  if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  if (pointers.size === 2) { triggerHeld = false; const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: scopeZoom }; return; }
  if (pointers.size === 1 && mode === 'gyro') { triggerHeld = true; tryFire(); }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') return;
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.sx, p.y - p.sy) > 10) p.moved = true;
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = d / pinch.d;
    if (weaponId !== 'sniper' && r > 1.15) { selectWeapon('sniper'); }
    if (weaponId === 'sniper') { if (r > 1.08) setAds(true); else if (r < 0.75 && scopeZoom <= 3.05) setAds(false); scopeZoom = clamp(pinch.z * r, 2, 12); zoomUi(); }
    return;
  }
  if (mode === 'drag' && pointers.size === 1) { const k = 0.005 / zoom; yaw += dx * k; pitch = clamp(pitch + dy * k, -1.45, 1.45); }
});
const endPointer = (e) => {
  if (e.pointerType === 'mouse') return;
  const p = pointers.get(e.pointerId); if (!p) return;
  if (mode === 'drag' && !p.moved && pointers.size === 1 && !pinch) tryFire();
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) triggerHeld = false;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
document.addEventListener('mousemove', (e) => {
  if (mode !== 'mouse' || document.pointerLockElement !== canvas) return;
  const k = 0.0022 / zoom; yaw -= e.movementX * k; pitch = clamp(pitch - e.movementY * k, -1.45, 1.45);
});
window.addEventListener('wheel', (e) => { if (mode === 'mouse' && weaponId === 'sniper' && vm.ads > 0.5) { scopeZoom = clamp(scopeZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 2, 12); zoomUi(); } }, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT')) return;
  const map = { Digit1: 'pistol', Digit2: 'rapid', Digit3: 'shotgun', Digit4: 'sniper' };
  if (map[e.code]) selectWeapon(map[e.code]);
  else if (e.code === 'KeyZ') setAds(!vm.adsWant);
  else if (e.code === 'KeyR') startReload();
  else if (e.code === 'KeyF') $('recenter').click();
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') holdBreath();
  else if (e.code === 'Space' && state === 'playing') { triggerHeld = true; tryFire(); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') triggerHeld = false; });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------------- HUD helpers ----------------
function toScreen(p) {
  const v = p.clone().project(camera);
  const inFront = tmpV2.copy(p).sub(camera.position).dot(camFwd) > 0;
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, on: inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
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
  const duel = gameMode() === 'duel';
  let pos, alive, radius;
  if (duel) { const av = nearestEnemy(); alive = !!av; pos = av ? av.g.position : null; radius = AV_R; }
  else { alive = fly.alive && fly.obj.visible; pos = fly.pos; radius = 0.25; }
  if (!pos) { arrow.classList.add('hidden'); bracket.classList.add('hidden'); crosshair.classList.remove('lock'); $('distVal').textContent = duel ? 'no rivals' : '–'; return; }
  const dist = pos.distanceTo(camera.position);
  const aimed = alive && camFwd.angleTo(tmpV.copy(pos).sub(camera.position)) < Math.atan((duel ? AV_R : 0.45) / dist);
  $('distVal').textContent = alive ? `${dist.toFixed(1)} m` : (duel ? '–' : 'splat!');
  $('dist').firstChild.textContent = duel ? '⚔️ ' : '🪰 ';
  const s = toScreen(pos);
  crosshair.classList.toggle('lock', aimed);
  if (alive && s.on) {
    arrow.classList.add('hidden');
    if (scopeVis > 0.5) { bracket.classList.add('hidden'); return; }
    const px = clamp(Math.atan(radius / dist) / (camera.fov * DEG / 2) * innerHeight, 30, 260);
    bracket.classList.remove('hidden'); bracket.classList.toggle('lock', aimed);
    bracket.style.width = bracket.style.height = px + 'px'; bracket.style.left = s.x + 'px'; bracket.style.top = s.y + 'px';
  } else {
    bracket.classList.add('hidden');
    if (!alive) { arrow.classList.add('hidden'); return; }
    invQ.copy(camera.quaternion).invert();
    const c = tmpV.copy(pos).sub(camera.position).applyQuaternion(invQ);
    let x = c.x, y = c.y; if (Math.hypot(x, y) < 1e-3) { x = 0; y = -1; }
    const cx = innerWidth / 2, cy = innerHeight / 2, m = 46;
    const k = Math.min((cx - m) / Math.max(Math.abs(x), 1e-6), (cy - m - 30) / Math.max(Math.abs(y), 1e-6));
    const px = cx + x * k, py = cy - y * k, ang = Math.atan2(-y, x);
    arrow.classList.remove('hidden');
    arrow.style.transform = `translate(${px}px,${py}px)`; tri.style.transform = `rotate(${ang}rad)`;
    arrowDist.style.left = (-Math.cos(ang) * 46) + 'px'; arrowDist.style.top = (-Math.sin(ang) * 40) + 'px';
    arrowDist.textContent = `${dist.toFixed(1)} m`;
  }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let feedTimer = 0, uiTimer = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  feedTimer += dt; if (feedTimer > 0.25) { feedTimer = 0; sampleFeed(); }
  applyLights(dt);
  const duel = gameMode() === 'duel';
  if (duel) { const me = mp.players.get(mp.myId); if (me) arenaPos(me.slot, hostNow(), camera.position); } else camera.position.set(0, 0, 0);
  updateCameraOrientation();
  if (state === 'playing') {
    if (mp.on) timeLeft = Math.max(0, mp.roundEnd - hostNow());
    else { elapsed += dt; timeLeft = Math.max(0, ROUND - elapsed); }
    const sec = Math.ceil(timeLeft);
    if (sec <= 5 && sec !== lastTick && sec > 0) { lastTick = sec; sfx.tick(); }
    if (triggerHeld && WEAPONS[weaponId].auto) tryFire();
    if (!mp.on && timeLeft <= 0) endSoloRound();
  }
  updateHud();
  if (!mp.on || mp.host) updateFly(dt, t); else updateFlyReplica(dt, t);
  if (duel) fly.obj.visible = false;
  if (mp.on && mp.net) { if (mp.host) hostTick(dt); else clientTick(dt); }
  updateAvatars(dt, hostNow());
  updateViewmodel(dt, t); updateShells(dt); updateDarts(dt); updateSplat(dt); updateBuzz(); updateIndicators();
  uiTimer += dt; if (uiTimer > 0.5 && mp.on) { uiTimer = 0; renderPlayersUi(); }
  renderer.clear();
  renderer.render(scene, camera);
  if (scopeVis < 0.98) { renderer.clearDepth(); renderer.render(vmScene, vmCam); }
}
onResize(); zoomUi(); updateAmmo();
frame();
// small hook for automated testing / debugging in the console
window.flyHunt = { fly, camera, mp, vm, WEAPONS, arenaPos, hostNow, avatars, get state() { return state; }, get score() { return score; }, get weapon() { return weaponId; }, fireNow: () => { lastShot = 0; tryFire(); }, lookAt: (p) => { const d = p.clone().sub(camera.position).normalize(); yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(d.y); }, setAds, startReload, selectWeapon };
