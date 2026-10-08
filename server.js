// Server kecil tanpa framework: menyajikan public/, menerima tugas,
// dan mengalirkan event kerja tim ke browser lewat Server-Sent Events.
import http from "node:http";
import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgents } from "./src/agents.js";
import { runTask, MODELS, PRESETS, defaultModels } from "./src/orchestrator.js";
import { runTaskSdk, findSkills } from "./src/orchestrator-sdk.js";
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

const team = await loadAgents({ lazy: ENGINE !== "api" });
const jobs = new Map(); // id -> { events, listeners, done, controller }
// Beberapa tugas boleh berjalan bersamaan; sisanya antre (FIFO).
const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_TUGAS_PARALEL || 3));
const MAX_QUEUE = 10;
const active = new Set(); // id tugas yang sedang berjalan
const queue = []; // [{ id, begin }]
let seq = 0;
const jobList = () => [...jobs].slice(-30).map(([id, j]) => ({ id, no: j.no, text: j.text.slice(0, 160), status: j.status, at: j.at }));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf", ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".zip": "application/zip",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const run$ = promisify(execFile);
// Versi aplikasi (commit git) untuk pembaruan otomatis: browser memuat ulang bila versi berubah.
const VERSION = await run$("git", ["rev-parse", "--short", "HEAD"], { cwd: here }).then((r) => r.stdout.trim(), () => "lokal");
// Penanda tugas berjalan, dibaca deploy/perbarui.sh agar tidak me-restart di tengah tugas.
const BUSY_FLAG = path.join(here, "hasil", ".tugas-berjalan");
const setBusy = (on) => (on ? fs.writeFile(BUSY_FLAG, String(Date.now())) : fs.rm(BUSY_FLAG, { force: true })).catch(() => {});
await setBusy(false);
const HASIL = path.join(here, "hasil");
const PENGETAHUAN = path.join(here, "pengetahuan");
const safeName = (n) => String(n || "").normalize("NFC").replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").slice(0, 120);

// Simpan badan permintaan mentah ke file (untuk unggahan), dengan batas ukuran.
async function saveRaw(req, dest, limitBytes) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let size = 0;
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        out.destroy();
        reject(new Error(`File terlalu besar (maks ${Math.round(limitBytes / 1e6)} MB).`));
      }
    });
    req.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    req.on("error", reject);
  });
  return size;
}

async function listFiles(dir, skip = new Set()) {
  try {
    const names = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const d of names) {
      if (!d.isFile() || skip.has(d.name)) continue;
      const st = await fs.stat(path.join(dir, d.name));
      out.push({ name: d.name, size: st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function knowledgeSummary() {
  const folders = {};
  let berkas = 0;
  let skills = 0;
  async function walk(dir, rel) {
    let items = [];
    try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of items) {
      if (d.name === "node_modules") continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(path.join(dir, d.name), r);
      else if (r.startsWith("berkas/")) berkas++;
      else if (r.startsWith("skills/")) { if (d.name === "SKILL.md") skills++; }
      else if (/\.(md|txt)$/i.test(d.name) && d.name.toLowerCase() !== "readme.md") {
        const top = r.includes("/") ? r.split("/")[0] : "(akar)";
        (folders[top] ||= []).push(d.name);
      }
    }
  }
  await walk(PENGETAHUAN, "");
  return { folders, berkas, skills };
}

// Memori kantor: bagian "## Catatan untuk Diingat" dari hasil akhir Bima disimpan ke pengetahuan/umum/,
// sehingga tugas berikutnya ikut tahu. Dibatasi agar tidak membengkak (entri terlama dibuang).
const MEMORY_FILE = path.join(PENGETAHUAN, "umum", "99-memori-kantor.md");
const MEMORY_MAX = 8000;
async function rememberNotes(task, final) {
  const m = String(final).match(/^##\s*Catatan untuk Diingat\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  const notes = m && m[1].split("\n").filter((l) => /^\s*[-*]\s+\S/.test(l)).slice(0, 5).map((l) => l.trim());
  if (!notes || !notes.length) return;
  const head = "# Memori kantor\nCatatan fakta tetap dari tugas sebelumnya (ditulis otomatis dari hasil akhir Bima). Terbaru di bawah.\n";
  let old = await fs.readFile(MEMORY_FILE, "utf8").catch(() => head);
  const entry = `\n## ${new Date().toISOString().slice(0, 10)} — ${task.replace(/\s+/g, " ").slice(0, 80)}\n${notes.join("\n")}\n`;
  let body = old.replace(head, "") + entry;
  while (body.length > MEMORY_MAX && body.indexOf("\n## ", 1) > 0) body = body.slice(body.indexOf("\n## ", 1));
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  await fs.writeFile(MEMORY_FILE, head + body);
}

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

async function saveResult(task, result, id = "") {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = `${stamp}_${slug(task)}${id ? `_${id}` : ""}.md`;
  const appendix = result.workLog
    .map((w) => `### ${w.sim} — ${w.title}\n\n**Instruksi dari Pemimpin:**\n\n${w.instruksi}\n\n**Hasil:**\n\n${w.output}`)
    .join("\n\n---\n\n");
  const body = `> Tugas: ${task.replace(/\n/g, "\n> ")}\n\n${result.final}\n\n---\n\n## Lampiran: hasil kerja tiap agent\n\n${appendix || "_Tidak ada._"}\n`;
  await fs.writeFile(path.join(here, "hasil", file), body, "utf8");
  return file;
}

// Riwayat tugas untuk Bima: daftar ringkas tugas terakhir (bukan isinya) agar pekerjaan lanjutan
// atau revisi bisa merujuk hasil sebelumnya. Agent membuka file riwayat hanya bila Bima menyebutnya.
const HISTORY_MAX = Math.max(0, Number(process.env.RIWAYAT_TUGAS || 15));
async function recentHistory() {
  if (!HISTORY_MAX) return [];
  const names = (await fs.readdir(HASIL).catch(() => [])).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, HISTORY_MAX);
  const out = [];
  for (const name of names) {
    const head = await fs.readFile(path.join(HASIL, name), "utf8").then((t) => t.slice(0, 600)).catch(() => "");
    const task = (head.match(/^> Tugas: (.*)$/m) || [, name])[1].replace(/\s+/g, " ").slice(0, 120);
    const id = (name.match(/_([a-z0-9]+)\.md$/) || [])[1];
    const files = id ? (await listFiles(path.join(HASIL, `tugas-${id}`))).map((f) => `hasil/tugas-${id}/${f.name}`) : [];
    out.push({ date: name.slice(0, 10), task, report: `hasil/${name}`, files: files.slice(0, 8) });
  }
  return out;
}

// Pilihan preset dari layar; bila kosong pakai pengaturan .env.
function resolveModels(preset) {
  const p = PRESETS[preset];
  const m = p ? { leader: p.leader, worker: p.worker, light: p.light, leaderEffort: p.leaderEffort } : defaultModels();
  // Mesin API memakai adaptive thinking + effort yang belum didukung Haiku; agent ringan ikut model agent.
  if (ENGINE === "api") m.light = m.worker;
  for (const id of [m.leader, m.worker, m.light]) if (!MODELS[id]) throw new Error(`Model tidak dikenal: ${id}. Pilih salah satu: ${Object.keys(MODELS).join(", ")}.`);
  return m;
}

function startJob(task, models, draft) {
  const no = ++seq;
  const id = Date.now().toString(36) + no.toString(36);
  const workDir = path.join(HASIL, `tugas-${id}`);
  const job = { no, text: task, at: Date.now(), status: "antri", events: [], listeners: new Set(), done: false, controller: new AbortController() };
  jobs.set(id, job);
  // Simpan paling banyak 50 tugas di memori (yang sudah selesai dibuang lebih dulu).
  for (const [oldId, j] of jobs) { if (jobs.size <= 50) break; if (j.done) jobs.delete(oldId); }
  const emit = (event) => {
    const e = { ...event, job: id, no, t: Date.now() };
    job.events.push(e);
    for (const res of job.listeners) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const queued = active.size >= MAX_PARALLEL;
  emit({ type: "task", id, text: task, queued, models: { leader: MODELS[models.leader].label, worker: MODELS[models.worker].label, light: MODELS[models.light].label } });
  job.cancelQueued = () => {
    const i = queue.findIndex((q) => q.id === id);
    if (i < 0) return false;
    queue.splice(i, 1);
    job.done = true; job.status = "batal";
    emit({ type: "error", message: "Tugas dibatalkan sebelum mulai." });
    for (const res of job.listeners) res.end();
    job.listeners.clear();
    queue.forEach((q, k) => q.notify(k + 1));
    return true;
  };
  const begin = () => {
    active.add(id);
    job.status = "berjalan";
    setBusy(true);
    if (queued) emit({ type: "dequeued" });
    run$job();
  };
  if (queued) {
    queue.push({ id, begin, notify: (position) => emit({ type: "queued", position }) });
    emit({ type: "queued", position: queue.length });
  } else begin();
  return id;

  function run$job() {
  // Muat ulang instruksi + pengetahuan di setiap tugas, agar file baru di pengetahuan/ langsung terpakai.
  (async () => {
    await fs.mkdir(path.join(workDir, "masukan"), { recursive: true });
    if (draft) {
      const from = path.join(HASIL, "_draf", draft);
      for (const f of await listFiles(from)) await fs.rename(path.join(from, f.name), path.join(workDir, "masukan", f.name));
      await fs.rm(from, { recursive: true, force: true });
    }
    return (await listFiles(path.join(workDir, "masukan"))).map((f) => f.name);
  })()
    .then(async (inputs) => {
      if (inputs.length) emit({ type: "leader_say", text: `📎 Lampiran: ${inputs.join(", ")}` });
      return { inputs, fresh: await loadAgents({ lazy: ENGINE !== "api" }), history: await recentHistory() };
    })
    .then(({ inputs, fresh, history }) => {
      if (fresh.knowledge.files.length) {
        const k = fresh.knowledge;
        emit({ type: "leader_say", text: `📚 Pengetahuan: ${k.files.length} file (${k.chars.toLocaleString("id-ID")} karakter)${k.lazy ? `; mode hemat: rata-rata ${k.inlineChars.toLocaleString("id-ID")} karakter per agent ditempel, sisanya dibaca bila perlu` : ""}${k.truncated ? ", sebagian dipotong" : ""}.` });
      }
      return run(task, emit, { ...fresh, models, signal: job.controller.signal, workDir, inputs, history });
    })
    .then(async (result) => {
      const file = await saveResult(task, result, id).catch(() => null);
      await rememberNotes(task, result.final).catch(() => {});
      const files = (await listFiles(workDir)).map((f) => ({ ...f, url: `/hasil/tugas-${id}/${encodeURIComponent(f.name)}` }));
      emit({ type: "final", output: result.final, file, files, workLog: result.workLog, usd: Number(result.cost.toFixed(4)) });
    })
    .catch((err) => emit({ type: "error", message: job.controller.signal.aborted ? "Tugas dibatalkan." : String(err?.message || err) }))
    .finally(() => {
      job.done = true;
      job.status = job.events.some((e) => e.type === "final") ? "selesai" : "gagal";
      active.delete(id);
      setBusy(active.size > 0);
      for (const res of job.listeners) res.end();
      job.listeners.clear();
      const next = queue.shift();
      if (next) { next.begin(); queue.forEach((q, k) => q.notify(k + 1)); }
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (guard && (await guard(req, res, url))) return;
    if (url.pathname === "/api/status") {
      return json(res, 200, {
        mode: LIVE ? "live" : "demo",
        version: VERSION,
        engine: ENGINE,
        defaultModels: defaultModels(),
        presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
        running: [...active][0] || null,
        active: [...active],
        queued: queue.map((q) => q.id),
        maxParallel: MAX_PARALLEL,
        jobs: jobList(),
        leader: { id: team.leader.id, sim: team.leader.sim, title: team.leader.title },
        agents: team.agents.map(({ id, sim, title, icon, web, description }) => ({ id, sim, title, icon, web, description })),
        ...(ENGINE === "langganan" ? { skills: (await findSkills()).details } : {}),
      });
    }
    if (url.pathname === "/api/tasks" && req.method === "POST") {
      if (!LIVE) return json(res, 400, { error: "Server dalam mode demo (DEMO=1, atau ENGINE=api tanpa ANTHROPIC_API_KEY)." });
      if (queue.length >= MAX_QUEUE) return json(res, 429, { error: `Antrean penuh (${MAX_QUEUE} tugas). Tunggu sebagian selesai.` });
      const { text, preset, draft } = await readBody(req);
      if (draft && ENGINE === "api") return json(res, 400, { error: "Lampiran file hanya didukung di mode langganan." });
      if (typeof text !== "string" || !text.trim()) return json(res, 400, { error: "Tugas kosong." });
      let models;
      try { models = resolveModels(preset); } catch (err) { return json(res, 400, { error: err.message }); }
      return json(res, 200, { id: startJob(text.trim(), models, draft && /^[a-z0-9]+$/.test(draft) ? draft : null) });
    }
    const evMatch = url.pathname.match(/^\/api\/tasks\/([a-z0-9]+)\/(events|cancel)$/);
    if (evMatch) {
      const job = jobs.get(evMatch[1]);
      if (!job) return json(res, 404, { error: "Tugas tidak ditemukan." });
      if (evMatch[2] === "cancel") {
        if (job.cancelQueued && job.cancelQueued()) return json(res, 200, { ok: true });
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
    if (url.pathname === "/api/lampiran" && req.method === "POST") {
      const draft = /^[a-z0-9]+$/.test(url.searchParams.get("draft") || "") ? url.searchParams.get("draft") : Date.now().toString(36);
      const nama = safeName(url.searchParams.get("nama"));
      if (!nama) return json(res, 400, { error: "Nama file kosong." });
      await saveRaw(req, path.join(HASIL, "_draf", draft, nama), 60e6);
      return json(res, 200, { draft, files: await listFiles(path.join(HASIL, "_draf", draft)) });
    }
    if (url.pathname === "/api/lampiran" && req.method === "DELETE") {
      const draft = url.searchParams.get("draft") || "";
      const nama = safeName(url.searchParams.get("nama"));
      if (!/^[a-z0-9]+$/.test(draft) || !nama) return json(res, 400, { error: "Permintaan tidak valid." });
      await fs.rm(path.join(HASIL, "_draf", draft, nama), { force: true });
      return json(res, 200, { draft, files: await listFiles(path.join(HASIL, "_draf", draft)) });
    }
    if (url.pathname === "/api/pengetahuan" && req.method === "GET") {
      return json(res, 200, await knowledgeSummary());
    }
    if (url.pathname === "/api/pengetahuan" && req.method === "POST") {
      if (active.size) return json(res, 409, { error: "Tunggu semua tugas yang sedang berjalan selesai dulu, lalu unggah lagi." });
      const tmp = path.join(HASIL, "_draf", `pengetahuan-${Date.now()}.zip`);
      try {
        await saveRaw(req, tmp, 400e6);
        const { stdout } = await run$("unzip", ["-Z1", tmp], { maxBuffer: 50e6 });
        const entries = stdout.split("\n").filter(Boolean);
        if (!entries.length) throw new Error("ZIP kosong.");
        if (entries.some((e) => e.startsWith("/") || e.split("/").includes(".."))) throw new Error("ZIP berisi jalur yang tidak aman.");
        // ZIP boleh berisi folder "pengetahuan/" di akarnya atau langsung isinya.
        const strip = entries.every((e) => e === "pengetahuan/" || e.startsWith("pengetahuan/"));
        await fs.mkdir(PENGETAHUAN, { recursive: true });
        await run$("unzip", ["-o", "-q", tmp, "-d", strip ? here : PENGETAHUAN], { maxBuffer: 50e6 });
        return json(res, 200, { ok: true, entries: entries.length, ...(await knowledgeSummary()), skillList: (await findSkills()).details });
      } catch (err) {
        return json(res, 400, { error: err.code === "ENOENT" ? "Perintah unzip belum terpasang di server (sudo apt install unzip)." : String(err.message || err) });
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    const fileMatch = url.pathname.match(/^\/hasil\/(tugas-[a-z0-9]+)\/([^/]+)$/);
    if (fileMatch) {
      const name = decodeURIComponent(fileMatch[2]);
      const target = path.join(HASIL, fileMatch[1], name);
      if (path.dirname(target) !== path.join(HASIL, fileMatch[1])) return json(res, 403, { error: "forbidden" });
      const body = await fs.readFile(target);
      res.writeHead(200, {
        "content-type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      });
      return res.end(body);
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
    if (rel === "index.html" && !/^\s*<!doctype/i.test(String(body))) {
      body = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      // index.html selalu dicek ulang agar versi baru langsung terpakai; ikon boleh di-cache.
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=86400",
    });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT") return json(res, 404, { error: "Tidak ditemukan." });
    json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🏢 Kantor PGA (versi ${VERSION}) buka di http://${HOST}:${PORT}`);
  console.log(guard ? "  🔒 Kata sandi aktif (APP_PASSWORD)." : "  🔓 Tanpa kata sandi (hanya bisa dibuka dari komputer ini).");
  if (!LIVE) console.log("  🎭 Mode DEMO — animasi saja, tanpa memanggil Claude.");
  else if (ENGINE === "langganan") console.log("  ✅ Mode LIVE (langganan) — memakai login akun Claude + kredit Agent SDK bulanan. Tanpa API key.");
  else console.log("  ✅ Mode LIVE (API) — memakai ANTHROPIC_API_KEY berbayar.");
  const dm = defaultModels();
  if (LIVE) console.log(`  🧠 Model bawaan: Pemimpin ${dm.leader}, agent ${dm.worker}, agent ringan ${dm.light} (bisa diganti di layar)`);
  const k = team.knowledge;
  console.log(k.files.length ? `  📚 Pengetahuan: ${k.files.length} file (${k.chars.toLocaleString("id-ID")} karakter)${k.truncated ? " — melebihi batas, sebagian dipotong" : ""}` : "  📚 Pengetahuan: belum ada (taruh file .md/.txt di folder pengetahuan/)");
  console.log(`  👥 ${team.leader.sim} (Pemimpin) + ${team.agents.map((a) => a.sim).join(", ")}\n`);
});
