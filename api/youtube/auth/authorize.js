// api/youtube/auth/authorize.js
// Inicia el flujo OAuth de YouTube.
// Recibe: ?state=<base64>&redirect_uri=<uri> desde GHL.
// Redirige al usuario a Google para autorizar.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export default async function handler(req, res) {
  const { state, redirect_uri } = req.query;

  const params = new URLSearchParams({
    client_id:     process.env.YOUTUBE_CLIENT_ID,
    redirect_uri,
    response_type: "code",
    scope:         process.env.YOUTUBE_SCOPES,
    access_type:   "offline",
    prompt:        "consent",
    state,
  });

  return res.redirect(302, `${GOOGLE_AUTH_URL}?${params}`);
}
