// Unduh model 3D realistis gratis (Microsoft Rocketbox, lisensi MIT) ke data/model/.
// Tekstur TGA 2048px (±12 MB) diperkecil jadi PNG 1024px agar ringan dibuka dari HP.
// Tanpa dependensi: TGA dibaca dan PNG ditulis dengan modul bawaan Node.
//
//   node aira/ambil-model.mjs                 → daftar model yang tersedia
//   node aira/ambil-model.mjs pilihan         → unduh paket pilihan (8 model)
//   node aira/ambil-model.mjs Female_Adult_05 Business_Female_02
//
// Dijalankan oleh pemilik rig (bukan oleh Aira). Butuh akses ke raw.githubusercontent.com.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.AIRA_DATA || path.join(here, "data"));
const OUT = path.join(DATA, "model");
const RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars";
const UKURAN = Number(process.env.AIRA_TEKSTUR || 1024);

// Katalog wanita dewasa. "gaya" membantu memilih baju saat fitur ganti baju (wajah tetap, badan dari model lain).
export const KATALOG = {
  Female_Adult_01: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_02: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_03: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_04: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_05: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_06: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_07: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_08: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_09: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_10: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_11: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_12: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_13: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_14: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_15: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_16: { folder: "Adults", gaya: "Kasual" },
  Female_Adult_17: { folder: "Adults", gaya: "Kasual" },
  Female_Party_01: { folder: "Adults", gaya: "Pesta" },
  Female_Party_02: { folder: "Adults", gaya: "Pesta" },
  Business_Female_01: { folder: "Professions", gaya: "Kantor" },
  Business_Female_02: { folder: "Professions", gaya: "Kantor" },
  Business_Female_03: { folder: "Professions", gaya: "Kantor" },
  Business_Female_04: { folder: "Professions", gaya: "Kantor" },
  Medical_Female_01: { folder: "Professions", gaya: "Medis" },
  Medical_Female_02: { folder: "Professions", gaya: "Medis" },
  Chef_Female_01: { folder: "Professions", gaya: "Koki" },
  Pilot_Female_01: { folder: "Professions", gaya: "Pilot" },
};
const PILIHAN = ["Female_Adult_01", "Female_Adult_05", "Female_Adult_08", "Female_Adult_12",
  "Female_Party_01", "Female_Party_02", "Business_Female_02", "Business_Female_04"];

// --- TGA (tak terkompresi / RLE, 24/32 bit) → RGBA ---
function bacaTga(buf) {
  const idLen = buf[0], tipe = buf[2], w = buf.readUInt16LE(12), h = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
  if (![2, 10].includes(tipe) || ![24, 32].includes(bpp)) throw new Error(`TGA tidak didukung (tipe ${tipe}, ${bpp} bit)`);
  const px = bpp / 8, out = Buffer.alloc(w * h * 4);
  let p = 18 + idLen + buf[1] * buf.readUInt16LE(5) * Math.ceil(buf[7] / 8), i = 0;
  const tulis = (o) => { out[i++] = buf[o + 2]; out[i++] = buf[o + 1]; out[i++] = buf[o]; out[i++] = px === 4 ? buf[o + 3] : 255; };
  if (tipe === 2) { for (let n = 0; n < w * h; n++, p += px) tulis(p); }
  else {
    while (i < out.length) {
      const c = buf[p++], n = (c & 127) + 1;
      if (c & 128) { for (let k = 0; k < n; k++) tulis(p); p += px; }
      else { for (let k = 0; k < n; k++, p += px) tulis(p); }
    }
  }
  if (!(desc & 0x20)) { // asal kiri-bawah → balik vertikal
    const baris = w * 4, tmp = Buffer.alloc(baris);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * baris, b = (h - 1 - y) * baris;
      out.copy(tmp, 0, a, a + baris); out.copy(out, a, b, b + baris); tmp.copy(out, b);
    }
  }
  return { w, h, data: out };
}
function perkecil({ w, h, data }, maks) {
  let f = 1;
  while (w / f > maks) f *= 2;
  if (f === 1) return { w, h, data };
  const W = w / f, H = h / f, out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += data[((y * f + dy) * w + x * f + dx) * 4 + c];
      out[(y * W + x) * 4 + c] = s / (f * f);
    }
  }
  return { w: W, h: H, data: out };
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png({ w, h, data }, alpha) {
  const ch = alpha ? 4 : 3, raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * (w * ch + 1) + 1 + x * ch + c] = data[(y * w + x) * 4 + c];
  }
  const potong = (tipe, isi) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(isi.length);
    const ti = Buffer.concat([Buffer.from(tipe), isi]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(ti));
    return Buffer.concat([len, ti, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), potong("IHDR", ihdr),
    potong("IDAT", zlib.deflateSync(raw, { level: 9 })), potong("IEND", Buffer.alloc(0))]);
}

async function unduh(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function ambil(nama) {
  const k = KATALOG[nama];
  if (!k) throw new Error(`Model "${nama}" tidak ada di katalog.`);
  const dir = path.join(OUT, nama);
  if (await fs.stat(path.join(dir, "model.json")).catch(() => null)) { console.log(`✓ ${nama} sudah ada`); return; }
  await fs.mkdir(dir, { recursive: true });
  const base = `${RAW}/${k.folder}/${nama}`;
  console.log(`↓ ${nama} …`);
  const fbx = await unduh(`${base}/Export/${nama}_facial.fbx`); // versi dengan blendshape wajah
  await fs.writeFile(path.join(dir, "model.fbx"), fbx);
  await fs.writeFile(path.join(dir, "pratinjau.png"), await unduh(`${base}/${nama}.png`).catch(() => Buffer.alloc(0)));
  // Tekstur yang dirujuk FBX: ambil warna & opasitas (normal map dilewati agar ringan).
  const rujukan = [...new Set(fbx.toString("latin1").match(/[\w-]+\.tga/gi) || [])];
  const tekstur = {};
  for (const t of rujukan) {
    if (/normal|specular|wrinkle/i.test(t)) continue;
    try {
      const img = perkecil(bacaTga(await unduh(`${base}/Textures/${t}`)), UKURAN);
      const alpha = /opacity/i.test(t);
      const keluar = t.replace(/\.tga$/i, ".png");
      await fs.writeFile(path.join(dir, keluar), png(img, alpha));
      tekstur[t.toLowerCase()] = keluar;
      process.stdout.write(`  · ${keluar}\n`);
    } catch (e) { console.warn(`  ! ${t}: ${e.message}`); }
  }
  await fs.writeFile(path.join(dir, "model.json"), JSON.stringify({
    id: nama, nama: nama.replace(/_/g, " "), gaya: k.gaya, jenis: "rocketbox", berkas: "model.fbx", tekstur,
    sumber: "Microsoft Rocketbox (MIT) — github.com/microsoft/Microsoft-Rocketbox",
  }, null, 1));
  console.log(`✓ ${nama}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2);
  if (!arg.length) {
    console.log("Model tersedia (Microsoft Rocketbox, MIT):\n");
    for (const [n, k] of Object.entries(KATALOG)) console.log(`  ${n.padEnd(20)} ${k.gaya}${PILIHAN.includes(n) ? "  ★ paket pilihan" : ""}`);
    console.log("\nUnduh:  node aira/ambil-model.mjs pilihan   atau   node aira/ambil-model.mjs <nama> …");
  } else {
    const daftar = arg[0] === "pilihan" ? PILIHAN : arg[0] === "semua" ? Object.keys(KATALOG) : arg;
    for (const n of daftar) { try { await ambil(n); } catch (e) { console.error(`✗ ${n}: ${e.message}`); } }
    console.log(`\nSelesai. Model ada di ${OUT}. Pilih di aplikasi lewat tombol 👗 Lemari.`);
  }
}
