import { getSupabase }     from "../supabase.js";
import { encrypt, decrypt } from "../crypto.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: decrypt(row.refresh_token),
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
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
