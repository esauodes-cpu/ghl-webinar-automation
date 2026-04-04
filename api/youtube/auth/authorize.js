// api/youtube/auth/authorize.js
// Inicia el flujo OAuth de YouTube.
// Requiere: ?locationId=<id>
// Redirige al usuario a Google para autorizar.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export default async function handler(req, res) {
  const { locationId } = req.query;

  if (!locationId) {
    return res.status(400).send("Se requiere el parámetro ?locationId=");
  }

  const params = new URLSearchParams({
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    redirect_uri:  process.env.YOUTUBE_REDIRECT_URI,
    response_type: "code",
    scope:         process.env.YOUTUBE_SCOPES,
    access_type:   "offline",
    prompt:        "consent",
    state:         locationId,
  });

  return res.redirect(302, `${GOOGLE_AUTH_URL}?${params}`);
}
