import { loadConfig, isAuthenticated } from "../lib/config.js";
import { isClaudeInstalled, getClaudeVersion } from "../lib/claude.js";
import { getTokenExpiryTimestamp, hasRefreshToken } from "../lib/auth.js";

export function statusCommand(): void {
  const config = loadConfig();

  console.log("Ride CLI Status");
  console.log("");

  // Server
  console.log("Server:");
  console.log(`  ${config.apiUrl}`);
  console.log("");

  // Auth
  console.log("Authentication:");
  if (isAuthenticated()) {
    if (config.user) {
      console.log(`  ✓ Logged in as ${config.user.name} (${config.user.email})`);
    } else {
      console.log("  ✓ Logged in");
      console.log("  Cached user profile is unavailable.");
    }

    const expiresAt = getTokenExpiryTimestamp();
    if (expiresAt) {
      const expiryDate = new Date(expiresAt * 1000);
      const remainingSeconds = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      const remainingMinutes = Math.floor(remainingSeconds / 60);
      console.log(`  Access token expires: ${expiryDate.toISOString()}`);
      console.log(`  Time remaining: ${remainingMinutes}m`);
    } else {
      console.log("  Access token expiry: Unknown");
    }
    console.log(`  Refresh token: ${hasRefreshToken() ? "Available" : "Not available"}`);
  } else {
    console.log("  ✗ Not logged in");
    console.log("  Run 'ride login' to authenticate.");
  }
  console.log("");

  // Claude CLI
  console.log("Claude Code:");
  if (isClaudeInstalled()) {
    const version = getClaudeVersion();
    console.log(`  ✓ Installed (${version})`);
  } else {
    console.log("  ✗ Not installed");
    console.log("  Install with: npm install -g @anthropic-ai/claude-code");
  }
  console.log("");
}
