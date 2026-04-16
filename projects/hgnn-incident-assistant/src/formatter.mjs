import { sanitizeAnalysis, sanitizeSensitiveText } from "./privacy.mjs";
import { buildReferenceLink } from "./reference-links.mjs";

function truncateText(text, maxLength) {
  const normalized = sanitizeSensitiveText(String(text ?? "")).replace(/\s+/g, " ").trim();
  if (!maxLength || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatList(items, options = {}) {
  const { maxItems = items.length, maxLength } = options;
  if (!items.length) {
    return [ "• 없음" ];
  }

  return items
    .slice(0, maxItems)
    .map((item) => `• ${truncateText(item, maxLength)}`);
}

function formatMarkdownList(items) {
  if (!items.length) {
    return [ "- 없음" ];
  }

  return items.map((item) => `- ${sanitizeSensitiveText(item)}`);
}

function joinNonEmptyLines(lines) {
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function splitTextByParagraphs(text, maxLength = 2800) {
  const normalized = sanitizeSensitiveText(String(text ?? "")).trim();
  if (!normalized) {
    return [ "" ];
  }

  if (normalized.length <= maxLength) {
    return [ normalized ];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    const lines = paragraph.split("\n").map((item) => item.trim()).filter(Boolean);
    let lineChunk = "";
    for (const line of lines) {
      const lineCandidate = lineChunk ? `${lineChunk}\n${line}` : line;
      if (lineCandidate.length <= maxLength) {
        lineChunk = lineCandidate;
        continue;
      }

      if (lineChunk) {
        chunks.push(lineChunk);
      }

      if (line.length <= maxLength) {
        lineChunk = line;
        continue;
      }

      for (let start = 0; start < line.length; start += maxLength) {
        chunks.push(line.slice(start, start + maxLength));
      }
      lineChunk = "";
    }

    if (lineChunk) {
      current = lineChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [ normalized ];
}

function formatConfidenceLabel(confidence) {
  const normalized = sanitizeSensitiveText(String(confidence ?? "")).trim().toLowerCase();

  if (normalized === "high") {
    return "높음";
  }

  if (normalized === "medium") {
    return "중간";
  }

  if (normalized === "low") {
    return "낮음";
  }

  return sanitizeSensitiveText(confidence ?? "unknown") || "unknown";
}

function buildIncidentRequestLabel(incident) {
  return sanitizeSensitiveText([ incident.request?.method, incident.request?.path ].filter(Boolean).join(" ").trim());
}

function buildIncidentMetaItems(incident, confidenceLabel) {
  const metaItems = [];
  const incidentId = sanitizeSensitiveText(incident.incidentId);
  const requestLabel = buildIncidentRequestLabel(incident);
  const serviceLabel = truncateText(incident.serviceLabel, 80);

  if (incidentId) {
    metaItems.push({
      plain: `*인시던트* #${incidentId}`,
      block: `*인시던트*\n#${incidentId}`,
    });
  }

  if (requestLabel) {
    metaItems.push({
      plain: `*요청* \`${requestLabel}\``,
      block: `*요청*\n\`${requestLabel}\``,
    });
  }

  if (serviceLabel) {
    metaItems.push({
      plain: `*서비스* ${serviceLabel}`,
      block: `*서비스*\n${serviceLabel}`,
    });
  }

  metaItems.push({
    plain: `*신뢰도* ${confidenceLabel}`,
    block: `*신뢰도*\n${confidenceLabel}`,
  });

  return metaItems;
}

function buildRecentSimilarLabel(contextBundle, options = {}) {
  const similar = contextBundle?.lokiContext?.similarErrorSummary;
  if (!similar || typeof similar.count !== "number") {
    return null;
  }

  if (options.compact) {
    return `${similar.lookbackDays}일 ${similar.count}건`;
  }

  return `최근 ${similar.lookbackDays}일 유사 ${similar.count}건`;
}

function buildCompactMetaLine(incident, confidenceLabel, contextBundle) {
  const parts = [];
  const incidentId = sanitizeSensitiveText(incident.incidentId);
  const requestLabel = buildIncidentRequestLabel(incident);
  const recentSimilarLabel = buildRecentSimilarLabel(contextBundle, { compact: true });
  const recentCount5m = incident.error?.recentCount5m;

  if (incidentId) {
    parts.push(`#${incidentId}`);
  }

  if (requestLabel) {
    parts.push(requestLabel);
  }

  parts.push(confidenceLabel);

  if (Number.isFinite(recentCount5m) && recentCount5m > 0) {
    parts.push(`5분 ${recentCount5m}건`);
  }

  if (recentSimilarLabel) {
    parts.push(recentSimilarLabel);
  }

  return parts.join(" · ");
}

function buildSlackSectionBlocks(title, body, options = {}) {
  const {
    expand = false,
    maxLength = 2800,
    continuationLabel = "계속",
  } = options;

  return splitTextByParagraphs(body, maxLength).map((chunk, index) => ({
    type: "section",
    expand,
    text: {
      type: "mrkdwn",
      text: joinNonEmptyLines([
        index === 0 ? `*${title}*` : `*${title} (${continuationLabel} ${index + 1})*`,
        chunk,
      ]),
    },
  }));
}

function buildSlackListBody(items, options = {}) {
  return formatList(items, options).join("\n");
}

function buildSlackContextBlock(text) {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text,
      },
    ],
  };
}

function buildSafeFileName(value) {
  const normalized = sanitizeSensitiveText(value ?? "incident-analysis")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "incident-analysis";
}

function buildEvidenceFiles(analysis, contextBundle) {
  const safeAnalysis = sanitizeAnalysis(analysis);
  const fileLineMap = new Map();
  for (const item of contextBundle.evidence) {
    if (!fileLineMap.has(item.filePath)) {
      fileLineMap.set(item.filePath, item.lineNumber);
    }
  }

  const evidenceFiles = [ ...fileLineMap.entries() ]
    .slice(0, 4)
    .map(([ filePath, lineNumber ]) => buildReferenceLink(filePath, lineNumber, contextBundle.repoRoots ?? []))
    .join("\n");

  return {
    safeAnalysis,
    evidenceFiles,
  };
}

export function formatSlackReplyMessages(incident, analysis, contextBundle) {
  const { safeAnalysis, evidenceFiles } = buildEvidenceFiles(analysis, contextBundle);
  const incidentLabel = sanitizeSensitiveText(incident.incidentSlug ?? incident.request.path ?? "unknown");
  const confidenceLabel = formatConfidenceLabel(safeAnalysis.confidence);
  const recentSimilarLabel = buildRecentSimilarLabel(contextBundle);
  const compactMetaLine = buildCompactMetaLine(incident, confidenceLabel, contextBundle);
  const summaryTextBody = truncateText(safeAnalysis.summary, 220);
  const likelyCauseBody = truncateText(safeAnalysis.likelyCause, 180);
  const checksBody = buildSlackListBody(safeAnalysis.checks, {
    maxItems: 2,
    maxLength: 120,
  });
  const detailEvidenceBody = buildSlackListBody(safeAnalysis.evidence, {
    maxItems: 2,
    maxLength: 120,
  });
  const detailImmediateActionsBody = buildSlackListBody(safeAnalysis.immediateActions, {
    maxItems: 2,
    maxLength: 120,
  });
  const escalationBody = truncateText(safeAnalysis.escalation, 180);
  const referenceBody = evidenceFiles
    ? evidenceFiles.split("\n").map((line) => `• ${line}`).join("\n")
    : "";
  const detailSummaryBody = safeAnalysis.summary;
  const detailLikelyCauseBody = safeAnalysis.likelyCause;
  const detailEvidenceFullBody = formatMarkdownList(safeAnalysis.evidence).join("\n");
  const detailChecksFullBody = formatMarkdownList(safeAnalysis.checks).join("\n");
  const detailImmediateActionsFullBody = formatMarkdownList(safeAnalysis.immediateActions).join("\n");
  const detailEscalationBody = safeAnalysis.escalation;

  const summaryLines = [
    `*장애 분석* ${incidentLabel}`,
    compactMetaLine,
    "",
    "*요약*",
    summaryTextBody,
  ];

  const detailLines = [
    "*상세 분석*",
    compactMetaLine,
    "",
    "*요약*",
    summaryTextBody,
    "",
    "*원인 가설*",
    likelyCauseBody,
    "",
    "*핵심 근거*",
    ...formatList(safeAnalysis.evidence, { maxItems: 2, maxLength: 120 }),
    "",
    "*먼저 볼 것*",
    ...formatList(safeAnalysis.checks, { maxItems: 2, maxLength: 120 }),
    "",
    "*즉시 조치*",
    ...formatList(safeAnalysis.immediateActions, { maxItems: 2, maxLength: 120 }),
    "",
    "*에스컬레이션*",
    escalationBody,
  ];

  if (recentSimilarLabel) {
    detailLines.splice(8, 0, "", "*반복 추이*", recentSimilarLabel);
  }

  if (evidenceFiles) {
    detailLines.push("", "*참고 파일*", ...evidenceFiles.split("\n").map((line) => `• ${line}`));
  }

  const detailBlocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateText(`상세 분석: ${incidentLabel}`, 140),
      },
    },
    compactMetaLine
      ? buildSlackContextBlock(compactMetaLine)
      : null,
    {
      type: "divider",
    },
    ...buildSlackSectionBlocks("요약", detailSummaryBody, { expand: false }),
    ...buildSlackSectionBlocks("원인 가설", detailLikelyCauseBody, { expand: false }),
    recentSimilarLabel
      ? buildSlackSectionBlocks("반복 추이", recentSimilarLabel, { expand: false })
      : [],
    ...buildSlackSectionBlocks("핵심 근거", detailEvidenceFullBody, { expand: false }),
    ...buildSlackSectionBlocks("먼저 볼 것", detailChecksFullBody, { expand: false }),
    ...buildSlackSectionBlocks("즉시 조치", detailImmediateActionsFullBody, { expand: false }),
    ...buildSlackSectionBlocks("에스컬레이션", detailEscalationBody, { expand: false }),
    evidenceFiles
      ? buildSlackSectionBlocks("참고 파일", referenceBody, { expand: false })
      : [],
  ].flat().filter(Boolean);

  const fullDetailLines = [
    `# 장애 분석 ${incidentLabel}`,
    "",
    "## 메타",
    compactMetaLine,
    "",
    "## 요약",
    safeAnalysis.summary,
    ...(recentSimilarLabel ? [ "", "## 반복 추이", recentSimilarLabel ] : []),
    "",
    "## 가설",
    safeAnalysis.likelyCause,
    "",
    "## 근거",
    ...formatMarkdownList(safeAnalysis.evidence),
    "",
    "## 먼저 볼 것",
    ...formatMarkdownList(safeAnalysis.checks),
    "",
    "## 즉시 조치",
    ...formatMarkdownList(safeAnalysis.immediateActions),
    "",
    "## 에스컬레이션",
    safeAnalysis.escalation,
  ];

  if (evidenceFiles) {
    fullDetailLines.push("", "## 참고 파일");
    fullDetailLines.push(...evidenceFiles.split("\n").map((line) => `- ${line}`));
  }

  const fullDetailText = fullDetailLines.join("\n");

  return {
    summaryText: summaryLines.join("\n"),
    detailText: detailLines.join("\n"),
    summaryBlocks: detailBlocks,
    detailBlocks,
    fullDetailText,
    detailFile: {
      filename: `${buildSafeFileName(incidentLabel)}-analysis.md`,
      title: `${truncateText(incidentLabel, 60)} 상세 분석`,
      initialComment: "*상세 분석 첨부*\n긴 내용은 첨부 파일을 확인하세요.",
      content: fullDetailText,
    },
  };
}

export function formatSlackReply(incident, analysis, contextBundle) {
  const { summaryText, fullDetailText } = formatSlackReplyMessages(incident, analysis, contextBundle);

  return `${summaryText}\n\n---\n${fullDetailText}`;
}
