# test-pr-ready-notify

Test repo for the `@pr-ready` Slack notification workflow.

## What it does

When someone comments `@pr-ready` on a pull request, a GitHub Actions workflow:

1. Checks if the PR is still in draft (warns if so)
2. Sends a Slack notification to `#platform-pr-notify` with a link to the PR
3. Marks the PR so duplicate notifications aren't sent

## Why a separate repo?

GitHub-hosted runners (required for `ubuntu-latest`) aren't available on private repos under the free plan. This public repo allows the workflow to run without self-hosted runner infrastructure.

## Setup

Add a `SLACK_WEBHOOK_URL` repository secret pointing to the Slack incoming webhook for the `#platform-pr-notify` channel.

## Testing

1. Open a pull request against `master`
2. Comment `@pr-ready` on the PR
3. Check the Actions tab to verify the workflow ran
4. Confirm the Slack message appeared in `#platform-pr-notify`
