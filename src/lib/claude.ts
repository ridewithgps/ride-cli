import { execSync } from "node:child_process";

export function isClaudeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getClaudeVersion(): string {
  try {
    return execSync("claude --version", { stdio: "pipe" }).toString().trim();
  } catch {
    return "unknown";
  }
}
