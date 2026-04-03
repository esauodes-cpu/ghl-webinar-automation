// lib/ghl-api.js
// Llamadas a la API interna de GHL para leer/escribir en subcuentas de clientes.
// Usa el agency token guardado en Supabase para obtener location tokens en tiempo real.

import { getTokens } from "./token-manager.js";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION  = "2021-07-28";
const COMPANY_ID   = "BOkA2GS3MaA0ndQkA8UO";

async function getLocationToken(locationId) {
  const { accessToken: agencyToken } = await getTokens(COMPANY_ID, "ghl");

  const res = await fetch(`${GHL_BASE_URL}/oauth/locationToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
      Version:        API_VERSION,
      Authorization:  `Bearer ${agencyToken}`,
    },
    body: new URLSearchParams({
      companyId:  COMPANY_ID,
      locationId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Location token exchange failed: ${res.status} — ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function ghlRequest(locationId, method, path, body = null) {
  const locationToken = await getLocationToken(locationId);

  const headers = {
    Authorization: `Bearer ${locationToken}`,
    Version:       API_VERSION,
    Accept:        "application/json",
  };

  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `GHL API ${method} ${path} failed: ${res.status} — ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Extrae el nombre limpio de un fieldKey de GHL.
 * "{{ custom_values.webinar_title }}" → "webinar_title"
 */
function cleanFieldKey(fieldKey) {
  return (fieldKey || "")
    .replace(/{{[\s]*custom_values\./g, "")
    .replace(/[\s]*}}/g, "")
    .trim();
}

/**
 * Obtiene todos los custom values de una subcuenta.
 * Devuelve un mapa de cleanKey → value.
 * Ej: { "webinar_title": "Mi Webinar", "live_stream_video_id": "abc123" }
 */
export async function getCustomValues(locationId) {
  const data = await ghlRequest(locationId, "GET", `/locations/${locationId}/customValues`);
  const list = data.customValues || [];

  const map = {};
  for (const cv of list) {
    const key = cleanFieldKey(cv.fieldKey);
    if (key) map[key] = cv.value;
  }
  return map;
}

/**
 * Actualiza uno o varios custom values en una subcuenta.
 * Flujo: GET todos los values → resolver id por fieldKey → PUT por id.
 * updates: { "webinar_title": "Nuevo título", "live_stream_video_id": "xyz" }
 */
export async function updateCustomValues(locationId, updates) {
  const data = await ghlRequest(locationId, "GET", `/locations/${locationId}/customValues`);
  const list = data.customValues || [];

  const results = [];
  const errors  = [];

  for (const [key, value] of Object.entries(updates)) {
    const match = list.find(cv => cleanFieldKey(cv.fieldKey) === key);

    if (!match) {
      errors.push({ key, error: `Custom value "${key}" not found.` });
      continue;
    }

    try {
      await ghlRequest(
        locationId,
        "PUT",
        `/locations/${locationId}/customValues/${match.id}`,
        { name: match.name, value }
      );
      results.push({ key, value, success: true });
    } catch (err) {
      errors.push({ key, error: err.message });
    }
  }

  return { results, errors };
}

export async function getCalendars(locationId) {
  return ghlRequest(locationId, "GET", `/calendars?locationId=${locationId}`);
}

export async function updateCalendarEvent(locationId, eventId, updates) {
  return ghlRequest(locationId, "PUT", `/calendars/events/${eventId}`, updates);
}
