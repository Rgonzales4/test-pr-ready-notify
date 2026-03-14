# test-pr-ready-notify

Test repo for the `@pr-ready` Slack notification workflow.

## What it does

When someone comments `@pr-ready` on a pull request, a GitHub Actions workflow:

1. Checks the PR state — skips if merged, closed, draft, or already fully approved
2. Auto-resolves GitHub users → Slack users via email matching
3. **First `@pr-ready`**: posts a new Slack message to the channel, subscribes the PR author to the thread, and comments on the PR with a confirmation (embedding the Slack message reference for future lookups)
4. **Subsequent `@pr-ready`**: finds the stored Slack message reference from the PR comments and replies in the existing Slack thread, mentioning anyone who reacted with :eyes: on the original message
5. Any text in the comment beyond `@pr-ready` is included as additional context

## Why a separate repo?

GitHub-hosted runners (required for `ubuntu-latest`) aren't available on private repos under the free plan. This public repo allows the workflow to run without self-hosted runner infrastructure.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `channels:read` — resolve channel name
   - `channels:history` — View messages and other content
   - `pins:read` — read pinned user mapping message
   - `reactions:read` — fetch :eyes: reactions for thread replies
   - `users:read` — look up Slack users
   - `users:read.email` — look up Slack users by email
   - `chat:write` — post messages and thread replies
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
| PR is merged | This PR has already been merged. No further review is needed.|
| PR is closed | This PR is currently closed. PR review has not been requested.|
| PR is in draft | This PR is currently marked as *Draft*. \n⚠️ Next steps: Convert the PR to ready-for-review status before requesting reviews. |
| All reviews approved, no pending reviewers |This PR already has all required approvals and no pending reviewers.\n> No further review is required unless changes are requested. |

### How thread tracking works

On first `@pr-ready` trigger, a slack message is created that contains the current PR's URL.

On subsequent `@pr-ready` triggers, the slack channel history to look for a message that contains the PR's URL, if found a reply will be sent to that message. If not, a new slack message will be created.

### Required GitHub token permissions

The workflow uses the default `GITHUB_TOKEN` with these permissions:

| Permission | Level | Purpose |
|------------|-------|---------|
| `contents` | `read` | Checkout context |
| `pull-requests` | `write` | Read PR details, post confirmation comments |
| `issues` | `write` | Post comments on issue/PR threads |

## Testing

1. Open a pull request against `master`
2. Comment `@pr-ready` on the PR
3. Check the Actions tab to verify the workflow ran
4. Confirm the Slack message appeared in the channel with proper `@mentions`
5. Confirm a PR comment was posted with the Slack notification confirmation
6. Confirm a threaded reply exists mentioning the PR author
7. React with :eyes: on the Slack message
8. Comment `@pr-ready` again on the PR
9. Confirm a thread reply appeared in the **same** Slack thread mentioning the :eyes: reactors
10. Reply in the Slack thread — verify the PR author gets a notification

Hello World!