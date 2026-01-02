/* =======================
   EDF TEMPO LOGIC
======================= */

const TTL = 24 * 60 * 60 * 1000;

const LIMITS = {
  RED: 22,
  WHITE: 43,
  BLUE: 300
};

const now = () => Date.now();
const isExpired = (ts, ttl) => !ts || now() - ts > ttl;

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

export function getTodayDate() {
  const d = new Date();
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return formatDate(d);
}

export function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

function getSeason(today = new Date()) {
  const year = today.getFullYear();
  const sep1 = new Date(`${year}-09-01`);
  if (today >= sep1) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

/* =======================
   FETCH SAISON DATA
======================= */

async function fetchSeason(season, env) {
  const cacheKey = `TEMPO_STATS_${season}`;
  const cached = await env.TEMPO_CACHE.get(cacheKey, 'json');
  if (cached && !isExpired(cached.ts, TTL)) return cached;

  const url = `https://www.services-rte.com/cms/open_data/v1/tempo?season=${season}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  if (!res.ok) throw new Error(`Tempo API returned ${res.status}`);

  result = res.json();
  if (!result.values) throw new Error("Tempo data missing");

  await env.TEMPO_CACHE.put(cacheKey, JSON.stringify(result));

  return result;
}

/* =======================
   SEASON STATS
======================= */

export async function getSeasonStats(dateStr, env) {
  const season = getSeason(dateStr);
  const data = await fetchSeason(season, env);
  const values = data?.values ?? {};

  const today = getTodayDate();

  const stats = {
    RED: 0,
    WHITE: 0,
    BLUE: 0
  };

  for (const [date, color] of Object.entries(values)) {
    if (date > today) continue;
    if (stats[color] !== undefined) stats[color]++;
  }

  const result = {
    used: stats,
    remaining: {
      RED: LIMITS.RED - stats.RED,
      WHITE: LIMITS.WHITE - stats.WHITE,
      BLUE: LIMITS.BLUE - stats.BLUE
    },
    ts: now()
  };

  return result;
}
