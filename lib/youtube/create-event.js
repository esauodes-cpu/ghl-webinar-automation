// lib/youtube/create-event.js
// 1. Pone en privado el broadcast anterior (takedown)
// 2. Crea un nuevo broadcast (unlisted)
// 3. Lo bindea al stream permanente
// 4. Guarda el nuevo broadcastId en Supabase (lo necesita upload-replay)
// Retorna { meetingUrl, broadcastId }

import { getSupabase } from "../supabase.js";

export async function createEvent({
  accessToken,
  locationId,
  previousBroadcastId,
  streamId,
  title,
  description = "",
  scheduledStartTime,
}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };

  // ─── 1. Takedown del broadcast anterior ───────────────────────────────────
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

  const broadcast    = await broadcastRes.json();
  const broadcastId  = broadcast.id;

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
  // Requiere columna `broadcast_id TEXT` en la tabla platform_tokens.
  const supabase = getSupabase();
  await supabase
    .from("platform_tokens")
    .update({ broadcast_id: broadcastId })
    .eq("location_id", locationId)
    .eq("platform", "youtube");

  return {
    broadcastId,
    meetingUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
  };
}
