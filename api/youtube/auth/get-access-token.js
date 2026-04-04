import { getSupabase }    from "../../_supabase.js";
import { encrypt, decrypt } from "../../../lib/crypto.js";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getAccessToken(locationId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("platform_tokens")
    .select("*")
    .eq("location_id", locationId)
    .eq("platform", "youtube")
    .single();

  if (error || !data) {
    throw new Error(`No YouTube token found for location "${locationId}".`);
  }

  if (data.expires_at) {
    const expiresAt    = new Date(data.expires_at).getTime();
    const needsRefresh = Date.now() > expiresAt - REFRESH_MARGIN_MS;
    if (needsRefresh) return _refreshAccessToken(locationId, data);
  }

  return decrypt(data.access_token);
}

async function _refreshAccessToken(locationId, row) {
  if (!row.refresh_token) {
    throw new Error(`YouTube token expired for location "${locationId}" and no refresh token available.`);
  }

  const supabase = getSupabase();

  const { data: app, error: appError } = await supabase
    .from("platform_apps")
    .select("*")
    .eq("platform", "youtube")
    .single();

  if (appError || !app) throw new Error("No YouTube app credentials found in platform_apps.");

  const res = await fetch(app.token_url, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: decrypt(row.refresh_token),
      client_id:     decrypt(app.client_id),
      client_secret: decrypt(app.client_secret),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube token refresh failed: ${res.status} — ${err}`);
  }

  const tokens    = await res.json();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await supabase
    .from("platform_tokens")
    .update({
      access_token: encrypt(tokens.access_token),
      expires_at:   expiresAt,
      updated_at:   new Date().toISOString(),
    })
    .eq("location_id", locationId)
    .eq("platform", "youtube");

  return tokens.access_token;
}
