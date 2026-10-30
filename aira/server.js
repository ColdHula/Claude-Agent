// Aira — pendamping 3D dengan memori, kepribadian dinamis, akses web, dan mode bicara langsung.
// Aplikasi TERPISAH dari Kantor PGA dan HvM AI: data sendiri (AIRA_DATA), kata sandi sendiri,
// dan di rig berjalan sebagai pengguna Linux sendiri tanpa akses ke file/jaringan lokal
// (lihat deploy/pasang-aira.sh).
import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeAuth } from "../src/auth.js";
import { tahapHubungan, SIFAT } from "./memori.js";
import { buatOtak, PENGGUNA, ADEGAN } from "./otak.js";
import { buatKarakter, ARKETIPE } from "./karakter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.AIRA_DATA || path.join(here, "data"));
const KERJA = path.join(DATA, "ruang-kerja");
const MODEL = path.join(DATA, "model");
const NAMA_APP = process.env.AIRA_NAMA || "Aira";
const TZ = process.env.AIRA_TZ || "Asia/Jakarta";
const PUBLIC = path.join(here, "public");
const NM = path.join(here, "node_modules");
const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const PASSWORD = process.env.AIRA_PASSWORD || "";
const DEMO = process.env.AIRA_DEMO === "1";
const MAX_MODEL = 80 * 1024 * 1024;
// Mode Premium: layanan GPU Ditto lewat Unix socket (deploy/pasang-ditto.sh). Kosong = mati.
const DITTO_SOCK = process.env.AIRA_DITTO_SOCK || "";

function ditto(method, p, body = null, tipe = "application/json") {
  return new Promise((resolve, reject) => {
    const r = http.request({ socketPath: DITTO_SOCK, path: p, method, timeout: 120_000,
      headers: body ? { "content-type": tipe, "content-length": body.length } : {} }, (res) => {
      const bag = [];
      res.on("data", (c) => bag.push(c));
      res.on("end", () => resolve({ status: res.statusCode, tipe: res.headers["content-type"] || "", data: Buffer.concat(bag) }));
    });
    r.on("timeout", () => r.destroy(new Error("waktu habis")));
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

await fs.mkdir(KERJA, { recursive: true });
await fs.mkdir(MODEL, { recursive: true });
const K = buatKarakter(DATA);
await K.migrasi();
// Karakter aktif: profil, penyimpanan (memori/kepribadian/riwayat), otak, dan file pengaturannya
let aktif = null;
async function muatAktif() {
  const id = await K.idAktif();
  const profil = await K.profil(id);
  const mem = await K.penyimpanan(id);
  aktif = { id, profil, mem, fileAtur: path.join(K.dir(id), "pengaturan.json") };
  aktif.otak = buatOtak({ mem, dataDir: DATA, kerjaDir: KERJA, demo: DEMO, lemari, nama: profil.nama, tambahan: K.personaTambahan(profil) });
}
// Lemari: Aira bisa melihat & mengganti pakaian/penampilannya sendiri lewat alat ganti_baju.
const lemari = {
  async kini() {
    const P = await bacaPengaturan(), semua = await daftarModel();
    const m = semua.find((x) => x.id === P.model) || semua.find((x) => x.jenis !== "rocketbox") || semua[0];
    const b = m?.jenis === "rocketbox" && P.baju ? semua.find((x) => x.id === P.baju) : null;
    return { model: m, baju: b, semua };
  },
  // Pilihan pakaian yang menjaga wajah tetap sama: baju Rocketbox lain, atau model dengan "karakter" yang sama.
  async pilihan() {
    const { model: m, semua } = await this.kini();
    if (!m) return [];
    if (m.jenis === "rocketbox") return [{ id: "asli", nama: "Baju asli", gaya: m.gaya },
      ...semua.filter((x) => x.jenis === "rocketbox" && x.id !== m.id).map((x) => ({ id: x.id, nama: `Baju dari ${x.nama}`, gaya: x.gaya }))];
    if (m.karakter) return semua.filter((x) => x.karakter === m.karakter).map((x) => ({ id: x.id, nama: x.nama, gaya: x.gaya }));
    return [];
  },
  async ringkas() {
    const { model: m, baju: b } = await this.kini();
    if (!m) return "avatar bawaan";
    return b ? `${m.nama} dengan baju dari ${b.nama} (${b.gaya})` : `${m.nama} (${m.gaya || m.jenis})`;
  },
  async pakai(id) {
    const { model: m } = await this.kini();
    const opsi = await this.pilihan();
    if (!opsi.some((o) => o.id === id)) return false;
    const lama = await bacaPengaturan();
    const baru = m.jenis === "rocketbox" ? { ...lama, baju: id === "asli" ? null : id } : { ...lama, model: id, baju: null };
    await simpanPengaturan(baru);
    return true;
  },
  // Album foto karakter: potret yang ditandai dengan nama/tag karakter ini (plus avatar yang sedang dipakai)
  async album() {
    const { model: m, semua } = await this.kini();
    const tag = String(aktif.profil.tag || aktif.profil.nama).toLowerCase();
    return semua.filter((x) => x.jenis === "potret" && (x.id === m?.id || String(x.karakter || "").toLowerCase() === tag))
      .map((x) => ({ id: x.id, nama: x.nama, gaya: x.gaya, url: `/model/${x.id}/${x.berkas}` }));
  },
  async adegan() { return (await bacaPengaturan()).adegan || "rumah"; },
  async aturAdegan(v) { if (ADEGAN[v]) await simpanPengaturan({ ...(await bacaPengaturan()), adegan: v }); },
};
await muatAktif();

const guard = makeAuth(PASSWORD, {
  name: NAMA_APP, tagline: `Masuk untuk bertemu ${NAMA_APP}.`, iconHref: "/icon.svg",
  themeColor: "#140f1c", dark: true, accent: "#ff8fb1",
});
if (!PASSWORD && HOST !== "127.0.0.1" && HOST !== "localhost") {
  console.error("AIRA_PASSWORD wajib diisi bila HOST bukan 127.0.0.1."); process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".webp": "image/webp", ".jpeg": "image/jpeg",
  ".fbx": "application/octet-stream", ".vrm": "model/gltf-binary", ".glb": "model/gltf-binary",
};
// Pustaka 3D & pelacak wajah dilayani dari node_modules (tanpa CDN; tetap jalan bila internet lambat).
const VENDOR = {
  "/vendor/three/": path.join(NM, "three"),
  "/vendor/three-vrm/": path.join(NM, "@pixiv", "three-vrm", "lib"),
  "/vendor/mediapipe/": path.join(NM, "@mediapipe", "tasks-vision"),
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
async function readJson(req, limit = 256 * 1024) {
  let data = "";
  for await (const c of req) { data += c; if (data.length > limit) throw new Error("terlalu besar"); }
  return data ? JSON.parse(data) : {};
}
async function kirimBerkas(res, file, cache = "no-cache") {
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) return json(res, 404, { error: "tidak ada" });
  res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "content-length": st.size, "cache-control": cache });
  createReadStream(file).pipe(res);
}
const di = (dasar, rel) => { // path aman di dalam folder dasar
  const f = path.resolve(dasar, "." + path.sep + rel);
  return f.startsWith(dasar + path.sep) ? f : null;
};

async function bacaPengaturan() {
  try { return JSON.parse(await fs.readFile(aktif.fileAtur, "utf8")); } catch { return {}; }
}
const simpanPengaturan = (d) => fs.writeFile(aktif.fileAtur, JSON.stringify(d, null, 1));
async function daftarModel() {
  const out = [];
  for (const d of await fs.readdir(MODEL).catch(() => [])) {
    try { out.push({ ...JSON.parse(await fs.readFile(path.join(MODEL, d, "model.json"), "utf8")), id: d }); } catch {}
  }
  return out.sort((a, b) => (a.jenis === "rocketbox") - (b.jenis === "rocketbox") || a.nama.localeCompare(b.nama));
}

function ringkasJiwa() {
  const mem = aktif.mem, j = mem.jiwa;
  return {
    sifat: j.sifat, label: SIFAT, kedekatan: j.kedekatan, tahap: tahapHubungan(j.kedekatan),
    mood: mem.moodSekarang(), gaya: j.gaya, julukan: j.julukan, interaksi: j.interaksi,
    perubahan: j.perubahan.slice(-12).reverse(), terakhir: j.terakhir,
  };
}

// Satu percakapan berjalan pada satu waktu; pesan baru (mis. menyela saat bicara) membatalkan yang lama.
let berjalan = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  try {
    if (guard && (await guard(req, res, url))) return;
    const p = url.pathname;

    if (p === "/api/state" && req.method === "GET") {
      return json(res, 200, {
        nama: aktif.profil.nama, pengguna: PENGGUNA, demo: DEMO, jiwa: ringkasJiwa(), memori: aktif.mem.fakta.length,
        biaya: aktif.mem.biaya, pengaturan: await bacaPengaturan(), model: await daftarModel(),
        karakter: { aktif: aktif.profil, semua: await K.daftar(), arketipe: Object.fromEntries(Object.entries(ARKETIPE).map(([k, v]) => [k, v.label])) },
        adegan: ADEGAN,
      });
    }
    if (p === "/api/pengaturan" && req.method === "POST") {
      const b = await readJson(req);
      const lama = await bacaPengaturan();
      const baru = { ...lama, ...b };
      await simpanPengaturan(baru);
      return json(res, 200, baru);
    }
    if (p === "/api/riwayat" && req.method === "GET") {
      const n = Math.min(200, Number(url.searchParams.get("n") || 60));
      return json(res, 200, { riwayat: aktif.mem.riwayat.slice(-n) });
    }

    if (p === "/api/chat" && req.method === "POST") {
      const b = await readJson(req);
      const pesan = String(b.pesan || "").trim().slice(0, 8000);
      if (!pesan) return json(res, 400, { error: "pesan kosong" });
      const mode = b.mode === "live" ? "live" : "teks";
      berjalan?.abort();
      const ac = new AbortController();
      berjalan = ac;
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
      let hidup = true;
      res.on("close", () => { hidup = false; if (!res.writableFinished) ac.abort(); });
      const kirim = (ev) => { if (hidup) try { res.write(JSON.stringify(ev) + "\n"); } catch { hidup = false; } };
      const { mem, otak } = aktif;
      const tahapLama = ringkasJiwa().tahap;
      await mem.catat("aku", pesan, { mode });
      let hasil = { teks: "", meta: null, biaya: 0 };
      try {
        hasil = await otak.jawab({ pesan, mode, isyarat: b.isyarat || {}, kirim, abortController: ac });
      } catch (e) {
        if (!ac.signal.aborted) kirim({ t: "error", v: String(e?.message || e).slice(0, 300) });
      }
      if (berjalan === ac) berjalan = null;
      const dipotong = ac.signal.aborted;
      if (hasil.teks || hasil.foto?.length) await mem.catat(aktif.profil.nama, (hasil.teks || "") + (dipotong ? " …(disela)" : ""), { mode, ...(hasil.foto?.length ? { foto: hasil.foto } : {}) });
      let efek = { ubah: {}, baru: [] };
      if (hasil.meta && !dipotong) efek = await mem.terapkanMeta(hasil.meta);
      else if (hasil.teks) efek = await mem.terapkanMeta({});
      if (hasil.biaya) await mem.tambahBiaya(hasil.biaya);
      const jiwaBaru = ringkasJiwa();
      kirim({ t: "done", jiwa: jiwaBaru, ubah: efek.ubah, ingatanBaru: efek.baru.map((f) => f.teks), biaya: hasil.biaya,
        ...(jiwaBaru.tahap !== tahapLama ? { level: { dari: tahapLama, ke: jiwaBaru.tahap } } : {}) });
      try { res.end(); } catch {}
      otak.ringkasBilaPerlu().catch((e) => console.warn("ringkas:", e?.message || e));
      return;
    }
    if (p === "/api/premium" && req.method === "GET") {
      if (!DITTO_SOCK) return json(res, 200, { ada: false });
      try { const r = await ditto("GET", "/status"); return json(res, 200, { ada: true, ...JSON.parse(r.data) }); }
      catch (e) { return json(res, 200, { ada: true, siap: false, galat: String(e.message || e) }); }
    }
    if (p === "/api/klip" && req.method === "POST") {
      if (!DITTO_SOCK) return json(res, 404, { error: "Mode premium belum dipasang." });
      const b = await readJson(req);
      const { model: m } = await lemari.kini();
      if (m?.jenis !== "potret") return json(res, 400, { error: "Mode premium butuh avatar Potret (foto)." });
      const minta = Buffer.from(JSON.stringify({ teks: String(b.teks || "").slice(0, 400), foto: m.id, emosi: b.emosi, suara: b.suara, laju: b.laju, nada: b.nada }));
      let r = await ditto("POST", "/klip", minta);
      if (r.status === 404) { // foto belum dikirim ke layanan GPU
        await ditto("PUT", `/foto/${m.id}`, await fs.readFile(path.join(MODEL, m.id, m.berkas)), "application/octet-stream");
        r = await ditto("POST", "/klip", minta);
      }
      res.writeHead(r.status, { "content-type": r.tipe, "cache-control": "no-store" });
      return res.end(r.data);
    }
    if (p === "/api/stop" && req.method === "POST") { berjalan?.abort(); return json(res, 200, { ok: true }); }

    // --- Karakter ---
    if (p === "/api/karakter" && req.method === "POST") {
      const b = await readJson(req);
      const pr = await K.buat(b);
      if (b.pilih !== false) { await K.pilih(pr.id); berjalan?.abort(); await muatAktif(); }
      return json(res, 200, pr);
    }
    if (p === "/api/karakter/pilih" && req.method === "POST") {
      await K.pilih((await readJson(req)).id); berjalan?.abort(); await muatAktif();
      return json(res, 200, { ok: true });
    }
    if (p === "/api/karakter/ubah" && req.method === "POST") {
      const b = await readJson(req);
      const pr = await K.ubah(b.id || aktif.id, b);
      if ((b.id || aktif.id) === aktif.id) await muatAktif();
      return json(res, 200, pr);
    }
    if (p.startsWith("/api/karakter/") && req.method === "DELETE") {
      await K.hapus(p.slice(14)); await muatAktif();
      return json(res, 200, { ok: true });
    }
    // --- Pesan proaktif & buku harian ---
    if (p === "/api/notif" && req.method === "GET") {
      const sejak = Number(url.searchParams.get("sejak") || 0);
      return json(res, 200, { pesan: aktif.mem.riwayat.filter((m) => m.proaktif && m.at > sejak), sekarang: Date.now() });
    }
    if (p === "/api/diari" && req.method === "GET") return json(res, 200, { diari: (await bacaDiari()).slice().reverse() });
    if (p === "/api/diari" && req.method === "POST") {
      const tgl = aktif.mem.tanggal(Date.now());
      const teks = await aktif.otak.diari(tgl);
      if (!teks) return json(res, 400, { error: "Belum ada obrolan hari ini." });
      await simpanDiari(tgl, teks);
      return json(res, 200, { tgl, teks });
    }

    const mem = aktif.mem;
    if (p === "/api/memori" && req.method === "GET") return json(res, 200, { memori: [...mem.fakta].sort((a, b) => b.at - a.at) });
    if (p === "/api/memori" && req.method === "POST") {
      const b = await readJson(req);
      return json(res, 200, { fakta: await mem.ingat(b.teks, b.kategori || "dari-pengguna", b.penting || 4) });
    }
    if (p.startsWith("/api/memori/") && req.method === "DELETE") return json(res, 200, { ok: await mem.lupakan(p.slice(12)) });
    if (p === "/api/reset" && req.method === "POST") {
      const b = await readJson(req);
      if (!["riwayat", "memori", "kepribadian", "semua"].includes(b.apa)) return json(res, 400, { error: "apa?" });
      await mem.reset(b.apa);
      return json(res, 200, { ok: true });
    }

    // Berkas hasil kerja Aira (folder kerjanya sendiri)
    if (p === "/api/berkas" && req.method === "GET") {
      const out = [];
      for (const f of await fs.readdir(KERJA).catch(() => [])) {
        const st = await fs.stat(path.join(KERJA, f)).catch(() => null);
        if (st?.isFile()) out.push({ nama: f, ukuran: st.size, at: st.mtimeMs });
      }
      return json(res, 200, { berkas: out.sort((a, b) => b.at - a.at) });
    }
    if (p.startsWith("/api/berkas/")) {
      const f = di(KERJA, path.basename(decodeURIComponent(p.slice(12))));
      if (!f) return json(res, 403, { error: "forbidden" });
      if (req.method === "DELETE") { await fs.rm(f, { force: true }); return json(res, 200, { ok: true }); }
      res.setHeader("content-disposition", `attachment; filename="${path.basename(f).replace(/"/g, "")}"`);
      return kirimBerkas(res, f);
    }

    // Model avatar: unggah VRM/GLB sendiri (mis. dari VRoid Studio, MetaPerson, Avaturn)
    if (p === "/api/model" && req.method === "PUT") {
      const nama = String(url.searchParams.get("nama") || "avatar.vrm");
      const ext = path.extname(nama).toLowerCase();
      const FOTO = [".jpg", ".jpeg", ".png", ".webp"];
      if (![".vrm", ".glb", ...FOTO].includes(ext)) return json(res, 400, { error: "Hanya .vrm, .glb, atau foto .jpg/.png/.webp" });
      const id = `kustom_${crypto.randomBytes(4).toString("hex")}`;
      const dir = path.join(MODEL, id);
      await fs.mkdir(dir, { recursive: true });
      const fh = await fs.open(path.join(dir, `model${ext}`), "w");
      let n = 0;
      try {
        for await (const c of req) {
          n += c.length;
          if (n > MAX_MODEL) throw new Error("File terlalu besar (maks. 80 MB).");
          await fh.write(c);
        }
      } catch (e) { await fh.close(); await fs.rm(dir, { recursive: true, force: true }); return json(res, 413, { error: e.message }); }
      await fh.close();
      const info = {
        id, nama: String(url.searchParams.get("label") || path.basename(nama, ext)).slice(0, 40),
        gaya: String(url.searchParams.get("gaya") || "Kustom").slice(0, 20),
        karakter: String(url.searchParams.get("karakter") || "").slice(0, 40),
        jenis: FOTO.includes(ext) ? "potret" : ext.slice(1), berkas: `model${ext}`, at: Date.now(),
      };
      await fs.writeFile(path.join(dir, "model.json"), JSON.stringify(info, null, 1));
      return json(res, 200, info);
    }
    if (p.startsWith("/api/model/") && req.method === "DELETE") {
      const id = path.basename(p.slice(11));
      if (!/^kustom_[a-f0-9]{8}$/.test(id)) return json(res, 400, { error: "Hanya model unggahan yang bisa dihapus di sini." });
      await fs.rm(path.join(MODEL, id), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (p.startsWith("/model/")) {
      const f = di(MODEL, decodeURIComponent(p.slice(7)));
      return f ? kirimBerkas(res, f, "private, max-age=86400") : json(res, 403, { error: "forbidden" });
    }

    for (const [awal, dasar] of Object.entries(VENDOR)) {
      if (p.startsWith(awal)) {
        const f = di(dasar, p.slice(awal.length));
        return f ? kirimBerkas(res, f, "public, max-age=604800") : json(res, 403, { error: "forbidden" });
      }
    }

    const f = di(PUBLIC, p === "/" ? "index.html" : decodeURIComponent(p.slice(1)));
    if (!f) return json(res, 403, { error: "forbidden" });
    return kirimBerkas(res, f);
  } catch (e) {
    try { json(res, 500, { error: String(e?.message || e) }); } catch {}
  }
});

// --- Buku harian (per karakter) ---
const fileDiari = () => path.join(K.dir(aktif.id), "diari.json");
async function bacaDiari() { try { return JSON.parse(await fs.readFile(fileDiari(), "utf8")); } catch { return []; } }
async function simpanDiari(tgl, teks) {
  const d = (await bacaDiari()).filter((x) => x.tgl !== tgl);
  d.push({ tgl, teks, at: Date.now() });
  d.sort((a, b) => a.tgl.localeCompare(b.tgl));
  await fs.writeFile(fileDiari(), JSON.stringify(d.slice(-400), null, 1));
}

// --- Penjadwal: karakter menyapa lebih dulu (pagi, malam, kangen) & menulis buku harian ---
// Hanya karakter aktif; matikan lewat Pengaturan (proaktif: false). Memakai model ringan (biaya kecil).
async function penjadwal() {
  try {
    const P = await bacaPengaturan();
    const mem = aktif.mem, r = mem.riwayat;
    if (!r.length) return;
    const now = Date.now(), hari = mem.tanggal(now);
    const [jam, menit] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
    const m = jam * 60 + menit;
    const terakhirAku = [...r].reverse().find((x) => x.peran === "aku")?.at || 0;
    const terakhirProaktif = [...r].reverse().find((x) => x.proaktif)?.at || 0;
    if (P.proaktif !== false) {
      let jenis = null;
      if (m >= 390 && m <= 570 && P.sapaPagi !== hari && now - terakhirAku > 2 * 3.6e6) jenis = "pagi";
      else if (m >= 1260 && m <= 1380 && P.sapaMalam !== hari && now - terakhirAku > 3.6e6) jenis = "malam";
      else if (now - terakhirAku > 20 * 3.6e6 && now - terakhirProaktif > 20 * 3.6e6 && m >= 600 && m <= 1260) jenis = "kangen";
      if (jenis) {
        const teks = await aktif.otak.sapa(jenis);
        if (teks) {
          await mem.catat(aktif.profil.nama, teks, { proaktif: true, jenis });
          await simpanPengaturan({ ...(await bacaPengaturan()), ...(jenis === "pagi" ? { sapaPagi: hari } : jenis === "malam" ? { sapaMalam: hari } : {}) });
        }
      }
    }
    // Buku harian kemarin (bila ada obrolan & belum ditulis), atau hari ini setelah 23:15
    const kemarin = mem.tanggal(now - 864e5);
    const ada = new Set((await bacaDiari()).map((x) => x.tgl));
    for (const tgl of m >= 1395 ? [kemarin, hari] : [kemarin]) {
      if (!ada.has(tgl) && mem.pesanTanggal(tgl).some((x) => x.peran === "aku")) {
        const teks = await aktif.otak.diari(tgl);
        if (teks) await simpanDiari(tgl, teks);
      }
    }
  } catch (e) { console.warn("penjadwal:", e?.message || e); }
}
setInterval(penjadwal, 5 * 60 * 1000);
setTimeout(penjadwal, 20 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`💗 ${NAMA_APP} (${aktif.profil.nama}) di http://${HOST}:${PORT}  · data: ${DATA}  · ${DEMO ? "MODE DEMO" : "otak: Claude (langganan)"}  · kata sandi: ${PASSWORD ? "aktif" : "tidak ada (hanya aman di 127.0.0.1)"}`);
});
