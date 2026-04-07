// api/teams/auth/callback.js
// OAuth callback de Microsoft Teams. Se ejecuta una vez por instalación.
// Recibe: ?code=...&state=<base64> (decodifica id como locationId)
// Guarda los tokens encriptados en Supabase bajo (locationId, "teams"),
// crea el primer meeting y guarda el resultado en Supabase.

import { getSupabase } from "../../../lib/supabase.js";
import { encrypt }     from "../../../lib/crypto.js";

const MS_TOKEN_URL          = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ONLINE_MEETINGS = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const locationId = state ? JSON.parse(Buffer.from(state, 'base64').toString('utf8')).id : null;

  if (error) {
    return res.status(400).send(html("Error de autorización", `Microsoft devolvió: <strong>${error}</strong>`, "red"));
  }

  if (!code || !locationId) {
    return res.status(400).send(html("Parámetros faltantes", "Se requiere <code>code</code> y <code>state</code> (locationId).", "red"));
  }

  try {
    const supabase = getSupabase();

    // ─── 1. Intercambiar code por tokens ──────────────────────────────────────
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "authorization_code",
        client_id:     process.env.TEAMS_CLIENT_ID,
        client_secret: process.env.TEAMS_CLIENT_SECRET,
        code,
        redirect_uri:  process.env.TEAMS_REDIRECT_URI,
        scope:         "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read",
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

    // ─── 2. Guardar tokens en Supabase ────────────────────────────────────────
    const { error: saveError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          location_id:   locationId,
          platform:      "teams",
          access_token:  encrypt(tokens.access_token),
          refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          expires_at:    expiresAt,
          updated_at:    new Date().toISOString(),
        },
        { onConflict: "location_id,platform" }
      );

    if (saveError) throw new Error(`Failed to save tokens: ${saveError.message}`);

    const accessToken = tokens.access_token;

    // ─── 3. Crear primer meeting de Teams ─────────────────────────────────────
    const now           = new Date();
    const startDateTime = new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString();
    const endDateTime   = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

    const meetingRes = await fetch(GRAPH_ONLINE_MEETINGS, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject:             "Webinar Semanal",
        startDateTime,
        endDateTime,
        lobbyBypassSettings: { scope: "everyone" },
      }),
    });

    if (!meetingRes.ok) {
      const err = await meetingRes.text();
      throw new Error(`Failed to create Teams meeting: ${meetingRes.status} — ${err}`);
    }

    const meeting    = await meetingRes.json();
    const joinWebUrl = meeting.joinWebUrl;
    const meetingId  = meeting.id;

    if (!joinWebUrl || !meetingId) throw new Error("Incomplete meeting data returned by Microsoft Graph.");

    // ─── 4. Guardar meetingUrl y meetingId en platform_tokens ─────────────────
    await supabase
      .from("platform_tokens")
      .update({ webinar_title: joinWebUrl, broadcast_id: meetingId })
      .eq("location_id", locationId)
      .eq("platform", "teams");

    return res.status(200).send(html(
      "✅ Microsoft Teams Conectado",
      `Tokens guardados para location <strong>${locationId}</strong>.<br>
       Meeting URL: <strong>${joinWebUrl}</strong><br>
       Ya puedes usar los endpoints de webinar.`,
      "green"
    ));
  } catch (err) {
    console.error("Teams OAuth callback error:", err);
    return res.status(500).send(html("Error al procesar tokens", err.message, "red"));
  }
}

function html(title, body, color = "black") {
  return `<html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;">
    <h1 style="color:${color === "green" ? "#16a34a" : "#dc2626"};">${title}</h1>
    <p>${body}</p>
  </body></html>`;
}
