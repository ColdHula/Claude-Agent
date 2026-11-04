// Studio — IDE web ala Claude Code/Codex untuk Rahula.
// - Satu tempat untuk SEMUA sesi: sesi Studio, sesi Claude Code (~/.claude/projects, bisa dilanjutkan),
//   tugas Kantor PGA (hasil/*.md), dan percakapan HvM AI (ngobrol/data/chats).
// - Tiap prompt bisa diproses penyedia berbeda: langganan Claude (Agent SDK, bisa ubah file),
//   gratis (FreeLLMAPI, Ollama, Gemini/Groq/OpenRouter free tier), atau API berbayar.
// - Explorer + editor file workspace, dan skill tim (termasuk skill freellmapi).
// Tanpa build step. Data Studio di studio/data/ (tidak ikut Git).
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeAuth } from "../src/auth.js";
import { findSkills } from "../src/orchestrator-sdk.js";
import { createProviders } from "./providers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, "..");
const PUBLIC = path.join(here, "public");
const DATA = path.join(here, "data");
const SESSIONS = path.join(DATA, "sessions");
const WORKSPACE = path.resolve(process.env.STUDIO_WORKSPACE || APP_ROOT);
const PORT = Number(process.env.STUDIO_PORT || process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const PASSWORD = process.env.STUDIO_PASSWORD || process.env.APP_PASSWORD || "";
const MAX_USD = Number(process.env.STUDIO_MAX_USD || process.env.MAX_TASK_USD || 3);
const HISTORY_CHARS = 60_000; // riwayat yang dikirim ke penyedia non-Claude
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const LOCAL_ONLY = ["127.0.0.1", "localhost", "::1"].includes(HOST);
if (!LOCAL_ONLY && !PASSWORD) {
  console.error(`\n  ⛔ HOST=${HOST} membuka Studio ke jaringan, tetapi STUDIO_PASSWORD/APP_PASSWORD belum diisi.`);
  console.error("     Studio bisa membaca, mengubah file, dan memakai kredit — wajib berkata sandi.\n");
  process.exit(1);
}
if (PASSWORD && PASSWORD.length < 12) {
  console.error("\n  ⛔ Kata sandi Studio terlalu pendek. Pakai minimal 12 karakter.\n");
  process.exit(1);
}
const guard = makeAuth(PASSWORD, {
  name: "Studio",
  tagline: "Semua sesi AI Anda di satu tempat.",
  iconHref: "/icon.svg",
  themeColor: "#14161c",
  dark: true,
  accent: "#d97757",
});

await fs.mkdir(SESSIONS, { recursive: true });
const providers = createProviders(DATA);
await providers.load();

let sdk = null; // dimuat saat perlu agar Studio tetap jalan walau paket belum dipasang
async function getSdk() {
  sdk ||= await import("@anthropic-ai/claude-agent-sdk");
  return sdk;
}

// ───────────────────────── utilitas HTTP ─────────────────────────
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req, limit = 8 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Permintaan terlalu besar."), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
const MIME = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".js": "text/javascript" };

// ───────────────────────── sesi ─────────────────────────
// Sesi Studio: { id, title, createdAt, updatedAt, provider, model, claudeSessionId, claudeSynced, origin, messages:[{role, text, at, provider, model, meta}] }
const sessionFile = (id) => path.join(SESSIONS, `${id}.json`);
const validId = (id) => /^[\w-]{1,80}$/.test(id);
async function readSession(id) {
  if (!validId(id)) throw Object.assign(new Error("ID sesi tidak sah."), { status: 400 });
  return JSON.parse(await fs.readFile(sessionFile(id), "utf8"));
}
async function writeSession(s) {
  s.updatedAt = Date.now();
  await fs.writeFile(sessionFile(s.id), JSON.stringify(s));
}
function newSession(fields = {}) {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: "Sesi baru", createdAt: now, updatedAt: now, messages: [], claudeSynced: 0, ...fields };
}

async function listStudio() {
  const out = [];
  for (const f of await fs.readdir(SESSIONS).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(await fs.readFile(path.join(SESSIONS, f), "utf8"));
      out.push({ source: "studio", id: s.id, title: s.title, updatedAt: s.updatedAt, provider: s.provider, model: s.model, count: s.messages.length, claudeSessionId: s.claudeSessionId || null });
    } catch {}
  }
  return out;
}

async function listClaude() {
  try {
    const { listSessions } = await getSdk();
    const list = await listSessions({ limit: 200 });
    return list.map((s) => ({
      source: "claude",
      id: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
      updatedAt: s.lastModified,
      cwd: s.cwd || "",
      branch: s.gitBranch || "",
    }));
  } catch {
    return [];
  }
}

async function listKantor() {
  const dir = path.join(APP_ROOT, "hasil");
  const out = [];
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (!f.endsWith(".md")) continue;
    const st = await fs.stat(path.join(dir, f)).catch(() => null);
    if (!st) continue;
    out.push({ source: "kantor", id: f, title: f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}_?/, "").replace(/[-_]+/g, " ") || f, updatedAt: st.mtimeMs });
  }
  return out;
}

async function listHvm() {
  const dir = path.join(APP_ROOT, "ngobrol", "data", "chats");
  const out = [];
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    try {
      const c = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      out.push({ source: "hvm", id: c.id || f.replace(/\.json$/, ""), title: c.title || "(tanpa judul)", updatedAt: c.at || 0, model: c.model || "", who: c.who || "" });
    } catch {}
  }
  return out;
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
      : "";

// Isi sesi dari sumber mana pun, dalam bentuk seragam { messages:[{role,text,tools?}], readonly }.
async function openSession(source, id) {
  if (source === "studio") {
    const s = await readSession(id);
    return { ...s, source, readonly: false };
  }
  if (source === "claude") {
    const { getSessionMessages, getSessionInfo } = await getSdk();
    const info = await getSessionInfo(id).catch(() => null);
    const raw = await getSessionMessages(id, { limit: 2000 });
    const messages = [];
    for (const m of raw) {
      if (m.parent_tool_use_id) continue;
      const c = m.message?.content;
      if (m.type === "user") {
        const t = textOf(c).replace(/<(system-reminder|agent-message|task-notification)[^>]*>[\s\S]*?<\/\1>/g, "").trim();
        if (t && !/^<(command|local-command|system-reminder)/.test(t)) messages.push({ role: "user", text: t });
      } else if (m.type === "assistant") {
        const t = textOf(c).trim();
        const tools = Array.isArray(c) ? c.filter((b) => b.type === "tool_use").map((b) => toolLabel(b.name, b.input)) : [];
        const last = messages.at(-1);
        if (last?.role === "assistant") {
          if (t) last.text += (last.text ? "\n\n" : "") + t;
          last.tools.push(...tools);
        } else if (t || tools.length) messages.push({ role: "assistant", text: t, tools });
      }
    }
    return { source, id, title: info?.customTitle || info?.summary || id, cwd: info?.cwd, messages, readonly: true, claudeSessionId: id };
  }
  if (source === "kantor") {
    if (!/^[^/\\]+\.md$/.test(id)) throw Object.assign(new Error("Nama berkas tidak sah."), { status: 400 });
    const body = await fs.readFile(path.join(APP_ROOT, "hasil", id), "utf8");
    const task = (body.match(/^> Tugas: ([\s\S]*?)\n\n/) || [, ""])[1].replace(/\n> /g, "\n");
    const rest = task ? body.slice(body.indexOf("\n\n") + 2) : body;
    return { source, id, title: id, readonly: true, messages: [...(task ? [{ role: "user", text: task }] : []), { role: "assistant", text: rest, provider: "kantor" }] };
  }
  if (source === "hvm") {
    if (!validId(id)) throw Object.assign(new Error("ID tidak sah."), { status: 400 });
    const c = JSON.parse(await fs.readFile(path.join(APP_ROOT, "ngobrol", "data", "chats", `${id}.json`), "utf8"));
    const messages = (c.messages || []).filter((m) => m.role !== "system").map((m) => ({ role: m.role, text: textOf(m.content) || String(m.content || "") }));
    return { source, id, title: c.title, readonly: true, messages };
  }
  throw Object.assign(new Error("Sumber sesi tidak dikenal."), { status: 400 });
}

// ───────────────────────── file workspace ─────────────────────────
const HIDDEN = new Set([".git", "node_modules", ".rumah-agent"]);
function safePath(rel = "") {
  const abs = path.resolve(WORKSPACE, String(rel).replace(/^[/\\]+/, ""));
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) throw Object.assign(new Error("Di luar workspace."), { status: 403 });
  const r = path.relative(WORKSPACE, abs);
  // Rahasia tidak dibuka lewat editor: .env dan kunci penyedia Studio.
  if (/(^|[/\\])\.env(\.|$)(?!example)/.test(r) || abs.startsWith(DATA + path.sep) || abs === DATA) throw Object.assign(new Error("Berkas rahasia tidak dibuka di editor."), { status: 403 });
  return abs;
}

// ───────────────────────── skill ─────────────────────────
async function skillText(fullName) {
  const [plugin, name] = fullName.split(":");
  const base = plugin === "kantor" ? path.join(APP_ROOT, "skills") : path.join(APP_ROOT, "pengetahuan");
  if (!/^[\w.-]+$/.test(name || "")) return "";
  return fs.readFile(path.join(base, "skills", name, "SKILL.md"), "utf8").catch(() => "");
}

// ───────────────────────── menjalankan prompt ─────────────────────────
const running = new Map(); // sessionId -> AbortController

function toolLabel(name, input = {}) {
  const i = input || {};
  const d = i.file_path || i.path || i.pattern || i.command || i.query || i.url || i.skill || i.description || "";
  return `${name}${d ? ` · ${String(d).replace(WORKSPACE + path.sep, "").slice(0, 120)}` : ""}`;
}

function transcript(messages, maxChars) {
  const parts = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const t = `${m.role === "user" ? "Pengguna" : "Asisten"}: ${m.text}`;
    if (used + t.length > maxChars) break;
    parts.unshift(t);
    used += t.length;
  }
  return parts.join("\n\n");
}

async function attachFiles(files = []) {
  let out = "";
  for (const rel of files.slice(0, 8)) {
    try {
      const abs = safePath(rel);
      const st = await fs.stat(abs);
      if (st.size > 200_000) {
        out += `\n\n[Berkas ${rel} terlalu besar untuk ditempel (${st.size} byte)]`;
        continue;
      }
      out += `\n\n--- Berkas: ${rel} ---\n${await fs.readFile(abs, "utf8")}\n--- akhir ${rel} ---`;
    } catch (e) {
      out += `\n\n[Berkas ${rel} tidak bisa dibaca: ${e.message}]`;
    }
  }
  return out;
}

const BASE_SYSTEM = (extra = "") =>
  `Anda asisten kerja Rahula (PGA PGD) di Studio, IDE web. Jawab dalam bahasa Indonesia kecuali diminta lain, ringkas dan langsung ke hasil. Pakai Markdown; kode dalam blok kode bertanda bahasa.${extra}`;

async function runClaudeSdk(session, { model, prompt, mode, skills, signal, emit }) {
  const { query } = await getSdk();
  const found = await findSkills();
  const readTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
  const writeTools = ["Write", "Edit", "Bash", "Agent", "TodoWrite"];
  const tools = [...readTools, ...(mode === "tulis" ? writeTools : []), ...(found.names.length ? ["Skill"] : [])];
  const chosen = skills?.length ? found.names.filter((n) => skills.includes(n)) : found.names;

  // Pesan yang dibuat penyedia lain sejak giliran Claude terakhir diselipkan sebagai konteks.
  const unsynced = session.messages.slice(session.claudeSynced || 0, -1);
  const preface = unsynced.length
    ? `Konteks percakapan sebelumnya (dari penyedia AI lain di Studio):\n${transcript(unsynced, 40_000)}\n\n---\n\n`
    : "";

  const abortController = new AbortController();
  signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const env = { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, BASH_ENV: undefined, ENV: undefined };
  // Bila Studio dijalankan dari dalam Claude Code, jangan mewarisi identitas sesi induk
  // (kalau tidak, percakapan Studio ikut tertulis ke sesi Claude Code yang sedang berjalan).
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ATTENDED"]) env[k] = undefined;

  const q = query({
    prompt: preface + prompt,
    options: {
      model,
      cwd: WORKSPACE,
      systemPrompt: { type: "preset", preset: "claude_code", append: BASE_SYSTEM(mode === "tulis" ? "" : " Mode baca: Anda tidak bisa mengubah file; usulkan perubahan sebagai diff.") },
      tools,
      allowedTools: tools,
      ...(chosen.length ? { plugins: found.plugins, skills: chosen } : {}),
      permissionMode: "dontAsk",
      settingSources: ["project"],
      includePartialMessages: true,
      maxBudgetUsd: MAX_USD,
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      abortController,
      env,
    },
  });

  let text = "";
  let meta = {};
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") {
      session.claudeSessionId = m.session_id;
      emit({ type: "info", claudeSessionId: m.session_id, model: m.model });
    } else if (m.type === "stream_event" && !m.parent_tool_use_id) {
      const ev = m.event;
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
        emit({ type: "delta", text: ev.delta.text });
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "text" && text && !text.endsWith("\n")) {
        text += "\n\n";
        emit({ type: "delta", text: "\n\n" });
      }
    } else if (m.type === "assistant") {
      for (const b of m.message?.content || []) {
        if (b.type === "tool_use") emit({ type: "tool", label: toolLabel(b.name, b.input), sub: Boolean(m.parent_tool_use_id) });
      }
    } else if (m.type === "result") {
      meta = { usd: m.total_cost_usd, usage: { input: m.usage?.input_tokens, output: m.usage?.output_tokens, cacheRead: m.usage?.cache_read_input_tokens } };
      if (m.subtype === "error_max_budget_usd") throw new Error(`Rem pengaman tercapai ($${MAX_USD}). Naikkan STUDIO_MAX_USD bila perlu.`);
      if (m.is_error && !text) throw new Error(m.result || m.subtype);
    }
  }
  session.claudeSynced = session.messages.length + 1; // +1 = jawaban ini
  return { text, meta };
}

async function runAnthropicApi(p, session, { model, systemText, signal, emit }) {
  if (!p.apiKey) throw new Error("ANTHROPIC_API_KEY belum diisi (⚙️ Penyedia atau .env).");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: p.apiKey });
  const messages = historyMessages(session).map((m) => ({ role: m.role, content: m.content }));
  const stream = client.messages.stream({ model, max_tokens: 16000, system: systemText, messages, thinking: { type: "adaptive" } }, { signal });
  let text = "";
  stream.on("text", (t) => {
    text += t;
    emit({ type: "delta", text: t });
  });
  const final = await stream.finalMessage();
  return { text, meta: { usage: { input: final.usage?.input_tokens, output: final.usage?.output_tokens } } };
}

// Riwayat sesi untuk penyedia stateless, dipotong dari belakang agar muat.
function historyMessages(session) {
  const out = [];
  let used = 0;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    const content = i === session.messages.length - 1 ? m.sent || m.text : m.text;
    if (used + content.length > HISTORY_CHARS && out.length) break;
    out.unshift({ role: m.role === "assistant" ? "assistant" : "user", content });
    used += content.length;
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const { sessionId, provider = "langganan", model, text = "", skills = [], files = [], mode = "baca" } = body;
  if (!text.trim()) return json(res, 400, { error: "Prompt kosong." });
  let session;
  if (sessionId) session = await readSession(sessionId);
  else session = newSession({ title: text.trim().split("\n")[0].slice(0, 70) });
  if (running.has(session.id)) return json(res, 409, { error: "Sesi ini masih memproses prompt." });

  const p = providers.resolve(provider);
  const chosenModel = model || p.defaultModel;
  const fileText = await attachFiles(files);
  let skillBlock = "";
  if (p.kind !== "claude-sdk" && skills.length) {
    for (const s of skills.slice(0, 5)) {
      const t = await skillText(s);
      if (t) skillBlock += `\n\n<skill name="${s}">\n${t}\n</skill>`;
    }
  }
  const sent = text + fileText;
  session.messages.push({ role: "user", text, sent: fileText ? sent : undefined, at: Date.now(), files: files.length ? files : undefined });
  if (session.title === "Sesi baru") session.title = text.trim().split("\n")[0].slice(0, 70);
  session.provider = provider;
  session.model = chosenModel;
  await writeSession(session);

  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  emit({ type: "session", id: session.id, title: session.title });

  const ac = new AbortController();
  running.set(session.id, ac);
  res.on("close", () => ac.abort());
  const tools = [];
  const emitT = (e) => {
    if (e.type === "tool") tools.push(e.label);
    emit(e);
  };
  const t0 = Date.now();
  let result;
  try {
    if (p.kind === "claude-sdk") {
      result = await runClaudeSdk(session, { model: chosenModel, prompt: sent, mode, skills, signal: ac.signal, emit: emitT });
    } else {
      const systemText = BASE_SYSTEM(skillBlock ? `\n\nSkill yang harus diikuti untuk tugas ini:${skillBlock}` : "");
      if (p.kind === "anthropic") {
        result = await runAnthropicApi(p, session, { model: chosenModel, systemText, signal: ac.signal, emit });
      } else {
        const info = {};
        const textOut = await providers.chatOpenAI(provider, {
          model: chosenModel,
          messages: [{ role: "system", content: systemText }, ...historyMessages(session)],
          signal: ac.signal,
          onDelta: (t) => emit({ type: "delta", text: t }),
          onInfo: (i) => {
            Object.assign(info, i);
            emit({ type: "info", ...i });
          },
        });
        result = { text: textOut, meta: info };
      }
    }
    const msg = { role: "assistant", text: result.text, at: Date.now(), provider, model: chosenModel, ms: Date.now() - t0, meta: result.meta, tools: tools.length ? tools : undefined };
    session.messages.push(msg);
    await writeSession(session);
    emit({ type: "done", message: msg });
  } catch (e) {
    const aborted = ac.signal.aborted;
    const msg = { role: "assistant", text: aborted ? "_(dihentikan)_" : `⚠️ ${friendly(e)}`, at: Date.now(), provider, model: chosenModel, error: true, tools: tools.length ? tools : undefined };
    session.messages.push(msg);
    await writeSession(session).catch(() => {});
    if (!res.writableEnded) emit({ type: "error", error: msg.text, message: msg });
  } finally {
    running.delete(session.id);
    res.end();
  }
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/credit|billing|usage limit/i.test(m)) return `Kredit habis/belum diklaim untuk penyedia ini. ${m}`;
  if (/auth|login|oauth|401|403/i.test(m) && /claude/i.test(m)) return "Belum login ke akun Claude. Jalankan `npm run login`, ketik /login, lalu coba lagi.";
  if (/ECONNREFUSED|fetch failed/i.test(m)) return `Tidak bisa menghubungi server penyedia (${m}). Untuk FreeLLMAPI/Ollama pastikan servernya menyala dan URL di ⚙️ Penyedia benar.`;
  if (/429|rate.?limit/i.test(m)) return `Kuota/batas laju penyedia tercapai. Coba model lain (mis. FreeLLMAPI 'auto'). ${m.slice(0, 200)}`;
  return m;
}

// ───────────────────────── router ─────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (guard && (await guard(req, res, url))) return;
    const p = url.pathname;

    if (p === "/api/info") {
      const sk = await findSkills().catch(() => ({ details: [] }));
      return json(res, 200, { workspace: WORKSPACE, workspaceName: path.basename(WORKSPACE), providers: providers.publicList(), skills: sk.details, maxUsd: MAX_USD, auth: Boolean(guard) });
    }

    // Penyedia
    let m;
    if (p === "/api/providers" && req.method === "GET") return json(res, 200, { providers: providers.publicList() });
    if ((m = p.match(/^\/api\/providers\/([\w-]+)$/)) && req.method === "POST") {
      await providers.update(m[1], await readBody(req));
      return json(res, 200, { providers: providers.publicList() });
    }
    if ((m = p.match(/^\/api\/providers\/([\w-]+)\/models$/))) {
      try {
        return json(res, 200, { models: await providers.listModels(m[1]) });
      } catch (e) {
        return json(res, 200, { models: [], error: e.message });
      }
    }

    // Sesi
    if (p === "/api/sessions" && req.method === "GET") {
      const [studio, claude, kantor, hvm] = await Promise.all([listStudio(), listClaude(), listKantor(), listHvm()]);
      const linked = new Set(studio.map((s) => s.claudeSessionId).filter(Boolean));
      const all = [...studio, ...claude.filter((c) => !linked.has(c.id)), ...kantor, ...hvm].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return json(res, 200, { sessions: all });
    }
    if (p === "/api/sessions" && req.method === "POST") {
      const s = newSession();
      await writeSession(s);
      return json(res, 200, { session: s });
    }
    if ((m = p.match(/^\/api\/sessions\/(studio|claude|kantor|hvm)\/([^/]+)$/))) {
      const [, source, rawId] = m;
      const id = decodeURIComponent(rawId);
      if (req.method === "GET") return json(res, 200, { session: await openSession(source, id) });
      if (source === "studio" && req.method === "PATCH") {
        const s = await readSession(id);
        const b = await readBody(req);
        if (typeof b.title === "string" && b.title.trim()) s.title = b.title.trim().slice(0, 120);
        await writeSession(s);
        return json(res, 200, { session: s });
      }
      if (source === "studio" && req.method === "DELETE") {
        running.get(id)?.abort();
        await fs.rm(sessionFile(id), { force: true });
        return json(res, 200, { ok: true });
      }
    }
    // Salin sesi sumber mana pun ke Studio agar bisa dilanjutkan dengan penyedia apa saja.
    // Sesi Claude Code dilanjutkan langsung (resume) bila penyedianya langganan.
    if ((m = p.match(/^\/api\/sessions\/(claude|kantor|hvm)\/([^/]+)\/lanjut$/)) && req.method === "POST") {
      const src = await openSession(m[1], decodeURIComponent(m[2]));
      const s = newSession({
        title: `${{ claude: "↻", kantor: "🏢", hvm: "💬" }[m[1]]} ${String(src.title).slice(0, 70)}`,
        origin: { source: m[1], id: src.id },
        messages: src.messages.map((x) => ({ role: x.role, text: x.text, at: Date.now() })),
        ...(m[1] === "claude" ? { claudeSessionId: src.id, provider: "langganan" } : {}),
      });
      s.claudeSynced = m[1] === "claude" ? s.messages.length : 0;
      await writeSession(s);
      return json(res, 200, { session: s });
    }

    if (p === "/api/chat" && req.method === "POST") return await handleChat(req, res);
    if ((m = p.match(/^\/api\/chat\/([\w-]+)\/stop$/)) && req.method === "POST") {
      running.get(m[1])?.abort();
      return json(res, 200, { ok: true });
    }

    // File workspace
    if (p === "/api/files") {
      const dir = safePath(url.searchParams.get("dir") || "");
      const entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((d) => !HIDDEN.has(d.name) && !(d.name === "data" && dir === here) && !/^\.env(\.|$)(?!example)/.test(d.name))
        .map((d) => ({ name: d.name, dir: d.isDirectory(), path: path.relative(WORKSPACE, path.join(dir, d.name)) }))
        .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
      return json(res, 200, { entries });
    }
    if (p === "/api/file" && req.method === "GET") {
      const abs = safePath(url.searchParams.get("path"));
      const st = await fs.stat(abs);
      if (st.size > MAX_FILE_BYTES) return json(res, 413, { error: "Berkas lebih dari 2 MB; buka dengan aplikasi lain." });
      const buf = await fs.readFile(abs);
      if (buf.subarray(0, 8000).includes(0)) return json(res, 415, { error: "Berkas biner tidak bisa dibuka di editor." });
      return json(res, 200, { path: path.relative(WORKSPACE, abs), content: buf.toString("utf8"), mtime: st.mtimeMs });
    }
    if (p === "/api/file" && req.method === "PUT") {
      const b = await readBody(req);
      const abs = safePath(b.path);
      if (b.mtime) {
        const st = await fs.stat(abs).catch(() => null);
        if (st && Math.abs(st.mtimeMs - b.mtime) > 1 && !b.force) return json(res, 409, { error: "Berkas sudah berubah di disk (mungkin oleh AI). Muat ulang atau simpan paksa.", mtime: st.mtimeMs });
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, String(b.content ?? ""), "utf8");
      const st = await fs.stat(abs);
      return json(res, 200, { ok: true, mtime: st.mtimeMs });
    }

    // Statis
    if (req.method === "GET" && !p.startsWith("/api/")) {
      const rel = p === "/" ? "index.html" : p.slice(1);
      const abs = path.resolve(PUBLIC, rel);
      if (!abs.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "Ditolak." });
      try {
        const buf = await fs.readFile(abs);
        res.writeHead(200, { "content-type": MIME[path.extname(abs)] || "application/octet-stream", "cache-control": "no-cache" });
        return res.end(buf);
      } catch {}
    }
    json(res, 404, { error: "Tidak ditemukan." });
  } catch (e) {
    if (res.headersSent) return res.end();
    json(res, e.status || (e.code === "ENOENT" ? 404 : 500), { error: e.code === "ENOENT" ? "Tidak ditemukan." : e.message });
  }
});

server.listen(PORT, HOST, () => {
  const ready = providers.publicList().filter((x) => x.ready).map((x) => x.id);
  console.log(`\n  🧭 Studio buka di http://${HOST}:${PORT}`);
  console.log(`     Workspace: ${WORKSPACE}`);
  console.log(`     Penyedia siap: ${ready.join(", ")}`);
  if (!PASSWORD) console.log("     (tanpa kata sandi — hanya aman di 127.0.0.1)");
});
