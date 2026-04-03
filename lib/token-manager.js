import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "./crypto.js";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export async function saveTokens(locationId, platform, {
  accessToken,
  refreshToken,
  expiresIn,
}) {
  const supabase  = getSupabase();
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from("platform_tokens")
    .upsert(
      {
        location_id:   locationId,
        platform,
        access_token:  encrypt(accessToken),
        refresh_token: refreshToken ? encrypt(refreshToken) : null,
        expires_at:    expiresAt,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: "location_id,platform" }
    );

  if (error) throw new Error(`Failed to save tokens: ${error.message}`);
}

export async function getTokens(locationId, platform) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("platform_tokens")
    .select("*")
    .eq("location_id", locationId)
    .eq("platform", platform)
    .single();

  if (error || !data) {
    throw new Error(
      `No tokens found for location "${locationId}" on platform "${platform}".`
    );
  }

  if (data.expires_at) {
    const expiresAt   = new Date(data.expires_at).getTime();
    const needsRefresh = Date.now() > expiresAt - REFRESH_MARGIN_MS;

    if (needsRefresh) {
      if (!data.refresh_token) {
        throw new Error(`Token expired for ${platform} and no refresh token available.`);
      }
      return await refreshTokens(locationId, platform, decrypt(data.refresh_token));
    }
  }

  return {
    accessToken:  decrypt(data.access_token),
    refreshToken: data.refresh_token ? decrypt(data.refresh_token) : null,
  };
}

async function refreshTokens(locationId, platform, refreshToken) {
  const supabase = getSupabase();

  const { data: app, error: appError } = await supabase
    .from("platform_apps")
    .select("*")
    .eq("platform", platform)
    .single();

  if (appError || !app) {
    throw new Error(`No app credentials found for platform "${platform}".`);
  }

  const clientId     = decrypt(app.client_id);
  const clientSecret = decrypt(app.client_secret);

  const res = await fetch(app.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed for ${platform}: ${res.status} — ${err}`);
  }

  const tokens = await res.json();

  await saveTokens(locationId, platform, {
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn:    tokens.expires_in,
  });

  return {
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
  };
}

export async function getAppCredentials(platform) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("platform_apps")
    .select("*")
    .eq("platform", platform)
    .single();

  if (error || !data) {
    throw new Error(`No app credentials found for platform "${platform}".`);
  }

  return {
    clientId:     decrypt(data.client_id),
    clientSecret: decrypt(data.client_secret),
    authUrl:      data.auth_url,
    tokenUrl:     data.token_url,
    scopes:       data.scopes,
  };
}