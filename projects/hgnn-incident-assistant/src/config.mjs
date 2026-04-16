import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, ".data");

function parseBoolean(value, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }

  return [ "1", "true", "yes", "on" ].includes(String(value).trim().toLowerCase());
}

function parseList(value, fallback) {
  const raw = value ?? fallback;
  const separator = raw.includes(",") ? "," : path.delimiter;
  return raw
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseRunMode(value) {
  const normalized = String(value ?? "scan").trim().toLowerCase();
  if (normalized === "oneshot") {
    return "scan";
  }

  return [ "scan", "loop" ].includes(normalized) ? normalized : "scan";
}

export function loadConfig() {
  const repoRoots = parseList(
    process.env.REPO_ROOTS,
    "",
  );
  const slackAlertChannelIds = parseList(
    process.env.SLACK_ALERT_CHANNEL_IDS,
    process.env.SLACK_ALERT_CHANNEL_ID ?? "",
  );
  const maxMessagesPerScan = Math.min(
    parsePositiveInteger(process.env.MAX_MESSAGES_PER_SCAN, 10),
    50,
  );
  const maxAnalysesPerRun = parsePositiveInteger(process.env.MAX_ANALYSES_PER_RUN, maxMessagesPerScan);

  return {
    runMode: parseRunMode(process.env.RUN_MODE),
    slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
    slackAlertChannelId: slackAlertChannelIds[0] ?? "",
    slackAlertChannelIds,
    alertSourceName: process.env.ALERT_SOURCE_NAME ?? "AlertNow",
    llmProvider: (process.env.LLM_PROVIDER ?? "codex").toLowerCase(),
    preferCodexMcp: parseBoolean(process.env.PREFER_CODEX_MCP, true),
    slackDetailAsFile: parseBoolean(process.env.SLACK_DETAIL_AS_FILE, false),
    repoRoots,
    maxContextChars: Number.parseInt(process.env.MAX_CONTEXT_CHARS ?? "24000", 10),
    contextTimeoutMs: parsePositiveInteger(process.env.CONTEXT_TIMEOUT_MS, 60000),
    llmTimeoutMs: parsePositiveInteger(process.env.LLM_TIMEOUT_MS, 900000),
    awsTimeoutMs: parsePositiveInteger(process.env.AWS_TIMEOUT_MS, 10000),
    stateFile: process.env.STATE_FILE ?? path.join(DEFAULT_DATA_DIR, "state.json"),
    startupBackfillEnabled: parseBoolean(process.env.STARTUP_BACKFILL, false),
    startupBackfillLookbackHours: parsePositiveInteger(process.env.STARTUP_BACKFILL_LOOKBACK_HOURS, 72),
    startupBackfillMessageLimit: Math.min(
      parsePositiveInteger(process.env.STARTUP_BACKFILL_MESSAGE_LIMIT, 100),
      200,
    ),
    pollLookbackHours: parsePositiveInteger(process.env.POLL_LOOKBACK_HOURS, 24),
    pollMessageLimit: Math.min(
      parsePositiveInteger(process.env.POLL_MESSAGE_LIMIT, 100),
      200,
    ),
    maxMessagesPerScan,
    maxAnalysesPerRun,
    loopIntervalSeconds: parsePositiveInteger(process.env.LOOP_INTERVAL_SECONDS, 60),
    logFilePath: process.env.APP_LOG_FILE ?? path.join(DEFAULT_DATA_DIR, "runtime.log"),
    dryRun: parseBoolean(process.env.DRY_RUN, false),
  };
}

export function validateSlackConfig(config) {
  const missing = [];

  if (!config.slackBotToken) {
    missing.push("SLACK_BOT_TOKEN");
  }

  if (!Array.isArray(config.slackAlertChannelIds) || config.slackAlertChannelIds.length === 0) {
    missing.push("SLACK_ALERT_CHANNEL_IDS");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
