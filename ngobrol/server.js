// Ngobrol — antarmuka chat sederhana untuk model lokal (Ollama) di rig.
// - Tanpa dependensi (hanya modul bawaan Node 22, ESM).
// - Browser tidak pernah menyentuh Ollama langsung; server ini yang meneruskan,
//   sehingga bisa dilindungi kata sandi dan dibuka aman lewat Tailscale.
// - Riwayat percakapan dan lampiran disimpan di ngobrol/data/ (tidak ikut Git).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";
import { makeAuth } from "../src/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "data");
const CHATS = path.join(DATA, "chats");
const FILES = path.join(DATA, "berkas");
const PENGETAHUAN = path.join(DATA, "pengetahuan"); // dokumen untuk RAG
const RAG_INDEX = path.join(DATA, "rag-index.json");
const PUBLIC = path.join(here, "public");

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const OLLAMA = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const PASSWORD = process.env.NGOBROL_PASSWORD || process.env.APP_PASSWORD || "";
const MAX_FILE = 20 * 1024 * 1024; // 20 MB per file
const INLINE_CHARS = 60_000; // berapa karakter isi file teks yang ditempel ke prompt
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text"; // model embedding untuk RAG
const RAG_TOPK = Number(process.env.RAG_TOPK || 4); // berapa potongan dokumen diambil per pertanyaan
const CHUNK = 1100, OVERLAP = 180;
// Batas jendela konteks (token) yang diminta ke Ollama. Model Qwen3 mengiklankan 256K,
// tapi di CPU + RAM 16 GB itu memboroskan memori & memperlambat. 4096 paling sehat untuk
// 16 GB (KV cache kecil, token pertama cepat). Naikkan lewat HVM_NUM_CTX bila punya SSD/RAM lebih.
const NUM_CTX = Number(process.env.HVM_NUM_CTX || process.env.NUM_CTX || 4096);
// Parameter sampling (cegah jawaban mengulang-ulang, mis. "juga juga juga…"). Qwen3 non-thinking:
// temp 0.7, top_p 0.8, top_k 20; repeat_penalty 1.1 + presence_penalty untuk meredam loop.
const SAMP = {
  temperature: Number(process.env.HVM_TEMP || 0.7),
  top_p: Number(process.env.HVM_TOP_P || 0.8),
  top_k: Number(process.env.HVM_TOP_K || 20),
  repeat_penalty: Number(process.env.HVM_REPEAT_PENALTY || 1.1),
  repeat_last_n: Number(process.env.HVM_REPEAT_LAST_N || 320),
  presence_penalty: Number(process.env.HVM_PRESENCE_PENALTY || 0.6),
  frequency_penalty: Number(process.env.HVM_FREQUENCY_PENALTY || 0.6), // standar OpenAI → dihormati endpoint /v1
};
// Mesin chat: "ollama" (API Ollama, bawaan) atau "openai" (OpenAI-compatible, mis. ik_llama.cpp
// llama-server). Embedding RAG SELALU lewat Ollama (OLLAMA). LLM_URL = alamat mesin chat.
const BACKEND = (process.env.HVM_BACKEND || "ollama").toLowerCase();
const LLM_URL = (process.env.LLM_URL || (BACKEND === "openai" ? "http://127.0.0.1:11435" : OLLAMA)).replace(/\/$/, "");
// Kunci pemilik: bila diisi, muncul Dashboard untuk memantau perangkat & chat teman.
const OWNER_KEY = process.env.HVM_OWNER_KEY || process.env.OWNER_KEY || "";
const USAGE = path.join(DATA, "usage.jsonl"); // log pertanyaan per perangkat
const DEVICES = path.join(DATA, "devices.json"); // ringkasan perangkat terkoneksi

await fs.mkdir(CHATS, { recursive: true });
await fs.mkdir(FILES, { recursive: true });
await fs.mkdir(PENGETAHUAN, { recursive: true });

// Persona "HvM": saat mesin chat menyajikan GGUF mentah (ik_llama, backend openai), model tidak
// punya SYSTEM bawaan seperti model 'hvm' di Ollama. Kita suntik persona dari sisi app agar gaya
// & aturan tetap sama. Sumber: HVM_SYSTEM (teks langsung) → HVM_SYSTEM_FILE → Modelfile.hvm.
let PERSONA = (process.env.HVM_SYSTEM || "").trim() || null;
if (!PERSONA && (BACKEND === "openai" || process.env.HVM_SYSTEM_FILE)) {
  const f = process.env.HVM_SYSTEM_FILE || path.join(here, "model-pribadi", "Modelfile.hvm");
  try {
    const t = await fs.readFile(f, "utf8");
    const m = t.match(/SYSTEM\s+"""([\s\S]*?)"""/);
    if (m) PERSONA = m[1].trim();
  } catch {}
}
// Lipat semua pesan 'system' (persona + mode Coding/Berpikir + RAG) jadi satu system di depan.
function withPersona(messages) {
  if (!PERSONA) return messages;
  const sys = [PERSONA], rest = [];
  for (const m of messages) {
    if (m.role === "system") sys.push(m.content);
    else rest.push({ role: m.role, content: m.content });
  }
  return [{ role: "system", content: sys.join("\n\n") }, ...rest];
}

const guard = makeAuth(PASSWORD, {
  name: "HvM AI",
  tagline: "Masukkan kata sandi untuk masuk.",
  iconHref: "/icon.svg",
  themeColor: "#0e0f13",
  dark: true,
  accent: "#ff7a59",
}); // null bila tanpa kata sandi (hanya untuk 127.0.0.1)

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};
const TEXT_EXT = new Set([".txt", ".md", ".js", ".ts", ".py", ".json", ".csv", ".html", ".css",
  ".sh", ".bash", ".c", ".cpp", ".h", ".java", ".go", ".rs", ".rb", ".php", ".sql", ".yml",
  ".yaml", ".toml", ".ini", ".env", ".log", ".xml", ".jsx", ".tsx", ".vue", ".bat", ".ps1"]);

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const safeName = (n) => String(n || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";
const okId = (s) => /^[a-z0-9]{6,32}$/.test(String(s || ""));

async function readBody(req, limit = 4 * 1024 * 1024) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("terlalu besar");
  }
  return data ? JSON.parse(data) : {};
}

// --- Riwayat percakapan ---
async function listChats(cid = null, all = false) {
  const names = (await fs.readdir(CHATS).catch(() => [])).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of names) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(CHATS, f), "utf8"));
      if (!all && cid && c.client !== cid) continue; // tiap orang hanya melihat chatnya sendiri
      out.push({ id: c.id, title: c.title || "(tanpa judul)", at: c.at || 0, model: c.model || "", who: c.who || "", client: c.client || "", pending: !!c.pending });
    } catch {}
  }
  return out.sort((a, b) => b.at - a.at);
}
const chatPath = (id) => path.join(CHATS, `${id}.json`);
async function saveChat(c) {
  c.at = Date.now();
  await fs.writeFile(chatPath(c.id), JSON.stringify(c));
}

// --- RAG: pengetahuan dokumen pribadi ---
// Index di memori + disk: [{id, doc, name, text, vec:[...]}]
let ragIndex = [];
try { ragIndex = JSON.parse(await fs.readFile(RAG_INDEX, "utf8")); } catch {}
const saveRag = () => fs.writeFile(RAG_INDEX, JSON.stringify(ragIndex)).catch(() => {});

async function embed(text) {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d.embedding)) throw new Error("embedding kosong");
  return d.embedding;
}
function chunkText(t) {
  const out = [];
  t = String(t).replace(/\r/g, "");
  for (let i = 0; i < t.length; i += CHUNK - OVERLAP) {
    const s = t.slice(i, i + CHUNK).trim();
    if (s.length > 40) out.push(s);
    if (i + CHUNK >= t.length) break;
  }
  return out;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
async function addKnowledge(name, text) {
  const doc = crypto.randomBytes(5).toString("hex");
  const chunks = chunkText(text);
  let added = 0;
  for (const chunk of chunks) {
    const vec = await embed(chunk); // bisa lempar error bila model embedding belum ada
    ragIndex.push({ id: crypto.randomBytes(6).toString("hex"), doc, name, text: chunk, vec });
    added++;
  }
  await saveRag();
  return { doc, chunks: added };
}
function listKnowledge() {
  const by = new Map();
  for (const e of ragIndex) {
    const k = by.get(e.doc) || { doc: e.doc, name: e.name, chunks: 0 };
    k.chunks++; by.set(e.doc, k);
  }
  return [...by.values()];
}
async function retrieve(query, k = RAG_TOPK) {
  if (!ragIndex.length) return [];
  const qv = await embed(query);
  return ragIndex
    .map((e) => ({ name: e.name, text: e.text, score: cosine(qv, e.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((e) => e.score > 0.25);
}

// --- Identitas perangkat & pemantauan pemilik ---
function deviceLabel(ua = "") {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /CrOS/.test(ua) ? "ChromeOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "?";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} · ${os}`;
}
function clientOf(req) {
  const h = req.headers;
  const ua = String(h["user-agent"] || "");
  let who = "";
  try { who = decodeURIComponent(String(h["x-hvm-who"] || "")).slice(0, 40); } catch {}
  const cid = /^[a-z0-9]{6,40}$/.test(String(h["x-hvm-cid"] || "")) ? h["x-hvm-cid"] : "";
  const ip = (String(h["x-forwarded-for"] || "").split(",")[0] || req.socket.remoteAddress || "").trim();
  return { cid, who: who || "(tanpa nama)", ua, device: deviceLabel(ua), ip };
}
const cookieVal = (req, name) => {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
};
const ownerToken = OWNER_KEY ? crypto.createHmac("sha256", OWNER_KEY).update("hvm-owner-v1").digest("hex") : "";
function ownerOk(req) {
  if (!OWNER_KEY) return false;
  const got = Buffer.from(cookieVal(req, "hvm_owner"));
  const want = Buffer.from(ownerToken);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

let devices = {};
try { devices = JSON.parse(await fs.readFile(DEVICES, "utf8")); } catch {}
const saveDevices = () => fs.writeFile(DEVICES, JSON.stringify(devices)).catch(() => {});
const devKey = (c) => c.cid || `ip:${c.ip}`;
const today = () => new Date().toISOString().slice(0, 10);
// Cek apakah perangkat boleh mengirim (blokir / batas harian). Mengembalikan pesan error atau null.
function limitError(c) {
  const d = devices[devKey(c)];
  if (!d) return null;
  if (d.blocked) return "Perangkat Anda diblokir oleh pemilik.";
  if (d.daily > 0) {
    const used = d.day === today() ? (d.dayCount || 0) : 0;
    if (used >= d.daily) return `Batas pemakaian harian tercapai (${d.daily} pesan). Coba lagi besok.`;
  }
  return null;
}
async function recordUsage(c, model, question) {
  const now = Date.now();
  const key = devKey(c);
  const d = devices[key] || { cid: key, firstSeen: now, count: 0 };
  d.who = c.who; d.device = c.device; d.ip = c.ip; d.ua = c.ua; d.lastSeen = now; d.count++;
  if (d.day !== today()) { d.day = today(); d.dayCount = 0; }
  d.dayCount = (d.dayCount || 0) + 1;
  devices[key] = d;
  await saveDevices();
  const line = JSON.stringify({ t: now, cid: key, who: c.who, device: c.device, ip: c.ip, model, q: String(question).slice(0, 500) }) + "\n";
  try {
    await fs.appendFile(USAGE, line);
    const st = await fs.stat(USAGE);
    if (st.size > 2_000_000) { // batasi ukuran: simpan 800 baris terakhir
      const keep = (await fs.readFile(USAGE, "utf8")).trim().split("\n").slice(-800).join("\n") + "\n";
      await fs.writeFile(USAGE, keep);
    }
  } catch {}
}
async function readUsage(limit = 150) {
  const txt = await fs.readFile(USAGE, "utf8").catch(() => "");
  return txt.trim().split("\n").filter(Boolean).slice(-limit).reverse()
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// --- Status rig (suhu CPU, RAM, beban) ---
// Suhu CPU dari /sys/class/thermal (Linux); utamakan paket x86/coretemp. Nilai milidrajat.
async function cpuTemp() {
  try {
    const base = "/sys/class/thermal";
    const zones = (await fs.readdir(base).catch(() => [])).filter((z) => z.startsWith("thermal_zone"));
    let best = null, fallback = null;
    for (const z of zones) {
      const type = (await fs.readFile(path.join(base, z, "type"), "utf8").catch(() => "")).trim().toLowerCase();
      const raw = Number((await fs.readFile(path.join(base, z, "temp"), "utf8").catch(() => "")).trim());
      if (!Number.isFinite(raw) || raw <= 0) continue;
      const c = raw > 1000 ? raw / 1000 : raw; // milidrajat → drajat
      if (/x86_pkg|coretemp|cpu|k10temp|package/.test(type)) { if (best === null) best = c; }
      else if (fallback === null) fallback = c;
    }
    const v = best ?? fallback;
    return v === null ? null : Math.round(v);
  } catch { return null; }
}

// RAM dari /proc/meminfo (Linux); fallback ke os.*.
async function mem() {
  try {
    const txt = await fs.readFile("/proc/meminfo", "utf8");
    const g = (k) => { const m = txt.match(new RegExp(`^${k}:\\s+(\\d+)`, "m")); return m ? Number(m[1]) * 1024 : null; };
    const total = g("MemTotal"), avail = g("MemAvailable");
    if (total && avail != null) {
      const totalMB = Math.round(total / 1048576), availMB = Math.round(avail / 1048576);
      return { totalMB, availMB, usedMB: totalMB - availMB, usedPct: Math.round((1 - avail / total) * 100) };
    }
  } catch {}
  const total = os.totalmem(), free = os.freemem();
  const totalMB = Math.round(total / 1048576), availMB = Math.round(free / 1048576);
  return { totalMB, availMB, usedMB: totalMB - availMB, usedPct: Math.round((1 - free / total) * 100) };
}

// --- Adapter mesin chat (Ollama API ⇄ OpenAI-compatible seperti ik_llama.cpp) ---
// Keduanya dinormalkan ke format yang sama ke browser: baris NDJSON {message:{content}}.
async function backendModels() {
  if (BACKEND === "openai") {
    const r = await fetch(`${LLM_URL}/v1/models`);
    const d = await r.json();
    return (d.data || []).map((m) => m.id).filter(Boolean);
  }
  const r = await fetch(`${LLM_URL}/api/tags`);
  const d = await r.json();
  return (d.models || []).map((m) => m.name);
}
function openChat(model, messages) {
  if (BACKEND === "openai") {
    // llama-server (ik_llama) terima parameter OpenAI + repeat_penalty/top_k lewat body.
    return fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true,
        temperature: SAMP.temperature, top_p: SAMP.top_p, top_k: SAMP.top_k,
        repeat_penalty: SAMP.repeat_penalty, repeat_last_n: SAMP.repeat_last_n,
        presence_penalty: SAMP.presence_penalty, frequency_penalty: SAMP.frequency_penalty }),
    });
  }
  return fetch(`${LLM_URL}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: {
      num_ctx: NUM_CTX, temperature: SAMP.temperature, top_p: SAMP.top_p, top_k: SAMP.top_k,
      repeat_penalty: SAMP.repeat_penalty, repeat_last_n: SAMP.repeat_last_n, frequency_penalty: SAMP.frequency_penalty } }),
  });
}
// Normalisasi stream upstream → generator potongan teks (delta), apa pun backend-nya.
async function* chatDeltas(upstream) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      line = line.trim();
      if (!line) continue;
      if (BACKEND === "openai") {
        if (!line.startsWith("data:")) continue;      // SSE: "data: {...}"
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try { const o = JSON.parse(data); const d = o.choices?.[0]?.delta?.content; if (d) yield d; } catch {}
      } else {
        try { const o = JSON.parse(line); const d = o.message?.content; if (d) yield d; } catch {}
      }
    }
  }
}

// --- Tugas terjadwal (⏰): server menjalankan prompt sesuai jadwal, ambil sumber (RSS/JSON/HTML),
// lalu hasil disimpan sebagai chat baru milik pembuat tugas. Khusus pemilik (atau tanpa OWNER_KEY).
const TASKS = path.join(DATA, "tasks.json");
const TZ = process.env.HVM_TZ || "Asia/Jakarta";
let tasks = [];
try { tasks = JSON.parse(await fs.readFile(TASKS, "utf8")); } catch {}
const saveTasks = () => fs.writeFile(TASKS, JSON.stringify(tasks, null, 1)).catch(() => {});
const canTask = (req) => !OWNER_KEY || ownerOk(req);
const SRC_BUDGET = Number(process.env.HVM_TASK_CHARS || 7000); // batas karakter data sumber (num_ctx 4096 kecil)

function tzNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`,
    wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
function scheduleLabel(s = {}) {
  if (s.type === "interval") return `Tiap ${s.hours} jam`;
  if (s.type === "weekly") return `Tiap ${HARI[s.day] || "?"} ${s.time}`;
  return `Tiap hari ${s.time}`;
}
function isDue(t, now = tzNow(), ms = Date.now()) {
  const s = t.schedule || {};
  if (s.type === "interval") return ms - (t.lastRun || t.created || 0) >= Math.max(1, Number(s.hours) || 6) * 3600e3;
  if (t.lastRunDate === now.date) return false;               // sudah jalan hari ini
  if (s.type === "weekly" && now.wd !== Number(s.day)) return false;
  return now.hm >= (s.time || "06:00");                        // terlambat (rig mati) → tetap dijalankan
}
function cleanSchedule(s = {}) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time || "") ? s.time : "06:00";
  if (s.type === "interval") return { type: "interval", hours: Math.min(168, Math.max(1, Math.round(Number(s.hours) || 6))) };
  if (s.type === "weekly") return { type: "weekly", day: Math.min(6, Math.max(0, Number(s.day) || 1)), time };
  return { type: "daily", time };
}

// Ambil sumber: RSS/Atom → daftar judul; JSON → potongan teks; HTML → teks polos.
// Keamanan jaringan rumah: cegah pengambil sumber menyentuh perangkat LOKAL (rig mining, router,
// NAS, Tailscale, apa pun di LAN). Cek nama host literal DAN hasil resolusi DNS-nya (anti rebinding).
function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (ip.includes(":")) { // IPv6
    if (ip.startsWith("::ffff:") && ip.includes(".")) return isPrivateIp(ip.slice(7)); // IPv4-mapped
    return ip === "::1" || ip === "::" || ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // aneh → blokir
  const [a, b] = p;
  return a === 0 || a === 127 || a === 10 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 168 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 0 && p[2] === 0 || a === 198 && (b === 18 || b === 19);
}
function blockedHostName(h) {
  h = String(h).toLowerCase().replace(/^\[|\]$/g, "");
  return !h || h === "localhost" || h.endsWith(".ts.net") || h.endsWith(".local") ||
    h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa") || /^\d+\.\d+\.\d+\.\d+$/.test(h) && isPrivateIp(h) || h.includes(":") && isPrivateIp(h);
}
// true bila URL AMAN dituju (publik). Menolak non-http(s), host lokal, dan domain yang RESOLVE ke IP lokal.
async function allowedTarget(u) {
  let host;
  try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return false; host = x.hostname.replace(/^\[|\]$/g, ""); }
  catch { return false; }
  if (blockedHostName(host)) return false;
  try {
    const addrs = await dnsLookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return false;
  } catch { return false; } // gagal resolve → jangan tembak
  return true;
}
const decodeEnt = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const stripTags = (s) => decodeEnt(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
async function fetchSource(u, maxItems = 12) {
  if (!(await allowedTarget(u))) return { url: u, error: "alamat tidak diizinkan (hanya alamat publik; LAN/rig/router diblokir)" };
  try {
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) HvM-AI/1.0", accept: "*/*" },
      signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!r.ok) return { url: u, error: `HTTP ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    const body = (await r.text()).slice(0, 3_000_000);
    if (/json/i.test(ct) || /^\s*[[{]/.test(body)) return { url: u, kind: "json", text: body.replace(/\s+/g, " ").slice(0, 1500) };
    const items = [...body.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].slice(0, maxItems).map((m) => {
      const x = m[0];
      const g = (tag) => { const mm = x.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return mm ? stripTags(mm[1]) : ""; };
      let link = g("link");
      if (!link) { const lm = x.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = decodeEnt(lm[1]); }
      const title = g("title");
      let desc = g("description") || g("summary");
      if (desc.startsWith(title.slice(0, 30))) desc = "";      // Google News: deskripsi = judul
      return { title, link, date: (g("pubDate") || g("updated") || g("published")).slice(0, 25), src: g("source"), desc: desc.slice(0, 180) };
    }).filter((i) => i.title);
    if (items.length) return { url: u, kind: "rss", items };
    return { url: u, kind: "html", text: stripTags(body).slice(0, 2500) };
  } catch (e) { return { url: u, error: e?.name === "TimeoutError" ? "waktu habis" : String(e?.message || e) }; }
}

async function pickModel(want) {
  const ms = await backendModels().catch(() => []);
  if (want && ms.includes(want)) return want;
  return ms.find((m) => /^hvm/i.test(m)) || ms.find((m) => !/embed/i.test(m)) || ms[0] || want || "";
}

let taskBusy = null;                 // id tugas yang sedang jalan
const taskQueue = [];
function enqueueTask(id) { if (!taskQueue.includes(id) && taskBusy !== id) taskQueue.push(id); pumpTasks(); }
async function pumpTasks() {
  if (taskBusy || !taskQueue.length) return;
  taskBusy = taskQueue.shift();
  try { await runTask(taskBusy); } catch (e) { console.error("tugas gagal:", e); }
  taskBusy = null;
  pumpTasks();
}
async function runTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  const now = tzNow();
  t.lastRun = Date.now(); t.lastRunDate = now.date; t.lastStatus = "berjalan"; saveTasks();

  // 1) kumpulkan data sumber (berurutan, hemat koneksi)
  const results = [];
  for (const u of t.sources || []) results.push(await fetchSource(u));
  const refs = []; let data = "", n = 0;
  for (const r of results) {
    if (r.error) continue;
    if (r.kind === "rss") for (const it of r.items) {
      const line = `[${++n}] ${it.title}${it.src ? " — " + it.src : ""}${it.date ? " (" + it.date + ")" : ""}${it.desc ? ": " + it.desc : ""}\n`;
      if (data.length + line.length > SRC_BUDGET) { n--; break; }
      data += line; refs.push(it);
    } else {
      const block = `[DATA ${r.kind.toUpperCase()} ${new URL(r.url).hostname}] ${r.text}\n`;
      if (data.length + block.length <= SRC_BUDGET) data += block;
    }
  }
  const fails = results.filter((r) => r.error).map((r) => `- ${r.url.slice(0, 90)} → ${r.error}`);

  const content = `Tanggal: ${now.date} ${now.hm} (${TZ})\nTUGAS: ${t.prompt}\n\n` +
    (data ? `DATA TERBARU (gunakan HANYA data ini; jangan mengarang fakta, angka, atau tautan; sebut nomor [n] saat memakai berita):\n${data}`
          : "DATA TERBARU: (kosong — semua sumber gagal diambil). Katakan terus terang bahwa data tidak tersedia; jangan mengarang.\n") +
    `\nTulis dalam Bahasa Indonesia, rapi dengan poin-poin. Bila menyangkut investasi, tambahkan pengingat singkat bahwa ini bukan saran finansial.`;

  // 2) jalankan model, simpan bertahap seperti chat biasa
  const model = await pickModel(t.model);
  const chatId = crypto.randomBytes(6).toString("hex");
  const title = `⏰ ${t.name} — ${now.date}`;
  const shown = `⏰ ${t.name} (otomatis, ${scheduleLabel(t.schedule)})\n${t.prompt}\n\n_Data: ${refs.length} berita dari ${results.length - fails.length}/${results.length} sumber._`;
  let full = "";
  const persist = (pending) => saveChat({ id: chatId, model, title, scheduled: true, task: t.id,
    messages: [{ role: "user", content: shown }, { role: "assistant", content: full }],
    client: t.client, who: t.who || "(terjadwal)", device: "Tugas terjadwal", ip: "rig", pending }).catch(() => {});
  await persist(true);
  t.lastChat = chatId; saveTasks();
  try {
    const up = await openChat(model, withPersona([{ role: "user", content }]));
    if (!up.ok || !up.body) throw new Error(`mesin LLM menolak: HTTP ${up.status}`);
    let last = Date.now();
    for await (const d of chatDeltas(up)) { full += d; if (Date.now() - last > 3000) { last = Date.now(); persist(true); } }
    t.lastStatus = "ok";
  } catch (e) {
    full += `\n\n⚠️ Gagal menjalankan model: ${e?.message || e}`;
    t.lastStatus = "gagal: " + String(e?.message || e).slice(0, 120);
  }
  // 3) daftar sumber asli (tautan dari data, bukan dari model)
  if (refs.length) full += "\n\n---\n**Sumber:**\n" + refs.map((r, i) => `${i + 1}. ${r.link ? `[${r.title.replace(/[[\]]/g, "")}](${r.link})` : r.title}`).join("\n");
  if (fails.length) full += "\n\n_Sumber gagal diambil:_\n" + fails.join("\n");
  await persist(false);
  saveTasks();
}
setInterval(() => {
  const now = tzNow(), ms = Date.now();
  for (const t of tasks) if (t.enabled !== false && taskBusy !== t.id && !taskQueue.includes(t.id) && isDue(t, now, ms)) {
    t.lastRunDate = now.date; t.lastRun = ms; saveTasks(); enqueueTask(t.id);
  }
}, 30_000);

// Paket contoh "pagi": kripto, saham Indonesia, side gig/cuan pakai AI.
const gnews = (q, lang = "id") => lang === "id"
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=id&gl=ID&ceid=ID:id`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const PRESETS = [
  { key: "kripto", name: "Berita Kripto Pagi", schedule: { type: "daily", time: "06:00" },
    sources: ["https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple&vs_currencies=usd,idr&include_24hr_change=true",
      gnews("bitcoin OR kripto OR crypto when:1d"), "https://cointelegraph.com/rss"],
    prompt: "Buat ringkasan pagi pasar kripto: (1) harga & perubahan 24 jam BTC, ETH, SOL, BNB, XRP dari data harga (USD dan IDR); (2) 5–7 berita terpenting beserta dampaknya; (3) sentimen umum (bullish/bearish/netral) dan alasannya; (4) hal yang perlu dipantau hari ini. Singkat dan padat." },
  { key: "saham", name: "Saham Indonesia Pagi", schedule: { type: "daily", time: "06:10" },
    sources: ["https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=5d&interval=1d",
      gnews("IHSG OR \"Bursa Efek Indonesia\" OR saham when:1d"), "https://www.cnbcindonesia.com/market/rss"],
    prompt: "Buat ringkasan pagi pasar saham Indonesia: (1) posisi IHSG terakhir & perubahannya bila ada di data (field regularMarketPrice / chartPreviousClose); (2) 5–7 berita emiten/sektor terpenting; (3) faktor penggerak (asing, rupiah, suku bunga, komoditas, global); (4) saham/sektor yang ramai dibahas dan yang perlu dipantau. Jangan mengarang angka." },
  { key: "cuan", name: "Side Gig & Cuan AI", schedule: { type: "daily", time: "06:20" },
    sources: [gnews("\"side hustle\" OR \"side income\" AI automation when:7d", "en"),
      gnews("\"penghasilan tambahan\" OR \"side hustle\" OR cuan AI otomatisasi when:7d"),
      "https://hnrss.org/newest?q=AI+side+project&points=20"],
    prompt: "Dari data, rangkum 5 peluang side gig / cara cuan memakai AI & otomatisasi yang sedang tren. Untuk tiap peluang: apa itu, kenapa sedang tren, modal & skill yang dibutuhkan, potensi hasil yang realistis, serta risiko/red flag (waspadai skema cepat kaya & penipuan). Prioritaskan yang bisa dijalankan Rahula dari rumah dengan PC/rig. Tutup dengan 1 rekomendasi konkret untuk dicoba minggu ini." },
];

// --- Server ---
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (guard && (await guard(req, res, url))) return;

    // Daftar model dari mesin chat (Ollama atau ik_llama.cpp)
    if (url.pathname === "/api/models" && req.method === "GET") {
      try {
        return json(res, 200, { models: await backendModels() });
      } catch {
        return json(res, 200, { models: [], error: `Tidak bisa menghubungi mesin LLM di ${LLM_URL}. Pastikan layanannya berjalan.` });
      }
    }

    // Status rig: suhu CPU, RAM, beban CPU, model yang sedang dimuat
    if (url.pathname === "/api/stats" && req.method === "GET") {
      const [temp, ram] = await Promise.all([cpuTemp(), mem()]);
      const load = os.loadavg(); // [1m, 5m, 15m]
      const cores = os.cpus().length || 1;
      let loaded = [];
      try {
        if (BACKEND === "openai") {
          const r = await fetch(`${LLM_URL}/props`, { signal: AbortSignal.timeout(2500) });
          const d = await r.json();
          const nm = (d.model_path || d.default_generation_settings?.model || "model").split("/").pop();
          loaded = [{ name: nm, sizeMB: null, vramMB: 0, expires: null }];
        } else {
          const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(2500) });
          const d = await r.json();
          loaded = (d.models || []).map((m) => ({
            name: m.name || m.model,
            sizeMB: m.size ? Math.round(m.size / 1048576) : null,
            vramMB: m.size_vram ? Math.round(m.size_vram / 1048576) : 0,
            expires: m.expires_at || null,
          }));
        }
      } catch {}
      return json(res, 200, {
        cpu: { load1: +load[0].toFixed(2), load5: +load[1].toFixed(2), load15: +load[2].toFixed(2), cores, pct: Math.min(100, Math.round((load[0] / cores) * 100)) },
        ram, temp, loaded, uptime: Math.round(os.uptime()),
      });
    }

    // Info konteks model (ukuran jendela token), untuk indikator konteks
    if (url.pathname === "/api/model-info" && req.method === "GET") {
      const name = url.searchParams.get("name");
      if (!name) return json(res, 400, { error: "butuh ?name=" });
      // ik_llama.cpp / OpenAI-compatible: ambil n_ctx dari /props
      if (BACKEND === "openai") {
        try {
          const r = await fetch(`${LLM_URL}/props`, { signal: AbortSignal.timeout(4000) });
          const d = await r.json();
          const nctx = Number(d.default_generation_settings?.n_ctx || d.n_ctx || NUM_CTX);
          return json(res, 200, { name, context_length: nctx, num_ctx: nctx, applied: Math.min(NUM_CTX, nctx), window: Math.min(NUM_CTX, nctx) });
        } catch {
          return json(res, 200, { name, context_length: null, num_ctx: null, applied: NUM_CTX, window: NUM_CTX });
        }
      }
      try {
        const r = await fetch(`${OLLAMA}/api/show`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }), signal: AbortSignal.timeout(4000),
        });
        const d = await r.json();
        let ctx = null;
        const mi = d.model_info || {};
        for (const k of Object.keys(mi)) if (/\.context_length$/.test(k)) { ctx = Number(mi[k]); break; }
        let numCtx = null;
        const pm = (d.parameters || "").match(/num_ctx\s+(\d+)/);
        if (pm) numCtx = Number(pm[1]);
        // Jendela EFEKTIF = yang benar-benar dipakai aplikasi: NUM_CTX, dibatasi context_length model
        // (dan num_ctx bawaan model bila itu lebih kecil). Bukan 256K iklan modelnya.
        const cap = Math.min(NUM_CTX, numCtx || NUM_CTX, ctx || NUM_CTX);
        return json(res, 200, { name, context_length: ctx, num_ctx: numCtx, applied: NUM_CTX, window: cap });
      } catch {
        return json(res, 200, { name, context_length: null, num_ctx: null, window: null });
      }
    }

    // Siapa saya / status pemilik
    if (url.pathname === "/api/me" && req.method === "GET")
      return json(res, 200, { ownerAvailable: !!OWNER_KEY, owner: ownerOk(req), tasks: canTask(req) });

    // --- Dashboard pemilik ---
    if (url.pathname === "/api/admin/login" && req.method === "POST") {
      if (!OWNER_KEY) return json(res, 400, { error: "Dashboard belum diaktifkan. Set HVM_OWNER_KEY di layanan ngobrol." });
      const { key } = await readBody(req).catch(() => ({}));
      const g = Buffer.from(crypto.createHash("sha256").update(String(key || "")).digest("hex"));
      const w = Buffer.from(crypto.createHash("sha256").update(OWNER_KEY).digest("hex"));
      if (g.length === w.length && crypto.timingSafeEqual(g, w)) {
        const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        res.writeHead(200, { "content-type": "application/json; charset=utf-8",
          "set-cookie": `hvm_owner=${ownerToken}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}` });
        return res.end(JSON.stringify({ ok: true }));
      }
      return json(res, 401, { error: "Kunci pemilik salah." });
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (!ownerOk(req)) return json(res, 403, { error: "Khusus pemilik." });
      if (url.pathname === "/api/admin/overview") {
        const chats = await listChats(null, true);
        const devs = Object.values(devices).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        return json(res, 200, { devices: devs, totals: { perangkat: devs.length, chats: chats.length, pesan: devs.reduce((s, d) => s + (d.count || 0), 0) } });
      }
      if (url.pathname === "/api/admin/feed") return json(res, 200, { feed: await readUsage(150) });
      if (url.pathname === "/api/admin/device" && req.method === "POST") {
        const { cid, action, limit } = await readBody(req).catch(() => ({}));
        const d = devices[cid];
        if (!d) return json(res, 404, { error: "perangkat tidak ada" });
        if (action === "block") d.blocked = true;
        else if (action === "unblock") d.blocked = false;
        else if (action === "limit") d.daily = Math.max(0, Number(limit) || 0);
        else if (action === "delete") {
          // hapus chat milik perangkat ini lalu catatannya
          const names = (await fs.readdir(CHATS).catch(() => [])).filter((f) => f.endsWith(".json"));
          for (const f of names) {
            try { const c = JSON.parse(await fs.readFile(path.join(CHATS, f), "utf8")); if (c.client === cid) await fs.rm(path.join(CHATS, f), { force: true }); } catch {}
          }
          delete devices[cid];
          await saveDevices();
          return json(res, 200, { ok: true, deleted: true });
        } else return json(res, 400, { error: "aksi tidak dikenal" });
        await saveDevices();
        return json(res, 200, { ok: true, device: d });
      }
      if (url.pathname === "/api/admin/chats") {
        const cid = url.searchParams.get("client") || null;
        return json(res, 200, { chats: await listChats(cid, !cid) });
      }
      const ac = url.pathname.match(/^\/api\/admin\/chat\/([a-z0-9]{6,32})$/);
      if (ac) {
        const c = await fs.readFile(chatPath(ac[1]), "utf8").catch(() => null);
        return c ? (res.writeHead(200, { "content-type": "application/json; charset=utf-8" }), res.end(c)) : json(res, 404, { error: "tidak ada" });
      }
      return json(res, 404, { error: "tidak ada" });
    }

    // --- Tugas terjadwal (⏰) — khusus pemilik ---
    if (url.pathname === "/api/tasks" || url.pathname.startsWith("/api/tasks/")) {
      if (!canTask(req)) return json(res, 403, { error: "Tugas terjadwal khusus pemilik. Masuk dulu lewat ◆ Pemilik." });
      const view = (t) => ({ ...t, label: scheduleLabel(t.schedule), running: taskBusy === t.id, queued: taskQueue.includes(t.id) });
      if (url.pathname === "/api/tasks" && req.method === "GET")
        return json(res, 200, { tasks: tasks.map(view), tz: TZ, now: tzNow() });
      if (url.pathname === "/api/tasks" && req.method === "POST") {
        const b = await readBody(req).catch(() => ({}));
        const who = clientOf(req);
        const srcs = (Array.isArray(b.sources) ? b.sources : String(b.sources || "").split(/\n+/))
          .map((s) => String(s).trim())
          .filter((s) => { try { const x = new URL(s); return /^https?:$/.test(x.protocol) && !blockedHostName(x.hostname.replace(/^\[|\]$/g, "")); } catch { return false; } })
          .slice(0, 8);
        const name = String(b.name || "").trim().slice(0, 60), prompt = String(b.prompt || "").trim().slice(0, 2000);
        if (!name || !prompt) return json(res, 400, { error: "Nama dan perintah wajib diisi." });
        let t = okId(b.id) ? tasks.find((x) => x.id === b.id) : null;
        if (!t) { t = { id: crypto.randomBytes(6).toString("hex"), created: Date.now(), client: who.cid, who: who.who }; tasks.push(t); }
        Object.assign(t, { name, prompt, sources: srcs, schedule: cleanSchedule(b.schedule), enabled: b.enabled !== false,
          model: String(b.model || "").slice(0, 200) });
        if (!t.client) { t.client = who.cid; t.who = who.who; }
        await saveTasks();
        return json(res, 200, { ok: true, task: view(t) });
      }
      if (url.pathname === "/api/tasks/preset" && req.method === "POST") {
        const who = clientOf(req); let added = 0;
        for (const p of PRESETS) {
          if (tasks.some((t) => t.preset === p.key && t.client === who.cid)) continue;
          tasks.push({ id: crypto.randomBytes(6).toString("hex"), created: Date.now(), preset: p.key, client: who.cid, who: who.who,
            name: p.name, prompt: p.prompt, sources: p.sources, schedule: p.schedule, enabled: true, model: "" });
          added++;
        }
        await saveTasks();
        return json(res, 200, { ok: true, added });
      }
      const tm = url.pathname.match(/^\/api\/tasks\/([a-z0-9]{6,32})(?:\/(run|test))?$/);
      const t = tm && tasks.find((x) => x.id === tm[1]);
      if (!t) return json(res, 404, { error: "Tugas tidak ada." });
      if (!tm[2] && req.method === "DELETE") { tasks = tasks.filter((x) => x.id !== t.id); await saveTasks(); return json(res, 200, { ok: true }); }
      if (tm[2] === "run" && req.method === "POST") { enqueueTask(t.id); return json(res, 200, { ok: true, queued: true }); }
      if (tm[2] === "test" && req.method === "POST") {
        const out = [];
        for (const u of t.sources || []) {
          const r = await fetchSource(u, 5);
          out.push({ url: u, ok: !r.error, error: r.error || null, kind: r.kind || null,
            count: r.items ? r.items.length : (r.text ? 1 : 0), sample: r.items ? r.items.slice(0, 3).map((i) => i.title) : (r.text ? [r.text.slice(0, 120)] : []) });
        }
        return json(res, 200, { results: out });
      }
      return json(res, 405, { error: "metode tidak didukung" });
    }

    // Daftar / baca / hapus percakapan (tiap orang hanya melihat miliknya sendiri)
    if (url.pathname === "/api/chats" && req.method === "GET") {
      const { cid } = clientOf(req);
      return json(res, 200, { chats: await listChats(cid) });
    }
    const one = url.pathname.match(/^\/api\/chats\/([a-z0-9]{6,32})$/);
    if (one) {
      if (req.method === "GET") {
        const c = await fs.readFile(chatPath(one[1]), "utf8").catch(() => null);
        if (!c) return json(res, 404, { error: "tidak ada" });
        const obj = JSON.parse(c);
        const { cid } = clientOf(req);
        if (obj.client && cid && obj.client !== cid && !ownerOk(req)) return json(res, 403, { error: "Bukan chat Anda." });
        return (res.writeHead(200, { "content-type": "application/json; charset=utf-8" }), res.end(c));
      }
      if (req.method === "DELETE") {
        const c = await fs.readFile(chatPath(one[1]), "utf8").then(JSON.parse).catch(() => null);
        const { cid } = clientOf(req);
        if (c && c.client && cid && c.client !== cid && !ownerOk(req)) return json(res, 403, { error: "Bukan chat Anda." });
        await fs.rm(chatPath(one[1]), { force: true });
        return json(res, 200, { ok: true });
      }
    }

    // Unggah file (disimpan aman di data/berkas/<id>/)
    if (url.pathname === "/api/upload" && req.method === "POST") {
      const name = safeName(decodeURIComponent(req.headers["x-nama-file"] || "file"));
      const id = crypto.randomBytes(8).toString("hex");
      const dir = path.join(FILES, id);
      await fs.mkdir(dir, { recursive: true });
      const dest = path.join(dir, name);
      let size = 0;
      const chunks = [];
      for await (const ch of req) {
        size += ch.length;
        if (size > MAX_FILE) { res.writeHead(413); return res.end("file terlalu besar"); }
        chunks.push(ch);
      }
      const buf = Buffer.concat(chunks);
      await fs.writeFile(dest, buf);
      const ext = path.extname(name).toLowerCase();
      let text = null;
      if (TEXT_EXT.has(ext)) {
        text = buf.toString("utf8").slice(0, INLINE_CHARS);
        if (buf.length > INLINE_CHARS) text += "\n…(dipotong)…";
      }
      return json(res, 200, { id, name, size, url: `/berkas/${id}/${encodeURIComponent(name)}`, text, canRead: text !== null });
    }

    // Unduh file tersimpan (dengan pagar path)
    const fm = url.pathname.match(/^\/berkas\/([a-z0-9]{16})\/(.+)$/);
    if (fm && req.method === "GET") {
      const name = safeName(decodeURIComponent(fm[2]));
      const file = path.join(FILES, fm[1], name);
      if (!file.startsWith(FILES + path.sep)) return json(res, 403, { error: "forbidden" });
      const buf = await fs.readFile(file).catch(() => null);
      if (!buf) return json(res, 404, { error: "tidak ada" });
      res.writeHead(200, { "content-type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
      return res.end(buf);
    }

    // Pengetahuan (RAG): daftar / unggah / hapus dokumen
    if (url.pathname === "/api/pengetahuan" && req.method === "GET")
      return json(res, 200, { docs: listKnowledge(), embedModel: EMBED_MODEL });
    if (url.pathname === "/api/pengetahuan" && req.method === "POST") {
      const name = safeName(decodeURIComponent(req.headers["x-nama-file"] || "dokumen"));
      const ext = path.extname(name).toLowerCase();
      if (!TEXT_EXT.has(ext)) return json(res, 400, { error: "Hanya file teks/kode (txt, md, csv, kode) yang bisa dibaca untuk pengetahuan." });
      let size = 0; const chunks = [];
      for await (const ch of req) { size += ch.length; if (size > MAX_FILE) { res.writeHead(413); return res.end("terlalu besar"); } chunks.push(ch); }
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        const r = await addKnowledge(name, text);
        return json(res, 200, { ok: true, ...r, name });
      } catch (e) {
        return json(res, 502, { error: `Gagal membuat embedding (model "${EMBED_MODEL}" belum ada?). Jalankan: ollama pull ${EMBED_MODEL}. Detail: ${e.message}` });
      }
    }
    const dm = url.pathname.match(/^\/api\/pengetahuan\/([a-f0-9]{10})$/);
    if (dm && req.method === "DELETE") {
      const before = ragIndex.length;
      ragIndex = ragIndex.filter((e) => e.doc !== dm[1]);
      await saveRag();
      return json(res, 200, { ok: true, removed: before - ragIndex.length });
    }

    // Chat: teruskan ke Ollama dan alirkan jawaban ke browser (NDJSON), lalu simpan percakapan
    // --- Padatkan konteks: ringkas pesan lama jadi satu catatan, simpan ke rig, agar chat lanjut terus ---
    if (url.pathname === "/api/compact" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      const model = String(b.model || "").trim();
      const all = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && m.role !== "system" && (m.content || "").trim());
      const KEEP = Math.max(2, Number(b.keep) || 4);
      if (all.length <= KEEP + 1) return json(res, 200, { skipped: true, messages: all });
      const head = all.slice(0, -KEEP), tail = all.slice(-KEEP);
      const transcript = head.map((m) => `${m.role === "user" ? "PENGGUNA" : "ASISTEN"}: ${String(m.content).slice(0, 4000)}`).join("\n\n");
      const sumPrompt = "Ringkas percakapan berikut menjadi CATATAN KONTEKS yang padat namun lengkap. Pertahankan semua fakta, keputusan, angka, nama, potongan kode penting, dan hal yang masih dikerjakan — agar percakapan bisa dilanjutkan tanpa kehilangan informasi. Tulis sebagai poin-poin ringkas dalam Bahasa Indonesia. Jangan menambah basa-basi atau sapaan.\n\n=== PERCAKAPAN ===\n" + transcript;
      let summary = "";
      try {
        const up = await openChat(model, [{ role: "user", content: sumPrompt }]);
        if (!up.ok || !up.body) throw new Error("HTTP " + up.status);
        for await (const d of chatDeltas(up)) summary += d;
      } catch (e) {
        return json(res, 502, { error: "Gagal memadatkan: " + (e?.message || e) });
      }
      summary = summary.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (!summary) return json(res, 502, { error: "Ringkasan kosong, coba lagi." });
      const compacted = [{ role: "system", content: "📦 Ringkasan konteks sebelumnya (dipadatkan otomatis agar chat bisa lanjut):\n" + summary }, ...tail];
      if (okId(b.id)) {
        const prev = await fs.readFile(chatPath(b.id), "utf8").then(JSON.parse).catch(() => null);
        const who = clientOf(req);
        if (prev && prev.client && who.cid && prev.client !== who.cid && !ownerOk(req)) return json(res, 403, { error: "Bukan chat Anda." });
        await saveChat({ ...(prev || {}), id: b.id, model: model || prev?.model, messages: compacted,
          client: prev?.client || who.cid, who: prev?.who || who.who, device: prev?.device, ip: prev?.ip,
          compacted: (prev?.compacted || 0) + 1, pending: false });
      }
      return json(res, 200, { ok: true, messages: compacted, removed: head.length });
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const model = String(body.model || "").trim();
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!model || !messages.length) return json(res, 400, { error: "model dan messages wajib" });
      let id = okId(body.id) ? body.id : crypto.randomBytes(6).toString("hex");
      const who = clientOf(req);
      const blocked = limitError(who);
      if (blocked) return json(res, 429, { error: blocked });
      const lastQ = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      recordUsage(who, model, lastQ).catch(() => {});

      // RAG: bila ada dokumen & diminta, sisipkan potongan relevan sebagai konteks
      let ragInfo = null;
      if (body.rag !== false && ragIndex.length) {
        try {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const hits = lastUser ? await retrieve(String(lastUser.content).slice(0, 2000)) : [];
          if (hits.length) {
            const ctx = hits.map((h, i) => `[${i + 1}] (${h.name})\n${h.text}`).join("\n\n");
            messages.unshift({ role: "system", content:
              "Gunakan potongan dokumen Rahula berikut bila relevan untuk menjawab. Jangan mengarang di luar ini; bila tidak ada jawabannya, katakan. Sebut nomor sumber [n] saat memakai.\n\n" + ctx });
            ragInfo = hits.map((h) => h.name);
          }
        } catch {}
      }

      let upstream;
      try {
        upstream = await openChat(model, withPersona(messages));
      } catch {
        return json(res, 502, { error: `Tidak bisa menghubungi mesin LLM di ${LLM_URL}.` });
      }
      if (!upstream.ok || !upstream.body) {
        const t = await upstream.text().catch(() => "");
        return json(res, 502, { error: `Mesin LLM menolak: ${upstream.status} ${t.slice(0, 200)}` });
      }

      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store",
        "x-chat-id": id, "x-rag": ragInfo ? encodeURIComponent(ragInfo.join(", ")) : "" });
      let full = "";
      let alive = true;                       // true selama browser masih terhubung
      res.on("close", () => { alive = false; }); // tab ditutup -> berhenti menulis, TAPI terus proses
      const title = String(messages.find((m) => m.role === "user")?.content || "Percakapan").replace(/\s+/g, " ").slice(0, 60);
      const persist = (pending) => saveChat({
        id, model, title, messages: [...messages, { role: "assistant", content: full }],
        client: who.cid, who: who.who, device: who.device, ip: who.ip, pending,
      }).catch(() => {});
      await persist(true);                    // langsung muncul di riwayat, ditandai "sedang diproses"

      // Tulis ke browser dalam format NDJSON {message:{content}} apa pun backend-nya.
      const emit = (s) => { if (alive) { try { res.write(JSON.stringify({ message: { content: s } }) + "\n"); } catch { alive = false; } } };
      let lastSave = Date.now();
      try {
        for await (const d of chatDeltas(upstream)) {
          full += d;
          emit(d);
          if (Date.now() - lastSave > 1500) { lastSave = Date.now(); persist(true); } // simpan progres berkala
        }
      } catch (e) {
        const m = `\n\n⚠️ ${e?.message || e}`;
        full += m; emit(m);
      }
      try { if (alive) res.end(); } catch {}
      await persist(false);                   // selesai: simpan final, hapus tanda "sedang diproses"
      return;
    }

    // File statis
    let rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "forbidden" });
    const buf = await fs.readFile(file).catch(() => null);
    if (!buf) return json(res, 404, { error: "tidak ada" });
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    return res.end(buf);
  } catch (e) {
    try { json(res, 500, { error: String(e.message || e) }); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  console.log(`HvM AI di http://${HOST}:${PORT}  → Ollama: ${OLLAMA}  → kata sandi: ${PASSWORD ? "aktif" : "TIDAK ADA (hanya aman di 127.0.0.1)"}`);
});
