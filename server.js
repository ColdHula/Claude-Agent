// Server kecil tanpa framework: menyajikan public/, menerima tugas,
// dan mengalirkan event kerja tim ke browser lewat Server-Sent Events.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgents } from "./src/agents.js";
import { runTask, MODELS, PRESETS, defaultModels } from "./src/orchestrator.js";
import { runTaskSdk } from "./src/orchestrator-sdk.js";
import { makeAuth } from "./src/auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
// Mesin kerja: "langganan" (bawaan) memakai login akun Claude lewat Agent SDK, sehingga
// biayanya diambil dari kredit Agent SDK bulanan langganan. "api" memakai ANTHROPIC_API_KEY
// berbayar dan hanya dipakai bila ENGINE=api ditulis di .env.
const ENGINE = process.env.ENGINE === "api" ? "api" : "langganan";
const LIVE = !process.env.DEMO && (ENGINE === "langganan" || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
const run = ENGINE === "api" ? runTask : runTaskSdk;

// Kata sandi: wajib bila server tidak hanya untuk laptop sendiri.
const LOCAL_ONLY = ["127.0.0.1", "localhost", "::1"].includes(HOST);
if (!LOCAL_ONLY && !process.env.APP_PASSWORD) {
  console.error(`\n  ⛔ HOST=${HOST} membuka Kantor PGA ke jaringan, tetapi APP_PASSWORD belum diisi di .env.`);
  console.error("     Isi APP_PASSWORD (minimal 12 karakter) agar orang lain tidak bisa memakai kredit dan membaca data PGD.\n");
  process.exit(1);
}
if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.length < 12) {
  console.error("\n  ⛔ APP_PASSWORD terlalu pendek. Pakai minimal 12 karakter.\n");
  process.exit(1);
}
const guard = makeAuth(process.env.APP_PASSWORD);

const team = await loadAgents();
const jobs = new Map(); // id -> { events, listeners, done, controller }
let running = null;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 2_000_000) throw new Error("Tugas terlalu besar (maks 2 MB).");
  }
  return JSON.parse(data || "{}");
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tugas";
}

async function saveResult(task, result) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = `${stamp}_${slug(task)}.md`;
  const appendix = result.workLog
    .map((w) => `### ${w.sim} — ${w.title}\n\n**Instruksi dari Pemimpin:**\n\n${w.instruksi}\n\n**Hasil:**\n\n${w.output}`)
    .join("\n\n---\n\n");
  const body = `> Tugas: ${task.replace(/\n/g, "\n> ")}\n\n${result.final}\n\n---\n\n## Lampiran: hasil kerja tiap agent\n\n${appendix || "_Tidak ada._"}\n`;
  await fs.writeFile(path.join(here, "hasil", file), body, "utf8");
  return file;
}

// Pilihan preset dari layar; bila kosong pakai pengaturan .env.
function resolveModels(preset) {
  const m = PRESETS[preset] ? { leader: PRESETS[preset].leader, worker: PRESETS[preset].worker } : defaultModels();
  for (const id of [m.leader, m.worker]) if (!MODELS[id]) throw new Error(`Model tidak dikenal: ${id}. Pilih salah satu: ${Object.keys(MODELS).join(", ")}.`);
  return m;
}

function startJob(task, models) {
  const id = Date.now().toString(36);
  const job = { events: [], listeners: new Set(), done: false, controller: new AbortController() };
  jobs.set(id, job);
  running = id;
  const emit = (event) => {
    const e = { ...event, t: Date.now() };
    job.events.push(e);
    for (const res of job.listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  emit({ type: "task", id, text: task, models: { leader: MODELS[models.leader].label, worker: MODELS[models.worker].label } });
  // Muat ulang instruksi + pengetahuan di setiap tugas, agar file baru di pengetahuan/ langsung terpakai.
  loadAgents()
    .then((fresh) => {
      if (fresh.knowledge.files.length) {
        emit({ type: "leader_say", text: `📚 Pengetahuan dimuat: ${fresh.knowledge.files.join(", ")} (${fresh.knowledge.chars.toLocaleString("id-ID")} karakter${fresh.knowledge.truncated ? ", sebagian dipotong" : ""}).` });
      }
      return run(task, emit, { ...fresh, models, signal: job.controller.signal });
    })
    .then(async (result) => {
      const file = await saveResult(task, result).catch(() => null);
      emit({ type: "final", output: result.final, file, workLog: result.workLog, usd: Number(result.cost.toFixed(4)) });
    })
    .catch((err) => emit({ type: "error", message: job.controller.signal.aborted ? "Tugas dibatalkan." : String(err?.message || err) }))
    .finally(() => {
      job.done = true;
      running = null;
      for (const res of job.listeners) res.end();
      job.listeners.clear();
    });
  return id;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (guard && (await guard(req, res, url))) return;
    if (url.pathname === "/api/status") {
      return json(res, 200, {
        mode: LIVE ? "live" : "demo",
        engine: ENGINE,
        defaultModels: defaultModels(),
        presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
        running,
        leader: { id: team.leader.id, sim: team.leader.sim, title: team.leader.title },
        agents: team.agents.map(({ id, sim, title, icon, web, description }) => ({ id, sim, title, icon, web, description })),
      });
    }
    if (url.pathname === "/api/tasks" && req.method === "POST") {
      if (!LIVE) return json(res, 400, { error: "Server dalam mode demo (DEMO=1, atau ENGINE=api tanpa ANTHROPIC_API_KEY)." });
      if (running) return json(res, 409, { error: "Tim masih mengerjakan tugas lain.", id: running });
      const { text, preset } = await readBody(req);
      if (typeof text !== "string" || !text.trim()) return json(res, 400, { error: "Tugas kosong." });
      let models;
      try { models = resolveModels(preset); } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 200, { id: startJob(text.trim(), models) });
    }
    const evMatch = url.pathname.match(/^\/api\/tasks\/([a-z0-9]+)\/(events|cancel)$/);
    if (evMatch) {
      const job = jobs.get(evMatch[1]);
      if (!job) return json(res, 404, { error: "Tugas tidak ditemukan." });
      if (evMatch[2] === "cancel") {
        job.controller.abort();
        return json(res, 200, { ok: true });
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (job.done) return res.end();
      job.listeners.add(res);
      req.on("close", () => job.listeners.delete(res));
      return;
    }
    if (url.pathname === "/api/results") {
      const files = (await fs.readdir(path.join(here, "hasil"))).filter((f) => f.endsWith(".md")).sort().reverse();
      return json(res, 200, { files });
    }
    const resMatch = url.pathname.match(/^\/hasil\/([\w.-]+\.md)$/);
    if (resMatch) {
      const body = await fs.readFile(path.join(here, "hasil", resMatch[1]));
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      return res.end(body);
    }
    // File statis dari public/
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(here, "public", path.normalize(rel));
    if (!file.startsWith(path.join(here, "public"))) return json(res, 403, { error: "forbidden" });
    let body = await fs.readFile(file);
    // index.html ditulis tanpa kerangka dokumen (agar sama dengan versi Artifact); bungkus di sini.
    if (rel === "index.html") {
      body = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT") return json(res, 404, { error: "Tidak ditemukan." });
    json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🏢 Kantor PGA buka di http://${HOST}:${PORT}`);
  console.log(guard ? "  🔒 Kata sandi aktif (APP_PASSWORD)." : "  🔓 Tanpa kata sandi (hanya bisa dibuka dari komputer ini).");
  if (!LIVE) console.log("  🎭 Mode DEMO — animasi saja, tanpa memanggil Claude.");
  else if (ENGINE === "langganan") console.log("  ✅ Mode LIVE (langganan) — memakai login akun Claude + kredit Agent SDK bulanan. Tanpa API key.");
  else console.log("  ✅ Mode LIVE (API) — memakai ANTHROPIC_API_KEY berbayar.");
  const dm = defaultModels();
  if (LIVE) console.log(`  🧠 Model bawaan: Pemimpin ${dm.leader}, agent ${dm.worker} (bisa diganti di layar)`);
  const k = team.knowledge;
  console.log(k.files.length ? `  📚 Pengetahuan: ${k.files.length} file (${k.chars.toLocaleString("id-ID")} karakter)${k.truncated ? " — melebihi batas, sebagian dipotong" : ""}` : "  📚 Pengetahuan: belum ada (taruh file .md/.txt di folder pengetahuan/)");
  console.log(`  👥 ${team.leader.sim} (Pemimpin) + ${team.agents.map((a) => a.sim).join(", ")}\n`);
});
