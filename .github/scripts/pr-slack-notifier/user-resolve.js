/**
 * user-resolve.js
 * Resolves GitHub usernames to Slack @-mentions.
 *
 * Resolution order for each GitHub login:
 *   1. GitHub public profile email  → Slack users.lookupByEmail
 *   2. Commit author email for this PR → Slack users.lookupByEmail
 *      (noreply GitHub emails are skipped)
 *   3. Pinned channel mapping (key = github login or email)
 *      → Slack users.lookupByEmail on the mapped email
 *
 * The pinned message must contain a block starting with the line:
 *   github-slack-user-map
 * followed by `key: value` pairs (one per line).
 * Values may be bare email addresses or Slack mailto-link format:
 *   <mailto:user@example.com|user@example.com>
 *
 * Usage:
 *   const { makeUserResolver } = require('./user-resolve');
 *   const resolver = makeUserResolver({ slackApi, github, context, pr, core });
 *   await resolver.loadPinnedMap(channelId);
 *   const mention = await resolver.resolveToSlackMention('octocat');
 *   const mentions = await resolver.getReviewerMentions();
 */

'use strict';

/**
 * @param {{ slackApi: Function, github: object, context: object, pr: object, core: object }} deps
 * @returns {object} resolver
 */
function makeUserResolver({ slackApi, github, context, pr, core }) {
  const prAuthorLogin = pr.user.login;
  const prNumber = pr.number;

  /** email (lowercase) → Slack mention string | null */
  const emailCache = new Map();

  /** GitHub login / email (lowercase) → Slack email string */
  const keyToSlackEmail = {};

  /** Lazily loaded list of PR commits */
  let _prCommits = null;

  // ── Pinned map loading ──────────────────────────────────────────────────

  /**
   * Parse and cache the pinned `github-slack-user-map` message from a channel.
   * Safe to call multiple times; subsequent calls are no-ops if already loaded.
   *
   * @param {string} channelId
   */
  async function loadPinnedMap(channelId) {
    if (Object.keys(keyToSlackEmail).length > 0) return; // already loaded

    try {
      const pinsResult = await slackApi('pins.list', { params: { channel: channelId } });
      if (!pinsResult.ok) return;

      const mappingMsg = pinsResult.items?.find(
        item => item.message?.text?.includes('github-slack-user-map')
      );
      if (!mappingMsg) return;

      const lines = mappingMsg.message.text.split('\n');
      const start = lines.findIndex(l =>
        l.trim().toLowerCase().startsWith('github-slack-user-map')
      );
      if (start === -1) return;

      for (const raw of lines.slice(start + 1)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const sep = line.indexOf(': ');
        if (sep === -1) continue;
        const key = line.slice(0, sep).trim().toLowerCase();
        let val = line.slice(sep + 2).trim();
        // Handle Slack mailto-link format: <mailto:addr|addr>
        const m = val.match(/<mailto:[^|]+\|([^>]+)>/);
        if (m) val = m[1];
        if (key && val) keyToSlackEmail[key] = val;
      }

      core.info(`Loaded ${Object.keys(keyToSlackEmail).length} pinned mappings`);
    } catch (e) {
      core.warning(`loadPinnedMap failed: ${e.message}`);
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Look up a Slack user by email. Returns `<@UID>` string or null.
   * Results are cached.
   */
  async function slackMentionByEmail(email) {
    const lower = email.toLowerCase();
    if (emailCache.has(lower)) return emailCache.get(lower);

    let mention = null;
    try {
      const data = await slackApi('users.lookupByEmail', { params: { email } });
      if (data.ok && data.user) mention = `<@${data.user.id}>`;
    } catch (_) {
      /* ignore — user not found or API error */
    }

    emailCache.set(lower, mention);
    return mention;
  }

  /**
   * Try to resolve an email to a Slack mention, falling back to the pinned map
   * if the direct lookup fails (e.g. corporate email differs from Slack email).
   */
  async function resolveEmailToSlackMention(email) {
    const mention = await slackMentionByEmail(email);
    if (mention) return mention;

    const mapped = keyToSlackEmail[email.toLowerCase()];
    if (mapped && mapped.toLowerCase() !== email.toLowerCase()) {
      return slackMentionByEmail(mapped);
    }
    return null;
  }

  /** Lazily fetch and cache all commits on the PR. */
  async function getPrCommits() {
    if (_prCommits !== null) return _prCommits;
    try {
      const { data } = await github.rest.pulls.listCommits({
        ...context.repo,
        pull_number: prNumber,
      });
      _prCommits = data;
    } catch (_) {
      _prCommits = [];
    }
    return _prCommits;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Resolve a GitHub username to a Slack @-mention string.
   * Falls back to the literal `@login` if nothing resolves.
   *
   * @param {string} ghUsername
   * @returns {Promise<string|null>} mention or null if unresolvable
   */
  async function resolveToSlackMention(ghUsername) {
    // 1) GitHub profile email
    try {
      const { data: ghUser } = await github.rest.users.getByUsername({
        username: ghUsername,
      });
      if (ghUser.email) {
        const mention = await resolveEmailToSlackMention(ghUser.email);
        if (mention) return mention;
      }
    } catch (_) {
      /* ignore */
    }

    // 2) Commit author email (skips GitHub noreply addresses)
    const commits = await getPrCommits();
    const hit = commits.findLast(
      c => c.author?.login?.toLowerCase() === ghUsername.toLowerCase()
    );
    const commitEmail = hit?.commit?.author?.email;
    if (commitEmail && !commitEmail.endsWith('@users.noreply.github.com')) {
      const mention = await resolveEmailToSlackMention(commitEmail);
      if (mention) return mention;
    }

    // 3) Pinned mapping by GitHub login
    const mapped = keyToSlackEmail[ghUsername.toLowerCase()];
    if (mapped) return slackMentionByEmail(mapped);

    core.warning(`Could not resolve ${ghUsername} to Slack user`);
    return null;
  }

  /**
   * Return Slack mention strings for all current PR reviewers
   * (requested_reviewers + anyone who has submitted a review),
   * excluding the PR author.
   *
   * @returns {Promise<string[]>}
   */
  async function getReviewerMentions() {
    const reviewerLogins = new Set();

    for (const r of pr.requested_reviewers || []) {
      if (r.login.toLowerCase() !== prAuthorLogin.toLowerCase()) {
        reviewerLogins.add(r.login);
      }
    }

    try {
      const reviews = await github.paginate(github.rest.pulls.listReviews, {
        ...context.repo,
        pull_number: prNumber,
        per_page: 100,
      });
      for (const r of reviews) {
        if (r.user.login.toLowerCase() !== prAuthorLogin.toLowerCase()) {
          reviewerLogins.add(r.user.login);
        }
      }
    } catch (_) {
      /* ignore */
    }

    const mentions = [];
    for (const login of reviewerLogins) {
      mentions.push((await resolveToSlackMention(login)) || `@${login}`);
    }
    return mentions;
  }

  return { loadPinnedMap, resolveToSlackMention, getReviewerMentions };
}

module.exports = { makeUserResolver };
