# Folder pengetahuan (rahasia, tidak ikut ke Git)

Mirip "Project knowledge" di claude.ai. File `.md`/`.txt` dibaca otomatis di setiap tugas, tanpa restart.

| Lokasi | Dibaca oleh |
|---|---|
| `pengetahuan/*.md` dan `pengetahuan/umum/*.md` | Pemimpin dan semua agent |
| `pengetahuan/<id-agent>/*.md` | Hanya agent itu, mis. `pengetahuan/surat-ba/` |
| `pengetahuan/pemimpin/*.md` | Hanya Pemimpin |

ID agent: `surat-ba`, `kepatuhan-perizinan`, `data-rekap`, `sop-k3-vendor`, `email-kalender`,
`chrome-portal`, `cari-cuan`, `riset`. Pemimpin melihat daftar file khusus tiap agent.

- Hanya README ini yang ikut ke GitHub; file lain tetap di komputer/rig Anda.
- Batas ±120.000 karakter per agent. Taruh hal yang dipakai semua agent di `umum/`, sisanya di folder agent.
