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

export function getSeason(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const sept1 = new Date(`${year}-09-01`).getTime();
  const day = new Date(dateStr).getTime();

  return day >= sept1
    ? `${year}-${year + 1}`
    : `${year - 1}-${year}`;
}

/* =======================
   FETCH SAISON DATA
======================= */

async function fetchSeason(season) {
  const url = `https://www.services-rte.com/cms/open_data/v1/tempo?season=${season}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });
  return res.json();
}

/* =======================
   GET COLOR FOR DATE
======================= */

export async function getTempoForDate(dateStr, env) {
  const cacheKey = `TEMPO_${dateStr}`;
  const cached = await env.ASSET_CACHE.get(cacheKey, 'json');
  if (cached && !isExpired(cached.ts, TTL)) return cached;

  try {
    const season = getSeason(dateStr);
    const data = await fetchSeason(season);
    const color = data?.values?.[dateStr];

    const result = {
      date: dateStr,
      color: ['RED', 'WHITE', 'BLUE'].includes(color) ? color : 'UNKNOWN',
      ts: now()
    };

    await env.ASSET_CACHE.put(cacheKey, JSON.stringify(result));
    return result;

  } catch (e) {
    console.log('TEMPO error', e.message);
    return cached ?? { date: dateStr, color: 'UNKNOWN' };
  }
}

/* =======================
   SEASON STATS
======================= */

export async function getSeasonStats(dateStr, env) {
  const season = getSeason(dateStr);
  const cacheKey = `TEMPO_STATS_${season}`;

  const cached = await env.ASSET_CACHE.get(cacheKey, 'json');
  if (cached && !isExpired(cached.ts, TTL)) return cached;

  const data = await fetchSeason(season);
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

  await env.ASSET_CACHE.put(cacheKey, JSON.stringify(result));
  return result;
}
