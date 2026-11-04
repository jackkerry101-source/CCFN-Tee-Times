// Sends alerts to whichever channels are configured (GitHub repository secrets).
//   Telegram group: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   ntfy app:       NTFY_TOPIC

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NTFY_TOPIC } = process.env;

export async function sendAlerts(text, link) {
  const body = link ? `${text}\n\nBoard: ${link}` : text;
  let sent = false;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: body, disable_web_page_preview: true })
    });
    console.log(r.ok ? 'Telegram alert sent.' : `Telegram failed: HTTP ${r.status} ${await r.text()}`);
    sent ||= r.ok;
  }

  if (NTFY_TOPIC) {
    const r = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: 'Tee times', Tags: 'golf', ...(link ? { Click: link } : {}) },
      body: text
    });
    console.log(r.ok ? 'ntfy alert sent.' : `ntfy failed: HTTP ${r.status}`);
    sent ||= r.ok;
  }

  if (!sent) console.log('No alert channel configured. Message would have been:\n' + body);
}

// Setup helper: with a bot token but no chat ID yet, print the chat IDs the bot can see.
export async function logTelegramChatIds() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_CHAT_ID) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
    const j = await r.json();
    const chats = new Map();
    for (const u of j.result || []) {
      const chat = (u.message || u.my_chat_member || u.channel_post || {}).chat;
      if (chat) chats.set(chat.id, chat.title || chat.username || chat.first_name);
    }
    console.log('\n===== TELEGRAM SETUP =====');
    if (!chats.size) console.log('Bot sees no chats yet. Add it to your group, send a message in the group, then run again.');
    for (const [id, name] of chats) console.log(`Chat "${name}" → TELEGRAM_CHAT_ID = ${id}`);
    console.log('==========================\n');
  } catch (e) {
    console.log('Telegram setup check failed:', e.message);
  }
}
