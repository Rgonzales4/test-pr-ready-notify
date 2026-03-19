/**
 * sanitize.js
 * Text sanitization and bot detection utilities.
 *
 * - sanitizeToPlainText: strips markdown, HTML, URLs, code blocks, and control
 *   characters from user-provided text so only readable prose remains.
 *   This is the primary defense against prompt injection when text is later
 *   passed to an LLM for summarization.
 *
 * - isBot: identifies bot accounts by GitHub user type or login pattern.
 *
 * Usage:
 *   const { sanitizeToPlainText, isBot } = require('./sanitize');
 *   const clean = sanitizeToPlainText(rawComment);
 *   if (isBot(user.login, user.type)) { ... }
 */

'use strict';

/**
 * Known bot login patterns (case-insensitive).
 * Matches exact login names or the `[bot]` suffix convention.
 * @type {RegExp[]}
 */
const BOT_LOGIN_PATTERNS = [
  /\[bot\]$/i,
  /^(dependabot|renovate|greenkeeper|snyk-bot|imgbot|allcontributors|stale|codecov|sonarcloud|semgrep|cursor-bot|copilot|github-actions|mergify|netlify|vercel)$/i,
];

/**
 * Returns true if the account looks like a bot.
 *
 * @param {string}  login - GitHub login
 * @param {string} [type] - GitHub user `type` field ('User' | 'Bot' | …)
 * @returns {boolean}
 */
function isBot(login, type) {
  if (type === 'Bot') return true;
  if (!login) return false;
  return BOT_LOGIN_PATTERNS.some(p => p.test(login));
}

/**
 * Strip all non-prose content from a string, returning plain readable text.
 *
 * Removes (in order):
 *   - HTML tags
 *   - Fenced and inline code blocks
 *   - Markdown images, links (keeps display text), emphasis, headings, blockquotes
 *   - Bare URLs
 *   - HTML entities
 *   - Non-printable / control characters
 *
 * Result is trimmed and hard-truncated to 2 000 characters.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeToPlainText(text) {
  if (!text || typeof text !== 'string') return '';

  let s = text;

  // HTML tags
  s = s.replace(/<[^>]+>/g, ' ');

  // Fenced code blocks (``` … ```)
  s = s.replace(/```[\s\S]*?```/g, ' ');

  // Inline code (`…`)
  s = s.replace(/`[^`\n]+`/g, '');

  // Markdown images  ![alt](url)
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Markdown links [text](url) — keep display text
  s = s.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Bare URLs
  s = s.replace(/https?:\/\/\S+/g, '');

  // Markdown emphasis markers (* _ ~)
  s = s.replace(/(\*{1,3}|_{1,3}|~{2})/g, '');

  // Markdown heading markers
  s = s.replace(/^#{1,6}\s+/gm, '');

  // Blockquote markers
  s = s.replace(/^>\s?/gm, '');

  // HTML entities
  s = s.replace(/&[a-zA-Z0-9#]+;/g, ' ');

  // Non-printable / control characters (keep \n and \t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Collapse runs of spaces/tabs; cap consecutive newlines
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');

  s = s.trim();

  // Hard length cap
  if (s.length > 2000) s = s.slice(0, 2000);

  return s;
}

module.exports = { sanitizeToPlainText, isBot };
