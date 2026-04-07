import { getSupabase } from "../supabase.js";

const GRAPH_ONLINE_MEETINGS = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

export async function createEvent({ accessToken, locationId, title, scheduledStartTime }) {
  const startDateTime = new Date(scheduledStartTime).toISOString();
  const endDateTime   = new Date(new Date(scheduledStartTime).getTime() + 2 * 60 * 60 * 1000).toISOString();

  const res = await fetch(GRAPH_ONLINE_MEETINGS, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject:            title,
      startDateTime,
      endDateTime,
      lobbyBypassSettings: {
        scope:                 "everyone",
        isDialInBypassEnabled: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Teams meeting creation failed: ${res.status} — ${err}`);
  }

  const meeting = await res.json();
  const { joinWebUrl, id } = meeting;

  if (!joinWebUrl || !id) {
    throw new Error("Incomplete meeting data returned by Microsoft Graph.");
  }

  const supabase = getSupabase();
  await supabase
    .from("platform_tokens")
    .update({ broadcast_id: id, webinar_title: title })
    .eq("location_id", locationId)
    .eq("platform", "teams");

  return { meetingUrl: joinWebUrl, broadcastId: id };
}
