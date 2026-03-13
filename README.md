# test-pr-ready-notify

Test repo for the `@pr-ready` Slack notification workflow.

## What it does

When someone comments `@pr-ready` on a pull request, a GitHub Actions workflow:

1. Checks if the PR is still in draft (warns if so)
2. Auto-resolves GitHub users → Slack users via email matching
3. Sends a Slack notification to `#platform-pr-notify` with `@mentions`
4. Posts a threaded reply mentioning the PR author to auto-subscribe them
5. Marks the PR so duplicate notifications aren't sent

## Why a separate repo?

GitHub-hosted runners (required for `ubuntu-latest`) aren't available on private repos under the free plan. This public repo allows the workflow to run without self-hosted runner infrastructure.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `channels:read`
   - `users:read`
   - `users:read.email`
   - `chat:write`
3. **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token
4. Invite the bot to `#platform-pr-notify` (e.g. `/invite @YourAppName`)

### 2. Add Repository Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | The `xoxb-...` Bot User OAuth Token from step 1 |
| `SLACK_CHANNEL_ID` | Yes | Channel ID for `#platform-pr-notify` (right-click channel → View channel details → copy ID at bottom) |
| `GITHUB_SLACK_OVERRIDES` | No | JSON map for users whose emails can't be auto-resolved, e.g. `{"someuser":"UXXXXXXXX"}` |

### How user resolution works

1. **Manual overrides** — checked first via `GITHUB_SLACK_OVERRIDES`
2. **GitHub profile email** — calls GitHub API to get the user's public email
3. **PR commit email** — falls back to extracting the email from PR commit metadata
4. **Slack lookup** — calls `users.lookupByEmail` to find the matching Slack user
5. **Fallback** — if no Slack user is found, mentions `@github-username` as plain text

## Testing

1. Open a pull request against `master`
2. Comment `@pr-ready` on the PR
3. Check the Actions tab to verify the workflow ran
4. Confirm the Slack message appeared in `#platform-pr-notify` with proper `@mentions`
5. Confirm a threaded reply exists mentioning the PR author
6. Reply in the Slack thread — verify the PR author gets a notification
