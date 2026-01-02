import { env } from "cloudflare:workers";
import {
  getTempoToday,
  getTempoTomorrow,
  getTempoForDate
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

function tempoMessage(t) {
  if (t.error) return `❌ ${t.error}`;

  const emoji =
    t.color === 'RED'   ? '🔴' :
    t.color === 'WHITE' ? '⚪' :
    t.color === 'BLUE'  ? '🔵' : '❓';

  return `*EDF TEMPO*\n📅 ${t.date}\n${emoji} *${t.color}*`;
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

    /* ===== /start ===== */
    if (text === '/start') {
      const keyboard = [
        ['TEMPO aujourd’hui'],
        ['TEMPO demain'],
        ['TEMPO date (YYYY-MM-DD)']
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
    if (text === 'TEMPO aujourd’hui') {
      const t = await getTempoToday(env);
      await sendTelegram(chatId, tempoMessage(t), env);
      return new Response('OK');
    }

    if (text === 'TEMPO demain') {
      const t = await getTempoTomorrow(env);
      await sendTelegram(chatId, tempoMessage(t), env);
      return new Response('OK');
    }

    if (text === 'TEMPO date (YYYY-MM-DD)') {
      await sendTelegram(
        chatId,
        'Envoie une date au format YYYY-MM-DD (ex : 2025-01-15)',
        env
      );
      return new Response('OK');
    }

    /* ===== DATE LIBRE ===== */
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const t = await getTempoForDate(text, env);
      await sendTelegram(chatId, tempoMessage(t), env);
      return new Response('OK');
    }

    return new Response('OK');
  },

  async scheduled(_, env) {
    const t = await getTempoTomorrow(env);
    await sendTelegram(env.TEMPO_TELEGRAM_CHAT_ID, tempoMessage(t), env);
  }
};
