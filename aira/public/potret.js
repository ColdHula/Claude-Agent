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
  const J = lebarMulut * 0.42;   // bukaan rahang penuh
  // Iris (titik 468 & 473 = pusat iris; 469 = tepi) untuk lirikan mata
  const iris = L.length > 477 ? [468, 473].map((c) => ({ c: P(c), r: Math.max(Math.hypot(P(c + 1)[0] - P(c)[0], P(c + 1)[1] - P(c)[1]), 0.003) })) : [];
  const rx = lebarWajah * 0.62, ry = tinggiWajah * 0.62;

  return {
    pusat, lebarWajah, tinggiWajah, lebarMulut, atas, bawah, J, dagu, minX, maxX, minY, maxY,
    hitung(x, y) {
      const o = { jaw: [0, 0], senyum: [0, 0], kedip: 0, alis: 0, kepala: 0, dalam: 0, lirik: [0, 0], bahu: 0 };
      // Rahang: hanya titik di bawah garis bibir; tajam di dalam mulut, halus di luar
      const dx = x - tengahMulut[0];
      const setengah = lebarMulut / 2;
      const luar = Math.max(0, Math.abs(dx) - setengah);
      const h = luar * 0.9 + 1e-4;
      const yGaris = yPada(garisBibir, Math.min(Math.max(x, garisBibir[0][0]), garisBibir[garisBibir.length - 1][0]));
      const bawahGaris = smooth(yGaris - h, yGaris + h, y);
      const kebawah = y > dagu[1] ? gauss(y - dagu[1], tinggiWajah * 0.12) : 1;
      const lensa = Math.pow(Math.max(0, 1 - (dx / setengah) ** 2), 0.7); // 1 di tengah, 0 di sudut bibir
      const tebalBibir = lebarMulut * 0.2;
      const bentuk = luar > 0 ? 0 : lensa + (1 - lensa) * smooth(0, tebalBibir * 1.6, y - yGaris);
      const wJ = bawahGaris * gauss(dx, lebarWajah * 0.33) * kebawah * gauss(luar, lebarWajah * 0.18 + 1e-6) * (luar > 0 ? smooth(0, tebalBibir * 1.6, y - yGaris) * 0.7 + 0.3 * gauss(luar, lebarMulut * 0.2) : bentuk);
      o.jaw = [0, J * wJ];
      // Bibir atas sedikit terangkat saat mulut terbuka (lebih alami daripada hanya rahang turun)
      if (!bawahGaris || bawahGaris < 0.5) {
        const di = Math.abs(dx) < setengah ? 1 : gauss(luar, lebarMulut * 0.12);
        o.jaw[1] += -J * 0.14 * di * gauss(yGaris - y, lebarMulut * 0.16) * (1 - bawahGaris);
      }
      // Senyum: sudut bibir ke luar & ke atas, pipi ikut naik sedikit
      for (const [s, c] of [[-1, sudutKiri], [1, sudutKanan]]) {
        const w = gauss(Math.hypot(x - c[0], y - c[1]), lebarMulut * 0.3);
        o.senyum[0] += s * lebarMulut * 0.07 * w;
        o.senyum[1] += -lebarMulut * 0.06 * w;
        const wp = gauss(Math.hypot(x - (c[0] + s * lebarMulut * 0.25), y - (c[1] - lebarMulut * 0.45)), lebarMulut * 0.4);
        o.senyum[1] += -lebarMulut * 0.03 * wp;
      }
      // Senyum tulus: kelopak bawah ikut naik sedikit (mata "tersenyum")
      for (const m of mata) {
        const xm = Math.min(Math.max(x, m.x0), m.x1), yb = yPada(m.b, xm);
        const tepi = smooth(m.x0 - m.gap, m.x0 + m.gap, x) * (1 - smooth(m.x1 - m.gap, m.x1 + m.gap, x));
        o.senyum[1] += -m.gap * 0.22 * tepi * gauss(y - yb, m.gap * 0.7) * (y > yPada(m.a, xm) ? 1 : 0.3);
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
      // Lirik: area iris bergeser di dalam bukaan mata (kelopak tetap)
      for (let k = 0; k < iris.length; k++) {
        const m = mata.find((e) => iris[k].c[0] >= e.x0 && iris[k].c[0] <= e.x1) || mata[k];
        const xm = Math.min(Math.max(x, m.x0), m.x1), ya = yPada(m.a, xm), yb = yPada(m.b, xm);
        const dalamMata = smooth(ya - m.gap * 0.1, ya + m.gap * 0.25, y) * (1 - smooth(yb - m.gap * 0.25, yb + m.gap * 0.1, y))
          * smooth(m.x0, m.x0 + m.gap * 0.5, x) * (1 - smooth(m.x1 - m.gap * 0.5, m.x1, x));
        const w = gauss(Math.hypot(x - iris[k].c[0], y - iris[k].c[1]), iris[k].r * 1.15) * dalamMata;
        o.lirik[0] += w * iris[k].r * 0.55; o.lirik[1] += w * iris[k].r * 0.3;
      }
      // Bahu & dada naik-turun saat bernapas
      o.bahu = -0.004 * smooth(dagu[1] + tinggiWajah * 0.2, dagu[1] + tinggiWajah * 0.6, y) * (1 - smooth(dagu[1] + tinggiWajah * 1.6, dagu[1] + tinggiWajah * 3, y));
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
attribute vec2 dLirik; attribute float dBahu;
uniform float jaw, senyum, kedip, alisU, yaw, pitch, roll, aspek, napas; uniform vec2 geser, pivot, lirik;
varying vec2 vUv;
vec2 ubah(vec2 p){ // p dalam (px, py) gambar: py ke bawah
  vec2 d = dJaw * jaw + dSenyum * senyum + vec2(0.0, dKedip * kedip + dAlis * alisU + dBahu * napas) + dLirik * lirik * (1.0 - clamp(kedip, 0.0, 1.0));
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
  const aLir = new Float32Array(n * 2), aBah = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = uv[i * 2] * aspek, y = 1 - uv[i * 2 + 1];
    const o = medan.hitung(x, y);
    aJaw[i * 2] = o.jaw[0]; aJaw[i * 2 + 1] = o.jaw[1];
    aSen[i * 2] = o.senyum[0]; aSen[i * 2 + 1] = o.senyum[1];
    aKed[i] = o.kedip; aAl[i] = o.alis; aKep[i] = o.kepala; aDal[i] = o.dalam;
    aLir[i * 2] = o.lirik[0]; aLir[i * 2 + 1] = o.lirik[1]; aBah[i] = o.bahu;
  }
  g.setAttribute("dLirik", new THREE.BufferAttribute(aLir, 2));
  g.setAttribute("dBahu", new THREE.BufferAttribute(aBah, 1));
  g.setAttribute("dJaw", new THREE.BufferAttribute(aJaw, 2));
  g.setAttribute("dSenyum", new THREE.BufferAttribute(aSen, 2));
  g.setAttribute("dKedip", new THREE.BufferAttribute(aKed, 1));
  g.setAttribute("dAlis", new THREE.BufferAttribute(aAl, 1));
  g.setAttribute("wKepala", new THREE.BufferAttribute(aKep, 1));
  g.setAttribute("dalam", new THREE.BufferAttribute(aDal, 1));
  const U = {
    peta: { value: tex }, jaw: { value: 0 }, senyum: { value: 0 }, kedip: { value: 0 }, alisU: { value: 0 },
    yaw: { value: 0 }, pitch: { value: 0 }, roll: { value: 0 }, aspek: { value: aspek }, napas: { value: 0 }, lirik: { value: new THREE.Vector2() },
    geser: { value: new THREE.Vector2() }, pivot: { value: new THREE.Vector2(medan.pusat[0], medan.dagu[1]) },
  };
  const foto = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false }));
  foto.frustumCulled = false;

  // Rongga mulut + gigi atas: digambar di celah antara bibir, dengan gradasi dan tepi lembut
  // (aT: 0 = bibir atas → 1 = bibir bawah, aS: 0..1 dari sudut ke sudut)
  const nA = medan.atas.length;
  const posMulut = new Float32Array(nA * 2 * 3), posGigi = new Float32Array(nA * 2 * 3);
  const aT = new Float32Array(nA * 2), aS = new Float32Array(nA * 2);
  for (let i = 0; i < nA; i++) { aS[i] = aS[nA + i] = i / (nA - 1); aT[i] = 0; aT[nA + i] = 1; }
  const idx = [];
  for (let i = 0; i < nA - 1; i++) { const a = i, b = i + 1, c = nA + i, d = nA + i + 1; idx.push(a, c, b, b, c, d); }
  const VM = `attribute float aT; attribute float aS; varying float vT; varying float vS;
    void main(){ vT = aT; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const FM_RONGGA = `uniform float buka; varying float vT; varying float vS;
    void main(){
      float tengah = 1.0 - abs(vS * 2.0 - 1.0);
      vec3 gelap = vec3(0.17, 0.06, 0.07), merah = vec3(0.45, 0.20, 0.21), lidah = vec3(0.62, 0.30, 0.31);
      vec3 c = mix(merah, gelap, smoothstep(0.0, 0.35, vT) * smoothstep(0.0, 0.5, tengah));
      c = mix(c, lidah * 0.75, smoothstep(0.55, 1.0, vT) * smoothstep(0.2, 0.8, tengah) * smoothstep(0.3, 0.9, buka));
      float a = smoothstep(0.0, 0.18, vS) * smoothstep(1.0, 0.82, vS);
      gl_FragColor = vec4(c, a);
    }`;
  const FM_GIGI = `uniform float gigiAda; varying float vT; varying float vS;
    void main(){
      float tengah = 1.0 - abs(vS * 2.0 - 1.0);
      vec3 c = mix(vec3(0.80, 0.75, 0.71), vec3(0.50, 0.40, 0.39), smoothstep(0.3, 1.0, vT) + (1.0 - smoothstep(0.15, 0.6, tengah)) * 0.6);
      float a = smoothstep(0.15, 0.55, tengah) * (1.0 - smoothstep(0.35, 1.0, vT)) * smoothstep(0.0, 0.12, vT + 0.06) * 0.7 * gigiAda;
      gl_FragColor = vec4(c, a);
    }`;
  const Um = { buka: { value: 0 }, gigiAda: { value: 0 } };
  const mk = (pos, frag, ro) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geo.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: Um, vertexShader: VM, fragmentShader: frag, transparent: true, depthTest: false, toneMapped: false }));
    m.renderOrder = ro; m.frustumCulled = false;
    return m;
  };
  const rongga = mk(posMulut, FM_RONGGA, 1), gigi = mk(posGigi, FM_GIGI, 2);
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
  const lirik = { x: 0, y: 0, tx: 0, ty: 0, timer: 2 };
  const tujuEkspresi = {
    neutral: {}, happy: { senyum: 0.8, kedip: 0.1, alis: 0.12 }, sad: { senyum: -0.7, alis: 0.55, kedip: 0.12 },
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
      const k = Math.min(1, dt * 7);
      const vis = P.viseme, m = P.mulut;
      // Bentuk mulut per bunyi: aa lebar terbuka, o/u membulat, e/i melebar dengan bukaan kecil
      const bukaVis = { aa: 0.75, o: 0.6, u: 0.4, e: 0.45, i: 0.3 }[vis] ?? 0.5;
      const lebarVis = { aa: 0, o: -0.45, u: -0.6, e: 0.3, i: 0.35 }[vis] ?? 0;
      kini.jaw = lerp(kini.jaw, Math.max(e.jaw || 0, m * bukaVis), Math.min(1, dt * 16));
      kini.senyum = lerp(kini.senyum, (e.senyum || 0) * (1 - m * 0.35) + lebarVis * m * 0.6, Math.min(1, dt * 12));
      kini.alis = lerp(kini.alis, (e.alis || 0) + (P.berpikir ? 0.3 : 0) + (P.bicara ? 0.12 * Math.max(0, Math.sin(t * 2.3)) ** 6 : 0), k);
      const kd = Math.max(kedip, 0);
      kini.kedip = kd > 0.05 ? Math.max(kd, e.kedip || 0) : lerp(kini.kedip, e.kedip || 0, k);
      // Lirikan mata: sebagian besar menatap pengguna, sesekali melirik kecil lalu kembali
      lirik.timer -= dt;
      if (lirik.timer <= 0) {
        const jauh = P.berpikir ? 1 : Math.random() < 0.35 ? 0.55 : 0.15;
        lirik.tx = (Math.random() * 2 - 1) * jauh; lirik.ty = (Math.random() * 2 - 1) * jauh * 0.5 - (P.berpikir ? 0.6 : 0);
        lirik.timer = P.berpikir ? 0.8 + Math.random() : 1.2 + Math.random() * 2.8;
        if (!P.berpikir && Math.random() < 0.55) { lirik.tx = 0; lirik.ty = 0; }
      }
      const ot = P.offsetTatap;
      const gx = THREE.MathUtils.clamp(lirik.tx + ot.x * 0.7, -1, 1), gy = THREE.MathUtils.clamp(lirik.ty - ot.y * 0.5, -1, 1);
      lirik.x = lerp(lirik.x, gx, Math.min(1, dt * 22)); lirik.y = lerp(lirik.y, gy, Math.min(1, dt * 22)); // saccade cepat
      // Kepala: ikuti wajah pengguna + goyang halus berlapis + angguk kecil saat bicara
      const goyang = Math.sin(t * 0.41) * 0.08 + Math.sin(t * 0.97 + 1.3) * 0.04;
      const tYaw = ot.x * 0.5 + goyang + (P.berpikir ? 0.3 : 0) + gerak.geleng * 4 + lirik.x * 0.08;
      const tPitch = -ot.y * 0.35 + Math.sin(t * 0.63) * 0.05 + (P.berpikir ? -0.2 : 0) + gerak.angguk * 4 + (P.bicara ? m * 0.12 : 0);
      kini.yaw = lerp(kini.yaw, tYaw, Math.min(1, dt * 3));
      kini.pitch = lerp(kini.pitch, tPitch, Math.min(1, dt * 3));
      kini.roll = lerp(kini.roll, (e.roll || 0) + gerak.miring * 0.6 + Math.sin(t * 0.33) * 0.012, Math.min(1, dt * 3));
      const s = { ...kini, geser: new THREE.Vector2(kini.yaw * 0.003, kini.pitch * 0.003) };
      U.jaw.value = s.jaw; U.senyum.value = s.senyum; U.kedip.value = s.kedip; U.alisU.value = s.alis;
      U.yaw.value = s.yaw; U.pitch.value = s.pitch; U.roll.value = s.roll; U.geser.value.copy(s.geser);
      U.lirik.value.set(lirik.x, lirik.y); U.napas.value = Math.sin(t * 1.35);
      // Rongga & gigi mengikuti bibir
      const buka = s.jaw > 0.03;
      rongga.visible = gigi.visible = buka;
      if (buka) {
        Um.buka.value = Math.min(1, s.jaw / 0.6);
        Um.gigiAda.value = THREE.MathUtils.smoothstep(s.jaw, 0.25, 0.5);
        for (let i = 0; i < nA; i++) {
          const [ax, ay, ao] = bibirAtas[i], [bx, by, bo] = bibirBawah[i];
          const A = keDunia(ax, ay, ao, s), B = keDunia(bx, by, bo, s);
          posMulut.set([A[0], A[1], 0.001], i * 3); posMulut.set([B[0], B[1], 0.001], (nA + i) * 3);
          const tinggiGigi = Math.min((A[1] - B[1]) * 0.4, medan.lebarMulut * 0.075);
          posGigi.set([A[0], A[1], 0.002], i * 3); posGigi.set([A[0], A[1] - tinggiGigi, 0.002], (nA + i) * 3);
        }
        rongga.geometry.attributes.position.needsUpdate = true;
        gigi.geometry.attributes.position.needsUpdate = true;
      }
    },
  };
}
