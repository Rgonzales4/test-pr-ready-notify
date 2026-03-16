/**
 * event-handlers.js
 * One exported async function per PR lifecycle event.
 *
 * Each handler receives a pre-wired `deps` bag and executes all the Slack
 * operations for that event, then returns any outputs the workflow needs
 * (e.g. `is_new`, `slack_ts`, `channel_name` for the "opened" case).
 *
 * Handlers:
 *   handlePrReadyComment     – "/pr-ready" issue comment
 *   handlePrOpened           – opened / reopened / ready-for-review
 *   handleConvertedToDraft   – converted_to_draft
 *   handleReview             – review approved / changes-requested / commented
 *   handleMerged             – PR merged
 *   handleClosed             – PR closed (not merged)
 *
 * Usage (called from index.js):
 *   const handlers = require('./event-handlers');
 *   await handlers.handlePrOpened(action, deps);
 */

'use strict';

const { appendSummary } = require('../utils/message-builder');

// ── "/pr-ready" comment ───────────────────────────────────────────────────

/**
 * @param {{
 *   existingSlackTs:    string,
 *   actions:            object,   // makeSlackActions result
 *   resolver:           object,   // makeUserResolver result
 *   github:             object,
 *   context:            object,
 *   core:               object,
 *   pr:                 object,
 *   prNumber:           number,
 *   authorMention:      string,
 *   summarize:          { rawText: string, claudeSuccess: boolean, claudeResult: string },
 * }} deps
 */
async function handlePrReadyComment(deps) {
  let { existingSlackTs } = deps;
  const { actions, resolver, github, context, core, pr, prNumber, authorMention, summarize } = deps;

  // Guard: warn and bail if the PR is in an invalid state
  const guards = {
    merged: pr.merged,
    closed: pr.state === 'closed',
    draft: pr.draft,
  };
  const msgs = {
    merged: '> [!WARNING]\n> This PR has already been merged. No further review is needed.',
    closed: '> [!WARNING]\n> This PR is currently closed. PR review has not been requested.',
    draft: '> [!WARNING]\n> This PR is currently marked as *Draft*.\n> Convert to ready-for-review first.',
  };
  for (const [key, cond] of Object.entries(guards)) {
    if (cond) {
      await github.rest.issues.createComment({
        ...context.repo,
        issue_number: prNumber,
        body: msgs[key],
      });
      return;
    }
  }

  // Create parent message if this is the first notification for this PR
  if (!existingSlackTs) {
    const reviewerMentions = await resolver.getReviewerMentions();
    const ts = await actions.createParentMessage(authorMention, reviewerMentions);
    if (!ts) return;
    existingSlackTs = ts;
    await actions.subscribeAuthor(ts, authorMention);
  }

  const commenterLogin = context.payload.comment.user.login;
  const isSameUser = pr.user.login.toLowerCase() === commenterLogin.toLowerCase();
  const reviewerMentions = await resolver.getReviewerMentions();

  let text = ':bell: PR is ready for re-review';
  if (!isSameUser) {
    const who = (await resolver.resolveToSlackMention(commenterLogin)) || `@${commenterLogin}`;
    text += ` (requested by ${who})`;
  }
  if (reviewerMentions.length) text += `\ncc ${reviewerMentions.join(', ')}`;

  text = appendSummary({ baseText: text, ...summarize });

  await actions.postThreadReply(existingSlackTs, text);
  await actions.updateParentMessage(existingSlackTs, 'ready', authorMention, reviewerMentions);
}

// ── PR opened / reopened / ready-for-review ───────────────────────────────

/**
 * @param {'opened'|'reopened'|'ready-for-review'} action
 * @param {{
 *   existingSlackTs: string,
 *   actions:         object,
 *   resolver:        object,
 *   core:            object,
 *   authorMention:   string,
 *   channelName:     string,
 * }} deps
 * @returns {Promise<{ isNew: boolean, slackTs: string, channelName: string }>}
 */
async function handlePrOpened(action, deps) {
  const { existingSlackTs, actions, resolver, core, authorMention, channelName } = deps;

  const reviewerMentions = await resolver.getReviewerMentions();

  if (existingSlackTs) {
    const verb = action === 'reopened' ? 'has been reopened and is'
      : action === 'opened' ? 'opened and is'
        : 'is now';
    await actions.postThreadReply(existingSlackTs, `:bell: PR ${verb} ready for review`);
    await actions.updateParentMessage(existingSlackTs, 'ready', authorMention, reviewerMentions);
    return { isNew: false, slackTs: existingSlackTs, channelName };
  }

  const ts = await actions.createParentMessage(authorMention, reviewerMentions);
  if (!ts) return { isNew: false, slackTs: '', channelName };

  await actions.subscribeAuthor(ts, authorMention);
  core.info(`New thread created: ts=${ts}, channel=${channelName}`);
  return { isNew: true, slackTs: ts, channelName };
}

// ── Converted to draft ────────────────────────────────────────────────────

/**
 * @param {{ existingSlackTs: string, actions: object, resolver: object, authorMention: string }} deps
 */
async function handleConvertedToDraft(deps) {
  const { existingSlackTs, actions, resolver, authorMention } = deps;
  if (!existingSlackTs) return;

  const reviewerMentions = await resolver.getReviewerMentions();
  await actions.postThreadReply(existingSlackTs, ':pencil2: PR has been converted back to draft');
  await actions.updateParentMessage(existingSlackTs, 'converted-to-draft', authorMention, reviewerMentions);
}

// ── Review submitted ──────────────────────────────────────────────────────

/**
 * @param {string} action  - 'review-approved' | 'review-changes-requested' | 'review-commented'
 * @param {{
 *   existingSlackTs: string,
 *   actions:         object,
 *   resolver:        object,
 *   context:         object,
 *   authorMention:   string,
 *   summarize:       { rawText: string, claudeSuccess: boolean, claudeResult: string },
 * }} deps
 */
async function handleReview(action, deps) {
  const { existingSlackTs, actions, resolver, context, authorMention, summarize } = deps;
  if (!existingSlackTs) return;

  const reviewer = context.payload.review.user.login;
  const mention = (await resolver.resolveToSlackMention(reviewer)) || `@${reviewer}`;

  const templates = {
    'review-approved': `:white_check_mark: ${mention} reviewed this PR — *approved*`,
    'review-changes-requested': `:repeat: ${mention} reviewed this PR — *requested changes*`,
    'review-commented': `:speech_balloon: ${mention} reviewed this PR — *commented*`,
  };

  const text = appendSummary({ baseText: templates[action], ...summarize });

  await actions.postThreadReply(existingSlackTs, text);

  // Re-fetch reviewers: a new reviewer may have just submitted their first review
  const reviewerMentions = await resolver.getReviewerMentions();
  await actions.updateParentMessage(existingSlackTs, action, authorMention, reviewerMentions);
}

// ── Merged ────────────────────────────────────────────────────────────────

/**
 * @param {{ existingSlackTs: string, actions: object, resolver: object, authorMention: string }} deps
 */
async function handleMerged(deps) {
  const { existingSlackTs, actions, resolver, authorMention } = deps;
  if (!existingSlackTs) return;

  const reviewerMentions = await resolver.getReviewerMentions();
  await actions.postThreadReply(existingSlackTs, ':tada: PR has been merged');
  await actions.updateParentMessage(existingSlackTs, 'merged', authorMention, reviewerMentions);
}

// ── Closed (not merged) ───────────────────────────────────────────────────

/**
 * @param {{ existingSlackTs: string, actions: object, resolver: object, authorMention: string }} deps
 */
async function handleClosed(deps) {
  const { existingSlackTs, actions, resolver, authorMention } = deps;
  if (!existingSlackTs) return;

  const reviewerMentions = await resolver.getReviewerMentions();
  await actions.postThreadReply(existingSlackTs, ':no_entry: PR has been closed');
  await actions.updateParentMessage(existingSlackTs, 'closed', authorMention, reviewerMentions);
}

module.exports = {
  handlePrReadyComment,
  handlePrOpened,
  handleConvertedToDraft,
  handleReview,
  handleMerged,
  handleClosed,
};
