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
import { buatPenyimpanan, tahapHubungan, SIFAT } from "./memori.js";
import { buatOtak, NAMA, PENGGUNA } from "./otak.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.AIRA_DATA || path.join(here, "data"));
const KERJA = path.join(DATA, "ruang-kerja");
const MODEL = path.join(DATA, "model");
const PENGATURAN = path.join(DATA, "pengaturan.json");
const PUBLIC = path.join(here, "public");
const NM = path.join(here, "node_modules");
const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const PASSWORD = process.env.AIRA_PASSWORD || "";
const DEMO = process.env.AIRA_DEMO === "1";
const MAX_MODEL = 80 * 1024 * 1024;

await fs.mkdir(KERJA, { recursive: true });
await fs.mkdir(MODEL, { recursive: true });
const mem = buatPenyimpanan(DATA);
await mem.muat();
const otak = buatOtak({ mem, dataDir: DATA, kerjaDir: KERJA, demo: DEMO });

const guard = makeAuth(PASSWORD, {
  name: NAMA, tagline: `Masuk untuk bertemu ${NAMA}.`, iconHref: "/icon.svg",
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
  try { return JSON.parse(await fs.readFile(PENGATURAN, "utf8")); } catch { return {}; }
}
async function daftarModel() {
  const out = [];
  for (const d of await fs.readdir(MODEL).catch(() => [])) {
    try { out.push({ ...JSON.parse(await fs.readFile(path.join(MODEL, d, "model.json"), "utf8")), id: d }); } catch {}
  }
  return out.sort((a, b) => (a.jenis === "rocketbox") - (b.jenis === "rocketbox") || a.nama.localeCompare(b.nama));
}

function ringkasJiwa() {
  const j = mem.jiwa;
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
        nama: NAMA, pengguna: PENGGUNA, demo: DEMO, jiwa: ringkasJiwa(), memori: mem.fakta.length,
        biaya: mem.biaya, pengaturan: await bacaPengaturan(), model: await daftarModel(),
      });
    }
    if (p === "/api/pengaturan" && req.method === "POST") {
      const b = await readJson(req);
      const lama = await bacaPengaturan();
      const baru = { ...lama, ...b };
      await fs.writeFile(PENGATURAN, JSON.stringify(baru, null, 1));
      return json(res, 200, baru);
    }
    if (p === "/api/riwayat" && req.method === "GET") {
      const n = Math.min(200, Number(url.searchParams.get("n") || 60));
      return json(res, 200, { riwayat: mem.riwayat.slice(-n) });
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
      await mem.catat("aku", pesan, { mode });
      let hasil = { teks: "", meta: null, biaya: 0 };
      try {
        hasil = await otak.jawab({ pesan, mode, isyarat: b.isyarat || {}, kirim, abortController: ac });
      } catch (e) {
        if (!ac.signal.aborted) kirim({ t: "error", v: String(e?.message || e).slice(0, 300) });
      }
      if (berjalan === ac) berjalan = null;
      const dipotong = ac.signal.aborted;
      if (hasil.teks) await mem.catat(NAMA, hasil.teks + (dipotong ? " …(disela)" : ""), { mode });
      let efek = { ubah: {}, baru: [] };
      if (hasil.meta && !dipotong) efek = await mem.terapkanMeta(hasil.meta);
      else if (hasil.teks) efek = await mem.terapkanMeta({});
      if (hasil.biaya) await mem.tambahBiaya(hasil.biaya);
      kirim({ t: "done", jiwa: ringkasJiwa(), ubah: efek.ubah, ingatanBaru: efek.baru.map((f) => f.teks), biaya: hasil.biaya });
      try { res.end(); } catch {}
      otak.ringkasBilaPerlu().catch((e) => console.warn("ringkas:", e?.message || e));
      return;
    }
    if (p === "/api/stop" && req.method === "POST") { berjalan?.abort(); return json(res, 200, { ok: true }); }

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
      if (![".vrm", ".glb"].includes(ext)) return json(res, 400, { error: "Hanya .vrm atau .glb" });
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
        jenis: ext.slice(1), berkas: `model${ext}`, at: Date.now(),
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

server.listen(PORT, HOST, () => {
  console.log(`💗 ${NAMA} di http://${HOST}:${PORT}  · data: ${DATA}  · ${DEMO ? "MODE DEMO" : "otak: Claude (langganan)"}  · kata sandi: ${PASSWORD ? "aktif" : "tidak ada (hanya aman di 127.0.0.1)"}`);
});
