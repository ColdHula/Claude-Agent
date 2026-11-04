#!/usr/bin/env node
// Klien kecil FreeLLMAPI (OpenAI-compatible) untuk skill "freellmapi". Tanpa dependensi.
//
//   node tanya.mjs "Ringkas teks ini: ..."                 # model auto
//   node tanya.mjs --model auto:fast --file catatan.txt "Ringkas jadi 5 poin"
//   echo "teks panjang" | node tanya.mjs --system "Terjemahkan ke Inggris" -
//   node tanya.mjs --models                                # model yang siap dipakai
//   node tanya.mjs --cek                                   # cek koneksi + kunci
//
// Alamat & kunci: env FREELLMAPI_URL (mis. http://127.0.0.1:3011/v1) dan FREELLMAPI_KEY
// (diawali "freellmapi-"). Bila kosong, dibaca dari pengaturan Studio (studio/data/providers.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../../../..");

function config() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(path.join(appRoot, "studio", "data", "providers.json"), "utf8")).freellmapi || {};
  } catch {}
  let url = (process.env.FREELLMAPI_URL || saved.baseUrl || "http://127.0.0.1:3011/v1").replace(/\/+$/, "");
  if (!/\/v1$/.test(url)) url += "/v1";
  return { url, key: process.env.FREELLMAPI_KEY || saved.apiKey || "" };
}

function args(argv) {
  const o = { model: process.env.FREELLMAPI_MODEL || "auto", files: [], text: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" || a === "-m") o.model = argv[++i];
    else if (a === "--system" || a === "-s") o.system = argv[++i];
    else if (a === "--file" || a === "-f") o.files.push(argv[++i]);
    else if (a === "--max") o.max = Number(argv[++i]);
    else if (a === "--json") o.json = true;
    else if (a === "--models") o.models = true;
    else if (a === "--cek") o.cek = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else o.text.push(a);
  }
  return o;
}

const o = args(process.argv.slice(2));
const { url, key } = config();
const H = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };

if (o.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

async function main() {
  if (o.models || o.cek) {
    const r = await fetch(`${url}/models?available=true`, { headers: H, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} dari ${url}/models — ${(await r.text()).slice(0, 200)}`);
    const ids = ((await r.json()).data || []).map((m) => m.id);
    if (o.cek) console.log(`OK: ${url} terhubung, ${ids.length} model siap${key ? "" : " (tanpa kunci)"}.`);
    else console.log(["auto", "auto:smart", "auto:fast", "auto:reliable", ...ids].join("\n"));
    return;
  }
  let prompt = o.text.join(" ");
  if (prompt === "-" || (!prompt && !process.stdin.isTTY)) prompt = fs.readFileSync(0, "utf8");
  for (const f of o.files) prompt += `\n\n--- ${path.basename(f)} ---\n${fs.readFileSync(f, "utf8")}`;
  if (!prompt.trim()) throw new Error('Prompt kosong. Contoh: node tanya.mjs "Ringkas: ..."');
  if (!key) console.error("⚠️ FREELLMAPI_KEY belum diisi — permintaan mungkin ditolak.");

  const body = {
    model: o.model,
    messages: [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content: prompt }],
    ...(o.max ? { max_tokens: o.max } : {}),
  };
  const r = await fetch(`${url}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  const j = JSON.parse(t);
  const via = r.headers.get("x-routed-via") || j.model || "?";
  if (o.json) console.log(JSON.stringify({ via, text: j.choices?.[0]?.message?.content || "", usage: j.usage }, null, 2));
  else {
    console.log(j.choices?.[0]?.message?.content || "");
    console.error(`[freellmapi: ${via}${j.usage ? `, ${j.usage.prompt_tokens}+${j.usage.completion_tokens} token` : ""}]`);
  }
}

main().catch((e) => {
  const m = String(e.message || e);
  console.error(
    /ECONNREFUSED|fetch failed/.test(m)
      ? `❌ FreeLLMAPI tidak bisa dihubungi di ${url}. Nyalakan servernya (lihat SKILL.md) atau set FREELLMAPI_URL.`
      : `❌ ${m}`,
  );
  process.exit(1);
});
