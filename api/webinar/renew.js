// api/webinar/renew.js
// Entry point para GHL workflows. Ruta al módulo de plataforma correspondiente.
// Body: { locationId, platform, title, scheduledStartTime, description? }
// Respuesta: { ok: true, meetingUrl, broadcastId }

import { getAccessToken }                 from "../../lib/auth-manager.js";
import { createEvent as youtubeCreate }   from "../../lib/youtube/create-event.js";
import { createEvent as teamsCreate }     from "../../lib/teams/create-event.js";
import { getSupabase }                    from "../../lib/supabase.js";
import { renewWebSubSubscription }        from "../../lib/youtube/subscribe.js";

const PLATFORM_HANDLERS = {
  youtube: youtubeCreate,
  teams:   teamsCreate,
};

function validateWebhookSecret(req) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return true;
  const auth = req.headers["authorization"] || "";
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

  const { locationId, platform, title, scheduledStartTime, description } = req.body || {};

  if (!locationId)         return res.status(200).json({ ok: false, error: 'Missing "locationId".' });
  if (!platform)           return res.status(200).json({ ok: false, error: 'Missing "platform".' });
  if (!title)              return res.status(200).json({ ok: false, error: 'Missing "title".' });
  if (!scheduledStartTime) return res.status(200).json({ ok: false, error: 'Missing "scheduledStartTime".' });

  const key     = platform.toLowerCase().trim();
  const execute = PLATFORM_HANDLERS[key];

  if (!execute) {
    return res.status(200).json({
      ok:    false,
      error: `Unsupported platform: "${platform}". Supported: ${Object.keys(PLATFORM_HANDLERS).join(", ")}`,
    });
  }

  try {
    const accessToken = await getAccessToken(key, locationId);
    const result      = await execute({
      accessToken,
      locationId,
      title,
      description,
      scheduledStartTime,
    });

    const response = { ok: true, ...result };

    if (key === "youtube") {
      const supabase = getSupabase();

      // Guardar webinar_title en platform_tokens para que notify.js pueda hacer match
      // cuando la plataforma suba directamente a YouTube sin pasar por upload.js
      await supabase
        .from("platform_tokens")
        .update({ webinar_title: title })
        .eq("location_id", locationId)
        .eq("platform", "youtube");

      // Renovar suscripción WebSub si el cliente ya tiene un channel_id registrado
      const { data: streamRow } = await supabase
        .from("stream_data")
        .select("channel_id")
        .eq("location_id", locationId)
        .eq("platform", "youtube")
        .single();

      if (streamRow?.channel_id) {
        try {
          await renewWebSubSubscription(streamRow.channel_id);
        } catch (subErr) {
          // No abortar el renew por un fallo en WebSub — loguear y continuar
          console.error("[renew] WebSub renewal failed:", subErr.message);
        }
      }
    }

    return res.status(200).json(response);
  } catch (err) {
    const body = { ok: false, error: err.message };
    if (err.step)    body.step    = err.step;
    if (err.details) body.details = err.details;
    return res.status(200).json(body);
  }
}
