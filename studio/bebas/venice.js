// Tab "Venice": Venice AI (venice-uncensored). Akun gratis di web terbatas; akses API memakai kredit/Pro.
export default {
  id: "venice",
  order: 20,
  tab: "Venice",
  icon: "🏛️",
  name: "Venice Uncensored",
  desc: "Layanan yang menonjolkan privasi dan penolakan minim. Akses API memakai kredit atau paket Pro; moderasi pada akun gratis mungkin diperketat, jadi cek kebijakan terbarunya.",
  host: "Venice AI (venice.ai)",
  model: "venice-uncensored",
  window: 32_000,
  provider: {
    id: "bebas-venice",
    kind: "openai",
    name: "Venice (ruang terpisah)",
    baseUrl: "https://api.venice.ai/api/v1",
    envKey: "BEBAS_VENICE_KEY",
    keyUrl: "https://venice.ai/settings/api",
    needsKey: true,
    models: ["venice-uncensored"],
  },
};
