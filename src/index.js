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

function statsMessage(stats, season) {
  return `*Saison ${season}*\n`+
          ` 🔴 ${stats.used['RED']} passés / ${stats.remaining['RED']} restants\n`+
          ` ⚪ ${stats.used['WHITE']} passés / ${stats.remaining['WHITE']} restants\n`+
          ` 🔵 ${stats.used['BLUE']} passés / ${stats.remaining['BLUE']} restants\n\n`;
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

    try{

      if (text === '/start') {
        const keyboard = [
          ['Couleur du jour', 'Couleur de demain'],
          ['Stats '+getSeason()],
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
      if (text === "Couleur du jour" || /Stats\s\d{4}-\d{4}/.test(text)) targetDate = getTodayDate();
      else if (text === "Couleur de demain") targetDate = getTomorrowDate();
      else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) targetDate = text;
      else return new Response("Commande inconnue", { status: 200 });

      const seasonStats = await getSeasonStats(targetDate, env);

      if(/Stats\s\d{4}-\d{4}/.test(text)) {
        await sendTelegram(chatId, statsMessage(seasonStats, getSeason()), env);
        return new Response("OK");
      }

      const color = seasonStats.values[targetDate];
      if (!color) {
        await sendTelegram(chatId, `Date non trouvée dans la saison : ${targetDate}`, env);
        return new Response("OK");
      }

      await sendTelegram(chatId, tempoMessage(targetDate, color, seasonStats), env);
      return new Response("OK");

    } catch (e) {
      console.log(`Command error`, e.message);
      return new Response("NOK");
    }
  },

  async scheduled(_, env) {
    try{

      const tDate = getTomorrowDate();
      var notify = await shouldNotify(tDate, 'n/a', env);
      console.log("shouldNotify 1", `${notify}`);
      if (!notify) return new Response("Notification déjà envoyée", { status: 200 });

      const forceNoCache = true;
      const seasonStats = await getSeasonStats(tDate, env, forceNoCache);
      const color = seasonStats.values[tDate];

      notify = await shouldNotify(tDate, color, env);
      console.log("shouldNotify 2", `${notify}`);
      if (!notify) return new Response("Pas de notification nécessaire", { status: 200 });

      await sendTelegram(env.TEMPO_TELEGRAM_CHAT_ID, tempoMessage(tDate, color, seasonStats), env);
      console.log("Notification envoyée", `${tDate} ${color}`);
      return new Response("Notification envoyée", { status: 200 });

    } catch (e) {
      console.log("Schedule error", e.message);
      return new Response("NOK");
    }
  }
};

