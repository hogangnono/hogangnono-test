import { collectRepositoryContext } from "./context-collector.mjs";
import { formatSlackReply, formatSlackReplyMessages } from "./formatter.mjs";
import { parseIncidentMessage } from "./incident-parser.mjs";
import { buildPrompt, resolveAnalysisProvider, runIncidentAnalysis } from "./llm-runner.mjs";

function emitProgress(onProgress, stage, payload = {}) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(stage, payload);
}

function buildTimedOutContextBundle(config) {
  return {
    repoRoots: config.repoRoots,
    evidence: [],
    awsContext: {
      promptContext: "",
      services: [],
    },
    lokiContext: {
      promptContext: "",
      jobs: [],
      similarErrorSummary: null,
    },
    promptContext: "Repository context collection timed out. Continue with thin evidence.",
  };
}

function selectRelevantRepoRoots(incident, repoRoots) {
  const haystack = [
    incident.incidentSlug,
    incident.serviceLabel,
    incident.normalizedText,
    incident.request?.path,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const repoGroups = [
    {
      matchers: [ "hogangnono-api-v2", "hogangnono-api", "/api/" ],
      repoNames: [ "hogangnono-api" ],
    },
    {
      matchers: [ "hogangnono-bot", "bot", "slack" ],
      repoNames: [ "hogangnono-bot" ],
    },
    {
      matchers: [ "hogangnono-batch", "biglab-hg-batch", "batch", "cron", "scheduler" ],
      repoNames: [ "hogangnono-batch", "biglab-hg-batch" ],
    },
    {
      matchers: [ "hogangnono-web", "frontend", "web" ],
      repoNames: [ "hogangnono" ],
    },
  ];

  for (const group of repoGroups) {
    if (!group.matchers.some((matcher) => haystack.includes(matcher))) {
      continue;
    }

    const selected = repoRoots.filter((repoRoot) => group.repoNames.some((repoName) => repoRoot.endsWith(`/${repoName}`)));
    if (selected.length > 0) {
      return selected;
    }
  }

  return repoRoots;
}

export async function prepareIncidentAnalysis(text, config, options = {}) {
  const onProgress = options.onProgress;
  const startedAt = Date.now();

  emitProgress(onProgress, "prepare-start");
  const incident = parseIncidentMessage(text);
  emitProgress(onProgress, "incident-parsed", {
    incidentId: incident.incidentId ?? null,
    incidentSlug: incident.incidentSlug ?? null,
    requestPath: incident.request?.path ?? null,
  });
  const selectedRepoRoots = selectRelevantRepoRoots(incident, config.repoRoots);
  emitProgress(onProgress, "context-collect-start", {
    repoRootCount: selectedRepoRoots.length,
    selectedRepoRoots,
  });
  let contextTimedOut = false;
  let contextTimeoutHandle;
  const contextAbortController = new AbortController();
  const contextSignal = contextAbortController.signal;
  const contextProgress = (stage, payload = {}) => {
    if (contextSignal.aborted) {
      return;
    }

    emitProgress(onProgress, stage, payload);
  };
  const collectContextPromise = collectRepositoryContext(incident, {
    repoRoots: selectedRepoRoots,
    maxContextChars: config.maxContextChars,
    awsTimeoutMs: config.awsTimeoutMs,
    onProgress: contextProgress,
    signal: contextSignal,
  }).catch((error) => {
    if (error?.name === "AbortError") {
      return buildTimedOutContextBundle(config);
    }

    throw error;
  });
  const contextBundle = await Promise.race([
    collectContextPromise,
    new Promise((resolve) => {
      contextTimeoutHandle = setTimeout(() => {
        contextTimedOut = true;
        contextAbortController.abort();
        resolve(buildTimedOutContextBundle({
          ...config,
          repoRoots: selectedRepoRoots,
        }));
      }, config.contextTimeoutMs);
    }),
  ]);
  if (contextTimeoutHandle) {
    clearTimeout(contextTimeoutHandle);
  }
  if (contextTimedOut) {
    emitProgress(onProgress, "context-collect-timeout", {
      elapsedMs: Date.now() - startedAt,
      timeoutMs: config.contextTimeoutMs,
    });
  }
  emitProgress(onProgress, "context-collect-finish", {
    elapsedMs: Date.now() - startedAt,
    evidenceCount: contextBundle.evidence.length,
    awsServiceCount: contextBundle.awsContext?.services?.length ?? 0,
    lokiJobCount: contextBundle.lokiContext?.jobs?.length ?? 0,
    promptChars: contextBundle.promptContext?.length ?? 0,
  });
  const providerUsed = resolveAnalysisProvider(config.llmProvider, {
    preferCodexMcp: config.preferCodexMcp,
  });
  const prompt = buildPrompt(incident, contextBundle, { provider: providerUsed });
  emitProgress(onProgress, "prepare-finish", {
    elapsedMs: Date.now() - startedAt,
    providerUsed,
    promptChars: prompt.length,
  });

  return {
    incident,
    contextBundle,
    providerUsed,
    prompt,
  };
}

export async function analyzeIncidentText(text, config, options = {}) {
  const onProgress = options.onProgress;
  const startedAt = Date.now();
  emitProgress(onProgress, "analysis-start");

  const prepared = await prepareIncidentAnalysis(text, config, { onProgress });
  emitProgress(onProgress, "llm-start", {
    providerCandidate: prepared.providerUsed,
  });
  const llmStartedAt = Date.now();
  const { analysis, providerUsed, prompt } = await runIncidentAnalysis(prepared.incident, prepared.contextBundle, {
    provider: config.llmProvider,
    preferCodexMcp: config.preferCodexMcp,
    resolvedProvider: prepared.providerUsed,
    cwd: config.repoRoots[0],
    llmTimeoutMs: config.llmTimeoutMs,
  });
  emitProgress(onProgress, "llm-finish", {
    providerUsed,
    elapsedMs: Date.now() - llmStartedAt,
  });
  const replyText = formatSlackReply(prepared.incident, analysis, prepared.contextBundle);
  const replyMessages = formatSlackReplyMessages(prepared.incident, analysis, prepared.contextBundle);
  emitProgress(onProgress, "format-finish", {
    elapsedMs: Date.now() - startedAt,
    summaryBlockCount: replyMessages.summaryBlocks.length,
    detailBlockCount: replyMessages.detailBlocks.length,
  });

  return {
    incident: prepared.incident,
    contextBundle: prepared.contextBundle,
    analysis,
    providerUsed,
    prompt,
    replyText,
    replyMessages,
  };
}
