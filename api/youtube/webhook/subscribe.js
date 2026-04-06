// api/youtube/webhook/subscribe.js
// Registra la suscripción WebSub (PubSubHubbub) para el canal de YouTube del cliente.
// Se llama UNA SOLA VEZ por cliente durante el setup inicial.
// YouTube enviará notificaciones a /api/youtube/webhook/notify cuando haya un video nuevo.
//
// Body: { locationId, channelId }
// Respuesta: { ok: true }

import { getSupabase } from "../../_supabase.js";

const WEBSUB_HUB     = "https://pubsubhubbub.appspot.com/subscribe";
const CALLBACK_BASE  = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.APP_BASE_URL;

function validateWebhookSecret(req) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return true;
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return token === expected;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: false, error: "Method not allowed. Use POST." });
  }

  if (!validateWebhookSecret(req)) {
    return res.status(200).json({ ok: false, error: "Unauthorized." });
  }

  const { locationId, channelId } = req.body || {};

  if (!locationId) return res.status(200).json({ ok: false, error: 'Missing "locationId".' });
  if (!channelId)  return res.status(200).json({ ok: false, error: 'Missing "channelId".' });

  const supabase = getSupabase();

  try {
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

    // Guardar channelId en platform_tokens para referencia futura
    await supabase
      .from("platform_tokens")
      .update({ channel_id: channelId })
      .eq("location_id", locationId)
      .eq("platform", "youtube");

    return res.status(200).json({
      ok:          true,
      channelId,
      callbackUrl,
      note:        "Subscription requested. YouTube will verify asynchronously. Renew before 10 days.",
    });

  } catch (err) {
    console.error("[subscribe]", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
