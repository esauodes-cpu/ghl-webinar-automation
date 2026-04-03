// lib/ghl-api.js
// Llamadas a la API interna de GHL para leer/escribir en subcuentas de clientes.
// Usa los tokens de GHL guardados en Supabase.

import { getTokens, saveTokens } from "./token-manager.js";

const GHL_BASE_URL  = "https://services.leadconnectorhq.com";
const API_VERSION   = "2021-07-28";

/**
 * Hace una request autenticada a la API de GHL.
 */
async function ghlRequest(locationId, method, path, body = null) {
  const { accessToken } = await getTokens(locationId, "ghl");

  const headers = {
    Authorization: `Bearer ${accessToken}`,
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
 * Obtiene todos los custom values de una subcuenta.
 * GET /locations/{locationId}/customValues
 */
export async function getCustomValues(locationId) {
  const data = await ghlRequest(locationId, "GET", `/locations/${locationId}/customValues`);
  const list = data.customValues || [];

  // Retorna un mapa de key → value para acceso fácil
  // Ej: { "live_stream_video_id": "R2NsiS_ZEnU", ... }
  const map = {};
  for (const cv of list) {
    if (cv.key) map[cv.key] = cv.value;
  }
  return map;
}

/**
 * Actualiza un custom value por nombre (key).
 * Primero busca el ID del custom value, luego lo actualiza.
 */
export async function updateCustomValue(locationId, key, value) {
  // Obtener el catálogo completo para encontrar el ID
  const data = await ghlRequest(locationId, "GET", `/locations/${locationId}/customValues`);
  const list = data.customValues || [];

  const match = list.find(cv => cv.key === key);
  if (!match) {
    throw new Error(`Custom value with key "${key}" not found in location ${locationId}.`);
  }

  return ghlRequest(
    locationId,
    "PUT",
    `/locations/${locationId}/customValues/${match.id}`,
    { name: match.name, value }
  );
}

/**
 * Actualiza múltiples custom values en una sola operación.
 * Ej: { "live_stream_video_id": "abc123", "webinar_stream_id": "xyz" }
 */
export async function updateCustomValues(locationId, updates) {
  // Obtener catálogo una sola vez
  const data = await ghlRequest(locationId, "GET", `/locations/${locationId}/customValues`);
  const list = data.customValues || [];

  const results = [];
  const errors  = [];

  for (const [key, value] of Object.entries(updates)) {
    const match = list.find(cv => cv.key === key);
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

/**
 * Obtiene los calendarios de una subcuenta.
 * GET /calendars
 */
export async function getCalendars(locationId) {
  return ghlRequest(locationId, "GET", `/calendars?locationId=${locationId}`);
}

/**
 * Actualiza un evento de calendario (extiende fechas).
 * PUT /calendars/events/{eventId}
 */
export async function updateCalendarEvent(locationId, eventId, updates) {
  return ghlRequest(
    locationId,
    "PUT",
    `/calendars/events/${eventId}`,
    updates
  );
}