// Pemimpin menerima tugas, mendelegasikan ke agent spesialis lewat alat
// `delegasikan_tugas`, memeriksa hasilnya, lalu menulis hasil akhir.
// Setiap langkah dikirim sebagai event ke UI (lihat EVENTS di README.md).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const LEADER_EFFORT = process.env.LEADER_EFFORT || "high";
const WORKER_EFFORT = process.env.WORKER_EFFORT || "medium";
const MAX_LEADER_TURNS = 16;
const MAX_WORKER_PAUSES = 6;
// Perkiraan biaya (USD per 1 juta token) untuk Claude Opus 5.5.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

// Lampiran untuk setiap agent saat bekerja di bawah Pemimpin.
const WORKER_APPENDIX = `

MODE TIM
Anda menerima tugas dari Pemimpin tim, bukan langsung dari Rahula, dan tidak bisa bertanya balik. Bila data kurang, jangan berhenti: kerjakan sejauh mungkin dengan asumsi wajar yang ditandai [ASUMSI] atau [ISI: ...], lalu tulis daftar "Pertanyaan untuk Rahula" di akhir. Serahkan hasil kerja final lengkap (bukan rencana).`;

function costOf(usage) {
  if (!usage) return 0;
  return (
    ((usage.input_tokens ?? 0) * PRICE.input +
      (usage.output_tokens ?? 0) * PRICE.output +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
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
async function streamOnce({ system, messages, tools, effort, onText, onBlock, signal }) {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
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
  const { emit, callId, signal } = ctx;
  const tools = agent.web ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }] : [];
  const messages = [{ role: "user", content: instruksi }];
  let chars = 0;
  let lastEmit = 0;
  let cost = 0;
  let message;

  for (let i = 0; i <= MAX_WORKER_PAUSES; i++) {
    message = await streamOnce({
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
    cost += costOf(message.usage);
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }

  if (message.stop_reason === "refusal") {
    return { ok: false, output: "Agent menolak tugas ini (refusal) dan model cadangan juga menolak.", cost };
  }
  const output = textOf(message);
  const truncated = message.stop_reason === "max_tokens" ? "\n\n[Catatan: keluaran terpotong karena batas panjang.]" : "";
  return { ok: output.length > 0, output: (output || "(agent tidak menghasilkan teks)") + truncated, cost };
}

/**
 * Menjalankan satu tugas dari Rahula sampai selesai.
 * @param {string} task
 * @param {(event: object) => void} emit
 * @param {{agents: any[], leader: any, signal?: AbortSignal}} team
 * @returns {Promise<{final: string, workLog: any[], cost: number}>}
 */
export async function runTask(task, emit, { agents, leader, signal }) {
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const tools = [makeDelegateTool(agents)];
  const messages = [{ role: "user", content: task }];
  const workLog = [];
  let totalCost = 0;
  let callSeq = 0;
  let jsonRetries = 0;

  const addCost = (c) => {
    totalCost += c;
    emit({ type: "cost", usd: Number(totalCost.toFixed(4)) });
  };

  emit({ type: "leader_status", status: "thinking", text: "Membaca tugas…" });

  for (let turn = 0; turn < MAX_LEADER_TURNS; turn++) {
    let message;
    try {
      message = await streamOnce({
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
    addCost(costOf(message.usage));

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
          const r = await runWorker(agent, tu.input.instruksi, { emit, callId, signal });
          addCost(r.cost);
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
