import { normalizeSlackMessage } from "./slack-message.mjs";

function parseSlackTimestamp(ts) {
  const parsed = Number.parseFloat(String(ts));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLookbackHours(lookbackHours) {
  const hours = Number.parseInt(String(lookbackHours), 10);
  return Number.isInteger(hours) && hours > 0 ? hours : undefined;
}

function parseReferenceTime(now = Date.now()) {
  const referenceTime = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(referenceTime) ? referenceTime : undefined;
}

export function resolveStartupBackfillLookbackHours(lookbackHours, now = Date.now(), options = {}) {
  const hours = parseLookbackHours(lookbackHours);
  const referenceTime = parseReferenceTime(now);

  if (!hours || referenceTime == null) {
    return undefined;
  }

  if (!options.includeWeekendOnMonday) {
    return hours;
  }

  const referenceDate = new Date(referenceTime);
  return referenceDate.getDay() === 1 ? Math.max(hours, 72) : hours;
}

export function buildStartupBackfillOldest(lookbackHours, now = Date.now(), options = {}) {
  const referenceTime = parseReferenceTime(now);
  const hours = resolveStartupBackfillLookbackHours(lookbackHours, now, options);

  if (referenceTime == null || hours == null) {
    return undefined;
  }

  const seconds = Math.max(0, Math.floor(referenceTime / 1000) - (hours * 60 * 60));
  return `${seconds}.000000`;
}

export function selectStartupBackfillMessages(messages = [], channel) {
  return messages
    .map((message) => normalizeSlackMessage(message, channel))
    .filter((message) => message.threadTs === message.ts)
    .sort((left, right) => parseSlackTimestamp(left.ts) - parseSlackTimestamp(right.ts));
}

export function selectMostRecentMessages(messages = [], limit = 10) {
  const maxItems = Number.parseInt(String(limit), 10);
  if (!Number.isInteger(maxItems) || maxItems <= 0) {
    return [];
  }

  return [ ...messages ]
    .sort((left, right) => parseSlackTimestamp(right.ts) - parseSlackTimestamp(left.ts))
    .slice(0, maxItems);
}
