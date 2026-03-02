# ride

A command-line tool that connects your [Ride with GPS](https://ridewithgps.com) account to Claude, giving you a conversational interface to your cycling data.

Log in, type `ride`, and start asking questions about your routes, rides, and segments in plain English.

## What can you do with it?

**Explore your ride history**

- "What were my longest rides last summer?"
- "Show me all my rides in Oregon that had more than 3,000 feet of climbing"
- "How has my weekly mileage changed over the past year?"

**Plan and analyze routes**

- "Find me a gravel route near Bend under 50 miles"
- "What's the elevation profile like on this route?"
- "Compare these two routes and tell me which one is hillier"

**Get training insights**

- "What's my average distance per ride this month vs last month?"
- "Which of my rides had the best climbing-to-distance ratio?"
- "Summarize my riding stats for 2025"

**Work with the RWGPS API directly**

- Browse and search the full API docs from your terminal
- Make authenticated API calls without dealing with tokens
- Script bulk operations against your account

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ridewithgps/ride-cli/master/install.sh | bash
```

Installs a single binary to `/usr/local/bin/ride`. Works on macOS and Linux.

### Requirements

- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) (`npm install -g @anthropic-ai/claude-code`)

## Getting started

```bash
ride login    # authenticate with Ride with GPS (opens your browser)
ride status   # verify everything is connected
ride          # start a conversation
```

That's it. Once you're in a session, just ask questions or give instructions in natural language. Claude has access to your RWGPS data through a set of server-provided tools and can search rides, analyze routes, look up segments, and more.

## Usage

### Interactive mode

```bash
ride                # start a conversation
ride --continue     # resume your last conversation
ride --model sonnet # use a specific model
```

Any flags not recognized by `ride` are passed directly to Claude Code, so all Claude CLI options work.

### One-off questions

```bash
ride ask "what was my longest ride this year?"
```

Prints the answer and exits. Useful for scripting or quick lookups.

### Direct tool access

```bash
ride tool list
ride tool search_my_rides --limit 10 --query "gravel"
ride tool analyze_route '{"route_id": 12345, "include_wind": true}'
```

Run RWGPS tools directly without going through a Claude conversation. Handy for scripting or debugging.

### API access

Make authenticated calls to the [RWGPS public API](https://ridewithgps.com/api):

```bash
ride api get /api/v1/users/current
ride api get /api/v1/trips.json --query page_size=10 --query visibility=private
ride api post /api/v1/events.json --json @event.json
ride api delete /api/v1/routes/123.json
```

Options: `--query key=value`, `--header "Name: value"`, `--json <json|@file>`, `--data <text|@file>`.

### API docs

Browse the RWGPS API documentation without leaving your terminal:

```bash
ride api docs list                          # list all endpoints
ride api docs find "users current"          # search by keyword
ride api docs show get /api/v1/users/current # full details for one endpoint
```

Results are cached locally. Use `--refresh` to bypass the cache.

## Commands

| Command | Description |
|---|---|
| `ride` | Start interactive Claude session with RWGPS tools |
| `ride ask "<prompt>"` | One-off query, prints answer and exits |
| `ride tool list` | List available RWGPS tools |
| `ride tool <name> [args]` | Run a tool directly |
| `ride api <get\|post\|put\|patch\|delete> <path>` | Authenticated API call |
| `ride api docs list\|find\|show` | Browse API documentation |
| `ride login` | Authenticate via OAuth (browser-based) |
| `ride logout` | Clear saved credentials |
| `ride status` | Show connection and auth status |
| `ride upgrade` | Update to the latest version |

## Configuration

OAuth credentials are stored in `~/.config/ride/config.json` with restricted permissions.

| Variable | Default | Description |
|---|---|---|
| `RIDE_API_URL` | `https://cowboy.ridewithgps.com` | API base URL |
| `RIDE_CONFIG_DIR` | `~/.config/ride` | Config directory |
| `RIDE_OAUTH_CLIENT_ID` | `ride-cli` | OAuth client ID |

## Troubleshooting

```bash
ride status
```

This shows your auth state, API connectivity, and whether Claude Code is installed. Common fixes:

- **Not logged in** -- `ride login`
- **`claude` not found** -- `npm install -g @anthropic-ai/claude-code`
- **`ride` not found** -- make sure `/usr/local/bin` is in your `PATH`

## License

MIT
