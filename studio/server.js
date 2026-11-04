// Studio — chat ala claude.ai + mode Code ala Claude Code, untuk Rahula.
// - Semua sesi di satu tempat: chat Studio, sesi Claude Code (~/.claude/projects, bisa dilanjutkan),
//   tugas Kantor PGA (hasil/), dan percakapan HvM AI (ngobrol/data/chats).
// - Penyedia per prompt: langganan Claude (Agent SDK), gratis (FreeLLMAPI, Ollama, Gemini, Groq,
//   OpenRouter :free), atau API berbayar. Ganti di tengah chat, riwayat ikut terbawa.
// - Mode Chat: seperti claude.ai (web search, lampiran foto/PDF/berkas).
//   Mode Code: seperti Claude Code (baca/ubah workspace, Bash) dengan izin per alat: Baca / Tanya / Otomatis.
// - Chat disimpan lokal di rig/VPS (<STUDIO_DATA>/arsip) dan opsional disinkronkan ke repo GitHub PRIVAT.
// Tanpa build step.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { makeAuth } from "../src/auth.js";
import { findSkills } from "../src/orchestrator-sdk.js";
import { createProviders } from "./providers.js";
import { createStorage } from "./storage.js";
import { createClaudeAccount } from "./akun-claude.js";
import { createKnowledge } from "./pengetahuan.js";
import { createResident } from "./penghuni.js";

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, "..");
const PUBLIC = path.join(here, "public");
const DATA = path.resolve(process.env.STUDIO_DATA || path.join(here, "data"));
const CHAT_HOME = path.join(DATA, "ruang-chat"); // cwd netral untuk mode Chat (tanpa CLAUDE.md proyek)
const WORKSPACE = path.resolve(process.env.STUDIO_WORKSPACE || APP_ROOT);
const PORT = Number(process.env.STUDIO_PORT || process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const PASSWORD = process.env.STUDIO_PASSWORD || process.env.APP_PASSWORD || "";
const MAX_USD = Number(process.env.STUDIO_MAX_USD || process.env.MAX_TASK_USD || 3);
const HISTORY_CHARS = 80_000; // riwayat yang dikirim ke penyedia tanpa memori sesi
const MAX_FILE_BYTES = 2 * 1024 * 1024; // editor
const MAX_UPLOAD = 60 * 1024 * 1024;

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
const guard = makeAuth(PASSWORD, { name: "Studio", tagline: "Semua chat AI Anda di satu tempat.", iconHref: "/icon.svg", themeColor: "#1f1e1d", dark: true, accent: "#d97757" });

await fs.mkdir(CHAT_HOME, { recursive: true });
const providers = createProviders(DATA);
await providers.load();
const store = createStorage(DATA);
await store.init();

let sdk = null;
async function getSdk() {
  sdk ||= await import("@anthropic-ai/claude-agent-sdk");
  return sdk;
}
// Env untuk proses Claude: tanpa API key berbayar (agar memakai langganan) dan tanpa identitas sesi
// Claude Code induk (bila Studio dijalankan dari dalam Claude Code).
function cleanEnv() {
  const env = { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined, BASH_ENV: undefined, ENV: undefined };
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ATTENDED"]) delete env[k];
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}
const account = createClaudeAccount({ store, cleanEnv, getSdk });
const knowledge = createKnowledge(store);
// Penghuni: agen yang berjalan terus di rig (detak berkala), lihat studio/penghuni.js.
const resident = createResident({ store, providers, account, cleanEnv, getSdk, appRoot: APP_ROOT, isRunning: (id) => running.has(id) });

// ───────────────────────── utilitas HTTP ─────────────────────────
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readRaw(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Berkas/permintaan terlalu besar."), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readBody(req, limit = 8 * 1024 * 1024) {
  const raw = (await readRaw(req, limit)).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
const MIME = {
  ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
  ".js": "text/javascript", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};
const IMAGE = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const err = (status, message) => Object.assign(new Error(message), { status });

// ───────────────────────── sumber sesi lain ─────────────────────────
async function listClaude() {
  try {
    const { listSessions } = await getSdk();
    return (await listSessions({ limit: 300 }))
      .filter((s) => !path.resolve(s.cwd || "/").startsWith(CHAT_HOME)) // chat Studio sendiri tidak diulang
      .map((s) => ({ source: "claude", id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || s.sessionId, updatedAt: s.lastModified, cwd: s.cwd || "", branch: s.gitBranch || "" }));
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
    if (st) out.push({ source: "kantor", id: f, title: f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}_?/, "").replace(/[-_]+/g, " ") || f, updatedAt: st.mtimeMs });
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
      out.push({ source: "hvm", id: c.id || f.replace(/\.json$/, ""), title: c.title || "(tanpa judul)", updatedAt: c.at || 0, model: c.model || "" });
    } catch {}
  }
  return out;
}
const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";

async function openSession(source, id) {
  if (source === "studio") return { ...(await store.read(id)), source, readonly: false };
  if (source === "claude") {
    const { getSessionMessages, getSessionInfo } = await getSdk();
    const info = await getSessionInfo(id).catch(() => null);
    const raw = await getSessionMessages(id, { limit: 3000 });
    const messages = [];
    const byId = new Map();
    for (const m of raw) {
      if (m.parent_tool_use_id) continue;
      const c = m.message?.content;
      if (m.type === "user") {
        if (Array.isArray(c)) for (const b of c) if (b.type === "tool_result" && byId.has(b.tool_use_id)) byId.get(b.tool_use_id).result = textOf(b.content).slice(0, 3000);
        const t = textOf(c).replace(/<(system-reminder|agent-message|task-notification)[^>]*>[\s\S]*?<\/\1>/g, "").trim();
        if (t && !/^<(command|local-command|system-reminder)/.test(t)) messages.push({ role: "user", text: t });
      } else if (m.type === "assistant") {
        let last = messages.at(-1);
        if (last?.role !== "assistant") messages.push((last = { role: "assistant", text: "", steps: [] }));
        for (const b of Array.isArray(c) ? c : []) {
          if (b.type === "text" && b.text.trim()) last.text += (last.text ? "\n\n" : "") + b.text.trim();
          if (b.type === "tool_use") {
            const step = { kind: "tool", id: b.id, name: b.name, label: toolLabel(b.name, b.input), input: toolPreview(b.name, b.input) };
            byId.set(b.id, step);
            last.steps.push(step);
          }
        }
      }
    }
    return { source, id, title: info?.customTitle || info?.summary || id, cwd: info?.cwd, mode: "code", messages, readonly: true };
  }
  if (source === "kantor") {
    if (!/^[^/\\]+\.md$/.test(id)) throw err(400, "Nama berkas tidak sah.");
    const body = await fs.readFile(path.join(APP_ROOT, "hasil", id), "utf8");
    const task = (body.match(/^> Tugas: ([\s\S]*?)\n\n/) || [, ""])[1].replace(/\n> /g, "\n");
    const rest = task ? body.slice(body.indexOf("\n\n") + 2) : body;
    return { source, id, title: id, readonly: true, messages: [...(task ? [{ role: "user", text: task }] : []), { role: "assistant", text: rest, provider: "kantor" }] };
  }
  if (source === "hvm") {
    if (!store.validId(id)) throw err(400, "ID tidak sah.");
    const c = JSON.parse(await fs.readFile(path.join(APP_ROOT, "ngobrol", "data", "chats", `${id}.json`), "utf8"));
    return { source, id, title: c.title, readonly: true, messages: (c.messages || []).filter((m) => m.role !== "system").map((m) => ({ role: m.role, text: textOf(m.content) || String(m.content || "") })) };
  }
  throw err(400, "Sumber sesi tidak dikenal.");
}

// ───────────────────────── file workspace ─────────────────────────
const HIDDEN = new Set([".git", "node_modules", ".rumah-agent"]);
function safePath(rel = "") {
  const abs = path.resolve(WORKSPACE, String(rel).replace(/^[/\\]+/, ""));
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) throw err(403, "Di luar workspace.");
  const r = path.relative(WORKSPACE, abs);
  if (/(^|[/\\])\.env(\.|$)(?!example)/.test(r) || abs === DATA || abs.startsWith(DATA + path.sep)) throw err(403, "Berkas rahasia/arsip tidak dibuka di editor.");
  return abs;
}

// ───────────────────────── skill ─────────────────────────
async function skillText(fullName) {
  const [plugin, name] = fullName.split(":");
  const base = plugin === "kantor" ? path.join(APP_ROOT, "skills") : path.join(APP_ROOT, "pengetahuan");
  if (!/^[\w.-]+$/.test(name || "")) return "";
  return fs.readFile(path.join(base, "skills", name, "SKILL.md"), "utf8").catch(() => "");
}

// ───────────────────────── alat & izin ─────────────────────────
function toolLabel(name, input = {}) {
  const i = input || {};
  const d = i.file_path || i.notebook_path || i.path || i.pattern || i.command || i.query || i.url || i.skill || i.description || "";
  return `${name}${d ? `(${String(d).replace(WORKSPACE + path.sep, "").replace(/\s+/g, " ").slice(0, 140)})` : ""}`;
}
function toolPreview(name, input = {}) {
  const i = input || {};
  const cut = (s, n) => (s == null ? undefined : String(s).length > n ? String(s).slice(0, n) + "\n…" : String(s));
  if (name === "Edit") return { file: i.file_path, old: cut(i.old_string, 4000), new: cut(i.new_string, 4000) };
  if (name === "MultiEdit") return { file: i.file_path, edits: (i.edits || []).slice(0, 8).map((e) => ({ old: cut(e.old_string, 1500), new: cut(e.new_string, 1500) })) };
  if (name === "Write") return { file: i.file_path, content: cut(i.content, 6000) };
  if (name === "Bash") return { command: cut(i.command, 3000), description: i.description };
  if (name === "TodoWrite") return { todos: (i.todos || []).map((t) => ({ content: t.content, status: t.status })) };
  return { json: cut(JSON.stringify(i, null, 1), 1500) };
}
const pendingPerms = new Map(); // id -> { resolve, sessionId }

// ───────────────────────── lampiran ─────────────────────────
const TEXT_EXT = /\.(txt|md|csv|tsv|json|js|mjs|cjs|ts|tsx|jsx|py|sh|html|css|xml|yml|yaml|ini|toml|sql|log|env\.example|java|c|cpp|h|go|rs|rb|php)$/i;
async function prepareAttachments(atts = []) {
  const images = [];
  let text = "";
  const paths = [];
  for (const a of atts.slice(0, 12)) {
    let abs;
    try {
      abs = store.uploadPath(a.file);
    } catch {
      continue;
    }
    const ext = path.extname(abs).toLowerCase();
    const st = await fs.stat(abs).catch(() => null);
    if (!st) continue;
    paths.push({ name: a.name, abs });
    if (IMAGE[ext] && st.size <= 5 * 1024 * 1024) {
      images.push({ mime: IMAGE[ext], b64: (await fs.readFile(abs)).toString("base64"), name: a.name });
    } else if (ext === ".pdf") {
      const out = await execFileP("pdftotext", ["-layout", abs, "-"], { maxBuffer: 30 * 1024 * 1024, timeout: 60_000 }).then((r) => r.stdout, () => "");
      text += out.trim() ? `\n\n--- Lampiran PDF: ${a.name} ---\n${out.slice(0, 150_000)}\n--- akhir ${a.name} ---` : `\n\n[Lampiran PDF ${a.name}: teks tidak bisa diambil (mungkin hasil scan)]`;
    } else if (st.size <= 400_000) {
      const buf = await fs.readFile(abs);
      if (TEXT_EXT.test(abs) || !buf.subarray(0, 8000).includes(0)) text += `\n\n--- Lampiran: ${a.name} ---\n${buf.toString("utf8")}\n--- akhir ${a.name} ---`;
      else text += `\n\n[Lampiran ${a.name} (${ext || "biner"}, ${st.size} byte)]`;
    } else text += `\n\n[Lampiran ${a.name} terlalu besar untuk ditempel (${Math.round(st.size / 1024)} KB)]`;
  }
  return { images, text, paths };
}

// ───────────────────────── menjalankan prompt ─────────────────────────
const running = new Map(); // sessionId -> AbortController
await resident.init();

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

function systemText(mode, profile, extra = "") {
  const now = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: process.env.TZ || "Asia/Jakarta" });
  const who = profile?.name || "Rahula";
  const about = profile?.about ? `\nTentang pengguna: ${profile.about}` : "";
  const base =
    mode === "code"
      ? `Anda asisten coding & kerja ${who} di Studio (mode Code), bekerja di folder ${WORKSPACE}. Jelaskan singkat apa yang Anda lakukan.`
      : `Anda asisten AI ${who} di Studio. Jawab hangat, jelas, dan langsung ke inti. Pakai bahasa pengguna (bawaan bahasa Indonesia). Pakai Markdown bila membantu; kode dalam blok kode bertanda bahasa.`;
  return `${base}\nWaktu sekarang: ${now}.${about}${extra}`;
}

async function runClaudeSdk(session, { model, prompt, images, mode, perm, think, skills, attachPaths, signal, emit, profile, extra = "", extraDirs = [] }) {
  const { query } = await getSdk();
  const found = await findSkills();
  const code = mode === "code";
  const cwd = code ? WORKSPACE : CHAT_HOME;
  // Sesi Claude terikat ke folder kerjanya; ganti mode → mulai sesi Claude baru dengan ringkasan riwayat.
  if (session.claudeSessionId && session.claudeCwd && session.claudeCwd !== cwd) {
    session.claudeSessionId = null;
    session.claudeSynced = 0;
  }
  const READ = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];
  const WRITE = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent", "TodoWrite"];
  const skillTool = found.names.length ? ["Skill"] : [];
  const tools = code ? [...READ, ...(perm === "baca" ? [] : WRITE), ...skillTool] : ["WebSearch", "WebFetch", "Read", ...skillTool];
  const allowed = code && perm === "otomatis" ? tools : code ? [...READ, ...skillTool, "TodoWrite"] : tools;
  const chosen = skills?.length ? found.names.filter((n) => skills.includes(n)) : found.names;

  const unsynced = session.messages.slice(session.claudeSynced || 0, -1);
  const preface = unsynced.length ? `Konteks percakapan sebelumnya:\n${transcript(unsynced, 50_000)}\n\n---\n\n` : "";
  const notes = attachPaths.length ? `\n\n(Lampiran tersimpan di: ${attachPaths.map((p) => `${p.abs}`).join(", ")} — buka dengan Read bila perlu.)` : "";
  const fullText = preface + prompt + notes;

  const ac = new AbortController();
  signal.addEventListener("abort", () => ac.abort(), { once: true });
  const env = account.sdkEnv(cleanEnv());

  const always = new Set();
  const canUseTool = async (name, input, { signal: sig }) => {
    if (always.has(name)) return { behavior: "allow", updatedInput: input };
    const id = crypto.randomUUID();
    emit({ type: "permission", id, name, label: toolLabel(name, input), input: toolPreview(name, input) });
    const ans = await new Promise((resolve) => {
      pendingPerms.set(id, { resolve, sessionId: session.id });
      sig?.addEventListener("abort", () => resolve({ allow: false }), { once: true });
      signal.addEventListener("abort", () => resolve({ allow: false }), { once: true });
      setTimeout(() => resolve({ allow: false, timeout: true }), 15 * 60_000).unref();
    });
    pendingPerms.delete(id);
    emit({ type: "permission_done", id, allow: ans.allow, always: ans.always });
    if (ans.allow) {
      if (ans.always) always.add(name);
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: ans.timeout ? "Tidak dijawab dalam 15 menit." : ans.note ? `Pengguna menolak: ${ans.note}` : "Pengguna menolak tindakan ini. Tanyakan cara lain atau berhenti." };
  };

  const content = [...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } })), { type: "text", text: fullText }];
  const promptInput = images.length
    ? (async function* () {
        yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
      })()
    : fullText;

  const q = query({
    prompt: promptInput,
    options: {
      model,
      cwd,
      ...(code ? { systemPrompt: { type: "preset", preset: "claude_code", append: systemText("code", profile, extra) } } : { systemPrompt: systemText("chat", profile, extra) }),
      tools,
      allowedTools: allowed,
      ...(chosen.length ? { plugins: found.plugins, skills: chosen } : {}),
      permissionMode: code && perm === "otomatis" ? "dontAsk" : code ? "default" : "dontAsk",
      ...(code && perm === "tanya" ? { canUseTool } : {}),
      additionalDirectories: [path.join(store.ARSIP, "lampiran"), ...extraDirs],
      settingSources: code ? ["project"] : [],
      includePartialMessages: true,
      thinking: { type: "adaptive", display: "summarized" },
      ...(think ? { effort: "high" } : {}),
      maxBudgetUsd: MAX_USD,
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      abortController: ac,
      env,
    },
  });

  let text = "";
  let thinking = "";
  let meta = {};
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") {
      session.claudeSessionId = m.session_id;
      session.claudeCwd = cwd;
      emit({ type: "info", claudeSessionId: m.session_id, servedModel: m.model });
    } else if (m.type === "system" && m.subtype === "compact_boundary") {
      emit({ type: "note", text: "🗜️ Percakapan dipadatkan otomatis agar muat." });
    } else if (m.type === "stream_event" && !m.parent_tool_use_id) {
      const ev = m.event;
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
        emit({ type: "delta", text: ev.delta.text });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
        thinking += ev.delta.thinking;
        emit({ type: "thinking", text: ev.delta.thinking });
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "text" && text && !text.endsWith("\n")) {
        text += "\n\n";
        emit({ type: "delta", text: "\n\n" });
      }
    } else if (m.type === "assistant") {
      for (const b of m.message?.content || []) {
        if (b.type === "tool_use") emit({ type: "tool", id: b.id, name: b.name, label: toolLabel(b.name, b.input), input: toolPreview(b.name, b.input), sub: Boolean(m.parent_tool_use_id) });
      }
    } else if (m.type === "user" && !m.parent_tool_use_id && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (b.type === "tool_result") emit({ type: "tool_result", id: b.tool_use_id, text: textOf(b.content).slice(0, 4000), error: Boolean(b.is_error) });
      }
    } else if (m.type === "result") {
      meta = { usd: m.total_cost_usd, usage: { input: (m.usage?.input_tokens || 0) + (m.usage?.cache_read_input_tokens || 0) + (m.usage?.cache_creation_input_tokens || 0), output: m.usage?.output_tokens } };
      if (m.subtype === "error_max_budget_usd") throw new Error(`Rem pengaman tercapai ($${MAX_USD} per prompt). Naikkan STUDIO_MAX_USD bila perlu.`);
      if (m.is_error && !text) throw new Error(m.result || m.subtype);
    }
  }
  session.claudeSynced = session.messages.length + 1;
  return { text, thinking, meta };
}

// Riwayat untuk penyedia tanpa memori sesi, dipotong dari belakang agar muat.
function historyMessages(session, { images = [], openai = false } = {}) {
  const out = [];
  let used = 0;
  const last = session.messages.length - 1;
  for (let i = last; i >= 0; i--) {
    const m = session.messages[i];
    let content = m.sent || m.text;
    if (i !== last && m.attachments?.length) content += `\n[Lampiran: ${m.attachments.map((a) => a.name).join(", ")}]`;
    if (used + content.length > HISTORY_CHARS && out.length) break;
    if (i === last && images.length) {
      content = openai
        ? [{ type: "text", text: content }, ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } }))]
        : [...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } })), { type: "text", text: content }];
    }
    out.unshift({ role: m.role === "assistant" ? "assistant" : "user", content });
    used += typeof content === "string" ? content.length : 2000;
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function runAnthropicApi(p, session, { model, system, images, think, signal, emit }) {
  if (!p.apiKey) throw new Error("ANTHROPIC_API_KEY belum diisi (Pengaturan → Model & penyedia, atau .env).");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: p.apiKey });
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 32000,
      system,
      messages: historyMessages(session, { images }),
      thinking: { type: "adaptive", display: "summarized" },
      ...(think ? { output_config: { effort: "high" } } : {}),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    },
    { signal },
  );
  let text = "";
  let thinking = "";
  stream.on("text", (t) => {
    text += t;
    emit({ type: "delta", text: t });
  });
  stream.on("streamEvent", (ev) => {
    if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
      thinking += ev.delta.thinking;
      emit({ type: "thinking", text: ev.delta.thinking });
    }
    if (ev.type === "content_block_start" && ev.content_block?.type === "server_tool_use") emit({ type: "tool", id: ev.content_block.id, name: "WebSearch", label: "WebSearch" });
  });
  const final = await stream.finalMessage();
  return { text, thinking, meta: { usage: { input: final.usage?.input_tokens, output: final.usage?.output_tokens } } };
}

// Judul otomatis singkat lewat penyedia gratis yang siap (tidak memakai kredit langganan).
async function autoTitle(session) {
  const free = providers.publicList().find((p) => p.group === "gratis" && p.ready && p.id !== "ollama") || null;
  if (!free) return;
  const first = session.messages.find((m) => m.role === "user")?.text || "";
  const ans = session.messages.find((m) => m.role === "assistant")?.text || "";
  let t = "";
  try {
    await providers.chatOpenAI(free.id, {
      model: free.id === "freellmapi" ? "auto:fast" : free.defaultModel,
      messages: [
        { role: "system", content: "Buat judul chat 2–6 kata dalam bahasa yang sama dengan pengguna. Hanya judulnya, tanpa tanda kutip atau titik." },
        { role: "user", content: `Pesan: ${first.slice(0, 1500)}\n\nJawaban: ${ans.slice(0, 800)}` },
      ],
      signal: AbortSignal.timeout(12_000),
      onDelta: (d) => (t += d),
    });
  } catch {
    return;
  }
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/["'`*#]/g, "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  if (t && t.length <= 80) {
    const s = await store.read(session.id).catch(() => null);
    if (s && !s.titleManual) {
      s.title = t;
      await store.write(s, { keepTime: true });
    }
  }
}

async function handleChat(req, res) {
  const body = await readBody(req, 2 * 1024 * 1024);
  const { sessionId, provider = "langganan", model, text = "", skills = [], files = [], attachments = [], mode = "chat", perm = "tanya", think = false, truncateAt, project } = body;
  if (!text.trim() && !attachments.length) return json(res, 400, { error: "Pesan kosong." });
  let session = sessionId ? await store.read(sessionId) : store.create({ title: text.trim().split("\n")[0].slice(0, 70) || attachments[0]?.name || "Chat baru", mode });
  if (running.has(session.id)) return json(res, 409, { error: "Chat ini masih memproses pesan sebelumnya." });

  // Edit / ulangi: buang pesan mulai indeks ini. Sesi Claude tidak bisa dipotong → mulai ulang dengan ringkasan.
  if (Number.isInteger(truncateAt) && truncateAt >= 0 && truncateAt < session.messages.length) {
    session.messages = session.messages.slice(0, truncateAt);
    session.claudeSessionId = null;
    session.claudeSynced = 0;
  }

  const p = providers.resolve(provider);
  const chosenModel = model || p.defaultModel;
  const profile = store.settings().profile || {};
  let fileText = "";
  for (const rel of files.slice(0, 8)) {
    try {
      const abs = safePath(rel);
      const st = await fs.stat(abs);
      fileText += st.size > 300_000 ? `\n\n[Berkas ${rel} terlalu besar untuk ditempel]` : `\n\n--- Berkas: ${rel} ---\n${await fs.readFile(abs, "utf8")}\n--- akhir ${rel} ---`;
    } catch (e) {
      fileText += `\n\n[Berkas ${rel} tidak bisa dibaca: ${e.message}]`;
    }
  }
  const att = await prepareAttachments(attachments);
  let skillBlock = "";
  if (p.kind !== "claude-sdk" && skills.length) {
    for (const s of skills.slice(0, 5)) {
      const t = await skillText(s);
      if (t) skillBlock += `\n\n<skill name="${s}">\n${t}\n</skill>`;
    }
  }
  const sent = text + fileText + att.text;
  session.messages.push({ role: "user", text, sent: sent !== text ? sent : undefined, at: Date.now(), files: files.length ? files : undefined, attachments: attachments.length ? attachments : undefined });
  if (session.title === "Chat baru" || session.title === "Sesi baru") session.title = (text.trim().split("\n")[0] || attachments[0]?.name || "Chat").slice(0, 70);
  Object.assign(session, { provider, model: chosenModel, mode });
  if (project !== undefined) session.project = project || undefined;
  await store.write(session);
  // Konteks tambahan: memori pengguna + pengetahuan proyek.
  const settingsNow = store.settings();
  const mem = settingsNow.useMemory === false ? "" : await knowledge.memory();
  const proj = await knowledge.context(session.project);
  let extra = (mem ? `\n\n<memori_pengguna>\n${mem.slice(0, 8000)}\n</memori_pengguna>` : "") + proj.text;
  if (session.resident) extra += await resident.chatContext();

  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  const ac = new AbortController();
  running.set(session.id, ac);
  res.on("close", () => ac.abort());
  // Rekam langkah (alat, izin, hasil) agar tampil lagi saat chat dibuka ulang.
  const steps = [];
  const stepById = new Map();
  let thinkingLive = "";
  const emit = (e) => {
    if (e.type === "tool") {
      const s = { kind: "tool", id: e.id, name: e.name, label: e.label, input: e.input, sub: e.sub };
      steps.push(s);
      if (e.id) stepById.set(e.id, s);
    } else if (e.type === "tool_result" && stepById.has(e.id)) Object.assign(stepById.get(e.id), { result: e.text, error: e.error });
    else if (e.type === "permission") steps.push({ kind: "perm", id: e.id, label: e.label, name: e.name });
    else if (e.type === "permission_done") {
      const s = steps.find((x) => x.kind === "perm" && x.id === e.id);
      if (s) s.allow = e.allow;
    } else if (e.type === "thinking") thinkingLive += e.text;
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  emit({ type: "session", id: session.id, title: session.title });
  const keepAlive = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 20_000);

  const t0 = Date.now();
  const firstTurn = session.messages.length === 1;
  try {
    let result;
    if (p.kind === "claude-sdk") {
      result = await runClaudeSdk(session, { model: chosenModel, prompt: sent, images: att.images, mode, perm, think, skills, attachPaths: att.paths, signal: ac.signal, emit, profile, extra, extraDirs: proj.dir ? [proj.dir] : [] });
    } else {
      const system = systemText(mode, profile, extra + (skillBlock ? `\n\nSkill yang harus diikuti untuk tugas ini:${skillBlock}` : ""));
      if (p.kind === "anthropic") result = await runAnthropicApi(p, session, { model: chosenModel, system, images: att.images, think, signal: ac.signal, emit });
      else {
        const info = {};
        let thinking = "";
        let inThink = false;
        const textOut = await providers.chatOpenAI(provider, {
          model: chosenModel,
          messages: [{ role: "system", content: system }, ...historyMessages(session, { images: att.images, openai: true })],
          signal: ac.signal,
          onDelta: (t) => {
            // Model penalar (DeepSeek-R1, Qwen3) menulis <think>…</think> di teks → pisahkan ke panel berpikir.
            if (t.includes("<think>")) inThink = true;
            if (inThink) {
              const clean = t.replace(/<\/?think>/g, "");
              thinking += clean;
              emit({ type: "thinking", text: clean });
              if (t.includes("</think>")) inThink = false;
              return;
            }
            emit({ type: "delta", text: t });
          },
          onReasoning: (t) => {
            thinking += t;
            emit({ type: "thinking", text: t });
          },
          onInfo: (i) => {
            Object.assign(info, i);
            emit({ type: "info", ...i });
          },
        });
        result = { text: textOut.replace(/<think>[\s\S]*?<\/think>\s*/g, ""), thinking, meta: info };
      }
    }
    const msg = { role: "assistant", text: result.text, thinking: result.thinking || undefined, at: Date.now(), provider, model: chosenModel, ms: Date.now() - t0, meta: result.meta, steps: steps.length ? steps : undefined };
    session.messages.push(msg);
    await store.write(session);
    emit({ type: "done", message: msg, title: session.title });
    if (firstTurn) autoTitle(session).catch(() => {});
  } catch (e) {
    const aborted = ac.signal.aborted;
    const msg = { role: "assistant", text: aborted ? "_(dihentikan)_" : `⚠️ ${friendly(e)}`, thinking: thinkingLive || undefined, at: Date.now(), provider, model: chosenModel, error: !aborted, stopped: aborted || undefined, steps: steps.length ? steps : undefined };
    session.messages.push(msg);
    await store.write(session).catch(() => {});
    emit({ type: "error", error: msg.text, message: msg });
  } finally {
    clearInterval(keepAlive);
    running.delete(session.id);
    if (session.resident) resident.afterChat().catch(() => {});
    for (const [id, pp] of pendingPerms) if (pp.sessionId === session.id) pp.resolve({ allow: false }), pendingPerms.delete(id);
    res.end();
  }
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/credit|billing|usage limit/i.test(m)) return `Kredit habis atau belum diklaim untuk penyedia ini. ${m}`;
  if (/auth|login|oauth|401|403|invalid api key|not logged/i.test(m)) return "Belum masuk ke akun Claude. Buka Pengaturan → Akun Claude → **Masuk dengan Claude**, lalu coba lagi.";
  if (/ECONNREFUSED|fetch failed/i.test(m)) return `Tidak bisa menghubungi server penyedia (${m}). Untuk FreeLLMAPI/Ollama pastikan servernya menyala dan URL di Pengaturan benar.`;
  if (/429|rate.?limit/i.test(m)) return `Kuota/batas laju penyedia tercapai. Coba model lain (mis. FreeLLMAPI "auto"). ${m.slice(0, 200)}`;
  if (/image|vision|multimodal/i.test(m)) return `Model ini tidak bisa membaca gambar. Pilih model yang mendukung gambar (Claude, Gemini, GPT-4o). ${m.slice(0, 200)}`;
  return m;
}

// ───────────────────────── pencarian ─────────────────────────
async function search(q) {
  const needle = q.toLowerCase();
  const out = [];
  for (const s of await store.list()) {
    let hit = s.title.toLowerCase().includes(needle) ? s.title : "";
    if (!hit)
      for (const m of s.messages) {
        const i = (m.text || "").toLowerCase().indexOf(needle);
        if (i >= 0) {
          hit = (i > 40 ? "…" : "") + m.text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ");
          break;
        }
      }
    if (hit) out.push({ source: "studio", id: s.id, title: s.title, snippet: hit, updatedAt: s.updatedAt, mode: s.mode, pinned: s.pinned });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
}

// ───────────────────────── router ─────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (guard && (await guard(req, res, url))) return;
    const p = url.pathname;
    let m;

    if (p === "/api/info") {
      const sk = await findSkills().catch(() => ({ details: [] }));
      return json(res, 200, {
        workspace: WORKSPACE, workspaceName: path.basename(WORKSPACE), providers: providers.publicList(), skills: sk.details,
        maxUsd: MAX_USD, auth: Boolean(guard), sync: store.syncStatus(), profile: store.settings().profile || { name: "Rahula" },
        onboarded: Boolean(store.settings().onboarded), resident: resident.view(), useMemory: store.settings().useMemory !== false, projects: await knowledge.list(), claudeStudioLogin: account.hasStudioToken(),
      });
    }

    // Pengaturan
    if (p === "/api/settings/profile" && req.method === "POST") {
      const b = await readBody(req);
      await store.saveSettings({ profile: { name: String(b.name || "").slice(0, 60), about: String(b.about || "").slice(0, 2000) } });
      return json(res, 200, { profile: store.settings().profile });
    }
    if (p === "/api/settings/sync" && req.method === "POST") {
      try {
        return json(res, 200, { sync: await store.configureSync(await readBody(req)) });
      } catch (e) {
        return json(res, 400, { error: e.message, sync: store.syncStatus() });
      }
    }
    if (p === "/api/sync" && req.method === "POST") {
      try {
        return json(res, 200, { sync: await store.syncNow("manual") });
      } catch (e) {
        return json(res, 200, { sync: store.syncStatus(), error: e.message });
      }
    }

    if (p === "/api/settings/onboarded" && req.method === "POST") {
      await store.saveSettings({ onboarded: true });
      return json(res, 200, { ok: true });
    }
    if (p === "/api/settings/memory" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b.use === "boolean") await store.saveSettings({ useMemory: b.use });
      if (typeof b.text === "string") await knowledge.setMemory(b.text.slice(0, 50_000));
      return json(res, 200, { useMemory: store.settings().useMemory !== false, text: await knowledge.memory() });
    }
    if (p === "/api/settings/memory") return json(res, 200, { useMemory: store.settings().useMemory !== false, text: await knowledge.memory() });

    // Penghuni
    if (p === "/api/penghuni" && req.method === "GET") return json(res, 200, resident.view());
    if (p === "/api/penghuni" && req.method === "POST") return json(res, 200, await resident.configure(await readBody(req)));
    if (p === "/api/penghuni/detak" && req.method === "POST") return json(res, 200, { entry: await resident.tick("diminta"), ...resident.view() });
    if (p === "/api/penghuni/dibaca" && req.method === "POST") {
      await resident.markRead();
      return json(res, 200, { ok: true });
    }
    if (p === "/api/penghuni/harian") {
      const d = url.searchParams.get("tanggal") || "";
      return json(res, 200, { dates: await resident.diaryDates(), text: await resident.diary(d) });
    }
    if (p === "/api/penghuni/log") return json(res, 200, { log: await resident.log(80) });
    if (p === "/api/penghuni/ingatan" && req.method === "GET") return json(res, 200, { memori: await resident.memory(), tujuan: await resident.goals(), berkas: await resident.homeFiles() });
    if (p === "/api/penghuni/ingatan" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b.memori === "string") await resident.setMemory(b.memori);
      if (typeof b.tujuan === "string") await resident.setGoals(b.tujuan);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/penghuni/berkas") {
      try {
        return json(res, 200, { text: await resident.readHomeFile(url.searchParams.get("path") || "") });
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }

    // Akun Claude (langganan)
    if (p === "/api/claude/status") return json(res, 200, { ...(await account.status({ fresh: url.searchParams.has("fresh") })), studioLogin: account.hasStudioToken() });
    if (p === "/api/claude/login" && req.method === "POST") return json(res, 200, await account.startLogin());
    if (p === "/api/claude/login") return json(res, 200, account.view());
    if (p === "/api/claude/login/code" && req.method === "POST") {
      const r = await account.submitCode((await readBody(req)).code);
      return json(res, 200, r.state === "done" ? { ...r, status: await account.status({ fresh: true }) } : r);
    }
    if (p === "/api/claude/logout" && req.method === "POST") {
      await account.logout();
      return json(res, 200, { ok: true });
    }

    // Impor ekspor claude.ai
    if (p === "/api/import/claude-ai" && req.method === "POST") {
      const buf = await readRaw(req, 1024 * 1024 * 1024);
      try {
        return json(res, 200, { result: await knowledge.importClaudeAi(buf, url.searchParams.get("name") || "") });
      } catch (e) {
        return json(res, 400, { error: e.code === "ENOENT" ? "Perintah unzip belum terpasang di server (sudo apt install unzip)." : e.message });
      }
    }

    // Proyek & pengetahuan
    if (p === "/api/projects" && req.method === "GET") return json(res, 200, { projects: await knowledge.list() });
    if (p === "/api/projects" && req.method === "POST") {
      const b = await readBody(req);
      if (!String(b.name || "").trim()) return json(res, 400, { error: "Nama proyek kosong." });
      const id = await knowledge.save({ id: b.id, name: String(b.name).trim().slice(0, 80), description: String(b.description || "").slice(0, 2000), instructions: String(b.instructions || "").slice(0, 50_000) });
      return json(res, 200, { id, projects: await knowledge.list() });
    }
    if ((m = p.match(/^\/api\/projects\/([\w-]+)$/)) && req.method === "DELETE") {
      await knowledge.remove(m[1]);
      return json(res, 200, { projects: await knowledge.list() });
    }
    if ((m = p.match(/^\/api\/projects\/([\w-]+)\/files$/)) && req.method === "POST") {
      const buf = await readRaw(req, MAX_UPLOAD);
      await knowledge.addFile(m[1], decodeURIComponent(url.searchParams.get("name") || "berkas.txt"), buf);
      return json(res, 200, { projects: await knowledge.list() });
    }
    if ((m = p.match(/^\/api\/projects\/([\w-]+)\/files$/)) && req.method === "DELETE") {
      await knowledge.removeFile(m[1], url.searchParams.get("name"));
      return json(res, 200, { projects: await knowledge.list() });
    }

    // Penyedia
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
      const studio = (await store.list()).map((s) => ({ source: "studio", id: s.id, title: s.title, updatedAt: s.updatedAt, provider: s.provider, model: s.model, mode: s.mode || "chat", pinned: Boolean(s.pinned), claudeSessionId: s.claudeSessionId || null, origin: s.origin?.source || null, project: s.project || null, resident: Boolean(s.resident) }));
      const [claude, kantor, hvm] = await Promise.all([listClaude(), listKantor(), listHvm()]);
      const linked = new Set(studio.map((s) => s.claudeSessionId).filter(Boolean));
      const all = [...studio, ...claude.filter((c) => !linked.has(c.id)), ...kantor, ...hvm].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return json(res, 200, { sessions: all, sync: store.syncStatus(), resident: resident.view() });
    }
    if (p === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      return json(res, 200, { results: q.length >= 2 ? await search(q) : [] });
    }
    if ((m = p.match(/^\/api\/sessions\/studio\/([\w-]+)\/export\.md$/))) {
      const s = await store.read(m[1]);
      const name = (s.title || "chat").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "chat";
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` });
      return res.end(store.toMarkdown(s));
    }
    if ((m = p.match(/^\/api\/sessions\/(studio|claude|kantor|hvm)\/([^/]+)$/))) {
      const [, source, rawId] = m;
      const id = decodeURIComponent(rawId);
      if (req.method === "GET") return json(res, 200, { session: await openSession(source, id), running: running.has(id) });
      if (source === "studio" && req.method === "PATCH") {
        const s = await store.read(id);
        const b = await readBody(req);
        if (typeof b.title === "string" && b.title.trim()) Object.assign(s, { title: b.title.trim().slice(0, 120), titleManual: true });
        if (typeof b.pinned === "boolean") s.pinned = b.pinned;
        await store.write(s, { keepTime: true });
        return json(res, 200, { session: s });
      }
      if (source === "studio" && req.method === "DELETE") {
        running.get(id)?.abort();
        await store.remove(id);
        return json(res, 200, { ok: true });
      }
    }
    if ((m = p.match(/^\/api\/sessions\/(claude|kantor|hvm)\/([^/]+)\/lanjut$/)) && req.method === "POST") {
      const src = await openSession(m[1], decodeURIComponent(m[2]));
      const s = store.create({
        title: String(src.title).slice(0, 80),
        origin: { source: m[1], id: src.id },
        mode: m[1] === "claude" ? "code" : "chat",
        messages: src.messages.map((x) => ({ role: x.role, text: x.text, steps: x.steps, at: Date.now() })),
        ...(m[1] === "claude" && path.resolve(src.cwd || "") === WORKSPACE ? { claudeSessionId: src.id, claudeCwd: WORKSPACE, provider: "langganan" } : {}),
      });
      s.claudeSynced = s.claudeSessionId ? s.messages.length : 0;
      await store.write(s);
      return json(res, 200, { session: s });
    }

    // Chat
    if (p === "/api/chat" && req.method === "POST") return await handleChat(req, res);
    if ((m = p.match(/^\/api\/chat\/([\w-]+)\/stop$/)) && req.method === "POST") {
      running.get(m[1])?.abort();
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/permission\/([\w-]+)$/)) && req.method === "POST") {
      const pp = pendingPerms.get(m[1]);
      if (!pp) return json(res, 404, { error: "Permintaan izin sudah kedaluwarsa." });
      const b = await readBody(req);
      pp.resolve({ allow: Boolean(b.allow), always: Boolean(b.always), note: b.note ? String(b.note).slice(0, 500) : "" });
      return json(res, 200, { ok: true });
    }

    // Lampiran
    if (p === "/api/upload" && req.method === "POST") {
      const name = decodeURIComponent(url.searchParams.get("name") || "berkas");
      const buf = await readRaw(req, MAX_UPLOAD);
      if (!buf.length) return json(res, 400, { error: "Berkas kosong." });
      return json(res, 200, { attachment: { ...(await store.saveUpload(name, buf)), type: req.headers["content-type"] || "" } });
    }
    if (p === "/api/lampiran") {
      const abs = store.uploadPath(url.searchParams.get("file"));
      const buf = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const inline = IMAGE[ext] || ext === ".pdf";
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "private, max-age=86400", "content-disposition": `${inline ? "inline" : "attachment"}; filename="${path.basename(abs).replace(/^[0-9a-f]{8}-/, "").replace(/"/g, "")}"`, "x-content-type-options": "nosniff" });
      return res.end(buf);
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
      return json(res, 200, { ok: true, mtime: (await fs.stat(abs)).mtimeMs });
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
  const sy = store.syncStatus();
  console.log(`\n  🧭 Studio buka di http://${HOST}:${PORT}`);
  console.log(`     Workspace (mode Code): ${WORKSPACE}`);
  console.log(`     Arsip chat: ${sy.localPath}${sy.mode !== "lokal" ? `  ⇄ ${sy.mode === "github" ? `github.com/${sy.repo}` : sy.url}` : " (lokal)"}`);
  console.log(`     Penyedia siap: ${ready.join(", ")}`);
  if (!PASSWORD) console.log("     (tanpa kata sandi — hanya aman di 127.0.0.1)");
});
