// Penyedia AI untuk Studio. Tiga golongan:
//   langganan — Claude lewat login akun (Claude Agent SDK), bisa membaca/mengubah file workspace;
//   gratis    — FreeLLMAPI (gabungan free tier banyak penyedia), Ollama lokal, model :free OpenRouter, dst.;
//   api       — API key berbayar: Anthropic, OpenAI, DeepSeek, OpenRouter, atau endpoint OpenAI-compatible lain.
// Semua penyedia non-Claude memakai format OpenAI-compatible (/v1/chat/completions), jadi cukup satu klien.
// Kunci API hanya ada di server (env atau studio/data/providers.json) dan tidak pernah dikirim ke browser.
import fs from "node:fs/promises";
import path from "node:path";

// Bawaan FreeLLMAPI adalah port 3001, tetapi di rig port itu dipakai HvM AI, jadi Studio
// menyarankan PORT=3011 untuk FreeLLMAPI. Bisa diubah di layar ⚙️ Penyedia atau lewat env.
export const FREELLMAPI_DEFAULT_URL = "http://127.0.0.1:3011/v1";

export const CATALOG = [
  {
    id: "langganan",
    kind: "claude-sdk",
    group: "langganan",
    name: "Claude (langganan Pro/Max)",
    note: "Login akun Claude, kredit Agent SDK bulanan. Bisa membaca & mengubah file workspace seperti Claude Code.",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    needsKey: false,
  },
  {
    id: "freellmapi",
    keyUrl: "https://github.com/tashfeenahmed/freellmapi",
    kind: "openai",
    group: "gratis",
    name: "FreeLLMAPI (gratis, banyak penyedia)",
    note: "Proxy self-hosted yang menggabungkan free tier Gemini, Groq, Cerebras, Mistral, OpenRouter, dll. Model 'auto' memilih sendiri.",
    baseUrl: FREELLMAPI_DEFAULT_URL,
    envUrl: "FREELLMAPI_URL",
    envKey: "FREELLMAPI_KEY",
    models: ["auto", "auto:smart", "auto:fast", "auto:reliable", "auto:balanced", "fusion"],
    needsKey: true,
  },
  {
    id: "ollama",
    keyUrl: "https://ollama.com/download",
    kind: "openai",
    group: "gratis",
    name: "Ollama (lokal di rig/laptop)",
    note: "Model di mesin sendiri. Privat, tanpa kuota.",
    baseUrl: "http://127.0.0.1:11434/v1",
    envUrl: "OLLAMA_OPENAI_URL",
    models: [],
    needsKey: false,
  },
  {
    id: "openrouter-free",
    keyUrl: "https://openrouter.ai/settings/keys",
    kind: "openai",
    group: "gratis",
    name: "OpenRouter (model :free)",
    note: "Akun OpenRouter gratis, hanya model berakhiran :free.",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    modelFilter: (id) => id.endsWith(":free"),
    models: [],
    needsKey: true,
  },
  {
    id: "gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    kind: "openai",
    group: "gratis",
    name: "Google Gemini (free tier)",
    note: "Kunci dari aistudio.google.com. Free tier punya batas per menit/hari.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    needsKey: true,
  },
  {
    id: "groq",
    keyUrl: "https://console.groq.com/keys",
    kind: "openai",
    group: "gratis",
    name: "Groq (free tier, sangat cepat)",
    note: "Kunci dari console.groq.com.",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    models: [],
    needsKey: true,
  },
  {
    id: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    kind: "anthropic",
    group: "api",
    name: "Anthropic API (berbayar)",
    note: "ANTHROPIC_API_KEY, ditagih per token terpisah dari langganan.",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    needsKey: true,
  },
  {
    id: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
    kind: "openai",
    group: "api",
    name: "OpenAI API (berbayar)",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    models: [],
    needsKey: true,
  },
  {
    id: "openrouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    kind: "openai",
    group: "api",
    name: "OpenRouter (semua model, berbayar)",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    models: [],
    needsKey: true,
  },
  {
    id: "deepseek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    kind: "openai",
    group: "api",
    name: "DeepSeek API (berbayar, murah)",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  {
    id: "custom",
    kind: "openai",
    group: "api",
    name: "Endpoint OpenAI-compatible lain",
    note: "LM Studio, vLLM, llama.cpp server, Together, Mistral, dll. Isi URL dan kunci sendiri.",
    baseUrl: "",
    models: [],
    needsKey: false,
  },
];

export function createProviders(dataDir) {
  const FILE = path.join(dataDir, "providers.json");
  let saved = {}; // id -> { baseUrl, apiKey, defaultModel }

  async function load() {
    saved = JSON.parse(await fs.readFile(FILE, "utf8").catch(() => "{}"));
  }
  async function persist() {
    await fs.writeFile(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }

  function resolve(id) {
    const c = CATALOG.find((p) => p.id === id);
    if (!c) throw new Error(`Penyedia tidak dikenal: ${id}`);
    const s = saved[id] || {};
    const baseUrl = (s.baseUrl || (c.envUrl && process.env[c.envUrl]) || c.baseUrl || "").replace(/\/+$/, "");
    const apiKey = s.apiKey || (c.envKey && process.env[c.envKey]) || "";
    return { ...c, baseUrl, apiKey, defaultModel: s.defaultModel || c.models[0] || "" };
  }

  // Untuk browser: tanpa kunci, hanya penanda sudah/belum diisi.
  function publicList() {
    return CATALOG.map((c) => {
      const r = resolve(c.id);
      return {
        id: c.id,
        group: c.group,
        kind: c.kind,
        name: c.name,
        note: c.note || "",
        baseUrl: r.baseUrl,
        editableUrl: c.kind === "openai",
        needsKey: c.needsKey,
        hasKey: Boolean(r.apiKey),
        keyFromEnv: Boolean(!saved[c.id]?.apiKey && c.envKey && process.env[c.envKey]),
        envKey: c.envKey || null,
        keyUrl: c.keyUrl || null,
        models: c.models,
        defaultModel: r.defaultModel,
        ready: c.kind === "claude-sdk" || ((!c.needsKey || r.apiKey) && (c.kind !== "openai" || Boolean(r.baseUrl))),
      };
    });
  }

  async function update(id, { baseUrl, apiKey, defaultModel }) {
    resolve(id); // validasi id
    const s = (saved[id] ||= {});
    if (typeof baseUrl === "string") s.baseUrl = baseUrl.trim();
    if (typeof apiKey === "string" && apiKey !== "••••") s.apiKey = apiKey.trim();
    if (typeof defaultModel === "string") s.defaultModel = defaultModel.trim();
    await persist();
  }

  function headers(p) {
    const h = { "content-type": "application/json" };
    if (p.apiKey) h.authorization = `Bearer ${p.apiKey}`;
    if (p.baseUrl.includes("openrouter.ai")) {
      h["http-referer"] = "http://localhost";
      h["x-title"] = "Studio";
    }
    return h;
  }

  async function listModels(id) {
    const p = resolve(id);
    if (p.kind !== "openai") return p.models;
    if (!p.baseUrl) return p.models;
    const qs = id === "freellmapi" ? "?available=true" : "";
    try {
      const r = await fetch(`${p.baseUrl}/models${qs}`, { headers: headers(p), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      let ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
      if (p.modelFilter) ids = ids.filter(p.modelFilter);
      ids.sort();
      return [...new Set([...p.models, ...ids])];
    } catch (e) {
      if (p.models.length) return p.models;
      throw new Error(`Tidak bisa mengambil daftar model dari ${p.baseUrl}: ${e.message}`);
    }
  }

  // Obrolan OpenAI-compatible dengan streaming. onDelta(text), onInfo({routedVia, usage}).
  async function chatOpenAI(id, { model, messages, signal, onDelta, onInfo, onReasoning }) {
    const p = resolve(id);
    if (!p.baseUrl) throw new Error(`URL ${p.name} belum diisi (⚙️ Penyedia).`);
    if (p.needsKey && !p.apiKey) throw new Error(`Kunci ${p.name} belum diisi (⚙️ Penyedia${p.envKey ? ` atau env ${p.envKey}` : ""}).`);
    const r = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(p),
      body: JSON.stringify({ model: model || p.defaultModel, messages, stream: true, stream_options: { include_usage: true } }),
      signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${p.name} menolak (HTTP ${r.status}): ${t.slice(0, 400)}`);
    }
    const routedVia = r.headers.get("x-routed-via");
    if (routedVia) onInfo?.({ routedVia });
    let buf = "";
    let full = "";
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        const d = j.choices?.[0]?.delta;
        const reasoning = d?.reasoning_content || d?.reasoning || "";
        if (reasoning && onReasoning) onReasoning(reasoning);
        const piece = d?.content || "";
        if (piece) {
          full += piece;
          onDelta(piece);
        }
        if (j.usage) onInfo?.({ usage: { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } });
        if (j.model && !routedVia) onInfo?.({ servedModel: j.model });
      }
    }
    return full;
  }

  return { load, resolve, publicList, update, listModels, chatOpenAI };
}
