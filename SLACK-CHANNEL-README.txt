# :pushpin: #platform-pr-notify

## *TL;DR*

This channel is automated. When someone comments `/pr-ready` on a GitHub PR (or a PR is opened as non-draft), a *PR Notifier* bot posts a single Slack message with the PR details. All review activity — approvals, change requests, re-review pings, merges— is tracked as thread replies and emoji updates on that message. No manual posting needed.

---

## How to Use

### Getting a PR into the channel

* Comment `/pr-ready` on any open, non-draft pull request. The bot will post a message to this channel with the PR title, author, link, and assigned reviewers.
* If the PR was opened as non-draft (or marked ready for review), the bot posts automatically — no comment needed.

### Reviewing

1. React with :eyes: on the Slack message to signal you're looking at the PR.
2. Submit your review on GitHub (approve, request changes, or comment). The bot posts a thread reply with your review status and updates the parent message emoji.
3. If you request changes or leave comments, reply in the Slack thread and mention the PR author so they're notified.

### Requesting re-review

1. After addressing feedback, comment `/pr-ready` on the PR again. The bot posts a thread reply mentioning all reviewers and updates the parent emoji to :bell:.
2. Reply in the Slack thread and mention your reviewer(s) to let them know changes are addressed.

### Review comment summarization

* When a review includes a body or a `/pr-ready` comment includes additional text, the bot uses Claude to generate a 1-2 sentence summary appended to the thread reply. This keeps Slack threads concise even when GitHub reviews are lengthy.

---

## How the Bot Works

The `pr-slack-notifier` GitHub Actions workflow listens for PR lifecycle events and maintains **one Slack message per PR**. All updates are posted as thread replies, and the parent message emoji reflects the current PR state.

### What triggers a notification

* **PR opened (non-draft) / reopened / marked ready** → New Slack message posted
* **`/pr-ready` comment on PR** → Thread reply mentioning all reviewers :bell: emoji
* **Review submitted (approve / changes requested / comment)** → Thread reply with reviewer and verdict; emoji updated
* **PR converted to draft** → Thread reply :pencil2: emoji
* **PR merged** → Thread reply :tada: emoji
* **PR closed without merge** → Thread reply :no_entry: emoji

### What the bot skips

* Draft PRs do not trigger a message when opened — only when transitioned to ready.
* Bot-authored reviews (e.g. automated checks) are silently ignored.
* Inline-only review comments (no formal review body) are filtered out.
* `/pr-ready` on a merged, closed, or draft PR posts a warning comment on the PR instead of notifying Slack.

### Parent message format

> PR #1234 - Improve authentication middleware
Author: @alice
Link: [https://github.com/org/repo/pull/1234](https://github.com/org/repo/pull/1234)
Assigned reviewers: @bob @carol

---

## Slack Message Emoji Meaning

|Status|Emoji|Meaning|
|  ---  |  ---  |  ---  |
|Waiting for Review|(no emoji)|Initial state when PR is opened|
|Ready for re-review|     :bell: |`/pr-ready` commented posted|
|Converted to draft|     :pencil2: |PR converted back to draft|
|Approved|     :white_check_mark: |Review submitted - approved|
|Changes requested|     :repeat: |Review submitted - changes requested|
|Commented|     :speech_balloon: |Review submitted - comment (formal reviews only, not inline)|
|Merged|     :tada: |PR merged|
|Closed|     :no_entry: |PR closed without merge|

### Notes

* The bot manages emoji reactions automatically. Only one bot reaction is active at a time, reflecting the latest event.
* If adding emoji manually, only use the ones listed above.
* Remove your manual emoji once the PR state changes.

---

# Original Process (Manual / Pre-Automation)

Before the bot was introduced, the channel operated with the same intent but relied on manual actions:

1. Only post "PR ready for review" messages in <#C0A7MFR26GN>.
    1. **One message per PR**
2. Avoid general discussion—if needed, keep it within the message thread.
3. If a PR state has been changed, react to the message with the appropriate emoji [React Emoji Conventions].
4. If PR change(s) requested / comments were made, notify via message thread.
    1. The **reviewer** should reply, and mention **reviewee**, in the existing message.
5. If PR change(s) addressed, notify via message thread.
    1. The **reviewee** should reply, and mention **reviewer(s)**, in the existing message.
6. Reviewers / Reviewee were responsible for removing their own emoji reactions when the PR state changes.

## *Message example (manual process):*

> PR is ready for review: [https://github.com/logilica/securisource/pull/1773](https://github.com/logilica/securisource/pull/1773)

### Notes (for when emojis are added by users)

* Only use the emojis listed above.
* Remove your emoji once the PR state changes.
