// api/oauth/callback.js
// Callback OAuth de GHL. Se ejecuta UNA VEZ cuando instalas la app.
// Recibe el authorization code, lo intercambia por tokens,
// y los guarda encriptados en Supabase.

import { saveTokens } from "../../lib/token-manager.js";
import { getAppCredentials } from "../../lib/token-manager.js";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const COMPANY_ID   = "BOkA2GS3MaA0ndQkA8UO";

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;padding:40px;">
        <h1 style="color:#dc2626;">Error de Autorización</h1>
        <p>GHL devolvió: <strong>${error}</strong></p>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;padding:40px;">
        <h1>Falta el código de autorización</h1>
        <p>Instala la app desde el marketplace de GHL.</p>
      </body></html>
    `);
  }

  try {
    // Obtener credenciales de la app de GHL desde Supabase
    const { clientId, clientSecret } = await getAppCredentials("ghl");

    // Intercambiar code por tokens
    const tokenRes = await fetch(`${GHL_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    "authorization_code",
        code,
        user_type:     "Company",
        redirect_uri:  process.env.GHL_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${tokenRes.status} — ${err}`);
    }

    const tokens = await tokenRes.json();

    // Guardar tokens encriptados en Supabase
    await saveTokens(COMPANY_ID, "ghl", {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn:    tokens.expires_in,
    });

    res.status(200).send(`
      <html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;">
        <h1 style="color:#16a34a;">✅ App Instalada Exitosamente</h1>
        <p>Los tokens de GHL han sido guardados de forma segura.</p>
        <ul>
          <li><strong>Company ID:</strong> ${tokens.companyId}</li>
          <li><strong>Token expira en:</strong> ${Math.round(tokens.expires_in / 3600)} horas</li>
        </ul>
        <p style="color:#16a34a;font-weight:bold;">
          Ya puedes usar los endpoints desde GHL.
        </p>
      </body></html>
    `);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send(`
      <html><body style="font-family:system-ui;padding:40px;">
        <h1 style="color:#dc2626;">Error al procesar tokens</h1>
        <p>${err.message}</p>
      </body></html>
    `);
  }
}