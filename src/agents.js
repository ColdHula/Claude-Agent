// Membaca instruksi agent dari .claude/agents/*.md (satu sumber kebenaran)
// dan menambahkan metadata tampilan untuk kantor bergaya The Sims.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Urutan di sini = urutan meja di kantor. id = nama file tanpa .md.
// Warna/meja juga dipakai public/index.html (mode demo menyalin daftar ini).
export const ROSTER = [
  { id: "surat-ba", sim: "Sari", title: "Surat & BA", icon: "📄", web: false },
  { id: "kepatuhan-perizinan", sim: "Dimas", title: "Kepatuhan & Perizinan", icon: "⚖️", web: true },
  { id: "data-rekap", sim: "Rina", title: "Data & Rekap", icon: "📊", web: false },
  { id: "sop-k3-vendor", sim: "Joko", title: "SOP, K3 & Vendor", icon: "🦺", web: false },
  { id: "email-kalender", sim: "Maya", title: "Email & Kalender", icon: "✉️", web: false },
  { id: "chrome-portal", sim: "Andi", title: "Chrome & Portal", icon: "🌐", web: false },
  { id: "cari-cuan", sim: "Budi", title: "Cari Cuan", icon: "💰", web: true },
  { id: "riset", sim: "Laras", title: "Riset", icon: "🔎", web: true },
];

export const LEADER = { id: "pemimpin", sim: "Bima", title: "Pemimpin", icon: "⭐" };

function parseAgentFile(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

export async function loadAgents() {
  const agents = [];
  for (const r of ROSTER) {
    const file = path.join(root, ".claude", "agents", `${r.id}.md`);
    const { meta, body } = parseAgentFile(await fs.readFile(file, "utf8"));
    agents.push({ ...r, description: meta.description ?? r.title, system: body });
  }
  const leaderTemplate = await fs.readFile(path.join(root, "prompts", "pemimpin.md"), "utf8");
  const daftar = agents
    .map((a) => `- ${a.id} (${a.sim}, ${a.title}): ${a.description}`)
    .join("\n");
  const leader = { ...LEADER, system: leaderTemplate.replace("{{DAFTAR_AGENT}}", daftar) };
  return { agents, leader };
}
