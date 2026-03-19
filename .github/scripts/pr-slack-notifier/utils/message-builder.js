/**
 * message-builder.js
 * Pure functions for constructing Slack message text, plus the status /
 * reaction configuration table.
 *
 * Nothing here calls any external API; all functions are synchronous.
 *
 * Usage:
 *   const { STATUS, ALL_STATUS_REACTIONS, buildParentText, appendSummary }
 *     = require('./message-builder');
 */

'use strict';

const { sanitizeToPlainText } = require('./sanitize');

// ── Status configuration ────────────────────────────────────────────────────
// Maps an action key → { emoji, label } used in parent-message text and
// as the single managed reaction on that message.

/** @type {Record<string, { emoji: string, label: string }>} */
const STATUS = {
  'ready':                    { emoji: ':bell:',              label: 'Ready for re-review' },
  'converted-to-draft':       { emoji: ':pencil2:',          label: 'Draft' },
  'review-approved':          { emoji: ':white_check_mark:', label: 'Approved' },
  'review-commented':         { emoji: ':speech_balloon:',   label: 'Commented' },
  'review-changes-requested': { emoji: ':repeat:',           label: 'Changes requested' },
  'merged':                   { emoji: ':tada:',             label: 'Merged' },
  'closed':                   { emoji: ':no_entry:',         label: 'Closed' },
};

/**
 * All reaction names the bot may ever add.
 * Used when clearing stale reactions — every name except the current one
 * is removed from the parent message.
 * @type {string[]}
 */
const ALL_STATUS_REACTIONS = [
  'bell',
  'white_check_mark',
  'repeat',
  'speech_balloon',
  'pencil2',
  'tada',
  'no_entry',
];

// ── Text builders ───────────────────────────────────────────────────────────

/**
 * Build the mrkdwn text for the PR's parent Slack message.
 *
 * @param {object} opts
 * @param {string|null}   opts.statusKey        - Key into STATUS, or null for "no status yet"
 * @param {number}        opts.prNumber
 * @param {string}        opts.prTitle
 * @param {string}        opts.prUrl
 * @param {string}        opts.authorMention     - Slack mention or "@login" fallback
 * @param {string[]}      [opts.reviewerMentions] - Slack mentions for assigned reviewers
 * @returns {string}
 */
function buildParentText({ statusKey, prNumber, prTitle, prUrl, authorMention, reviewerMentions }) {
  const cfg = statusKey ? STATUS[statusKey] : null;
  const prefix = cfg ? `${cfg.emoji} ` : '';
  const statusSuffix = cfg ? ` [${cfg.label}]` : '';

  let text = `${prefix}*PR #${prNumber} – ${prTitle}${statusSuffix}*\n`;
  text += `*Author:* ${authorMention}\n`;
  text += `*Link:* ${prUrl}`;

  if (reviewerMentions && reviewerMentions.length) {
    text += `\n*Assigned reviewers:* ${reviewerMentions.join(', ')}`;
  }

  return text;
}

/**
 * Optionally append a review/comment summary to a thread-reply message.
 *
 * Rules:
 *  - If Claude summarization succeeded, use the Claude result (or fall back
 *    to rawText if the result is empty).
 *  - If summarization was not run or failed, use rawText directly.
 *  - Only appended when the final summary is non-empty AND < 500 chars
 *    (longer text was intended to be summarized; if that failed we drop it
 *    rather than flooding Slack with walls of text).
 *
 * @param {object} opts
 * @param {string}  opts.baseText      - The message text to (maybe) extend
 * @param {string}  [opts.rawText]     - Original extracted text
 * @param {boolean} [opts.claudeSuccess] - Whether Claude summarization succeeded
 * @param {string}  [opts.claudeResult]  - Claude's summary output
 * @returns {string}
 */
function appendSummary({ baseText, rawText = '', claudeSuccess = false, claudeResult = '' }) {
  let finalSummary = '';

  if (claudeSuccess) {
    // Sanitize Claude's output — defense in depth against prompt injection
    // causing the LLM to return formatted/malicious content
    const sanitizedResult = sanitizeToPlainText(claudeResult);
    finalSummary = sanitizedResult.length > 0 ? sanitizedResult : sanitizeToPlainText(rawText);
  } else {
    finalSummary = sanitizeToPlainText(rawText);
  }

  if (finalSummary.length > 0 && finalSummary.length < 500) {
    return `${baseText}\n\n───\n${finalSummary}`;
  }

  return baseText;
}

module.exports = { STATUS, ALL_STATUS_REACTIONS, buildParentText, appendSummary };
