const BUILTIN_COMMANDS = new Set([
  "login",
  "logout",
  "status",
  "tool",
  "api",
  "ask",
  "upgrade",
  "help",
]);

const RIDE_OPTIONS = new Set([
  "--help",
  "-h",
  "--version",
  "-V",
]);

export function shouldRunClaudeDirectly(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }

  const first = args[0];
  if (BUILTIN_COMMANDS.has(first)) {
    return false;
  }

  if (RIDE_OPTIONS.has(first)) {
    return false;
  }

  return true;
}
