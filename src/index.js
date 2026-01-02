import { env } from "cloudflare:workers";
import {
  getTodayDate,
  getTomorrowDate,
  getTempoForDate,
  getSeasonStats
} from './tempo.js';

/* =======================
   TELEGRAM
======================= */

async function sendTelegram(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_API_KEY}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    })
  });
}

/* =======================
   FORMAT MESSAGE
======================= */

function tempoMessage(t, stats) {
  const emoji =
    t.color === 'RED' ? '🔴' :
    t.color === 'WHITE' ? '⚪' :
    t.color === 'BLUE' ? '🔵' : '❓';

  return (
    `*${t.date}*  ${emoji}    (${stats.used[t.color]} passés / ${stats.remaining[t.color]} restants)\n\n`
  );
}

/* =======================
   ANTI-DOUBLON
======================= */

async function shouldNotify(t, env) {
  const key = `TEMPO_SENT_${t.date}`;
  if (await env.TEMPO_CACHE.get(key)) return false;
  await env.TEMPO_CACHE.put(key, 'true');
  return true;
}

/* =======================
   WORKER
======================= */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/favicon.ico' || url.pathname === '/robots.txt')
      return new Response('Not Found', { status: 404 });

    if (req.method !== 'POST') return new Response('OK');

    const update = await req.json();
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (!chatId || !text) return new Response('OK');

    const allowed = env.ALLOWED_CHAT_IDS
      .split(',')
      .map(v => parseInt(v.trim(), 10));

    if (!allowed.includes(chatId))
      return new Response('Unauthorized', { status: 403 });

    /* ===== MENU ===== */

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

    /* ===== COMMANDES ===== */

    async function respond(date) {
      const t = await getTempoForDate(date, env);
      const stats = await getSeasonStats(date, env);
      await sendTelegram(chatId, tempoMessage(t, stats), env);
    }

    if (text === 'Couleur du jour') return respond(getTodayDate());
    if (text === 'Couleur de demain') return respond(getTomorrowDate());

    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
      return respond(text);

    return new Response('OK');
  },

  /* =======================
     SCHEDULED
  ======================= */

  async scheduled(_, env) {
    const date = getTomorrowDate();
    const t = await getTempoForDate(date, env);

    if (!['RED', 'WHITE'].includes(t.color)) return;

    if (!(await shouldNotify(t, env))) return;

    const stats = await getSeasonStats(date, env);

    await sendTelegram(
      env.TEMPO_TELEGRAM_CHAT_ID,
      tempoMessage(t, stats),
      env
    );
  }
};
