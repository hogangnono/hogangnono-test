# hgnn-incident-assistant

English | [한국어](README.ko.md)

## What It Is

A local Slack polling bot that watches Hogangnono incident channels, analyzes
AlertNow messages with repository context, and posts a structured reply back to
the thread.

## Why It Exists

This project tests whether a lightweight local assistant can shorten first
response time during incidents by collecting evidence from Slack, local repos,
and optional AWS or Loki context before drafting a first-pass analysis.

## Stack

- Node.js
- `@slack/web-api`
- local `codex` or `claude` CLI for analysis generation

## How To Run

1. Move into the project directory.
2. Install dependencies.
3. Copy `.env.example` to `.env`.
4. Fill the required environment variables.
5. Run the bot in `scan` or `loop` mode.

```bash
cd projects/hgnn-incident-assistant
npm install
cp .env.example .env
npm start
```

Useful variants:

```bash
# scan once and exit
npm run start:scan

# run continuously
npm run start:loop

# local dry run without posting to Slack
DRY_RUN=1 npm start

# validate formatting without real model calls
RUN_MODE=scan DRY_RUN=1 LLM_PROVIDER=mock npm start
```

## Environment Variables

Copy `.env.example` first:

```bash
cp .env.example .env
```

Required:

- `SLACK_BOT_TOKEN`
- `SLACK_ALERT_CHANNEL_IDS`

Recommended:

- `REPO_ROOTS`
  - Colon-separated repo roots used for local code evidence collection.
  - Example:
    `/absolute/path/to/hogangnono-api:/absolute/path/to/hogangnono-bot`

Optional:

- `RUN_MODE`
  - `scan` or `loop`. Default is `scan`.
- `LLM_PROVIDER`
  - `codex`, `claude`, or `mock`. Default is `codex`.
- `PREFER_CODEX_MCP`
  - `1` to prefer Codex MCP when available.
- `ALERT_SOURCE_NAME`
  - Expected incident bot display name. Default is `AlertNow`.
- `SLACK_DETAIL_AS_FILE`
  - `1` to attach detailed markdown output as a file.
- `DRY_RUN`
  - `1` to skip Slack writes and only print output locally.

Optional tuning:

- `MAX_CONTEXT_CHARS`
- `CONTEXT_TIMEOUT_MS`
- `LLM_TIMEOUT_MS`
- `AWS_TIMEOUT_MS`
- `STARTUP_BACKFILL`
- `STARTUP_BACKFILL_LOOKBACK_HOURS`
- `STARTUP_BACKFILL_MESSAGE_LIMIT`
- `POLL_LOOKBACK_HOURS`
- `POLL_MESSAGE_LIMIT`
- `MAX_MESSAGES_PER_SCAN`
- `MAX_ANALYSES_PER_RUN`
- `LOOP_INTERVAL_SECONDS`

Optional runtime paths:

- `STATE_FILE`
  - Default: `.data/state.json`
- `APP_LOG_FILE`
  - Default: `.data/runtime.log`

Legacy compatibility:

- `SLACK_ALERT_CHANNEL_ID`
  - Supported as a single-channel alias, but `SLACK_ALERT_CHANNEL_IDS` is the
    preferred setting.

## Current Status

active

## Next Steps

- tighten repository evidence selection for large monorepos
- evaluate better fallback behavior when AWS or Loki context is unavailable
- refine Slack reply formatting for long evidence chains

## What Happens During Analysis

The assistant follows this flow:

1. Fetch candidate messages from the configured Slack channels.
2. Decide whether the message looks like an actionable AlertNow incident.
3. Merge the root message, relevant thread replies, and referenced permalinks.
4. Parse request path, method, status, and error text.
5. Collect local repository evidence and optional AWS or Loki context.
6. Generate a draft analysis using `codex`, `claude`, or `mock`.
7. Post or update a thread reply with a summary and detailed evidence.

## Main Features

- combines AlertNow root messages with same-source thread replies
- follows Slack permalinks when the source message references another post
- supports manual re-analysis from the Slack thread
- avoids duplicate work when a person or the bot already replied
- supports `scan` and `loop` execution modes
- can recover unfinished pending replies on restart
- supports startup backfill for recently missed incidents
- supports `DRY_RUN=1` for local verification without Slack writes

## Slack App Requirements

Required scopes:

- `channels:history`
- `chat:write`

Optional scope:

- `files:write`
  - Needed only when `SLACK_DETAIL_AS_FILE=1`

The bot must be installed in the workspace and invited to the target channel.

## Local File Analysis

You can run the parser against a saved incident fixture or any text file:

```bash
node src/cli.mjs --file test/fixtures/alertnow-news.txt
```

Print the LLM prompt only:

```bash
node src/cli.mjs --file test/fixtures/alertnow-news.txt --print-prompt
```

Run without a real model:

```bash
LLM_PROVIDER=mock node src/cli.mjs --file test/fixtures/alertnow-news.txt
```

You can also pipe incident text from stdin:

```bash
cat test/fixtures/alertnow-news.txt | node src/cli.mjs
```
