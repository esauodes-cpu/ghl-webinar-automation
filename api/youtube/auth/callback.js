// api/youtube/auth/callback.js
// OAuth callback de YouTube. Se ejecuta una vez por instalación.
// Recibe: ?code=...&state=<locationId>
// Guarda los tokens encriptados en Supabase bajo (locationId, "youtube").

import { getSupabase } from "../../_supabase.js";
import { encrypt }     from "../../../lib/crypto.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

    return res.status(200).send(html(
      "✅ YouTube Conectado",
      `Tokens guardados para location <strong>${locationId}</strong>.<br>Ya puedes usar los endpoints de webinar.`,
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
