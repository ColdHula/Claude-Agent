// Mode Premium: tiap kalimat diubah jadi klip video bicara foto-realistis (Ditto di GPU rig) dan
// diputar tepat di atas potret. Kalimat berikutnya sudah diminta sementara kalimat ini diputar.
import * as THREE from "three";

export class Premium {
  constructor(video, panggung) {
    this.v = video;
    this.P = panggung;
    this.aktif = false;
    this.selesai = null;
    this.atur = { suara: "id-ID-GadisNeural", laju: "+0%", nada: "+0Hz" };
    const ikut = () => { if (this.v.style.opacity !== "0") this.posisikan(); requestAnimationFrame(ikut); };
    ikut();
  }
  async status() {
    try { return await (await fetch("/api/premium")).json(); } catch { return { ada: false }; }
  }
  bisa() { return this.aktif && this.P.av?.datar; }
  siapkan(teks, emosi) {
    return fetch("/api/klip", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ teks, emosi, ...this.atur }) })
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})); console.warn("klip:", j.error || r.status); return null; }
        return URL.createObjectURL(await r.blob());
      })
      .catch(() => null);
  }
  // Letakkan video persis di atas bidang foto (proyeksikan sudut bidang ke layar)
  posisikan() {
    const av = this.P.av;
    if (!av?.datar) return;
    const c = this.P.r.domElement.getBoundingClientRect();
    const a = new THREE.Vector3(-av.aspek / 2, 0.5, 0).project(this.P.cam);
    const b = new THREE.Vector3(av.aspek / 2, -0.5, 0).project(this.P.cam);
    const x0 = c.left + (a.x + 1) / 2 * c.width, y0 = c.top + (1 - a.y) / 2 * c.height;
    const x1 = c.left + (b.x + 1) / 2 * c.width, y1 = c.top + (1 - b.y) / 2 * c.height;
    Object.assign(this.v.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  }
  putar(url) {
    return new Promise((resolve) => {
      const v = this.v;
      const akhir = () => {
        v.onended = v.onerror = null;
        v.style.opacity = "0";
        setTimeout(() => URL.revokeObjectURL(url), 400);
        this.selesai = null;
        resolve();
      };
      this.selesai = akhir;
      v.onended = akhir; v.onerror = akhir;
      v.src = url;
      this.posisikan();
      v.play().then(() => { v.style.opacity = "1"; }).catch(akhir);
    });
  }
  henti() { try { this.v.pause(); } catch {} this.selesai?.(); }
}
