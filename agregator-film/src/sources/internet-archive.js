// Adapter sumber: Internet Archive (API resmi, ada metadata lisensi).
// Adapter lain cukup mengekspor fetchFilms(cfg) -> [{identifier,title,year,creator,description,subject[],licenseurl}]
const FIELDS = ['identifier', 'title', 'year', 'creator', 'description', 'subject', 'licenseurl'];

export async function fetchFilms(cfg) {
  let q = `collection:${cfg.collection} AND mediatype:movies`;
  if (cfg.onlyPublicDomainLicense) q += ' AND licenseurl:(*publicdomain*)';
  const u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', q);
  u.searchParams.set('rows', String(cfg.rows ?? 50));
  u.searchParams.set('sort[]', 'downloads desc');
  u.searchParams.set('output', 'json');
  for (const f of FIELDS) u.searchParams.append('fl[]', f);
  const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Internet Archive HTTP ${res.status}`);
  const { response } = await res.json();
  return response.docs;
}
