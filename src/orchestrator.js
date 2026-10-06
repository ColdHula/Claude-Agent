// Pemimpin menerima tugas, mendelegasikan ke agent spesialis lewat alat
// `delegasikan_tugas`, memeriksa hasilnya, lalu menulis hasil akhir.
// Setiap langkah dikirim sebagai event ke UI (lihat EVENTS di README.md).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const LEADER_EFFORT = process.env.LEADER_EFFORT || "high";
const WORKER_EFFORT = process.env.WORKER_EFFORT || "medium";
const MAX_LEADER_TURNS = 16;
const MAX_WORKER_PAUSES = 6;

// Model yang boleh dipakai + harga (USD per 1 juta token) untuk perkiraan biaya.
export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5", price: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  "claude-haiku-4-5": { label: "Haiku 4.5", price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
};
// Agent dengan pekerjaan ringan (draf email, langkah portal): cukup model kecil di mode hemat.
export const LIGHT_AGENTS = new Set(["email-kalender", "chrome-portal"]);
// Pilihan di layar: model untuk Pemimpin, agent, dan agent ringan.
export const PRESETS = {
  hemat: { label: "Hemat otomatis: Sonnet + Haiku untuk tugas ringan", leader: "claude-sonnet-5-5", worker: "claude-sonnet-5-5", light: "claude-haiku-4-5", leaderEffort: "medium" },
  sonnet: { label: "Sonnet (cepat & hemat)", leader: "claude-sonnet-5-5", worker: "claude-sonnet-5-5", light: "claude-sonnet-5-5" },
  campuran: { label: "Campuran: Pemimpin Opus, agent Sonnet", leader: "claude-opus-5-5", worker: "claude-sonnet-5-5", light: "claude-sonnet-5-5" },
  opus: { label: "Opus (paling teliti)", leader: "claude-opus-5-5", worker: "claude-opus-5-5", light: "claude-opus-5-5" },
};
export function defaultModels() {
  // Mode langganan memakai preset hemat sebagai bawaan agar kredit Agent SDK bulanan lebih awet.
  if (process.env.ENGINE === "api") {
    const base = process.env.CLAUDE_MODEL || "claude-opus-5-5";
    const worker = process.env.WORKER_MODEL || base;
    return { leader: process.env.LEADER_MODEL || base, worker, light: worker };
  }
  const h = PRESETS.hemat;
  const base = process.env.CLAUDE_MODEL;
  const worker = process.env.WORKER_MODEL || base || h.worker;
  return {
    leader: process.env.LEADER_MODEL || base || h.leader,
    worker,
    light: process.env.LIGHT_MODEL || (base || process.env.WORKER_MODEL ? worker : h.light),
    leaderEffort: process.env.LEADER_EFFORT || (base || process.env.LEADER_MODEL ? undefined : h.leaderEffort),
  };
}

// Lampiran untuk setiap agent saat bekerja di bawah Pemimpin.
const WORKER_APPENDIX = `

MODE TIM
Anda menerima tugas dari Pemimpin tim, bukan langsung dari Rahula, dan tidak bisa bertanya balik. Bila data kurang, jangan berhenti: kerjakan sejauh mungkin dengan asumsi wajar yang ditandai [ASUMSI] atau [ISI: ...], lalu tulis daftar "Pertanyaan untuk Rahula" di akhir. Serahkan hasil kerja final lengkap (bukan rencana).`;

const addTokens = (t, u) => {
  if (!u) return t;
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  return t;
};
const newTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function costOf(usage, model) {
  if (!usage) return 0;
  const price = (MODELS[model] ?? MODELS["claude-opus-5-5"]).price;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1e6
  );
}

function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Satu permintaan streaming. Mengembalikan pesan final.
async function streamOnce({ model, system, messages, tools, effort, onText, onBlock, signal }) {
  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 64000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      ...(tools?.length ? { tools } : {}),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort },
      // Bila model menolak karena klasifikasi keamanan, API mengulang di model cadangan.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal },
  );
  if (onText) stream.on("text", onText);
  if (onBlock) stream.on("contentBlock", onBlock);
  return stream.finalMessage();
}

function makeDelegateTool(agents) {
  return {
    name: "delegasikan_tugas",
    description:
      "Kirim satu tugas ke satu agent spesialis dan terima hasil kerjanya. Panggil beberapa kali dalam satu giliran untuk mengerjakan tugas yang saling lepas secara paralel. Pakai juga untuk meminta revisi (sertakan catatan perbaikan dan hasil sebelumnya).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", enum: agents.map((a) => a.id), description: "Agent yang ditugaskan." },
        instruksi: {
          type: "string",
          description:
            "Instruksi lengkap dan berdiri sendiri: tujuan, semua data relevan dari Rahula, format keluaran, batasan.",
        },
        ringkasan: { type: "string", description: "Ringkasan tugas maksimal 8 kata untuk ditampilkan di layar." },
      },
      required: ["agent_id", "instruksi", "ringkasan"],
      additionalProperties: false,
    },
  };
}

function validateDelegation(input, agents) {
  if (!input || typeof input !== "object") return "input bukan objek";
  if (!agents.some((a) => a.id === input.agent_id)) return `agent_id tidak dikenal: ${input.agent_id}`;
  if (typeof input.instruksi !== "string" || input.instruksi.trim().length < 10) return "instruksi kosong/terpotong";
  return null;
}

async function runWorker(agent, instruksi, ctx) {
  const { emit, callId, signal, model } = ctx;
  const tools = agent.web ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] : [];
  const messages = [{ role: "user", content: instruksi }];
  let chars = 0;
  let lastEmit = 0;
  let cost = 0;
  const tokens = newTokens();
  let message;

  for (let i = 0; i <= MAX_WORKER_PAUSES; i++) {
    message = await streamOnce({
      model,
      system: agent.system + WORKER_APPENDIX,
      messages,
      tools,
      effort: WORKER_EFFORT,
      signal,
      onText: (delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          emit({ type: "worker_progress", callId, agent: agent.id, chars });
        }
      },
      onBlock: (block) => {
        if (block.type === "server_tool_use" && block.name === "web_search") {
          emit({ type: "worker_search", callId, agent: agent.id, query: block.input?.query ?? "" });
        } else if (block.type === "thinking" && block.thinking) {
          emit({ type: "worker_thinking", callId, agent: agent.id, text: block.thinking.slice(0, 400) });
        }
      },
    });
    cost += costOf(message.usage, model);
    addTokens(tokens, message.usage);
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }

  if (message.stop_reason === "refusal") {
    return { ok: false, output: "Agent menolak tugas ini (refusal) dan model cadangan juga menolak.", cost, tokens };
  }
  const output = textOf(message);
  const truncated = message.stop_reason === "max_tokens" ? "\n\n[Catatan: keluaran terpotong karena batas panjang.]" : "";
  return { ok: output.length > 0, output: (output || "(agent tidak menghasilkan teks)") + truncated, cost, tokens };
}

/**
 * Menjalankan satu tugas dari Rahula sampai selesai.
 * @param {string} task
 * @param {(event: object) => void} emit
 * @param {{agents: any[], leader: any, signal?: AbortSignal, models?: {leader: string, worker: string}}} team
 * @returns {Promise<{final: string, workLog: any[], cost: number}>}
 */
export async function runTask(task, emit, { agents, leader, signal, models = defaultModels() }) {
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const tools = [makeDelegateTool(agents)];
  const messages = [{ role: "user", content: task }];
  const workLog = [];
  let totalCost = 0;
  let callSeq = 0;
  let jsonRetries = 0;

  const tokens = newTokens();
  const addCost = (c, usageOrTokens) => {
    totalCost += c;
    if (usageOrTokens) {
      if ("input" in usageOrTokens) for (const k of Object.keys(tokens)) tokens[k] += usageOrTokens[k];
      else addTokens(tokens, usageOrTokens);
      emit({ type: "tokens", ...tokens });
    }
    emit({ type: "cost", usd: Number(totalCost.toFixed(4)) });
  };

  emit({ type: "leader_status", status: "thinking", text: "Membaca tugas…" });

  for (let turn = 0; turn < MAX_LEADER_TURNS; turn++) {
    let message;
    try {
      message = await streamOnce({
        model: models.leader,
        system: leader.system,
        messages,
        tools,
        effort: LEADER_EFFORT,
        signal,
        onBlock: (block) => {
          if (block.type === "thinking" && block.thinking) {
            emit({ type: "leader_thinking", text: block.thinking.slice(0, 600) });
          }
        },
      });
      jsonRetries = 0;
    } catch (err) {
      // Dengan eager_input_streaming, input alat yang rusak membuat finalMessage() gagal.
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
      emit({ type: "leader_status", status: "thinking", text: "Mengulang instruksi delegasi…" });
      continue;
    }
    addCost(costOf(message.usage, models.leader), message.usage);

    if (message.stop_reason === "refusal") {
      throw new Error("Pemimpin menolak tugas ini (refusal), termasuk di model cadangan.");
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    const said = textOf(message);

    if (toolUses.length === 0) {
      emit({ type: "leader_status", status: "done", text: "Selesai!" });
      return { final: said || "(Pemimpin tidak menulis hasil akhir.)", workLog, cost: totalCost };
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("Instruksi delegasi terpotong (max_tokens).");
    }
    if (said) emit({ type: "leader_say", text: said.slice(0, 500) });

    messages.push({ role: "assistant", content: message.content });

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const problem = validateDelegation(tu.input, agents);
        if (problem) {
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `INVALID_INPUT: ${problem}` };
        }
        const agent = byId[tu.input.agent_id];
        const callId = `c${++callSeq}`;
        const isRevision = workLog.some((w) => w.agent === agent.id);
        emit({
          type: "delegate",
          callId,
          agent: agent.id,
          summary: String(tu.input.ringkasan || agent.title).slice(0, 80),
          instruksi: tu.input.instruksi,
          revision: isRevision,
        });
        try {
          const r = await runWorker(agent, tu.input.instruksi, { emit, callId, signal, model: models.worker });
          addCost(r.cost, r.tokens);
          workLog.push({ agent: agent.id, sim: agent.sim, title: agent.title, instruksi: tu.input.instruksi, output: r.output });
          emit({ type: "worker_done", callId, agent: agent.id, ok: r.ok, output: r.output });
          return { type: "tool_result", tool_use_id: tu.id, content: r.output, ...(r.ok ? {} : { is_error: true }) };
        } catch (err) {
          if (signal?.aborted) throw err;
          const msg = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err?.message || err);
          emit({ type: "worker_done", callId, agent: agent.id, ok: false, output: `Gagal: ${msg}` });
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Agent gagal: ${msg}` };
        }
      }),
    );

    emit({ type: "review", count: results.length });
    messages.push({ role: "user", content: results });
  }

  throw new Error(`Pemimpin belum selesai setelah ${MAX_LEADER_TURNS} giliran.`);
}
