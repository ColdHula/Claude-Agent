// Tab "Dolphin": Dolphin Mistral 24B (edisi Venice) lewat OpenRouter, gratis dengan jatah kecil.
// Kunci OpenRouter khusus tab ini (terpisah dari penyedia OpenRouter di ruang Utama).
export default {
  id: "dolphin",
  order: 10,
  tab: "Dolphin",
  icon: "🐬",
  name: "Dolphin Mistral 24B (edisi Venice)",
  desc: "Fine-tune Dolphin yang dikenal jarang menolak. Gratis lewat OpenRouter, tetapi jatahnya kecil (±20 permintaan/menit, ±50/hari) dan daftar model gratis sering berubah.",
  host: "OpenRouter (openrouter.ai)",
  model: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  window: 32_000,
  provider: {
    id: "bebas-dolphin",
    kind: "openai",
    name: "Dolphin (OpenRouter)",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "BEBAS_DOLPHIN_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
    needsKey: true,
    models: ["cognitivecomputations/dolphin-mistral-24b-venice-edition:free"],
    modelFilter: (id) => id.endsWith(":free") && /dolphin|venice|uncensor|abliterat|hermes/i.test(id),
  },
};
