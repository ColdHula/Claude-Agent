// Suara Aira: bicara (TTS browser) per kalimat sambil teks mengalir, dan mendengar (pengenalan suara).
// Suara Indonesia yang umum tersedia gratis: Microsoft Gadis/Ardi (Edge, "Natural"), Google Bahasa Indonesia
// (Chrome/Android), Damayanti (iPhone/Mac). Daftar tergantung perangkat.

export const PRESET = {
  lembut: { label: "Lembut", pitch: 1.1, rate: 0.95 },
  ceria: { label: "Ceria", pitch: 1.3, rate: 1.08 },
  dewasa: { label: "Dewasa", pitch: 0.95, rate: 0.95 },
  manja: { label: "Manja", pitch: 1.45, rate: 1.0 },
  alami: { label: "Alami", pitch: 1.0, rate: 1.0 },
};
export const CONTOH = "Hai sayang, aku di sini. Gimana harimu? Ada yang bisa aku bantu kerjakan?";

const bersihkan = (s) => s
  .replace(/```[\s\S]*?```/g, " (kodenya ada di layar) ")
  .replace(/https?:\/\/\S+/g, " ")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/[*_#>`|~]+/g, " ")
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
  .replace(/\s+/g, " ").trim();

// Daftar suara: Indonesia dulu, suara "Natural"/"Online" (neural) diutamakan, lalu suara wanita.
export function daftarSuara() {
  const semua = speechSynthesis.getVoices();
  const skor = (v) => (v.lang.toLowerCase().startsWith("id") ? 100 : v.lang.toLowerCase().startsWith("ms") ? 40 : 0) +
    (/natural|online|neural/i.test(v.name) ? 20 : 0) + (/gadis|damayanti|female|wanita|perempuan|google bahasa/i.test(v.name) ? 10 : 0);
  return semua.map((v) => ({ v, s: skor(v) })).sort((a, b) => b.s - a.s).map((x) => x.v);
}
export const suaraSiap = () => new Promise((r) => {
  if (speechSynthesis.getVoices().length) return r();
  speechSynthesis.addEventListener("voiceschanged", () => r(), { once: true });
  setTimeout(r, 1500);
});

export class Pembicara {
  constructor({ onMulai, onSelesaiSemua, onKata }) {
    this.antre = [];
    this.buf = "";
    this.emo = null;
    this.aktif = false;
    this.on = { onMulai, onSelesaiSemua, onKata };
    this.cfg = { voiceURI: "", pitch: 1.1, rate: 1, volume: 1 };
    this.hidup = true; // saklar suara
    this.alirSelesai = true;
    this.premium = null; // mesin klip video (premium.js); null = suara browser biasa
    this.gen = 0;
  }
  atur(cfg) { Object.assign(this.cfg, cfg); }
  suara() {
    const vs = daftarSuara();
    return vs.find((v) => v.voiceURI === this.cfg.voiceURI) || vs[0] || null;
  }
  // Teks mengalir dari server; ucapkan kalimat yang sudah lengkap.
  dorong(teks) {
    this.alirSelesai = false;
    this.buf += teks;
    const re = /[^.!?…\n]*[.!?…]+["”')\]]*\s+|[^\n]*\n+/y;
    let m, sisa = this.buf, pos = 0;
    re.lastIndex = 0;
    while ((m = re.exec(sisa))) { this.tambah(m[0]); pos = re.lastIndex; }
    this.buf = sisa.slice(pos);
  }
  tandaiEmo(e) { if (this.buf.trim()) this.tambah(this.buf), this.buf = ""; this.emo = e; }
  selesaiAlir() { if (this.buf.trim()) this.tambah(this.buf); this.buf = ""; this.alirSelesai = true; if (!this.aktif && !this.antre.length) this.on.onSelesaiSemua?.(); }
  tambah(kal) {
    const t = bersihkan(kal);
    if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
    const item = { t, emo: this.emo };
    if (this.premium?.bisa()) item.janji = this.premium.siapkan(t, item.emo || this.emoTerakhir);
    if (this.emo) this.emoTerakhir = this.emo;
    this.antre.push(item);
    this.emo = null;
    if (!this.aktif) this.berikut();
  }
  berikut() {
    if (!this.hidup) { this.antre = []; this.aktif = false; if (this.alirSelesai) this.on.onSelesaiSemua?.(); return; }
    const item = this.antre.shift();
    if (!item) { this.aktif = false; if (this.alirSelesai) this.on.onSelesaiSemua?.(); return; }
    this.aktif = true;
    if (item.janji) {
      const gen = this.gen;
      item.janji.then(async (url) => {
        if (gen !== this.gen) return;
        if (url) {
          this.on.onMulai?.({ ...item, premium: true });
          await this.premium.putar(url);
          if (gen === this.gen) this.berikut();
        } else { delete item.janji; this.antre.unshift(item); this.berikut(); } // gagal → suara browser
      });
      return;
    }
    const u = new SpeechSynthesisUtterance(item.t);
    const v = this.suara();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "id-ID";
    u.pitch = this.cfg.pitch; u.rate = this.cfg.rate; u.volume = this.cfg.volume;
    u.onstart = () => this.on.onMulai?.(item);
    u.onboundary = () => this.on.onKata?.();
    u.onend = u.onerror = () => this.berikut();
    speechSynthesis.speak(u);
  }
  get bicara() { return this.aktif || speechSynthesis.speaking; }
  henti() {
    this.gen++;
    this.antre = []; this.buf = ""; this.aktif = false; this.alirSelesai = true; this.emoTerakhir = null;
    speechSynthesis.cancel();
    this.premium?.henti();
  }
  contoh(teks = CONTOH) {
    this.henti();
    this.alirSelesai = false;
    this.dorong(teks + " ");
    this.selesaiAlir();
  }
}

// Pengenalan suara (Chrome/Edge/Android; Safari iOS 17+ sebagian). Bahasa Indonesia.
export class Pendengar {
  constructor({ onSementara, onFinal, onStatus }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.didukung = !!SR;
    this.on = { onSementara, onFinal, onStatus };
    this.mau = false;
    this.kalimat = "";
    this.jeda = null;
    if (!SR) return;
    const r = (this.r = new SR());
    r.lang = "id-ID"; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let sementara = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i];
        if (x.isFinal) this.kalimat += x[0].transcript + " ";
        else sementara += x[0].transcript;
      }
      this.on.onSementara?.((this.kalimat + sementara).trim());
      clearTimeout(this.jeda);
      // Kirim setelah jeda ±1 detik tanpa suara baru
      this.jeda = setTimeout(() => this.kirim(), sementara ? 1600 : 900);
    };
    r.onerror = (e) => this.on.onStatus?.(e.error === "not-allowed" ? "izin-ditolak" : e.error);
    r.onend = () => { if (this.mau) setTimeout(() => { try { r.start(); } catch {} }, 250); else this.on.onStatus?.("berhenti"); };
    r.onstart = () => this.on.onStatus?.("mendengar");
  }
  kirim() {
    const t = this.kalimat.trim();
    this.kalimat = "";
    if (t) this.on.onFinal?.(t);
  }
  mulai() { if (!this.r) return; this.mau = true; try { this.r.start(); } catch {} }
  henti() { if (!this.r) return; this.mau = false; clearTimeout(this.jeda); this.kalimat = ""; try { this.r.stop(); } catch {} }
}
