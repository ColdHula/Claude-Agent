// Penyimpanan chat Studio.
// - Selalu disimpan lokal di mesin yang menjalankan Studio (rig/VPS/laptop): <DATA>/arsip/
//     chats/<id>.json   — data lengkap
//     chats/<id>.md     — salinan yang enak dibaca (juga di GitHub)
//     lampiran/<yyyy-mm>/<acak>-<nama>  — berkas yang diunggah ke chat
// - Opsional: sinkron ke repo Git — GitHub (WAJIB privat) atau remote lain (Gitea di rig, repo bare, dll.).
//   Sinkron = commit lokal → ambil perubahan remote → gabung → push. Tiap chat satu berkas, jadi jarang bentrok.
//   Token tidak pernah ditulis ke .git/config; dikirim per perintah lewat header http.extraHeader.
// - Kunci penyedia & pengaturan (providers.json, settings.json) ada di <DATA>, DI LUAR arsip → tidak ikut sinkron.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_SYNC_FILE = 45 * 1024 * 1024; // GitHub menolak berkas > 50 MB

export function createStorage(DATA) {
  const ARSIP = path.join(DATA, "arsip");
  const CHATS = path.join(ARSIP, "chats");
  const LAMPIRAN = path.join(ARSIP, "lampiran");
  const SETTINGS = path.join(DATA, "settings.json");
  let settings = {};
  const sync = { busy: false, timer: null, last: null, error: null, pending: false, lastPull: 0 };

  async function init() {
    await fs.mkdir(CHATS, { recursive: true });
    await fs.mkdir(LAMPIRAN, { recursive: true });
    settings = JSON.parse(await fs.readFile(SETTINGS, "utf8").catch(() => "{}"));
    // Pindahkan sesi versi lama (studio/data/sessions) ke arsip/chats.
    const old = path.join(DATA, "sessions");
    for (const f of await fs.readdir(old).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      const s = JSON.parse(await fs.readFile(path.join(old, f), "utf8"));
      await write(s, { keepTime: true });
      await fs.rm(path.join(old, f));
    }
    await fs.rmdir(old).catch(() => {});
    if (syncOn()) setTimeout(() => syncNow("mulai").catch(() => {}), 1500);
    setInterval(() => syncOn() && Date.now() - sync.lastPull > 5 * 60_000 && syncNow("berkala").catch(() => {}), 60_000).unref();
  }

  // ───────── chat ─────────
  const file = (id) => path.join(CHATS, `${id}.json`);
  const validId = (id) => /^[\w-]{1,80}$/.test(id);
  async function read(id) {
    if (!validId(id)) throw Object.assign(new Error("ID sesi tidak sah."), { status: 400 });
    return JSON.parse(await fs.readFile(file(id), "utf8"));
  }
  async function write(s, { keepTime = false } = {}) {
    if (!keepTime) s.updatedAt = Date.now();
    await fs.writeFile(file(s.id), JSON.stringify(s, null, 1));
    await fs.writeFile(path.join(CHATS, `${s.id}.md`), toMarkdown(s));
    scheduleSync();
  }
  async function remove(id) {
    if (!validId(id)) return;
    await fs.rm(file(id), { force: true });
    await fs.rm(path.join(CHATS, `${id}.md`), { force: true });
    scheduleSync();
  }
  async function list() {
    const out = [];
    for (const f of await fs.readdir(CHATS).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(CHATS, f), "utf8")));
      } catch {}
    }
    return out;
  }
  function create(fields = {}) {
    const now = Date.now();
    return { id: crypto.randomUUID(), title: "Chat baru", createdAt: now, updatedAt: now, messages: [], claudeSynced: 0, ...fields };
  }

  function toMarkdown(s) {
    const when = (t) => new Date(t || Date.now()).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    let md = `# ${s.title}\n\n_${when(s.createdAt)} · ${s.mode === "code" ? "Code" : "Chat"}${s.provider ? ` · ${s.provider}/${s.model || ""}` : ""}_\n\n`;
    for (const m of s.messages) {
      if (m.role === "user") {
        md += `## 🧑 Rahula · ${when(m.at)}\n\n${m.text}\n`;
        if (m.attachments?.length) md += `\n${m.attachments.map((a) => `📎 [${a.name}](../${a.file})`).join("  \n")}\n`;
      } else {
        md += `## ✨ ${m.provider || "AI"}${m.model ? ` · ${m.model}` : ""}\n\n`;
        if (m.steps?.length) md += m.steps.filter((x) => x.kind === "tool").map((x) => `- ⏺ \`${x.label}\``).join("\n") + "\n\n";
        md += `${m.text}\n`;
      }
      md += "\n";
    }
    return md;
  }

  // ───────── lampiran ─────────
  async function saveUpload(name, buf) {
    const safe = String(name || "berkas").replace(/[^\w.\- ()]+/g, "_").slice(-100) || "berkas";
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(LAMPIRAN, month);
    await fs.mkdir(dir, { recursive: true });
    const fname = `${crypto.randomBytes(4).toString("hex")}-${safe}`;
    await fs.writeFile(path.join(dir, fname), buf);
    scheduleSync();
    return { name: safe, file: `lampiran/${month}/${fname}`, size: buf.length };
  }
  function uploadPath(rel) {
    const abs = path.resolve(ARSIP, String(rel || ""));
    if (!abs.startsWith(LAMPIRAN + path.sep)) throw Object.assign(new Error("Lampiran tidak sah."), { status: 400 });
    return abs;
  }

  // ───────── pengaturan ─────────
  async function saveSettings(patch) {
    settings = { ...settings, ...patch };
    await fs.writeFile(SETTINGS, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }

  // ───────── sinkron Git ─────────
  // settings.sync = { mode: "lokal" | "github" | "git", repo: "owner/nama", url, branch, token }
  const cfg = () => settings.sync || { mode: "lokal" };
  const syncOn = () => ["github", "git"].includes(cfg().mode);
  const token = () => cfg().token || process.env.STUDIO_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
  function remoteUrl() {
    const c = cfg();
    if (c.mode === "github") return `https://github.com/${c.repo}.git`;
    return c.url || "";
  }
  function git(args, opts = {}) {
    const pre = ["-c", "user.name=Studio", "-c", "user.email=studio@lokal", "-c", "core.quotepath=off"];
    const t = token();
    if (t && /^https:\/\/github\.com\//.test(remoteUrl())) {
      const b64 = Buffer.from(`x-access-token:${t}`).toString("base64");
      pre.push("-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${b64}`);
    }
    return run("git", [...pre, ...args], { cwd: ARSIP, timeout: 120_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, ...opts });
  }

  async function githubApi(p, init = {}) {
    const r = await fetch(`https://api.github.com${p}`, {
      ...init,
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token()}`, "user-agent": "studio-kantor-pga", "content-type": "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  }

  // Pastikan repo GitHub ada dan PRIVAT. Bila belum ada dan create=true, buat sebagai privat.
  async function checkGithub({ create = false } = {}) {
    const c = cfg();
    if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo || "")) throw new Error("Isi nama repo dengan format pemilik/nama, mis. rahula/arsip-chat.");
    if (!token()) throw new Error("Token GitHub belum diisi (fine-grained token dengan izin Contents: Read & write untuk repo itu).");
    let r = await githubApi(`/repos/${c.repo}`);
    if (r.status === 404 && create) {
      const [owner, name] = c.repo.split("/");
      const me = await githubApi("/user");
      const p = me.body?.login?.toLowerCase() === owner.toLowerCase() ? "/user/repos" : `/orgs/${owner}/repos`;
      r = await githubApi(p, { method: "POST", body: JSON.stringify({ name, private: true, description: "Arsip chat Studio (otomatis)", auto_init: false }) });
      if (!r.ok) throw new Error(`Gagal membuat repo: ${r.body?.message || r.status}`);
    }
    if (r.status === 404) throw new Error(`Repo ${c.repo} tidak ditemukan (atau token tidak punya akses). Centang "buat bila belum ada" untuk membuatnya.`);
    if (!r.ok) throw new Error(`GitHub: ${r.body?.message || r.status}`);
    if (r.body.private !== true) throw new Error(`Repo ${c.repo} PUBLIK. Chat bisa berisi data pribadi — pakai repo privat. Sinkron dibatalkan.`);
    return { private: true, defaultBranch: r.body.default_branch || "main" };
  }

  async function ensureRepo() {
    const branch = cfg().branch || "main";
    await fs.access(path.join(ARSIP, ".git")).catch(async () => {
      await git(["init", "-q", "-b", branch]);
    });
    await fs.writeFile(path.join(ARSIP, ".gitignore"), "*.tmp\n.DS_Store\n");
    await fs.writeFile(
      path.join(ARSIP, "README.md"),
      "# Arsip chat Studio\n\nDisinkronkan otomatis oleh Studio (Kantor PGA). `chats/*.md` = versi yang mudah dibaca, `chats/*.json` = data lengkap, `lampiran/` = berkas yang diunggah.\n\n**Repo ini harus privat.**\n",
    );
    const url = remoteUrl();
    const remotes = (await git(["remote"])).stdout.split("\n");
    if (remotes.includes("origin")) await git(["remote", "set-url", "origin", url]);
    else await git(["remote", "add", "origin", url]);
    return branch;
  }

  function scheduleSync() {
    if (!syncOn()) return;
    sync.pending = true;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => syncNow("otomatis").catch(() => {}), 15_000);
    sync.timer.unref?.();
  }

  async function syncNow(why = "manual") {
    if (!syncOn()) return status();
    if (sync.busy) {
      sync.pending = true;
      return status();
    }
    sync.busy = true;
    sync.pending = false;
    try {
      if (cfg().mode === "github") await checkGithub();
      const branch = await ensureRepo();
      // Lewati berkas lampiran yang terlalu besar untuk remote.
      const big = [];
      for (const m of await fs.readdir(LAMPIRAN).catch(() => [])) {
        for (const f of await fs.readdir(path.join(LAMPIRAN, m)).catch(() => [])) {
          const st = await fs.stat(path.join(LAMPIRAN, m, f)).catch(() => null);
          if (st && st.size > MAX_SYNC_FILE) big.push(`lampiran/${m}/${f}`);
        }
      }
      await fs.writeFile(path.join(ARSIP, ".git", "info", "exclude"), big.join("\n") + "\n").catch(() => {});
      await git(["add", "-A"]);
      const st = (await git(["status", "--porcelain"])).stdout.trim();
      if (st) await git(["commit", "-q", "-m", `Studio: ${st.split("\n").length} berkas (${why}) ${new Date().toISOString()}`]);
      // Ambil perubahan dari mesin lain. Remote kosong (repo baru) → fetch gagal untuk branch, abaikan.
      const fetched = await git(["fetch", "-q", "origin", branch]).then(() => true, () => false);
      if (fetched) {
        const hasLocal = await git(["rev-parse", "--verify", "-q", "HEAD"]).then(() => true, () => false);
        if (hasLocal) await git(["merge", "-q", "--no-edit", "-X", "ours", "--allow-unrelated-histories", `origin/${branch}`]);
        else await git(["reset", "-q", "--hard", `origin/${branch}`]);
      }
      const hasCommit = await git(["rev-parse", "--verify", "-q", "HEAD"]).then(() => true, () => false);
      if (hasCommit) await git(["push", "-q", "-u", "origin", `HEAD:${branch}`]);
      sync.last = Date.now();
      sync.lastPull = Date.now();
      sync.error = null;
    } catch (e) {
      sync.error = String(e.stderr || e.message || e).replace(/AUTHORIZATION: basic \S+/g, "AUTHORIZATION: ***").trim().slice(0, 400);
      throw e;
    } finally {
      sync.busy = false;
      if (sync.pending) scheduleSync();
    }
    return status();
  }

  function status() {
    const c = cfg();
    return {
      mode: c.mode || "lokal",
      repo: c.repo || "",
      url: c.mode === "git" ? c.url || "" : "",
      branch: c.branch || "main",
      hasToken: Boolean(token()),
      tokenFromEnv: Boolean(!c.token && token()),
      busy: sync.busy,
      last: sync.last,
      error: sync.error,
      localPath: ARSIP,
    };
  }

  async function configureSync({ mode, repo, url, branch, token: tk, create }) {
    if (!["lokal", "github", "git"].includes(mode)) throw new Error("Mode penyimpanan tidak dikenal.");
    const next = { ...cfg(), mode, repo: (repo || "").trim(), url: (url || "").trim(), branch: (branch || "main").trim() || "main" };
    if (typeof tk === "string" && tk && tk !== "••••") next.token = tk.trim();
    const prev = settings.sync;
    await saveSettings({ sync: next });
    try {
      if (mode === "github") await checkGithub({ create });
      if (mode === "git" && !next.url) throw new Error("Isi URL remote Git.");
    } catch (e) {
      // Repo/token tidak valid atau repo publik → kembalikan pengaturan lama, jangan pernah push.
      await saveSettings({ sync: prev || { mode: "lokal" } });
      throw e;
    }
    // Sambungan valid; kegagalan sinkron pertama (mis. jaringan) ditampilkan, pengaturan tetap disimpan.
    if (mode !== "lokal") await syncNow("pengaturan");
    return status();
  }

  return { init, read, write, remove, list, create, validId, toMarkdown, saveUpload, uploadPath, ARSIP, settings: () => settings, saveSettings, syncNow, syncStatus: status, configureSync };
}
