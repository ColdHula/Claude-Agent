// Kata sandi sederhana untuk Kantor PGA. Wajib bila server dibuka di luar laptop
// sendiri (HOST bukan 127.0.0.1, atau di belakang Tailscale/Cloudflare), karena
// tanpa ini siapa pun yang bisa membuka alamatnya bisa memakai kredit Claude dan
// membaca hasil kerja serta pengetahuan PGD.
import crypto from "node:crypto";

const COOKIE = "kpga";
const MAX_AGE = 30 * 24 * 3600; // 30 hari
const attempts = new Map(); // ip -> { n, until }

export function makeAuth(password) {
  if (!password) return null;
  const token = crypto.createHmac("sha256", password).update("kantor-pga-sesi-v1").digest("hex");

  function cookieOf(req) {
    const raw = req.headers.cookie || "";
    const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    return m ? m[1] : "";
  }
  function ok(req) {
    const got = Buffer.from(cookieOf(req));
    const want = Buffer.from(token);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  function secureFlag(req) {
    return req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  }

  function page(res, status, message = "") {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk · Kantor PGA</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0e1424">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600&family=Nunito:wght@600;800&display=swap">
<style>
:root{--sky:#cfe9f7;--ink:#17324d;--blue:#1769c9;--green:#3fc948;--bad:#e2453c}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;
background:radial-gradient(900px 500px at 30% -10%,#e9f6fd,var(--sky) 45%,#9fd0ee);color:var(--ink);font:15px/1.5 Nunito,system-ui,sans-serif}
form{background:#fff;border-radius:22px;padding:28px 24px;width:min(360px,100%);box-shadow:0 10px 30px rgba(23,50,77,.18);display:grid;gap:14px;text-align:center}
svg{margin:0 auto}h1{font:600 24px Fredoka,Nunito,sans-serif;margin:0}p{margin:0;color:#55708a;font-size:13.5px}
input{font:inherit;padding:12px 14px;border-radius:14px;border:2px solid #d4e4f1;background:#eef6fc;width:100%}
input:focus{outline:none;border-color:#3b9be8;background:#fff}
button{font:600 17px Fredoka,Nunito,sans-serif;color:#fff;border:0;border-radius:999px;padding:12px;cursor:pointer;
background:linear-gradient(180deg,#4fb0ff,var(--blue));box-shadow:0 3px 0 #0d4f9c}
.err{color:var(--bad);font-weight:800}
</style></head><body>
<form method="post" action="/login">
<svg width="26" height="40" viewBox="0 0 22 34" aria-hidden="true"><path d="M11 0 L22 15 L11 34 L0 15 Z" fill="#3fc948" stroke="#1a7a24"/></svg>
<h1>Kantor PGA</h1><p>Masukkan kata sandi untuk masuk ke kantor.</p>
${message ? `<p class="err">${message}</p>` : ""}
<label for="pw" style="position:absolute;left:-9999px">Kata sandi</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Masuk ➜</button>
</form></body></html>`);
  }

  // Mengembalikan true bila permintaan sudah ditangani (login/logout/ditolak).
  // Ikon dan manifest boleh diambil tanpa login (dipakai bookmark / "Tambahkan ke Layar Utama").
  const PUBLIC = /^\/(icon\.svg|manifest\.webmanifest|favicon\.ico|icons\/[\w.-]+\.png)$/;

  return async function guard(req, res, url) {
    if (PUBLIC.test(url.pathname)) return false;
    if (url.pathname === "/logout") {
      res.writeHead(302, { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`, location: "/login" });
      res.end();
      return true;
    }
    if (url.pathname === "/login") {
      if (req.method !== "POST") {
        page(res, 200);
        return true;
      }
      const ip = req.socket.remoteAddress || "?";
      const a = attempts.get(ip) || { n: 0, until: 0 };
      if (Date.now() < a.until) {
        page(res, 429, "Terlalu banyak percobaan. Tunggu 1 menit.");
        return true;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10_000) break;
      }
      const given = new URLSearchParams(body).get("password") || "";
      const g = Buffer.from(crypto.createHash("sha256").update(given).digest("hex"));
      const w = Buffer.from(crypto.createHash("sha256").update(password).digest("hex"));
      if (crypto.timingSafeEqual(g, w)) {
        attempts.delete(ip);
        res.writeHead(302, {
          "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag(req)}`,
          location: "/",
        });
        res.end();
      } else {
        a.n += 1;
        if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 60_000 });
        attempts.set(ip, a);
        page(res, 401, "Kata sandi salah.");
      }
      return true;
    }
    if (ok(req)) return false;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/hasil/")) {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Belum masuk. Muat ulang halaman lalu masukkan kata sandi." }));
    } else {
      res.writeHead(302, { location: "/login" });
      res.end();
    }
    return true;
  };
}
