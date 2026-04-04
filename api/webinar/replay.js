// api/webinar/replay.js
// Entry point para GHL workflows. Publica el replay del último webinar.
// Body: { locationId, platform }
// Respuesta: { ok: true, videoId }

import { getAccessToken }                   from "../_auth-manager.js";
import { uploadReplay as youtubeReplay }    from "../youtube/actions/upload-replay.js";
import { uploadReplay as teamsReplay }      from "../teams/actions/upload-replay.js";

const PLATFORM_HANDLERS = {
  youtube: youtubeReplay,
  teams:   teamsReplay,
};

function validateWebhookSecret(req) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return true;
  const auth  = req.headers["authorization"] || "";
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

  const { locationId, platform } = req.body || {};

  if (!locationId) return res.status(200).json({ ok: false, error: 'Missing "locationId".' });
  if (!platform)   return res.status(200).json({ ok: false, error: 'Missing "platform".' });

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
    const result      = await execute({ accessToken, locationId });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const body = { ok: false, error: err.message };
    if (err.step)    body.step    = err.step;
    if (err.details) body.details = err.details;
    return res.status(200).json(body);
  }
}
