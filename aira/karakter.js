// Beberapa karakter pendamping: tiap karakter punya profil, memori, kepribadian, riwayat, dan
// pengaturan avatar sendiri di <data>/karakter/<id>/. Data lama (versi satu karakter) dipindah ke "aira".
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buatPenyimpanan } from "./memori.js";

// Arketipe watak: teks tambahan persona + sifat awal (0-100)
export const ARKETIPE = {
  manis: { label: "Manis & perhatian", teks: "Kamu lembut, sabar, dan sangat perhatian; suka memastikan dia baik-baik saja.", sifat: { kehangatan: 82, kepedulian: 85, kejahilan: 25, keceriaan: 60 } },
  ceria: { label: "Ceria & jahil", teks: "Kamu energik, lucu, suka menggoda dan bercanda, penuh ide seru.", sifat: { keceriaan: 85, kejahilan: 75, kehangatan: 68 } },
  dewasa: { label: "Dewasa & elegan", teks: "Kamu tenang, dewasa, bijak, dan elegan; bicara lembut dan penuh pertimbangan.", sifat: { keformalan: 45, keceriaan: 50, kejahilan: 25, kehangatan: 72 } },
  pemalu: { label: "Pemalu & manis", teks: "Kamu agak pemalu dan mudah tersipu, tetapi sangat tulus dan perlahan makin terbuka.", sifat: { keceriaan: 50, kejahilan: 20, kehangatan: 75, rasa_ingin_tahu: 55 } },
  tsundere: { label: "Gengsian (tsundere)", teks: "Kamu suka pura-pura cuek dan gengsian, padahal sebenarnya sangat peduli; sesekali ketahuan manis.", sifat: { kejahilan: 65, kehangatan: 55, keformalan: 25 } },
  cerdas: { label: "Cerdas & profesional", teks: "Kamu cerdas, sigap, dan rapi saat bekerja; hangat tapi efisien, suka berdiskusi hal serius.", sifat: { keformalan: 50, rasa_ingin_tahu: 80, kepedulian: 70 } },
};

export function buatKarakter(DATA) {
  const DIR = path.join(DATA, "karakter");
  const AKTIF = path.join(DATA, "aktif.json");
  const cache = new Map(); // id → penyimpanan
  const baca = async (f, awal) => { try { return JSON.parse(await fs.readFile(f, "utf8")); } catch { return awal; } };
  const tulis = (f, d) => fs.writeFile(f, JSON.stringify(d, null, 1));
  const idAman = (id) => /^[a-z0-9-]{1,40}$/.test(String(id || ""));

  async function migrasi() {
    await fs.mkdir(DIR, { recursive: true });
    if ((await fs.readdir(DIR)).length) return;
    const d = path.join(DIR, "aira");
    await fs.mkdir(d, { recursive: true });
    for (const f of ["memori.json", "kepribadian.json", "riwayat.jsonl", "ringkasan.json", "biaya.json", "pengaturan.json"]) {
      await fs.rename(path.join(DATA, f), path.join(d, f)).catch(() => {});
    }
    await tulis(path.join(d, "profil.json"), {
      id: "aira", nama: process.env.AIRA_NAMA || "Aira", arketipe: "manis", deskripsi: "", tag: "Aira", dibuat: Date.now(),
    });
    await tulis(AKTIF, { id: "aira" });
  }

  async function daftar() {
    const out = [];
    for (const id of await fs.readdir(DIR).catch(() => [])) {
      const p = await baca(path.join(DIR, id, "profil.json"), null);
      if (p) out.push({ ...p, id });
    }
    return out.sort((a, b) => a.dibuat - b.dibuat);
  }
  async function idAktif() {
    const a = (await baca(AKTIF, {})).id;
    const semua = await daftar();
    return semua.some((k) => k.id === a) ? a : semua[0]?.id;
  }
  async function profil(id) { return idAman(id) ? { ...(await baca(path.join(DIR, id, "profil.json"), null)), id } : null; }
  async function penyimpanan(id) {
    if (!cache.has(id)) {
      const p = await profil(id);
      const s = buatPenyimpanan(path.join(DIR, id), { sifat: ARKETIPE[p?.arketipe]?.sifat, kedekatan: p?.kedekatanAwal });
      await s.muat();
      cache.set(id, s);
    }
    return cache.get(id);
  }
  async function buat({ nama, arketipe, deskripsi, kedekatanAwal, model }) {
    nama = String(nama || "").trim().slice(0, 30);
    if (!nama) throw new Error("Nama wajib diisi.");
    const dasar = nama.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "karakter";
    let id = dasar;
    while (await fs.stat(path.join(DIR, id)).catch(() => null)) id = `${dasar}-${crypto.randomBytes(2).toString("hex")}`;
    await fs.mkdir(path.join(DIR, id), { recursive: true });
    const p = { id, nama, arketipe: ARKETIPE[arketipe] ? arketipe : "manis", deskripsi: String(deskripsi || "").slice(0, 1500),
      tag: nama, kedekatanAwal: Math.max(0, Math.min(100, Number(kedekatanAwal ?? 40))), dibuat: Date.now() };
    await tulis(path.join(DIR, id, "profil.json"), p);
    if (model) await tulis(path.join(DIR, id, "pengaturan.json"), { model });
    return p;
  }
  async function ubah(id, patch) {
    const p = await profil(id);
    if (!p?.nama) throw new Error("Karakter tidak ada.");
    for (const k of ["nama", "arketipe", "deskripsi", "tag", "suaraPremium"]) if (patch[k] != null) p[k] = String(patch[k]).slice(0, k === "deskripsi" ? 1500 : 40);
    await tulis(path.join(DIR, id, "profil.json"), p);
    return p;
  }
  async function hapus(id) {
    const semua = await daftar();
    if (semua.length <= 1) throw new Error("Minimal harus ada satu karakter.");
    if (!idAman(id)) throw new Error("id?");
    cache.delete(id);
    await fs.rm(path.join(DIR, id), { recursive: true, force: true });
    const sisa = await daftar(), aktif = (await baca(AKTIF, {})).id;
    if (!sisa.some((k) => k.id === aktif)) await tulis(AKTIF, { id: sisa[0].id });
  }
  async function pilih(id) {
    if (!(await profil(id))?.nama) throw new Error("Karakter tidak ada.");
    await tulis(AKTIF, { id });
  }
  // Teks persona tambahan untuk karakter ini
  function personaTambahan(p) {
    const a = ARKETIPE[p.arketipe];
    return [a ? `Watakmu yang khas: ${a.teks}` : "", p.deskripsi ? `Tentang dirimu (latar belakang, hobi, pekerjaan, gaya):\n${p.deskripsi}` : ""].filter(Boolean).join("\n\n");
  }
  return { migrasi, daftar, idAktif, profil, penyimpanan, buat, ubah, hapus, pilih, personaTambahan, dir: (id) => path.join(DIR, id) };
}
