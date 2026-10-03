// Mesin "langganan": Pemimpin berjalan lewat Claude Agent SDK dengan login akun
// Claude (Pro/Max), sehingga pemakaiannya diambil dari kredit Agent SDK bulanan
// yang sudah termasuk dalam langganan — bukan dari API key berbayar.
// Event yang dikirim ke UI sama persis dengan src/orchestrator.js.
import fs from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { defaultModels } from "./orchestrator.js";

const LEADER_EFFORT = process.env.LEADER_EFFORT || "high";
const WORKER_EFFORT = process.env.WORKER_EFFORT || "medium";
// Rem pengaman per tugas (USD, perkiraan): tugas berhenti bila pemakaian mencapai angka ini.
const MAX_TASK_USD = Number(process.env.MAX_TASK_USD || 3);

const WORKER_APPENDIX = `

MODE TIM
Anda menerima tugas dari Pemimpin tim, bukan langsung dari Rahula, dan tidak bisa bertanya balik. Bila data kurang, jangan berhenti: kerjakan sejauh mungkin dengan asumsi wajar yang ditandai [ASUMSI] atau [ISI: ...], lalu tulis daftar "Pertanyaan untuk Rahula" di akhir. Serahkan hasil kerja final lengkap (bukan rencana). Jangan membaca atau menulis file.`;

const LEADER_APPENDIX = `

ALAT DELEGASI DI MODE INI
Alat delegasi bernama Agent. Isi subagent_type dengan id agent (mis. "surat-ba"), description dengan ringkasan tugas maksimal 8 kata, dan prompt dengan instruksi lengkap. Panggil beberapa Agent dalam satu giliran untuk tugas yang saling lepas. Jangan memakai alat lain selain Agent. Jawaban akhir Anda (teks setelah semua delegasi selesai) adalah hasil akhir untuk Rahula.`;

function textFromToolResult(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Pesan galat yang bisa dipahami Rahula, terutama soal kredit langganan.
function friendlyError(raw) {
  const msg = String(raw || "");
  if (/credit|billing|usage limit|spend|quota/i.test(msg)) {
    return "Kredit Agent SDK bulan ini habis atau belum diklaim. Klaim kredit di akun Claude Anda (sekali saja), atau tunggu kredit terisi ulang. Tidak ada biaya tambahan selama \"usage credits\" tidak diaktifkan.";
  }
  if (/auth|login|oauth|401|403/i.test(msg)) {
    return "Belum login ke akun Claude. Jalankan `claude` di terminal sekali, ketik /login, dan masuk dengan akun Claude (Pro/Max) Anda. Lalu jalankan ulang `npm start`.";
  }
  if (/rate.?limit|429|overloaded|529/i.test(msg)) {
    return "Batas pemakaian sementara tercapai atau server sedang penuh. Coba lagi beberapa menit lagi.";
  }
  return msg || "Terjadi galat yang tidak diketahui.";
}

/**
 * Sama seperti runTask di orchestrator.js, tetapi lewat Agent SDK + login langganan.
 * @param {string} task
 * @param {(event: object) => void} emit
 * @param {{agents: any[], leader: any, signal?: AbortSignal, models?: {leader: string, worker: string}}} team
 */
export async function runTaskSdk(task, emit, { agents, leader, signal, models = defaultModels() }) {
  const ids = new Set(agents.map((a) => a.id));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  const agentDefs = Object.fromEntries(
    agents.map((a) => [
      a.id,
      {
        description: a.description,
        prompt: a.system + WORKER_APPENDIX,
        tools: a.web ? ["WebSearch", "WebFetch"] : [],
        model: models.worker,
        effort: WORKER_EFFORT,
      },
    ]),
  );

  const abortController = new AbortController();
  if (signal) signal.addEventListener("abort", () => abortController.abort(), { once: true });

  // Pastikan memakai login langganan, bukan API key berbayar yang kebetulan ada di environment.
  // Subagent dijalankan di depan (bukan latar belakang) agar hasilnya kembali langsung ke Pemimpin.
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  };

  const q = query({
    prompt: task,
    options: {
      model: models.leader,
      effort: LEADER_EFFORT,
      systemPrompt: leader.system + LEADER_APPENDIX,
      agents: agentDefs,
      tools: ["Agent", "WebSearch", "WebFetch"],
      allowedTools: ["Agent", "WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      maxBudgetUsd: MAX_TASK_USD,
      abortController,
      env,
    },
  });

  const delegations = new Map(); // tool_use_id -> { agent, instruksi, chars }
  const pending = new Set();
  const workLog = [];
  const seenAgents = new Set();
  let cost = 0;

  const finish = (toolUseId, output, ok) => {
    if (!pending.has(toolUseId)) return;
    const d = delegations.get(toolUseId);
    pending.delete(toolUseId);
    const a = byId[d.agent];
    workLog.push({ agent: a.id, sim: a.sim, title: a.title, instruksi: d.instruksi, output });
    emit({ type: "worker_done", callId: toolUseId, agent: d.agent, ok, output });
    if (pending.size === 0) emit({ type: "review", count: workLog.length });
  };

  emit({ type: "leader_status", status: "thinking", text: "Membaca tugas…" });

  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") {
        if (m.apiKeySource && m.apiKeySource !== "none") {
          emit({ type: "leader_say", text: `Peringatan: kredensial dari ${m.apiKeySource}, bukan login langganan.` });
        }
        continue;
      }

      if (m.type === "assistant") {
        if (m.error) throw new Error(m.error);
        const blocks = m.message?.content ?? [];
        const parent = m.parent_tool_use_id;

        if (parent && delegations.has(parent)) {
          // Aktivitas agent di dalam subagent.
          const d = delegations.get(parent);
          for (const b of blocks) {
            if (b.type === "text") {
              d.chars += b.text.length;
              emit({ type: "worker_progress", callId: parent, agent: d.agent, chars: d.chars });
            } else if (b.type === "tool_use" && /web_?search/i.test(b.name)) {
              emit({ type: "worker_search", callId: parent, agent: d.agent, query: b.input?.query ?? "" });
            } else if (b.type === "thinking" && b.thinking) {
              emit({ type: "worker_thinking", callId: parent, agent: d.agent, text: b.thinking.slice(0, 400) });
            }
          }
          continue;
        }

        // Giliran Pemimpin.
        for (const b of blocks) {
          if (b.type === "thinking" && b.thinking) emit({ type: "leader_thinking", text: b.thinking.slice(0, 600) });
          else if (b.type === "text" && b.text.trim() && blocks.some((x) => x.type === "tool_use")) {
            emit({ type: "leader_say", text: b.text.trim().slice(0, 500) });
          } else if (b.type === "tool_use" && (b.name === "Agent" || b.name === "Task")) {
            const agent = b.input?.subagent_type;
            if (!ids.has(agent)) continue;
            const instruksi = String(b.input?.prompt ?? "");
            delegations.set(b.id, { agent, instruksi, chars: 0 });
            pending.add(b.id);
            emit({
              type: "delegate",
              callId: b.id,
              agent,
              summary: String(b.input?.description || byId[agent].title).slice(0, 80),
              instruksi,
              revision: seenAgents.has(agent),
            });
            seenAgents.add(agent);
          }
        }
        continue;
      }

      if (m.type === "user" && !m.parent_tool_use_id) {
        const content = Array.isArray(m.message?.content) ? m.message.content : [];
        for (const b of content) {
          if (b.type !== "tool_result" || !delegations.has(b.tool_use_id)) continue;
          const output = textFromToolResult(b.content);
          // Bila CLI tetap menjalankan agent di latar belakang, hasil aslinya datang lewat task_notification.
          if (/^Async agent launched|running in the background/i.test(output)) continue;
          finish(b.tool_use_id, output || "(agent tidak menghasilkan teks)", !b.is_error);
        }
        continue;
      }

      if (m.type === "system" && m.subtype === "task_notification" && m.tool_use_id && delegations.has(m.tool_use_id)) {
        let output = m.summary || "";
        if (m.output_file) output = (await fs.readFile(m.output_file, "utf8").catch(() => "")) || output;
        finish(m.tool_use_id, output || "(agent tidak menghasilkan teks)", m.status === "completed");
        continue;
      }

      if (m.type === "result") {
        cost = m.total_cost_usd ?? cost;
        emit({ type: "cost", usd: Number(cost.toFixed(4)) });
        if (m.subtype === "success" && !m.is_error) {
          emit({ type: "leader_status", status: "done", text: "Selesai!" });
          return { final: m.result || "(Pemimpin tidak menulis hasil akhir.)", workLog, cost };
        }
        if (m.subtype === "error_max_budget_usd") {
          throw new Error(`Rem pengaman tercapai: tugas ini sudah memakai sekitar $${MAX_TASK_USD} kredit. Naikkan MAX_TASK_USD di .env bila memang perlu.`);
        }
        if (m.subtype === "error_max_turns") throw new Error("Pemimpin terlalu banyak putaran tanpa selesai.");
        throw new Error(friendlyError(m.is_error && m.result ? m.result : (m.errors || []).join("; ")));
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(friendlyError(err?.message || err));
  }
  throw new Error("Sesi berakhir tanpa hasil akhir.");
}
