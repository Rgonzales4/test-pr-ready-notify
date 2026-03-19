/**
 * find-slack-message.js
 * Locate the existing Slack parent message for a given PR.
 *
 * Two-phase lookup:
 *   1. Fast path  — scan PR comments for a cached `<!-- slack-notify-ts:... -->`
 *                   token written by a previous workflow run.
 *   2. Slow path  — paginate channel history (up to 500 messages, 5 pages of 100)
 *                   looking for a message whose text or blocks reference the PR URL.
 *
 * Returns the Slack message timestamp string, or an empty string if not found.
 *
 * Usage:
 *   const { findExistingSlackMessage } = require('./find-slack-message');
 *   const ts = await findExistingSlackMessage({ github, context, slackApi, prNumber, prUrl, channelId, core });
 */

'use strict';

/**
 * Recursively check whether a tree of Slack block nodes contains a URL string
 * (after stripping Slack link markup `<url|label>` → url).
 *
 * @param {unknown[]} nodes
 * @param {string}    url
 * @returns {boolean}
 */
function blocksContainUrl(nodes, url) {
  if (!Array.isArray(nodes)) return false;
  for (const n of nodes) {
    if (typeof n !== 'object' || n === null) continue;
    for (const v of Object.values(n)) {
      if (typeof v === 'string') {
        // Strip Slack link markup before comparing
        if (v.replace(/<([^>|]+)(\|[^>]+)?>/g, '$1').includes(url)) return true;
      }
      if (Array.isArray(v) && blocksContainUrl(v, url)) return true;
      if (typeof v === 'object' && v !== null && blocksContainUrl([v], url)) return true;
    }
  }
  return false;
}

/**
 * @param {{
 *   github:    object,
 *   context:   object,
 *   slackApi:  Function,
 *   prNumber:  number,
 *   prUrl:     string,
 *   channelId: string,
 *   core:      object,
 * }} opts
 * @returns {Promise<string>} Slack message `ts`, or '' if not found
 */
async function findExistingSlackMessage({ github, context, slackApi, prNumber, prUrl, channelId, core }) {
  // ── Phase 1: PR comment cache ─────────────────────────────────────────
  try {
    const { data: comments } = await github.rest.issues.listComments({
      ...context.repo,
      issue_number: prNumber,
      per_page: 100,
    });

    for (const c of comments) {
      const m = c.body?.match(/<!-- slack-notify-ts:(\S+) -->/);
      if (m) {
        core.info(`Found cached Slack ts from PR comment: ${m[1]}`);
        return m[1];
      }
    }
  } catch (e) {
    core.warning(`PR comment cache lookup failed: ${e.message}`);
  }

  // ── Phase 2: Channel history search (up to 5 pages × 100 messages) ───
  try {
    let cursor;
    for (let page = 0; page < 5; page++) {
      const params = { channel: channelId, limit: '100' };
      if (cursor) params.cursor = cursor;

      const history = await slackApi('conversations.history', { params });
      if (!history.ok) break;

      for (const msg of history.messages || []) {
        const inText = msg.text?.includes(prUrl);
        const inBlocks = blocksContainUrl(msg.blocks, prUrl);

        if (inText || inBlocks) {
          core.info(`Found existing Slack message via history: ts=${msg.ts}`);
          return msg.ts;
        }
      }

      cursor = history.response_metadata?.next_cursor;
      if (!cursor) break;
    }
  } catch (e) {
    core.warning(`Channel history search failed: ${e.message}`);
  }

  return '';
}

module.exports = { findExistingSlackMessage };
