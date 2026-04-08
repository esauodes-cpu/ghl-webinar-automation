// api/teams/auth/callback.js
// Leg 2 of the Microsoft Teams OAuth flow.
// Microsoft redirects here after user authorization.
// Exchanges code for tokens and saves them to Supabase.

import { getSupabase } from "../../../lib/supabase.js";
import { encrypt }     from "../../../lib/crypto.js";

const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE        = "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read";

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(200).send("OK");
  }

  // 1. Decode state → locationId
  let locationId;
  try {
    const decoded  = Buffer.from(state, "base64").toString("utf8");
    const stateObj = JSON.parse(decoded);
    locationId     = stateObj.id;
  } catch (err) {
    return res.status(400).send("Invalid state parameter.");
  }

  // 2. Exchange code for tokens
  let tokens;
  try {
    const body = new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     process.env.TEAMS_CLIENT_ID,
      client_secret: process.env.TEAMS_CLIENT_SECRET,
      code,
      redirect_uri:  process.env.TEAMS_REDIRECT_URI,
      scope:         SCOPE,
    });

    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.access_token) {
      console.error("Token exchange failed:", tokens);
      return res.status(502).send("Token exchange with Microsoft failed.");
    }
  } catch (err) {
    console.error("Token exchange error:", err);
    return res.status(500).send("Internal error during token exchange.");
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // 3. Save encrypted tokens to Supabase
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          location_id:   locationId,
          platform:      "teams",
          access_token:  encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token),
          expires_at:    expiresAt,
          updated_at:    new Date().toISOString(),
        },
        { onConflict: "location_id,platform" }
      );

    if (error) {
      console.error("Supabase upsert error:", error);
      return res.status(500).send("Failed to save tokens.");
    }
  } catch (err) {
    console.error("Supabase error:", err);
    return res.status(500).send("Internal error saving tokens.");
  }

  // 4. Return success page
  return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Teams Connected</title>
  <style>
    body { font-family: sans-serif; display: flex; justify-content: center;
           align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: #fff; border-radius: 12px; padding: 40px 48px;
            box-shadow: 0 4px 24px rgba(0,0,0,.1); text-align: center; max-width: 420px; }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; color: #1a1a1a; font-size: 24px; }
    p  { color: #555; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x2705;</div>
    <h1>Microsoft Teams Connected</h1>
    <p>Your account has been linked successfully.<br>You may close this window.</p>
  </div>
</body>
</html>`);
}
