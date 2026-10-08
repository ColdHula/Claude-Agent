# Memakai Kantor PGA & Nexa di Chromebook

Dua aplikasi berjalan di rig Anda dan dibuka lewat Tailscale:

| Aplikasi | Alamat | Kata sandi |
|---|---|---|
| **Kantor PGA** (tim Claude) | `https://<nama-rig>.ts.net` | kata sandi Kantor PGA |
| **Nexa** (AI lokal, chat + coding) | `https://<nama-rig>.ts.net:8443` | kata sandi Nexa (terpisah) |

> Ganti `<nama-rig>` dengan nama rig Anda di Tailscale (lihat https://login.tailscale.com/admin/machines, mis. `kantor-pga.xxxx.ts.net`).

---

## Bagian 1 — Pasang Tailscale (sekali saja)

1. Buka **Play Store** di Chromebook → cari **Tailscale** → **Pasang**.
   - Jika Play Store belum ada: **Settings → Apps → Google Play Store → Turn on**.
2. Buka **Tailscale** → **Login** dengan akun **yang sama** seperti di rig.
3. Pastikan statusnya **Connected / Aktif**. Biarkan tetap aktif.

> Tanpa Tailscale aktif, alamat `ts.net` tidak akan terbuka. Ini wajar: aksesnya memang
> hanya lewat jaringan pribadi Tailscale, tidak terbuka ke internet.

---

## Bagian 2 — Buka aplikasinya

1. Buka **Chrome**.
2. Ketik alamat aplikasinya (lihat tabel di atas).
3. Masukkan kata sandi → **Masuk**.
   - Kantor PGA: pil kanan atas harus **● Langganan**.
   - Nexa: pilih model di pojok kiri atas; nyalakan tombol **💻 Coding** bila mau coding.

---

## Bagian 3 — Pasang sebagai aplikasi (ada ikon di launcher)

Lakukan untuk masing-masing alamat, jadi ada dua ikon terpisah:

1. Buka alamatnya di Chrome.
2. Klik menu **⋮** (kanan atas) → **Cast, save, and share** → **Install page as app…**
   - Atau klik ikon **⊕ / layar dengan panah** di ujung kanan address bar.
3. Ikon muncul di **launcher** (lingkaran di kiri bawah) dan bisa dibuka seperti aplikasi biasa.
4. Agar menetap di rak bawah: klik kanan ikonnya → **Pin to shelf**.

Sekarang Kantor PGA dan Nexa punya ikon sendiri dan bisa dibuka tanpa mengetik alamat.

---

## Bagian 4 — Memberi akses ke teman / pacar

Bagikan **perangkat rig** ke akun Tailscale mereka (bukan akun atau jaringan Anda):

1. Minta mereka membuat akun gratis di tailscale.com dan memasang aplikasi Tailscale
   (Chromebook: Play Store; HP: Play Store / App Store), lalu login.
2. Di HP/Chromebook Anda buka https://login.tailscale.com/admin/machines
3. Cari perangkat **`<nama-rig>`** → menu **⋯** → **Share…**
4. Masukkan **email akun Tailscale** teman Anda → **Share**. Mereka menerima undangan; minta diterima.
5. Beri tahu mereka **alamat** + **kata sandi** aplikasi yang boleh dibuka.

**Keamanan:**
- Beri **kata sandi Nexa** saja bila hanya ingin mereka memakai AI lokal — mereka **tidak** bisa membuka Kantor PGA (data PGD aman).
- Mencabut akses kapan saja: menu **⋯** perangkat → **Unshare**.
- Jangan pernah memberi login HiveOS atau akun Tailscale Anda. Jangan pakai port forwarding router.

---

## Bila ada masalah di Chromebook

| Gejala | Solusi |
|---|---|
| Alamat `ts.net` tidak terbuka | Pastikan Tailscale **Connected**. Lalu di Chrome buka `chrome://settings/security` → matikan **Use secure DNS** sementara. |
| "Your connection is not private" | Pastikan Anda mengetik **https://** dan nama rig benar. HTTPS Tailscale harus sudah dinyalakan (Bagian 0 tutorial utama). |
| Nexa: daftar model kosong | Model belum diunduh di rig: `OLLAMA_HOST=127.0.0.1:11434 ollama pull qwen2.5-coder:14b` |
| Nexa lambat menjawab | Wajar — model jalan di CPU rig. Chromebook hanya menampilkan. Pakai model 7B bila mau lebih cepat. |
| Play Store tidak ada | Settings → Apps → Google Play Store → Turn on (beberapa Chromebook sekolah/kantor mematikannya). |

---

Panduan lengkap pemasangan rig ada di `deploy/HIVEOS.md`.
