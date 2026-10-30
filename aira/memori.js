// Penyimpanan Aira: ingatan (fakta), kepribadian dinamis, riwayat obrolan, dan ringkasan.
// Semua berupa file JSON/JSONL di AIRA_DATA (bawaan aira/data/, tidak ikut Git).
// Tulis atomik (tmp + rename) agar file tidak rusak bila listrik rig padam.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const SIFAT = {
  kehangatan: "hangat dan penuh kasih",
  keceriaan: "ceria dan ekspresif",
  kejahilan: "jahil, suka menggoda dan bercanda",
  kepedulian: "perhatian dan protektif",
  keformalan: "formal dan rapi saat bicara",
  rasa_ingin_tahu: "penasaran dan suka bertanya balik",
};
const SIFAT_AWAL = { kehangatan: 70, keceriaan: 65, kejahilan: 40, kepedulian: 75, keformalan: 20, rasa_ingin_tahu: 60 };
const MOOD_DASAR = { energi: 60, valensi: 65 };
const MAX_FAKTA = 400;
const MAX_GAYA = 15;

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const num = (v, lim) => clamp(Number(v) || 0, -lim, lim);
const id6 = () => crypto.randomBytes(4).toString("hex");

export function tahapHubungan(k) {
  if (k < 20) return "baru kenal";
  if (k < 40) return "teman akrab";
  if (k < 55) return "saling suka (PDKT)";
  if (k < 75) return "pacaran";
  return "pasangan yang sangat dekat";
}

export function buatPenyimpanan(dir, awal = {}) {
  const F = {
    fakta: path.join(dir, "memori.json"),
    jiwa: path.join(dir, "kepribadian.json"),
    riwayat: path.join(dir, "riwayat.jsonl"),
    ringkasan: path.join(dir, "ringkasan.json"),
    biaya: path.join(dir, "biaya.json"),
  };
  const tulis = async (f, data) => {
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, typeof data === "string" ? data : JSON.stringify(data, null, 1));
    await fs.rename(tmp, f);
  };
  const baca = async (f, awal) => {
    try { return JSON.parse(await fs.readFile(f, "utf8")); } catch { return awal; }
  };

  const jiwaAwal = () => ({
    sifat: { ...SIFAT_AWAL, ...(awal.sifat || {}) },
    kedekatan: clamp(awal.kedekatan ?? process.env.AIRA_KEDEKATAN_AWAL ?? 55),
    mood: { nama: "ceria", ...MOOD_DASAR },
    gaya: [],
    julukan: "",
    perubahan: [],
    interaksi: 0,
    pertama: Date.now(),
    terakhir: 0,
  });

  let fakta = [], jiwa = null, riwayat = [], ringkasan = { teks: "", sampai: 0 }, biaya = { total: 0, bulan: "", bulanIni: 0 };

  async function muat() {
    await fs.mkdir(dir, { recursive: true });
    fakta = await baca(F.fakta, []);
    jiwa = { ...jiwaAwal(), ...(await baca(F.jiwa, {})) };
    jiwa.sifat = { ...SIFAT_AWAL, ...(awal.sifat || {}), ...jiwa.sifat };
    ringkasan = await baca(F.ringkasan, ringkasan);
    biaya = await baca(F.biaya, biaya);
    const raw = await fs.readFile(F.riwayat, "utf8").catch(() => "");
    riwayat = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  // Suasana hati kembali pelan-pelan ke dasar (paruh waktu ±6 jam) saat lama tidak ngobrol.
  function moodSekarang() {
    const m = { ...jiwa.mood };
    if (jiwa.terakhir) {
      const jam = (Date.now() - jiwa.terakhir) / 3.6e6;
      const f = Math.pow(0.5, jam / 6);
      m.energi = clamp(MOOD_DASAR.energi + (m.energi - MOOD_DASAR.energi) * f);
      m.valensi = clamp(MOOD_DASAR.valensi + (m.valensi - MOOD_DASAR.valensi) * f);
      if (f < 0.5) m.nama = jam > 24 ? "kangen" : "tenang";
    }
    return m;
  }

  // --- Ingatan (fakta) ---
  async function ingat(teks, kategori = "umum", penting = 3) {
    teks = String(teks || "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (teks.length < 3) return null;
    const sama = fakta.find((f) => f.teks.toLowerCase() === teks.toLowerCase());
    if (sama) { sama.at = Date.now(); await tulis(F.fakta, fakta); return sama; }
    const f = { id: id6(), teks, kategori: String(kategori || "umum").slice(0, 30), penting: clamp(penting, 1, 5), at: Date.now() };
    fakta.push(f);
    if (fakta.length > MAX_FAKTA) {
      // buang yang paling tidak penting & paling lama
      fakta.sort((a, b) => b.penting - a.penting || b.at - a.at);
      fakta = fakta.slice(0, MAX_FAKTA);
    }
    await tulis(F.fakta, fakta);
    return f;
  }
  async function lupakan(id) {
    const n = fakta.length;
    fakta = fakta.filter((f) => f.id !== id);
    if (fakta.length !== n) await tulis(F.fakta, fakta);
    return fakta.length !== n;
  }
  // Ingatan yang ditempel ke prompt: paling penting dulu, lalu terbaru, hingga batas karakter.
  function faktaUntukPrompt(maks = 7000) {
    const urut = [...fakta].sort((a, b) => b.penting - a.penting || b.at - a.at);
    const out = [];
    let n = 0;
    for (const f of urut) {
      const baris = `- [${f.id}] (${f.kategori}) ${f.teks}`;
      if (n + baris.length > maks) break;
      out.push(baris); n += baris.length;
    }
    return { teks: out.join("\n"), tersisa: fakta.length - out.length };
  }
  // Pencarian kata kunci sederhana atas fakta + seluruh riwayat obrolan (ingatan jangka panjang).
  function cari(q, maks = 12) {
    const kata = String(q || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    if (!kata.length) return [];
    const skor = (t) => kata.reduce((s, w) => s + (t.toLowerCase().includes(w) ? 1 : 0), 0);
    const hasil = [
      ...fakta.map((f) => ({ jenis: "fakta", id: f.id, teks: f.teks, at: f.at, s: skor(f.teks) + 0.5 })),
      ...riwayat.map((m) => ({ jenis: m.peran, teks: m.teks.slice(0, 300), at: m.at, s: skor(m.teks) })),
    ].filter((h) => h.s >= Math.min(kata.length, 2) || (kata.length === 1 && h.s >= 1));
    return hasil.sort((a, b) => b.s - a.s || b.at - a.at).slice(0, maks);
  }

  // --- Riwayat ---
  async function catat(peran, teks, extra = {}) {
    const m = { peran, teks: String(teks), at: Date.now(), ...extra };
    riwayat.push(m);
    await fs.appendFile(F.riwayat, JSON.stringify(m) + "\n");
    return m;
  }

  // --- Kepribadian: terapkan blok <meta> dari model, dengan batas perubahan per pesan ---
  async function terapkanMeta(meta = {}, alasanDefault = "") {
    const ubah = {};
    const s = meta.sifat && typeof meta.sifat === "object" ? meta.sifat : {};
    for (const k of Object.keys(SIFAT)) {
      const d = num(s[k], 2);
      if (d) { jiwa.sifat[k] = clamp(jiwa.sifat[k] + d, 5, 95); ubah[k] = d; }
    }
    const dk = num(meta.kedekatan, 2);
    if (dk) { jiwa.kedekatan = clamp(jiwa.kedekatan + dk); ubah.kedekatan = dk; }
    const m = moodSekarang();
    jiwa.mood = {
      nama: String(meta.mood || m.nama).slice(0, 24),
      energi: clamp(m.energi + num(meta.energi, 15)),
      valensi: clamp(m.valensi + num(meta.valensi, 15)),
    };
    if (meta.gaya_baru && typeof meta.gaya_baru === "string") {
      const g = meta.gaya_baru.trim().slice(0, 160);
      if (g && !jiwa.gaya.some((x) => x.toLowerCase() === g.toLowerCase())) {
        jiwa.gaya.push(g);
        if (jiwa.gaya.length > MAX_GAYA) jiwa.gaya.shift();
      }
    }
    if (typeof meta.julukan === "string" && meta.julukan.trim()) jiwa.julukan = meta.julukan.trim().slice(0, 30);
    if (Object.keys(ubah).length) {
      jiwa.perubahan.push({ at: Date.now(), ubah, alasan: String(meta.alasan || alasanDefault).slice(0, 160) });
      if (jiwa.perubahan.length > 40) jiwa.perubahan.shift();
    }
    jiwa.interaksi += 1;
    jiwa.terakhir = Date.now();
    await tulis(F.jiwa, jiwa);
    // Fakta baru yang ingin diingat (gratis, tanpa panggilan alat).
    const baru = [];
    for (const x of Array.isArray(meta.ingat) ? meta.ingat.slice(0, 5) : []) {
      const f = typeof x === "string" ? await ingat(x) : await ingat(x?.teks, x?.kategori, x?.penting);
      if (f) baru.push(f);
    }
    return { ubah, baru };
  }

  async function simpanRingkasan(teks, sampai) {
    ringkasan = { teks: String(teks).slice(0, 6000), sampai, at: Date.now() };
    await tulis(F.ringkasan, ringkasan);
  }
  async function tambahBiaya(usd) {
    const b = new Date().toISOString().slice(0, 7);
    if (biaya.bulan !== b) Object.assign(biaya, { bulan: b, bulanIni: 0 });
    biaya.total += usd; biaya.bulanIni += usd;
    await tulis(F.biaya, biaya);
  }

  async function reset(apa) {
    if (apa === "riwayat" || apa === "semua") {
      riwayat = []; ringkasan = { teks: "", sampai: 0 };
      await fs.rm(F.riwayat, { force: true }); await fs.rm(F.ringkasan, { force: true });
    }
    if (apa === "memori" || apa === "semua") { fakta = []; await fs.rm(F.fakta, { force: true }); }
    if (apa === "kepribadian" || apa === "semua") { jiwa = jiwaAwal(); await fs.rm(F.jiwa, { force: true }); }
  }

  // Pesan pada tanggal tertentu (YYYY-MM-DD, zona lokal server)
  const tanggal = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: process.env.AIRA_TZ || "Asia/Jakarta" });
  const pesanTanggal = (tgl) => riwayat.filter((m) => tanggal(m.at) === tgl);

  return {
    muat, ingat, tanggal, pesanTanggal, lupakan, cari, catat, terapkanMeta, simpanRingkasan, tambahBiaya, reset,
    faktaUntukPrompt, moodSekarang,
    get fakta() { return fakta; },
    get jiwa() { return jiwa; },
    get riwayat() { return riwayat; },
    get ringkasan() { return ringkasan; },
    get biaya() { return biaya; },
  };
}
