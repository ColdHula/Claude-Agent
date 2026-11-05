// CONTOH untuk menambah satu AI baru. Salin menjadi <id>.js (nama berkas HARUS sama dengan id), isi, lalu restart Studio.
// Berkas berawalan "_" diabaikan. Tidak ada berkas lain yang perlu diubah.
//
// export default {
//   id: "contoh",                       // = nama berkas (contoh.js) dan nama folder arsip chat (arsip/ruang/contoh/)
//   tab: "Contoh", icon: "🧪",          // judul dan ikon tab
//   name: "Nama model",                 // nama yang tampil
//   desc: "Satu-dua kalimat tentang layanan ini.",
//   host: "contoh.com",                 // ke mana pesan dikirim (ditampilkan ke pengguna)
//   model: "nama-model-bawaan",
//   window: 32000,                      // jendela konteks (token) untuk pemadatan otomatis
//   provider: {
//     id: "bebas-contoh",               // HARUS "bebas-" + id
//     kind: "openai",                   // endpoint kompatibel OpenAI (/chat/completions, streaming)
//     name: "Contoh",
//     baseUrl: "https://api.contoh.com/v1",
//     envKey: "BEBAS_CONTOH_KEY",       // atau isi kunci di tab-nya
//     keyUrl: "https://contoh.com/keys",
//     needsKey: true,
//     models: ["nama-model-bawaan"],
//   },
// };
export default null;
