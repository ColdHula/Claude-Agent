// Pemuat "ruang bebas": tiap AI yang jarang menolak punya SATU berkas sendiri di folder ini
// (dolphin.js, venice.js, kustom.js, …). Satu berkas = satu tab di Studio, dengan kunci, model, instruksi sistem,
// dan arsip chat yang terpisah dari AI lain dan dari ruang Utama.
// - Menambah AI: salin _contoh.js menjadi <nama>.js, isi, restart Studio. Tidak ada berkas lain yang perlu diubah.
// - Menghapus AI: hapus berkasnya. Berkas yang rusak atau tidak lengkap hanya dilewati (yang lain tetap jalan).
// Berkas berawalan "_" diabaikan.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function validate(m, file) {
  if (!m || typeof m !== "object") throw new Error("tidak mengekspor objek default");
  if (!/^[\w-]{1,30}$/.test(m.id || "")) throw new Error("id harus 1–30 huruf/angka/-/_");
  if (`${m.id}.js` !== file) throw new Error(`nama berkas harus ${m.id}.js`);
  if (!m.tab || !m.name) throw new Error("tab dan name wajib");
  const p = m.provider;
  if (!p || p.kind !== "openai") throw new Error('provider.kind harus "openai" (endpoint kompatibel OpenAI)');
  if (p.id !== `bebas-${m.id}`) throw new Error(`provider.id harus bebas-${m.id}`);
}

export async function loadBebas() {
  const out = [];
  for (const f of (await fs.readdir(here)).sort()) {
    if (!f.endsWith(".js") || f.startsWith("_") || f === "index.js") continue;
    try {
      const m = (await import(pathToFileURL(path.join(here, f)).href)).default;
      validate(m, f);
      out.push({ window: 32_000, models: [], icon: "🔓", desc: "", ...m, models: m.models || m.provider.models || [] });
    } catch (e) {
      console.error(`  ⚠️ bebas/${f} dilewati: ${e.message}`);
    }
  }
  return out.sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.id.localeCompare(b.id));
}
