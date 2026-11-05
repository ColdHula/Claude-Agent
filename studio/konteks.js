// Pemadatan konteks otomatis (autocompact) untuk Studio.
//
// Masalah: tiap model punya jendela konteks berbeda (Ollama 8 rb token, model gratis ±32 rb, Claude 200 rb).
// Dulu riwayat lama dipotong diam-diam. Sekarang, bila percakapan mendekati batas jendela model yang dipilih,
// bagian LAMA diringkas oleh model (rolling summary) dan hanya N pesan terbaru dikirim apa adanya.
//
// - Riwayat di layar tetap UTUH; hanya yang dikirim ke model yang diringkas (session.summary + summarizedUpTo).
// - Ringkasan bersifat "bergulir": pemadatan berikutnya meringkas ringkasan lama + pesan baru.
// - Percakapan sangat panjang (mis. hasil impor claude.ai) diringkas bertahap per potongan agar muat di jendela kecil.
// - Claude langganan (Agent SDK) memadatkan sesinya sendiri; Studio hanya mengatur batasnya dan memakai
//   ringkasan bila sesi Claude dimulai baru (ganti penyedia, pemadatan manual, impor).
const CHARS_PER_TOKEN = 3.3; // kira-kira untuk teks Indonesia/Inggris campur kode

export const DEFAULT_WINDOWS = {
  langganan: 200_000,
  anthropic: 200_000,
  openai: 128_000,
  deepseek: 64_000,
  gemini: 200_000, // jendela 1 juta, tetapi free tier dibatasi token per menit
  groq: 32_000,
  "openrouter-free": 32_000,
  openrouter: 64_000,
  venice: 32_000,
  freellmapi: 32_000, // "auto" bisa jatuh ke model kecil → ambil yang konservatif
  ollama: 8_192,
  custom: 8_192,
};
// Tebakan dari nama model (untuk OpenRouter/endpoint lain yang memilih model sendiri).
const BY_MODEL = [
  [/claude|sonnet|opus|haiku|fable/i, 200_000],
  [/gemini/i, 200_000],
  [/gpt-4\.1|gpt-5|o[134]-/i, 128_000],
  [/gpt-4o/i, 128_000],
  [/deepseek/i, 64_000],
  [/llama-?3\.[123]|qwen|mistral|mixtral|gemma|kimi/i, 32_000],
];

export const DEFAULT_CFG = { auto: true, threshold: 0.75, keep: 6, summaryProvider: "auto", summaryModel: "", windows: {} };

const tok = (s) => Math.ceil(String(s || "").length / CHARS_PER_TOKEN);
const IMG = /\.(png|jpe?g|gif|webp)$/i;

const SYSTEM = `Kamu bertugas meringkas percakapan agar bisa dilanjutkan tanpa kehilangan hal penting.
Tulis ringkasan dalam bahasa yang sama dengan percakapan, padat dan faktual, dengan bagian:
1. Tujuan & konteks pengguna
2. Keputusan dan fakta penting (nama, angka, tanggal, nama berkas/jalur, perintah, versi)
3. Yang sudah dikerjakan (termasuk berkas yang diubah)
4. Yang masih terbuka / langkah berikutnya
5. Preferensi dan gaya yang diminta pengguna
Pertahankan kode, perintah, dan nama berkas PERSIS. Jangan menambah hal baru, jangan menjawab pertanyaan di percakapan.
Keluarkan hanya ringkasannya.`;

export function createContext({ store, providers, account, cleanEnv, getSdk, chatHome, extraWindows = {} }) {
  const cfg = () => ({ ...DEFAULT_CFG, ...(store.settings().compact || {}) });
  async function setCfg(patch) {
    const c = { ...cfg() };
    if ("auto" in patch) c.auto = Boolean(patch.auto);
    if ("threshold" in patch) c.threshold = Math.max(0.4, Math.min(0.95, Number(patch.threshold) || 0.75));
    if ("keep" in patch) c.keep = Math.max(2, Math.min(30, Math.round(Number(patch.keep) || 6)));
    if ("summaryProvider" in patch) c.summaryProvider = String(patch.summaryProvider || "auto");
    if ("summaryModel" in patch) c.summaryModel = String(patch.summaryModel || "").slice(0, 120);
    if (patch.windows && typeof patch.windows === "object") {
      c.windows = {};
      for (const [k, v] of Object.entries(patch.windows)) {
        const n = Math.round(Number(v));
        if (n >= 2048 && n <= 4_000_000 && /^[\w-]+$/.test(k)) c.windows[k] = n;
      }
    }
    await store.saveSettings({ compact: c });
    return c;
  }

  function windowFor(provider, model) {
    const c = cfg();
    if (c.windows?.[provider]) return c.windows[provider];
    if (["openrouter", "custom", "freellmapi", "bebas-openrouter"].includes(provider) && model && !/^(auto|fusion)/.test(model)) {
      for (const [re, w] of BY_MODEL) if (re.test(model)) return w;
    }
    return DEFAULT_WINDOWS[provider] || extraWindows[provider] || 8_192;
  }
  const maxChars = (provider, model) => Math.floor(windowFor(provider, model) * CHARS_PER_TOKEN * 0.8);

  // Perkiraan token yang akan dikirim untuk sesi ini. `fromIdx` = indeks pesan pertama yang ikut dikirim.
  function messageTokens(m) {
    let n = tok(m.sent || m.text);
    for (const a of m.attachments || []) if (IMG.test(a.file || a.name || "")) n += 1200;
    return n;
  }
  function estimate(session, { fromIdx, extraTokens = 600 } = {}) {
    const from = fromIdx ?? (session.summary ? session.summarizedUpTo || 0 : 0);
    let n = extraTokens + (session.summary && fromIdx === undefined ? tok(session.summary) : 0);
    for (let i = from; i < session.messages.length; i++) n += messageTokens(session.messages[i]);
    return n;
  }
  function info(session, provider, model, extraTokens) {
    const c = cfg();
    const win = windowFor(provider, model);
    const tokens = estimate(session, { extraTokens });
    return { tokens, window: win, pct: Math.min(100, Math.round((tokens / win) * 100)), threshold: Math.round(c.threshold * 100), auto: c.auto, hasSummary: Boolean(session.summary), summarizedUpTo: session.summarizedUpTo || 0, total: session.messages.length };
  }

  // Indeks batas pemadatan: pesan [from, upto) diringkas, [upto, akhir) dipertahankan.
  function cutIndex(session, keep) {
    const from = session.summary ? session.summarizedUpTo || 0 : 0;
    let k = session.messages.length - keep;
    while (k > from && session.messages[k]?.role !== "user") k--; // mulai dari pesan pengguna agar giliran tetap utuh
    return k > from ? { from, upto: k } : null;
  }
  function needsCompact(session, provider, model, { extraTokens = 600, resumingClaude = false } = {}) {
    const c = cfg();
    if (!c.auto || resumingClaude) return false;
    const win = windowFor(provider, model);
    if (estimate(session, { extraTokens }) <= win * c.threshold) return false;
    const cut = cutIndex(session, c.keep);
    if (!cut) return false;
    // Tidak ada gunanya memadatkan hal yang sangat sedikit.
    let toSum = 0;
    for (let i = cut.from; i < cut.upto; i++) toSum += messageTokens(session.messages[i]);
    return toSum >= 800;
  }

  // ───────── memanggil model untuk meringkas ─────────
  function pickSummarizer(provider, model, sameProvider = false) {
    const c = cfg();
    // Ruang bebas: isi chat TIDAK BOLEH dikirim ke penyedia lain, jadi penyusun ringkasan selalu penyedia yang sama.
    if (!sameProvider && c.summaryProvider && c.summaryProvider !== "auto") {
      const p = providers.resolve(c.summaryProvider);
      return { id: p.id, kind: p.kind, model: c.summaryModel || p.defaultModel };
    }
    const p = providers.resolve(provider);
    // Langganan: pakai Haiku (murah & cepat) untuk meringkas.
    if (p.kind === "claude-sdk") return { id: p.id, kind: p.kind, model: "claude-haiku-5-5" };
    return { id: p.id, kind: p.kind, model: model || p.defaultModel };
  }
  async function complete(sm, system, user, signal) {
    if (sm.kind === "claude-sdk") {
      const { query } = await getSdk();
      const ac = new AbortController();
      signal?.addEventListener("abort", () => ac.abort(), { once: true });
      const q = query({
        prompt: user,
        options: { model: sm.model, systemPrompt: system, tools: [], persistSession: false, settingSources: [], maxTurns: 1, maxBudgetUsd: 0.3, cwd: chatHome, env: account.sdkEnv(cleanEnv()), abortController: ac },
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
    if (sm.kind === "anthropic") {
      const p = providers.resolve(sm.id);
      if (!p.apiKey) throw new Error("ANTHROPIC_API_KEY belum diisi");
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const r = await new Anthropic({ apiKey: p.apiKey }).messages.create({ model: sm.model, max_tokens: 4000, system, messages: [{ role: "user", content: user }] }, { signal });
      return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    }
    let text = "";
    await providers.chatOpenAI(sm.id, { model: sm.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], signal, onDelta: (t) => (text += t) });
    return text.replace(/<think>[\s\S]*?<\/think>/g, "");
  }

  const clip = (s, n) => (s.length > n ? `${s.slice(0, Math.floor(n * 0.6))}\n[…dipotong…]\n${s.slice(-Math.floor(n * 0.4))}` : s);
  function render(m, per) {
    if (m.role === "user") return `Pengguna: ${clip(m.sent || m.text || "", per)}${m.attachments?.length ? `\n[Lampiran: ${m.attachments.map((a) => a.name).join(", ")}]` : ""}`;
    const tools = (m.steps || []).filter((s) => s.kind === "tool" && !s.sub).map((s) => s.label).slice(0, 12);
    return `Asisten: ${clip(m.text || "", per)}${tools.length ? `\n[Alat dipakai: ${tools.join("; ")}]` : ""}`;
  }

  // Meringkas pesan [from, upto) ke dalam ringkasan bergulir. Dipotong per bagian agar muat di jendela model.
  async function compact(session, { provider, model, keep, force = false, signal, onProgress, sameProvider = false } = {}) {
    const c = cfg();
    const cut = cutIndex(session, keep ?? c.keep);
    if (!cut) return { compacted: false, reason: "Belum ada bagian lama yang perlu dipadatkan." };
    const win = windowFor(provider, model);
    const sm = pickSummarizer(provider, model, sameProvider);
    const smWin = sm.kind === "claude-sdk" ? 200_000 : windowFor(sm.id, sm.model);
    const targetTok = Math.max(400, Math.min(2200, Math.floor(smWin * 0.1)));
    const budgetChars = Math.floor(smWin * CHARS_PER_TOKEN * 0.5);
    const perMsg = Math.max(1500, Math.min(8000, Math.floor(budgetChars / 6)));
    const before = estimate(session);

    // bagi pesan menjadi kelompok yang masing-masing muat di anggaran
    const groups = [];
    let cur = [], used = 0;
    for (let i = cut.from; i < cut.upto; i++) {
      const t = render(session.messages[i], perMsg);
      if (used + t.length > budgetChars && cur.length) { groups.push(cur); cur = []; used = 0; }
      cur.push(t); used += t.length;
    }
    if (cur.length) groups.push(cur);

    let summary = session.summary || "";
    for (let g = 0; g < groups.length; g++) {
      onProgress?.({ phase: "progress", done: g, total: groups.length });
      const user = `${summary ? `<ringkasan_sebelumnya>\n${summary}\n</ringkasan_sebelumnya>\n\n` : ""}<percakapan_baru>\n${groups[g].join("\n\n")}\n</percakapan_baru>\n\nGabungkan menjadi SATU ringkasan baru yang utuh (maksimal ±${Math.round(targetTok * 0.7)} kata).`;
      const out = (await complete(sm, SYSTEM, user, signal)).trim();
      if (!out) throw new Error("Penyusun ringkasan mengembalikan teks kosong");
      summary = out;
    }
    session.summary = summary;
    session.summarizedUpTo = cut.upto;
    session.summaryAt = Date.now();
    session.compactions = (session.compactions || 0) + 1;
    const after = estimate(session);
    return { compacted: true, from: cut.from, upto: cut.upto, before, after, summary, by: `${sm.id}/${sm.model}`, window: win };
  }

  return { cfg, setCfg, windowFor, maxChars, estimate, info, needsCompact, cutIndex, compact, defaults: () => ({ windows: DEFAULT_WINDOWS, cfg: DEFAULT_CFG }) };
}

// Blok ringkasan untuk instruksi sistem.
export function summaryBlock(session) {
  if (!session.summary) return "";
  return `\n\n<ringkasan_percakapan_sebelumnya>\nRingkasan otomatis ${session.summarizedUpTo} pesan pertama percakapan ini (pesan lengkapnya sudah tidak dikirim). Pakai sebagai konteks; jangan menyebut bahwa Anda diberi ringkasan kecuali ditanya.\n${session.summary}\n</ringkasan_percakapan_sebelumnya>`;
}
