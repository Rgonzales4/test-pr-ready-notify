/**
 * index.js  —  PR Lifecycle Slack Notifier  (entrypoint)
 *
 * Replaces the inline `actions/github-script` body in the
 * "PR lifecycle Slack notification" workflow step.
 *
 * Wires together:
 *   slack-api.js        — low-level Slack fetch wrapper
 *   user-resolve.js     — GitHub → Slack mention resolution
 *   message-builder.js  — text / status config (pure functions)
 *   slack-actions.js    — create / update / reply / subscribe
 *   find-slack-message.js — locate existing thread for PR
 *   event-handlers.js   — per-action logic branches
 *
 * Called by the workflow as:
 *   uses: actions/github-script@v7
 *   with:
 *     script: const run = require('./.github/scripts/pr-slack-notifier/index.js'); await run({ github, context, core });
 */

'use strict';

const { makeSlackApi } = require('./slack-api');
const { makeUserResolver } = require('./user-resolve');
const { makeSlackActions } = require('./slack-actions');
const { findExistingSlackMessage } = require('./find-slack-message');
const {
  handlePrReadyComment,
  handlePrOpened,
  handleConvertedToDraft,
  handleReview,
  handleMerged,
  handleClosed,
} = require('./event-handlers');

/**
 * Main entry point. Called with the standard github-script context.
 *
 * @param {{ github: object, context: object, core: object }} scriptCtx
 */
async function run({ github, context, core }) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.NOTIFY_PR_SLACK_CHANNEL_ID;

  // ── Summarization inputs (from earlier workflow steps) ─────────────────
  const summarize = {
    rawText: (process.env.RAW_TEXT || '').trim(),
    claudeSuccess: process.env.CLAUDE_SUCCESS === 'true',
    claudeResult: (process.env.CLAUDE_RESULT || '').trim(),
  };

  // ── Build Slack API helper ─────────────────────────────────────────────
  const slackApi = makeSlackApi(slackToken, core);

  // ── Determine event action & PR object ────────────────────────────────
  const eventName = context.eventName;
  let pr, action;

  if (eventName === 'issue_comment') {
    const { data } = await github.rest.pulls.get({
      ...context.repo,
      pull_number: context.issue.number,
    });
    pr = data;
    action = 'pr-ready-comment';

  } else if (eventName === 'pull_request') {
    pr = context.payload.pull_request;
    const ghAction = context.payload.action;

    if (ghAction === 'opened' && !pr.draft) action = 'opened';
    else if (ghAction === 'reopened' && !pr.draft) action = 'reopened';
    else if (ghAction === 'ready_for_review') action = 'ready-for-review';
    else if (ghAction === 'converted_to_draft') action = 'converted-to-draft';
    else if (ghAction === 'closed' && pr.merged) action = 'merged';
    else if (ghAction === 'closed') action = 'closed';
    else {
      core.info(`Skipping: action=${ghAction}, draft=${pr.draft}`);
      return;
    }

  } else if (eventName === 'pull_request_review') {
    pr = context.payload.pull_request;

    // Skip bot reviews
    if (context.payload.review.user.type === 'Bot') {
      core.info(`Skipping bot review by ${context.payload.review.user.login}`);
      return;
    }

    const state = context.payload.review.state.toLowerCase();

    // Skip empty review-comment events (inline comments with no review body)
    if (state === 'commented') {
      const reviewBody = (context.payload.review.body || '').trim();
      if (!reviewBody) {
        core.info('Skipping review-commented: empty review body (inline comment only)');
        return;
      }
    }

    if (state === 'approved') action = 'review-approved';
    else if (state === 'changes_requested') action = 'review-changes-requested';
    else if (state === 'commented') action = 'review-commented';
    else {
      core.info(`Skipping review: state=${state}`);
      return;
    }
  }

  const prNumber = pr.number;
  const prTitle = pr.title;
  const prUrl = pr.html_url;
  const prAuthorLogin = pr.user.login;
  core.info(`Event: ${action}, PR #${prNumber}`);

  // ── Fetch channel name (best-effort, falls back to channelId) ──────────
  let channelName = channelId;
  try {
    const info = await slackApi('conversations.info', { params: { channel: channelId } });
    if (info.ok) channelName = info.channel?.name || channelId;
  } catch (_) { /* ignore */ }

  // ── Build helpers ──────────────────────────────────────────────────────
  const resolver = makeUserResolver({ slackApi, github, context, pr, core });
  await resolver.loadPinnedMap(channelId);

  const actions = makeSlackActions({ slackApi, channelId, core, prNumber, prTitle, prUrl });

  // ── Resolve PR author mention ──────────────────────────────────────────
  const authorMention =
    (await resolver.resolveToSlackMention(prAuthorLogin)) || `@${prAuthorLogin}`;

  // ── Find existing Slack thread for this PR ─────────────────────────────
  const existingSlackTs = await findExistingSlackMessage({
    github, context, slackApi, prNumber, prUrl, channelId, core,
  });

  // ── Common deps bag ────────────────────────────────────────────────────
  const deps = {
    existingSlackTs,
    actions,
    resolver,
    github,
    context,
    core,
    pr,
    prNumber,
    prTitle,
    prUrl,
    authorMention,
    channelName,
    summarize,
  };

  // ── Dispatch to the appropriate handler ───────────────────────────────
  if (action === 'pr-ready-comment') {
    await handlePrReadyComment(deps);
    return;
  }

  if (action === 'opened' || action === 'reopened' || action === 'ready-for-review') {
    const result = await handlePrOpened(action, deps);
    if (result.isNew) {
      core.setOutput('is_new', 'true');
      core.setOutput('slack_ts', result.slackTs);
      core.setOutput('channel_name', result.channelName);
    }
    return;
  }

  if (action === 'converted-to-draft') {
    await handleConvertedToDraft(deps);
    return;
  }

  if (action.startsWith('review-')) {
    await handleReview(action, deps);
    return;
  }

  if (action === 'merged') {
    await handleMerged(deps);
    return;
  }

  if (action === 'closed') {
    await handleClosed(deps);
    return;
  }
}

module.exports = run;
