import { URL } from "node:url";

const ALERT_REQUIRED_PATTERNS = [
  "최근 5분 동안",
  "stack:",
];

const ALERT_HEADER_PATTERNS = [
  "인시던트의 상태가 변경되었습니다.",
  "인시던트가 생성되었습니다.",
  "에스컬레이션됨",
  "담당자 지정됨",
];

const METADATA_FIELD_PATTERNS = [
  "담당자:",
  "서비스:",
  "확인한 사용자:",
  "지정된 사용자:",
  "에스컬레이션:",
  "바로 가기",
];

const SEARCH_TERM_STOPWORDS = new Set([
  "alert",
  "application",
  "error",
  "hogangnono",
  "service",
  "status",
  "unknown",
]);

function unique(items) {
  return [ ...new Set(items.filter(Boolean)) ];
}

function compactWhitespace(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function summarizeRepeatedLines(value, options = {}) {
  const {
    maxUniqueLines = 12,
    repeatPreviewLimit = 3,
  } = options;

  const lines = String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  const counts = new Map();
  const ordered = [];

  for (const line of lines) {
    const current = counts.get(line) ?? 0;
    counts.set(line, current + 1);
    if (current === 0) {
      ordered.push(line);
    }
  }

  const summarized = [];
  for (const line of ordered.slice(0, maxUniqueLines)) {
    const count = counts.get(line) ?? 1;
    summarized.push(line);
    if (count > repeatPreviewLimit) {
      summarized.push(`... 동일 패턴 ${count - 1}건 추가`);
    } else if (count > 1) {
      for (let i = 1; i < count; i += 1) {
        summarized.push(line);
      }
    }
  }

  const omittedUnique = Math.max(0, ordered.length - maxUniqueLines);
  if (omittedUnique > 0) {
    summarized.push(`... 추가 고유 패턴 ${omittedUnique}건 생략`);
  }

  return summarized.join("\n");
}

function compactAlertText(text) {
  return text.replace(
    /stack:\s*([\s\S]*?)(?=(?:담당자:|서비스:|확인한 사용자:|에스컬레이션:|바로 가기|$))/,
    (_, stackBody) => `stack:\n${summarizeRepeatedLines(stackBody)}`,
  );
}

function extractFirst(patterns, text) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function stripTrailingMetadata(value) {
  if (!value) {
    return null;
  }

  let sanitized = value;
  for (const pattern of METADATA_FIELD_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(`${pattern}[\\s\\S]*$`), "");
  }

  sanitized = sanitized
    .replace(/[ \t]+/g, " ")
    .trim();

  return sanitized || null;
}

function normalizeServiceLabel(value) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:redirect_uri|state|response_type|response_mode|scope|nonce|prompt|client_id)=[^\s]+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("opsnow.com") || normalized.includes("openid-connect")) {
    return null;
  }

  return normalized;
}

function extractStackBody(text) {
  const match = text.match(/stack:\s*([\s\S]*?)(?=(?:담당자:|서비스:|확인한 사용자:|에스컬레이션:|바로 가기|$))/);
  return stripTrailingMetadata(match?.[1] ?? null);
}

function extractErrorMessage(text) {
  return extractFirst([
    /QueryFailedError:\s*([^\n]+)/,
    /\[UnknownExceptionFilter\]\s*([^\n]+)/,
    /([A-Za-z0-9]+Error:\s*[^\n]+)/,
    /stack:\s*\n*\s*(\[[^\n]+\][^\n]*)/,
    /stack:\s*\n*\s*([^\n][\s\S]*?)(?=(?:담당자:|서비스:|확인한 사용자:|에스컬레이션:|바로 가기|$))/,
  ], text);
}

function extractExceptionName(text) {
  return extractFirst([
    /\b(QueryFailedError)\b/,
    /\b([A-Za-z]+Exception)\b/,
    /\b([A-Za-z]+Error)\b/,
    /stack:\s*\n*\s*\[([^\]\n]+)\]/,
  ], text);
}

function parseRequestUrl(rawUrl) {
  if (!rawUrl) {
    return {
      raw: null,
      path: null,
      query: null,
    };
  }

  const parsed = new URL(rawUrl, "https://local.invalid");

  return {
    raw: rawUrl,
    path: parsed.pathname,
    query: parsed.search ? parsed.search.slice(1) : null,
  };
}

function buildSearchTerms(parsed) {
  const slugTokens = (parsed.incidentSlug ?? "")
    .split(/[-_.]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4 && !SEARCH_TERM_STOPWORDS.has(token));

  const stackTokens = (parsed.stackBody ?? "")
    .match(/[A-Za-z0-9][A-Za-z0-9/_-]*[A-Za-z0-9]/g) ?? [];

  const messageTokens = (parsed.error.message ?? "")
    .split(/[^A-Za-z0-9/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !SEARCH_TERM_STOPWORDS.has(token.toLowerCase()));

  return unique([
    parsed.incidentSlug,
    parsed.error.exceptionName,
    ...slugTokens,
    ...stackTokens.slice(0, 8),
    ...messageTokens.slice(0, 6),
  ]);
}

function buildSimilarityFingerprint(parsed) {
  const messageTokens = (parsed.error.message ?? "")
    .toLowerCase()
    .split(/[^a-z0-9/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !SEARCH_TERM_STOPWORDS.has(token))
    .slice(0, 2);

  return [
    parsed.request.method?.toUpperCase() ?? "unknown",
    parsed.request.path ?? "unknown",
    parsed.error.exceptionName ?? "unknown",
    ...messageTokens,
  ].join(":");
}

function isAlertNotificationParsed(parsed) {
  return ALERT_REQUIRED_PATTERNS.every((token) => parsed.normalizedText.includes(token))
    && ALERT_HEADER_PATTERNS.some((token) => parsed.normalizedText.includes(token));
}

export function isLikelyAlertIncident(text) {
  const parsed = parseIncidentMessage(text);
  return isAlertNotificationParsed(parsed) && parsed.hasActionableDetails;
}

export function isAlertNotificationWithoutDetails(text) {
  const parsed = parseIncidentMessage(text);
  return isAlertNotificationParsed(parsed)
    && !parsed.hasActionableDetails
    && Boolean(parsed.incidentId || parsed.incidentSlug);
}

export function parseIncidentMessage(text) {
  const normalizedText = compactWhitespace(compactAlertText(text));
  const requestUrl = extractFirst([
    /"url":\s*"([^"]+)"/,
    /'url':\s*'([^']+)'/,
  ], normalizedText);
  const requestMethod = extractFirst([
    /"method":\s*"([A-Z]+)"/,
    /'method':\s*'([A-Z]+)'/,
  ], normalizedText);
  const statusCode = extractFirst([
    /\bstatus:\s*(\d{3})\b/,
  ], normalizedText);
  const recentErrorCount = extractFirst([
    /최근\s*5분\s*동안\s*(\d+)\s*개의?\s*에러가\s*발생했습니다/,
  ], normalizedText);
  const stackBody = extractStackBody(normalizedText);
  const errorMessage = stripTrailingMetadata(extractErrorMessage(normalizedText));

  const parsed = {
    normalizedText,
    incidentId: extractFirst([
      /#(\d+)>:/,
      /확인\s+#(\d+)/,
      /#(\d+):/,
    ], normalizedText),
    incidentSlug: extractFirst([
      /#\d+>:\*?\s*([A-Za-z0-9._-]+)/,
      /#\d+:\s*([A-Za-z0-9._-]+)/,
    ], normalizedText),
    incidentType: extractFirst([
      /(인시던트의 상태가 변경되었습니다\.)/,
      /(인시던트가 생성되었습니다\.)/,
      /(에스컬레이션됨)/,
    ], normalizedText),
    owner: extractFirst([
      /\*담당자:\*?\s*([^:\n]*?)(?:\*서비스:\*|서비스:|확인한 사용자:|에스컬레이션:|$)/,
      /담당자:\s*([^:\n]*?)(?:서비스:|확인한 사용자:|에스컬레이션:|$)/,
    ], normalizedText),
    serviceLabel: normalizeServiceLabel(extractFirst([
      /\*서비스:\*?\s*([^\n]+?)\s*(?:확인한 사용자:|지정된 사용자:|에스컬레이션:|$)/,
      /서비스:\s*([^\n]+?)\s*(?:확인한 사용자:|지정된 사용자:|에스컬레이션:|$)/,
      /\*서비스:\*?\s*([^\n]+)/,
      /서비스:\s*([^\n]+)/,
    ], normalizedText)),
    stackBody,
    request: {
      ...parseRequestUrl(requestUrl),
      method: requestMethod,
    },
    error: {
      statusCode: statusCode ? Number.parseInt(statusCode, 10) : null,
      exceptionName: extractExceptionName(normalizedText),
      message: errorMessage,
      recentCount5m: recentErrorCount ? Number.parseInt(recentErrorCount, 10) : null,
    },
  };

  return {
    ...parsed,
    hasActionableDetails: Boolean(
      parsed.request.raw
        || parsed.error.statusCode
        || parsed.error.message,
    ),
    fingerprint: [
      parsed.incidentId ?? "unknown",
      parsed.request.method ?? "unknown",
      parsed.request.path ?? "unknown",
      parsed.error.exceptionName ?? "unknown",
    ].join(":"),
    similarityFingerprint: buildSimilarityFingerprint(parsed),
    searchTerms: buildSearchTerms(parsed),
  };
}
