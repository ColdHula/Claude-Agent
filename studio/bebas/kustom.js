// Tab "Kustom": tempat memasang layanan lain yang kompatibel dengan OpenAI (mis. Featherless, Together,
// layanan di uncensoredaiapis.com, dll.) tanpa menulis kode: isi URL, kunci, dan nama model di tab ini.
export default {
  id: "kustom",
  order: 90,
  tab: "Kustom",
  icon: "🧩",
  name: "Endpoint kustom",
  desc: "Isi sendiri URL dasar (…/v1), kunci, dan model dari layanan pilihan Anda. Studio tidak memeriksa layanan ini, jadi periksa sendiri kebijakan dan privasinya.",
  host: "sesuai isian Anda",
  model: "",
  window: 16_000,
  provider: {
    id: "bebas-kustom",
    kind: "openai",
    name: "Kustom (ruang terpisah)",
    baseUrl: "",
    envKey: "BEBAS_KUSTOM_KEY",
    needsKey: false,
    models: [],
  },
};
