// api/youtube/renew.js
// Ciclo completo de renovación de YouTube:
// 1. Lee custom values del cliente via API de GHL (token de GHL desde Supabase)
// 2. Takedown del broadcast anterior (private)
// 3. Creación del nuevo broadcast
// 4. Bind al stream permanente
// 5. Actualiza custom value live_stream_video_id en GHL
// El token de YouTube viene inyectado por GHL en el Authorization header.

import { getCustomValues, updateCustomValues } from "../../lib/ghl-api.js";

export default async function youtubeRenew(req, res) {
  const ytToken    = req.headers["authorization"];
  const locationId = req.body?.location_id;

  if (!ytToken) {
    return res.status(200).json({ ok: false, error: "Missing YouTube authorization token." });
  }

  if (!locationId) {
    return res.status(200).json({ ok: false, error: 'Missing "location_id".' });
  }

  // ─── PASO 1: Leer custom values del cliente desde GHL ─────────────────────
  let cv;
  try {
    cv = await getCustomValues(locationId);
  } catch (err) {
    return res.status(200).json({ ok: false, step: "read_custom_values", error: err.message });
  }

  const previousBroadcastId = cv["live_stream_video_id"];
  const streamId            = cv["webinar_stream_id"];
  const title               = cv["webinar_title"];
  const description         = cv["webinar_description"] || "";
  const scheduledStartTime  = cv["webinar_scheduled_start_time"];

  const missing = [];
  if (!previousBroadcastId) missing.push("live_stream_video_id");
  if (!streamId)             missing.push("webinar_stream_id");
  if (!title)                missing.push("webinar_title");
  if (!scheduledStartTime)   missing.push("webinar_scheduled_start_time");

  if (missing.length > 0) {
    return res.status(200).json({
      ok: false,
      step: "validation",
      error: `Missing custom values in client account: ${missing.join(", ")}`,
    });
  }

  const ytHeaders = {
    Authorization: ytToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // ─── PASO 2: Takedown del broadcast anterior ───────────────────────────────
  try {
    const r = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=status",
      {
        method: "PUT",
        headers: ytHeaders,
        body: JSON.stringify({
          id:     previousBroadcastId,
          status: { privacyStatus: "private" },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        step: "takedown",
        error: data?.error?.message || "Takedown failed.",
        details: data,
      });
    }
  } catch (err) {
    return res.status(200).json({ ok: false, step: "takedown", error: err.message });
  }

  // ─── PASO 3: Crear nuevo broadcast ────────────────────────────────────────
  let newBroadcastId;
  try {
    const r = await fetch(
      "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails",
      {
        method: "POST",
        headers: ytHeaders,
        body: JSON.stringify({
          snippet: { title, description, scheduledStartTime },
          status:  { privacyStatus: "unlisted" },
          contentDetails: { enableEmbed: true },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        step: "broadcast",
        error: data?.error?.message || "Broadcast creation failed.",
        details: data,
      });
    }
    newBroadcastId = data.id;
  } catch (err) {
    return res.status(200).json({ ok: false, step: "broadcast", error: err.message });
  }

  // ─── PASO 4: Bind broadcast → stream permanente ───────────────────────────
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?part=id,contentDetails&id=${newBroadcastId}&streamId=${streamId}`,
      {
        method: "POST",
        headers: ytHeaders,
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        step: "bind",
        error: data?.error?.message || "Bind failed.",
        newBroadcastId,
        details: data,
      });
    }
  } catch (err) {
    return res.status(200).json({
      ok: false,
      step: "bind",
      error: err.message,
      newBroadcastId,
    });
  }

  // ─── PASO 5: Actualizar custom value en GHL ───────────────────────────────
  try {
    await updateCustomValues(locationId, {
      live_stream_video_id: newBroadcastId,
    });
  } catch (err) {
    return res.status(200).json({
      ok: true,
      warning: `Broadcast created but failed to update custom value: ${err.message}`,
      newBroadcastId,
      embedUrl:           `https://www.youtube.com/embed/${newBroadcastId}`,
      watchUrl:           `https://www.youtube.com/watch?v=${newBroadcastId}`,
      previousBroadcastId,
    });
  }

  // ─── TODO OK ──────────────────────────────────────────────────────────────
  return res.status(200).json({
    ok: true,
    newBroadcastId,
    embedUrl:           `https://www.youtube.com/embed/${newBroadcastId}`,
    watchUrl:           `https://www.youtube.com/watch?v=${newBroadcastId}`,
    previousBroadcastId,
    streamId,
  });
}