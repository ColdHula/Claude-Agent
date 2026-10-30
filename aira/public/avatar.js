// Panggung 3D Aira: memuat avatar (Rocketbox FBX realistis, VRM, GLB ARKit, atau avatar bawaan),
// lalu menghidupkannya: napas, kedip, ekspresi, gerak bibir, anggukan, dan tatapan mata ke pengguna.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { muatPotret } from "/potret.js";

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const MAJU = new THREE.Vector3(0, 0, 1);

// Ekspresi dalam nama blendshape ARKit (dinormalkan: huruf kecil tanpa simbol).
const EKSPRESI_ARKIT = {
  neutral: {},
  happy: { mouthsmileleft: 0.75, mouthsmileright: 0.75, cheeksquintleft: 0.45, cheeksquintright: 0.45, eyesquintleft: 0.25, eyesquintright: 0.25, browinnerup: 0.1 },
  sad: { mouthfrownleft: 0.55, mouthfrownright: 0.55, browinnerup: 0.75, eyesquintleft: 0.15, eyesquintright: 0.15, mouthpressleft: 0.2, mouthpressright: 0.2 },
  angry: { browdownleft: 0.8, browdownright: 0.8, mouthpressleft: 0.45, mouthpressright: 0.45, nosesneerleft: 0.35, nosesneerright: 0.35, eyesquintleft: 0.3, eyesquintright: 0.3 },
  surprised: { eyewideleft: 0.7, eyewideright: 0.7, browinnerup: 0.65, browouterupleft: 0.65, browouterupright: 0.65, jawopen: 0.18 },
  relaxed: { mouthsmileleft: 0.35, mouthsmileright: 0.35, eyesquintleft: 0.15, eyesquintright: 0.15 },
  shy: { mouthsmileleft: 0.45, mouthsmileright: 0.45, browinnerup: 0.35, cheeksquintleft: 0.3, cheeksquintright: 0.3, eyelookdownleft: 0.35, eyelookdownright: 0.35 },
};
const EKSPRESI_VRM = {
  neutral: {}, happy: { happy: 0.8 }, sad: { sad: 0.8 }, angry: { angry: 0.75 },
  surprised: { surprised: 0.8 }, relaxed: { relaxed: 0.7 }, shy: { happy: 0.45, relaxed: 0.3 },
};
const VISEME = ["aa", "e", "i", "o", "u"]; // bentuk mulut saat bicara
const MORPH_DIPAKAI = new Set([...Object.values(EKSPRESI_ARKIT).flatMap(Object.keys), ...VISEME, "jawopen", "eyeblinkleft", "eyeblinkright", "mouthclose"]);

const normMorph = (k) => String(k).split(".").pop().replace(/^(ak_\d+_|aa_vi_\d+_|au_\d+_|viseme_|blendshape\d*_?)/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const normTulang = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(bip01|bip001|mixamorig\d*|ccbase|armature)/, "");
const NAMA_TULANG = {
  hips: ["pelvis", "hips"], spine: ["spine2", "spine1", "chest", "upperchest", "spine"], neck: ["neck"], head: ["head"],
  lUpper: ["lupperarm", "leftarm", "leftupperarm", "upperarml"], lFore: ["lforearm", "leftforearm", "leftlowerarm", "lowerarml"], lHand: ["lhand", "lefthand", "handl"],
  rUpper: ["rupperarm", "rightarm", "rightupperarm", "upperarmr"], rFore: ["rforearm", "rightforearm", "rightlowerarm", "lowerarmr"], rHand: ["rhand", "righthand", "handr"],
  lEye: ["leye", "lefteye", "eyel"], rEye: ["reye", "righteye", "eyer"],
};
function cariTulang(root) {
  const semua = new Map();
  root.traverse((o) => { if (o.isBone || o.type === "Bone" || /bip01|mixamo|armature/i.test(o.name)) { const k = normTulang(o.name); if (!semua.has(k)) semua.set(k, o); } });
  const out = {};
  for (const [kunci, calon] of Object.entries(NAMA_TULANG)) for (const c of calon) if (semua.has(c)) { out[kunci] = semua.get(c); break; }
  return out;
}

// Putar tulang dalam ruang dunia: tulang.local = parentWorld⁻¹ · delta · world
function putarDunia(tulang, delta) {
  tulang.getWorldQuaternion(q1);
  tulang.parent.getWorldQuaternion(q2);
  tulang.quaternion.copy(q2.invert().multiply(delta.clone().multiply(q1)));
  tulang.updateWorldMatrix(false, true);
}
function arahkan(tulang, anak, arah) {
  tulang.updateWorldMatrix(true, true);
  const kini = anak.getWorldPosition(v2).sub(tulang.getWorldPosition(v1)).normalize();
  putarDunia(tulang, new THREE.Quaternion().setFromUnitVectors(kini, arah.clone().normalize()));
}

// Buang morph target yang tidak dipakai (Rocketbox punya 175) agar ringan di HP.
function rampingkanMorph(mesh) {
  const dict = mesh.morphTargetDictionary, g = mesh.geometry;
  if (!dict || !g.morphAttributes.position) return;
  const simpan = Object.entries(dict).filter(([k]) => MORPH_DIPAKAI.has(normMorph(k))).sort((a, b) => a[1] - b[1]);
  if (simpan.length === Object.keys(dict).length) return;
  for (const attr of Object.keys(g.morphAttributes)) g.morphAttributes[attr] = simpan.map(([, i]) => g.morphAttributes[attr][i]);
  mesh.morphTargetDictionary = Object.fromEntries(simpan.map(([k], i) => [k, i]));
  mesh.morphTargetInfluences = simpan.map(() => 0);
}

function petaMorph(root) {
  const peta = new Map();
  root.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    for (const [k, i] of Object.entries(o.morphTargetDictionary)) {
      const n = normMorph(k);
      if (!peta.has(n)) peta.set(n, []);
      peta.get(n).push([o, i]);
    }
  });
  return peta;
}

function rapikanMaterial(root, jenis) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.castShadow = false;
    const mats = [].concat(o.material).map((m) => {
      if (jenis !== "rocketbox") return m;
      const tembus = /opacity|hair|lash|glass/i.test(m.name);
      const n = new THREE.MeshStandardMaterial({
        name: m.name, map: m.map, color: 0xffffff, roughness: /head|skin/i.test(m.name) ? 0.62 : 0.8, metalness: 0,
        transparent: tembus, alphaTest: tembus ? 0.35 : 0, side: tembus ? THREE.DoubleSide : THREE.FrontSide, depthWrite: true,
      });
      if (n.map) { n.map.colorSpace = THREE.SRGBColorSpace; n.map.anisotropy = 4; }
      if (tembus && m.map) n.alphaMap = null; // alfa ada di PNG RGBA
      return n;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
}

export class Panggung {
  constructor(kanvas) {
    this.r = new THREE.WebGLRenderer({ canvas: kanvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
    this.cam.position.set(0, 1.5, 1.2);
    this.kontrol = new OrbitControls(this.cam, kanvas);
    Object.assign(this.kontrol, { enableDamping: true, enablePan: false, minDistance: 0.35, maxDistance: 6,
      minPolarAngle: 1.1, maxPolarAngle: 2.0, minAzimuthAngle: -0.9, maxAzimuthAngle: 0.9, rotateSpeed: 0.5 });
    // Cahaya studio lembut: kunci hangat, isi sejuk, dan cahaya tepi
    this.scene.add(new THREE.HemisphereLight(0xfff4f8, 0x2a2238, 1.25));
    const kunci = new THREE.DirectionalLight(0xffe9dc, 2.1); kunci.position.set(1.2, 2.2, 2.4); this.scene.add(kunci);
    const isi = new THREE.DirectionalLight(0xcfe0ff, 0.7); isi.position.set(-2, 1.2, 1.5); this.scene.add(isi);
    const tepi = new THREE.DirectionalLight(0xffb3d1, 1.4); tepi.position.set(-0.5, 2, -2.5); this.scene.add(tepi);
    this.target = new THREE.Object3D(); // titik yang ditatap (wajah pengguna)
    this.scene.add(this.target);
    this.offsetTatap = new THREE.Vector2(); // dari pelacak wajah kamera
    this.av = null;
    this.ekspresi = "neutral";
    this.bobot = new Map(); // nama morph → bobot saat ini
    this.mulut = 0; this.mulutTarget = 0; this.viseme = "aa";
    this.kedip = 0; this.kedipBerikut = 2;
    this.aksi = null; // {jenis, t}
    this.bicara = false;
    this.berpikir = false;
    this.jarak = "setengah"; // "wajah" | "setengah" | "penuh"
    this.jam = new THREE.Clock();
    new ResizeObserver(() => this.ukur()).observe(kanvas);
    this.ukur();
    this.r.setAnimationLoop(() => this.langkah());
  }

  ukur() {
    const c = this.r.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    this.r.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    if (this.av?.datar) this.bingkaiFoto();
  }

  async muat(info, baju = null, onProgres = () => {}) {
    const lama = this.av;
    let av;
    try {
      if (!info || info.jenis === "bawaan") av = buatBawaan(info?.warna);
      else if (info.jenis === "potret") av = await muatPotret(`/model/${encodeURIComponent(info.id)}/${info.berkas}`);
      else if (info.jenis === "rocketbox") av = await muatRocketbox(info, baju, onProgres);
      else av = await muatGltf(info, onProgres);
    } catch (e) {
      console.error(e);
      av = buatBawaan();
      av.galat = String(e?.message || e);
    }
    if (lama) { this.scene.remove(lama.root); lama.buang?.(); }
    this.av = av;
    this.scene.add(av.root);
    if (!av.datar) { av.root.updateMatrixWorld(true); av.batas = new THREE.Box3().setFromObject(av.root); }
    this.bobot.clear();
    this.bingkai(true);
    return av;
  }

  // Posisikan kamera setinggi mata, menatap wajah (dekat) atau setengah badan.
  bingkai(langsung = false) {
    if (!this.av) return;
    this.kontrol.enabled = !this.av.datar;
    if (this.av.datar) return this.bingkaiFoto();
    const kepala = this.av.posisiKepala(v1).clone();
    const box = this.av.batas || new THREE.Box3().setFromObject(this.av.root);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    const lebarMin = { wajah: 0.32, setengah: 0.75, penuh: 0.9 }[this.jarak] || 0.75;
    let fokus, tinggi;
    if (this.jarak === "penuh") { fokus = box.getCenter(new THREE.Vector3()); tinggi = (box.max.y - box.min.y) * 1.22; fokus.y += tinggi * 0.04; fokus.x = kepala.x; fokus.z = kepala.z; }
    else if (this.jarak === "wajah") { fokus = kepala.clone().add(new THREE.Vector3(0, -0.05, 0)); tinggi = 0.36; }
    else { fokus = kepala.clone().add(new THREE.Vector3(0, -0.3, 0)); tinggi = 0.85; }
    tinggi = Math.max(tinggi, lebarMin / Math.max(this.cam.aspect, 0.3));
    const jarak = tinggi / (2 * tanH);
    this.kontrol.target.copy(fokus);
    this.cam.position.copy(fokus).add(new THREE.Vector3(0, this.jarak === "penuh" ? 0.1 : 0.02, jarak));
    this.kontrol.update();
  }

  // Potret datar: kamera lurus. "dekat" = wajah memenuhi ±1/3 layar, "badan" = seluruh foto.
  bingkaiFoto() {
    const av = this.av, A = av.aspek, asp = this.cam.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    const t = av.tampilan(this.jarak);
    let h = t.h;
    if (h * asp > A && this.jarak !== "penuh") h = Math.min(h, A / asp); // jangan sampai ada tepi kosong
    const batasX = Math.max(0, (A - h * asp) / 2), batasY = Math.max(0, (1 - h) / 2);
    const x = THREE.MathUtils.clamp(t.x, -batasX, batasX), y = THREE.MathUtils.clamp(t.y, -batasY, batasY);
    this.cam.position.set(x, y, h / (2 * tanH));
    this.cam.lookAt(x, y, 0);
  }

  setEkspresi(e) { this.ekspresi = e in EKSPRESI_ARKIT ? e : "neutral"; this.ekspresiSejak = performance.now(); }
  setAksi(jenis) { this.aksi = { jenis, t: 0 }; }
  denyut() { this.mulutTarget = Math.max(this.mulutTarget, 0.7); }

  langkah() {
    const dt = Math.min(this.jam.getDelta(), 0.05), t = this.jam.elapsedTime;
    const av = this.av;
    if (!av) return;
    // Ekspresi kembali netral pelan-pelan setelah ±9 detik
    if (this.ekspresi !== "neutral" && performance.now() - (this.ekspresiSejak || 0) > 9000 && !this.bicara) this.ekspresi = "relaxed";
    // Mulut: saat bicara bergerak acak berirama; denyut dari batas kata TTS
    if (this.bicara) {
      // Ritme suku kata ±5/detik dengan variasi, plus denyut dari batas kata TTS
      this.fase = (this.fase || 0) + dt * (9 + 4 * Math.sin(t * 1.7) + 2 * Math.sin(t * 4.1));
      const suku = 0.5 + 0.5 * Math.sin(this.fase);
      if (suku < 0.08 && !this._ganti) { this.viseme = VISEME[(Math.random() * VISEME.length) | 0]; this._ganti = true; }
      if (suku > 0.5) this._ganti = false;
      this.mulutTarget = Math.max(this.mulutTarget - dt * 3, 0.08 + 0.62 * suku * suku);
    } else this.mulutTarget = 0;
    this.mulut += (this.mulutTarget - this.mulut) * Math.min(1, dt * 18);
    // Kedip alami (lebih sering saat berpikir)
    this.kedipBerikut -= dt;
    if (this.kedipBerikut <= 0) { this.kedip = 1; this.kedipBerikut = Math.random() < 0.15 ? 0.32 : 2 + Math.random() * 4; } // sesekali kedip ganda
    const kedipNilai = this.kedip > 0 ? Math.sin(this.kedip * Math.PI) : 0;
    this.kedip = Math.max(0, this.kedip - dt * 7);
    // Titik tatap: kamera (mata pengguna) + geseran dari pelacak wajah; saat berpikir melirik ke atas
    this.target.position.copy(this.cam.position);
    this.target.position.x += this.offsetTatap.x * 0.35;
    this.target.position.y += this.offsetTatap.y * 0.25;
    if (this.berpikir) { this.target.position.x += 0.25 * Math.sin(t * 0.7); this.target.position.y += 0.35; }
    // Gerak kepala dari aksi (angguk/geleng/miring/lambai)
    const g = { angguk: 0, geleng: 0, miring: 0, lambai: 0 };
    if (this.aksi) {
      const a = this.aksi; a.t += dt;
      const s = a.t;
      if (a.jenis === "nod") g.angguk = Math.sin(s * 11) * 0.14 * Math.max(0, 1 - s / 0.9);
      if (a.jenis === "shake") g.geleng = Math.sin(s * 12) * 0.16 * Math.max(0, 1 - s / 1);
      if (a.jenis === "tilt" || a.jenis === "think") g.miring = Math.sin(Math.min(s, 1.6) / 1.6 * Math.PI) * 0.16;
      if (a.jenis === "wave") g.lambai = Math.max(0, Math.sin(Math.min(s, 2.2) / 2.2 * Math.PI));
      if (s > 2.3) this.aksi = null;
    }
    av.perbarui({ dt, t, panggung: this, kedip: kedipNilai, gerak: g });
    if (this.jarak && this._jarakLama !== this.jarak) { this._jarakLama = this.jarak; this.bingkai(); }
    if (!av.datar) this.kontrol.update();
    this.r.render(this.scene, this.cam);
  }

  // Bobot morph halus menuju target (dipakai avatar ARKit)
  terapkanMorph(peta, target, dt) {
    const semua = new Set([...this.bobot.keys(), ...Object.keys(target)]);
    for (const k of semua) {
      const kini = this.bobot.get(k) || 0, tuju = target[k] || 0;
      const n = kini + (tuju - kini) * Math.min(1, dt * 10);
      this.bobot.set(k, n);
      for (const [mesh, i] of peta.get(k) || []) mesh.morphTargetInfluences[i] = n;
    }
  }
}

// --- Rig umum untuk model bertulang (Rocketbox / GLB): pose, napas, tatapan, morph ARKit ---
function rigUmum(root, { peta, tulang, jenis }) {
  root.updateMatrixWorld(true);
  // Hadapkan model ke +Z (ke kamera) memakai posisi mata relatif kepala
  if (tulang.head && tulang.lEye && tulang.rEye) {
    const mata = tulang.lEye.getWorldPosition(new THREE.Vector3()).add(tulang.rEye.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const maju = mata.sub(tulang.head.getWorldPosition(new THREE.Vector3())).setY(0);
    if (maju.lengthSq() > 1e-8) root.rotation.y -= Math.atan2(maju.x, maju.z);
    root.updateMatrixWorld(true);
    const cek = tulang.lEye.getWorldPosition(new THREE.Vector3()).add(tulang.rEye.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
      .sub(tulang.head.getWorldPosition(new THREE.Vector3()));
    if (cek.z < 0) { root.rotation.y += Math.PI; root.updateMatrixWorld(true); }
  }
  // Turunkan lengan dari pose-T/A ke posisi santai
  const turunkan = (atas, bawah, tangan) => {
    if (!atas || !bawah) return;
    const pusat = (tulang.spine || tulang.neck || root).getWorldPosition(new THREE.Vector3());
    const sisi = Math.sign(atas.getWorldPosition(new THREE.Vector3()).x - pusat.x) || 1;
    arahkan(atas, bawah, new THREE.Vector3(sisi * 0.2, -1, 0.06));
    if (tangan) arahkan(bawah, tangan, new THREE.Vector3(sisi * 0.12, -1, 0.42));
  };
  turunkan(tulang.lUpper, tulang.lFore, tulang.lHand);
  turunkan(tulang.rUpper, tulang.rFore, tulang.rHand);
  root.updateMatrixWorld(true);
  // Simpan rotasi dasar
  const dasar = new Map();
  for (const b of Object.values(tulang)) dasar.set(b, b.quaternion.clone());
  // Arah "depan" tiap mata/kepala dalam ruang lokal tulang
  const depanLokal = new Map();
  for (const b of [tulang.head, tulang.neck, tulang.lEye, tulang.rEye].filter(Boolean)) {
    depanLokal.set(b, MAJU.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()));
  }
  const tatap = (b, target, bobot, maks) => {
    if (!b) return;
    const pos = b.getWorldPosition(v1);
    const depan = depanLokal.get(b).clone().applyQuaternion(b.getWorldQuaternion(q1));
    const tuju = v2.copy(target).sub(pos).normalize();
    const d = new THREE.Quaternion().setFromUnitVectors(depan, tuju);
    const sudut = 2 * Math.acos(Math.min(1, Math.abs(d.w)));
    const f = Math.min(1, maks / Math.max(sudut, 1e-6)) * bobot;
    putarDunia(b, new THREE.Quaternion().slerp(d, f));
  };
  const lambaiSisi = tulang.rUpper || tulang.lUpper;
  const kepalaHalus = new THREE.Vector3();
  let mulai = true;
  return {
    root,
    posisiKepala: (out) => (tulang.head ? tulang.head.getWorldPosition(out).add(new THREE.Vector3(0, 0.05, 0)) : out.set(0, 1.5, 0)),
    perbarui({ dt, t, panggung: P, kedip, gerak }) {
      for (const [b, q] of dasar) b.quaternion.copy(q);
      // Napas & goyang halus
      if (tulang.spine) putarDunia(tulang.spine, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 1.3) * 0.012, Math.sin(t * 0.37) * 0.02, Math.sin(t * 0.5) * 0.012)));
      // Tatapan: target dihaluskan agar tidak patah-patah
      if (mulai) { kepalaHalus.copy(P.target.position); mulai = false; }
      kepalaHalus.lerp(P.target.position, Math.min(1, dt * 4));
      tatap(tulang.neck, kepalaHalus, 0.35, 0.25);
      tatap(tulang.head, kepalaHalus, 0.5, 0.35);
      if (tulang.head && (gerak.angguk || gerak.geleng || gerak.miring)) {
        putarDunia(tulang.head, new THREE.Quaternion().setFromEuler(new THREE.Euler(gerak.angguk, gerak.geleng, gerak.miring)));
      }
      if (lambaiSisi && gerak.lambai) {
        putarDunia(lambaiSisi, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (lambaiSisi === tulang.rUpper ? -1 : 1) * gerak.lambai * 2.2));
        const bawah = lambaiSisi === tulang.rUpper ? tulang.rFore : tulang.lFore;
        if (bawah) putarDunia(bawah, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t * 9) * 0.35 * gerak.lambai));
      }
      tatap(tulang.lEye, P.target.position, 1, 0.35);
      tatap(tulang.rEye, P.target.position, 1, 0.35);
      // Morph wajah
      const tgt = { ...(EKSPRESI_ARKIT[P.ekspresi] || {}) };
      const m = P.mulut;
      if (m > 0.02) {
        tgt.jawopen = Math.max(tgt.jawopen || 0, m * 0.28);
        tgt[P.viseme] = (tgt[P.viseme] || 0) + m * 0.75;
        for (const k of ["mouthsmileleft", "mouthsmileright"]) if (tgt[k]) tgt[k] *= 0.7;
      }
      tgt.eyeblinkleft = Math.max(tgt.eyeblinkleft || 0, kedip);
      tgt.eyeblinkright = Math.max(tgt.eyeblinkright || 0, kedip);
      if (P.berpikir) { tgt.browinnerup = Math.max(tgt.browinnerup || 0, 0.3); tgt.mouthpressleft = 0.2; tgt.mouthpressright = 0.2; }
      P.terapkanMorph(peta, tgt, dt);
    },
  };
}

async function muatRocketbox(info, baju, onProgres) {
  const muatSatu = async (inf) => {
    const mgr = new THREE.LoadingManager();
    mgr.setURLModifier((u) => {
      const b = decodeURIComponent(u.split(/[\\/]/).pop()).toLowerCase();
      if (inf.tekstur?.[b]) return `/model/${inf.id}/${inf.tekstur[b]}`;
      return /\.(tga|tif|dds|psd)$/i.test(b) ? "data:image/gif;base64,R0lGODlhAQABAAAAACw=" : u;
    });
    const obj = await new FBXLoader(mgr).loadAsync(`/model/${inf.id}/${inf.berkas}`, (e) => e.total && onProgres(e.loaded / e.total));
    await new Promise((r) => { if (mgr.itemsLoaded >= mgr.itemsTotal) r(); else mgr.onLoad = r; setTimeout(r, 15000); });
    obj.scale.setScalar(0.01); // cm → m
    rapikanMaterial(obj, "rocketbox");
    obj.traverse((o) => { if (o.isSkinnedMesh) rampingkanMorph(o); });
    return obj;
  };
  const root = await muatSatu(info);
  const tulang = cariTulang(root);
  if (baju && baju.id !== info.id) {
    // Ganti baju: badan dari model lain diikat ke kerangka model utama (kerangka Bip01 sama).
    const lain = await muatSatu(baju);
    const peta = new Map();
    root.traverse((o) => { if (o.isBone) peta.set(o.name, o); });
    const tempel = [];
    lain.traverse((o) => { if (o.isSkinnedMesh) tempel.push(o); });
    for (const m of tempel) {
      const tl = m.skeleton.bones.map((b) => peta.get(b.name) || b);
      m.bind(new THREE.Skeleton(tl, m.skeleton.boneInverses), m.bindMatrix);
      for (const mat of [].concat(m.material)) if (!/body/i.test(mat.name)) mat.visible = false;
      m.morphTargetInfluences?.fill(0);
      const induk = root.getObjectByName(m.parent?.name) || root;
      induk.add(m);
    }
    root.traverse((o) => { if (o.isMesh && !tempel.includes(o)) for (const mat of [].concat(o.material)) if (/body/i.test(mat.name)) mat.visible = false; });
  }
  const av = rigUmum(root, { peta: petaMorph(root), tulang, jenis: "rocketbox" });
  return av;
}

async function muatGltf(info, onProgres) {
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(`/model/${info.id}/${info.berkas}`, (e) => e.total && onProgres(e.loaded / e.total));
  const vrm = gltf.userData.vrm;
  if (vrm) return rigVrm(vrm);
  const root = gltf.scene;
  rapikanMaterial(root, "glb");
  return rigUmum(root, { peta: petaMorph(root), tulang: cariTulang(root), jenis: "glb" });
}

// --- VRM (VRoid Studio dll): pakai ekspresi & lookAt bawaan VRM ---
function rigVrm(vrm) {
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons?.(vrm.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  const h = vrm.humanoid, B = (n) => h.getNormalizedBoneNode(n);
  const lookTarget = new THREE.Object3D();
  if (vrm.lookAt) vrm.lookAt.target = lookTarget;
  const em = vrm.expressionManager;
  const bobot = {};
  const kepalaHalus = new THREE.Vector3();
  return {
    root: vrm.scene,
    posisiKepala: (out) => (h.getRawBoneNode("head") ? h.getRawBoneNode("head").getWorldPosition(out).add(new THREE.Vector3(0, 0.06, 0)) : out.set(0, 1.4, 0)),
    buang: () => VRMUtils.deepDispose(vrm.scene),
    perbarui({ dt, t, panggung: P, kedip, gerak }) {
      B("leftUpperArm") && (B("leftUpperArm").rotation.z = -1.2);
      B("rightUpperArm") && (B("rightUpperArm").rotation.z = 1.2);
      B("leftLowerArm") && (B("leftLowerArm").rotation.y = -0.25);
      B("rightLowerArm") && (B("rightLowerArm").rotation.y = 0.25);
      if (gerak.lambai && B("rightUpperArm")) { B("rightUpperArm").rotation.z = 1.2 - gerak.lambai * 2.3; B("rightLowerArm").rotation.z = Math.sin(t * 9) * 0.4 * gerak.lambai; }
      const sp = B("spine"); if (sp) sp.rotation.set(Math.sin(t * 1.3) * 0.015, Math.sin(t * 0.37) * 0.02, Math.sin(t * 0.5) * 0.012);
      kepalaHalus.lerp(P.target.position, Math.min(1, dt * 4));
      const kepala = B("head");
      if (kepala) {
        const pos = h.getRawBoneNode("head").getWorldPosition(new THREE.Vector3());
        const d = kepalaHalus.clone().sub(pos);
        const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -0.5, 0.5) * 0.5;
        const pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4) * 0.5;
        kepala.rotation.set(pitch + gerak.angguk, yaw + gerak.geleng, gerak.miring);
      }
      lookTarget.position.copy(P.target.position);
      const tgt = { ...(EKSPRESI_VRM[P.ekspresi] || {}) };
      if (P.mulut > 0.02) tgt[{ aa: "aa", e: "ee", i: "ih", o: "oh", u: "ou" }[P.viseme]] = P.mulut * 0.8;
      tgt.blink = kedip;
      if (em) {
        for (const k of new Set([...Object.keys(bobot), ...Object.keys(tgt)])) {
          bobot[k] = (bobot[k] || 0) + ((tgt[k] || 0) - (bobot[k] || 0)) * Math.min(1, dt * 10);
          em.setValue(k, bobot[k]);
        }
      }
      vrm.update(dt);
    },
  };
}

// --- Avatar bawaan (tanpa file model): sederhana, tetap berekspresi dan menatap ---
function buatBawaan(warnaBaju = "#ff8fb1") {
  const root = new THREE.Group();
  const toon = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const kulit = toon("#ffd9c4"), rambut = toon("#3a2433"), baju = toon(warnaBaju), putih = toon("#ffffff"), iris = toon("#5b3a7a"), gelap = toon("#2a1620");
  const badan = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 8, 24), baju); badan.position.y = 1.08; badan.scale.z = 0.7;
  const leher = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 16), kulit); leher.position.y = 1.36;
  const kepala = new THREE.Group(); kepala.position.y = 1.52;
  const muka = new THREE.Mesh(new THREE.SphereGeometry(0.13, 40, 32), kulit); muka.scale.set(1, 1.12, 1);
  const rBelakang = new THREE.Mesh(new THREE.SphereGeometry(0.142, 40, 32), rambut); rBelakang.position.set(0, 0.025, -0.02); rBelakang.scale.set(1.03, 1.1, 1);
  const poni = new THREE.Mesh(new THREE.SphereGeometry(0.135, 40, 16, 0, Math.PI * 2, 0, 1.05), rambut); poni.position.set(0, 0.03, 0.012); poni.rotation.x = -0.35;
  const panjang = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.28, 8, 20), rambut); panjang.position.set(0, -0.16, -0.06); panjang.scale.set(1.15, 1, 0.55);
  kepala.add(muka, rBelakang, poni, panjang);
  const mata = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 0.045, 0.0, 0.112);
    const bola = new THREE.Mesh(new THREE.SphereGeometry(0.024, 24, 16), putih); bola.scale.set(1, 1.2, 0.5);
    const i = new THREE.Mesh(new THREE.SphereGeometry(0.015, 20, 16), iris); i.position.z = 0.01; i.scale.set(1, 1.2, 0.5);
    const kilau = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), putih); kilau.position.set(0.005, 0.007, 0.018);
    const alis = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.006), gelap); alis.position.set(0, 0.042, 0.004);
    g.add(bola, i, kilau, alis); kepala.add(g); mata.push({ g, i, alis, s });
  }
  const mulut = new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 12), gelap); mulut.position.set(0, -0.06, 0.118); mulut.scale.set(1.2, 0.25, 0.4);
  const pipi = [-1, 1].map((s) => { const p = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), new THREE.MeshBasicMaterial({ color: "#ff7fa6", transparent: true, opacity: 0 })); p.position.set(s * 0.07, -0.03, 0.112); p.rotation.y = s * 0.5; kepala.add(p); return p; });
  kepala.add(mulut);
  root.add(badan, leher, kepala);
  const halus = new THREE.Vector3();
  return {
    root,
    posisiKepala: (out) => kepala.getWorldPosition(out),
    perbarui({ dt, t, panggung: P, kedip, gerak }) {
      badan.scale.y = 1 + Math.sin(t * 1.3) * 0.01;
      halus.lerp(P.target.position, Math.min(1, dt * 4));
      const d = halus.clone().sub(kepala.getWorldPosition(v1));
      kepala.rotation.set(-Math.atan2(d.y, d.z) * 0.4 + gerak.angguk, Math.atan2(d.x, d.z) * 0.4 + gerak.geleng, gerak.miring + Math.sin(t * 0.6) * 0.02);
      const e = P.ekspresi;
      const senyum = { happy: 1, relaxed: 0.5, shy: 0.7 }[e] || 0;
      for (const m of mata) {
        m.i.position.x = THREE.MathUtils.clamp(d.x * 0.02, -0.006, 0.006);
        m.i.position.y = THREE.MathUtils.clamp(d.y * 0.02, -0.005, 0.005);
        m.g.scale.y = Math.max(0.08, 1 - kedip) * (e === "surprised" ? 1.2 : senyum ? 0.85 : 1);
        m.alis.rotation.z = m.s * ({ angry: -0.35, sad: 0.35, surprised: 0.1 }[e] || 0);
        m.alis.position.y = 0.042 + (e === "surprised" ? 0.01 : 0);
      }
      const buka = P.mulut;
      mulut.scale.set(1.2 + senyum * 0.8 - buka * 0.3, 0.25 + buka * 1.4 - (e === "sad" ? 0.1 : 0), 0.4);
      for (const p of pipi) p.material.opacity += (((e === "shy" ? 0.7 : senyum * 0.35)) - p.material.opacity) * Math.min(1, dt * 5);
    },
  };
}
