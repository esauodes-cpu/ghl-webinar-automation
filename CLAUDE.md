# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Serverless API (deployed on Vercel) that automates webinar management. GHL workflows trigger webhook calls; the service manages YouTube broadcast lifecycles and publishes replays. 100% agnostic of GHL's API — workflows pass all required data in the request body.

## Development

No build steps. Deploy via Vercel CLI:

```bash
vercel dev       # local development server
vercel deploy    # production deploy
```

All functions in `api/**/*.js` are Vercel serverless functions with a 60s max duration (`vercel.json`).

## Required Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM token encryption |
| `WEBHOOK_SECRET` | Bearer token GHL sends to authenticate webhook calls (optional in dev) |
| `YOUTUBE_REDIRECT_URI` | OAuth redirect URI for YouTube app installation |

## Architecture

### Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/webinar/renew` | `{ locationId, platform, streamId, title, scheduledStartTime, previousBroadcastId, description? }` | `{ ok, meetingUrl, broadcastId }` |
| POST | `/api/webinar/replay` | `{ locationId, platform }` | `{ ok, videoId }` |
| GET | `/api/youtube/auth/callback` | `?code=...&state=<locationId>` | HTML response |

### Request Flow

1. GHL workflow calls `POST /api/webinar/renew` or `/api/webinar/replay`, passing all required data in the body
2. Router validates webhook secret, then calls `_auth-manager.js` to get a platform access token (always from Supabase, never from GHL headers)
3. Router delegates to the platform action module (`youtube/actions/create-event.js` or `upload-replay.js`)
4. All responses use HTTP 200 with `{ ok: true/false }` — GHL workflows read `ok` to detect errors

### Authentication Model

- **Webhook auth**: `WEBHOOK_SECRET` env var, validated in each router. If unset, all requests pass.
- **Platform tokens**: Stored encrypted in Supabase `platform_tokens` table, keyed by `(location_id, platform)`. Auto-refreshed 5 minutes before expiry.
- **`_auth-manager.js`**: Single entry point for token retrieval — delegates to `platform/auth/get-access-token.js` per platform.

### Supabase Schema

**`platform_tokens`** — OAuth tokens per location+platform:
- `location_id`, `platform` (composite unique key)
- `access_token`, `refresh_token` (AES-256-GCM encrypted)
- `expires_at`, `updated_at`
- `broadcast_id` — current YouTube broadcast ID, written by `create-event`, read by `upload-replay`

**`platform_apps`** — App credentials per platform:
- `platform`, `client_id`, `client_secret` (encrypted), `auth_url`, `token_url`, `scopes`

### Encryption

All secrets in Supabase use AES-256-GCM (`lib/crypto.js`). Stored format: `iv_hex:auth_tag_hex:ciphertext_hex`.

### YouTube Broadcast Lifecycle (renew)

`api/youtube/actions/create-event.js`:
1. Set previous broadcast to `private` (takedown)
2. Create new broadcast (`unlisted`)
3. Bind to permanent stream ID
4. Save `broadcast_id` to `platform_tokens` in Supabase

### YouTube Replay

`api/youtube/actions/upload-replay.js`:
1. Read `broadcast_id` from Supabase (same video ID YouTube uses after live ends)
2. Change privacy from `unlisted` → `public`
3. Return `{ videoId }`

### Adding a New Platform

1. Create `api/<platform>/auth/get-access-token.js` exporting `getAccessToken(locationId)`
2. Create `api/<platform>/actions/create-event.js` exporting `createEvent({ accessToken, locationId, ...params })`
3. Create `api/<platform>/actions/upload-replay.js` exporting `uploadReplay({ accessToken, locationId })`
4. Register the platform in `api/_auth-manager.js` and both router `PLATFORM_HANDLERS` maps
