// api/setup/encrypt-app.js
// Endpoint temporal para encriptar y guardar credenciales de una app.
// ELIMINAR después de usarlo.

import { createClient } from "@supabase/supabase-js";
import { encrypt } from "../../lib/crypto.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { platform, client_id, client_secret, auth_url, token_url, scopes } = req.body;

  if (!platform || !client_id || !client_secret) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase
    .from("platform_apps")
    .upsert(
      {
        platform,
        client_id:     encrypt(client_id),
        client_secret: encrypt(client_secret),
        auth_url,
        token_url,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "platform" }
    );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, platform, message: "Credentials encrypted and saved." });
}