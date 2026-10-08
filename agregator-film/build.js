// Pemakaian: node build.js [--sample] [--config=config.json]
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { getAdapter } from './src/sources/index.js';

const args = process.argv.slice(2);
const useSample = args.includes('--sample');
const cfgPath = (args.find(a => a.startsWith('--config=')) ?? '--config=config.json').split('=')[1];
const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
const base = cfg.siteUrl.replace(/\/$/, '');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
const strip = s => String(arr(s).join(' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

let docs;
if (useSample) docs = JSON.parse(await readFile('data/sample.json', 'utf8'));
else {
  try { docs = await getAdapter(cfg.source.type).fetchFilms(cfg.source); }
  catch (e) { console.error('Gagal mengambil sumber:', e.message, '\nCoba: node build.js --sample'); process.exit(1); }
}

const films = docs.filter(d => d.identifier && d.title).map(d => ({
  id: d.identifier,
  title: strip(d.title),
  year: String(arr(d.year)[0] ?? ''),
  creator: strip(d.creator),
  desc: clip(strip(d.description), 400),
  tags: arr(d.subject).flatMap(t => String(t).split(/[;,]/)).map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
  license: arr(d.licenseurl)[0] ?? '',
}));

const css = `:root{--bg:#14110f;--fg:#f2ebe0;--mut:#a89e8f;--acc:#e0a23b;--card:#1f1b18}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
a{color:var(--acc)}header,main,footer{max-width:1100px;margin:auto;padding:16px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
header a.logo{font-size:1.4rem;font-weight:700;text-decoration:none}
input[type=search]{padding:10px 14px;border-radius:8px;border:1px solid #444;background:var(--card);color:var(--fg);min-width:240px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.card{background:var(--card);border-radius:10px;overflow:hidden;text-decoration:none;color:var(--fg)}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#000}.card div{padding:10px}
.card small{color:var(--mut)}.tag{display:inline-block;margin:2px;padding:2px 8px;border-radius:99px;background:var(--card);color:var(--mut);font-size:.85rem}
.player{position:relative;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}
.player iframe{width:100%;height:100%;border:0}
.gate{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;background:#000d;text-align:center;padding:16px}
.gate button{padding:12px 28px;border:0;border-radius:8px;background:var(--acc);font-size:1rem;cursor:pointer}.gate button:disabled{opacity:.5;cursor:wait}
.ad{margin:16px 0;text-align:center}footer{color:var(--mut);font-size:.9rem}`;

const layout = (title, desc, path, body, extraHead = '') => `<!doctype html>
<html lang="${cfg.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(clip(desc, 160))}">
<link rel="canonical" href="${base}${path}"><link rel="stylesheet" href="/style.css">${extraHead}</head><body>
<header><a class="logo" href="/">🎞️ ${esc(cfg.siteName)}</a>
<input type="search" id="q" placeholder="Cari judul, tahun, atau tag…" autocomplete="off"></header>
<main>${body}</main>
<footer>Semua film berstatus domain publik berdasarkan metadata lisensi sumbernya (${esc(cfg.source.type)}). Video disajikan lewat embed dari sumber asli; kami tidak menyimpan file video. Ada keberatan? Hubungi pengelola situs untuk penurunan konten.</footer>
<script src="/search.js"></script></body></html>`;

const thumb = id => `https://archive.org/services/img/${encodeURIComponent(id)}`;
const card = f => `<a class="card" href="/film/${encodeURIComponent(f.id)}.html"><img loading="lazy" src="${thumb(f.id)}" alt="${esc(f.title)}"><div><b>${esc(f.title)}</b><br><small>${esc(f.year)}</small></div></a>`;

await rm('dist', { recursive: true, force: true });
await mkdir('dist/film', { recursive: true });
await writeFile('dist/style.css', css);

await writeFile('dist/index.html', layout(`${cfg.siteName} — ${cfg.tagline}`, cfg.tagline, '/',
  `<h1>${esc(cfg.tagline)}</h1><div class="ad">${cfg.ads.sideHtml}</div><div class="grid" id="grid">${films.map(card).join('')}</div>`));

for (const f of films) {
  const related = films.filter(o => o.id !== f.id && o.tags.some(t => f.tags.includes(t))).slice(0, 4);
  const ld = { '@context': 'https://schema.org', '@type': 'VideoObject', name: f.title, description: f.desc || f.title,
    thumbnailUrl: thumb(f.id), embedUrl: `https://archive.org/embed/${f.id}`, ...(f.year && { uploadDate: `${f.year}-01-01` }), ...(f.license && { license: f.license }) };
  const body = `<h1>${esc(f.title)} ${f.year ? `(${esc(f.year)})` : ''}</h1>
<div class="player"><iframe id="v" data-src="https://archive.org/embed/${encodeURIComponent(f.id)}" allowfullscreen></iframe>
<div class="gate" id="gate"><div class="ad">${cfg.ads.prerollHtml}</div><button id="go" disabled>Tonton dalam <span id="n">${cfg.ads.prerollSeconds}</span> dtk</button></div></div>
<p>${esc(f.desc) || 'Belum ada sinopsis.'}</p>
${f.creator ? `<p><small>Sutradara/pembuat: ${esc(f.creator)}</small></p>` : ''}
<p>${f.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</p>
${f.license ? `<p><small>Lisensi: <a href="${esc(f.license)}" rel="noopener">${esc(f.license)}</a> · <a href="https://archive.org/details/${encodeURIComponent(f.id)}" rel="noopener">Halaman sumber</a></small></p>` : ''}
<div class="ad">${cfg.ads.sideHtml}</div>
${related.length ? `<h2>Film terkait</h2><div class="grid">${related.map(card).join('')}</div>` : ''}
<script>(function(){var n=${Number(cfg.ads.prerollSeconds) || 0},b=document.getElementById('go'),s=document.getElementById('n'),v=document.getElementById('v');
function open_(){document.getElementById('gate').remove();v.src=v.dataset.src}
if(!n){open_();return}
var t=setInterval(function(){n--;s.textContent=n;if(n<=0){clearInterval(t);b.disabled=false;b.textContent='▶ Putar film'}},1000);
b.onclick=open_})();</script>`;
  await writeFile(`dist/film/${f.id}.html`, layout(`Nonton ${f.title}${f.year ? ` (${f.year})` : ''} Subtitle & Gratis — ${cfg.siteName}`,
    f.desc || `Tonton ${f.title}, film domain publik.`, `/film/${encodeURIComponent(f.id)}.html`, body,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`));
}

await writeFile('dist/search.json', JSON.stringify(films.map(f => ({ id: f.id, t: f.title, y: f.year, g: f.tags }))));
await writeFile('dist/search.js', `(function(){var q=document.getElementById('q'),g=document.getElementById('grid'),d=null,h=g&&g.innerHTML;
if(!q||!g)return;q.addEventListener('input',function(){var s=q.value.trim().toLowerCase();
if(!s){g.innerHTML=h;return}
(d?Promise.resolve(d):fetch('/search.json').then(function(r){return r.json()}).then(function(x){return d=x})).then(function(a){
var e=function(t){var p=document.createElement('p');p.textContent=t;return p.innerHTML};
g.innerHTML=a.filter(function(f){return (f.t+' '+f.y+' '+f.g.join(' ')).toLowerCase().indexOf(s)>-1}).map(function(f){
return '<a class="card" href="/film/'+encodeURIComponent(f.id)+'.html"><div><b>'+e(f.t)+'</b><br><small>'+e(f.y)+'</small></div></a>'}).join('')||'<p>Tidak ditemukan.</p>'})})})();`);
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url>${films.map(f => `<url><loc>${base}/film/${encodeURIComponent(f.id)}.html</loc></url>`).join('')}</urlset>`);
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
console.log(`Selesai: ${films.length} film -> dist/ (domain: ${base})`);
