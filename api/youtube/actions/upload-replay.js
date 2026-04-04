// api/youtube/actions/upload-replay.js
// El broadcast de YouTube se graba automáticamente como video al terminar el live.
// Este módulo lo cambia de "unlisted" a "public" y retorna { videoId }.
// El broadcastId (== videoId) se lee desde Supabase (guardado por create-event).

import { getSupabase } from "../../_supabase.js";

export async function uploadReplay({ accessToken, locationId }) {
  // ─── Leer broadcastId guardado por create-event ───────────────────────────
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("platform_tokens")
    .select("broadcast_id")
    .eq("location_id", locationId)
    .eq("platform", "youtube")
    .single();

  if (error || !data?.broadcast_id) {
    throw new Error(`No broadcast_id found for location "${locationId}". Run renew first.`);
  }

  const videoId = data.broadcast_id;

  // ─── Cambiar privacidad a public ──────────────────────────────────────────
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/videos?part=status",
    {
      method:  "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({
        id:     videoId,
        status: { privacyStatus: "public" },
      }),
    }
  );

  if (!res.ok) {
    const data = await res.json();
    throw Object.assign(
      new Error(data?.error?.message || "Failed to publish replay."),
      { step: "publish", videoId, details: data }
    );
  }

  return { videoId };
}
