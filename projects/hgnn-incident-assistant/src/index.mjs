import fs from "node:fs";
import path from "node:path";
import { WebClient } from "@slack/web-api";
import { analyzeIncidentText } from "./analyze-incident.mjs";
import { loadConfig, validateSlackConfig } from "./config.mjs";
import { isAlertNotificationWithoutDetails, isLikelyAlertIncident, parseIncidentMessage } from "./incident-parser.mjs";
import { loadDotEnv } from "./load-env.mjs";
import {
  buildConversationText,
  buildMessageText,
  normalizeSlackMessage,
  selectSourceThreadMessages,
} from "./slack-message.mjs";
import {
  buildStartupBackfillOldest,
  resolveStartupBackfillLookbackHours,
  selectMostRecentMessages,
  selectStartupBackfillMessages,
} from "./startup-backfill.mjs";
import {
  loadProcessedSourceKeys,
  loadRecoveryQueue,
  saveProcessedSourceKeys,
  saveRecoveryQueue,
} from "./state-store.mjs";
import { decideThreadReplyHandling } from "./thread-reply-policy.mjs";
import { parseManualAnalyzeRequest } from "./manual-request.mjs";

loadDotEnv();
const config = loadConfig();
validateSlackConfig(config);

const processedMessages = new Set();
const processedSources = loadProcessedSourceKeys(config.stateFile);
const recoveryQueue = loadRecoveryQueue(config.stateFile);
const processingSources = new Set();
const threadPermalinkCache = new Map();
const ASSISTANT_BOT_NAME = "hgnn-incident-assistant";
const WAITING_REPLY_PREFIX = "*자동 분석 대기*";
const PENDING_REPLY_PREFIX = "*분석 시작*";
const FAILURE_REPLY_PREFIX = "*장애 분석 실패*";
const assistantIdentity = {
  botUserId: null,
  initialized: false,
};

function appendLogLine(line) {
  if (!config.logFilePath) {
    return;
  }

  fs.mkdirSync(path.dirname(config.logFilePath), { recursive: true });
  fs.appendFileSync(config.logFilePath, `${line}\n`, "utf8");
}

function summarizeTextForLog(text, maxLength = 80) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function buildIncidentLabel(payload = {}) {
  const parts = [];

  if (payload.incidentId) {
    parts.push(`#${payload.incidentId}`);
  }

  if (payload.requestPath) {
    parts.push(payload.requestPath);
  } else if (payload.incidentSlug) {
    parts.push(payload.incidentSlug);
  }

  return parts.join(" ");
}

function formatStageLabel(stage) {
  const stageLabels = {
    "pending-reply-ready": "임시 댓글 준비 완료",
    "analysis-start": "분석 시작",
    "prepare-start": "사전 준비 시작",
    "incident-parsed": "인시던트 파싱 완료",
    "context-collect-start": "문맥 수집 시작",
    "context-aws-start": "AWS 문맥 수집 시작",
    "context-aws-finish": "AWS 문맥 수집 완료",
    "context-loki-start": "Loki 문맥 수집 시작",
    "context-loki-finish": "Loki 문맥 수집 완료",
    "context-repo-start": "레포 문맥 수집 시작",
    "context-repo-finish": "레포 문맥 수집 완료",
    "context-collect-timeout": "문맥 수집 timeout",
    "context-collect-finish": "문맥 수집 완료",
    "prepare-finish": "사전 준비 완료",
    "llm-start": "Codex/Claude 분석 시작",
    "llm-finish": "Codex/Claude 분석 완료",
    "format-finish": "Slack 메시지 포맷 완료",
    "summary-reply-updated": "요약 댓글 업데이트 완료",
    "toggle-state-saved": "토글 상태 저장 완료",
    "analysis-error": "분석 실패",
  };

  return stageLabels[stage] ?? stage;
}

function formatLogMessage(reason, payload = {}) {
  const incidentLabel = buildIncidentLabel(payload);

  switch (reason) {
    case "queue-start":
      return `작업 큐 시작: ${payload.taskName}`;
    case "queue-finish":
      return `작업 큐 종료: ${payload.taskName}`;
    case "candidate-message":
      return `후보 메시지 감지${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "manual-request-target-missing":
      return "수동 분석 대상 인시던트를 찾지 못함";
    case "manual-request-existing-analysis":
      return "이미 분석된 스레드라 수동 요청을 종료함";
    case "skip-processed-manual-request":
      return "이미 처리한 수동 분석 요청이라 건너뜀";
    case "actionable-direct":
      return `바로 분석 가능한 인시던트 확인${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "actionable-via-thread":
      return `스레드 루트 기준 인시던트 확인${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "actionable-via-permalink":
      return `permalink 기준 인시던트 확인${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "actionable-direct-waiting-details":
    case "actionable-via-thread-waiting-details":
    case "actionable-via-permalink-waiting-details":
      return `상세 정보 대기 중${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "skip-existing-thread-replies":
      return "기존 답글이 있어 건너뜀";
    case "skip-processed-source":
      return "이미 처리한 source라 건너뜀";
    case "skip-processing-source":
      return "현재 처리 중인 source라 건너뜀";
    case "analyze-start":
      return `인시던트 분석 시작${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "analyze-success":
      return `인시던트 분석 완료${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "analyze-error":
      return `인시던트 분석 실패${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "analysis-progress":
      return `분석 진행: ${formatStageLabel(payload.stage)}${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "analysis-still-running":
      return `분석 진행 중: ${formatStageLabel(payload.stage)}${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "reply-post-start":
      return "Slack 댓글 등록 시작";
    case "reply-post-success":
      return "Slack 댓글 등록 완료";
    case "reply-update-start":
      return "Slack 댓글 업데이트 시작";
    case "reply-update-success":
      return "Slack 댓글 업데이트 완료";
    case "detail-file-upload-start":
      return "상세 분석 파일 업로드 시작";
    case "detail-file-upload-success":
      return "상세 분석 파일 업로드 완료";
    case "detail-file-upload-error":
      return "상세 분석 파일 업로드 실패";
    case "startup-pending-recovery-channel":
      return `미완료 댓글 복구 스캔 시작: ${payload.channel} ${payload.fetchedCount}건`;
    case "startup-pending-recovery-progress":
      return `미완료 댓글 복구 스캔 중: ${payload.channel} ${payload.scannedCount}/${payload.totalCount}`;
    case "startup-pending-recovery-start":
      return `미완료 댓글 재시도 시작${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "startup-pending-recovery-success":
      return `미완료 댓글 재시도 완료${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "startup-pending-recovery-error":
      return `미완료 댓글 재시도 실패${incidentLabel ? ` (${incidentLabel})` : ""}`;
    case "startup-pending-recovery-limit-reached":
      return `미완료 댓글 재시도 한도 도달: ${payload.recoveredCount}/${payload.maxItems}`;
    case "startup-pending-recovery-no-work":
      return "복구할 미완료 댓글 없음";
    case "startup-backfill-limit-reached":
      return `startup backfill 한도 도달: ${payload.handledCount}/${payload.maxItems}`;
    case "scan-pending-recovery-start":
      return "단발 스캔 전 미완료 댓글 복구 시작";
    case "scan-pending-recovery-finish":
      return "단발 스캔 전 미완료 댓글 복구 종료";
    case "scan-mode-start":
      return "단발 스캔 모드 시작";
    case "loop-mode-start":
      return "주기 스캔 모드 시작";
    case "scan-channel":
      return `단발 스캔 시작: ${payload.channel} ${payload.fetchedCount}건`;
    case "scan-progress":
      return `단발 스캔 중: ${payload.channel} ${payload.scannedCount}/${payload.totalCount}`;
    case "scan-analysis-budget-reached":
      return `단발 스캔 한도 도달: ${payload.handledCount}/${payload.maxItems}`;
    case "scan-no-work":
      return `단발 스캔에서 처리할 항목 없음: ${payload.channel}`;
    case "scan-channel-error":
      return `단발 스캔 채널 처리 실패: ${payload.channel}`;
    case "scan-finish":
      return `단발 스캔 종료: 처리 ${payload.handledCount ?? 0}건`;
    case "loop-iteration-start":
      return `주기 스캔 시작: ${payload.iteration}회차`;
    case "loop-iteration-finish":
      return `주기 스캔 종료: ${payload.iteration}회차 처리 ${payload.handledCount ?? 0}건`;
    case "loop-iteration-error":
      return `주기 스캔 실패: ${payload.iteration}회차`;
    case "loop-sleep":
      return `다음 스캔까지 대기: ${payload.sleepSeconds}s`;
    default:
      return null;
  }
}

function debugLog(reason, payload = {}) {
  const message = formatLogMessage(reason, payload);
  const details = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([ key, value ]) => {
      if (typeof value === "string") {
        return `${key}=${JSON.stringify(summarizeTextForLog(value, key === "preview" ? 100 : 140))}`;
      }

      return `${key}=${JSON.stringify(value)}`;
    })
    .join(" ");

  const line = `[incident-assistant] ${new Date().toISOString()} pid=${process.pid} event=${reason}${message ? ` message=${JSON.stringify(message)}` : ""}${details ? ` ${details}` : ""}`;
  console.log(line);
  appendLogLine(line);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getEffectiveStartupBackfillLookbackHours(now = Date.now()) {
  return resolveStartupBackfillLookbackHours(config.startupBackfillLookbackHours, now, {
    includeWeekendOnMonday: true,
  }) ?? config.startupBackfillLookbackHours;
}

function isAlertSourceThreadReply(message) {
  return message.threadTs !== message.ts
    && Boolean(message.botProfileName)
    && (!config.alertSourceName || message.botProfileName === config.alertSourceName);
}

function shouldHandleChannel(message, manualRequest = null) {
  if (!message.text) {
    debugLog("skip-empty-text", { channel: message.channel, ts: message.ts });
    return false;
  }

  if (!config.slackAlertChannelIds.includes(message.channel)) {
    debugLog("skip-channel", { channel: message.channel, ts: message.ts });
    return false;
  }

  if (message.threadTs !== message.ts && !isAlertSourceThreadReply(message) && !manualRequest) {
    debugLog("skip-thread-reply", { channel: message.channel, ts: message.ts, threadTs: message.threadTs });
    return false;
  }

  if (processedMessages.has(`${message.channel}:${message.ts}`)) {
    debugLog("skip-processed-message", { channel: message.channel, ts: message.ts });
    return false;
  }

  if (!manualRequest && config.alertSourceName && message.botProfileName && message.botProfileName !== config.alertSourceName) {
    debugLog("skip-source-name", {
      channel: message.channel,
      ts: message.ts,
      expected: config.alertSourceName,
      actual: message.botProfileName,
    });
    return false;
  }

  debugLog("candidate-message", {
    channel: message.channel,
    ts: message.ts,
    source: manualRequest ? `manual:${manualRequest.command}` : message.botProfileName,
    preview: message.text.slice(0, 140),
  });
  return true;
}

function buildManualTargetMissingReply() {
  return [
    "*수동 분석 안내*",
    "같은 스레드의 AlertNow 인시던트나 Slack permalink를 찾지 못했습니다.",
    `인시던트 스레드에 \`@${ASSISTANT_BOT_NAME} 분석\` 또는 \`@${ASSISTANT_BOT_NAME} 다시분석\` 형태로 남겨 주세요.`,
  ].join("\n");
}

function buildManualAlreadyAnalyzedReply() {
  return [
    "*수동 분석 안내*",
    "이 스레드에는 이미 분석 댓글이 있습니다.",
    `새로 실행하려면 \`@${ASSISTANT_BOT_NAME} 다시분석\`으로 요청해 주세요.`,
  ].join("\n");
}

function saveProcessedSourceKey(sourceKey) {
  if (!sourceKey) {
    return;
  }

  processedSources.add(sourceKey);
  saveProcessedSourceKeys(config.stateFile, processedSources);
}

async function ensureAssistantIdentity(client) {
  if (assistantIdentity.initialized) {
    return assistantIdentity;
  }

  try {
    const response = await client.auth.test();
    assistantIdentity.botUserId = response?.user_id ?? null;
  } catch {
    assistantIdentity.botUserId = null;
  }

  assistantIdentity.initialized = true;
  return assistantIdentity;
}

function extractSlackPermalinkTarget(text) {
  const match = text.match(/https:\/\/[^/]+\/archives\/([A-Z0-9]+)\/p(\d{16})/);
  if (!match) {
    return null;
  }

  const rawTs = match[2];
  return {
    channel: match[1],
    ts: `${rawTs.slice(0, 10)}.${rawTs.slice(10)}`,
  };
}

function buildWaitingReply(messageText) {
  const parsed = parseIncidentMessage(messageText);
  const headline = [ parsed.incidentId ? `#${parsed.incidentId}` : null, parsed.incidentSlug ].filter(Boolean).join(" ");

  return [
    `${WAITING_REPLY_PREFIX}${headline ? ` ${headline}` : ""}`,
    "현재 알림 본문에 request, status, stack 상세가 없어 자동 분석을 바로 진행할 수 없습니다.",
    "상세 스택이 포함된 후속 알림, AlertNow 스레드 reply, 원본 장애 메시지 링크가 오면 다시 분석합니다.",
  ].join("\n");
}

function buildPendingReply(messageText) {
  const parsed = parseIncidentMessage(messageText);
  const headline = [ parsed.incidentSlug, parsed.incidentId ? `#${parsed.incidentId}` : null ]
    .filter(Boolean)
    .join(" ");

  return [
    `*분석 시작*${headline ? ` ${headline}` : ""}`,
    "근거 수집과 분석 초안 생성을 진행 중입니다.",
    "완료되면 이 메시지가 자동으로 요약 카드로 바뀝니다.",
  ].join("\n");
}

function buildFollowUpMessage(kind) {
  if (kind === "db") {
    return [
      "*추가 확인: DB 관점*",
      "• slow query log / APM에서 동일 시각 SQL fingerprint를 확인합니다.",
      "• 실행 계획에서 정렬, range scan, join cardinality가 급증했는지 봅니다.",
      "• connection pool 사용량, replica lag, failover 이벤트를 함께 확인합니다.",
    ].join("\n");
  }

  if (kind === "cache") {
    return [
      "*추가 확인: 캐시/Redis 관점*",
      "• Redis CPU, latency, blocked clients, network throughput을 확인합니다.",
      "• `HSCAN`, `SCAN`, 대형 key cardinality 증가 여부를 확인합니다.",
      "• 특정 prefix 또는 hot key로 인한 편중이 있는지 봅니다.",
    ].join("\n");
  }

  return [
    "*추가 확인: 외부 API 관점*",
    "• 의존 서비스 상태 페이지나 내부 장애 공지를 확인합니다.",
    "• timeout, retry, circuit breaker 설정이 현재 장애 패턴과 맞는지 점검합니다.",
    "• 동일 시각 upstream/downstream error rate와 latency를 같이 비교합니다.",
  ].join("\n");
}

async function getThreadPermalink(client, channel, messageTs) {
  if (!channel || !messageTs || config.dryRun) {
    return null;
  }

  const cacheKey = `${channel}:${messageTs}`;
  if (threadPermalinkCache.has(cacheKey)) {
    return threadPermalinkCache.get(cacheKey);
  }

  try {
    const response = await client.chat.getPermalink({
      channel,
      message_ts: messageTs,
    });
    const permalink = response?.permalink ?? null;
    threadPermalinkCache.set(cacheKey, permalink);
    return permalink;
  } catch {
    return null;
  }
}

function upsertRecoveryTarget(entry) {
  if (!entry?.sourceKey || !entry?.channel || !entry?.sourceTs) {
    return;
  }

  recoveryQueue.set(entry.sourceKey, {
    sourceKey: entry.sourceKey,
    channel: entry.channel,
    sourceTs: entry.sourceTs,
    threadTs: entry.threadTs ?? entry.sourceTs,
    replyTs: entry.replyTs ?? null,
    status: entry.status ?? "pending",
    updatedAt: new Date().toISOString(),
  });
  saveRecoveryQueue(config.stateFile, recoveryQueue);
}

function removeRecoveryTarget(sourceKey) {
  if (!sourceKey) {
    return;
  }

  if (recoveryQueue.delete(sourceKey)) {
    saveRecoveryQueue(config.stateFile, recoveryQueue);
  }
}

function isWaitingReply(text = "") {
  return text.startsWith(WAITING_REPLY_PREFIX);
}

function isPendingReply(text = "") {
  return text.startsWith(PENDING_REPLY_PREFIX);
}

function isFailureReply(text = "") {
  return text.startsWith(FAILURE_REPLY_PREFIX);
}

async function fetchThreadMessages(client, channel, rootTs) {
  const response = await client.conversations.replies({
    channel,
    ts: rootTs,
    limit: 20,
    inclusive: true,
  });

  return (response.messages ?? []).map((item) => normalizeSlackMessage(item, channel));
}

async function enrichMessageWithThreadContext(client, message) {
  const rootTs = message.threadTs ?? message.ts;
  const threadMessages = await fetchThreadMessages(client, message.channel, rootTs);
  const rootMessage = threadMessages[0] ?? {
    ...message,
    threadTs: rootTs,
  };
  const sourceMessages = selectSourceThreadMessages(threadMessages, rootMessage, config.alertSourceName);
  const combinedText = buildConversationText(sourceMessages);

  return {
    ...rootMessage,
    threadTs: rootTs,
    text: combinedText || rootMessage.text,
    sourceReplyCount: Math.max(0, sourceMessages.length - 1),
  };
}

async function resolveActionableCandidate(client, message, logReason) {
  const enrichedMessage = await enrichMessageWithThreadContext(client, message);

  if (isLikelyAlertIncident(enrichedMessage.text)) {
    debugLog(logReason, {
      channel: message.channel,
      ts: message.ts,
      sourceTs: enrichedMessage.ts,
      sourceReplyCount: enrichedMessage.sourceReplyCount ?? 0,
      preview: enrichedMessage.text.slice(0, 160),
    });
    return enrichedMessage;
  }

  if (isAlertNotificationWithoutDetails(enrichedMessage.text)) {
    debugLog(`${logReason}-waiting-details`, {
      channel: message.channel,
      ts: message.ts,
      sourceTs: enrichedMessage.ts,
      sourceReplyCount: enrichedMessage.sourceReplyCount ?? 0,
      preview: enrichedMessage.text.slice(0, 160),
    });
    return {
      ...enrichedMessage,
      pendingReason: "missing_details",
    };
  }

  return null;
}

async function resolveActionableMessage(client, message, options = {}) {
  const { allowThreadRoot = true } = options;

  if (allowThreadRoot && message.threadTs !== message.ts) {
    debugLog("follow-thread-root", {
      channel: message.channel,
      ts: message.ts,
      threadTs: message.threadTs,
      source: message.botProfileName,
    });

    const rootMessage = await fetchMessageByTs(client, message.channel, message.threadTs);
    const threaded = rootMessage
      ? await resolveActionableMessage(client, rootMessage, { allowThreadRoot: false })
      : null;

    if (threaded) {
      return threaded;
    }
  }

  if (isLikelyAlertIncident(message.text) || isAlertNotificationWithoutDetails(message.text)) {
    const direct = await resolveActionableCandidate(client, message, "actionable-direct");
    if (direct) {
      return direct;
    }
  }

  const target = extractSlackPermalinkTarget(message.text);
  if (!target) {
    debugLog("skip-no-actionable-details", {
      channel: message.channel,
      ts: message.ts,
      preview: message.text.slice(0, 160),
    });
    return null;
  }

  debugLog("follow-permalink", {
    channel: message.channel,
    ts: message.ts,
    targetChannel: target.channel,
    targetTs: target.ts,
  });

  const response = await client.conversations.history({
    channel: target.channel,
    latest: target.ts,
    inclusive: true,
    limit: 1,
  });

  const linkedMessage = response.messages?.[0];
  if (!linkedMessage) {
    debugLog("skip-permalink-target-missing", {
      channel: message.channel,
      ts: message.ts,
      targetChannel: target.channel,
      targetTs: target.ts,
    });
    return null;
  }

  const normalized = normalizeSlackMessage(linkedMessage, target.channel);
  if (isLikelyAlertIncident(normalized.text) || isAlertNotificationWithoutDetails(normalized.text)) {
    const linked = await resolveActionableCandidate(client, normalized, "actionable-via-permalink");
    if (linked) {
      return linked;
    }
  }

  debugLog("skip-linked-message-not-actionable", {
    channel: message.channel,
    ts: message.ts,
    targetChannel: normalized.channel,
    targetTs: normalized.ts,
    preview: normalized.text.slice(0, 160),
  });
  return null;
}

async function getThreadReplyState(client, actionableMessage) {
  const response = await client.conversations.replies({
    channel: actionableMessage.channel,
    ts: actionableMessage.ts,
    limit: 10,
    inclusive: true,
  });

  const replies = (response.messages ?? []).filter((reply) => reply.ts !== actionableMessage.ts);
  const assistantReplies = replies.filter((reply) => {
    const botProfileName = reply.bot_profile?.name ?? reply.username ?? null;
    return botProfileName === "hgnn-incident-assistant";
  });
  const hasAssistantFinalReply = replies.some((reply) => {
    const botProfileName = reply.bot_profile?.name ?? reply.username ?? null;
    const text = buildMessageText(reply);
    return botProfileName === "hgnn-incident-assistant"
      && !isWaitingReply(text)
      && !isPendingReply(text)
      && !isFailureReply(text);
  });
  const hasAssistantWaitingReply = replies.some((reply) => {
    const botProfileName = reply.bot_profile?.name ?? reply.username ?? null;
    return botProfileName === "hgnn-incident-assistant" && isWaitingReply(buildMessageText(reply));
  });
  const hasAssistantFailureReply = replies.some((reply) => {
    const botProfileName = reply.bot_profile?.name ?? reply.username ?? null;
    return botProfileName === "hgnn-incident-assistant" && isFailureReply(buildMessageText(reply));
  });
  const reusableAssistantReply = [ ...assistantReplies ]
    .reverse()
    .find((reply) => {
      const text = buildMessageText(reply);
      return isWaitingReply(text) || isPendingReply(text) || isFailureReply(text);
    });

  const hasHumanReply = replies.some((reply) => !reply.bot_id && !!reply.user);

  return {
    replyCount: replies.length,
    hasAssistantFinalReply,
    hasAssistantWaitingReply,
    hasAssistantFailureReply,
    reusableAssistantReplyTs: reusableAssistantReply?.ts ?? null,
    hasHumanReply,
  };
}

async function shouldSkipBecauseThreadAlreadyHasReplies(client, actionableMessage, options = {}) {
  const { allowReusableAssistantReply = false } = options;
  const replyState = await getThreadReplyState(client, actionableMessage);
  const decision = decideThreadReplyHandling(replyState, actionableMessage, {
    allowReusableAssistantReply,
  });

  if (decision.shouldSkip) {
    debugLog("skip-existing-thread-replies", {
      channel: actionableMessage.channel,
      ts: actionableMessage.ts,
      hasAssistantFinalReply: replyState.hasAssistantFinalReply,
      hasAssistantWaitingReply: replyState.hasAssistantWaitingReply,
      hasAssistantFailureReply: replyState.hasAssistantFailureReply,
      hasHumanReply: replyState.hasHumanReply,
      replyCount: replyState.replyCount,
      allowReusableAssistantReply,
      pendingReason: actionableMessage.pendingReason ?? null,
    });
  }

  return decision;
}

function buildReplyBlocks(replyMessages) {
  return replyMessages.detailBlocks;
}

async function postReply(client, channel, threadTs, text, options = {}) {
  const { replyType = "reply", blocks } = options;
  debugLog("reply-post-start", {
    channel,
    threadTs,
    replyType,
    preview: summarizeTextForLog(text),
  });

  if (config.dryRun) {
    console.log(`\n[DRY RUN] ${channel} ${threadTs}\n${text}\n`);
    if (blocks?.length) {
      console.log(`[DRY RUN BLOCKS]\n${JSON.stringify(blocks, null, 2)}\n`);
    }
    debugLog("reply-post-dry-run", {
      channel,
      threadTs,
      replyType,
    });
    return {
      ok: true,
      channel,
      ts: threadTs,
    };
  }

  const response = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    ...(blocks?.length ? { blocks } : {}),
  });

  debugLog("reply-post-success", {
    channel,
    threadTs,
    replyType,
  });

  return response;
}

async function updateReply(client, channel, messageTs, text, options = {}) {
  const { blocks } = options;

  debugLog("reply-update-start", {
    channel,
    messageTs,
    preview: summarizeTextForLog(text),
  });

  if (config.dryRun) {
    console.log(`\n[DRY RUN UPDATE] ${channel} ${messageTs}\n${text}\n`);
    if (blocks?.length) {
      console.log(`[DRY RUN UPDATE BLOCKS]\n${JSON.stringify(blocks, null, 2)}\n`);
    }
    return {
      ok: true,
      channel,
      ts: messageTs,
    };
  }

  const response = await client.chat.update({
    channel,
    ts: messageTs,
    text,
    ...(blocks?.length ? { blocks } : {}),
  });

  debugLog("reply-update-success", {
    channel,
    messageTs,
  });

  return response;
}

async function uploadDetailFile(client, channel, threadTs, replyMessages, progressContext = {}) {
  if (!config.slackDetailAsFile) {
    return;
  }

  const detailFile = replyMessages?.detailFile;
  if (!detailFile?.content) {
    return;
  }

  debugLog("detail-file-upload-start", {
    channel,
    threadTs,
    ...progressContext,
    filename: detailFile.filename,
  });

  if (config.dryRun) {
    console.log(`[DRY RUN FILE]\n${detailFile.filename}\n${detailFile.content}\n`);
    debugLog("detail-file-upload-dry-run", {
      channel,
      threadTs,
      ...progressContext,
      filename: detailFile.filename,
    });
    return;
  }

  await client.files.uploadV2({
    channel_id: channel,
    thread_ts: threadTs,
    filename: detailFile.filename,
    title: detailFile.title,
    content: detailFile.content,
    initial_comment: detailFile.initialComment,
  });

  debugLog("detail-file-upload-success", {
    channel,
    threadTs,
    ...progressContext,
    filename: detailFile.filename,
  });
}

async function handleIncidentMessage(client, messageText, channel, threadTs, options = {}) {
  const reusableReplyTs = options.reusableReplyTs ?? null;
  const parsedIncident = parseIncidentMessage(messageText);
  const progressContext = {
    incidentId: parsedIncident.incidentId ?? null,
    incidentSlug: parsedIncident.incidentSlug ?? null,
    requestPath: parsedIncident.request?.path ?? null,
    ...options.progressContext,
  };
  const analysisStartedAt = Date.now();
  let currentStage = "pending-reply";
  const logAnalysisProgress = (stage, payload = {}) => {
    if (payload.incidentId || payload.incidentSlug || payload.requestPath) {
      Object.assign(progressContext, {
        incidentId: payload.incidentId ?? progressContext.incidentId,
        incidentSlug: payload.incidentSlug ?? progressContext.incidentSlug,
        requestPath: payload.requestPath ?? progressContext.requestPath,
      });
    }
    currentStage = stage;
    debugLog("analysis-progress", {
      ...progressContext,
      stage,
      elapsedMs: Date.now() - analysisStartedAt,
      ...payload,
    });
  };
  const heartbeat = setInterval(() => {
    debugLog("analysis-still-running", {
      ...progressContext,
      stage: currentStage,
      elapsedMs: Date.now() - analysisStartedAt,
    });
  }, 10000);
  heartbeat.unref?.();

  const pendingResponse = reusableReplyTs
    ? await updateReply(client, channel, reusableReplyTs, buildPendingReply(messageText))
    : await postReply(client, channel, threadTs, buildPendingReply(messageText), {
      replyType: "pending",
    });
  upsertRecoveryTarget({
    sourceKey: progressContext.sourceKey,
    channel,
    sourceTs: progressContext.sourceTs ?? threadTs,
    threadTs,
    replyTs: pendingResponse?.ts ?? reusableReplyTs ?? null,
    status: "pending",
  });
  logAnalysisProgress("pending-reply-ready", {
    replyTs: pendingResponse?.ts ?? null,
    reusedReply: Boolean(reusableReplyTs),
  });

  try {
    const result = await analyzeIncidentText(messageText, config, {
      onProgress: logAnalysisProgress,
    });
    debugLog("reply-sequence-start", {
      channel,
      threadTs,
      hasExpandableDetail: Boolean(result.replyMessages.detailText),
    });
    await updateReply(client, channel, pendingResponse?.ts, result.replyMessages.detailText, {
      blocks: buildReplyBlocks(result.replyMessages),
    });
    logAnalysisProgress("summary-reply-updated", {
      replyTs: pendingResponse?.ts ?? null,
    });
    try {
      await uploadDetailFile(client, channel, threadTs, result.replyMessages, progressContext);
    } catch (fileError) {
      debugLog("detail-file-upload-error", {
        channel,
        threadTs,
        ...progressContext,
        error: fileError.message,
      });
    }
    removeRecoveryTarget(progressContext.sourceKey);
  } catch (error) {
    await updateReply(client, channel, pendingResponse?.ts, `*장애 분석 실패*\n\`${error.message}\``);
    upsertRecoveryTarget({
      sourceKey: progressContext.sourceKey,
      channel,
      sourceTs: progressContext.sourceTs ?? threadTs,
      threadTs,
      replyTs: pendingResponse?.ts ?? reusableReplyTs ?? null,
      status: "failed",
    });
    logAnalysisProgress("analysis-error", {
      replyTs: pendingResponse?.ts ?? null,
      error: error.message,
    });
    error.alreadyReported = true;
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

function logError(logger, error) {
  if (typeof logger?.error === "function") {
    logger.error(error);
    return;
  }

  console.error(error);
}

async function processIncomingMessage(client, logger, message, options = {}) {
  const {
    skipPendingReplies = false,
    source = "event",
    requireEmptyThreadReplies = false,
  } = options;
  const isHumanManualCandidate = Boolean(message.user) && !message.botId && !message.botProfileName;
  const manualRequest = isHumanManualCandidate ? parseManualAnalyzeRequest(message.text, {
    assistantUserId: assistantIdentity.botUserId,
    assistantBotName: ASSISTANT_BOT_NAME,
  }) : null;
  const manualRequestKey = manualRequest ? `manual:${message.channel}:${message.ts}` : null;
  const effectiveSource = manualRequest
    ? (manualRequest.force ? "manual-reanalyze" : "manual-mention")
    : source;

  if (!shouldHandleChannel(message, manualRequest)) {
    return false;
  }

  if (manualRequestKey && processedSources.has(manualRequestKey)) {
    debugLog("skip-processed-manual-request", {
      channel: message.channel,
      ts: message.ts,
      sourceKey: manualRequestKey,
      source: effectiveSource,
    });
    return false;
  }

  const actionableMessage = await resolveActionableMessage(client, message);
  if (!actionableMessage) {
    if (manualRequest) {
      await postReply(client, message.channel, message.threadTs ?? message.ts, buildManualTargetMissingReply(), {
        replyType: "manual",
      });
      saveProcessedSourceKey(manualRequestKey);
      debugLog("manual-request-target-missing", {
        channel: message.channel,
        ts: message.ts,
        sourceKey: manualRequestKey,
        source: effectiveSource,
      });
      return true;
    }

    return false;
  }

  if (skipPendingReplies && actionableMessage.pendingReason) {
    debugLog("startup-backfill-skip-pending", {
      channel: message.channel,
      ts: message.ts,
      sourceKey: `${actionableMessage.channel}:${actionableMessage.ts}`,
    });
    return false;
  }

  const sourceKey = `${actionableMessage.channel}:${actionableMessage.ts}`;
  if (!manualRequest && !actionableMessage.pendingReason && processedSources.has(sourceKey)) {
    debugLog("skip-processed-source", {
      channel: message.channel,
      ts: message.ts,
      sourceKey,
      source: effectiveSource,
    });
    return false;
  }

  if (processingSources.has(sourceKey)) {
    debugLog("skip-processing-source", {
      channel: message.channel,
      ts: message.ts,
      sourceKey,
      source: effectiveSource,
    });
    return false;
  }

  processingSources.add(sourceKey);

  try {
    let replyDecision;
    if (manualRequest) {
      const replyState = await getThreadReplyState(client, actionableMessage);

      if (!manualRequest.force && replyState.hasAssistantFinalReply) {
        await postReply(client, message.channel, message.threadTs ?? message.ts, buildManualAlreadyAnalyzedReply(), {
          replyType: "manual",
        });
        saveProcessedSourceKey(manualRequestKey);
        debugLog("manual-request-existing-analysis", {
          channel: message.channel,
          ts: message.ts,
          sourceKey,
          source: effectiveSource,
        });
        return true;
      }

      replyDecision = {
        shouldSkip: false,
        reusableAssistantReplyTs: replyState.reusableAssistantReplyTs ?? null,
      };
    } else {
      replyDecision = await shouldSkipBecauseThreadAlreadyHasReplies(client, actionableMessage, {
        allowReusableAssistantReply: !requireEmptyThreadReplies,
      });
    }

    if (replyDecision.shouldSkip) {
      return false;
    }
    const threadLink = await getThreadPermalink(client, actionableMessage.channel, actionableMessage.ts);

    processedMessages.add(`${message.channel}:${message.ts}`);
    debugLog("analyze-start", {
      channel: message.channel,
      ts: message.ts,
      threadLink,
      sourceKey,
      source: effectiveSource,
      preview: actionableMessage.text.slice(0, 180),
      pendingReason: actionableMessage.pendingReason ?? null,
    });

    if (actionableMessage.pendingReason === "missing_details") {
      const waitingReply = await postReply(client, message.channel, message.threadTs, buildWaitingReply(actionableMessage.text));
      upsertRecoveryTarget({
        sourceKey,
        channel: message.channel,
        sourceTs: actionableMessage.ts,
        threadTs: message.threadTs,
        replyTs: waitingReply?.ts ?? null,
        status: "waiting_details",
      });
      debugLog("analyze-waiting-details", {
        channel: message.channel,
        ts: message.ts,
        sourceKey,
        source: effectiveSource,
      });
      saveProcessedSourceKey(manualRequestKey);
      processedMessages.delete(`${message.channel}:${message.ts}`);
      return true;
    }

    saveProcessedSourceKey(sourceKey);
    await handleIncidentMessage(client, actionableMessage.text, message.channel, message.threadTs, {
      reusableReplyTs: replyDecision.reusableAssistantReplyTs,
      progressContext: {
        channel: message.channel,
        sourceTs: actionableMessage.ts,
        threadTs: message.threadTs,
        threadLink,
        sourceKey,
        source: effectiveSource,
      },
    });
    saveProcessedSourceKey(manualRequestKey);
    debugLog("analyze-success", {
      channel: message.channel,
      ts: message.ts,
      threadLink,
      sourceKey,
      source: effectiveSource,
    });
    removeRecoveryTarget(sourceKey);
    return true;
  } catch (error) {
    logError(logger, error);
    processedSources.delete(sourceKey);
    if (actionableMessage.pendingReason === "missing_details") {
      processedMessages.delete(`${message.channel}:${message.ts}`);
    }
    debugLog("analyze-error", {
      channel: message.channel,
      ts: message.ts,
      sourceKey,
      source: effectiveSource,
      error: error.message,
    });
    if (!error.alreadyReported) {
      await postReply(
        client,
        message.channel,
        message.threadTs,
        `*장애 분석 실패*\n\`${error.message}\``,
      );
    }
    return false;
  } finally {
    processingSources.delete(sourceKey);
  }
}

async function fetchRecentMessages(client, channel, options = {}) {
  const lookbackHours = options.lookbackHours ?? config.startupBackfillLookbackHours;
  const limit = options.limit ?? config.startupBackfillMessageLimit;
  const oldest = buildStartupBackfillOldest(lookbackHours);
  const response = await client.conversations.history({
    channel,
    limit,
    inclusive: true,
    ...(oldest ? { oldest } : {}),
  });

  return selectStartupBackfillMessages(response.messages ?? [], channel);
}

async function fetchRecentScanMessages(client, channel, options = {}) {
  const lookbackHours = options.lookbackHours ?? config.pollLookbackHours;
  const limit = options.limit ?? config.pollMessageLimit;
  const oldest = buildStartupBackfillOldest(lookbackHours);
  const response = await client.conversations.history({
    channel,
    limit,
    inclusive: true,
    ...(oldest ? { oldest } : {}),
  });

  const rootMessages = (response.messages ?? []).map((message) => normalizeSlackMessage(message, channel));
  const threadedRoots = (response.messages ?? [])
    .filter((message) => Number(message?.reply_count ?? 0) > 0)
    .map((message) => message.ts)
    .filter(Boolean);

  const threadReplies = (await Promise.all(
    threadedRoots.map(async (threadTs) => {
      const replies = await fetchThreadMessages(client, channel, threadTs);
      return replies.filter((reply) => reply.ts !== threadTs);
    }),
  )).flat();

  return [ ...rootMessages, ...threadReplies ];
}

async function fetchMessageByTs(client, channel, ts) {
  const response = await client.conversations.history({
    channel,
    latest: ts,
    inclusive: true,
    limit: 1,
  });

  const message = response.messages?.[0];
  return message ? normalizeSlackMessage(message, channel) : null;
}

async function fetchStartupBackfillMessages(client, channel) {
  return fetchRecentMessages(client, channel, {
    lookbackHours: getEffectiveStartupBackfillLookbackHours(),
    limit: config.startupBackfillMessageLimit,
  });
}

async function runStartupPendingRecovery(client, logger = console) {
  let recoveredCount = 0;
  const maxItems = config.maxAnalysesPerRun;
  const startupLookbackHours = getEffectiveStartupBackfillLookbackHours();

  for (const channel of config.slackAlertChannelIds) {
    try {
      const queuedEntries = Array.from(recoveryQueue.values())
        .filter((item) => item.channel === channel)
        .sort((left, right) => String(right.updatedAt ?? right.sourceTs).localeCompare(String(left.updatedAt ?? left.sourceTs)))
        .slice(0, config.maxMessagesPerScan);
      const messages = queuedEntries.length > 0
        ? (await Promise.all(queuedEntries.map((item) => fetchMessageByTs(client, item.channel, item.sourceTs)))).filter(Boolean)
        : selectMostRecentMessages(await fetchStartupBackfillMessages(client, channel), config.maxMessagesPerScan);
      let scannedCount = 0;
      debugLog("startup-pending-recovery-channel", {
        channel,
        lookbackHours: startupLookbackHours,
        fetchedCount: messages.length,
        queueCount: queuedEntries.length,
        scanLimit: config.maxMessagesPerScan,
        source: queuedEntries.length > 0 ? "recovery-queue" : "channel-scan",
      });

      for (const message of messages) {
        if (recoveredCount >= maxItems) {
          debugLog("startup-pending-recovery-limit-reached", {
            recoveredCount,
            maxItems,
          });
          return recoveredCount;
        }

        scannedCount += 1;
        if (scannedCount === 1 || scannedCount === messages.length || scannedCount % 10 === 0) {
          debugLog("startup-pending-recovery-progress", {
            channel,
            scannedCount,
            totalCount: messages.length,
            recoveredCount,
          });
        }

        if (!shouldHandleChannel(message)) {
          continue;
        }

        const actionableMessage = await resolveActionableMessage(client, message);
        if (!actionableMessage) {
          continue;
        }

        const sourceKey = `${actionableMessage.channel}:${actionableMessage.ts}`;
        if (processingSources.has(sourceKey)) {
          debugLog("startup-pending-recovery-skip-processing", {
            channel,
            ts: message.ts,
            sourceKey,
          });
          continue;
        }

        const replyDecision = await shouldSkipBecauseThreadAlreadyHasReplies(client, actionableMessage, {
          allowReusableAssistantReply: true,
        });
        if (!replyDecision.reusableAssistantReplyTs) {
          removeRecoveryTarget(sourceKey);
          continue;
        }

        if (actionableMessage.pendingReason === "missing_details") {
          debugLog("startup-pending-recovery-still-waiting", {
            channel,
            ts: message.ts,
            sourceKey,
          });
          continue;
        }

        processingSources.add(sourceKey);
        try {
          const threadLink = await getThreadPermalink(client, actionableMessage.channel, actionableMessage.ts);
          debugLog("startup-pending-recovery-start", {
            channel,
            ts: message.ts,
            threadLink,
            sourceKey,
            reusableReplyTs: replyDecision.reusableAssistantReplyTs,
          });
          await handleIncidentMessage(client, actionableMessage.text, message.channel, message.threadTs, {
            reusableReplyTs: replyDecision.reusableAssistantReplyTs,
            progressContext: {
              channel: message.channel,
              sourceTs: actionableMessage.ts,
              threadTs: message.threadTs,
              threadLink,
              sourceKey,
              source: "startup-pending-recovery",
            },
          });
          processedSources.add(sourceKey);
          saveProcessedSourceKeys(config.stateFile, processedSources);
          recoveredCount += 1;
          debugLog("startup-pending-recovery-success", {
            channel,
            ts: message.ts,
            threadLink,
            sourceKey,
          });
        } catch (error) {
          logError(logger, error);
          debugLog("startup-pending-recovery-error", {
            channel,
            ts: message.ts,
            sourceKey,
            error: error.message,
          });
        } finally {
          processingSources.delete(sourceKey);
        }
      }
    } catch (error) {
      logError(logger, error);
      debugLog("startup-pending-recovery-channel-error", {
        channel,
        error: error.message,
      });
    }
  }

  if (recoveredCount === 0) {
    debugLog("startup-pending-recovery-no-work", {
      channels: config.slackAlertChannelIds,
      lookbackHours: startupLookbackHours,
    });
  }

  return recoveredCount;
}

async function runStartupBackfill(client, logger = console, options = {}) {
  if (!config.startupBackfillEnabled) {
    debugLog("startup-backfill-disabled");
    return 0;
  }

  const maxItems = options.maxItems ?? config.maxAnalysesPerRun;
  const startupLookbackHours = getEffectiveStartupBackfillLookbackHours();
  let totalHandledCount = 0;

  for (const channel of config.slackAlertChannelIds) {
    try {
      const messages = selectMostRecentMessages(
        await fetchStartupBackfillMessages(client, channel),
        config.maxMessagesPerScan,
      );
      let handledCount = 0;
      debugLog("startup-backfill-channel", {
        channel,
        lookbackHours: startupLookbackHours,
        fetchedCount: messages.length,
        scanLimit: config.maxMessagesPerScan,
      });

      for (const message of messages) {
        if (totalHandledCount >= maxItems) {
          debugLog("startup-backfill-limit-reached", {
            handledCount: totalHandledCount,
            maxItems,
          });
          return totalHandledCount;
        }

        const handled = await processIncomingMessage(client, logger, message, {
          skipPendingReplies: false,
          source: "startup-backfill",
          requireEmptyThreadReplies: true,
        });
        if (handled) {
          handledCount += 1;
          totalHandledCount += 1;
        }
      }

      if (handledCount === 0) {
        debugLog("startup-backfill-no-work", {
          channel,
          fetchedCount: messages.length,
        });
      }
    } catch (error) {
      logError(logger, error);
      debugLog("startup-backfill-error", {
        channel,
        error: error.message,
      });
    }
  }

  if (totalHandledCount === 0) {
    debugLog("startup-backfill-no-work-overall", {
      channels: config.slackAlertChannelIds,
      lookbackHours: startupLookbackHours,
    });
  }

  return totalHandledCount;
}

async function runScan(client, logger = console) {
  await ensureAssistantIdentity(client);
  const startupLookbackHours = getEffectiveStartupBackfillLookbackHours();
  debugLog("scan-pending-recovery-start", {
    lookbackHours: startupLookbackHours,
    channels: config.slackAlertChannelIds,
  });
  let totalHandledCount = 0;
  const recoveredCount = await runStartupPendingRecovery(client, logger);
  totalHandledCount += recoveredCount ?? 0;
  debugLog("scan-pending-recovery-finish", {
    lookbackHours: startupLookbackHours,
    channels: config.slackAlertChannelIds,
    handledCount: totalHandledCount,
  });

  if (totalHandledCount < config.maxAnalysesPerRun) {
    const backfillCount = await runStartupBackfill(client, logger, {
      maxItems: config.maxAnalysesPerRun - totalHandledCount,
    });
    totalHandledCount += backfillCount ?? 0;
  }

  if (totalHandledCount >= config.maxAnalysesPerRun) {
    debugLog("scan-analysis-budget-reached", {
      handledCount: totalHandledCount,
      maxItems: config.maxAnalysesPerRun,
    });
    return {
      handledCount: totalHandledCount,
    };
  }

  for (const channel of config.slackAlertChannelIds) {
    try {
      const messages = selectMostRecentMessages(await fetchRecentScanMessages(client, channel, {
        lookbackHours: config.pollLookbackHours,
        limit: config.pollMessageLimit,
      }), config.maxMessagesPerScan);
      let handledCount = 0;
      let scannedCount = 0;
      debugLog("scan-channel", {
        channel,
        lookbackHours: config.pollLookbackHours,
        fetchedCount: messages.length,
        scanLimit: config.maxMessagesPerScan,
      });

      for (const message of messages) {
        if (totalHandledCount >= config.maxAnalysesPerRun) {
          debugLog("scan-analysis-budget-reached", {
            handledCount: totalHandledCount,
            maxItems: config.maxAnalysesPerRun,
          });
          return {
            handledCount: totalHandledCount,
          };
        }

        scannedCount += 1;
        if (scannedCount === 1 || scannedCount === messages.length || scannedCount % 10 === 0) {
          debugLog("scan-progress", {
            channel,
            scannedCount,
            totalCount: messages.length,
            handledCount,
          });
        }

        const handled = await processIncomingMessage(client, logger, message, {
          source: "scan",
          requireEmptyThreadReplies: true,
        });
        if (handled) {
          handledCount += 1;
        }
      }

      totalHandledCount += handledCount;
      if (handledCount === 0) {
        debugLog("scan-no-work", {
          channel,
          fetchedCount: messages.length,
        });
      }
    } catch (error) {
      logError(logger, error);
      debugLog("scan-channel-error", {
        channel,
        error: error.message,
      });
    }
  }

  debugLog("scan-finish", {
    handledCount: totalHandledCount,
    lookbackHours: config.pollLookbackHours,
    channels: config.slackAlertChannelIds,
  });

  return {
    handledCount: totalHandledCount,
  };
}

async function runLoop(client, logger = console) {
  let iteration = 0;

  while (true) {
    iteration += 1;
    const startedAt = Date.now();
    debugLog("loop-iteration-start", {
      iteration,
      intervalSeconds: config.loopIntervalSeconds,
    });

    try {
      const result = await runScan(client, logger);
      debugLog("loop-iteration-finish", {
        iteration,
        handledCount: result?.handledCount ?? 0,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      logError(logger, error);
      debugLog("loop-iteration-error", {
        iteration,
        elapsedMs: Date.now() - startedAt,
        error: error.message,
      });
    }

    debugLog("loop-sleep", {
      iteration,
      sleepSeconds: config.loopIntervalSeconds,
    });
    await sleep(config.loopIntervalSeconds * 1000);
  }
}

const client = new WebClient(config.slackBotToken);

if (config.runMode === "loop") {
  debugLog("loop-mode-start", {
    channels: config.slackAlertChannelIds,
    intervalSeconds: config.loopIntervalSeconds,
  });
  await runLoop(client);
} else {
  debugLog("scan-mode-start", {
    channels: config.slackAlertChannelIds,
  });
  await runScan(client);
}
