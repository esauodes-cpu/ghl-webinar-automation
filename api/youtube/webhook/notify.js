// api/youtube/webhook/notify.js
// Recibe notificaciones WebSub de YouTube cuando se publica un video nuevo.
// Filtra si el video corresponde a un webinar comparando el título contra
// webinar_uploads (subida manual) o platform_tokens.webinar_title (broadcast directo).
// Si coincide, dispara el webhook al inbound trigger del workflow de GHL.
//
// GET  → verificación de suscripción WebSub (challenge)
// POST → notificación de nuevo video

import { getSupabase } from "../../../lib/supabase.js";

const GHL_REPLAY_WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/gyZ8OVB8XfLPl2Q7VtXx/webhook-trigger/fefb2caf-5e66-4d1b-909a-333a03817c96";

// Parser minimalista de XML de YouTube WebSub
// Formato: <yt:videoId>XXX</yt:videoId> y <title>XXX</title>
function parseYouTubeNotification(xml) {
  const videoIdMatch = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
  const titleMatch   = xml.match(/<title>([^<]+)<\/title>/);

  if (!videoIdMatch) return null;

  return {
    videoId: videoIdMatch[1].trim(),
    // El primer <title> es el del feed (canal), el segundo es el del video
    title:   titleMatch?.[2] ? titleMatch[2].trim() : (titleMatch?.[1]?.trim() || ""),
  };
}

// Extrae el segundo match de title (el del video, no el del canal)
function parseTitle(xml) {
  const matches = [...xml.matchAll(/<title>([^<]+)<\/title>/g)];
  // índice 0 = título del feed/canal, índice 1 = título del video
  return matches[1]?.[1]?.trim() || matches[0]?.[1]?.trim() || "";
}

export default async function handler(req, res) {
  // ── GET: verificación de suscripción WebSub ──────────────────────────────
  if (req.method === "GET") {
    const challenge = req.query["hub.challenge"];
    if (!challenge) {
      return res.status(400).send("Missing hub.challenge");
    }
    // YouTube exige que respondamos con el challenge en texto plano
    return res.status(200).send(challenge);
  }

  // ── POST: notificación de nuevo video ────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed.");
  }

  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", resolve);
  });

  if (!body) {
    return res.status(200).send("Empty body. Ignored.");
  }

  const videoId    = body.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
  const videoTitle = parseTitle(body);

  if (!videoId) {
    return res.status(200).send("No videoId found. Ignored.");
  }

  const supabase = getSupabase();

  try {
    // ── Buscar match en webinar_uploads (subida manual via upload.js) ──────
    const { data: uploadMatch } = await supabase
      .from("webinar_uploads")
      .select("location_id, notified_at")
      .eq("video_title", videoTitle)
      .is("notified_at", null)  // no notificado aún
      .maybeSingle();

    // ── Buscar match en platform_tokens (broadcast directo de YouTube) ─────
    const { data: tokenMatch } = !uploadMatch
      ? await supabase
          .from("platform_tokens")
          .select("location_id")
          .eq("platform", "youtube")
          .eq("webinar_title", videoTitle)
          .maybeSingle()
      : { data: null };

    const match      = uploadMatch || tokenMatch;
    const locationId = match?.location_id;

    if (!locationId) {
      // No es un webinar conocido — ignorar silenciosamente
      return res.status(200).send("No matching webinar found. Ignored.");
    }

    // ── Disparar webhook a GHL ────────────────────────────────────────────
    const ghlRes = await fetch(GHL_REPLAY_WEBHOOK_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ locationId, videoId }),
    });

    if (!ghlRes.ok) {
      const err = await ghlRes.text();
      throw new Error(`GHL webhook failed: ${ghlRes.status} — ${err}`);
    }

    // ── Marcar como notificado en webinar_uploads (si aplica) ─────────────
    if (uploadMatch) {
      await supabase
        .from("webinar_uploads")
        .update({ notified_at: new Date().toISOString() })
        .eq("location_id", locationId)
        .eq("video_title", videoTitle);
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error("[notify]", err);
    // Siempre 200 a YouTube para que no reintente indefinidamente
    return res.status(200).send("Error processed.");
  }
}
