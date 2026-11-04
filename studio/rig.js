// Kelola rig/VPS dari Studio (dibuka lewat HP): status, restart layanan, log, pembaruan, reboot.
//
// Keamanan:
// - Hanya layanan di daftar putih yang bisa di-restart / dibaca lognya.
// - Restart & reboot memakai `sudo -n` ke perintah PERSIS yang diizinkan deploy/pasang-studio.sh
//   (/etc/sudoers.d/studio) — tanpa wildcard, tanpa shell. Tanpa izin itu, tombolnya memberi tahu cara mengaktifkan.
// - Log dibaca lewat grup systemd-journal (tanpa sudo).
// - Pembaruan = `git pull --ff-only` (+ `npm install` bila package.json berubah) sebagai pengguna biasa.
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const SERVICES = ["studio", "kantor-pga", "ngobrol", "ollama", "tailscaled", "freellmapi"];
const strip = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "");
const bad = (status, message) => Object.assign(new Error(message), { status });

async function systemctlPath() {
  for (const p of ["/usr/bin/systemctl", "/bin/systemctl"]) if (await fs.access(p).then(() => true, () => false)) return p;
  return null;
}

export function createRig({ appRoot, dataDir }) {
  let units = null; // nama -> true/false (ada tidaknya unit systemd)
  let sudoCache = { at: 0, ok: false };

  const sh = (cmd, args, opts = {}) => run(cmd, args, { timeout: 20_000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" }, ...opts });
  const git = (...args) => sh("git", ["-C", appRoot, ...args], { timeout: 60_000 });

  async function unitList() {
    if (units) return units;
    const SC = await systemctlPath();
    units = {};
    if (!SC) return units;
    await Promise.all(SERVICES.map(async (n) => {
      units[n] = await sh(SC, ["show", "-p", "LoadState", "--value", `${n}.service`], { timeout: 4000 }).then((r) => r.stdout.trim() === "loaded", () => false);
    }));
    return units;
  }

  async function sudoOk() {
    if (Date.now() - sudoCache.at < 60_000) return sudoCache.ok;
    const SC = await systemctlPath();
    const ok = SC ? await sh("sudo", ["-n", "-l", SC, "restart", "studio.service"], { timeout: 4000 }).then(() => true, () => false) : false;
    sudoCache = { at: Date.now(), ok };
    return ok;
  }

  async function gpus() {
    const r = await sh("nvidia-smi", ["--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw", "--format=csv,noheader,nounits"], { timeout: 4000 }).catch(() => null);
    if (!r) return [];
    return r.stdout.trim().split("\n").filter(Boolean).map((l) => {
      const [name, temp, util, mu, mt, pw] = l.split(",").map((x) => x.trim());
      return { name, temp: Number(temp), util: Number(util), memUsedMB: Number(mu), memTotalMB: Number(mt), powerW: Number(pw) || null };
    });
  }

  async function cpuTemp() {
    const temps = [];
    for (const z of await fs.readdir("/sys/class/thermal").catch(() => [])) {
      if (!z.startsWith("thermal_zone")) continue;
      const t = Number(await fs.readFile(`/sys/class/thermal/${z}/temp`, "utf8").catch(() => 0));
      if (t > 1000) temps.push(t / 1000);
    }
    return temps.length ? Math.round(Math.max(...temps)) : null;
  }

  async function disk(p) {
    try {
      const s = await fs.statfs(p);
      return { path: p, freeGB: Math.round((s.bavail * s.bsize) / 2 ** 30), totalGB: Math.round((s.blocks * s.bsize) / 2 ** 30) };
    } catch {
      return null;
    }
  }

  async function gitInfo() {
    try {
      const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      const log = (await git("log", "-1", "--format=%h|%s|%cI")).stdout.trim().split("|");
      const behind = await git("rev-list", "--count", "HEAD..@{u}").then((r) => Number(r.stdout.trim()), () => null);
      const dirty = (await git("status", "--porcelain")).stdout.trim().split("\n").filter(Boolean).length;
      return { branch, commit: log[0], subject: log[1], when: log[2], behind, dirty };
    } catch {
      return null;
    }
  }

  async function status({ light = false } = {}) {
    const [la] = os.loadavg();
    const out = {
      host: os.hostname(),
      load: Number(la.toFixed(2)),
      cpus: os.cpus().length,
      ramFreeGB: Number((os.freemem() / 2 ** 30).toFixed(1)),
      ramTotalGB: Number((os.totalmem() / 2 ** 30).toFixed(1)),
      uptimeS: Math.round(os.uptime()),
      tempC: await cpuTemp(),
      disks: (await Promise.all([disk(appRoot), disk(dataDir)])).filter(Boolean).filter((d, i, a) => a.findIndex((x) => x.totalGB === d.totalGB && x.freeGB === d.freeGB) === i),
      gpus: await gpus(),
    };
    if (light) return out;
    const SC = await systemctlPath();
    out.systemd = Boolean(SC);
    out.sudoOk = await sudoOk();
    const list = await unitList();
    out.services = SC
      ? await Promise.all(SERVICES.filter((n) => list[n]).map(async (n) => ({ name: n, state: await sh(SC, ["is-active", `${n}.service`], { timeout: 4000 }).then((r) => r.stdout.trim(), (e) => (e.stdout || "").trim() || "unknown") })))
      : [];
    out.git = await gitInfo();
    return out;
  }

  async function ensureService(name) {
    if (!SERVICES.includes(name)) throw bad(400, "Layanan tidak dikenal.");
    if (!(await unitList())[name]) throw bad(404, `Layanan ${name} tidak terpasang di server ini.`);
  }

  async function restart(name) {
    await ensureService(name);
    const SC = await systemctlPath();
    if (!(await sudoOk())) throw bad(403, "Izin restart belum aktif. Jalankan ulang deploy/pasang-studio.sh (dengan sudo) sekali di server untuk mengaktifkannya.");
    if (name === "studio") {
      // Diri sendiri: jawab dulu, restart sesaat kemudian.
      setTimeout(() => spawn("sudo", ["-n", SC, "restart", "studio.service"], { detached: true, stdio: "ignore" }).unref(), 500).unref();
      return { ok: true, self: true };
    }
    try {
      await sh("sudo", ["-n", SC, "restart", `${name}.service`], { timeout: 60_000 });
    } catch (e) {
      throw bad(500, `Gagal restart ${name}: ${strip(e.stderr || e.message).slice(0, 300)}`);
    }
    const state = await sh(SC, ["is-active", `${name}.service`], { timeout: 4000 }).then((r) => r.stdout.trim(), (e) => (e.stdout || "").trim());
    return { ok: state === "active", state };
  }

  async function logs(name, n = 120) {
    await ensureService(name);
    n = Math.max(10, Math.min(400, n || 120));
    try {
      const r = await sh("journalctl", ["-u", `${name}.service`, "-n", String(n), "--no-pager", "-o", "short"], { timeout: 15_000 });
      return strip(r.stdout).trim() || "(belum ada log)";
    } catch (e) {
      throw bad(500, `Tidak bisa membaca log: ${strip(e.stderr || e.message).slice(0, 200)}. Jalankan ulang deploy/pasang-studio.sh agar pengguna masuk grup systemd-journal.`);
    }
  }

  async function check() {
    try {
      await git("fetch", "--quiet");
    } catch (e) {
      throw bad(502, `git fetch gagal: ${strip(e.stderr || e.message).slice(0, 200)}`);
    }
    const info = await gitInfo();
    const log = info?.behind ? (await git("log", "HEAD..@{u}", "--format=%h %s", "-n", "15")).stdout.trim().split("\n") : [];
    return { ...info, log };
  }

  async function update() {
    const before = (await git("rev-parse", "HEAD")).stdout.trim();
    let pull;
    try {
      pull = await git("pull", "--ff-only");
    } catch (e) {
      throw bad(409, `Pembaruan gagal: ${strip(e.stderr || e.stdout || e.message).slice(0, 400)}`);
    }
    const after = (await git("rev-parse", "HEAD")).stdout.trim();
    const changed = before !== after;
    let output = strip(pull.stdout).trim();
    let npm = false;
    if (changed) {
      const files = (await git("diff", "--name-only", before, after)).stdout;
      if (/^package(-lock)?\.json$/m.test(files)) {
        npm = true;
        try {
          const r = await sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: appRoot, timeout: 300_000 });
          output += `\n\nnpm install selesai.\n${strip(r.stdout).slice(-500)}`;
        } catch (e) {
          output += `\n\nnpm install gagal: ${strip(e.stderr || e.message).slice(0, 300)}`;
        }
      }
    }
    return { changed, npm, output: output.slice(-2000), commit: (await gitInfo()) };
  }

  async function reboot(confirm) {
    if (confirm !== "REBOOT") throw bad(400, "Konfirmasi salah. Ketik REBOOT.");
    const SC = await systemctlPath();
    if (!SC || !(await sudoOk())) throw bad(403, "Izin reboot belum aktif. Jalankan ulang deploy/pasang-studio.sh (dengan sudo).");
    setTimeout(() => spawn("sudo", ["-n", SC, "reboot"], { detached: true, stdio: "ignore" }).unref(), 800).unref();
    return { ok: true };
  }

  return { status, restart, logs, check, update, reboot };
}
