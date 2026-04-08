// api/teams/auth/authorize.js
// Leg 1 of the Microsoft Teams OAuth flow.
// GHL calls this endpoint to initiate authorization.
// Always redirects to Microsoft using TEAMS_REDIRECT_URI env var.

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPE       = "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read";

export default async function handler(req, res) {
  const { state } = req.query;

  const params = new URLSearchParams({
    client_id:     process.env.TEAMS_CLIENT_ID,
    response_type: "code",
    redirect_uri:  process.env.TEAMS_REDIRECT_URI,
    response_mode: "query",
    scope:         SCOPE,
    state,
  });

  return res.redirect(302, `${MS_AUTH_URL}?${params}`);
}
