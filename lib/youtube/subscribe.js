// lib/youtube/subscribe.js
// Registra o renueva la suscripción WebSub (PubSubHubbub) para un canal de YouTube.
// YouTube enviará notificaciones a /api/youtube/webhook/notify cuando haya un video nuevo.

const WEBSUB_HUB    = "https://pubsubhubbub.appspot.com/subscribe";
const CALLBACK_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.APP_BASE_URL;

/**
 * Registra (o renueva) una suscripción WebSub para el canal dado.
 * Lanza un error si YouTube no responde 202 Accepted.
 * @param {string} channelId — YouTube channel ID (UCxxxxxxxx)
 */
export async function renewWebSubSubscription(channelId) {
  const callbackUrl = `${CALLBACK_BASE}/api/youtube/webhook/notify`;
  const topicUrl    = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

  const formData = new URLSearchParams({
    "hub.callback":      callbackUrl,
    "hub.topic":         topicUrl,
    "hub.verify":        "async",
    "hub.mode":          "subscribe",
    "hub.secret":        process.env.WEBHOOK_SECRET || "",
    "hub.lease_seconds": "864000", // 10 días — hay que renovar antes de que expire
  });

  const subRes = await fetch(WEBSUB_HUB, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    formData,
  });

  // YouTube responde 202 Accepted cuando acepta la suscripción
  if (subRes.status !== 202) {
    const err = await subRes.text();
    throw new Error(`WebSub subscription failed: ${subRes.status} — ${err}`);
  }
}
