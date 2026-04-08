// api/teams/auth/authorize.js
// Leg 1 of the Microsoft Teams OAuth flow.
// GHL calls this endpoint to initiate authorization.
// Always redirects to Microsoft using TEAMS_REDIRECT_URI env var.

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPE       = "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read";

export default async function handler(req, res) {
  const { state, redirect_uri } = req.query;

  // Embed GHL's redirect_uri and original state into our state so callback can redirect back.
  const stateObj = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
  stateObj.ghlRedirectUri = redirect_uri;
  stateObj.ghlState       = state;
  const enrichedState = Buffer.from(JSON.stringify(stateObj)).toString("base64");

  const params = new URLSearchParams({
    client_id:     process.env.TEAMS_CLIENT_ID,
    response_type: "code",
    redirect_uri:  process.env.TEAMS_REDIRECT_URI,
    response_mode: "query",
    scope:         SCOPE,
    state:         enrichedState,
  });

  return res.redirect(302, `${MS_AUTH_URL}?${params}`);
}
