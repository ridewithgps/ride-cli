import { clearAuth } from "../lib/config.js";

export function logoutCommand(): void {
  clearAuth();
  console.log("  ✓ Logged out");
}
