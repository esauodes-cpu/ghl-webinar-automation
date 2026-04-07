// lib/teams/upload-replay.js
// Uploads a Teams meeting recording to YouTube as an unlisted video.

import { getAccessToken } from "../auth-manager.js";
import { getSupabase }    from "../supabase.js";

export async function uploadReplay({ accessToken, locationId }) {
  const supabase = getSupabase();

  // ─── Step 1: Get YouTube access token ──────────────────────────────────────
  let youtubeAccessToken;
  try {
    youtubeAccessToken = await getAccessToken("youtube", locationId);
  } catch (err) {
    err.step = 1;
    throw err;
  }

  // ─── Step 2: Read meetingId and webinar_title from Supabase ────────────────
  let meetingId, webinarTitle;
  try {
    const { data, error } = await supabase
      .from("platform_tokens")
      .select("broadcast_id, webinar_title")
      .eq("location_id", locationId)
      .eq("platform", "teams")
      .single();

    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    if (!data?.broadcast_id) throw new Error("No meetingId (broadcast_id) found for this location.");

    meetingId    = data.broadcast_id;
    webinarTitle = data.webinar_title ?? "Webinar Recording";
  } catch (err) {
    err.step = 2;
    throw err;
  }

  // ─── Step 3: Get recording URL from Teams ─────────────────────────────────
  let recordingContentUrl;
  try {
    const recordingsRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/onlineMeetings/${meetingId}/recordings`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!recordingsRes.ok) {
      const err = await recordingsRes.text();
      throw new Error(`Recordings fetch failed: ${recordingsRes.status} — ${err}`);
    }

    const recordingsData = await recordingsRes.json();
    recordingContentUrl  = recordingsData.value?.[0]?.recordingContentUrl;

    if (!recordingContentUrl) throw new Error("No recording found for this meeting.");
  } catch (err) {
    err.step = 3;
    throw err;
  }

  // ─── Step 4: Download recording as a stream ────────────────────────────────
  let recordingRes;
  try {
    recordingRes = await fetch(recordingContentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!recordingRes.ok) {
      const err = await recordingRes.text();
      throw new Error(`Recording download failed: ${recordingRes.status} — ${err}`);
    }
  } catch (err) {
    err.step = 4;
    throw err;
  }

  // ─── Step 5: Initiate YouTube resumable upload session ────────────────────
  let uploadSessionUrl;
  try {
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method:  "POST",
        headers: {
          Authorization:          `Bearer ${youtubeAccessToken}`,
          "Content-Type":         "application/json",
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: { title: webinarTitle },
          status:  { privacyStatus: "unlisted" },
        }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`YouTube upload init failed: ${initRes.status} — ${err}`);
    }

    uploadSessionUrl = initRes.headers.get("Location");
    if (!uploadSessionUrl) throw new Error("YouTube did not return a resumable upload URL.");
  } catch (err) {
    err.step = 5;
    throw err;
  }

  // ─── Step 6: Stream recording body into YouTube resumable upload ──────────
  let uploadRes;
  try {
    uploadRes = await fetch(uploadSessionUrl, {
      method:  "PUT",
      headers: { "Content-Type": "video/mp4" },
      body:    recordingRes.body,
      duplex:  "half",
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`YouTube upload failed: ${uploadRes.status} — ${err}`);
    }
  } catch (err) {
    err.step = 6;
    throw err;
  }

  // ─── Step 7: Parse videoId from YouTube response ──────────────────────────
  let videoId;
  try {
    const uploadData = await uploadRes.json();
    videoId          = uploadData.id;
    if (!videoId) throw new Error("YouTube did not return a videoId.");
  } catch (err) {
    err.step = 7;
    throw err;
  }

  // ─── Step 8: Register upload in webinar_uploads table ────────────────────
  try {
    const { error } = await supabase.from("webinar_uploads").insert({
      location_id:  locationId,
      video_id:     videoId,
      video_title:  webinarTitle,
      uploaded_at:  new Date().toISOString(),
    });

    if (error) throw new Error(`Failed to register upload: ${error.message}`);
  } catch (err) {
    err.step = 8;
    throw err;
  }

  // ─── Step 9: Return ───────────────────────────────────────────────────────
  return { videoId };
}
