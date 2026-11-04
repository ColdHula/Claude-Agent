// Proyek & pengetahuan (seperti "Projects" di claude.ai) + impor ekspor data claude.ai.
//
// Proyek: <ARSIP>/pengetahuan/<id>/ berisi _proyek.json (nama, deskripsi, instruksi) dan berkas pengetahuan.
// Chat yang memilih proyek otomatis mendapat instruksi + isi berkas proyek (dipotong agar muat; sisanya
// bisa dibaca Claude langganan lewat Read). Memori dari claude.ai disimpan di pengetahuan/_memori.md.
//
// Impor claude.ai: Settings → Privacy → Export data → unduh ZIP dari email → unggah ke Studio.
// ZIP berisi conversations.json, projects.json, users.json, dan (bila ada) memories.json.
// Impor bisa diulang: chat/proyek yang sama diperbarui, tidak dobel.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const KNOW_CHARS = Number(process.env.STUDIO_KNOWLEDGE_CHARS || 80_000);

export function createKnowledge(store) {
  const BASE = path.join(store.ARSIP, "pengetahuan");
  const MEMORY = path.join(BASE, "_memori.md");
  const slug = (s) => String(s || "proyek").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "proyek";
  const validId = (id) => /^[\w-]{1,80}$/.test(id || "");
  const dirOf = (id) => {
    if (!validId(id)) throw Object.assign(new Error("ID proyek tidak sah."), { status: 400 });
    return path.join(BASE, id);
  };
  const safeName = (n) => String(n || "berkas.txt").replace(/[\\/]/g, "_").replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").slice(-120) || "berkas.txt";

  async function list() {
    await fs.mkdir(BASE, { recursive: true });
    const out = [];
    for (const d of await fs.readdir(BASE, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const meta = JSON.parse(await fs.readFile(path.join(BASE, d.name, "_proyek.json"), "utf8").catch(() => "{}"));
      const files = [];
      for (const f of await fs.readdir(path.join(BASE, d.name)).catch(() => [])) {
        if (f === "_proyek.json") continue;
        const st = await fs.stat(path.join(BASE, d.name, f)).catch(() => null);
        if (st?.isFile()) files.push({ name: f, size: st.size });
      }
      out.push({ id: d.name, name: meta.name || d.name, description: meta.description || "", instructions: meta.instructions || "", source: meta.source || "studio", files, updatedAt: meta.updatedAt || 0 });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function save({ id, name, description = "", instructions = "", source = "studio", sourceId }) {
    id ||= `${slug(name)}-${crypto.randomBytes(3).toString("hex")}`;
    const dir = dirOf(id);
    await fs.mkdir(dir, { recursive: true });
    const prev = JSON.parse(await fs.readFile(path.join(dir, "_proyek.json"), "utf8").catch(() => "{}"));
    await fs.writeFile(path.join(dir, "_proyek.json"), JSON.stringify({ ...prev, name, description, instructions, source, sourceId: sourceId || prev.sourceId, updatedAt: Date.now() }, null, 2));
    return id;
  }
  async function addFile(id, name, buf) {
    const dir = dirOf(id);
    await fs.access(path.join(dir, "_proyek.json"));
    let fname = safeName(name);
    if (/\.pdf$/i.test(fname)) {
      // Simpan PDF + versi teksnya agar bisa dipakai semua penyedia.
      await fs.writeFile(path.join(dir, fname), buf);
      const tmp = path.join(os.tmpdir(), `studio-${crypto.randomBytes(4).toString("hex")}.pdf`);
      await fs.writeFile(tmp, buf);
      const txt = await run("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 50e6 }).then((r) => r.stdout, () => "");
      await fs.rm(tmp, { force: true });
      if (txt.trim()) await fs.writeFile(path.join(dir, fname.replace(/\.pdf$/i, ".pdf.txt")), txt);
    } else await fs.writeFile(path.join(dir, fname), buf);
    await touch(id);
    return fname;
  }
  async function removeFile(id, name) {
    await fs.rm(path.join(dirOf(id), safeName(name)), { force: true });
    await touch(id);
  }
  async function remove(id) {
    await fs.rm(dirOf(id), { recursive: true, force: true });
  }
  async function touch(id) {
    const f = path.join(dirOf(id), "_proyek.json");
    const m = JSON.parse(await fs.readFile(f, "utf8").catch(() => "{}"));
    m.updatedAt = Date.now();
    await fs.writeFile(f, JSON.stringify(m, null, 2));
  }

  // Teks konteks proyek untuk instruksi sistem.
  async function context(id) {
    if (!id) return { text: "", dir: null };
    const p = (await list()).find((x) => x.id === id);
    if (!p) return { text: "", dir: null };
    const dir = dirOf(id);
    let text = `\n\n<proyek nama="${p.name}">\n${p.description ? `Deskripsi: ${p.description}\n` : ""}${p.instructions ? `Instruksi proyek (ikuti):\n${p.instructions}\n` : ""}`;
    let used = text.length;
    const rest = [];
    const textual = p.files.filter((f) => !/\.(pdf|png|jpe?g|gif|webp|zip|xlsx?|docx?)$/i.test(f.name)).sort((a, b) => a.size - b.size);
    for (const f of textual) {
      const body = await fs.readFile(path.join(dir, f.name), "utf8").catch(() => "");
      if (used + body.length > KNOW_CHARS) {
        rest.push(f.name);
        continue;
      }
      text += `\n<dokumen nama="${f.name}">\n${body}\n</dokumen>\n`;
      used += body.length;
    }
    const others = p.files.filter((f) => !textual.includes(f)).map((f) => f.name);
    if (rest.length || others.length) text += `\nBerkas proyek lain (tidak ditempel; buka dengan Read bila bisa): ${[...rest, ...others].map((n) => path.join(dir, n)).join(", ")}\n`;
    text += "</proyek>";
    return { text, dir };
  }

  async function memory() {
    return (await fs.readFile(MEMORY, "utf8").catch(() => "")).trim();
  }
  async function setMemory(t) {
    await fs.mkdir(BASE, { recursive: true });
    await fs.writeFile(MEMORY, String(t || ""));
  }

  // ───────── impor ekspor claude.ai ─────────
  async function importClaudeAi(buf, filename = "") {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "studio-impor-"));
    try {
      const files = {};
      if (buf.subarray(0, 2).toString() === "PK") {
        const zip = path.join(tmp, "ekspor.zip");
        await fs.writeFile(zip, buf);
        const names = (await run("unzip", ["-Z1", zip], { maxBuffer: 50e6 })).stdout.split("\n").filter((n) => /(^|\/)(conversations|projects|users|memories)\.json$/.test(n));
        if (!names.length) throw new Error("ZIP ini bukan ekspor claude.ai (tidak ada conversations.json).");
        await run("unzip", ["-o", "-q", "-j", zip, ...names, "-d", tmp], { maxBuffer: 50e6 });
        for (const n of names) files[path.basename(n, ".json")] = JSON.parse(await fs.readFile(path.join(tmp, path.basename(n)), "utf8"));
      } else {
        const j = JSON.parse(buf.toString("utf8"));
        const kind = /project/i.test(filename) ? "projects" : /memor/i.test(filename) ? "memories" : "conversations";
        files[kind] = j;
      }
      const res = { chats: 0, updated: 0, messages: 0, projects: 0, projectFiles: 0, memory: false };

      // Proyek dulu, agar chat bisa ditautkan.
      const projByUuid = {};
      for (const p of Array.isArray(files.projects) ? files.projects : []) {
        if (!p?.uuid) continue;
        const existing = (await list()).find((x) => x.source === "claude.ai" && x.id.endsWith(p.uuid.slice(0, 8)));
        const id = existing?.id || `${slug(p.name)}-${p.uuid.slice(0, 8)}`;
        await save({ id, name: p.name || "Proyek", description: p.description || "", instructions: p.prompt_template || "", source: "claude.ai", sourceId: p.uuid });
        for (const d of p.docs || []) {
          if (!d?.content) continue;
          let n = safeName(d.filename || "dokumen.md");
          if (!/\.\w{1,5}$/.test(n)) n += ".md";
          await fs.writeFile(path.join(dirOf(id), n), d.content);
          res.projectFiles++;
        }
        projByUuid[p.uuid] = id;
        res.projects++;
      }

      // Memori (format bisa berbeda-beda antar versi ekspor → ambil semua teks).
      if (files.memories) {
        const parts = [];
        const walk = (v, key = "") => {
          if (typeof v === "string" && v.trim().length > 20) parts.push(key ? `## ${key}\n${v.trim()}` : v.trim());
          else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
          else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, projByUuid[k] ? `Proyek ${k}` : /memory/i.test(k) ? "" : k);
        };
        walk(files.memories);
        if (parts.length) {
          await setMemory(`# Memori dari claude.ai (diimpor ${new Date().toLocaleDateString("id-ID")})\n\n${parts.join("\n\n")}`);
          res.memory = true;
        }
      }

      // Percakapan.
      for (const c of Array.isArray(files.conversations) ? files.conversations : []) {
        if (!c?.uuid || !Array.isArray(c.chat_messages) || !c.chat_messages.length) continue;
        const messages = [];
        for (const m of c.chat_messages) {
          const blocks = Array.isArray(m.content) ? m.content : [];
          let text = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n\n") || m.text || "";
          const thinking = blocks.filter((b) => b.type === "thinking" && b.thinking).map((b) => b.thinking).join("\n\n");
          const steps = blocks.filter((b) => b.type === "tool_use").map((b) => ({ kind: "tool", name: b.name, label: `${b.name}${b.input?.query ? `(${b.input.query})` : b.input?.title ? `(${b.input.title})` : ""}` }));
          const docs = [...(m.attachments || []), ...(m.files || [])].map((a) => ({ name: a.file_name || a.name || "lampiran", content: a.extracted_content || "" }));
          const sent = docs.some((d) => d.content) ? text + docs.filter((d) => d.content).map((d) => `\n\n--- Lampiran: ${d.name} ---\n${d.content.slice(0, 100_000)}\n--- akhir ${d.name} ---`).join("") : undefined;
          if (!text && !docs.length && !steps.length) continue;
          const at = Date.parse(m.created_at) || Date.parse(c.created_at) || Date.now();
          if (m.sender === "human") messages.push({ role: "user", text, sent, docs: docs.length ? docs.map((d) => ({ name: d.name })) : undefined, at });
          else messages.push({ role: "assistant", text, thinking: thinking || undefined, steps: steps.length ? steps : undefined, at, provider: "claude.ai", model: c.model || "" });
          res.messages++;
        }
        if (!messages.length) continue;
        const id = `cai-${c.uuid}`;
        const prev = await store.read(id).catch(() => null);
        const s = {
          ...(prev || {}),
          id,
          title: c.name || messages[0].text.split("\n")[0].slice(0, 70) || "Chat claude.ai",
          createdAt: Date.parse(c.created_at) || Date.now(),
          updatedAt: Date.parse(c.updated_at) || Date.now(),
          origin: { source: "claude.ai", id: c.uuid },
          mode: "chat",
          project: (c.project_uuid && projByUuid[c.project_uuid]) || c.project?.uuid && projByUuid[c.project.uuid] || prev?.project,
          // Pertahankan lanjutan yang ditulis di Studio setelah impor sebelumnya.
          messages: prev && prev.messages.length > messages.length ? [...messages, ...prev.messages.slice(messages.length)] : messages,
          claudeSynced: 0,
        };
        if (s.project === undefined) delete s.project;
        await store.write(s, { keepTime: true });
        prev ? res.updated++ : res.chats++;
      }
      return res;
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  return { list, save, addFile, removeFile, remove, context, memory, setMemory, importClaudeAi, BASE };
}
