// api/teams/auth/authorize.js
// Inicia el flujo OAuth de Microsoft Teams.
// Requiere: ?locationId=<id>
// Redirige al usuario a Microsoft para autorizar.

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export default async function handler(req, res) {
  console.log("=== TEAMS AUTHORIZE CALLED ===");
  console.log(JSON.stringify(req.query));
  console.log(JSON.stringify(req.headers));

  const { locationId } = req.query;

  if (!locationId) {
    return res.status(400).send("Se requiere el parámetro ?locationId=");
  }

  const params = new URLSearchParams({
    client_id:     process.env.TEAMS_CLIENT_ID,
    response_type: "code",
    redirect_uri:  process.env.TEAMS_REDIRECT_URI,
    response_mode: "query",
    scope:         "offline_access OnlineMeetings.ReadWrite User.Read Files.ReadWrite Chat.Read",
    state:         locationId,
  });

  return res.redirect(302, `${MS_AUTH_URL}?${params}`);
}
