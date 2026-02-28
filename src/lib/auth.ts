import { loadConfig, saveConfig, type OAuthSession } from "./config.js";

const TOKEN_REFRESH_SKEW_SECONDS = 60;
const DEFAULT_OAUTH_CLIENT_ID = "ride-cli";

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class AuthRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRefreshError";
  }
}

export function getOauthClientId(): string {
  return process.env.RIDE_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID;
}

function getTokenEndpoint(apiUrl: string): string {
  return new URL("/oauth/token", apiUrl).toString();
}

function parseTokenResponse(
  body: OAuthTokenResponse,
  previous?: OAuthSession
): OAuthSession {
  if (!body.access_token || typeof body.access_token !== "string") {
    throw new AuthRefreshError("OAuth token response did not include access_token.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? nowSeconds + body.expires_in
      : previous?.expiresAt;

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || previous?.refreshToken,
    tokenType: body.token_type || previous?.tokenType || "Bearer",
    expiresAt,
    scope: body.scope || previous?.scope,
  };
}

async function refreshOAuthSession(
  apiUrl: string,
  refreshToken: string,
  previous?: OAuthSession
): Promise<OAuthSession> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getOauthClientId(),
  });
  return exchangeForOAuthSession(apiUrl, params, previous);
}

export interface AuthorizationCodeExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export async function exchangeAuthorizationCode(
  apiUrl: string,
  input: AuthorizationCodeExchangeInput
): Promise<OAuthSession> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: getOauthClientId(),
  });
  return exchangeForOAuthSession(apiUrl, params);
}

async function exchangeForOAuthSession(
  apiUrl: string,
  params: URLSearchParams,
  previous?: OAuthSession
): Promise<OAuthSession> {
  let response: Response;
  try {
    response = await fetch(getTokenEndpoint(apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });
  } catch (error) {
    throw new AuthRefreshError(
      `OAuth token exchange failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  let body: OAuthTokenResponse = {};
  try {
    body = (await response.json()) as OAuthTokenResponse;
  } catch {
    // ignore non-JSON and fail with status below
  }

  if (!response.ok) {
    const detail = body.error_description || body.error || `HTTP ${response.status}`;
    throw new AuthRefreshError(`OAuth token exchange failed: ${detail}`);
  }

  return parseTokenResponse(body, previous);
}

export function getAccessTokenFromConfig(): string | undefined {
  const config = loadConfig();
  return config.oauth?.accessToken || config.token;
}

export function getTokenExpiryTimestamp(): number | undefined {
  return loadConfig().oauth?.expiresAt;
}

export function hasRefreshToken(): boolean {
  return !!loadConfig().oauth?.refreshToken;
}

export function isTokenExpiringSoon(
  expiresAt?: number,
  skewSeconds = TOKEN_REFRESH_SKEW_SECONDS
): boolean {
  if (!expiresAt) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiresAt <= nowSeconds + skewSeconds;
}

export async function ensureAccessToken(
  forceRefresh: boolean = false
): Promise<string | undefined> {
  const config = loadConfig();
  const oauth = config.oauth;
  if (!oauth) {
    return config.token;
  }

  const hasAccessToken = !!oauth.accessToken;
  const shouldRefresh =
    !!oauth.refreshToken &&
    (forceRefresh || !hasAccessToken || isTokenExpiringSoon(oauth.expiresAt));

  if (!shouldRefresh) {
    return oauth.accessToken;
  }

  try {
    const refreshed = await refreshOAuthSession(
      config.apiUrl,
      oauth.refreshToken as string,
      oauth
    );

    const nextConfig = loadConfig();
    nextConfig.oauth = refreshed;
    saveConfig(nextConfig);
    return refreshed.accessToken;
  } catch (error) {
    if (!forceRefresh && hasAccessToken) {
      return oauth.accessToken;
    }

    throw error;
  }
}
