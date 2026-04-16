import fs from "node:fs";
import path from "node:path";

const DEFAULT_LIMIT = 5000;
const DEFAULT_TOGGLE_LIMIT = 1000;
const DEFAULT_RECOVERY_LIMIT = 1000;

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readStateFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStateFile(filePath, state) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function loadProcessedSourceKeys(filePath) {
  const parsed = readStateFile(filePath);
  return new Set(Array.isArray(parsed.processedSourceKeys) ? parsed.processedSourceKeys : []);
}

export function saveProcessedSourceKeys(filePath, sourceKeys, limit = DEFAULT_LIMIT) {
  const previousState = readStateFile(filePath);
  const processedSourceKeys = Array.from(sourceKeys).slice(-limit);
  writeStateFile(filePath, {
    ...previousState,
    processedSourceKeys,
  });
}

export function loadReplyToggleStates(filePath) {
  const parsed = readStateFile(filePath);
  const entries = Array.isArray(parsed.replyToggleStates) ? parsed.replyToggleStates : [];
  const replyToggleStates = new Map();

  for (const item of entries) {
    if (!item?.messageKey || typeof item.summaryText !== "string" || typeof item.detailText !== "string") {
      continue;
    }

    replyToggleStates.set(item.messageKey, {
      summaryText: item.summaryText,
      detailText: item.detailText,
      summaryBlocks: Array.isArray(item.summaryBlocks) ? item.summaryBlocks : [],
      detailBlocks: Array.isArray(item.detailBlocks) ? item.detailBlocks : [],
    });
  }

  return replyToggleStates;
}

export function saveReplyToggleStates(filePath, replyToggleStates, limit = DEFAULT_TOGGLE_LIMIT) {
  const previousState = readStateFile(filePath);
  const serialized = Array.from(replyToggleStates.entries())
    .slice(-limit)
    .map(([ messageKey, value ]) => ({
      messageKey,
      summaryText: value.summaryText,
      detailText: value.detailText,
      summaryBlocks: value.summaryBlocks,
      detailBlocks: value.detailBlocks,
    }));

  writeStateFile(filePath, {
    ...previousState,
    replyToggleStates: serialized,
  });
}

export function loadRecoveryQueue(filePath) {
  const parsed = readStateFile(filePath);
  const entries = Array.isArray(parsed.recoveryQueue) ? parsed.recoveryQueue : [];
  const recoveryQueue = new Map();

  for (const item of entries) {
    if (!item?.sourceKey || !item?.channel || !item?.sourceTs) {
      continue;
    }

    recoveryQueue.set(item.sourceKey, {
      sourceKey: item.sourceKey,
      channel: item.channel,
      sourceTs: item.sourceTs,
      threadTs: item.threadTs ?? item.sourceTs,
      replyTs: item.replyTs ?? null,
      status: item.status ?? "pending",
      updatedAt: item.updatedAt ?? null,
    });
  }

  return recoveryQueue;
}

export function saveRecoveryQueue(filePath, recoveryQueue, limit = DEFAULT_RECOVERY_LIMIT) {
  const previousState = readStateFile(filePath);
  const serialized = Array.from(recoveryQueue.values())
    .slice(-limit)
    .map((item) => ({
      sourceKey: item.sourceKey,
      channel: item.channel,
      sourceTs: item.sourceTs,
      threadTs: item.threadTs ?? item.sourceTs,
      replyTs: item.replyTs ?? null,
      status: item.status ?? "pending",
      updatedAt: item.updatedAt ?? null,
    }));

  writeStateFile(filePath, {
    ...previousState,
    recoveryQueue: serialized,
  });
}
