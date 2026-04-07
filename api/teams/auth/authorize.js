// api/teams/auth/authorize.js
// Inicia el flujo OAuth de Microsoft Teams.
// Recibe: ?state=<base64>&redirect_uri=<uri> desde GHL.
// Redirige al usuario a Microsoft para autorizar.

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export default async function handler(req, res) {
  const { state, redirect_uri } = req.query;

  const params = new URLSearchParams({
    client_id:     process.env.TEAMS_CLIENT_ID,
    response_type: "code",
    redirect_uri,
    response_mode: "query",
    scope:         "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read",
    state,
  });

  return res.redirect(302, `${MS_AUTH_URL}?${params}`);
}
