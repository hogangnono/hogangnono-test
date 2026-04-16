const REANALYZE_PATTERN = /(다시\s*분석|재\s*분석|reanalyze|re-analyze)/i;
const ANALYZE_PATTERN = /(분석|analyze)/i;

export function parseManualAnalyzeRequest(text, options = {}) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) {
    return null;
  }

  const normalizedLowerText = normalizedText.toLowerCase();
  const mentionTokens = [
    options.assistantUserId ? `<@${String(options.assistantUserId).toLowerCase()}>` : null,
    options.assistantBotName ? options.assistantBotName.toLowerCase() : null,
    options.assistantBotName ? `@${options.assistantBotName.toLowerCase()}` : null,
  ].filter(Boolean);

  if (!mentionTokens.some((token) => normalizedLowerText.includes(token))) {
    return null;
  }

  if (REANALYZE_PATTERN.test(normalizedText)) {
    return {
      command: "reanalyze",
      force: true,
    };
  }

  if (ANALYZE_PATTERN.test(normalizedText)) {
    return {
      command: "analyze",
      force: false,
    };
  }

  return null;
}
