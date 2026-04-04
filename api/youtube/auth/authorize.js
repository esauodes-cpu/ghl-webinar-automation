// api/youtube/auth/authorize.js
// Inicia el flujo OAuth de YouTube.
// Requiere: ?locationId=<id>
// Redirige al usuario a Google para autorizar.

import { getSupabase }     from "../../_supabase.js";
import { decrypt }         from "../../../lib/crypto.js";

export default async function handler(req, res) {
  const { locationId } = req.query;

  if (!locationId) {
    return res.status(400).send("Se requiere el parámetro ?locationId=");
  }

  try {
    const supabase = getSupabase();

    const { data: app, error: appError } = await supabase
      .from("platform_apps")
      .select("*")
      .eq("platform", "youtube")
      .single();

    if (appError || !app) throw new Error("No YouTube app credentials found in platform_apps.");

    const params = new URLSearchParams({
      client_id:     decrypt(app.client_id),
      redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
      response_type: "code",
      scope:         app.scopes,
      access_type:   "offline",
      prompt:        "consent",
      state:         locationId,
    });

    return res.redirect(302, `${app.auth_url}?${params}`);
  } catch (err) {
    console.error("YouTube authorize error:", err);
    return res.status(500).send(`Error al generar URL de autorización: ${err.message}`);
  }
}
