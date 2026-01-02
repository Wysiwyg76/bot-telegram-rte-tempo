import { env } from "cloudflare:workers";

/* =======================
   CONSTANTES & UTILS
======================= */

const TEMPO_URL = "https://www.services-rte.com/cms/open_data/v1/tempo?season=";
const LOG_KEY_PREFIX = "TEMPO_NOTIFY_";

const now = () => new Date();
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
};

const formatDate = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD

async function fetchTempoSeason(season) {
  const res = await fetch(`${TEMPO_URL}${season}`);
  if (!res.ok) throw new Error(`Tempo API returned ${res.status}`);
  const data = await res.json();
  if (!data.values) throw new Error("Tempo data missing");
  return data.values;
}

function getSeason(today = new Date()) {
  const year = today.getFullYear();
  const sep1 = new Date(`${year}-09-01`);
  if (today >= sep1) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

function tempoMessage(dateObj, color, stats) {
    
  const emoji =
      color === 'RED' ? '🔴' :
      color === 'WHITE' ? '⚪' :
      color === 'BLUE' ? '🔵' : '❓';

  return `*${dateObj}*  ${emoji}    (${stats.past} passés / ${stats.remaining} restants)\n\n`
}

async function shouldNotify(dateStr, color, env) {
  const key = `${LOG_KEY_PREFIX}${dateStr}_${color}`;
  const existing = await env.TEMPO_CACHE.get(key);
  if (existing) return false;
  await env.TEMPO_CACHE.put(key, "1");
  return true;
}

function countColorDays(seasonData, color) {
  let past = 0;
  let remaining = 0;
  const todayStr = formatDate(new Date());
  for (const [date, c] of Object.entries(seasonData)) {
    if (c === color) {
      if (date <= todayStr) past++;
      else remaining++;
    }
  }
  return { past, remaining };
}

/* =======================
   TELEGRAM
======================= */

async function sendTelegram(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_API_KEY}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
}

/* =======================
   WORKER
======================= */

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("OK");

    const update = await req.json();
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (!chatId || !text) return new Response("OK");

    if (!env.ALLOWED_CHAT_IDS.split(",").map((id) => parseInt(id, 10)).includes(chatId)) {
      return new Response("Unauthorized", { status: 403 });
    }

    const season = getSeason();
    const seasonData = await fetchTempoSeason(season);

    if (text === '/start') {
      const keyboard = [
        ['Couleur du jour', 'Couleur de demain'],
        ['Couleur pour une date']
      ];

      await sendTelegram(chatId, 'Choisis une option 👇', env);
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_API_KEY}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'Menu TEMPO',
          reply_markup: { keyboard, resize_keyboard: true }
        })
      });
      return new Response('OK');
    }

    let targetDate;
    if (text === "Couleur du jour") targetDate = formatDate(new Date());
    else if (text === "Couleur de demain") targetDate = formatDate(tomorrow());
    else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) targetDate = text;
    else return new Response("Commande inconnue", { status: 200 });

    const color = seasonData[targetDate];
    if (!color) {
      await sendTelegram(chatId, `Date non trouvée dans la saison : ${targetDate}`, env);
      return new Response("OK");
    }

    const stats = countColorDays(seasonData, color);
    await sendTelegram(chatId, tempoMessage(targetDate, color, stats), env);
    return new Response("OK");
  },

  async scheduled(_, env) {
    const season = getSeason();
    const seasonData = await fetchTempoSeason(season);
    const tDate = formatDate(tomorrow());
    const color = seasonData[tDate];

    if (!["RED", "WHITE"].includes(color)) {
      return new Response("Pas de notification nécessaire", { status: 200 });
    }

    const notify = await shouldNotify(tDate, color, env);
    if (!notify) return new Response("Notification déjà envoyée", { status: 200 });

    const stats = countColorDays(seasonData, color);
    await sendTelegram(env.TEMPO_TELEGRAM_CHAT_ID, tempoMessage(tDate, color, stats), env);

    return new Response("Notification envoyée", { status: 200 });
  }
};
