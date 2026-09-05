# Higgsfield Watch

Your pet tracks your [Higgsfield AI](https://higgsfield.ai) generations — started
anywhere: the web app, the CLI, or MCP — and tells you how they're going:

- a new generation starts → *"Tracking 1 new Higgsfield generation, stay tuned!"*
- it finishes → *"Your Nano Banana Pro image is ready!"* + celebration
- it fails → a heads-up with an error reaction
- the pet-menu status always shows how many generations are in progress

## Setup

1. Install the [Higgsfield CLI](https://higgsfield.ai/cli) and log in:
   `npm i -g @higgsfield/cli && higgsfield auth login`
2. Print your access token: `higgsfield auth token`
3. Paste it into the plugin's **Higgsfield access token** setting.

When the token expires the status shows a warning — rerun `higgsfield auth token`
and paste the fresh one.

## How it works

Every poll (default 30s) the plugin fetches your recent jobs from
`fnf.higgsfield.ai` and diffs their statuses against stored state, so restarts
never re-announce old generations. The first poll seeds silently.

## Commands

- **Check Higgsfield Now** — poll immediately and have the pet report.
- **Reset Higgsfield Watch** — forget tracked state and re-seed.

## Limits

- The plugin sandbox only displays bundled images, so the pet cannot hold up
  the actual generated picture. For that, pair this with a local watcher using
  the `pet.showMedia` IPC method.
- The token is stored via the host's plugin secret storage and is only sent to
  `fnf.higgsfield.ai`.
