// lib/helpers.js

export function sendResponse(res, status, data) {
  return res.status(status).json(data);
}

export function sendError(res, status, message, details = null) {
  const body = { ok: false, error: message };
  if (details) body.details = details;
  return res.status(status).json(body);
}

export function validateWebhookSecret(req) {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return true;

  const authHeader  = req.headers["authorization"] || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  return bearerToken === expected;
}

export function safeJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}