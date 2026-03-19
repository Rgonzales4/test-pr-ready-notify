/**
 * slack-actions.js
 * Higher-level Slack operations that act on a PR's parent message and thread.
 *
 * Each function maps to a discrete action:
 *   createParentMessage  – post a brand-new parent message for a PR
 *   updateParentMessage  – update text + manage status reactions
 *   postThreadReply      – post a reply inside the PR's thread
 *   subscribeAuthor      – invisible subscribe-ping so the author sees replies
 *
 * Usage:
 *   const { makeSlackActions } = require('./slack-actions');
 *   const actions = makeSlackActions({ slackApi, channelId, core, ...prInfo });
 *   const ts = await actions.createParentMessage(authorMention, reviewerMentions);
 */

'use strict';

const { STATUS, ALL_STATUS_REACTIONS, buildParentText } = require('./message-builder');

/**
 * @param {{
 *   slackApi:   Function,
 *   channelId:  string,
 *   core:       object,
 *   prNumber:   number,
 *   prTitle:    string,
 *   prUrl:      string,
 * }} deps
 */
function makeSlackActions({ slackApi, channelId, core, prNumber, prTitle, prUrl }) {

  // ── Shared block builder ─────────────────────────────────────────────────

  /** Wrap mrkdwn text in a single-section blocks array. */
  function toBlocks(text) {
    return [{ type: 'section', text: { type: 'mrkdwn', text } }];
  }

  // ── Public actions ───────────────────────────────────────────────────────

  /**
   * Post a new parent message for the PR. Returns the Slack timestamp (`ts`)
   * of the created message, or null if the API call failed.
   *
   * @param {string}   authorMention
   * @param {string[]} reviewerMentions
   * @returns {Promise<string|null>}
   */
  async function createParentMessage(authorMention, reviewerMentions) {
    const text = buildParentText({
      statusKey: null, // no status prefix on creation
      prNumber, prTitle, prUrl,
      authorMention, reviewerMentions,
    });

    const r = await slackApi('chat.postMessage', {
      body: {
        channel: channelId,
        text,
        unfurl_links: false,
        blocks: toBlocks(text),
      },
    });

    if (!r.ok) {
      core.setFailed(`chat.postMessage: ${r.error}`);
      return null;
    }

    core.info(`New Slack message: ts=${r.ts}`);
    return r.ts;
  }

  /**
   * Update the parent message's text to reflect a new status, and swap the
   * managed status reaction accordingly.
   *
   * Steps:
   *   1. `chat.update` — new text + blocks
   *   2. `reactions.add` — add the current status emoji
   *   3. `reactions.remove` (parallel) — remove all other managed emojis
   *
   * @param {string}   ts               - Slack timestamp of the parent message
   * @param {string}   statusKey        - Key into STATUS
   * @param {string}   authorMention
   * @param {string[]} reviewerMentions
   */
  async function updateParentMessage(ts, statusKey, authorMention, reviewerMentions) {
    const cfg = STATUS[statusKey];
    if (!cfg) return;

    const reaction = cfg.emoji.replace(/:/g, ''); // strip colons for the API
    const text = buildParentText({
      statusKey, prNumber, prTitle, prUrl,
      authorMention, reviewerMentions,
    });

    // 1. Update message text
    try {
      const r = await slackApi('chat.update', {
        body: {
          channel: channelId,
          ts,
          text,
          unfurl_links: false,
          blocks: toBlocks(text),
        },
      });
      if (!r.ok) core.warning(`chat.update: ${r.error}`);
    } catch (e) {
      core.warning(`chat.update threw: ${e.message}`);
    }

    // 2. Add the current status reaction
    try {
      const r = await slackApi('reactions.add', {
        body: { channel: channelId, timestamp: ts, name: reaction },
      });
      if (!r.ok && r.error !== 'already_reacted') {
        core.warning(`reactions.add(${reaction}): ${r.error}`);
      }
    } catch (e) {
      core.warning(`reactions.add(${reaction}) threw: ${e.message}`);
    }

    // 3. Remove all other managed reactions in parallel
    const removals = ALL_STATUS_REACTIONS
      .filter(name => name !== reaction)
      .map(name =>
        slackApi('reactions.remove', {
          body: { channel: channelId, timestamp: ts, name },
        })
          .then(r => {
            if (!r.ok && r.error !== 'no_reaction') {
              core.warning(`reactions.remove(${name}): ${r.error}`);
            }
          })
          .catch(() => { /* reaction not present — ignore */ })
      );

    await Promise.allSettled(removals);
  }

  /**
   * Post a reply inside the PR's Slack thread.
   *
   * @param {string} ts    - Parent message timestamp (thread root)
   * @param {string} text  - mrkdwn message text
   * @returns {Promise<string|null>} Reply timestamp, or null on failure
   */
  async function postThreadReply(ts, text) {
    const r = await slackApi('chat.postMessage', {
      body: {
        channel: channelId,
        thread_ts: ts,
        text,
        unfurl_links: false,
        blocks: toBlocks(text),
      },
    });

    if (!r.ok) core.warning(`Thread reply failed: ${r.error}`);
    return r.ok ? r.ts : null;
  }

  /**
   * Post an invisible subscription ping so the PR author receives
   * future thread-reply notifications from Slack.
   *
   * No-ops if the mention is not a real `<@UID>` (e.g. fallback "@login").
   *
   * @param {string} ts            - Parent message timestamp
   * @param {string} authorMention
   */
  async function subscribeAuthor(ts, authorMention) {
    if (!authorMention.startsWith('<@')) return;
    try {
      await slackApi('chat.postMessage', {
        body: {
          channel: channelId,
          thread_ts: ts,
          text: `${authorMention} — you'll be notified of replies to this thread.`,
        },
      });
    } catch (e) {
      core.warning(`Author subscription failed: ${e.message}`);
    }
  }

  return { createParentMessage, updateParentMessage, postThreadReply, subscribeAuthor };
}

module.exports = { makeSlackActions };
