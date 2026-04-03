// api/renew.js
// Router central de renovación.
// GHL siempre llama a este endpoint único con webinar_platform como parámetro.
// Delega al módulo de plataforma correspondiente.

import { validateWebhookSecret, sendError } from "../lib/helpers.js";
import youtubeRenew from "./youtube/renew.js";

const SUPPORTED_PLATFORMS = ["youtube", "teams"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: false, error: "Method not allowed. Use POST." });
  }

  if (!validateWebhookSecret(req)) {
    return res.status(200).json({ ok: false, error: "Unauthorized." });
  }

  let payload = req.body || {};
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }

  const { webinar_platform, location_id } = payload;

  if (!location_id) {
    return res.status(200).json({ ok: false, error: 'Missing "location_id".' });
  }

  if (!webinar_platform) {
    return res.status(200).json({
      ok: false,
      error: `Missing "webinar_platform". Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
    });
  }

  const platform = webinar_platform.toLowerCase().trim();

  // Pasar el payload completo al módulo de plataforma
  req.body = payload;

  switch (platform) {
    case "youtube":
      return youtubeRenew(req, res);

    case "teams":
      return res.status(200).json({
        ok: false,
        error: "Teams platform coming soon.",
      });

    default:
      return res.status(200).json({
        ok: false,
        error: `Unknown platform: "${webinar_platform}". Supported: ${SUPPORTED_PLATFORMS.join(", ")}`,
      });
  }
}