// Kontak mata: kamera depan dibaca DI BROWSER (MediaPipe Face Landmarker). Gambar tidak pernah
// dikirim ke server; yang dikirim hanya isyarat ringkas (ada wajah / tersenyum / menoleh).
import { FilesetResolver, FaceLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export class Mata {
  constructor(video) {
    this.video = video;
    this.aktif = false;
    this.isyarat = { kamera: false, wajah: false, senyum: false, menoleh: false };
    this.posisi = { x: 0, y: 0 }; // -1..1, sudah dicerminkan
    this.onUbah = null;
  }
  async nyalakan() {
    if (this.aktif) return;
    const fs = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
    this.fl ||= await FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
    });
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.aktif = true;
    this.isyarat.kamera = true;
    this.terakhir = -1;
    this.putar();
  }
  matikan() {
    this.aktif = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.isyarat = { kamera: false, wajah: false, senyum: false, menoleh: false };
    this.posisi = { x: 0, y: 0 };
  }
  putar() {
    if (!this.aktif) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && now - this.terakhir > 66) { // ±15 fps cukup
      this.terakhir = now;
      const r = this.fl.detectForVideo(this.video, now);
      const lm = r.faceLandmarks?.[0];
      const lama = JSON.stringify(this.isyarat);
      if (lm) {
        const hidung = lm[1], kiri = lm[234], kanan = lm[454];
        this.posisi.x += ((-(hidung.x - 0.5) * 2) - this.posisi.x) * 0.3; // cermin
        this.posisi.y += ((-(hidung.y - 0.45) * 2) - this.posisi.y) * 0.3;
        const bs = Object.fromEntries((r.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
        const lebar = Math.abs(kanan.x - kiri.x) || 1;
        const yaw = ((hidung.x - kiri.x) / lebar) - 0.5; // ±0.5
        this.isyarat.wajah = true;
        this.isyarat.senyum = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2 > 0.45;
        this.isyarat.menoleh = Math.abs(yaw) > 0.22;
      } else {
        this.isyarat.wajah = false; this.isyarat.senyum = false; this.isyarat.menoleh = false;
        this.posisi.x *= 0.9; this.posisi.y *= 0.9;
      }
      if (JSON.stringify(this.isyarat) !== lama) this.onUbah?.(this.isyarat);
    }
    requestAnimationFrame(() => this.putar());
  }
}
