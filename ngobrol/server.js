// Ngobrol — antarmuka chat sederhana untuk model lokal (Ollama) di rig.
// - Tanpa dependensi (hanya modul bawaan Node 22, ESM).
// - Browser tidak pernah menyentuh Ollama langsung; server ini yang meneruskan,
//   sehingga bisa dilindungi kata sandi dan dibuka aman lewat Tailscale.
// - Riwayat percakapan dan lampiran disimpan di ngobrol/data/ (tidak ikut Git).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
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
// Kunci pemilik: bila diisi, muncul Dashboard untuk memantau perangkat & chat teman.
const OWNER_KEY = process.env.HVM_OWNER_KEY || process.env.OWNER_KEY || "";
const USAGE = path.join(DATA, "usage.jsonl"); // log pertanyaan per perangkat
const DEVICES = path.join(DATA, "devices.json"); // ringkasan perangkat terkoneksi

await fs.mkdir(CHATS, { recursive: true });
await fs.mkdir(FILES, { recursive: true });
await fs.mkdir(PENGETAHUAN, { recursive: true });

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
      out.push({ id: c.id, title: c.title || "(tanpa judul)", at: c.at || 0, model: c.model || "", who: c.who || "", client: c.client || "" });
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
async function recordUsage(c, model, question) {
  const now = Date.now();
  const key = c.cid || `ip:${c.ip}`;
  const d = devices[key] || { cid: key, firstSeen: now, count: 0 };
  d.who = c.who; d.device = c.device; d.ip = c.ip; d.ua = c.ua; d.lastSeen = now; d.count++;
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

// --- Server ---
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (guard && (await guard(req, res, url))) return;

    // Daftar model dari Ollama
    if (url.pathname === "/api/models" && req.method === "GET") {
      try {
        const r = await fetch(`${OLLAMA}/api/tags`);
        const d = await r.json();
        return json(res, 200, { models: (d.models || []).map((m) => m.name) });
      } catch {
        return json(res, 200, { models: [], error: `Tidak bisa menghubungi Ollama di ${OLLAMA}. Pastikan Ollama berjalan.` });
      }
    }

    // Siapa saya / status pemilik
    if (url.pathname === "/api/me" && req.method === "GET")
      return json(res, 200, { ownerAvailable: !!OWNER_KEY, owner: ownerOk(req) });

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
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const model = String(body.model || "").trim();
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!model || !messages.length) return json(res, 400, { error: "model dan messages wajib" });
      let id = okId(body.id) ? body.id : crypto.randomBytes(6).toString("hex");
      const who = clientOf(req);
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
        upstream = await fetch(`${OLLAMA}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true }),
        });
      } catch {
        return json(res, 502, { error: `Tidak bisa menghubungi Ollama di ${OLLAMA}.` });
      }
      if (!upstream.ok || !upstream.body) {
        const t = await upstream.text().catch(() => "");
        return json(res, 502, { error: `Ollama menolak: ${upstream.status} ${t.slice(0, 200)}` });
      }

      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store",
        "x-chat-id": id, "x-rag": ragInfo ? encodeURIComponent(ragInfo.join(", ")) : "" });
      let full = "";
      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        buf += text;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try { const o = JSON.parse(line); full += o.message?.content || ""; } catch {}
        }
        res.write(text);
      }
      res.end();

      // Simpan percakapan (judul dari pesan user pertama) + pemilik/perangkat
      try {
        const convo = [...messages, { role: "assistant", content: full }];
        const firstUser = messages.find((m) => m.role === "user")?.content || "Percakapan";
        await saveChat({ id, model, title: String(firstUser).replace(/\s+/g, " ").slice(0, 60),
          messages: convo, client: who.cid, who: who.who, device: who.device, ip: who.ip });
      } catch {}
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
