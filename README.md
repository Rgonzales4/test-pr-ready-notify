# test-pr-ready-notify

Test repo for the PR lifecycle Slack notification workflow.

## What it does

Maintains **one Slack message per PR** in a designated channel. All lifecycle events are posted as thread replies, and the parent message text is updated with an emoji prefix showing the current status.

### Workflow

1. **PR opened** (non-draft) or **marked ready for review** → Slack message posted to channel, PR author subscribed to thread
2. **Reviewer** reacts with :eyes: on the Slack message to indicate they're reviewing
3. **Review submitted** → thread reply posted: `@reviewer reviewed this PR — approved / requested changes / commented`
4. **PR author** makes changes, then comments `@pr-ready` → thread reply notifies all PR reviewers it's ready for re-review
5. **PR merged / closed / converted to draft** → thread reply with corresponding status

### Parent message status

The parent message text is updated with an emoji prefix reflecting the latest event. The same emoji is also added as a reaction (mutually exclusive — only one bot reaction at a time).

| Status | Emoji | When |
|--------|-------|------|
| Waiting for reviews | _(none)_ | Initial state when PR is opened |
| Ready for re-review | :bell: | `@pr-ready` comment posted |
| Converted to draft | :pencil2: | PR converted back to draft |
| Approved | :white_check_mark: | Review submitted — approved |
| Changes requested | :repeat: | Review submitted — changes requested |
| Commented | :speech_balloon: | Review submitted — comment |
| Merged | :tada: | PR merged |
| Closed | :no_entry: | PR closed without merge |

### Thread replies

| Event | Thread message |
|-------|---------------|
| PR opened / ready for review | `PR is ready for review` |
| `@pr-ready` comment | `:bell: PR is ready for re-review` + cc's all PR reviewers |
| Converted to draft | `:pencil2: PR has been converted back to draft` |
| Review — approved | `:white_check_mark: @reviewer reviewed this PR — approved` |
| Review — changes requested | `:repeat: @reviewer reviewed this PR — requested changes` |
| Review — commented | `:speech_balloon: @reviewer reviewed this PR — commented` |
| Merged | `:tada: PR has been merged` |
| Closed | `:no_entry: PR has been closed` |

### When the workflow skips

For `@pr-ready` comments, the bot posts a PR comment and does **not** notify Slack if:

| Condition | Response |
|-----------|----------|
| PR is merged | Warning: already merged |
| PR is closed | Warning: PR is closed |
| PR is in draft | Warning: convert to ready-for-review first |
| No Slack thread exists | Note: thread is created when PR is opened |

Draft PRs do **not** trigger a Slack notification when opened. The first message is only sent when the PR is opened as non-draft or transitions from draft to ready.

For other lifecycle events (review, close, merge, draft conversion), if no existing Slack thread is found, the event is silently skipped.

## Why a separate repo?

GitHub-hosted runners (required for `ubuntu-latest`) aren't available on private repos under the free plan. This public repo allows the workflow to run without self-hosted runner infrastructure.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**:
   - `channels:read` — resolve channel name
   - `channels:history` — search channel for existing PR messages
   - `pins:read` — read pinned user mapping message
   - `reactions:read` — read reactions on messages
   - `reactions:write` — add/remove status reactions on parent messages
   - `users:read` — look up Slack users
   - `users:read.email` — look up Slack users by email
   - `chat:write` — post messages, thread replies, and update parent messages
3. **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token
4. Invite the bot to your notification channel (e.g. `/invite @YourAppName`)

> **Note:** After adding new scopes, you must click **Reinstall to Workspace** for the changes to take effect.

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

- Everything above the `github-slack-user-map` marker is ignored
- Lines starting with `#` are comments
- **Keys** can be a GitHub username OR an email address
- **Values** are always the user's Slack email
- Use `": "` (colon + space) as the separator

### How user resolution works

For each GitHub username, the bot tries these sources in order:

1. **GitHub profile email** → Slack `lookupByEmail`
2. **PR commit email** → Slack `lookupByEmail` (skips `@users.noreply.github.com`)
3. **Pinned message email key** → mapped Slack email
4. **Pinned message GH username key** → mapped Slack email
5. **Fallback** → `@github-username` as plain text

### How thread tracking works

When a PR is first opened (non-draft) or marked ready for review, a Slack message is posted containing the PR URL.

On subsequent events, the workflow searches channel history (up to 500 messages) for a message containing the PR URL. If found, updates are posted as thread replies. If not found, the event is skipped.

### GitHub event triggers

| Event | Types | Purpose |
|-------|-------|---------|
| `issue_comment` | `created` | `@pr-ready` re-review requests |
| `pull_request` | `opened`, `ready_for_review`, `converted_to_draft`, `closed` | PR lifecycle |
| `pull_request_review` | `submitted` | Review notifications |

### Required GitHub token permissions

| Permission | Level | Purpose |
|------------|-------|---------|
| `contents` | `read` | Checkout context |
| `pull-requests` | `write` | Read PR details, list reviews |
| `issues` | `write` | Post comments on PR threads |

## Testing

1. Open a pull request against `master` (non-draft)
2. Confirm a Slack message appeared in the channel — no emoji (waiting for reviews)
3. React with :eyes: on the Slack message (as a reviewer would)
4. Submit a review (approve, request changes, or comment)
5. Confirm thread reply with review status and parent message emoji updated
6. Comment `@pr-ready` on the PR
7. Confirm thread reply mentioning reviewers and parent emoji changed to :bell:
8. Convert PR to draft → confirm :pencil2: thread reply and emoji
9. Mark ready for review → confirm thread reply and :bell: emoji
10. Merge or close → confirm :tada: or :no_entry: thread reply and emoji

Hello World!