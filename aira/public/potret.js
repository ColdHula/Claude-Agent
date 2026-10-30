// Potret Hidup: foto wajah realistis (mis. hasil AI) dianimasikan langsung di browser.
// MediaPipe menemukan 478 titik wajah di foto, lalu sebuah grid rapat di atas foto dibengkokkan
// di vertex shader: kedip, buka mulut (dengan rongga mulut & gigi), senyum, alis, dan gerak kepala 3D semu.
// Semua bobot dihitung sekali per foto; tiap frame hanya mengubah beberapa uniform (ringan untuk HP).
import * as THREE from "three";
import { FilesetResolver, FaceLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
let pendeteksi = null;
async function deteksi(img) {
  if (!pendeteksi) {
    const fs = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
    pendeteksi = await FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "IMAGE", numFaces: 1,
    });
  }
  const r = pendeteksi.detect(img);
  return r.faceLandmarks?.[0] || null;
}

// Indeks titik MediaPipe Face Mesh
const BIBIR_ATAS_DALAM = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const BIBIR_BAWAH_DALAM = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const MATA = [
  { atas: [33, 246, 161, 160, 159, 158, 157, 173, 133], bawah: [33, 7, 163, 144, 145, 153, 154, 155, 133] },
  { atas: [362, 398, 384, 385, 386, 387, 388, 466, 263], bawah: [362, 382, 381, 380, 374, 373, 390, 249, 263] },
];
const ALIS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6))); return t * t * (3 - 2 * t); };
const gauss = (d, s) => Math.exp(-(d * d) / (2 * s * s));
// Interpolasi y pada polyline (titik terurut menurut x)
function yPada(poly, x) {
  if (x <= poly[0][0]) return poly[0][1];
  for (let i = 1; i < poly.length; i++) if (x <= poly[i][0]) {
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1e-6));
  }
  return poly[poly.length - 1][1];
}

// Hitung medan perpindahan (dalam koordinat gambar ternormalisasi: u ke kanan, v ke bawah; v diskalakan
// dengan rasio agar jarak sama di kedua sumbu: px = u*aspek, py = v).
function buatMedan(L, aspek) {
  const P = (i) => [L[i].x * aspek, L[i].y];
  const urut = (ids) => ids.map(P).sort((a, b) => a[0] - b[0]);
  const oval = OVAL.map(P);
  const minX = Math.min(...oval.map((p) => p[0])), maxX = Math.max(...oval.map((p) => p[0]));
  const minY = Math.min(...oval.map((p) => p[1])), maxY = Math.max(...oval.map((p) => p[1]));
  const lebarWajah = maxX - minX, tinggiWajah = maxY - minY;
  const pusat = [(minX + maxX) / 2, (minY + maxY) / 2];
  const dagu = P(152), hidung = P(1);
  const atas = urut(BIBIR_ATAS_DALAM), bawah = urut(BIBIR_BAWAH_DALAM);
  const garisBibir = atas.map((p, i) => [p[0], (p[1] + yPada(bawah, p[0])) / 2]);
  const sudutKiri = P(61), sudutKanan = P(291);
  const lebarMulut = Math.hypot(sudutKanan[0] - sudutKiri[0], sudutKanan[1] - sudutKiri[1]);
  const tengahMulut = [(sudutKiri[0] + sudutKanan[0]) / 2, (sudutKiri[1] + sudutKanan[1]) / 2];
  const mata = MATA.map((m) => {
    const a = urut(m.atas), b = urut(m.bawah);
    const gap = Math.max(...a.map((p) => yPada(b, p[0]) - p[1]));
    return { a, b, gap: Math.max(gap, 0.004), x0: a[0][0], x1: a[a.length - 1][0] };
  });
  const alis = ALIS.map(P);
  const J = lebarMulut * 0.5;    // bukaan rahang penuh
  const rx = lebarWajah * 0.62, ry = tinggiWajah * 0.62;

  return {
    pusat, lebarWajah, tinggiWajah, lebarMulut, atas, bawah, J, dagu, minX, maxX, minY, maxY,
    hitung(x, y) {
      const o = { jaw: [0, 0], senyum: [0, 0], kedip: 0, alis: 0, kepala: 0, dalam: 0 };
      // Rahang: hanya titik di bawah garis bibir; tajam di dalam mulut, halus di luar
      const dx = x - tengahMulut[0];
      const setengah = lebarMulut / 2;
      const luar = Math.max(0, Math.abs(dx) - setengah);
      const h = luar * 0.9 + 1e-4;
      const yGaris = yPada(garisBibir, Math.min(Math.max(x, garisBibir[0][0]), garisBibir[garisBibir.length - 1][0]));
      const bawahGaris = smooth(yGaris - h, yGaris + h, y);
      const kebawah = y > dagu[1] ? gauss(y - dagu[1], tinggiWajah * 0.12) : 1;
      const wJ = bawahGaris * gauss(dx, lebarWajah * 0.33) * kebawah * gauss(luar, lebarWajah * 0.18 + 1e-6);
      o.jaw = [0, J * wJ];
      // Senyum: sudut bibir ke luar & ke atas, pipi ikut naik sedikit
      for (const [s, c] of [[-1, sudutKiri], [1, sudutKanan]]) {
        const w = gauss(Math.hypot(x - c[0], y - c[1]), lebarMulut * 0.3);
        o.senyum[0] += s * lebarMulut * 0.07 * w;
        o.senyum[1] += -lebarMulut * 0.06 * w;
        const wp = gauss(Math.hypot(x - (c[0] + s * lebarMulut * 0.25), y - (c[1] - lebarMulut * 0.45)), lebarMulut * 0.4);
        o.senyum[1] += -lebarMulut * 0.03 * wp;
      }
      // Kedip: kelopak atas turun menutup mata; kulit di atasnya ikut tertarik
      for (const m of mata) {
        const xm = Math.min(Math.max(x, m.x0), m.x1);
        const ya = yPada(m.a, xm), yb = yPada(m.b, xm);
        const tepi = smooth(m.x0 - m.gap * 1.2, m.x0 + m.gap * 0.6, x) * (1 - smooth(m.x1 - m.gap * 0.6, m.x1 + m.gap * 1.2, x));
        if (tepi <= 0) continue;
        const target = yb - (yb - ya) * 0.12;
        let d = 0;
        if (y >= ya && y <= yb) d = (target - y) * Math.min(1, (yb - y) / Math.max(yb - ya, 1e-6) * 1.15);
        else if (y < ya) d = (target - ya) * gauss(ya - y, m.gap * 0.55);
        o.kedip += d * tepi;
      }
      // Alis naik/turun
      let wa = 0;
      for (const p of alis) wa = Math.max(wa, gauss(Math.hypot(x - p[0], y - p[1]), lebarWajah * 0.09));
      o.alis = -tinggiWajah * 0.035 * wa;
      // Kepala: 1 di dalam elips kepala (termasuk rambut), 0 di bahu
      const ex = (x - pusat[0]) / (rx * 1.25), ey = (y - (pusat[1] - tinggiWajah * 0.1)) / (ry * 1.35);
      const r = Math.hypot(ex, ey);
      o.kepala = (1 - smooth(1.0, 1.75, r)) * (1 - smooth(dagu[1] + tinggiWajah * 0.08, dagu[1] + tinggiWajah * 0.45, y));
      // Kedalaman semu (bola + hidung) untuk paralaks saat menoleh
      const bx = (x - pusat[0]) / rx, by = (y - pusat[1]) / ry;
      o.dalam = Math.sqrt(Math.max(0, 1 - bx * bx - by * by)) + 0.6 * gauss(Math.hypot(x - hidung[0], y - hidung[1]), lebarWajah * 0.12);
      return o;
    },
  };
}

const VERT = /* glsl */`
attribute vec2 dJaw; attribute vec2 dSenyum; attribute float dKedip; attribute float dAlis; attribute float wKepala; attribute float dalam;
uniform float jaw, senyum, kedip, alisU, yaw, pitch, roll, aspek; uniform vec2 geser, pivot;
varying vec2 vUv;
vec2 ubah(vec2 p){ // p dalam (px, py) gambar: py ke bawah
  vec2 d = dJaw * jaw + dSenyum * senyum + vec2(0.0, dKedip * kedip + dAlis * alisU);
  vec2 q = p + d;
  vec2 r = q - pivot; float a = roll * wKepala;
  q = pivot + vec2(r.x * cos(a) - r.y * sin(a), r.x * sin(a) + r.y * cos(a));
  q += wKepala * (geser + dalam * vec2(yaw, pitch) * 0.02);
  return q;
}
void main(){
  vUv = uv;
  vec2 p = vec2(uv.x * aspek, 1.0 - uv.y);
  vec2 q = ubah(p);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q.x - aspek * 0.5, 0.5 - q.y, 0.0, 1.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D peta; varying vec2 vUv;
void main(){ gl_FragColor = texture2D(peta, vUv);
  #include <colorspace_fragment>
}`;

export async function muatPotret(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const img = tex.image;
  const aspek = img.width / img.height;
  const kunci = `aira-lm:${url}:${img.width}x${img.height}`;
  let L = null;
  try { L = JSON.parse(localStorage.getItem(kunci)); } catch {}
  if (!L) {
    L = await deteksi(img);
    if (!L) throw new Error("Wajah tidak terdeteksi di foto. Pakai foto wajah menghadap depan.");
    L = L.map((p) => ({ x: +p.x.toFixed(5), y: +p.y.toFixed(5) }));
    try { localStorage.setItem(kunci, JSON.stringify(L)); } catch {}
  }
  const medan = buatMedan(L, aspek);

  // Grid adaptif: rapat di sekitar kepala (sel ≤ 1/30 lebar mulut), jarang di badan & latar.
  // Dengan begitu foto seluruh badan pun bibir & kelopak matanya tetap bergerak halus.
  const sumbu = (a, b, sel, nLuar) => {
    a = Math.max(0, a); b = Math.min(1, b);
    const out = new Set([0, 1]);
    const nKiri = Math.max(1, Math.round(nLuar * a)), nKanan = Math.max(1, Math.round(nLuar * (1 - b)));
    const nDalam = Math.min(420, Math.max(40, Math.ceil((b - a) / sel)));
    for (let i = 0; i <= nKiri; i++) out.add(a * i / nKiri);
    for (let i = 0; i <= nDalam; i++) out.add(a + (b - a) * i / nDalam);
    for (let i = 0; i <= nKanan; i++) out.add(b + (1 - b) * i / nKanan);
    return [...out].sort((x, y) => x - y);
  };
  const sel = medan.lebarMulut / 30; // dalam satuan tinggi gambar
  const mx = medan.lebarWajah * 0.9, my = medan.tinggiWajah * 0.9;
  const us = sumbu((medan.minX - mx) / aspek, (medan.maxX + mx) / aspek, sel / aspek, 70);
  const vs = sumbu(medan.minY - my, medan.maxY + my * 0.6, sel, 90);
  const nU = us.length, nV = vs.length, n = nU * nV;
  const posArr = new Float32Array(n * 3), uvArr = new Float32Array(n * 2), indeks = [];
  for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
    const k = j * nU + i;
    uvArr[k * 2] = us[i]; uvArr[k * 2 + 1] = 1 - vs[j];
    if (i < nU - 1 && j < nV - 1) { const a = k, b = k + 1, c = k + nU, d = k + nU + 1; indeks.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(indeks, 1) : new THREE.Uint16BufferAttribute(indeks, 1));
  const uv = uvArr;
  const aJaw = new Float32Array(n * 2), aSen = new Float32Array(n * 2), aKed = new Float32Array(n), aAl = new Float32Array(n), aKep = new Float32Array(n), aDal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = uv[i * 2] * aspek, y = 1 - uv[i * 2 + 1];
    const o = medan.hitung(x, y);
    aJaw[i * 2] = o.jaw[0]; aJaw[i * 2 + 1] = o.jaw[1];
    aSen[i * 2] = o.senyum[0]; aSen[i * 2 + 1] = o.senyum[1];
    aKed[i] = o.kedip; aAl[i] = o.alis; aKep[i] = o.kepala; aDal[i] = o.dalam;
  }
  g.setAttribute("dJaw", new THREE.BufferAttribute(aJaw, 2));
  g.setAttribute("dSenyum", new THREE.BufferAttribute(aSen, 2));
  g.setAttribute("dKedip", new THREE.BufferAttribute(aKed, 1));
  g.setAttribute("dAlis", new THREE.BufferAttribute(aAl, 1));
  g.setAttribute("wKepala", new THREE.BufferAttribute(aKep, 1));
  g.setAttribute("dalam", new THREE.BufferAttribute(aDal, 1));
  const U = {
    peta: { value: tex }, jaw: { value: 0 }, senyum: { value: 0 }, kedip: { value: 0 }, alisU: { value: 0 },
    yaw: { value: 0 }, pitch: { value: 0 }, roll: { value: 0 }, aspek: { value: aspek },
    geser: { value: new THREE.Vector2() }, pivot: { value: new THREE.Vector2(medan.pusat[0], medan.dagu[1]) },
  };
  const foto = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false }));
  foto.frustumCulled = false;

  // Rongga mulut + gigi (digambar di atas foto, di celah antara bibir atas & bawah)
  const nA = medan.atas.length;
  const posMulut = new Float32Array(nA * 2 * 3), posGigi = new Float32Array(nA * 2 * 3);
  const idx = [];
  for (let i = 0; i < nA - 1; i++) { const a = i, b = i + 1, c = nA + i, d = nA + i + 1; idx.push(a, c, b, b, c, d); }
  const mk = (pos, warna, ro) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: warna, toneMapped: false, transparent: true, depthTest: false }));
    m.renderOrder = ro; m.frustumCulled = false;
    return m;
  };
  const rongga = mk(posMulut, 0x3a1216, 1), gigi = mk(posGigi, 0xece6df, 2);
  const root = new THREE.Group();
  root.add(foto, rongga, gigi);

  // Versi CPU dari shader untuk titik bibir (agar rongga mengikuti bibir)
  const keDunia = (x, y, o, s) => {
    let qx = x + o.jaw[0] * s.jaw + o.senyum[0] * s.senyum, qy = y + o.jaw[1] * s.jaw + o.senyum[1] * s.senyum + o.kedip * s.kedip + o.alis * s.alis;
    const px = medan.pusat[0], py = medan.dagu[1], a = s.roll * o.kepala, rx = qx - px, ry = qy - py;
    qx = px + rx * Math.cos(a) - ry * Math.sin(a); qy = py + rx * Math.sin(a) + ry * Math.cos(a);
    qx += o.kepala * (s.geser.x + o.dalam * s.yaw * 0.02); qy += o.kepala * (s.geser.y + o.dalam * s.pitch * 0.02);
    return [qx - aspek / 2, 0.5 - qy];
  };
  const bibirAtas = medan.atas.map(([x, y]) => [x, y, medan.hitung(x, y - 0.0015)]);
  const bibirBawah = medan.atas.map(([x]) => { const y = yPada(medan.bawah, x); return [x, y, medan.hitung(x, y + 0.0015)]; });

  const kini = { jaw: 0, senyum: 0, kedip: 0, alis: 0, yaw: 0, pitch: 0, roll: 0 };
  const tujuEkspresi = {
    neutral: {}, happy: { senyum: 1, kedip: 0.18, alis: 0.15 }, sad: { senyum: -0.7, alis: 0.55, kedip: 0.12 },
    angry: { alis: -0.9, kedip: 0.22, senyum: -0.25 }, surprised: { alis: 1, kedip: -0.35, jaw: 0.25 },
    relaxed: { senyum: 0.45, kedip: 0.1 }, shy: { senyum: 0.6, kedip: 0.2, roll: 0.05 },
  };
  const lerp = (a, b, k) => a + (b - a) * k;

  return {
    root,
    datar: true,
    aspek,
    fokusWajah: { x: medan.pusat[0] - aspek / 2, y: 0.5 - medan.pusat[1], h: medan.tinggiWajah },
    // Kerangka tampilan (koordinat dunia; tinggi foto = 1)
    tampilan(mode) {
      const f = this.fokusWajah;
      if (mode === "wajah") return { x: f.x, y: f.y + f.h * 0.05, h: Math.min(1, f.h * 2.6) };
      if (mode === "setengah") { const h = Math.min(1, f.h * 6); return { x: f.x, y: f.y + f.h * 1.3 - h / 2, h }; }
      return { x: 0, y: 0, h: 1 };
    },
    posisiKepala: (out) => out.set(medan.pusat[0] - aspek / 2, 0.5 - medan.pusat[1], 0),
    buang: () => { tex.dispose(); g.dispose(); },
    perbarui({ dt, t, panggung: P, kedip, gerak }) {
      const e = tujuEkspresi[P.ekspresi] || {};
      const k = Math.min(1, dt * 9);
      const vis = P.viseme;
      const bicaraJaw = P.mulut * (vis === "aa" ? 1 : vis === "o" ? 0.8 : vis === "e" ? 0.6 : 0.45);
      kini.jaw = lerp(kini.jaw, Math.max(e.jaw || 0, bicaraJaw), Math.min(1, dt * 20));
      kini.senyum = lerp(kini.senyum, (e.senyum || 0) * (1 - P.mulut * 0.4) + (vis === "o" || vis === "u" ? -0.35 * P.mulut : 0) + (vis === "e" || vis === "i" ? 0.25 * P.mulut : 0), k);
      kini.alis = lerp(kini.alis, (e.alis || 0) + (P.berpikir ? 0.3 : 0), k);
      const kd = Math.max(kedip, 0);
      kini.kedip = kd > 0.05 ? Math.max(kd, e.kedip || 0) : lerp(kini.kedip, e.kedip || 0, k);
      // Kepala: ikuti wajah pengguna (kamera) + goyang halus + aksi
      const ot = P.offsetTatap;
      const tYaw = ot.x * 0.6 + Math.sin(t * 0.45) * 0.12 + (P.berpikir ? 0.35 : 0) + gerak.geleng * 4;
      const tPitch = -ot.y * 0.4 + Math.sin(t * 0.7) * 0.06 + (P.berpikir ? -0.25 : 0) + gerak.angguk * 4;
      kini.yaw = lerp(kini.yaw, tYaw, Math.min(1, dt * 4));
      kini.pitch = lerp(kini.pitch, tPitch, Math.min(1, dt * 4));
      kini.roll = lerp(kini.roll, (e.roll || 0) + gerak.miring * 0.6 + Math.sin(t * 0.33) * 0.012, Math.min(1, dt * 4));
      const napas = Math.sin(t * 1.3) * 0.0015;
      const s = { ...kini, geser: new THREE.Vector2(kini.yaw * 0.004, kini.pitch * 0.004 + napas) };
      U.jaw.value = s.jaw; U.senyum.value = s.senyum; U.kedip.value = s.kedip; U.alisU.value = s.alis;
      U.yaw.value = s.yaw; U.pitch.value = s.pitch; U.roll.value = s.roll; U.geser.value.copy(s.geser);
      // Rongga & gigi
      const buka = s.jaw > 0.04;
      rongga.visible = gigi.visible = buka;
      if (buka) {
        for (let i = 0; i < nA; i++) {
          const [ax, ay, ao] = bibirAtas[i], [bx, by, bo] = bibirBawah[i];
          const A = keDunia(ax, ay, ao, s), B = keDunia(bx, by, bo, s);
          posMulut.set([A[0], A[1], 0.001], i * 3); posMulut.set([B[0], B[1], 0.001], (nA + i) * 3);
          const tinggiGigi = Math.min((A[1] - B[1]) * 0.26, medan.lebarMulut * 0.055);
          const lengkung = 1 - Math.pow((i / (nA - 1)) * 2 - 1, 2); // gigi hanya di tengah
          posGigi.set([A[0], A[1], 0.002], i * 3); posGigi.set([A[0], A[1] - tinggiGigi * lengkung, 0.002], (nA + i) * 3);
        }
        rongga.geometry.attributes.position.needsUpdate = true;
        gigi.geometry.attributes.position.needsUpdate = true;
      }
    },
  };
}
