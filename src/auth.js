// Kata sandi sederhana untuk Kantor PGA. Wajib bila server dibuka di luar laptop
// sendiri (HOST bukan 127.0.0.1, atau di belakang Tailscale/Cloudflare), karena
// tanpa ini siapa pun yang bisa membuka alamatnya bisa memakai kredit Claude dan
// membaca hasil kerja serta pengetahuan PGD.
import crypto from "node:crypto";

const COOKIE = "kpga";
const MAX_AGE = 30 * 24 * 3600; // 30 hari
const attempts = new Map(); // ip -> { n, until }

// brand: { name, tagline, iconHref, themeColor, dark } — biarkan kosong untuk tampilan Kantor PGA.
export function makeAuth(password, brand = {}) {
  if (!password) return null;
  const token = crypto.createHmac("sha256", password).update("kantor-pga-sesi-v1").digest("hex");
  const B = {
    name: brand.name || "Kantor PGA",
    tagline: brand.tagline || "Masukkan kata sandi untuk masuk ke kantor.",
    iconHref: brand.iconHref || null,
    themeColor: brand.themeColor || "#0e1424",
    dark: brand.dark || false,
  };

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
    const logo = B.iconHref
      ? `<img src="${B.iconHref}" width="56" height="56" alt="" style="margin:0 auto;border-radius:14px">`
      : `<svg width="26" height="40" viewBox="0 0 22 34" aria-hidden="true" style="margin:0 auto;display:block"><path d="M11 0 L22 15 L11 34 L0 15 Z" fill="#3fc948" stroke="#1a7a24"/></svg>`;
    const css = B.dark
      ? `:root{--ink:#e7edfb;--dim:#8da2c8;--line:#223154;--accent:#5b8cff;--accent2:#7aa2ff;--bad:#ff6b6b}
body{background:radial-gradient(900px 500px at 30% -10%,#101a36,#0b1020 55%,#0a0f1e);color:var(--ink)}
form{background:#121a30;border:1px solid var(--line);box-shadow:0 20px 50px rgba(0,0,0,.5)}
p{color:var(--dim)}
input{border:2px solid var(--line);background:#0e1627;color:var(--ink)}
input:focus{border-color:var(--accent);background:#0b1222}
button{background:linear-gradient(180deg,var(--accent2),var(--accent));box-shadow:0 3px 0 #2a52b8}`
      : `:root{--sky:#cfe9f7;--ink:#17324d;--blue:#1769c9;--bad:#e2453c}
body{background:radial-gradient(900px 500px at 30% -10%,#e9f6fd,var(--sky) 45%,#9fd0ee);color:var(--ink)}
form{background:#fff;box-shadow:0 10px 30px rgba(23,50,77,.18)}
p{color:#55708a}
input{border:2px solid #d4e4f1;background:#eef6fc}
input:focus{border-color:#3b9be8;background:#fff}
button{background:linear-gradient(180deg,#4fb0ff,var(--blue));box-shadow:0 3px 0 #0d4f9c}`;
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Masuk · ${B.name}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="${B.themeColor}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600&family=Nunito:wght@600;800&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:15px/1.5 Nunito,system-ui,sans-serif}
form{border-radius:22px;padding:28px 24px;width:min(360px,100%);display:grid;gap:14px;text-align:center}
h1{font:600 24px Fredoka,Nunito,sans-serif;margin:0}p{margin:0;font-size:13.5px}
input{font:inherit;padding:12px 14px;border-radius:14px;width:100%}
input:focus{outline:none}
button{font:600 17px Fredoka,Nunito,sans-serif;color:#fff;border:0;border-radius:999px;padding:12px;cursor:pointer}
.err{color:var(--bad);font-weight:800}
${css}
</style></head><body>
<form method="post" action="/login">
${logo}
<h1>${B.name}</h1><p>${B.tagline}</p>
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
