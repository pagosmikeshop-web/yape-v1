const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const webhookUrl = process.env.TELEGRAM_VPS_WEBHOOK_URL?.trim();

if (!token || !webhookSecret || !webhookUrl) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_VPS_WEBHOOK_URL are required.");
}
const parsedUrl = new URL(webhookUrl);
if (parsedUrl.protocol !== "https:" || parsedUrl.pathname !== "/telegram/webhook") {
  throw new Error("TELEGRAM_VPS_WEBHOOK_URL must be an HTTPS URL ending in /telegram/webhook.");
}

const result = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
  signal: AbortSignal.timeout(10_000),
});
const payload = await result.json().catch(() => ({}));
if (!result.ok || !payload.ok) throw new Error("Telegram rejected the VPS webhook configuration.");
console.info("Telegram webhook now points to the VPS gateway.");
