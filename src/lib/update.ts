import { shouldRunClaudeDirectly } from "./invocation.js";

const SKIP_UPDATE_COMMANDS = new Set([
  "upgrade",
  "login",
  "--version",
  "-V",
  "--help",
  "-h",
]);

export function shouldCheckForUpdates(command?: string): boolean {
  if (!command) {
    return true;
  }

  return !SKIP_UPDATE_COMMANDS.has(command);
}

export function shouldPromptForUpgrade(
  args: string[],
  isInteractiveTerminal: boolean
): boolean {
  return isInteractiveTerminal && shouldRunClaudeDirectly(args);
}

export function isUpgradeAccepted(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}
