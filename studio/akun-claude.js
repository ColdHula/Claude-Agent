// Login akun Claude (langganan Pro/Max) langsung dari Studio, tanpa terminal.
// Memakai alur resmi Claude Code `claude setup-token` (binary bawaan Claude Agent SDK):
//   1. Server menjalankan `claude setup-token` di pseudo-terminal → mengambil tautan masuk claude.com.
//   2. Pengguna membuka tautan, masuk, lalu menyalin kode dari halaman platform.claude.com.
//   3. Kode ditempel di Studio → diteruskan ke proses → token jangka panjang (1 tahun) dicetak.
//   4. Token disimpan di <DATA>/settings.json (izin 600) dan dipakai sebagai CLAUDE_CODE_OAUTH_TOKEN.
// Pemakaian diambil dari langganan (kredit Agent SDK), bukan API key berbayar.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const strip = (s) => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, " ").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b[()][A-Z0-9]/g, "");

function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const pkg of [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}-musl`]) {
    try {
      const dir = path.dirname(require.resolve(`${pkg}/package.json`));
      const bin = path.join(dir, process.platform === "win32" ? "claude.exe" : "claude");
      if (fs.existsSync(bin)) return bin;
    } catch {}
  }
  return "claude";
}

export function createClaudeAccount({ store, cleanEnv, getSdk }) {
  let job = null; // { proc, out, url, state, error, token }
  let cache = null; // { at, info }

  const savedToken = () => store.settings().claudeToken || "";
  // Env untuk SDK: token dari login Studio diutamakan; bila tidak ada, pakai login `npm run login` (~/.claude).
  function sdkEnv(base) {
    const t = savedToken();
    return t ? { ...base, CLAUDE_CODE_OAUTH_TOKEN: t } : base;
  }

  async function status({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - cache.at < 5 * 60_000) return cache.info;
    let info = { loggedIn: false, method: savedToken() ? "studio" : process.env.CLAUDE_CODE_OAUTH_TOKEN ? "env" : "lokal" };
    try {
      const { query } = await getSdk();
      const ac = new AbortController();
      const q = query({
        prompt: (async function* () {
          await new Promise(() => {});
        })(),
        options: { abortController: ac, persistSession: false, settingSources: [], tools: [], env: sdkEnv(cleanEnv()) },
      });
      const a = await Promise.race([q.accountInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 25_000))]);
      ac.abort();
      const sub = String(a.subscriptionType || "");
      info = { ...info, email: a.email || "", subscription: sub, org: a.organization || "", loggedIn: Boolean(a.email) || /pro|max|team|enterprise/i.test(sub) };
    } catch (e) {
      info.error = String(e.message || e).slice(0, 200);
    }
    cache = { at: Date.now(), info };
    return info;
  }

  function startLogin() {
    if (job?.proc && job.state !== "done" && job.state !== "error") job.proc.kill("SIGKILL");
    const bin = claudeBin();
    const cmd = `stty cols 4000 rows 60 2>/dev/null; exec '${bin.replace(/'/g, "'\\''")}' setup-token`;
    const proc = spawn("script", ["-qfec", cmd, "/dev/null"], { env: { ...cleanEnv(), TERM: "xterm-256color", BROWSER: "true" }, stdio: ["pipe", "pipe", "pipe"] });
    job = { proc, out: "", url: null, state: "starting", error: null, token: null, startedAt: Date.now() };
    const j = job;
    const onData = (d) => {
      j.out += d.toString("utf8");
      if (j.out.length > 400_000) j.out = j.out.slice(-200_000);
      if (!j.url) {
        const m = j.out.match(/https:\/\/claude\.(?:com|ai)\/[^\s\x07\x1b"']*oauth\/authorize\?[^\s\x07\x1b"']+/);
        if (m) {
          j.url = m[0];
          j.state = "waiting_code";
        }
      }
      const t = strip(j.out).match(/sk-ant-oat01-[A-Za-z0-9_-]{20,}/);
      if (t && !j.token) {
        j.token = t[0];
        j.state = "done";
        store.saveSettings({ claudeToken: j.token, claudeTokenAt: Date.now() }).catch(() => {});
        cache = null;
        setTimeout(() => proc.kill("SIGTERM"), 500);
      }
      const plain = strip(d.toString("utf8"));
      if (j.state === "checking" && /oauth error|invalid|failed|expired|status code 4\d\d/i.test(plain)) {
        j.lastErr = plain.replace(/\s+/g, " ").replace(/Press Enter to retry\.?/i, "").trim().slice(0, 200);
        Object.assign(j, { state: "error", error: `Kode tidak diterima (${j.lastErr}). Pastikan menyalin seluruh kode dari halaman Claude, lalu klik Masuk lagi.` });
        proc.kill("SIGKILL");
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => Object.assign(j, { state: "error", error: e.code === "ENOENT" ? "Perintah `script` tidak ada (sudo apt install bsdutils) atau binary Claude tidak ditemukan." : e.message }));
    proc.on("exit", () => {
      if (j.state !== "done") Object.assign(j, { state: "error", error: j.error || j.lastErr || "Proses login berhenti sebelum selesai. Coba lagi." });
    });
    setTimeout(() => {
      if (j.state === "waiting_code" || j.state === "checking" || j.state === "starting") {
        proc.kill("SIGKILL");
        Object.assign(j, { state: "error", error: "Waktu login habis (15 menit). Mulai lagi." });
      }
    }, 15 * 60_000).unref();
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (j.url || j.state === "error" || Date.now() - t0 > 30_000) return resolve(view());
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  function submitCode(code) {
    if (!job || job.state !== "waiting_code") throw new Error("Tidak ada proses login yang menunggu kode. Klik Masuk lagi.");
    const c = String(code || "").trim();
    if (!c || c.length > 2000) throw new Error("Kode kosong.");
    job.state = "checking";
    job.proc.stdin.write(c + "\r");
    const j = job;
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (j.state === "done" || j.state === "error") return resolve(view());
        if (Date.now() - t0 > 60_000) {
          j.proc.kill("SIGKILL");
          Object.assign(j, { state: "error", error: j.lastErr || "Kode tidak diterima (salah atau kedaluwarsa). Klik Masuk lagi." });
          return resolve(view());
        }
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  function view() {
    if (!job) return { state: "idle" };
    return { state: job.state, url: job.url, error: job.error };
  }

  async function logout() {
    job?.proc?.kill("SIGKILL");
    job = null;
    cache = null;
    await store.saveSettings({ claudeToken: "", claudeTokenAt: 0 });
  }

  return { status, startLogin, submitCode, view, logout, sdkEnv, hasStudioToken: () => Boolean(savedToken()) };
}
