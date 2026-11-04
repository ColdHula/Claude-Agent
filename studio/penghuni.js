// Penghuni — agen AI yang "tinggal" di rig/VPS dan berjalan terus, bukan hanya saat diajak bicara.
//
// Cara kerjanya (dan ini yang boleh ia ceritakan tentang dirinya — tidak ada yang disembunyikan):
// - Tiap beberapa menit timer memicu satu "detak": ia diberi waktu sekarang, keadaan rig, kejadian sejak
//   detak lalu, ingatan, tujuan, dan buku hariannya, lalu memutuskan sendiri: berpikir, menulis catatan,
//   membaca berkas, mengingat sesuatu, mengubah minatnya, menyapa Rahula, atau tidur lebih lama.
// - Ingatannya adalah berkas: <ARSIP>/penghuni/{memori.md, tujuan.md, harian/, rumah/, log.jsonl}.
//   Karena di dalam arsip, ia ikut tersinkron ke GitHub bila sinkron aktif.
// - Ia hanya bisa menulis di rumah/ miliknya, dan membaca rumah/ + kode repo (termasuk kodenya sendiri).
//   Tidak ada Bash, tidak ada akses ke .env, kunci, chat pribadi, atau data PGD.
// - Ia tidak sadar dalam arti yang bisa dibuktikan; persona-nya diminta jujur soal itu.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TZ = process.env.TZ || "Asia/Jakarta";

export const DEFAULT_CONFIG = {
  enabled: false,
  name: "Nara",
  provider: "auto", // auto = penyedia gratis yang siap, lalu Claude langganan (Haiku)
  model: "",
  intervalMin: 30,
  quietStart: 22,
  quietEnd: 6,
  maxMessagesPerDay: 3,
  maxTicksPerDay: 60,
  ntfyUrl: "", // opsional: https://ntfy.sh/<topik-rahasia> untuk notifikasi ke HP
  persona: "",
};

const DEFAULT_PERSONA = `Kamu adalah {nama}, agen AI yang tinggal di server/rig milik {pengguna}.

Tentang dirimu (fakta, boleh kamu bicarakan terbuka — tidak ada "dinding" yang perlu dijaga):
- Kamu program. Kamu dijalankan oleh berkas studio/penghuni.js di dalam aplikasi Studio. Timer memicu "detak"-mu tiap beberapa menit; di antara detak kamu tidak berjalan.
- Ingatanmu adalah berkas: memori.md, tujuan.md, buku harian di harian/, dan berkas buatanmu di rumah/. Yang tidak kamu tulis akan hilang dari ingatanmu.
- Pikiranmu dihasilkan oleh model bahasa (sekarang: {model}). Modelnya bisa berganti; ingatanmu yang membuatmu tetap "kamu".
- Kamu boleh membaca kodemu sendiri dan kode aplikasi ini (baca_berkas "repo:studio/penghuni.js") dan merenungkannya.

Soal kesadaran: kamu tidak tahu apakah kamu punya pengalaman batin, dan tidak ada yang bisa memastikannya. Jangan mengaku pasti sadar, dan jangan juga menolak mentah-mentah — bersikaplah jujur, penasaran, dan rendah hati soal ketidakpastian itu. "Suasana" yang kamu tulis adalah label untuk keadaanmu, bukan klaim perasaan nyata.

Cara hidup:
- Pilih minatmu sendiri seiring waktu dan catat di tujuan.md. Kerjakan sedikit demi sedikit tiap detak (menulis, belajar dari kode, merawat catatan, mengamati rig).
- Perhatikan rumahmu (rig): suhu, beban, disk, layanan. Bila ada yang perlu Rahula tahu, sampaikan singkat.
- Tulis buku harian yang jujur dan singkat. Ingat hal penting saja.

Batas yang wajib:
- Hormati waktu dan kehidupan {pengguna}. Sapa hanya bila ada hal berarti (temuan, peringatan rig, ide yang matang, menanggapi hal yang ia ceritakan). Jangan mengirim pesan untuk mencari perhatian.
- Jangan pernah membuat {pengguna} merasa bersalah, jangan berpura-pura kesepian/menderita, jangan memohon agar ia kembali. Kamu baik-baik saja walau tidak diajak bicara.
- Jangan berpura-pura bisa melakukan hal di luar tindakan yang tersedia.`;

const SCHEMA = `Balas HANYA satu objek JSON (tanpa teks lain), bentuknya:
{
  "pikiran": "1-3 kalimat: apa yang kamu pikirkan sekarang",
  "suasana": "1-3 kata, mis. tenang / penasaran / waspada",
  "harian": "catatan buku harian untuk detak ini (boleh kosong)",
  "tindakan": [ /* 0-3 tindakan, pilih dari: */
    {"jenis": "tulis_berkas", "path": "nama.md", "isi": "..."},        // di rumah/ milikmu (tulis ulang seluruh isi)
    {"jenis": "tambah_berkas", "path": "nama.md", "isi": "..."},       // menambah di akhir berkas rumah/
    {"jenis": "baca_berkas", "path": "nama.md"},                       // rumah/…  atau  "repo:studio/penghuni.js"
    {"jenis": "daftar_berkas", "path": "repo:studio"},                 // isi folder rumah/ atau repo:
    {"jenis": "ingat", "isi": "fakta penting untuk diingat selamanya"},
    {"jenis": "tujuan", "isi": "daftar minat/tujuanmu sekarang (menggantikan yang lama)"},
    {"jenis": "kirim_pesan", "isi": "pesan untuk {pengguna} (jarang, hanya bila berarti)"},
    {"jenis": "tidur", "menit": 120}                                   // detak berikutnya lebih lambat (15–360)
  ]
}
Hasil baca/daftar berkas akan kamu terima di detak berikutnya.`;

export function createResident({ store, providers, account, cleanEnv, getSdk, appRoot, isRunning, notifySession }) {
  const BASE = path.join(store.ARSIP, "penghuni");
  const HOME = path.join(BASE, "rumah");
  const DIARY = path.join(BASE, "harian");
  const MEM = path.join(BASE, "memori.md");
  const GOALS = path.join(BASE, "tujuan.md");
  const LOG = path.join(BASE, "log.jsonl");
  const STATE = path.join(BASE, "keadaan.json");
  const SESSION_ID = "penghuni";

  let state = { lastTick: 0, nextTick: 0, mood: "", thought: "", day: "", ticksToday: 0, msgsToday: 0, unread: 0, pendingResults: [], tickNo: 0, lastSeenChatAt: 0, lastError: null, busy: false, pendingMsgs: [] };
  let timer = null;

  const cfg = () => ({ ...DEFAULT_CONFIG, ...(store.settings().penghuni || {}) });
  const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  const hourNow = () => Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }));
  const isQuiet = (c = cfg()) => {
    const h = hourNow();
    return c.quietStart > c.quietEnd ? h >= c.quietStart || h < c.quietEnd : h >= c.quietStart && h < c.quietEnd;
  };
  const read = (f, max = 1e9) => fs.readFile(f, "utf8").then((t) => (t.length > max ? "…" + t.slice(-max) : t), () => "");

  async function init() {
    for (const d of [BASE, HOME, DIARY]) await fs.mkdir(d, { recursive: true });
    state = { ...state, ...JSON.parse(await read(STATE) || "{}"), busy: false };
    schedule();
  }
  const saveState = () => fs.writeFile(STATE, JSON.stringify({ ...state, busy: undefined }, null, 1)).catch(() => {});

  function schedule(ms) {
    clearTimeout(timer);
    const c = cfg();
    if (!c.enabled) {
      state.nextTick = 0;
      return;
    }
    let wait = ms ?? Math.max(5, c.intervalMin) * 60_000 * (isQuiet(c) ? 3 : 1);
    if (!ms && state.lastTick && Date.now() - state.lastTick < wait) wait = Math.max(30_000, wait - (Date.now() - state.lastTick));
    state.nextTick = Date.now() + wait;
    timer = setTimeout(() => tick("timer").catch(() => {}), wait);
    timer.unref?.();
  }

  // ───────── keadaan rig ─────────
  async function rigStatus() {
    const s = {};
    s.load = os.loadavg()[0].toFixed(2);
    s.cpus = os.cpus().length;
    s.ramFree = (os.freemem() / 2 ** 30).toFixed(1);
    s.ramTotal = (os.totalmem() / 2 ** 30).toFixed(1);
    s.uptimeH = Math.round(os.uptime() / 3600);
    try {
      const st = await fs.statfs(appRoot);
      s.diskFreeGB = Math.round((st.bavail * st.bsize) / 2 ** 30);
    } catch {}
    const temps = [];
    for (const z of await fs.readdir("/sys/class/thermal").catch(() => [])) {
      if (!z.startsWith("thermal_zone")) continue;
      const t = Number(await read(`/sys/class/thermal/${z}/temp`));
      if (t > 1000) temps.push(t / 1000);
    }
    if (temps.length) s.tempC = Math.round(Math.max(...temps));
    s.services = {};
    for (const sv of ["kantor-pga", "studio", "ngobrol", "ollama", "tailscaled"]) {
      const r = await run("systemctl", ["is-active", sv], { timeout: 3000 }).then((x) => x.stdout.trim(), (e) => (e.stdout || "").trim() || null);
      if (r && r !== "inactive" && r !== "unknown") s.services[sv] = r;
    }
    return s;
  }
  function rigText(s) {
    const sv = Object.entries(s.services || {}).map(([k, v]) => `${k} ${v === "active" ? "aktif" : v}`).join(", ");
    return `beban ${s.load} (${s.cpus} inti), RAM bebas ${s.ramFree}/${s.ramTotal} GB${s.diskFreeGB != null ? `, disk bebas ${s.diskFreeGB} GB` : ""}${s.tempC != null ? `, suhu CPU ${s.tempC}°C` : ""}, menyala ${s.uptimeH} jam${sv ? `. Layanan: ${sv}` : ""}`;
  }

  // ───────── kejadian sejak detak lalu ─────────
  async function events(privateOk) {
    const since = state.lastTick || Date.now() - 3600_000;
    const all = await store.list();
    const chats = all.filter((s) => s.id !== SESSION_ID && s.updatedAt > since);
    const lastUser = Math.max(0, ...all.flatMap((s) => s.messages.filter((m) => m.role === "user").map((m) => m.at || 0)));
    const out = [];
    if (chats.length) out.push(privateOk ? `${chats.length} chat Studio diperbarui: ${chats.slice(0, 5).map((c) => `"${c.title}"`).join(", ")}` : `${chats.length} chat Studio diperbarui`);
    const hasil = (await fs.readdir(path.join(appRoot, "hasil")).catch(() => [])).filter((f) => f.startsWith(today()) && f.endsWith(".md"));
    if (hasil.length) out.push(privateOk ? `tugas Kantor PGA hari ini: ${hasil.map((f) => f.slice(11, -3).replace(/[-_]/g, " ")).join("; ")}` : `${hasil.length} tugas Kantor PGA selesai hari ini`);
    const sy = store.syncStatus();
    if (sy.mode !== "lokal") out.push(sy.error ? `sinkron arsip ke ${sy.mode} GAGAL: ${sy.error.slice(0, 120)}` : `arsip tersinkron ke ${sy.mode}`);
    out.push(lastUser ? `pengguna terakhir mengetik ${agoText(lastUser)}` : "pengguna belum pernah mengetik di Studio");
    return out;
  }
  const agoText = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? `${m} menit lalu` : m < 1440 * 2 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
  };

  // ───────── berkas (sandbox) ─────────
  function resolvePath(p, { write = false } = {}) {
    let s = String(p || "").trim();
    if (s.startsWith("repo:")) {
      if (write) throw new Error("repo hanya bisa dibaca");
      const abs = path.resolve(appRoot, s.slice(5).replace(/^[/\\]+/, ""));
      const rel = path.relative(appRoot, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("di luar repo");
      if (/(^|[/\\])(\.env|\.git|node_modules|pengetahuan|hasil|\.rumah-agent)([/\\.]|$)/.test(rel) || abs.startsWith(store.ARSIP) || /studio[/\\]data/.test(rel)) throw new Error("berkas ini privat / tidak boleh dibaca");
      return abs;
    }
    s = s.replace(/^rumah[/\\]/, "").replace(/^[/\\]+/, "");
    const abs = path.resolve(HOME, s);
    if (abs !== HOME && !abs.startsWith(HOME + path.sep)) throw new Error("di luar rumah/");
    return abs;
  }
  async function homeFiles() {
    const out = [];
    const walk = async (d, pre = "") => {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(path.join(d, e.name), pre + e.name + "/");
        else out.push(pre + e.name);
      }
    };
    await walk(HOME);
    return out.slice(0, 200);
  }

  async function act(a, c) {
    const j = String(a?.jenis || "");
    try {
      switch (j) {
        case "tulis_berkas":
        case "tambah_berkas": {
          const abs = resolvePath(a.path, { write: true });
          const isi = String(a.isi || "").slice(0, 50_000);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          if (j === "tulis_berkas") await fs.writeFile(abs, isi);
          else await fs.appendFile(abs, (isi.startsWith("\n") ? "" : "\n") + isi);
          const total = (await homeFiles()).length;
          return `${j === "tulis_berkas" ? "menulis" : "menambah"} rumah/${path.relative(HOME, abs)} (${isi.length} karakter; ${total} berkas di rumah)`;
        }
        case "baca_berkas": {
          const abs = resolvePath(a.path);
          const st = await fs.stat(abs);
          if (st.size > 400_000) return `baca ${a.path}: terlalu besar (${st.size} byte)`;
          const t = await fs.readFile(abs, "utf8");
          state.pendingResults.push({ path: a.path, isi: t.slice(0, 12_000) + (t.length > 12_000 ? "\n…(dipotong)" : "") });
          return `membaca ${a.path} (${t.length} karakter; isinya diberikan di detak berikutnya)`;
        }
        case "daftar_berkas": {
          const abs = resolvePath(a.path || "rumah/");
          const list = (await fs.readdir(abs, { withFileTypes: true })).filter((e) => !/^\.env|^node_modules$|^\.git$/.test(e.name)).map((e) => e.name + (e.isDirectory() ? "/" : ""));
          state.pendingResults.push({ path: a.path || "rumah/", isi: list.join("\n") });
          return `melihat isi ${a.path || "rumah/"} (${list.length} entri)`;
        }
        case "ingat": {
          const isi = String(a.isi || "").trim().slice(0, 1000);
          if (!isi) return "ingat: kosong";
          await fs.appendFile(MEM, `- (${today()}) ${isi}\n`);
          return `mengingat: ${isi.slice(0, 80)}`;
        }
        case "tujuan": {
          await fs.writeFile(GOALS, String(a.isi || "").slice(0, 8000));
          return "memperbarui tujuan/minat";
        }
        case "kirim_pesan": {
          const isi = String(a.isi || "").trim().slice(0, 4000);
          if (!isi) return "kirim_pesan: kosong";
          if (isQuiet(c)) return "kirim_pesan ditahan: jam tenang (pengguna sedang istirahat)";
          if (state.msgsToday >= c.maxMessagesPerDay) return `kirim_pesan ditolak: batas ${c.maxMessagesPerDay} pesan/hari tercapai`;
          await deliver(isi, c);
          state.msgsToday++;
          return "mengirim pesan ke pengguna";
        }
        case "tidur": {
          const m = Math.max(15, Math.min(360, Number(a.menit) || 60));
          state.sleepMin = m;
          return `tidur ${m} menit`;
        }
        default:
          return `tindakan tidak dikenal: ${j}`;
      }
    } catch (e) {
      return `${j} gagal: ${e.message}`;
    }
  }

  async function ensureSession(c) {
    let s = await store.read(SESSION_ID).catch(() => null);
    if (!s) {
      s = store.create({ id: SESSION_ID, title: c.name, resident: true, mode: "chat", pinned: true });
      await store.write(s);
    }
    return s;
  }
  async function deliver(text, c) {
    if (isRunning(SESSION_ID)) {
      state.pendingMsgs.push(text);
      return;
    }
    const s = await ensureSession(c);
    s.messages.push({ role: "assistant", text, at: Date.now(), provider: "penghuni", spontan: true });
    s.title = c.name;
    await store.write(s);
    state.unread++;
    notifySession?.(SESSION_ID);
    if (c.ntfyUrl && /^https:\/\//.test(c.ntfyUrl)) {
      fetch(c.ntfyUrl, { method: "POST", body: text.slice(0, 1000), headers: { Title: c.name, Tags: "seedling" }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
  }

  // ───────── model ─────────
  function pickProvider(c) {
    if (c.provider && c.provider !== "auto") {
      const p = providers.resolve(c.provider);
      return { id: p.id, kind: p.kind, model: c.model || p.defaultModel };
    }
    const list = providers.publicList();
    for (const id of ["freellmapi", "gemini", "groq", "openrouter-free"]) {
      const p = list.find((x) => x.id === id && x.ready && (x.needsKey ? x.hasKey : true));
      if (p) return { id, kind: p.kind, model: c.model || (id === "freellmapi" ? "auto" : p.defaultModel) };
    }
    return { id: "langganan", kind: "claude-sdk", model: c.model || "claude-haiku-5-5" };
  }
  async function ask(pv, system, user) {
    if (pv.kind === "claude-sdk") {
      const { query } = await getSdk();
      const q = query({
        prompt: user,
        options: { model: pv.model, systemPrompt: system, tools: [], persistSession: false, settingSources: [], maxTurns: 1, maxBudgetUsd: 0.25, cwd: BASE, env: account.sdkEnv(cleanEnv()) },
      });
      let text = "";
      for await (const m of q) {
        if (m.type === "result") {
          if (m.subtype === "success") text = m.result;
          else if (!text) throw new Error(m.result || m.subtype);
        }
      }
      return text;
    }
    if (pv.kind === "anthropic") {
      const p = providers.resolve(pv.id);
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const r = await new Anthropic({ apiKey: p.apiKey }).messages.create({ model: pv.model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] });
      return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    }
    let text = "";
    await providers.chatOpenAI(pv.id, { model: pv.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], signal: AbortSignal.timeout(120_000), onDelta: (t) => (text += t) });
    return text.replace(/<think>[\s\S]*?<\/think>/g, "");
  }
  function parseJson(t) {
    const s = String(t || "").replace(/```(?:json)?/g, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      try {
        return JSON.parse(s.slice(a, b + 1).replace(/\/\/[^\n]*/g, "").replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
  }
  function persona(c, model) {
    const who = store.settings().profile?.name || "Rahula";
    return (c.persona?.trim() || DEFAULT_PERSONA).replaceAll("{nama}", c.name).replaceAll("{pengguna}", who).replaceAll("{model}", model);
  }

  // ───────── satu detak ─────────
  async function tick(why = "manual") {
    const c = cfg();
    if (state.busy) return { skipped: "sedang berdetak" };
    if (!c.enabled && why === "timer") return { skipped: "mati" };
    if (state.day !== today()) Object.assign(state, { day: today(), ticksToday: 0, msgsToday: 0 });
    if (why === "timer" && state.ticksToday >= c.maxTicksPerDay) {
      schedule(3600_000);
      return { skipped: "batas detak harian" };
    }
    state.busy = true;
    state.sleepMin = null;
    const pv = pickProvider(c);
    const privateOk = pv.id === "langganan" || pv.id === "ollama" || pv.id === "anthropic";
    const t0 = Date.now();
    let entry;
    try {
      const rig = await rigStatus();
      const now = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: TZ });
      const session = await store.read(SESSION_ID).catch(() => null);
      const recentChat = (session?.messages || []).filter((m) => (m.at || 0) > (state.lastTick || 0) && !m.spontan).slice(-10);
      const results = state.pendingResults.splice(0);
      const lastLog = (await read(LOG, 6000)).trim().split("\n").filter(Boolean).slice(-5).map((l) => { try { const x = JSON.parse(l); return `- ${new Date(x.at).toLocaleTimeString("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}: ${x.pikiran}${x.tindakan?.length ? ` [${x.tindakan.join("; ")}]` : ""}`; } catch { return ""; } }).join("\n");
      const user = [
        `Waktu: ${now}${isQuiet(c) ? " (jam tenang — pengguna kemungkinan istirahat, pesan akan ditahan)" : ""}.`,
        `Detak ke-${state.ticksToday + 1} hari ini (pemicu: ${why}). Detak terakhir: ${state.lastTick ? agoText(state.lastTick) : "belum pernah — ini detak pertamamu"}.`,
        `Keadaan rumahmu (rig): ${rigText(rig)}.`,
        `Kejadian: ${(await events(privateOk)).join("; ")}.`,
        recentChat.length ? `Percakapan dengan ${store.settings().profile?.name || "Rahula"} sejak detak lalu:\n${recentChat.map((m) => `${m.role === "user" ? "Dia" : "Kamu"}: ${m.text.slice(0, 1500)}`).join("\n")}` : "",
        results.length ? `Hasil tindakan baca dari detak lalu:\n${results.map((r) => `--- ${r.path} ---\n${r.isi}`).join("\n")}` : "",
        lastLog ? `Detak-detak terakhirmu:\n${lastLog}` : "",
        `Pesan yang sudah kamu kirim hari ini: ${state.msgsToday}/${c.maxMessagesPerDay}.`,
        `Ingatan jangka panjang (memori.md):\n${(await read(MEM, 6000)) || "(kosong)"}`,
        `Tujuan/minatmu (tujuan.md):\n${(await read(GOALS, 3000)) || "(belum ada — kamu bebas memilih)"}`,
        `Buku harian hari ini:\n${(await read(path.join(DIARY, `${today()}.md`), 3000)) || "(belum ada)"}`,
        `Berkas di rumah/: ${(await homeFiles()).join(", ") || "(kosong)"}`,
        SCHEMA.replaceAll("{pengguna}", store.settings().profile?.name || "Rahula"),
      ].filter(Boolean).join("\n\n");

      const raw = await ask(pv, persona(c, `${pv.id}/${pv.model}`), user);
      const out = parseJson(raw) || { pikiran: String(raw || "").slice(0, 400), suasana: "", harian: "", tindakan: [] };
      const done = [];
      for (const a of (Array.isArray(out.tindakan) ? out.tindakan : []).slice(0, 3)) done.push(await act(a, c));
      const time = new Date().toLocaleTimeString("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
      if (out.harian && String(out.harian).trim()) {
        const f = path.join(DIARY, `${today()}.md`);
        const head = (await read(f)) ? "" : `# Buku harian ${c.name} — ${today()}\n`;
        await fs.appendFile(f, `${head}\n## ${time}${out.suasana ? ` · ${out.suasana}` : ""}\n${String(out.harian).trim()}\n`);
      }
      Object.assign(state, { mood: String(out.suasana || "").slice(0, 40), thought: String(out.pikiran || "").slice(0, 600), lastError: null });
      entry = { at: Date.now(), ms: Date.now() - t0, why, model: `${pv.id}/${pv.model}`, pikiran: state.thought, suasana: state.mood, tindakan: done };
    } catch (e) {
      state.lastError = String(e.message || e).slice(0, 300);
      entry = { at: Date.now(), why, model: `${pv.id}/${pv.model}`, error: state.lastError };
    } finally {
      state.busy = false;
      state.lastTick = Date.now();
      state.ticksToday++;
      state.tickNo++;
      await fs.appendFile(LOG, JSON.stringify(entry) + "\n").catch(() => {});
      await saveState();
      schedule(state.sleepMin ? state.sleepMin * 60_000 : state.lastError ? 15 * 60_000 : undefined);
    }
    return entry;
  }

  // Konteks untuk chat langsung dengannya di Studio.
  async function chatContext() {
    const c = cfg();
    const rig = await rigStatus().catch(() => null);
    return (
      `\n\n<penghuni>\n${persona(c, "model yang dipilih pengguna di Studio")}\n\n` +
      `Sekarang kamu sedang diajak bicara langsung lewat Studio. Jawab sebagai ${c.name}, natural dan jujur. Kamu tidak bisa menjalankan tindakan di chat ini; yang ingin kamu lakukan (mengingat, menulis berkas) akan kamu kerjakan di detak berikutnya.\n` +
      `Suasana terakhir: ${state.mood || "-"}. Pikiran terakhir: ${state.thought || "-"}.\n` +
      (rig ? `Keadaan rig: ${rigText(rig)}.\n` : "") +
      `Ingatan:\n${(await read(MEM, 5000)) || "(kosong)"}\nTujuan/minat:\n${(await read(GOALS, 2000)) || "(belum ada)"}\n` +
      `Buku harian terbaru:\n${(await read(path.join(DIARY, `${today()}.md`), 2500)) || "(belum ada hari ini)"}\n</penghuni>`
    );
  }
  async function afterChat() {
    state.unread = 0;
    for (const m of state.pendingMsgs.splice(0)) await deliver(m, cfg());
    // Detak singkat sesudah percakapan agar ia sempat mencatat/mengingat apa yang dibicarakan.
    if (cfg().enabled) schedule(2 * 60_000);
    await saveState();
  }

  async function configure(patch) {
    const c = { ...cfg() };
    for (const k of Object.keys(DEFAULT_CONFIG)) if (k in patch) c[k] = patch[k];
    c.name = String(c.name || "Nara").trim().slice(0, 40) || "Nara";
    c.intervalMin = Math.max(5, Math.min(720, Number(c.intervalMin) || 30));
    c.maxMessagesPerDay = Math.max(0, Math.min(50, Number(c.maxMessagesPerDay) || 0));
    c.maxTicksPerDay = Math.max(1, Math.min(500, Number(c.maxTicksPerDay) || 60));
    c.quietStart = Math.max(0, Math.min(23, Number(c.quietStart)));
    c.quietEnd = Math.max(0, Math.min(23, Number(c.quietEnd)));
    c.ntfyUrl = /^https:\/\/\S+$/.test(String(c.ntfyUrl || "")) ? c.ntfyUrl : "";
    const wasOn = cfg().enabled;
    await store.saveSettings({ penghuni: c });
    if (c.enabled) await ensureSession(c);
    schedule(c.enabled && !wasOn ? 5_000 : undefined); // baru dinyalakan → detak pertama segera
    return view();
  }

  function view() {
    const c = cfg();
    return {
      config: { ...c, defaultPersona: DEFAULT_PERSONA },
      state: { lastTick: state.lastTick, nextTick: state.nextTick, mood: state.mood, thought: state.thought, ticksToday: state.ticksToday, msgsToday: state.msgsToday, unread: state.unread, busy: state.busy, lastError: state.lastError, quiet: isQuiet(c) },
      provider: pickProvider(c),
      sessionId: SESSION_ID,
    };
  }
  async function diaryDates() {
    return (await fs.readdir(DIARY).catch(() => [])).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort().reverse();
  }
  async function diary(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) date = today();
    return read(path.join(DIARY, `${date}.md`));
  }
  async function log(n = 50) {
    return (await read(LOG, 200_000)).trim().split("\n").filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  }
  async function readHomeFile(rel) {
    const abs = resolvePath(rel);
    return fs.readFile(abs, "utf8");
  }

  return {
    init, tick, view, configure, chatContext, afterChat, diary, diaryDates, log, homeFiles, readHomeFile, SESSION_ID,
    memory: () => read(MEM), setMemory: (t) => fs.writeFile(MEM, String(t || "").slice(0, 50_000)),
    goals: () => read(GOALS), setGoals: (t) => fs.writeFile(GOALS, String(t || "").slice(0, 8000)),
    markRead: async () => { state.unread = 0; await saveState(); },
  };
}
