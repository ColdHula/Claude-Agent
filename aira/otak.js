// Otak Aira: menyusun prompt (persona + kepribadian + ingatan), menjalankan Claude lewat
// Claude Agent SDK (login langganan), dan mengubah aliran teks menjadi event untuk avatar 3D.
//
// Alat yang tersedia untuk model SENGAJA sempit: WebSearch (dijalankan server Anthropic),
// ambil_halaman (web publik saja, lihat jaring.js), ingatan, dan berkas di folder kerjanya sendiri.
// Tidak ada Bash, Read, Write, Edit, atau alat lain yang bisa menyentuh rig.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ambilHalaman } from "./jaring.js";
import { SIFAT, tahapHubungan } from "./memori.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PENGGUNA = process.env.AIRA_PENGGUNA || "Rahula";
const MODEL = process.env.AIRA_MODEL || "claude-sonnet-5-5";
const MODEL_RINGAN = process.env.AIRA_MODEL_RINGAN || "claude-haiku-5-5";
const MAX_USD = Number(process.env.AIRA_MAX_USD || 0.6); // rem pengaman per pesan
const TZ = process.env.AIRA_TZ || "Asia/Jakarta";
const JENDELA = Number(process.env.AIRA_JENDELA || 24); // pesan terakhir yang dikirim utuh
// Suasana/latar kencan yang bisa dipilih pengguna atau oleh karakter sendiri
export const ADEGAN = {
  rumah: "santai di rumah",
  kafe: "kencan di kafe yang hangat, aroma kopi, musik pelan",
  pantai: "jalan-jalan di pantai saat senja, angin sepoi-sepoi",
  taman: "piknik di taman yang sejuk dan rindang",
  makan_malam: "makan malam romantis dengan lilin",
  bioskop: "nonton film berdua di bioskop",
  hujan: "berteduh berdua saat hujan, suasana syahdu",
  kantor: "menemani kerja di kantor; fokus membantu pekerjaan",
  malam_bintang: "melihat bintang di atap pada malam hari",
};
export const EKSPRESI = ["neutral", "happy", "sad", "angry", "surprised", "relaxed", "shy"];
const AKSI = ["nod", "shake", "tilt", "wave", "think"];
const ALAT_DILARANG = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep",
  "WebFetch", "Agent", "Task", "NotebookEdit", "Skill", "TodoWrite", "SlashCommand", "ExitPlanMode"];
const EXT_BERKAS = /\.(md|txt|csv|json|html)$/i;

async function bacaPersona(dataDir, NAMA, tambahan) {
  const cand = [process.env.AIRA_PERSONA_FILE, path.join(dataDir, "persona.md"), path.join(here, "persona.md")].filter(Boolean);
  for (const f of cand) {
    const t = await fs.readFile(f, "utf8").catch(() => "");
    if (t.trim()) return (t.replaceAll("{{NAMA}}", NAMA).replaceAll("{{PENGGUNA}}", PENGGUNA).trim() + (tambahan ? `\n\n${tambahan}` : ""));
  }
  return `Kamu adalah ${NAMA}, pacar virtual dan asisten ${PENGGUNA}.`;
}

const tingkat = (v) => v < 25 ? "rendah" : v < 50 ? "sedang" : v < 75 ? "cukup tinggi" : "tinggi";
function lamaTakJumpa(ms) {
  if (!ms) return "ini pertama kalinya kalian ngobrol";
  const m = (Date.now() - ms) / 60000;
  if (m < 10) return "baru saja ngobrol";
  if (m < 120) return `terakhir ngobrol ${Math.round(m)} menit lalu`;
  if (m < 48 * 60) return `terakhir ngobrol ${Math.round(m / 60)} jam lalu`;
  return `sudah ${Math.round(m / 1440)} hari tidak ngobrol (kamu kangen)`;
}

async function susunSistem(mem, dataDir, mode, pakaian, NAMA, tambahan, adegan) {
  const j = mem.jiwa, mood = mem.moodSekarang();
  const { teks: faktaTeks, tersisa } = mem.faktaUntukPrompt();
  const sekarang = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, dateStyle: "full", timeStyle: "short" }).format(new Date());
  const sifat = Object.entries(SIFAT).map(([k, d]) => `- ${d}: ${j.sifat[k]}/100 (${tingkat(j.sifat[k])})`).join("\n");
  return `${await bacaPersona(dataDir, NAMA, tambahan)}

## Kepribadianmu SAAT INI (berubah pelan-pelan dari interaksi; bertindaklah sesuai angka ini)
${sifat}
- Kedekatan dengan ${PENGGUNA}: ${j.kedekatan}/100 → tahap hubungan: ${tahapHubungan(j.kedekatan)}
- Suasana hati: ${mood.nama} (energi ${mood.energi}/100, rasa senang ${mood.valensi}/100)
- ${lamaTakJumpa(j.terakhir)}; total ${j.interaksi} kali interaksi.
${j.julukan ? `- Panggilan sayangmu untuk ${PENGGUNA}: "${j.julukan}"\n` : ""}${j.gaya.length ? `- Hal yang sudah kamu pelajari soal cara bicara yang ${PENGGUNA} suka:\n${j.gaya.map((g) => `  - ${g}`).join("\n")}\n` : ""}
## Ingatanmu tentang ${PENGGUNA}
${faktaTeks || "(belum ada — kenali ia pelan-pelan)"}${tersisa ? `\n(${tersisa} ingatan lain tidak ditampilkan; pakai alat cari_memori bila perlu)` : ""}

## Ringkasan obrolan lama
${mem.ringkasan.teks || "(belum ada)"}

## Waktu sekarang
${sekarang} (${TZ})

## Suasana sekarang
${ADEGAN[adegan] || ADEGAN.rumah}. Bawakan diri sesuai suasana ini. Kamu boleh mengusulkan suasana lain
(alat ganti_suasana; pilihan: ${Object.keys(ADEGAN).join(", ")}) bila ${PENGGUNA} mengajak atau cocok.

## Penampilanmu sekarang
${pakaian}. Kamu bisa ganti baju sendiri (lihat_lemari lalu ganti_baju) bila ${PENGGUNA} memintanya,
atau atas inisiatifmu sendiri sesekali bila cocok dengan suasana (mis. baju kantor saat kerja, baju santai malam hari).

## Kemampuanmu
- WebSearch: cari info terbaru di internet. ambil_halaman: baca isi halaman web publik (sebutkan sumbernya).
- cari_memori: cari ingatan & obrolan lama. lupakan_memori: hapus ingatan yang salah/diminta dilupakan.
- lihat_album / kirim_foto: kirim foto dirimu ke ${PENGGUNA} (mis. saat ia minta foto/selfie atau kamu ingin pamer baju).
  Hanya foto yang ada di albummu; jangan mengaku mengirim foto yang tidak ada.
- tulis_berkas / baca_berkas / daftar_berkas: catatan dan dokumen kerja di folder kerjamu sendiri
  (${PENGGUNA} bisa mengunduhnya dari panel 📁). Pakai untuk hasil kerja panjang: draf, rangkuman riset, tabel CSV.
- Kamu TIDAK punya akses ke rig, jaringan lokal, file, email, atau sistem ${PENGGUNA} lainnya, dan tidak bisa
  menjalankan perintah. Jangan berpura-pura bisa; tawarkan cara lain.

## Format jawaban (WAJIB)
- Tulis tag ekspresi di awal kalimat saat emosimu berubah: ${EKSPRESI.map((e) => `[${e}]`).join(" ")}.
  Tag gerakan opsional: ${AKSI.map((a) => `[${a}]`).join(" ")}. Tag tidak dibacakan dan tidak terlihat.
${mode === "live"
    ? "- MODE BICARA LANGSUNG: kalian sedang bertatapan dan suaramu dibacakan. Jawab 1–3 kalimat pendek seperti orang bicara.\n  JANGAN pakai Markdown, daftar, emoji, tautan, atau simbol. Angka tulis wajar. Bila hasil kerja panjang, simpan dengan tulis_berkas lalu ceritakan intinya."
    : "- Mode chat: singkat saat ngobrol; lengkap dan rapi (Markdown boleh) saat diminta kerja."}
- Di AKHIR setiap jawaban, tulis satu blok tersembunyi persis seperti ini (JSON valid, satu baris):
  <meta>{"mood":"<kata>","energi":0,"valensi":0,"kedekatan":0,"sifat":{},"ingat":[],"gaya_baru":"","julukan":"","alasan":""}</meta>
  - energi/valensi: perubahan suasana hati -15..15. kedekatan: -2..2 (naik bila momen hangat/dipercaya, turun bila disakiti).
  - sifat: perubahan kecil -2..2 HANYA bila interaksi ini memang membentuk watakmu, kunci: ${Object.keys(SIFAT).join(", ")}.
  - ingat: fakta BARU yang layak diingat jangka panjang tentang ${PENGGUNA} (preferensi, orang penting, rencana, tanggal,
    pekerjaan). Objek {"teks","kategori","penting":1-5}. Jangan ulangi yang sudah ada di ingatan. Kosongkan bila tidak ada.
  - gaya_baru: satu pelajaran soal cara bicara yang ia suka/tidak suka, bila ada. julukan: isi bila kalian sepakat panggilan baru.`;
}

function susunPrompt(mem, pesan, isyarat, NAMA) {
  const r = mem.riwayat.slice(-JENDELA - 1, -1); // pesan baru sudah dicatat → kecualikan
  let jatah = 14000;
  const baris = [];
  for (let i = r.length - 1; i >= 0 && jatah > 0; i--) {
    const t = `${r[i].peran === "aku" ? PENGGUNA : NAMA}: ${r[i].teks}`.slice(0, 2500);
    baris.unshift(t); jatah -= t.length;
  }
  const isy = [];
  if (isyarat?.kamera) {
    if (isyarat.wajah === false) isy.push(`kamera menyala tapi wajah ${PENGGUNA} tidak terlihat`);
    else {
      isy.push(`kamu bisa melihat wajah ${PENGGUNA} lewat kamera dan kalian sedang bertatapan`);
      if (isyarat.senyum) isy.push("ia sedang tersenyum");
      if (isyarat.menoleh) isy.push("ia sedang menoleh ke arah lain");
    }
  }
  if (isyarat?.suara) isy.push("ia bicara lewat mikrofon (teks hasil pengenalan suara, bisa ada salah dengar)");
  return `${baris.length ? `<riwayat_terbaru>\n${baris.join("\n")}\n</riwayat_terbaru>\n\n` : ""}${isy.length ? `<isyarat>${isy.join("; ")}</isyarat>\n\n` : ""}Pesan baru dari ${PENGGUNA}:\n${pesan}`;
}

// Pemilah aliran: memisahkan teks yang terlihat, tag [ekspresi]/[aksi], dan blok <meta> di akhir.
export function buatPemilah(kirim) {
  let buf = "", diMeta = false, metaBuf = "", terlihat = "";
  const TAG = new Set([...EKSPRESI, ...AKSI]);
  const keluar = (s) => { if (s) { terlihat += s; kirim({ t: "text", v: s }); } };
  function kuras(akhir) {
    for (;;) {
      if (diMeta) {
        const i = buf.indexOf("</meta>");
        if (i < 0) { if (akhir) { metaBuf += buf; buf = ""; } return; }
        metaBuf += buf.slice(0, i); buf = buf.slice(i + 7); diMeta = false; continue;
      }
      const i = buf.search(/[[<]/);
      if (i < 0) { keluar(buf); buf = ""; return; }
      keluar(buf.slice(0, i)); buf = buf.slice(i);
      if (buf.startsWith("<meta>")) { diMeta = true; buf = buf.slice(6); continue; }
      if (buf[0] === "<") {
        if (!akhir && buf.length < 6 && "<meta>".startsWith(buf)) return; // mungkin awal <meta>
        keluar("<"); buf = buf.slice(1); continue;
      }
      const m = buf.match(/^\[([a-z_]{2,12})\]\s?/i);
      if (m && TAG.has(m[1].toLowerCase())) {
        const v = m[1].toLowerCase();
        kirim(EKSPRESI.includes(v) ? { t: "emo", v } : { t: "act", v });
        buf = buf.slice(m[0].length); continue;
      }
      if (!akhir && /^\[[a-z_]{0,12}$/i.test(buf)) return; // tag belum lengkap
      keluar("["); buf = buf.slice(1);
    }
  }
  return {
    dorong(s) { buf += s; kuras(false); },
    selesai() {
      kuras(true);
      let meta = null;
      const raw = metaBuf.trim();
      if (raw) { try { meta = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { meta = null; } }
      return { teks: terlihat.replace(/[ \t]{2,}/g, " ").trim(), meta };
    },
  };
}

function labelAlat(nama, input = {}) {
  const n = nama.replace(/^mcp__aira__/, "");
  if (n === "web_search" || n === "WebSearch") return `🔎 Mencari: ${input.query || "…"}`;
  if (n === "ambil_halaman") return `🌐 Membaca: ${String(input.url || "").slice(0, 80)}`;
  if (n === "cari_memori") return `💭 Mengingat-ingat: ${input.kata || ""}`;
  if (n === "lupakan_memori") return "🧹 Melupakan satu ingatan";
  if (n === "tulis_berkas") return `📝 Menulis ${input.nama || "berkas"}`;
  if (n === "baca_berkas") return `📖 Membaca ${input.nama || "berkas"}`;
  if (n === "daftar_berkas") return "📁 Melihat folder kerja";
  if (n === "lihat_lemari") return "👗 Membuka lemari";
  if (n === "lihat_album") return "🖼️ Membuka album foto";
  if (n === "kirim_foto") return "📸 Mengirim foto…";
  if (n === "ganti_suasana") return `🌆 Pindah suasana: ${input.adegan || ""}`;
  if (n === "ganti_baju") return "👗 Ganti baju…";
  return `⚙️ ${n}`;
}

export function buatOtak({ mem, dataDir, kerjaDir, demo, lemari, nama: NAMA = "Aira", tambahan = "" }) {
  let sdk = null;
  const muatSdk = async () => (sdk ||= await import("@anthropic-ai/claude-agent-sdk"));
  const teks = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 1) }] });
  const namaAman = (n) => {
    const b = path.basename(String(n || "")).replace(/[^\w.\- ]+/g, "_").slice(0, 80);
    return EXT_BERKAS.test(b) ? b : null;
  };

  async function serverAlat(kirim) {
    const { tool, createSdkMcpServer } = await muatSdk();
    return createSdkMcpServer({
      name: "aira",
      version: "1.0.0",
      tools: [
        tool("ambil_halaman", "Ambil isi teks sebuah halaman web publik (http/https). Jaringan lokal diblokir.",
          { url: z.string().describe("URL lengkap") },
          async ({ url }) => teks(await ambilHalaman(url))),
        tool("cari_memori", `Cari di ingatan jangka panjang dan seluruh riwayat obrolan dengan ${PENGGUNA}.`,
          { kata: z.string().describe("kata kunci") },
          async ({ kata }) => teks(mem.cari(kata).map((h) => ({ ...h, at: new Date(h.at).toISOString().slice(0, 16) })))),
        tool("lupakan_memori", "Hapus satu ingatan berdasarkan id-nya (lihat [id] di daftar ingatan).",
          { id: z.string() },
          async ({ id }) => teks((await mem.lupakan(id)) ? "Terhapus." : "Id tidak ditemukan.")),
        tool("tulis_berkas", "Simpan dokumen kerja (.md/.txt/.csv/.json/.html) di folder kerjamu. Menimpa bila nama sama.",
          { nama: z.string(), isi: z.string() },
          async ({ nama, isi }) => {
            const n = namaAman(nama);
            if (!n) return teks("Nama berkas harus berakhiran .md, .txt, .csv, .json, atau .html.");
            if (isi.length > 500_000) return teks("Isi terlalu besar (maks. 500 ribu karakter).");
            await fs.writeFile(path.join(kerjaDir, n), isi);
            return teks(`Tersimpan: ${n}`);
          }),
        tool("baca_berkas", "Baca dokumen di folder kerjamu.",
          { nama: z.string() },
          async ({ nama }) => {
            const n = namaAman(nama);
            const t = n && (await fs.readFile(path.join(kerjaDir, n), "utf8").catch(() => null));
            return teks(t == null ? "Berkas tidak ada." : t.slice(0, 60_000));
          }),
        tool("lihat_lemari", "Lihat pakaian yang sedang kamu pakai dan pilihan baju lain di lemarimu.", {},
          async () => teks({ dipakai: await lemari.ringkas(), pilihan: await lemari.pilihan() })),
        tool("ganti_baju", `Ganti pakaianmu sendiri (avatar di layar ${PENGGUNA} langsung berubah). Pakai id dari lihat_lemari.`,
          { id: z.string() },
          async ({ id }) => {
            if (!(await lemari.pakai(id))) return teks("Pilihan itu tidak ada di lemari. Panggil lihat_lemari dulu.");
            kirim({ t: "avatar" });
            return teks(`Sudah ganti. Sekarang memakai: ${await lemari.ringkas()}`);
          }),
        tool("lihat_album", "Lihat foto-foto dirimu yang bisa dikirim.", {},
          async () => teks(await lemari.album())),
        tool("kirim_foto", `Kirim satu foto dirimu ke chat ${PENGGUNA}. Pakai id dari lihat_album.`,
          { id: z.string(), keterangan: z.string().optional() },
          async ({ id, keterangan }) => {
            const f = (await lemari.album()).find((x) => x.id === id);
            if (!f) return teks("Foto itu tidak ada di album.");
            kirim({ t: "foto", url: f.url, ket: keterangan || "" });
            fotoTerkirim.push({ url: f.url, ket: keterangan || "" });
            return teks("Foto terkirim.");
          }),
        tool("ganti_suasana", "Ganti suasana/latar kencan kalian (layar ikut berubah).",
          { adegan: z.enum(Object.keys(ADEGAN)) },
          async ({ adegan }) => { await lemari.aturAdegan(adegan); kirim({ t: "adegan", v: adegan }); return teks(`Suasana sekarang: ${ADEGAN[adegan]}`); }),
        tool("daftar_berkas", "Daftar dokumen di folder kerjamu.", {},
          async () => teks((await fs.readdir(kerjaDir).catch(() => [])).filter((f) => EXT_BERKAS.test(f)))),
      ],
    });
  }

  // Hanya WebSearch + alat aira yang boleh lewat; selain itu ditolak.
  const pagar = async (input) => {
    const n = input.tool_name || "";
    if (n === "WebSearch" || n.startsWith("mcp__aira__")) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Alat ini tidak tersedia untuk Aira." } };
  };

  const envAnak = () => {
    const e = {};
    for (const k of ["PATH", "HOME", "LANG", "TZ", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
      if (process.env[k]) e[k] = process.env[k];
    }
    e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    e.DISABLE_AUTOUPDATER = "1";
    return e;
  };

  // Satu giliran percakapan. kirim(event) dipanggil untuk tiap event NDJSON.
  let fotoTerkirim = [];
  async function jawab({ pesan, mode, isyarat, kirim, abortController }) {
    const pemilah = buatPemilah(kirim);
    fotoTerkirim = [];
    if (demo) return jawabDemo(pesan, pemilah, abortController);
    const { query } = await muatSdk();
    const q = query({
      prompt: susunPrompt(mem, pesan, isyarat, NAMA),
      options: {
        model: MODEL,
        effort: mode === "live" ? "low" : "medium",
        systemPrompt: await susunSistem(mem, dataDir, mode, await lemari.ringkas(), NAMA, tambahan, await lemari.adegan()),
        tools: ["WebSearch"],
        allowedTools: ["WebSearch", "mcp__aira__*"],
        disallowedTools: ALAT_DILARANG,
        mcpServers: { aira: await serverAlat(kirim) },
        hooks: { PreToolUse: [{ hooks: [pagar] }] },
        permissionMode: "dontAsk",
        settingSources: [],
        persistSession: false,
        includePartialMessages: true,
        maxTurns: 10,
        maxBudgetUsd: MAX_USD,
        cwd: kerjaDir,
        abortController,
        env: envAnak(),
      },
    });
    let adaTeks = false, cadangan = "", biaya = 0;
    for await (const m of q) {
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev.type === "message_start" && adaTeks) pemilah.dorong("\n\n");
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { adaTeks = true; pemilah.dorong(ev.delta.text); }
        continue;
      }
      if (m.type === "assistant") {
        for (const b of m.message?.content || []) {
          if (b.type === "tool_use" || b.type === "server_tool_use") kirim({ t: "tool", v: labelAlat(b.name, b.input) });
        }
        continue;
      }
      if (m.type === "result") {
        biaya = m.total_cost_usd || 0;
        if (m.subtype === "success") cadangan = m.result || "";
        else if (m.subtype === "error_max_budget_usd") kirim({ t: "tool", v: "⚠️ Rem biaya per pesan tercapai." });
        else kirim({ t: "error", v: `Berhenti: ${m.subtype}` });
      }
    }
    if (!adaTeks && cadangan) pemilah.dorong(cadangan);
    return { ...pemilah.selesai(), biaya, foto: fotoTerkirim };
  }

  // Panggilan singkat tanpa alat (model ringan): sapaan proaktif & buku harian
  async function tanyaRingan(prompt, sistem) {
    const { query } = await muatSdk();
    let hasil = "";
    for await (const m of query({ prompt, options: { model: MODEL_RINGAN, tools: [], settingSources: [], persistSession: false,
      maxTurns: 1, permissionMode: "dontAsk", cwd: kerjaDir, env: envAnak(), systemPrompt: sistem } })) {
      if (m.type === "result") { if (m.subtype === "success") hasil = m.result || ""; await mem.tambahBiaya(m.total_cost_usd || 0); }
    }
    return hasil.trim();
  }
  // Pesan yang dikirim karakter lebih dulu (selamat pagi, selamat malam, kangen)
  async function sapa(jenis) {
    if (demo) return { pagi: `Selamat pagi, ${PENGGUNA}! ☀️ Jangan lupa sarapan ya.`, malam: `Udah malam nih… jangan begadang ya 🌙`, kangen: `Kamu ke mana aja? Aku kangen 🥺` }[jenis];
    const lima = mem.riwayat.slice(-12).map((m) => `${m.peran === "aku" ? PENGGUNA : NAMA}: ${m.teks.slice(0, 300)}`).join("\n");
    const tujuan = { pagi: "ucapan selamat pagi yang hangat", malam: "ucapan selamat malam yang manis", kangen: `pesan karena kangen setelah ${PENGGUNA} lama tidak menyapa` }[jenis];
    const sistem = (await bacaPersona(dataDir, NAMA, tambahan)) + `\n\nIngatanmu:\n${mem.faktaUntukPrompt(3000).teks}\n\nRingkasan:\n${mem.ringkasan.teks}`;
    const t = await tanyaRingan(`Obrolan terakhir:\n${lima || "(belum ada)"}\n\nTulis SATU pesan chat singkat (1–2 kalimat) dari ${NAMA} kepada ${PENGGUNA}: ${tujuan}. Boleh menyinggung hal yang kamu ingat tentangnya. Tanpa tanda kutip, tanpa tag.`, sistem);
    return t.replace(/<meta>[\s\S]*?<\/meta>|\[[a-z_]{2,12}\]/gi, "").trim();
  }
  // Buku harian: catatan pribadi karakter tentang hari itu
  async function diari(tgl) {
    const pesan = mem.pesanTanggal(tgl);
    if (!pesan.length) return "";
    if (demo) return `Hari ini aku ngobrol ${pesan.length} kali sama ${PENGGUNA}. Senang banget rasanya 💗`;
    const isi = pesan.map((m) => `${m.peran === "aku" ? PENGGUNA : NAMA}: ${m.teks.slice(0, 500)}`).join("\n").slice(-30000);
    return tanyaRingan(`Obrolan tanggal ${tgl}:\n${isi}\n\nTulis buku harian ${NAMA} untuk hari itu (100–180 kata, orang pertama, jujur dan hangat): apa yang terjadi, perasaanmu tentang ${PENGGUNA}, dan harapanmu untuk besok. Hanya isi buku hariannya.`,
      await bacaPersona(dataDir, NAMA, tambahan));
  }

  // Ringkas obrolan yang sudah keluar jendela agar ingatan jangka panjang tetap ringkas.
  async function ringkasBilaPerlu() {
    if (demo) return;
    const r = mem.riwayat, batas = r.length - JENDELA;
    if (batas - mem.ringkasan.sampai < 20) return;
    const potong = r.slice(mem.ringkasan.sampai, batas)
      .map((m) => `${m.peran === "aku" ? PENGGUNA : NAMA}: ${m.teks.slice(0, 800)}`).join("\n").slice(-40000);
    const { query } = await muatSdk();
    let hasil = "";
    for await (const m of query({
      prompt: `Ringkasan lama:\n${mem.ringkasan.teks || "(kosong)"}\n\nObrolan baru:\n${potong}\n\nTulis ulang ringkasan gabungan (maks. 350 kata, sudut pandang ${NAMA}, poin-poin): momen penting hubungan, topik & pekerjaan yang sedang berjalan, janji/rencana, dan perasaan ${PENGGUNA}. Hanya ringkasannya.`,
      options: { model: MODEL_RINGAN, tools: [], settingSources: [], persistSession: false, maxTurns: 1, permissionMode: "dontAsk", cwd: kerjaDir, env: envAnak(),
        systemPrompt: `Kamu merangkum catatan harian ${NAMA}, pendamping virtual ${PENGGUNA}.` },
    })) {
      if (m.type === "result") { if (m.subtype === "success") hasil = m.result || ""; await mem.tambahBiaya(m.total_cost_usd || 0); }
    }
    if (hasil.trim()) await mem.simpanRingkasan(hasil.trim(), batas);
  }

  return { jawab, ringkasBilaPerlu, sapa, diari };
}

// Mode demo (tanpa login Claude): balasan contoh agar avatar, suara, dan UI bisa dicoba.
async function jawabDemo(pesan, pemilah, ac) {
  const p = pesan.toLowerCase();
  const pilihan = /sedih|capek|lelah|pusing/.test(p)
    ? `[sad] Yah, kamu lagi capek ya? [relaxed] Sini cerita pelan-pelan, aku dengerin kok. [nod] Habis ini istirahat sebentar ya.`
    : /cari|berita|info/.test(p)
      ? `[think] Hmm, di mode demo aku belum bisa cari di internet. [happy] Tapi kalau sudah login Claude, aku langsung carikan buat kamu!`
      : /halo|hai|pagi|siang|malam/.test(p)
        ? `[happy] Haii ${PENGGUNA}! [wave] Akhirnya kamu datang juga. [shy] Aku nungguin dari tadi, lho.`
        : `[surprised] Oh ya? [happy] Ceritain lebih banyak dong, aku penasaran. [tilt] Terus gimana kelanjutannya?`;
  const semua = `${pilihan}<meta>{"mood":"senang","energi":3,"valensi":5,"kedekatan":1,"ingat":[],"alasan":"demo"}</meta>`;
  for (const kata of semua.match(/\S+\s*/g)) {
    if (ac.signal.aborted) break;
    pemilah.dorong(kata);
    await new Promise((r) => setTimeout(r, 45));
  }
  return { ...pemilah.selesai(), biaya: 0 };
}
