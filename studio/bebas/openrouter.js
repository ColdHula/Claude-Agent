// Tab "OpenRouter": SATU kunci OpenRouter untuk banyak model. Daftar model dibaca langsung dari OpenRouter
// (tidak ditulis mati di sini) dan disaring dari nama model yang umum jarang menolak. Model lain tetap bisa
// dipakai dengan mengetik id-nya di pengaturan tab. Kunci dibagi dengan penyedia OpenRouter lain (keyGroup).
export default {
  id: "openrouter",
  order: 15,
  tab: "OpenRouter",
  icon: "🌐",
  name: "OpenRouter: banyak model, satu kunci",
  desc: "Satu kunci OpenRouter membuka banyak model sekaligus. Daftarnya diambil langsung dari OpenRouter dan disaring dari nama model yang umum jarang menolak (Dolphin, Hermes, Venice, abliterated, dll). Itu hanya tebakan dari nama; kebijakan tiap model berbeda. Model berakhiran :free gratis dengan jatah kecil; model lain memakai saldo OpenRouter Anda (prabayar).",
  host: "OpenRouter (openrouter.ai)",
  model: "cognitivecomputations/dolphin-mistral-24b-venice-edition",
  window: 32_000,
  provider: {
    id: "bebas-openrouter",
    kind: "openai",
    name: "OpenRouter (ruang terpisah)",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    keyGroup: "openrouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    needsKey: true,
    models: ["cognitivecomputations/dolphin-mistral-24b-venice-edition", "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"],
    modelFilter: (id) => /dolphin|hermes|venice|uncensor|abliterat|lumimaid|noromaid|euryale|magnum|mythomax/i.test(id),
  },
};
