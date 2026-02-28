# ride-cli

`ride` is a CLI for Ride with GPS + Claude Code.

It handles RWGPS auth, starts Claude with RWGPS tools enabled, and lets you run tools directly from the terminal.

## Requirements

- macOS or Linux
- [Bun](https://bun.sh)
- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code)

Install Claude Code CLI if needed:

```bash
npm install -g @anthropic-ai/claude-code
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ridewithgps/ride-cli/master/install.sh | bash
```

This installs `ride` to `/usr/local/bin/ride`.

## Quick Start

```bash
ride login
ride status
ride
```

`ride` starts an interactive Claude session with RWGPS tools available.

On interactive startup, `ride` checks for updates and prompts to upgrade in-place when a newer version is available.
`ride login` stores one OAuth session used by both Cadence tools and `ride api`.

## Commands

- `ride`  
  Start interactive mode.
- `ride [claude-args...]`  
  Pass arguments directly through to Claude Code (for example `--continue`, `--model`, `--dangerously-skip-permissions`).
- `ride ask "<prompt>"`  
  Run a one-off prompt and print output.
- `ride tool list`  
  List available tools.
- `ride tool <name> [args...]`  
  Run a tool directly.
- `ride api request <method> <path> [options]`  
  Call the public API (`/api/v1/*`) with your current OAuth session.
- `ride api <get|post|put|patch|delete> <path> [options]`  
  Convenience methods for API requests.
- `ride api docs list [--limit N] [--refresh]`  
  List API coverage from OpenAPI with endpoint groups.
- `ride api docs find <query> [--limit N] [--refresh]`  
  Search endpoint docs by keyword.
- `ride api docs show <method> <path> [--refresh]`  
  Show parameters, request body, responses, and auth details for one endpoint.
- `ride login`  
  Authenticate with Ride with GPS via OAuth (browser-based PKCE flow).
- `ride login --no-browser`  
  Print authorize URL without trying to launch a browser.
- `ride login --reauth`  
  Force a fresh OAuth login.
- `ride logout`  
  Clear saved credentials.
- `ride status`  
  Show server, auth state, and Claude status.
- `ride upgrade`  
  Update to the latest release binary.

## Tool Usage

List tools:

```bash
ride tool list
```

Run with flags:

```bash
ride tool search_my_rides --limit 10 --query "gravel"
```

Run with JSON:

```bash
ride tool analyze_route '{"route_id":12345,"include_wind":true}'
```

Claude passthrough examples:

```bash
ride --continue
ride --model sonnet
ride --dangerously-skip-permissions
```

Public API examples:

```bash
ride api get /api/v1/users/current
ride api get /api/v1/trips.json --query page_size=10 --query visibility=private
ride api post /api/v1/events.json --json @event.json
ride api request patch /api/v1/events/123.json --header "If-Match: abc123" --data @payload.json
ride api request delete /api/v1/routes/123.json
ride api docs list
ride api docs find "users current"
ride api docs show get /api/v1/users/current
```

API request options:

- `--query key=value` repeatable query params
- `--header "Name: value"` repeatable headers
- `--json <json|@file>` JSON body (validated)
- `--data <text|@file>` raw body

`ride api` only accepts paths under `/api/v1`.

`ride api docs` reads from `/api/v1/openapi.yaml` and caches it locally for faster lookup.
Use `--refresh` on docs commands to bypass cache.

`ride` pre-allows:

- `Bash(ride tool:*)` for RWGPS tool calls
- `Bash(ride api:*)` for RWGPS public API calls + docs lookup
- `Read(/tmp/ride-cli-*/system-prompt.md)` for startup prompt loading
- temp prompt directory access via Claude `--add-dir /tmp/ride-cli-*`

## Configuration

Default API server:

- `https://cowboy.ridewithgps.com`

Optional environment variables:

- `RIDE_API_URL`  
  Override API base URL.
- `RIDE_CONFIG_DIR`  
  Override config directory (default: `~/.config/ride`).
- `RIDE_OAUTH_CLIENT_ID`  
  Override OAuth client id used by `ride login` and token refresh.

OAuth session credentials are stored in `~/.config/ride/config.json` with restricted permissions.

## Troubleshooting

Run:

```bash
ride status
```

Common fixes:

- Not logged in: `ride login`
- `claude` not found: `npm install -g @anthropic-ai/claude-code`
- `ride` not found: ensure `/usr/local/bin` is in your `PATH`

## License

MIT
