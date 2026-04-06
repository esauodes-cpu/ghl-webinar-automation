// api/youtube/auth/callback.js
// OAuth callback de YouTube. Se ejecuta una vez por instalación.
// Recibe: ?code=...&state=<locationId>
// Guarda los tokens encriptados en Supabase bajo (locationId, "youtube"),
// obtiene el channelId del canal, crea el stream permanente y notifica a GHL.

import { getSupabase } from "../../../lib/supabase.js";
import { encrypt }     from "../../../lib/crypto.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// PLACEHOLDER: reemplazar con la URL del inbound webhook de autorización de GHL
// (es diferente al webhook de replay que usa notify.js)
const GHL_AUTH_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/gyZ8OVB8XfLPl2Q7VtXx/webhook-trigger/fefb2caf-5e66-4d1b-909a-333a03817c96";

export default async function handler(req, res) {
  const { code, state: locationId, error } = req.query;

  if (error) {
    return res.status(400).send(html("Error de autorización", `YouTube devolvió: <strong>${error}</strong>`, "red"));
  }

  if (!code || !locationId) {
    return res.status(400).send(html("Parámetros faltantes", "Se requiere <code>code</code> y <code>state</code> (locationId).", "red"));
  }

  try {
    const supabase = getSupabase();

    // ─── 1. Intercambiar code por tokens ──────────────────────────────────────
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        code,
        grant_type:    "authorization_code",
        client_id:     process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} — ${err}`);
    }

    const tokens    = await tokenRes.json();
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const { error: saveError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          location_id:   locationId,
          platform:      "youtube",
          access_token:  encrypt(tokens.access_token),
          refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          expires_at:    expiresAt,
          updated_at:    new Date().toISOString(),
        },
        { onConflict: "location_id,platform" }
      );

    if (saveError) throw new Error(`Failed to save tokens: ${saveError.message}`);

    const accessToken = tokens.access_token;
    const authHeader  = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    // ─── 2. Obtener channelId del canal del cliente ────────────────────────────
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      { headers: authHeader }
    );

    if (!channelRes.ok) {
      const err = await channelRes.text();
      throw new Error(`Failed to fetch channel info: ${channelRes.status} — ${err}`);
    }

    const channelData = await channelRes.json();
    const channelId   = channelData.items?.[0]?.id;

    if (!channelId) throw new Error("No channel found for this YouTube account.");

    // ─── 3. Guardar channelId en platform_tokens ──────────────────────────────
    await supabase
      .from("platform_tokens")
      .update({ channel_id: channelId })
      .eq("location_id", locationId)
      .eq("platform", "youtube");

    // ─── 4. Crear stream permanente ───────────────────────────────────────────
    const streamRes = await fetch(
      "https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn",
      {
        method:  "POST",
        headers: authHeader,
        body:    JSON.stringify({
          snippet: { title: "Webinar Stream" },
          cdn:     {
            frameRate:     "30fps",
            ingestionType: "rtmp",
            resolution:    "1080p",
          },
        }),
      }
    );

    if (!streamRes.ok) {
      const err = await streamRes.text();
      throw new Error(`Failed to create live stream: ${streamRes.status} — ${err}`);
    }

    const streamData = await streamRes.json();
    const streamId   = streamData.id;
    const streamKey  = streamData.cdn?.ingestionInfo?.streamName;

    if (!streamId || !streamKey) throw new Error("Incomplete stream data returned by YouTube.");

    // ─── 5. Notificar a GHL con channelId, streamId y streamKey ──────────────
    await fetch(GHL_AUTH_WEBHOOK_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locationId, channelId, streamId, streamKey }),
    });

    return res.status(200).send(html(
      "✅ YouTube Conectado",
      `Tokens guardados para location <strong>${locationId}</strong>.<br>
       Canal: <strong>${channelId}</strong><br>
       Stream ID: <strong>${streamId}</strong><br>
       Ya puedes usar los endpoints de webinar.`,
      "green"
    ));
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    return res.status(500).send(html("Error al procesar tokens", err.message, "red"));
  }
}

function html(title, body, color = "black") {
  return `<html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;">
    <h1 style="color:${color === "green" ? "#16a34a" : "#dc2626"};">${title}</h1>
    <p>${body}</p>
  </body></html>`;
}
