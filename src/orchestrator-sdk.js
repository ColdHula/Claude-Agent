// Mesin "langganan": Pemimpin berjalan lewat Claude Agent SDK dengan login akun
// Claude (Pro/Max), sehingga pemakaiannya diambil dari kredit Agent SDK bulanan
// yang sudah termasuk dalam langganan — bukan dari API key berbayar.
// Event yang dikirim ke UI sama persis dengan src/orchestrator.js.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { defaultModels } from "./orchestrator.js";

const LEADER_EFFORT = process.env.LEADER_EFFORT || "high";
const WORKER_EFFORT = process.env.WORKER_EFFORT || "medium";
// Rem pengaman per tugas (USD, perkiraan): tugas berhenti bila pemakaian mencapai angka ini.
const MAX_TASK_USD = Number(process.env.MAX_TASK_USD || 3);

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Agent yang boleh membaca/menulis file dan menjalankan skrip (generator DOCX/PDF, olah Excel/PDF).
export const FILE_AGENTS = new Set(["surat-ba", "data-rekap", "sop-k3-vendor"]);
const FILE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];

function fileAppendix(workDir, inputs) {
  const rel = path.relative(APP_ROOT, workDir);
  return `

RUANG KERJA FILE
- Folder kerja Anda (direktori saat ini = folder aplikasi): tulis SEMUA file hasil ke \`${rel}/\` (buat bila belum ada). Jangan menulis di tempat lain.
- Lampiran dari Rahula untuk tugas ini: ${inputs.length ? inputs.map((f) => `\`${rel}/masukan/${f}\``).join(", ") : "tidak ada"}.
- Berkas rujukan (template, generator, contoh dokumen jadi, sumber): \`pengetahuan/berkas/\` — HANYA DIBACA, jangan diubah. Untuk memakai generator, salin spec/kasus ke folder kerja atau pakai jalur absolut sesuai petunjuk di pengetahuan Anda.
- Alat tersedia: node (paket docx sudah ada lewat NODE_PATH), python3 (openpyxl, pypdf, fitz bila terpasang), soffice (DOCX→PDF), pdftoppm/pdftotext, ImageMagick.
- Dokumen formal: hasilkan DOCX + PDF, render ke gambar dan periksa sebelum selesai. Excel: hanya COUNTIF/COUNTIFS.
- Di akhir jawaban, tulis daftar "File hasil:" berisi nama file yang Anda buat di folder kerja.`;
}

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
export async function runTaskSdk(task, emit, { agents, leader, signal, models = defaultModels(), workDir, inputs = [] }) {
  const workRel = workDir ? path.relative(APP_ROOT, workDir) : null;
  const ids = new Set(agents.map((a) => a.id));
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));

  const agentDefs = Object.fromEntries(
    agents.map((a) => [
      a.id,
      {
        description: a.description,
        prompt:
          FILE_AGENTS.has(a.id) && workDir
            ? a.system + WORKER_APPENDIX.replace("Jangan membaca atau menulis file.", "") + fileAppendix(workDir, inputs)
            : a.system + WORKER_APPENDIX,
        tools: [...(a.web ? ["WebSearch", "WebFetch"] : []), ...(FILE_AGENTS.has(a.id) && workDir ? FILE_TOOLS : [])],
        maxTurns: FILE_AGENTS.has(a.id) ? 60 : 20,
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
    // Generator dokumen memakai require("docx") dari node_modules aplikasi.
    NODE_PATH: [path.join(APP_ROOT, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  };

  const leaderFiles = workDir
    ? `

FILE
- Lampiran dari Rahula: ${inputs.length ? inputs.map((f) => `${workRel}/masukan/${f}`).join(", ") : "tidak ada"}. Sebutkan lampiran yang relevan di instruksi delegasi.
- Agent yang bisa membaca/menulis file dan menjalankan generator: ${[...FILE_AGENTS].join(", ")}. Hasil file mereka tersimpan di ${workRel}/ dan otomatis muncul sebagai tautan unduhan untuk Rahula; di hasil akhir cukup sebutkan nama filenya.`
    : "";

  // Pagar file: Pemimpin hanya mendelegasikan; agent menulis hanya di folder tugas dan
  // membaca hanya di folder aplikasi (tanpa .env). Bash tidak bisa dipagari sepenuhnya,
  // jadi aturannya juga ditegaskan di instruksi agent.
  const inside = (p, dir) => {
    const r = path.relative(dir, path.resolve(APP_ROOT, String(p || ".")));
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  };
  const deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
  const fileGuard = async (input) => {
    const name = input.tool_name;
    if (!FILE_TOOLS.includes(name)) return {};
    if (!input.agent_id) return deny("Pemimpin tidak memakai alat file. Delegasikan ke agent.");
    const t = input.tool_input || {};
    if (["Write", "Edit"].includes(name) && !inside(t.file_path, workDir)) return deny(`Tulis file hanya di ${workRel}/.`);
    if (["Read", "Glob", "Grep"].includes(name)) {
      const target = t.file_path || t.path || APP_ROOT;
      if (!inside(target, APP_ROOT) || path.basename(String(target)) === ".env") return deny("Baca file hanya di dalam folder aplikasi (tanpa .env).");
    }
    return {};
  };

  const q = query({
    prompt: task,
    options: {
      model: models.leader,
      effort: LEADER_EFFORT,
      systemPrompt: leader.system + LEADER_APPENDIX + leaderFiles,
      agents: agentDefs,
      tools: ["Agent", "WebSearch", "WebFetch", ...(workDir ? FILE_TOOLS : [])],
      allowedTools: ["Agent", "WebSearch", "WebFetch", ...(workDir ? FILE_TOOLS : [])],
      cwd: APP_ROOT,
      ...(workDir ? { hooks: { PreToolUse: [{ hooks: [fileGuard] }] } } : {}),
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
