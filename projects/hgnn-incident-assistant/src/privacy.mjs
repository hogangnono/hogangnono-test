function sanitizeWithPatterns(text, patterns) {
  let result = text;
  for (const [pattern, replacement] of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeSensitiveText(text) {
  if (!text) {
    return text;
  }

  return sanitizeWithPatterns(text, [
    [/(담당자:\s*)([^\n|<]*)/g, "$1<redacted>"],
    [/(확인한 사용자:\s*)([^\n|<]*)/g, "$1<redacted>"],
    [/(\*담당자:\*\s*)([^\n|<]*)/g, "$1<redacted>"],
    [/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "<redacted-email>"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<redacted-ip>"],
    [/\b01[0-9]-?\d{3,4}-?\d{4}\b/g, "<redacted-phone>"],
    [/("?(?:authorization|x-api-key|apikey|api_key|hkey|cookie|set-cookie|token|access_token|refresh_token)"?\s*[:=]\s*"?)([^",\s}]+)/gi, "$1<redacted>"],
    [/\b[A-Fa-f0-9]{24,}\b/g, "<redacted-secret>"],
  ]);
}

export function sanitizeAnalysis(analysis) {
  return {
    ...analysis,
    summary: sanitizeSensitiveText(analysis.summary),
    likelyCause: sanitizeSensitiveText(analysis.likelyCause),
    evidence: (analysis.evidence ?? []).map((item) => sanitizeSensitiveText(item)),
    checks: (analysis.checks ?? []).map((item) => sanitizeSensitiveText(item)),
    immediateActions: (analysis.immediateActions ?? []).map((item) => sanitizeSensitiveText(item)),
    escalation: sanitizeSensitiveText(analysis.escalation),
  };
}
