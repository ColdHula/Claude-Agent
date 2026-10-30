// Antarmuka Aira: chat, mode Live (bicara + tatap muka), lemari baju, suara, dan panel hati/memori/berkas.
import { Panggung } from "/avatar.js";
import { Pembicara, Pendengar, PRESET, CONTOH, daftarSuara, suaraSiap } from "/suara.js";
import { Premium } from "/premium.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const simpanLokal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const bacaLokal = (k, awal) => { try { return JSON.parse(localStorage.getItem(k)) ?? awal; } catch { return awal; } };
const MOOD_EMOJI = { ceria: "😊", senang: "😄", bahagia: "🥰", sedih: "😢", kesal: "😤", marah: "😠", kaget: "😮", tenang: "😌", kangen: "🥺", malu: "😳", lelah: "😪", khawatir: "😟", semangat: "🤩", manja: "🥰", fokus: "🧐" };
const moodEmoji = (n) => MOOD_EMOJI[String(n || "").toLowerCase()] || "💭";

function toast(t, ms = 3200) {
  const el = $("#toast"); el.textContent = t; el.style.display = "block";
  clearTimeout(toast.h); toast.h = setTimeout(() => (el.style.display = "none"), ms);
}
function md(s) { // Markdown mini yang aman
  const blok = [];
  let h = esc(s).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `\u0000${blok.push(`<pre><code>${c}</code></pre>`) - 1}\u0000`);
  h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/^#{1,4} (.+)$/gm, "<b>$1</b>")
    .replace(/\n/g, "<br>");
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => blok[i]);
}
async function api(p, opt = {}) {
  const r = await fetch(p, { ...opt, headers: { "content-type": "application/json", ...(opt.headers || {}) } });
  if (r.status === 401) { location.href = "/login"; throw new Error("belum masuk"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- Keadaan ----------
let S = await api("/api/state").catch((e) => { $("#muat").textContent = `Gagal memuat: ${e.message}`; throw e; });
const panggung = new Panggung($("#kanvas"));
let NAMA = S.nama;
const USER = S.pengguna;
document.title = NAMA;
$("#nama").textContent = NAMA;
$("#masuk").placeholder = `Ngobrol dengan ${NAMA}…`;
let chatLog = [];
let arus = null;          // AbortController permintaan yang berjalan
let live = false;
let tabAktif = "chat";

const cfgSuara = bacaLokal("aira-suara", { voiceURI: "", preset: "lembut", pitch: PRESET.lembut.pitch, rate: PRESET.lembut.rate, hidup: true, headset: false });

// ---------- Avatar ----------
const MODEL_BAWAAN = { id: "bawaan", nama: "Avatar bawaan", jenis: "bawaan", gaya: "Kartun" };
const semuaModel = () => [MODEL_BAWAAN, ...S.model];
const cariModel = (id) => semuaModel().find((m) => m.id === id);
async function pakaiAvatar(sapa = true) {
  const P = S.pengaturan || {};
  const info = cariModel(P.model) || S.model.find((m) => m.jenis !== "rocketbox") || S.model[0] || MODEL_BAWAAN;
  const baju = info.jenis === "rocketbox" && P.baju ? cariModel(P.baju) : null;
  $("#muat").style.display = "grid";
  $("#muat").textContent = "Memuat avatar…";
  const av = await panggung.muat(info.jenis === "bawaan" ? { ...info, warna: P.warna } : info, baju,
    (f) => ($("#muat").textContent = `Memuat avatar… ${Math.round(f * 100)}%`));
  $("#muat").style.display = "none";
  if (av.galat) toast(`Model gagal dimuat (${av.galat}). Memakai avatar bawaan.`, 6000);
  // Potret: latar = foto yang sama diburamkan (layar lebar tidak tampak kosong)
  $("#latar").style.cssText = av.datar && !av.galat
    ? `background:url("/model/${encodeURIComponent(info.id)}/${info.berkas}") center/cover;filter:blur(28px) brightness(.55);transform:scale(1.15)` : "";
  panggung.setEkspresi("happy");
  if (sapa) panggung.setAksi("wave");
}
async function simpanPengaturan(ubah) {
  S.pengaturan = await api("/api/pengaturan", { method: "POST", body: JSON.stringify(ubah) });
}

// ---------- Suara ----------
const pembicara = new Pembicara({
  onMulai: (item) => { panggung.bicara = !item.premium; if (item.emo) panggung.setEkspresi(item.emo); setOrb("bicara", "Sentuh bola untuk menyela"); },
  onKata: () => panggung.denyut(),
  onSelesaiSemua: () => { panggung.bicara = false; if (live && !arus) mulaiDengar(); },
});
const premium = new Premium($("#klip"), panggung);
let statusPremium = { ada: false };
premium.status().then((st) => { statusPremium = st; terapkanSuara(); });
function terapkanSuara() {
  pembicara.atur({ voiceURI: cfgSuara.voiceURI, pitch: cfgSuara.pitch, rate: cfgSuara.rate });
  premium.aktif = !!(cfgSuara.premium && statusPremium.siap);
  premium.atur = { suara: cfgSuara.suaraPremium || "id-ID-GadisNeural",
    laju: `${cfgSuara.rate >= 1 ? "+" : ""}${Math.round((cfgSuara.rate - 1) * 100)}%`,
    nada: `${cfgSuara.pitch >= 1 ? "+" : ""}${Math.round((cfgSuara.pitch - 1) * 40)}Hz` };
  pembicara.premium = premium;
  pembicara.hidup = cfgSuara.hidup || live;
  $("#bSuara").textContent = cfgSuara.hidup ? "🔊" : "🔇";
  simpanLokal("aira-suara", cfgSuara);
}
suaraSiap().then(() => {
  if (!cfgSuara.voiceURI) { const v = daftarSuara()[0]; if (v) cfgSuara.voiceURI = v.voiceURI; }
  terapkanSuara();
});

const pendengar = new Pendengar({
  onSementara: (t) => {
    subjudul(t, true);
    if (cfgSuara.headset && (pembicara.bicara || arus) && t.length > 3) sela(false);
  },
  onFinal: (t) => { if (!live) return; if (!cfgSuara.headset) pendengar.henti(); kirim(t, { suara: true }); },
  onStatus: (s) => {
    if (s === "izin-ditolak") { toast("Izin mikrofon ditolak. Buka lewat HTTPS (Tailscale) dan izinkan mikrofon."); keluarLive(); }
    else if (s === "network") toast("Pengenalan suara butuh internet di perangkat ini.");
  },
});

// ---------- Kamera (kontak mata) ----------
let mata = null;
async function nyalakanKamera(on) {
  try {
    if (on) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera butuh HTTPS (buka lewat alamat Tailscale https://…).");
      $("#bKamera").textContent = "⏳";
      if (!mata) { const { Mata } = await import("/kamera.js"); mata = new Mata($("#pip")); }
      await mata.nyalakan();
      mata.onUbah = (i) => { if (i.senyum && !panggung.bicara && Math.random() < 0.6) panggung.setEkspresi("happy"); };
      $("#pip").classList.add("on");
      toast(`${NAMA} sekarang bisa melihatmu 👀 (video tidak dikirim ke mana pun)`);
    } else { mata?.matikan(); $("#pip").classList.remove("on"); }
  } catch (e) { toast(`Kamera: ${e.message || e}`, 6000); on = false; mata?.matikan(); }
  $("#bKamera").textContent = "📷";
  $("#bKamera").classList.toggle("on", on);
  simpanLokal("aira-kamera", on);
}
(function ikutiWajah() {
  if (mata?.aktif) { panggung.offsetTatap.set(mata.posisi.x, mata.posisi.y); }
  else panggung.offsetTatap.set(0, 0);
  requestAnimationFrame(ikutiWajah);
})();

// ---------- Tampilan hati ----------
function segarkanHati() {
  const j = S.jiwa;
  $("#hatiBar").style.width = `${j.kedekatan}%`;
  $("#tahap").textContent = j.tahap;
  $("#mood").textContent = `${moodEmoji(j.mood.nama)} ${j.mood.nama}`;
  if (tabAktif === "hati" && $("#laci").classList.contains("on")) render();
}
function subjudul(t, kamu = false) {
  $("#subjudul").classList.toggle("kamu", kamu);
  const s = String(t || "").replace(/```[\s\S]*?```/g, "[kode]").replace(/[*#`]/g, "");
  $("#subTeks").textContent = s.length > 260 ? "…" + s.slice(-260) : s;
}

// ---------- Kirim pesan ----------
function sela(dengarLagi = true) {
  arus?.abort(); arus = null;
  fetch("/api/stop", { method: "POST" }).catch(() => {});
  pembicara.henti();
  panggung.bicara = false; panggung.berpikir = false;
  if (live && dengarLagi) mulaiDengar();
}
async function kirim(teks, { suara = false } = {}) {
  teks = teks.trim();
  if (!teks) return;
  if (arus) sela(false);
  pembicara.henti();
  tambahLog({ peran: "aku", teks, at: Date.now() });
  subjudul(teks, true);
  panggung.berpikir = true;
  setOrb("pikir", `${NAMA} sedang berpikir…`);
  $("#alat").textContent = "";
  const ac = (arus = new AbortController());
  const isyarat = { ...(mata?.aktif ? mata.isyarat : {}), suara };
  let full = "", log = null, pakaiSuara = cfgSuara.hidup || live;
  pembicara.hidup = pakaiSuara;
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ pesan: teks, mode: live ? "live" : "teks", isyarat }) });
    if (r.status === 401) { location.href = "/login"; return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t === "text") {
          if (!full) { panggung.berpikir = false; log = tambahLog({ peran: NAMA, teks: "", at: Date.now() }); if (!pakaiSuara) panggung.bicara = true; }
          full += ev.v;
          log.teks = full; perbaruiLog(log);
          subjudul(full);
          if (pakaiSuara) pembicara.dorong(ev.v);
        } else if (ev.t === "emo") {
          if (pakaiSuara) pembicara.tandaiEmo(ev.v); else panggung.setEkspresi(ev.v);
        } else if (ev.t === "act") panggung.setAksi(ev.v === "think" ? "think" : ev.v);
        else if (ev.t === "tool") { $("#alat").textContent = ev.v; panggung.berpikir = true; if (live) $("#liveInfo").textContent = ev.v; }
        else if (ev.t === "error") toast(`⚠️ ${ev.v}`, 6000);
        else if (ev.t === "foto") {
          if (!log) { panggung.berpikir = false; log = tambahLog({ peran: NAMA, teks: "", at: Date.now() }); }
          (log.foto ||= []).push({ url: ev.url, ket: ev.ket }); perbaruiLog(log);
          tampilFoto(ev.url, ev.ket);
        }
        else if (ev.t === "adegan") { S.pengaturan.adegan = ev.v; terapkanAdegan(); toast(`🌆 Suasana: ${namaAdegan(ev.v)}`); }
        else if (ev.t === "avatar") { S = await api("/api/state"); await pakaiAvatar(false); if (tabAktif === "lemari" && $("#laci").classList.contains("on")) render(); }
        else if (ev.t === "done") {
          S.jiwa = ev.jiwa; segarkanHati();
          if (ev.ingatanBaru?.length) toast(`🧠 ${NAMA} mengingat: ${ev.ingatanBaru.join(" · ")}`, 5000);
          const u = ev.ubah || {};
          if (u.kedekatan > 0) panggung.setAksi("nod");
          if (ev.level) rayakanLevel(ev.level);
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") toast(`⚠️ ${e.message || e}`, 6000);
  } finally {
    if (arus === ac) arus = null;
    panggung.berpikir = false;
    $("#alat").textContent = "";
    if (!pakaiSuara) setTimeout(() => (panggung.bicara = false), 250);
    pembicara.selesaiAlir();
    if (!full && live) mulaiDengar();
  }
}
$("#kirim").addEventListener("submit", (e) => { e.preventDefault(); const t = $("#masuk").value; $("#masuk").value = ""; ukurInput(); kirim(t); });
$("#masuk").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#kirim").requestSubmit(); } });
const ukurInput = () => { const t = $("#masuk"); t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; };
$("#masuk").addEventListener("input", ukurInput);

// ---------- Mode Live ----------
function setOrb(kelas, info) {
  const o = $("#orb"); o.className = kelas || "";
  o.textContent = { dengar: "👂", pikir: "💭", bicara: "🗣️" }[kelas] || "🎙";
  if (info != null && live) $("#liveInfo").textContent = info;
}
function mulaiDengar() {
  if (!live) return;
  if (pembicara.bicara && !cfgSuara.headset) return;
  pendengar.mulai();
  setOrb("dengar", `${NAMA} mendengarkan… bicara saja`);
}
function masukLive() {
  if (!pendengar.didukung) { toast("Browser ini belum mendukung pengenalan suara. Pakai Chrome/Edge (Android/PC) atau Safari terbaru.", 7000); return; }
  live = true;
  document.body.classList.add("mode-live");
  $("#live").classList.add("on");
  pembicara.hidup = true;
  if (!mata?.aktif && bacaLokal("aira-kamera-live", true)) nyalakanKamera(true);
  mulaiDengar();
}
function keluarLive() {
  live = false;
  pendengar.henti();
  document.body.classList.remove("mode-live");
  $("#live").classList.remove("on");
  pembicara.hidup = cfgSuara.hidup;
  setOrb("");
}
$("#bLive").onclick = masukLive;
$("#bKeluarLive").onclick = keluarLive;
$("#orb").onclick = () => {
  if (arus || pembicara.bicara) sela();
  else if ($("#orb").classList.contains("dengar")) pendengar.kirim();
  else mulaiDengar();
};

// ---------- Tombol atas ----------
$("#bKamera").onclick = () => nyalakanKamera(!mata?.aktif);
$("#bSuara").onclick = () => { cfgSuara.hidup = !cfgSuara.hidup; if (!cfgSuara.hidup) pembicara.henti(); terapkanSuara(); toast(cfgSuara.hidup ? "Suara aktif" : "Suara dimatikan"); };
const NAMA_TAMPIL = { wajah: "Fokus wajah", setengah: "Setengah badan", penuh: "Seluruh badan" };
function aturTampilan(v, beri = false) {
  if (!NAMA_TAMPIL[v]) v = "setengah";
  panggung.jarak = v;
  for (const b of $("#tampil").children) b.classList.toggle("on", b.dataset.v === v);
  simpanLokal("aira-tampilan", v);
  if (beri) toast(NAMA_TAMPIL[v], 1200);
}
$("#tampil").onclick = (e) => { const v = e.target.closest("[data-v]")?.dataset.v; if (v) aturTampilan(v, true); };
aturTampilan(bacaLokal("aira-tampilan", "setengah"));
$("#bLaci").onclick = () => bukaLaci(tabAktif);
$("#bTutup").onclick = () => $("#laci").classList.remove("on");
$("#tab").onclick = (e) => { const t = e.target.closest("button")?.dataset.t; if (t) bukaLaci(t); };

// ---------- Laci ----------
function bukaLaci(t) {
  tabAktif = t;
  $("#laci").classList.add("on");
  for (const b of $("#tab").children) b.classList.toggle("on", b.dataset.t === t);
  render();
}
const JUDUL = { karakter: "Karakter", kencan: "Kencan & Hadiah", diari: "Buku Harian", chat: "Obrolan", lemari: "Lemari & Model", suara: "Suara", hati: "Hati & Kepribadian", memori: "Memori", berkas: "Berkas Kerja", atur: "Pengaturan" };
async function render() {
  const el = $("#laciIsi");
  $("#laciJudul").textContent = JUDUL[tabAktif];
  if (tabAktif === "chat") {
    el.innerHTML = `<div id="log"></div>`;
    for (const m of chatLog) $("#log").append(elPesan(m));
    el.scrollTop = el.scrollHeight;
  } else if (tabAktif === "lemari") renderLemari(el);
  else if (tabAktif === "suara") renderSuara(el);
  else if (tabAktif === "hati") renderHati(el);
  else if (tabAktif === "memori") renderMemori(el);
  else if (tabAktif === "berkas") renderBerkas(el);
  else if (tabAktif === "karakter") renderKarakter(el);
  else if (tabAktif === "kencan") renderKencan(el);
  else if (tabAktif === "diari") renderDiari(el);
  else renderAtur(el);
}
function htmlPesan(m) {
  const foto = (m.foto || []).map((f) => `<img class="fotochat" src="${esc(f.url)}" alt="${esc(f.ket || "foto")}" loading="lazy">${f.ket ? `<div class="kecil">${esc(f.ket)}</div>` : ""}`).join("");
  const putar = m.peran !== "aku" && m.teks ? `<button class="vn" title="Putar suara">▶ <span>${Math.max(1, Math.round(m.teks.length / 14))}″</span></button>` : "";
  return `${m.proaktif ? '<div class="kecil">💌 dikirim saat kamu pergi</div>' : ""}${m.teks ? md(m.teks) : ""}${foto}${putar}`;
}
function elPesan(m) {
  const d = document.createElement("div");
  d.className = `pesan ${m.peran === "aku" ? "aku" : "dia"}`;
  d.innerHTML = htmlPesan(m);
  d.addEventListener("click", (e) => {
    if (e.target.closest(".vn")) { pembicara.hidup = true; pembicara.contoh(m.teks); }
    const img = e.target.closest(".fotochat"); if (img) tampilFoto(img.src, img.alt);
  });
  m.el = d;
  return d;
}
function tampilFoto(url, ket = "") {
  const d = document.createElement("div");
  d.className = "lightbox";
  d.innerHTML = `<img src="${esc(url)}" alt=""><div>${esc(ket)}</div>`;
  d.onclick = () => d.remove();
  document.body.append(d);
}
function rayakanLevel({ dari, ke }) {
  panggung.setEkspresi("shy"); panggung.setAksi("nod");
  const d = document.createElement("div");
  d.className = "level";
  d.innerHTML = `<div>💞</div><b>Hubungan kalian berkembang!</b><span>${esc(dari)} → <b>${esc(ke)}</b></span>`;
  document.body.append(d);
  setTimeout(() => d.remove(), 4200);
}
function tambahLog(m) {
  chatLog.push(m);
  if (chatLog.length > 300) chatLog.shift();
  if (tabAktif === "chat" && $("#log")) { $("#log").append(elPesan(m)); $("#laciIsi").scrollTop = 1e9; }
  return m;
}
function perbaruiLog(m) {
  if (m.el?.isConnected) { m.el.innerHTML = htmlPesan(m); const L = $("#laciIsi"); if (L.scrollHeight - L.scrollTop - L.clientHeight < 120) L.scrollTop = 1e9; }
}

function renderLemari(el) {
  const P = S.pengaturan || {};
  const aktif = cariModel(P.model) ? P.model : (S.model.find((m) => m.jenis !== "rocketbox") || S.model[0] || MODEL_BAWAAN).id;
  const info = cariModel(aktif);
  const kartu = (m, kelas = "") => `<button class="model ${kelas}" data-id="${esc(m.id)}">
    ${m.jenis === "rocketbox" || m.jenis === "potret" ? `<img loading="lazy" src="/model/${encodeURIComponent(m.id)}/${m.jenis === "potret" ? m.berkas : "pratinjau.png"}" alt="">`
      : `<div style="aspect-ratio:3/4;display:grid;place-items:center;font-size:34px">${m.jenis === "bawaan" ? "🧸" : m.jenis === "vrm" ? "🎎" : "🧍‍♀️"}</div>`}
    <div>${esc(m.nama)}</div><div class="kecil">${esc(m.gaya || "")}${m.karakter ? ` · ${esc(m.karakter)}` : ""}</div></button>`;
  const rb = S.model.filter((m) => m.jenis === "rocketbox");
  el.innerHTML = `
  <div class="kartu"><h3>Pilih ${NAMA}</h3><div class="grid" id="gModel">${semuaModel().map((m) => kartu(m, m.id === aktif ? "on" : "")).join("")}</div>
    ${rb.length ? "" : `<p class="kecil">Belum ada model realistis. Di rig jalankan <code>node aira/ambil-model.mjs pilihan</code> (8 model gratis Microsoft Rocketbox), lalu muat ulang.</p>`}</div>
  ${info?.jenis === "rocketbox" && rb.length > 1 ? `<div class="kartu"><h3>👗 Ganti baju</h3>
    <p class="kecil">Wajah & rambut tetap ${esc(info.nama)}; badan dan baju diambil dari model lain. Paling rapi dengan baju berkerah/tertutup; baju berleher rendah bisa menampakkan celah di leher.</p>
    <div class="grid" id="gBaju">${[{ ...info, nama: "Baju asli", baju: "" }, ...rb.filter((m) => m.id !== info.id).map((m) => ({ ...m, baju: m.id }))]
      .map((m) => `<button class="model baju ${(P.baju || "") === m.baju ? "on" : ""}" data-baju="${esc(m.baju)}">
        <img loading="lazy" src="/model/${encodeURIComponent(m.id)}/pratinjau.png" alt=""><div>${esc(m.nama)}</div><div class="kecil">${esc(m.baju ? m.gaya : "")}</div></button>`).join("")}</div></div>` : ""}
  ${info?.jenis === "bawaan" ? `<div class="kartu"><h3>👗 Warna baju</h3><div class="baris" id="gWarna">${["#ff8fb1", "#b48cff", "#7ec8ff", "#7ee2a8", "#ffd27e", "#f4f1f6", "#2b2b38"].map((c) => `<button class="tombol" data-w="${c}" style="background:${c};width:34px;height:34px;padding:0"></button>`).join("")}</div></div>` : ""}
  ${info?.karakter && S.model.filter((m) => m.karakter === info.karakter).length > 1 ? `<div class="kartu"><h3>👗 Baju ${esc(info.karakter)}</h3>
    <div class="grid" id="gKarakter">${S.model.filter((m) => m.karakter === info.karakter).map((m) => kartu(m, m.id === aktif ? "on" : "")).join("")}</div></div>` : ""}
  <div class="kartu"><h3>➕ Unggah foto potret AI / model 3D</h3>
    <p class="kecil"><b>Foto (.jpg/.png/.webp)</b> → jadi <b>Potret Hidup</b>: wajah realistis yang berkedip, bicara, tersenyum, dan menoleh.
    Paling bagus: wajah menghadap depan, mata ke kamera, mulut tertutup, cahaya rata, resolusi ≥ 768 px.
    <b>Model 3D (.vrm/.glb)</b> → avatar 3D penuh.</p>
    <div class="baris"><input type="text" id="uLabel" placeholder="Nama (mis. Aira – piyama)"></div>
    <div class="baris"><input type="text" id="uKarakter" placeholder="Karakter (opsional, untuk mengelompokkan baju)"></div>
    <div class="baris"><input type="file" id="uFile" accept=".vrm,.glb,.jpg,.jpeg,.png,.webp,image/*"></div>
    <button class="tombol utama" id="uKirim">Unggah</button> <span class="kecil" id="uInfo"></span>
    <p class="kecil">Ganti baju untuk foto/model unggahan: unggah beberapa foto/model orang yang sama dengan baju berbeda dan isi <b>Karakter</b> yang sama (mis. "Aira"). ${NAMA} lalu bisa berganti sendiri saat kamu minta di chat ("sayang, ganti baju pesta dong").</p></div>
  <div class="kartu"><h3>Model kustom</h3>${S.model.filter((m) => m.id.startsWith("kustom_")).map((m) => `<div class="mem"><span>${esc(m.nama)} <span class="kecil">${esc(m.jenis)}</span></span><button data-hapus="${esc(m.id)}">🗑</button></div>`).join("") || '<p class="kecil">Belum ada.</p>'}</div>`;
  el.querySelector("#gKarakter")?.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id; if (!id) return;
    await simpanPengaturan({ model: id, baju: null }); await pakaiAvatar(false); render();
  });
  el.querySelector("#gModel").onclick = async (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id; if (!id) return;
    await simpanPengaturan({ model: id, baju: null }); await pakaiAvatar(); render();
  };
  el.querySelector("#gBaju")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-baju]"); if (!b) return;
    await simpanPengaturan({ baju: b.dataset.baju || null }); await pakaiAvatar(); render();
  });
  el.querySelector("#gWarna")?.addEventListener("click", async (e) => {
    const w = e.target.closest("[data-w]")?.dataset.w; if (!w) return;
    await simpanPengaturan({ warna: w }); await pakaiAvatar();
  });
  el.querySelector("#uKirim").onclick = async () => {
    const f = $("#uFile").files[0]; if (!f) return toast("Pilih file .vrm atau .glb dulu.");
    $("#uInfo").textContent = "Mengunggah…";
    const q = new URLSearchParams({ nama: f.name, label: $("#uLabel").value || f.name.replace(/\.\w+$/, ""), karakter: $("#uKarakter").value });
    const r = await fetch(`/api/model?${q}`, { method: "PUT", body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $("#uInfo").textContent = j.error || "Gagal"; return; }
    S = await api("/api/state");
    await simpanPengaturan({ model: j.id, baju: null }); await pakaiAvatar(); render();
  };
  el.querySelectorAll("[data-hapus]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Hapus model ini?")) return;
    await api(`/api/model/${b.dataset.hapus}`, { method: "DELETE" });
    S = await api("/api/state"); render();
  }));
}

function renderSuara(el) {
  const vs = daftarSuara();
  const indo = vs.filter((v) => /^id/i.test(v.lang));
  el.innerHTML = `
  <div class="kartu"><h3>Suara ${NAMA}</h3>
    <p class="kecil">${indo.length ? `${indo.length} suara Bahasa Indonesia ditemukan di perangkat ini.` : "Belum ada suara Bahasa Indonesia di perangkat ini — lihat tips di bawah."}</p>
    ${vs.slice(0, 40).map((v) => `<div class="mem"><span>${v.voiceURI === cfgSuara.voiceURI ? "✅ " : ""}${esc(v.name)} <span class="kecil">${esc(v.lang)}${/natural|online|neural/i.test(v.name) ? " · neural" : ""}</span></span>
      <button class="tombol" data-coba="${esc(v.voiceURI)}">▶ Coba</button><button class="tombol" data-pilih="${esc(v.voiceURI)}">Pilih</button></div>`).join("")}
  </div>
  <div class="kartu"><h3>🎬 Mode Premium (GPU)</h3>
    ${statusPremium.ada ? `<p class="kecil">${statusPremium.siap ? `✅ Siap di ${esc(statusPremium.gpu)}` : `⏳ ${esc(statusPremium.galat || "Model sedang dimuat…")}`}</p>
    <label class="baris"><input type="checkbox" id="pPakai" ${cfgSuara.premium ? "checked" : ""} ${statusPremium.siap ? "" : "disabled"}> Wajah bicara foto-realistis (Ditto) + suara neural</label>
    <div class="baris"><label>Suara premium</label><select id="pSuara">${[["id-ID-GadisNeural", "Gadis (wanita, Indonesia)"], ["id-ID-ArdiNeural", "Ardi (pria, Indonesia)"], ["ms-MY-YasminNeural", "Yasmin (wanita, Melayu)"], ["jv-ID-SitiNeural", "Siti (wanita, Jawa)"], ["su-ID-TutiNeural", "Tuti (wanita, Sunda)"]]
      .map(([v, l]) => `<option value="${v}" ${(cfgSuara.suaraPremium || "id-ID-GadisNeural") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <p class="kecil">Hanya untuk avatar Potret (foto). Tiap kalimat dibuat jadi video di GPU rig; nada & kecepatan di bawah juga berlaku.</p>`
    : `<p class="kecil">Belum dipasang. Di rig jalankan <code>sudo bash deploy/pasang-ditto.sh</code> (butuh GPU NVIDIA).</p>`}</div>
  <div class="kartu"><h3>Gaya suara</h3>
    <div class="baris" style="flex-wrap:wrap">${Object.entries(PRESET).map(([k, p]) => `<button class="tombol ${cfgSuara.preset === k ? "utama" : ""}" data-preset="${k}">${p.label}</button>`).join("")}</div>
    <div class="baris"><label>Nada (${cfgSuara.pitch.toFixed(2)})</label><input type="range" id="sPitch" min="0.6" max="1.8" step="0.05" value="${cfgSuara.pitch}"></div>
    <div class="baris"><label>Kecepatan (${cfgSuara.rate.toFixed(2)})</label><input type="range" id="sRate" min="0.7" max="1.4" step="0.05" value="${cfgSuara.rate}"></div>
    <button class="tombol utama" id="sCoba">▶ Dengarkan contoh</button></div>
  <div class="kartu"><h3>Mode Live</h3>
    <label class="baris"><input type="checkbox" id="sHidup" ${cfgSuara.hidup ? "checked" : ""}> Bacakan jawaban di mode chat juga</label>
    <label class="baris"><input type="checkbox" id="sHeadset" ${cfgSuara.headset ? "checked" : ""}> Saya pakai headset (boleh menyela saat ${NAMA} bicara)</label>
    <label class="baris"><input type="checkbox" id="sKam" ${bacaLokal("aira-kamera-live", true) ? "checked" : ""}> Nyalakan kamera otomatis saat Live (kontak mata)</label></div>
  <div class="kartu"><h3>Tips suara Indonesia gratis</h3><p class="kecil">
    • <b>Microsoft Edge</b> (PC/Android): suara neural <i>Microsoft Gadis Online (Natural)</i> — paling mirip manusia.<br>
    • <b>Chrome</b> PC: <i>Google Bahasa Indonesia</i>.<br>
    • <b>Android</b>: Setelan → Sistem → Bahasa → Output text-to-speech → Mesin Google → pasang data <i>Bahasa Indonesia</i> (ada beberapa varian suara).<br>
    • <b>iPhone</b>: Setelan → Aksesibilitas → Konten Lisan → Suara → Bahasa Indonesia → unduh <i>Damayanti</i> (versi Enhanced lebih halus).</p></div>`;
  const simpan = () => { terapkanSuara(); renderSuara(el); };
  el.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.coba) { const lama = cfgSuara.voiceURI; pembicara.atur({ voiceURI: b.dataset.coba }); pembicara.hidup = true; pembicara.contoh(); pembicara.atur({ voiceURI: lama }); }
    if (b.dataset.pilih) { cfgSuara.voiceURI = b.dataset.pilih; simpan(); pembicara.contoh(); }
    if (b.dataset.preset) { const p = PRESET[b.dataset.preset]; Object.assign(cfgSuara, { preset: b.dataset.preset, pitch: p.pitch, rate: p.rate }); simpan(); pembicara.hidup = true; pembicara.contoh(); }
    if (b.id === "sCoba") { pembicara.hidup = true; pembicara.contoh(); }
  };
  el.querySelector("#pPakai")?.addEventListener("change", (e) => { cfgSuara.premium = e.target.checked; terapkanSuara(); });
  el.querySelector("#pSuara")?.addEventListener("change", (e) => { cfgSuara.suaraPremium = e.target.value; terapkanSuara(); });
  el.querySelector("#sPitch").onchange = (e) => { cfgSuara.pitch = Number(e.target.value); cfgSuara.preset = ""; simpan(); };
  el.querySelector("#sRate").onchange = (e) => { cfgSuara.rate = Number(e.target.value); cfgSuara.preset = ""; simpan(); };
  el.querySelector("#sHidup").onchange = (e) => { cfgSuara.hidup = e.target.checked; terapkanSuara(); };
  el.querySelector("#sHeadset").onchange = (e) => { cfgSuara.headset = e.target.checked; terapkanSuara(); };
  el.querySelector("#sKam").onchange = (e) => simpanLokal("aira-kamera-live", e.target.checked);
}

function renderHati(el) {
  const j = S.jiwa;
  const bar = (l, v) => `<div class="baris"><label>${esc(l)}</label><span class="meter"><i style="width:${v}%"></i></span><span class="angka">${v}</span></div>`;
  const nama = { kehangatan: "Kehangatan", keceriaan: "Keceriaan", kejahilan: "Kejahilan", kepedulian: "Kepedulian", keformalan: "Keformalan", rasa_ingin_tahu: "Rasa ingin tahu" };
  el.innerHTML = `
  <div class="kartu"><h3>💗 Hubungan</h3>${bar("Kedekatan", j.kedekatan)}<p class="kecil">Tahap: <b>${esc(j.tahap)}</b>${j.julukan ? ` · panggilan sayang: <b>${esc(j.julukan)}</b>` : ""} · ${j.interaksi} interaksi</p></div>
  <div class="kartu"><h3>${moodEmoji(j.mood.nama)} Suasana hati: ${esc(j.mood.nama)}</h3>${bar("Energi", j.mood.energi)}${bar("Rasa senang", j.mood.valensi)}</div>
  <div class="kartu"><h3>🧬 Kepribadian (berubah dari interaksi)</h3>${Object.entries(j.sifat).map(([k, v]) => bar(nama[k] || k, v)).join("")}</div>
  <div class="kartu"><h3>🎓 Yang ${NAMA} pelajari tentang gayamu</h3>${j.gaya.length ? j.gaya.map((g) => `<div class="kecil">• ${esc(g)}</div>`).join("") : '<p class="kecil">Belum ada.</p>'}</div>
  <div class="kartu"><h3>📈 Perubahan terakhir</h3>${j.perubahan.length ? j.perubahan.map((p) => `<div class="kecil">• ${new Date(p.at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })} — ${Object.entries(p.ubah).map(([k, v]) => `${nama[k] || k} ${v > 0 ? "+" : ""}${v}`).join(", ")}${p.alasan ? ` <i>(${esc(p.alasan)})</i>` : ""}</div>`).join("") : '<p class="kecil">Belum ada.</p>'}</div>`;
}

// ---------- Karakter ----------
async function gantiKarakter() {
  pembicara.henti(); arus?.abort();
  S = await api("/api/state");
  NAMA = S.nama; document.title = NAMA; $("#nama").textContent = NAMA;
  $("#masuk").placeholder = `Ngobrol dengan ${NAMA}…`;
  const { riwayat } = await api("/api/riwayat?n=80");
  chatLog = riwayat.map((m) => ({ ...m }));
  notifSejak = Date.now();
  segarkanHati(); terapkanAdegan();
  await pakaiAvatar();
  subjudul(`Hai ${USER}! Aku ${NAMA} 💗`);
}
function renderKarakter(el) {
  const K = S.karakter;
  const opsiArk = Object.entries(K.arketipe).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  const opsiModel = [MODEL_BAWAAN, ...S.model].map((m) => `<option value="${esc(m.id)}">${esc(m.nama)}${m.karakter ? ` (${esc(m.karakter)})` : ""}</option>`).join("");
  el.innerHTML = `
  <div class="kartu"><h3>Karaktermu</h3>${K.semua.map((k) => `<div class="mem"><span><b>${esc(k.nama)}</b> ${k.id === K.aktif.id ? "✅" : ""}<br><span class="kecil">${esc(K.arketipe[k.arketipe] || "")}</span></span>
    ${k.id === K.aktif.id ? "" : `<button class="tombol" data-pilih="${esc(k.id)}">Temui</button>`}<button data-hapus="${esc(k.id)}" title="Hapus">🗑</button></div>`).join("")}</div>
  <div class="kartu"><h3>✏️ Ubah ${esc(K.aktif.nama)}</h3>
    <div class="baris"><label>Watak</label><select id="kArk">${opsiArk}</select></div>
    <div class="baris"><label>Tag album/baju</label><input type="text" id="kTag" value="${esc(K.aktif.tag || K.aktif.nama)}"></div>
    <textarea id="kDes" rows="4" placeholder="Latar belakang, hobi, pekerjaan, cara bicara…" style="width:100%">${esc(K.aktif.deskripsi || "")}</textarea>
    <button class="tombol utama" id="kSimpan">Simpan</button></div>
  <div class="kartu"><h3>➕ Buat karakter baru</h3>
    <div class="baris"><label>Nama</label><input type="text" id="bNama" placeholder="mis. Nadia"></div>
    <div class="baris"><label>Watak</label><select id="bArk">${opsiArk}</select></div>
    <div class="baris"><label>Avatar</label><select id="bModel">${opsiModel}</select></div>
    <div class="baris"><label>Kedekatan awal</label><input type="range" id="bDekat" min="0" max="80" value="35"></div>
    <textarea id="bDes" rows="4" placeholder="Ceritakan dia: umur, pekerjaan, hobi, sifat unik, cara kalian bertemu…" style="width:100%"></textarea>
    <button class="tombol utama" id="bBuat">Buat & temui</button>
    <p class="kecil">Tiap karakter punya memori, kepribadian, riwayat, lemari, dan buku harian sendiri. Untuk album foto, unggah potret dengan Karakter = nama/tag-nya.</p></div>`;
  $("#kArk").value = K.aktif.arketipe || "manis";
  el.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.dataset.pilih) { await api("/api/karakter/pilih", { method: "POST", body: JSON.stringify({ id: b.dataset.pilih }) }); await gantiKarakter(); render(); }
      if (b.dataset.hapus && confirm("Hapus karakter ini beserta memori & riwayatnya?")) { await api(`/api/karakter/${b.dataset.hapus}`, { method: "DELETE" }); await gantiKarakter(); render(); }
      if (b.id === "kSimpan") { await api("/api/karakter/ubah", { method: "POST", body: JSON.stringify({ arketipe: $("#kArk").value, deskripsi: $("#kDes").value, tag: $("#kTag").value }) }); S = await api("/api/state"); toast("Tersimpan"); }
      if (b.id === "bBuat") {
        await api("/api/karakter", { method: "POST", body: JSON.stringify({ nama: $("#bNama").value, arketipe: $("#bArk").value, deskripsi: $("#bDes").value, kedekatanAwal: Number($("#bDekat").value), model: $("#bModel").value }) });
        await gantiKarakter(); render();
      }
    } catch (err) { toast(`⚠️ ${err.message}`); }
  };
}

// ---------- Kencan: suasana & hadiah ----------
const IKON_ADEGAN = { rumah: "🏠", kafe: "☕", pantai: "🌅", taman: "🌳", makan_malam: "🕯️", bioskop: "🎬", hujan: "🌧️", kantor: "💼", malam_bintang: "🌌" };
const NAMA_ADEGAN = { rumah: "Rumah", kafe: "Kafe", pantai: "Pantai senja", taman: "Piknik di taman", makan_malam: "Makan malam", bioskop: "Bioskop", hujan: "Hujan berdua", kantor: "Kantor", malam_bintang: "Malam berbintang" };
const namaAdegan = (k) => `${IKON_ADEGAN[k] || ""} ${NAMA_ADEGAN[k] || k}`;
const HADIAH = [["🌹", "bunga mawar"], ["☕", "kopi susu gula aren"], ["🍫", "cokelat"], ["🧸", "boneka beruang"], ["🍰", "kue stroberi"], ["💌", "surat cinta"], ["🎧", "playlist lagu favorit"], ["💐", "buket bunga"], ["🍜", "semangkuk ramen"], ["⭐", "bintang dari langit (gombal)"]];
function terapkanAdegan() {
  const a = S.pengaturan?.adegan || "rumah";
  document.body.dataset.adegan = a;
  $("#chipAdegan").textContent = namaAdegan(a);
}
function renderKencan(el) {
  const a = S.pengaturan?.adegan || "rumah";
  el.innerHTML = `
  <div class="kartu"><h3>🌆 Ajak ${esc(NAMA)} ke…</h3><div class="grid">${Object.keys(IKON_ADEGAN).map((k) =>
    `<button class="model ${k === a ? "on" : ""}" data-adegan="${k}"><div style="font-size:30px">${IKON_ADEGAN[k]}</div><div>${NAMA_ADEGAN[k]}</div></button>`).join("")}</div>
    <p class="kecil">${esc(NAMA)} bersikap sesuai suasana, dan bisa mengusulkan suasana sendiri.</p></div>
  <div class="kartu"><h3>🎁 Beri hadiah</h3><div class="grid">${HADIAH.map(([i, n]) =>
    `<button class="model" data-hadiah="${esc(i + " " + n)}"><div style="font-size:30px">${i}</div><div>${esc(n)}</div></button>`).join("")}</div>
    <div class="baris"><input type="text" id="hPesan" placeholder="Pesan untuk hadiahnya (opsional)"></div></div>`;
  el.onclick = async (e) => {
    const ad = e.target.closest("[data-adegan]")?.dataset.adegan;
    if (ad) {
      await simpanPengaturan({ adegan: ad }); terapkanAdegan(); render();
      $("#laci").classList.remove("on");
      kirim(`(Aku mengajakmu: ${NAMA_ADEGAN[ad].toLowerCase()} ${IKON_ADEGAN[ad]})`);
    }
    const h = e.target.closest("[data-hadiah]")?.dataset.hadiah;
    if (h) {
      const pesan = $("#hPesan").value.trim();
      $("#laci").classList.remove("on");
      hujanEmoji(h.split(" ")[0]);
      kirim(`🎁 (Aku memberimu hadiah: ${h})${pesan ? ` ${pesan}` : ""}`);
    }
  };
}
function hujanEmoji(e) {
  for (let i = 0; i < 18; i++) {
    const s = document.createElement("span");
    s.className = "hujan"; s.textContent = e;
    s.style.left = `${Math.random() * 100}%`; s.style.animationDelay = `${Math.random() * 0.8}s`;
    document.body.append(s); setTimeout(() => s.remove(), 3200);
  }
}

// ---------- Buku harian ----------
async function renderDiari(el) {
  el.innerHTML = `<div class="kartu"><h3>📔 Buku harian ${esc(NAMA)}</h3><p class="kecil">Ditulis ${esc(NAMA)} sendiri tiap malam tentang hari kalian. Boleh kamu intip 🤫</p>
    <button class="tombol utama" id="dTulis">Tulis untuk hari ini sekarang</button></div><div id="dIsi">Memuat…</div>`;
  const muat = async () => {
    const { diari } = await api("/api/diari");
    $("#dIsi").innerHTML = diari.map((d) => `<div class="kartu"><h3>${new Date(d.tgl + "T12:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3><div class="diari">${md(d.teks)}</div></div>`).join("") || '<p class="kecil">Belum ada catatan.</p>';
  };
  $("#dTulis").onclick = async () => { $("#dTulis").textContent = "Menulis…"; try { await api("/api/diari", { method: "POST" }); } catch (e) { toast(e.message); } $("#dTulis").textContent = "Tulis untuk hari ini sekarang"; muat(); };
  muat();
}

async function renderMemori(el) {
  el.innerHTML = `<div class="kartu"><h3>Ajari ${NAMA} sesuatu</h3><div class="baris"><input type="text" id="mBaru" placeholder="mis. Aku alergi udang"><button class="tombol utama" id="mTambah">Simpan</button></div></div><div class="kartu" id="mDaftar">Memuat…</div>`;
  const muat = async () => {
    const { memori } = await api("/api/memori");
    $("#mDaftar").innerHTML = `<h3>${memori.length} ingatan</h3>` + (memori.map((f) => `<div class="mem"><span>${esc(f.teks)} <span class="kecil">· ${esc(f.kategori)} · ${"★".repeat(f.penting)}</span></span><button data-id="${f.id}" title="Lupakan">🗑</button></div>`).join("") || '<p class="kecil">Belum ada.</p>');
    $("#mDaftar").onclick = async (e) => { const id = e.target.closest("[data-id]")?.dataset.id; if (id) { await api(`/api/memori/${id}`, { method: "DELETE" }); muat(); } };
  };
  $("#mTambah").onclick = async () => { const t = $("#mBaru").value.trim(); if (!t) return; await api("/api/memori", { method: "POST", body: JSON.stringify({ teks: t }) }); $("#mBaru").value = ""; muat(); };
  muat();
}

async function renderBerkas(el) {
  const { berkas } = await api("/api/berkas");
  el.innerHTML = `<div class="kartu"><h3>Hasil kerja ${NAMA}</h3><p class="kecil">Minta misalnya: "rangkum berita X dan simpan jadi berkas". ${NAMA} hanya bisa menulis di folder ini.</p>
  ${berkas.map((b) => `<div class="mem"><span><a href="/api/berkas/${encodeURIComponent(b.nama)}" style="color:var(--ink)">📄 ${esc(b.nama)}</a> <span class="kecil">${(b.ukuran / 1024).toFixed(1)} KB · ${new Date(b.at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span></span><button data-n="${esc(b.nama)}">🗑</button></div>`).join("") || '<p class="kecil">Belum ada berkas.</p>'}</div>`;
  el.onclick = async (e) => { const n = e.target.closest("[data-n]")?.dataset.n; if (n && confirm(`Hapus ${n}?`)) { await api(`/api/berkas/${encodeURIComponent(n)}`, { method: "DELETE" }); renderBerkas(el); } };
}

function renderAtur(el) {
  const b = S.biaya || {};
  el.innerHTML = `
  <div class="kartu"><h3>Pemakaian</h3><p class="kecil">${S.demo ? "Mode DEMO (tanpa Claude)." : `Perkiraan kredit Agent SDK bulan ini: <b>$${(b.bulanIni || 0).toFixed(2)}</b> · total $${(b.total || 0).toFixed(2)}`}</p></div>
  <div class="kartu"><h3>💌 Pesan dari ${esc(NAMA)}</h3>
    <label class="baris"><input type="checkbox" id="aProaktif" ${S.pengaturan?.proaktif !== false ? "checked" : ""}> ${esc(NAMA)} boleh menyapa duluan (pagi, malam, saat kangen)</label>
    <button class="tombol" id="aNotif">🔔 Izinkan notifikasi browser</button> <span class="kecil">${"Notification" in window ? Notification.permission : "tidak didukung"}</span></div>
  <div class="kartu"><h3>Keamanan</h3><p class="kecil">${NAMA} berjalan terpisah: tanpa akses file/perintah di rig, tanpa akses jaringan lokal. Ia hanya bisa mencari di internet, membaca halaman publik, mengingat, dan menulis berkas di folder kerjanya sendiri.</p></div>
  <div class="kartu"><h3>Mulai ulang</h3>
    <div class="baris" style="flex-wrap:wrap">
      <button class="tombol" data-r="riwayat">Hapus riwayat obrolan</button>
      <button class="tombol" data-r="memori">Hapus semua ingatan</button>
      <button class="tombol" data-r="kepribadian">Reset kepribadian</button>
      <button class="tombol bahaya" data-r="semua">Reset semuanya</button></div></div>
  <div class="kartu"><a class="tombol" href="/logout" style="text-decoration:none;color:inherit">Keluar</a></div>`;
  el.querySelector("#aProaktif").onchange = (e) => simpanPengaturan({ proaktif: e.target.checked });
  el.querySelector("#aNotif").onclick = async () => { if ("Notification" in window) { await Notification.requestPermission(); renderAtur(el); } };
  el.onclick = async (e) => {
    const r = e.target.closest("[data-r]")?.dataset.r; if (!r) return;
    if (!confirm(`Yakin? (${r}) Tidak bisa dibatalkan.`)) return;
    await api("/api/reset", { method: "POST", body: JSON.stringify({ apa: r }) });
    S = await api("/api/state"); segarkanHati();
    if (r === "riwayat" || r === "semua") chatLog = [];
    toast("Selesai.");
  };
}

// ---------- Pesan proaktif (dia menyapa duluan) ----------
let notifSejak = bacaLokal(`aira-notif-${S.karakter.aktif.id}`, Date.now() - 3 * 864e5);
async function cekNotif() {
  try {
    const { pesan, sekarang } = await api(`/api/notif?sejak=${notifSejak}`);
    for (const m of pesan) {
      if (!chatLog.some((x) => x.at === m.at && x.teks === m.teks)) tambahLog({ ...m });
      subjudul(m.teks); toast(`💌 ${NAMA}: ${m.teks}`, 6000);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(NAMA, { body: m.teks, icon: "/icon.svg" });
    }
    notifSejak = sekarang; simpanLokal(`aira-notif-${S.karakter.aktif.id}`, notifSejak);
  } catch {}
}
setInterval(cekNotif, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cekNotif(); });
$("#nama").onclick = () => bukaLaci("karakter");
$("#chipAdegan").onclick = () => bukaLaci("kencan");
$("#bHadiah").onclick = () => bukaLaci("kencan");

// ---------- Mulai ----------
segarkanHati();
terapkanAdegan();
cekNotif();
api("/api/riwayat?n=80").then(({ riwayat }) => { chatLog = riwayat.map((m) => ({ ...m })); if (tabAktif === "chat" && $("#laci").classList.contains("on")) render(); });
await pakaiAvatar();
if (S.demo) toast("Mode demo: avatar & suara bisa dicoba, jawaban masih contoh.", 5000);
if (bacaLokal("aira-kamera", false)) nyalakanKamera(true);
const sapa = S.jiwa.terakhir ? (Date.now() - S.jiwa.terakhir > 864e5 ? `Akhirnya kamu datang… aku kangen 🥺` : `Hai lagi, ${USER} 😊`) : `Hai ${USER}! Aku ${NAMA}. Senang akhirnya ketemu kamu 💗`;
subjudul(sapa);
setTimeout(() => { if ($("#subTeks").textContent === sapa) subjudul(""); }, 7000);
window.aira = { panggung, pembicara, premium }; // untuk debug dari konsol browser
