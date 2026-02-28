import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { exchangeAuthorizationCode, getOauthClientId } from "../lib/auth.js";
import { getCurrentUserV1, ApiError } from "../lib/api.js";
import { isAuthenticated, loadConfig, saveConfig } from "../lib/config.js";

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CALLBACK_PATH = "/oauth/callback";

interface PkceCodes {
  codeVerifier: string;
  codeChallenge: string;
}

interface CallbackServer {
  redirectUri: string;
  waitForCode: (timeoutMs: number) => Promise<string>;
  close: () => Promise<void>;
}

export interface LoginCommandOptions {
  noBrowser?: boolean;
  reauth?: boolean;
}

export async function loginCommand(
  options: LoginCommandOptions = {}
): Promise<void> {
  const config = loadConfig();

  console.log("");
  console.log("  Log in to Ride with GPS");
  console.log(`  Server: ${config.apiUrl}`);
  console.log("");

  const hasReusableOAuthSession = !!config.oauth?.refreshToken;
  if (isAuthenticated() && !options.reauth && hasReusableOAuthSession) {
    if (config.user) {
      console.log(`  ✓ Already logged in as ${config.user.name} (${config.user.email})`);
    } else {
      console.log("  ✓ Already logged in.");
    }
    console.log("  Run 'ride login --reauth' to re-authenticate.");
    console.log("");
    return;
  }

  if (isAuthenticated() && !options.reauth && !hasReusableOAuthSession) {
    console.log("  Existing credentials found, but a fresh OAuth login is required.");
    console.log("");
  }

  const pkce = createPkceCodes();
  const state = randomBase64Url(24);
  const callbackServer = await startCallbackServer(state);
  const authorizeUrl = buildAuthorizeUrl(config.apiUrl, {
    clientId: getOauthClientId(),
    redirectUri: callbackServer.redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
  });

  try {
    console.log("  Open this URL to authorize:");
    console.log(`  ${authorizeUrl}`);
    if (!options.noBrowser) {
      const opened = await openBrowser(authorizeUrl);
      if (!opened) {
        console.log("  (Could not open a browser automatically on this system.)");
      }
    }
    console.log("");
    process.stdout.write("  Waiting for authorization");

    const code = await callbackServer.waitForCode(AUTH_TIMEOUT_MS);

    process.stdout.write("\n");
    const oauth = await exchangeAuthorizationCode(config.apiUrl, {
      code,
      redirectUri: callbackServer.redirectUri,
      codeVerifier: pkce.codeVerifier,
    });

    const nextConfig = loadConfig();
    nextConfig.oauth = oauth;
    delete nextConfig.token;
    delete nextConfig.apikey;
    saveConfig(nextConfig);

    try {
      const currentUser = await getCurrentUserV1();
      if (currentUser.user) {
        const userName = currentUser.user.name || nextConfig.user?.name || "Unknown";
        const userEmail = currentUser.user.email || nextConfig.user?.email || "unknown";

        nextConfig.user = {
          id: currentUser.user.id,
          name: userName,
          email: userEmail,
        };
        saveConfig(nextConfig);
      }
    } catch {
      // Non-fatal: token is stored even if user profile lookup fails.
    }

    console.log("");
    if (nextConfig.user) {
      console.log(
        `  ✓ Logged in as ${nextConfig.user.name} (${nextConfig.user.email})`
      );
    } else {
      console.log("  ✓ Logged in");
    }
    console.log("");
  } catch (error) {
    console.log("");
    if (error instanceof ApiError && error.isNetworkError) {
      console.error(`  Could not reach ${config.apiUrl}`);
      console.error("  Check your connection and try again.");
    } else if (error instanceof Error) {
      console.error(`  Login failed: ${error.message}`);
    } else {
      console.error("  Login failed.");
    }
    process.exit(1);
  } finally {
    await callbackServer.close();
  }
}

function buildAuthorizeUrl(
  apiUrl: string,
  input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }
): string {
  const url = new URL("/oauth/authorize", apiUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function createPkceCodes(): PkceCodes {
  const codeVerifier = randomBase64Url(64);
  const digest = createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = toBase64Url(digest);
  return { codeVerifier, codeChallenge };
}

function randomBase64Url(bytes: number): string {
  return toBase64Url(randomBytes(bytes));
}

function toBase64Url(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let resolved = false;
  let resolveCode: ((code: string) => void) | undefined;
  let rejectCode: ((error: Error) => void) | undefined;

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const completeWithCode = (code: string): void => {
    if (resolved) return;
    resolved = true;
    resolveCode?.(code);
  };

  const failWithError = (error: Error): void => {
    if (resolved) return;
    resolved = true;
    rejectCode?.(error);
  };

  const server = createServer((req, res) => {
    handleCallbackRequest(req, res, expectedState, completeWithCode, failWithError);
  });

  server.on("error", (error) => {
    failWithError(
      new Error(
        `Failed to receive OAuth callback: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", (error) => {
      reject(error);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine local callback server port.");
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    waitForCode: (timeoutMs: number) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          failWithError(new Error("Timed out waiting for browser authorization."));
        }, timeoutMs);

        codePromise
          .then((code) => {
            clearTimeout(timeout);
            resolve(code);
          })
          .catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
      }),
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function handleCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  expectedState: string,
  onCode: (code: string) => void,
  onError: (error: Error) => void
): void {
  const requestUrl = new URL(
    req.url || "/",
    `http://${req.headers.host || "127.0.0.1"}`
  );

  if (requestUrl.pathname !== CALLBACK_PATH) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (state !== expectedState) {
    res.statusCode = 400;
    res.end("Invalid state.");
    onError(new Error("OAuth state verification failed."));
    return;
  }

  if (oauthError) {
    res.statusCode = 400;
    res.end("Authorization was denied.");
    onError(new Error(errorDescription || oauthError));
    return;
  }

  if (!code) {
    res.statusCode = 400;
    res.end("Missing authorization code.");
    onError(new Error("Authorization callback did not include a code."));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    "<!doctype html><html><body><h1>Ride CLI authorization complete</h1><p>You can close this window and return to your terminal.</p></body></html>"
  );
  onCode(code);
}

async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawn(cmd, args, {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      child.once("error", () => finish(false));
      child.once("exit", (code) => finish(code === 0));
      setTimeout(() => finish(true), 500);
    } catch {
      finish(false);
    }
  });
}
