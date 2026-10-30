// Akses web Aira yang dipagari: hanya alamat internet publik.
// LAN, rig, router, Tailscale, localhost, dan domain yang RESOLVE ke IP lokal ditolak,
// termasuk di setiap lompatan redirect. Ini lapisan aplikasi; lapisan OS (systemd + iptables)
// dipasang oleh deploy/pasang-aira.sh.
import { lookup as dnsLookup } from "node:dns/promises";

export function isPrivateIp(ip) {
  ip = String(ip).toLowerCase();
  if (ip.includes(":")) { // IPv6
    if (ip.startsWith("::ffff:") && ip.includes(".")) return isPrivateIp(ip.slice(7)); // IPv4-mapped
    return ip === "::1" || ip === "::" || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") ||
      ip.startsWith("feb") || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("ff") || ip.startsWith("64:ff9b");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // aneh → blokir
  const [a, b] = p;
  return a === 0 || a === 127 || a === 10 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 168 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 0 && p[2] === 0 || a === 198 && (b === 18 || b === 19);
}

function blockedHostName(h) {
  h = String(h).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return !h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".ts.net") || h.endsWith(".local") ||
    h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa") || h.endsWith(".hiveos") ||
    (/^[\d.]+$/.test(h) && isPrivateIp(h)) || (h.includes(":") && isPrivateIp(h)) ||
    /^\d+$/.test(h) || /^0x/i.test(h); // bentuk IP desimal/hex aneh
}

export async function urlAman(u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol) || x.username || x.password) return false;
  if (x.port && !["80", "443", "8080", "8443"].includes(x.port)) return false;
  const host = x.hostname.replace(/^\[|\]$/g, "");
  if (blockedHostName(host)) return false;
  try {
    const addrs = await dnsLookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return false;
  } catch { return false; }
  return true;
}

const decodeEnt = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

function htmlKeTeks(html) {
  const judul = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const isi = decodeEnt(html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { judul: decodeEnt(judul), isi };
}

// Ambil halaman publik → teks bersih. Redirect diikuti manual (maks. 5) dan tiap lompatan dicek ulang.
export async function ambilHalaman(u, maksKarakter = 12000) {
  let url = String(u || "").trim();
  for (let lompat = 0; lompat < 6; lompat++) {
    if (!(await urlAman(url))) return { url, error: "Alamat ditolak: hanya situs internet publik (jaringan lokal/rig diblokir)." };
    let r;
    try {
      r = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Aira/1.0", accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5" },
      });
    } catch (e) {
      return { url, error: e?.name === "TimeoutError" ? "Waktu habis." : String(e?.message || e) };
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url).href;
      continue;
    }
    if (!r.ok) return { url, error: `HTTP ${r.status}` };
    const ct = r.headers.get("content-type") || "";
    if (!/text|json|xml|html/i.test(ct)) return { url, error: `Jenis konten tidak didukung (${ct || "?"}).` };
    const reader = r.body.getReader();
    let raw = "", dec = new TextDecoder();
    for (;;) { // batasi unduhan ±2 MB
      const { done, value } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      if (raw.length > 2_000_000) { reader.cancel().catch(() => {}); break; }
    }
    if (/json/i.test(ct)) return { url, judul: "", isi: raw.slice(0, maksKarakter) };
    const { judul, isi } = /html|xml/i.test(ct) ? htmlKeTeks(raw) : { judul: "", isi: raw };
    return { url, judul, isi: isi.slice(0, maksKarakter), terpotong: isi.length > maksKarakter };
  }
  return { url, error: "Terlalu banyak redirect." };
}
