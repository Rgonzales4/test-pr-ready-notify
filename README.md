# test-pr-ready-notify

Test repo for the `@pr-ready` Slack notification workflow.

## What it does

When someone comments `@pr-ready` on a pull request, a GitHub Actions workflow:

1. Checks the PR state — skips if merged, closed, draft, or already fully approved
2. Auto-resolves GitHub users → Slack users via email matching
3. **First `@pr-ready`**: posts a new Slack message to the channel and subscribes the PR author to the thread
4. **Subsequent `@pr-ready`**: replies in the existing Slack thread, mentioning anyone who reacted with :eyes: on the original message
5. Any text in the comment beyond `@pr-ready` is included as additional context

## Why a separate repo?

GitHub-hosted runners (required for `ubuntu-latest`) aren't available on private repos under the free plan. This public repo allows the workflow to run without self-hosted runner infrastructure.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `channels:read`
   - `pins:read`
   - `reactions:read`
   - `users:read`
   - `users:read.email`
   - `chat:write`
3. **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token
4. Invite the bot to your notification channel (e.g. `/invite @YourAppName`)

### 2. Add Repository Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | The `xoxb-...` Bot User OAuth Token from step 1 |
| `SLACK_CHANNEL_ID` | Yes | Channel ID (right-click channel → View channel details → copy ID at bottom) |

### 3. Pin the user mapping message

In the Slack channel, post and **pin** a message with the following format:

```
⚠️ DO NOT edit or delete this message — it is used by the PR notification bot.
Contact @your-admin if you have questions.

---
github-slack-user-map
# Ricardo Gonzales
Rgonzales4: ricardo@logilica.com
ricardo.g@gmail.com: ricardo@logilica.com

# External contractor
ext-dev: contractor@external.com
```

- Everything above the `github-slack-user-map` marker is ignored — customize the warning text as needed
- Lines starting with `#` are comments
- **Keys** can be a GitHub username OR an email address
- **Values** are always the user's Slack email
- Use `": "` (colon + space) as the separator between key and value
- Email keys make the mapping **resilient to GitHub handle changes** — if a user renames their GitHub account, their commit email still matches

### How user resolution works

For each GitHub username, the bot tries these sources in order until a Slack user is found:

1. **GitHub profile email** → Slack `lookupByEmail`
2. **PR commit email** → Slack `lookupByEmail` (skips `@users.noreply.github.com`)
3. **Pinned message email key** — if the email from step 1 or 2 didn't match a Slack user directly, checks if it's mapped to a different Slack email in the pinned message
4. **Pinned message GH username key** — looks up the GitHub username in the pinned message
5. **Fallback** — mentions `@github-username` as plain text

Steps 1–2 resolve most users automatically. The pinned message covers two cases:
- **GitHub username key**: for users with no public email and no commits on the PR (e.g. the commenter requesting review)
- **Email key**: for users whose GitHub/git email differs from their Slack email (e.g. personal Gmail → `@logilica.com`)

### When the workflow skips

The bot comments on the PR and does **not** send a Slack message if:

| Condition | Comment posted |
|-----------|---------------|
| PR is merged | "This PR is already merged." |
| PR is closed | "This PR is closed." |
| PR is in draft | "Make sure PR is not in Draft before requesting a review." |
| All reviews approved, no pending reviewers | "This PR already has all required approvals with no pending reviewers." |

## Testing

1. Open a pull request against `master`
2. Comment `@pr-ready` on the PR
3. Check the Actions tab to verify the workflow ran
4. Confirm the Slack message appeared in the channel with proper `@mentions`
5. Confirm a threaded reply exists mentioning the PR author
6. React with :eyes: on the Slack message
7. Comment `@pr-ready` again on the PR
8. Confirm a thread reply appeared mentioning the :eyes: reactors
9. Reply in the Slack thread — verify the PR author gets a notification
