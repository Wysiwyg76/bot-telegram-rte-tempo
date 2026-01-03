import { env } from "cloudflare:workers";
import { getTodayDate, getTomorrowDate, fetchSeason, getSeasonStats, getSeason } from './tempo.js';

const LOG_KEY_PREFIX = "TEMPO_NOTIFY_";

const formatDate = (d) => d.toISOString().slice(0, 10);

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
   NOTIFICATION LOGIC
======================= */

async function shouldNotify(dateStr, color, env) {
  const key = `${LOG_KEY_PREFIX}${dateStr}`;
  const existing_color = await env.TEMPO_CACHE.get(key);
  
  if (["RED","WHITE","BLUE"].includes(existing_color)) return false;
  
  await env.TEMPO_CACHE.put(key, color);

  if (!["RED","WHITE"].includes(color)) return false;
  
  return true;
}

function tempoMessage(dateStr, color, stats) {
  const emoji = color === 'RED' ? '🔴' : color === 'WHITE' ? '⚪' : color === 'BLUE' ? '🔵' : '❓';
  return `*${dateStr}*  ${emoji}   (${stats.used[color]} passés / ${stats.remaining[color]} restants)\n\n`;
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

    const allowed = env.ALLOWED_CHAT_IDS.split(',').map(id => parseInt(id.trim(), 10));
    if (!allowed.includes(chatId)) return new Response("Unauthorized", { status: 403 });

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
    if (text === "Couleur du jour") targetDate = getTodayDate();
    else if (text === "Couleur de demain") targetDate = getTomorrowDate();
    else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) targetDate = text;
    else return new Response("Commande inconnue", { status: 200 });

    const seasonStats = await getSeasonStats(targetDate, env);
    const color = seasonStats.values[targetDate];
    if (!color) {
      await sendTelegram(chatId, `Date non trouvée dans la saison : ${targetDate}`, env);
      return new Response("OK");
    }

    await sendTelegram(chatId, tempoMessage(targetDate, color, seasonStats), env);
    return new Response("OK");
  },

  async scheduled(_, env) {
    const tDate = getTomorrowDate();

    const notify = await shouldNotify(tDate, 'n/a', env);
    if (!notify) return new Response("Notification déjà envoyée", { status: 200 });

    const nocache = 1;
    const seasonStats = await getSeasonStats(tDate, env, nocache);
    const color = seasonStats.values[tDate];

    const notify = await shouldNotify(tDate, color, env);
    if (!notify) return new Response("Pas de notification nécessaire", { status: 200 });

    await sendTelegram(env.TEMPO_TELEGRAM_CHAT_ID, tempoMessage(tDate, color, seasonStats), env);

    return new Response("Notification envoyée", { status: 200 });
  }
};

