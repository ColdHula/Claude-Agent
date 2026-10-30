"""Layanan GPU Aira (mode Premium): teks -> suara neural Indonesia -> video bicara foto-realistis (Ditto).

Berjalan sebagai pengguna `aira-gpu` (lihat deploy/pasang-ditto.sh) dan hanya mendengarkan di Unix socket,
jadi tidak terbuka ke jaringan. Server Aira (Node) memanggilnya per kalimat:

  GET  /status                 -> {"siap": bool, "gpu": "...", "suara": "..."}
  PUT  /foto/<id>              -> simpan foto sumber (byte JPG/PNG/WEBP)
  POST /klip  {teks, foto, suara?, laju?, nada?, emosi?}
       -> video/mp4 (H.264 + AAC), atau 404 {"perlu_foto": true} bila foto belum dikirim

Ditto: https://github.com/antgroup/ditto-talkinghead (Apache-2.0). Suara: edge-tts (layanan Microsoft).
"""
import asyncio
import hashlib
import http.server
import json
import math
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

DITTO_DIR = os.environ.get("DITTO_DIR", "/opt/aira-ditto/ditto-talkinghead")
DATA_ROOT = os.environ.get("DITTO_DATA_ROOT", os.path.join(DITTO_DIR, "checkpoints", "ditto_trt_Ampere_Plus"))
CFG_PKL = os.environ.get("DITTO_CFG", os.path.join(DITTO_DIR, "checkpoints", "ditto_cfg", "v0.4_hubert_cfg_trt.pkl"))
SOCK = os.environ.get("DITTO_SOCK", "/run/aira-ditto/ditto.sock")
STATE = os.environ.get("DITTO_STATE", "/var/lib/aira-ditto")
SUARA = os.environ.get("AIRA_SUARA", "id-ID-GadisNeural")
LANGKAH = int(os.environ.get("DITTO_STEPS", "25"))          # sampling_timesteps (bawaan Ditto 50; 25 ~2x lebih cepat)
MAKS_FOTO = int(os.environ.get("DITTO_MAX_SIDE", "1024"))   # sisi terpanjang foto sumber
MAKS_CACHE = int(os.environ.get("DITTO_CACHE_MB", "2048")) * 1024 * 1024
# Label emosi Ditto (setup_kwargs "emo"; bawaan 4 = netral). Urutan ini dugaan dari model emosi umum;
# ubah lewat DITTO_EMO='{"happy":3,...}' bila hasilnya tidak cocok.
EMO = json.loads(os.environ.get("DITTO_EMO", '{"angry":0,"happy":3,"neutral":4,"sad":5,"surprised":6,"relaxed":4,"shy":3}'))

FOTO_DIR = os.path.join(STATE, "foto")
KLIP_DIR = os.path.join(STATE, "klip")
os.makedirs(FOTO_DIR, exist_ok=True)
os.makedirs(KLIP_DIR, exist_ok=True)

sys.path.insert(0, DITTO_DIR)
os.chdir(DITTO_DIR)

SDK = None
GALAT = ""
KUNCI_GPU = threading.Lock()
NAMA_GPU = ""


def muat_sdk():
    global SDK, GALAT, NAMA_GPU
    try:
        import torch  # noqa: F401  (Ditto memakai torch untuk beberapa bagian)
        from stream_pipeline_offline import StreamSDK
        SDK = StreamSDK(CFG_PKL, DATA_ROOT)
        try:
            NAMA_GPU = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader", "-i",
                                       os.environ.get("CUDA_VISIBLE_DEVICES", "0").split(",")[0]],
                                      capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception:
            NAMA_GPU = "?"
        print(f"Ditto siap di {NAMA_GPU} (langkah={LANGKAH})", flush=True)
    except Exception as e:  # tetap hidup agar /status bisa melaporkan masalahnya
        GALAT = f"{type(e).__name__}: {e}"
        print("Gagal memuat Ditto:", GALAT, flush=True)


def aman_id(s):
    return re.sub(r"[^A-Za-z0-9_-]", "", str(s))[:64]


def siapkan_foto(asal, tujuan):
    """Perkecil foto ke MAKS_FOTO agar cepat; simpan PNG."""
    import cv2
    img = cv2.imread(asal, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("foto tidak bisa dibaca")
    h, w = img.shape[:2]
    f = min(1.0, MAKS_FOTO / max(h, w))
    if f < 1:
        img = cv2.resize(img, (int(w * f) // 2 * 2, int(h * f) // 2 * 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(tujuan, img)


def tts(teks, suara, laju, nada, keluar_wav):
    import edge_tts
    mp3 = keluar_wav[:-4] + ".mp3"
    asyncio.run(edge_tts.Communicate(teks, suara, rate=laju, pitch=nada).save(mp3))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", mp3, "-ac", "1", "-ar", "16000", keluar_wav], check=True)
    os.remove(mp3)


def jalankan_ditto(wav, foto, keluar, emosi):
    """Sama seperti inference.run() di repo Ditto, mode offline, ditambah kontrol emosi & langkah."""
    import librosa
    audio, _ = librosa.core.load(wav, sr=16000)
    n = math.ceil(len(audio) / 16000 * 25)
    tmp_mp4 = keluar + ".tmp.mp4"
    with KUNCI_GPU:
        SDK.setup(foto, tmp_mp4, emo=EMO.get(emosi, 4), sampling_timesteps=LANGKAH)
        SDK.setup_Nd(N_d=n, fade_in=-1, fade_out=-1, ctrl_info={})
        SDK.audio2motion_queue.put(SDK.wav2feat.wav2feat(audio))
        SDK.close()
        hasil = SDK.tmp_output_path
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", hasil, "-i", wav, "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", keluar], check=True)
    for f in (tmp_mp4, hasil):
        try:
            os.remove(f)
        except OSError:
            pass


def rapikan_cache():
    berkas = sorted((os.path.join(KLIP_DIR, f) for f in os.listdir(KLIP_DIR)), key=os.path.getmtime)
    total = sum(os.path.getsize(f) for f in berkas)
    while berkas and total > MAKS_CACHE:
        f = berkas.pop(0)
        total -= os.path.getsize(f)
        os.remove(f)


class Penangan(http.server.BaseHTTPRequestHandler):
    server_version = "AiraDitto/1.0"

    def address_string(self):
        return "unix"

    def log_message(self, fmt, *args):
        print("[http]", fmt % args, flush=True)

    def _json(self, kode, data):
        b = json.dumps(data).encode()
        self.send_response(kode)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _badan(self, batas):
        n = int(self.headers.get("content-length") or 0)
        if n > batas:
            raise ValueError("terlalu besar")
        return self.rfile.read(n)

    def do_GET(self):
        if self.path == "/status":
            return self._json(200, {"siap": SDK is not None, "galat": GALAT, "gpu": NAMA_GPU, "suara": SUARA, "langkah": LANGKAH})
        self._json(404, {"error": "tidak ada"})

    def do_PUT(self):
        m = re.match(r"^/foto/([A-Za-z0-9_-]{1,64})$", self.path)
        if not m:
            return self._json(404, {"error": "tidak ada"})
        data = self._badan(40 * 1024 * 1024)
        fd, tmp = tempfile.mkstemp(dir=FOTO_DIR)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        try:
            siapkan_foto(tmp, os.path.join(FOTO_DIR, m.group(1) + ".png"))
        except Exception as e:
            return self._json(400, {"error": str(e)})
        finally:
            os.remove(tmp)
        self._json(200, {"ok": True})

    def do_POST(self):
        if self.path != "/klip":
            return self._json(404, {"error": "tidak ada"})
        if SDK is None:
            return self._json(503, {"error": f"Ditto belum siap: {GALAT or 'memuat…'}"})
        try:
            q = json.loads(self._badan(64 * 1024) or b"{}")
        except Exception:
            return self._json(400, {"error": "json?"})
        teks = re.sub(r"\s+", " ", str(q.get("teks", ""))).strip()[:400]
        if not teks:
            return self._json(400, {"error": "teks kosong"})
        foto_id = aman_id(q.get("foto"))
        foto = os.path.join(FOTO_DIR, foto_id + ".png")
        if not foto_id or not os.path.exists(foto):
            return self._json(404, {"perlu_foto": True})
        suara = str(q.get("suara") or SUARA)[:60]
        laju, nada = str(q.get("laju") or "+0%")[:8], str(q.get("nada") or "+0Hz")[:8]
        emosi = str(q.get("emosi") or "neutral")[:12]
        kunci = hashlib.sha1(json.dumps([teks, foto_id, os.path.getmtime(foto), suara, laju, nada, emosi, LANGKAH]).encode()).hexdigest()
        keluar = os.path.join(KLIP_DIR, kunci + ".mp4")
        t0 = time.time()
        if not os.path.exists(keluar):
            kerja = tempfile.mkdtemp(dir=STATE)
            try:
                wav = os.path.join(kerja, "suara.wav")
                tts(teks, suara, laju, nada, wav)
                jalankan_ditto(wav, foto, os.path.join(kerja, "klip.mp4"), emosi)
                shutil.move(os.path.join(kerja, "klip.mp4"), keluar)
            except Exception as e:
                return self._json(500, {"error": f"{type(e).__name__}: {e}"})
            finally:
                shutil.rmtree(kerja, ignore_errors=True)
            rapikan_cache()
        with open(keluar, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("content-type", "video/mp4")
        self.send_header("content-length", str(len(data)))
        self.send_header("x-durasi-proses", f"{time.time() - t0:.2f}")
        self.end_headers()
        self.wfile.write(data)


class ServerUnix(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


if __name__ == "__main__":
    threading.Thread(target=muat_sdk, daemon=True).start()
    if os.path.exists(SOCK):
        os.remove(SOCK)
    srv = ServerUnix(SOCK, Penangan)
    os.chmod(SOCK, 0o660)  # grup aira-gpu (pengguna 'aira' adalah anggotanya)
    print("Layanan Ditto mendengarkan di", SOCK, flush=True)
    srv.serve_forever()
