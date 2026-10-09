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

await fs.mkdir(CHATS, { recursive: true });
await fs.mkdir(FILES, { recursive: true });
await fs.mkdir(PENGETAHUAN, { recursive: true });

const guard = makeAuth(PASSWORD, {
  name: "HvM AI",
  tagline: "Masukkan kata sandi untuk masuk.",
  iconHref: "/icon.svg",
  themeColor: "#0b1020",
  dark: true,
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
async function listChats() {
  const names = (await fs.readdir(CHATS).catch(() => [])).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of names) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(CHATS, f), "utf8"));
      out.push({ id: c.id, title: c.title || "(tanpa judul)", at: c.at || 0, model: c.model || "" });
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

    // Daftar / baca / hapus percakapan
    if (url.pathname === "/api/chats" && req.method === "GET") return json(res, 200, { chats: await listChats() });
    const one = url.pathname.match(/^\/api\/chats\/([a-z0-9]{6,32})$/);
    if (one) {
      if (req.method === "GET") {
        const c = await fs.readFile(chatPath(one[1]), "utf8").catch(() => null);
        return c ? (res.writeHead(200, { "content-type": "application/json; charset=utf-8" }), res.end(c)) : json(res, 404, { error: "tidak ada" });
      }
      if (req.method === "DELETE") {
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

      // Simpan percakapan (judul dari pesan user pertama)
      try {
        const convo = [...messages, { role: "assistant", content: full }];
        const firstUser = messages.find((m) => m.role === "user")?.content || "Percakapan";
        await saveChat({ id, model, title: String(firstUser).replace(/\s+/g, " ").slice(0, 60), messages: convo });
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
