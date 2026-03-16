/**
 * slack-api.js
 * Low-level Slack API wrapper with auth header injection, OAuth scope
 * diagnostics, and automatic single retry on HTTP 429 rate-limits.
 *
 * Usage:
 *   const { makeSlackApi } = require('./slack-api');
 *   const slackApi = makeSlackApi(slackToken, core);
 *   const result  = await slackApi('chat.postMessage', { body: { ... } });
 */

'use strict';

/**
 * Factory that returns a configured `slackApi(method, options)` function.
 *
 * @param {string} slackToken  - Slack bot OAuth token
 * @param {object} core        - @actions/core (for logging / warnings)
 * @returns {Function}
 */
function makeSlackApi(slackToken, core) {
  let _scopesLogged = false;

  /**
   * Call a Slack Web API method.
   *
   * @param {string} method          - e.g. 'chat.postMessage'
   * @param {{ params?: object, body?: object }} [options]
   *   params  - query-string parameters (GET-style methods)
   *   body    - JSON body (POST methods)
   * @returns {Promise<object>} Parsed Slack API response JSON
   */
  async function slackApi(method, options = {}) {
    const { params, body } = options;

    const url = new URL(`https://slack.com/api/${method}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const fetchOpts = {
      headers: { Authorization: `Bearer ${slackToken}` },
    };

    if (body) {
      fetchOpts.method = 'POST';
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(body);
    }

    let res = await fetch(url, fetchOpts);

    // Single retry on rate limit, honouring the Retry-After header
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
      core.warning(`Slack rate limited on ${method} — retrying after ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      res = await fetch(url, fetchOpts);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    // Log OAuth scopes on the first successful response to aid debugging
    if (!_scopesLogged) {
      const scopes = res.headers.get('x-oauth-scopes');
      core.info(`Bot OAuth scopes: ${scopes}`);
      if (scopes && !scopes.includes('reactions:write')) {
        core.warning(
          'reactions:write scope is MISSING — add it in Slack app settings and reinstall the app.'
        );
      }
      _scopesLogged = true;
    }

    return res.json();
  }

  return slackApi;
}

module.exports = { makeSlackApi };
