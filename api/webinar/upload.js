// api/webinar/upload.js
// Recibe una grabación de cualquier plataforma (Zoom, Teams, GoToWebinar, etc.)
// la sube al canal de YouTube del cliente y registra el upload en Supabase.
// Si la plataforma ya subió el video directamente a YouTube, este endpoint
// no será llamado — el filtro en notify.js usará el título guardado por renew.js.
//
// Body: { locationId, platform, recordingUrl, title }
// Respuesta: { ok: true, videoId }

import { getAccessToken } from "../../lib/auth-manager.js";
import { getSupabase }    from "../../lib/supabase.js";

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

  const { locationId, platform, recordingUrl, title } = req.body || {};

  if (!locationId)    return res.status(200).json({ ok: false, error: 'Missing "locationId".' });
  if (!recordingUrl)  return res.status(200).json({ ok: false, error: 'Missing "recordingUrl".' });
  if (!title)         return res.status(200).json({ ok: false, error: 'Missing "title".' });

  const supabase = getSupabase();

  // Double check: verificar si ya existe un upload con este título para este cliente
  const { data: existing } = await supabase
    .from("webinar_uploads")
    .select("video_id")
    .eq("location_id", locationId)
    .eq("video_title", title)
    .single();

  if (existing?.video_id) {
    return res.status(200).json({
      ok:      true,
      videoId: existing.video_id,
      note:    "Video already uploaded. Skipping.",
    });
  }

  try {
    // Obtener access token de YouTube para este cliente
    const accessToken = await getAccessToken("youtube", locationId);

    // Paso 1: Iniciar upload resumable a YouTube
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method:  "POST",
        headers: {
          Authorization:           `Bearer ${accessToken}`,
          "Content-Type":          "application/json",
          "X-Upload-Content-Type": "video/*",
        },
        body: JSON.stringify({
          snippet: {
            title,
            description: "",
          },
          status: {
            privacyStatus: "unlisted",
          },
        }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`Failed to initiate YouTube upload: ${initRes.status} — ${err}`);
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload URL returned by YouTube.");

    // Paso 2: Descargar la grabación desde la plataforma de origen
    const recordingRes = await fetch(recordingUrl);
    if (!recordingRes.ok) {
      throw new Error(`Failed to download recording: ${recordingRes.status}`);
    }

    const videoBuffer = await recordingRes.arrayBuffer();

    // Paso 3: Subir el video a YouTube
    const uploadRes = await fetch(uploadUrl, {
      method:  "PUT",
      headers: {
        "Content-Type":   "video/*",
        "Content-Length": videoBuffer.byteLength.toString(),
      },
      body: videoBuffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`YouTube upload failed: ${uploadRes.status} — ${err}`);
    }

    const uploaded = await uploadRes.json();
    const videoId  = uploaded.id;

    if (!videoId) throw new Error("YouTube did not return a video ID after upload.");

    // Paso 4: Registrar en Supabase para que notify.js pueda hacer el match
    await supabase
      .from("webinar_uploads")
      .upsert(
        {
          location_id:  locationId,
          video_id:     videoId,
          video_title:  title,
          uploaded_at:  new Date().toISOString(),
        },
        { onConflict: "location_id,video_title" }
      );

    return res.status(200).json({ ok: true, videoId });

  } catch (err) {
    console.error("[upload]", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
