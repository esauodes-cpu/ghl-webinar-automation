// lib/youtube/create-event.js
// 1. Lee stream_id desde stream_data
// 2. Lee broadcast_id previo desde platform_tokens
// 3. Pone en privado el broadcast anterior (takedown) si existe
// 4. Crea un nuevo broadcast (unlisted)
// 5. Lo bindea al stream permanente
// 6. Guarda el nuevo broadcastId en Supabase (lo necesita upload-replay)
// Retorna { meetingUrl, broadcastId }

import { getSupabase } from "../supabase.js";

export async function createEvent({
  accessToken,
  locationId,
  title,
  description = "",
  scheduledStartTime,
}) {
  const supabase = getSupabase();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };

  // ─── 0. Leer stream_id desde stream_data ──────────────────────────────────
  const { data: streamRow, error: streamErr } = await supabase
    .from("stream_data")
    .select("stream_id")
    .eq("location_id", locationId)
    .eq("platform", "youtube")
    .single();

  if (streamErr || !streamRow?.stream_id) {
    throw new Error(`No stream_id found in stream_data for location ${locationId}`);
  }
  const streamId = streamRow.stream_id;

  // ─── 0b. Leer broadcast_id previo desde platform_tokens ───────────────────
  const { data: tokenRow } = await supabase
    .from("platform_tokens")
    .select("broadcast_id")
    .eq("location_id", locationId)
    .eq("platform", "youtube")
    .single();

  const previousBroadcastId = tokenRow?.broadcast_id || null;

  // ─── 1. Takedown del broadcast anterior (solo si existe) ──────────────────
  if (previousBroadcastId) {
    const takedownRes = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=status",
      {
        method:  "PUT",
        headers,
        body:    JSON.stringify({
          id:     previousBroadcastId,
          status: { privacyStatus: "private" },
        }),
      }
    );

    if (!takedownRes.ok) {
      const data = await takedownRes.json();
      throw Object.assign(
        new Error(data?.error?.message || "Takedown failed."),
        { step: "takedown", details: data }
      );
    }
  }

  // ─── 2. Crear nuevo broadcast ──────────────────────────────────────────────
  const broadcastRes = await fetch(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
    {
      method:  "POST",
      headers,
      body:    JSON.stringify({
        snippet:        { title, description, scheduledStartTime },
        status:         { privacyStatus: "unlisted" },
        contentDetails: { enableEmbed: true },
      }),
    }
  );

  if (!broadcastRes.ok) {
    const data = await broadcastRes.json();
    throw Object.assign(
      new Error(data?.error?.message || "Broadcast creation failed."),
      { step: "broadcast", details: data }
    );
  }

  const broadcast   = await broadcastRes.json();
  const broadcastId = broadcast.id;

  // ─── 3. Bind broadcast → stream permanente ────────────────────────────────
  const bindRes = await fetch(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?part=id,contentDetails&id=${broadcastId}&streamId=${streamId}`,
    { method: "POST", headers }
  );

  if (!bindRes.ok) {
    const data = await bindRes.json();
    throw Object.assign(
      new Error(data?.error?.message || "Bind failed."),
      { step: "bind", broadcastId, details: data }
    );
  }

  // ─── 4. Guardar broadcastId en Supabase ───────────────────────────────────
  // Necesario para que upload-replay sepa qué video publicar.
  await supabase
    .from("platform_tokens")
    .update({ broadcast_id: broadcastId })
    .eq("location_id", locationId)
    .eq("platform", "youtube");

  return {
    broadcastId,
    meetingUrl: `https://www.youtube.com/live/${broadcastId}`,
  };
}
