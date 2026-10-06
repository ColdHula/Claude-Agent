# Memasang Kantor PGA di rig HiveOS

Hasilnya: Kantor PGA berjalan 24 jam di rig, otomatis menyala setelah rig reboot, dan bisa dibuka
dari HP, Chromebook, atau laptop di mana saja lewat **Tailscale** (jaringan pribadi gratis untuk
pemakaian pribadi). Aplikasi tidak dibuka ke internet umum, dan tetap dilindungi kata sandi.

Biaya: tidak ada biaya VPS. Pemakaian Claude diambil dari kredit Agent SDK langganan Anda.

## Yang perlu disiapkan

1. **Token langganan Claude.** Di Chromebook (Terminal Linux), jalankan:
   ```
   npx -y @anthropic-ai/claude-code setup-token
   ```
   Login dengan akun Claude Pro/Max, lalu salin token yang muncul (diawali `sk-ant-oat01-`).
   Simpan sementara; token ini setara kata sandi, jangan dibagikan.
2. **Akses terminal ke rig.** Di dasbor HiveOS (https://the.hiveos.farm) buka rig Anda →
   menu **Remote access** → **Hive Shell** (atau SSH dari jaringan yang sama: `ssh user@<IP-rig>`).
3. **Akun Tailscale** (https://tailscale.com, daftar dengan akun Google), dan pasang aplikasi
   Tailscale di HP dan Chromebook Anda, login dengan akun yang sama.

## Pemasangan (sekali, ±5 menit)

Di terminal rig, tempel perintah ini lalu Enter:

```
curl -fsSL https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-hiveos.sh | sudo bash
```

**Bila repo GitHub sudah dijadikan private**, buat token di GitHub → *Settings* → *Developer settings* →
*Fine-grained tokens* (repo `Claude-Agent`, izin *Contents: Read-only*), lalu pakai perintah ini sebagai gantinya:

```
export GH_TOKEN=github_pat_xxxxx
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" https://raw.githubusercontent.com/ColdHula/Claude-Agent/claude/bold-feynman-27cfgv/deploy/pasang-hiveos.sh | sudo -E bash
```

Skrip akan bertanya:
- **Token**: tempel token dari langkah 1.
- **Kata sandi aplikasi**: buat minimal 12 karakter (atau kosongkan untuk dibuatkan; catat yang muncul).
- **Pasang Tailscale?**: tekan Enter (Ya). Buka tautan login yang muncul, login dengan akun Tailscale Anda.

Di akhir, skrip menampilkan alamat seperti `https://kantor-pga.xxxx.ts.net`. Buka alamat itu di
HP/Chromebook (Tailscale harus menyala di perangkat itu), masukkan kata sandi aplikasi, dan Kantor PGA siap.

Bila muncul pesan HTTPS Tailscale belum aktif: buka https://login.tailscale.com/admin/dns,
aktifkan **MagicDNS** dan **HTTPS Certificates**, lalu di rig jalankan `sudo tailscale serve --bg 3000`.

## Sehari-hari

| Perlu | Perintah di rig |
|---|---|
| Melihat log | `sudo journalctl -u kantor-pga -f` |
| Restart aplikasi | `sudo systemctl restart kantor-pga` |
| Memperbarui ke versi terbaru | jalankan lagi perintah pemasangan di atas |
| Mengganti token / kata sandi | `nano /home/user/kantor-pga/.env`, simpan, lalu restart |
| Menambah pengetahuan | di aplikasi: kartu **Pengetahuan kantor** → **⬆ Unggah paket ZIP** (atau salin file ke `/home/user/kantor-pga/pengetahuan/`) |

## Memasukkan konteks ADM PGD (sekali)

1. Buka aplikasi dari HP/Chromebook, masuk dengan kata sandi.
2. Di panel kanan, kartu **Pengetahuan kantor** → **⬆ Unggah paket ZIP** → pilih `pengetahuan-kantor-pga.zip`.
3. Kartu menampilkan jumlah file per Sim. Tugas berikutnya langsung memakai konteks itu.

Paket ZIP ini berisi data internal PGD (nama karyawan, kasus, template). Simpan hanya di perangkat Anda dan rig, jangan diunggah ke GitHub.

## Catatan keamanan

- Ganti kata sandi bawaan login rig HiveOS bila belum (`passwd`), karena rig kini menyimpan token Claude dan data PGD.
- Jangan membuka port 3000 ke internet (port forwarding router). Pakai Tailscale.
- Aplikasi berjalan dengan prioritas di bawah miner (`Nice=10`) dan dibatasi memori 1,5 GB, sehingga hashrate tidak terganggu.
- Rig butuh HiveOS berbasis Ubuntu 20.04/22.04 (glibc ≥ 2.28). Skrip memeriksa ini dan memberi tahu bila perlu memperbarui image.
