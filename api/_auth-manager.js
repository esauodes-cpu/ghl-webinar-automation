import { getAccessToken as getYouTubeToken } from "./youtube/auth/get-access-token.js";
import { getAccessToken as getTeamsToken }   from "./teams/auth/get-access-token.js";

const handlers = {
  youtube: getYouTubeToken,
  teams:   getTeamsToken,
};

/**
 * Returns a valid access token for the given platform and location.
 * Delegates to each platform's get-access-token module.
 */
export async function getAccessToken(platform, locationId) {
  const handler = handlers[platform];
  if (!handler) throw new Error(`Unsupported platform: "${platform}".`);
  return handler(locationId);
}
