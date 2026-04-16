import { spawn } from "node:child_process";
import { resolveServiceTargets } from "./aws-context.mjs";

const DEFAULT_LOKI_URL = "http://grafana.housefeed.com:3100";
const DEFAULT_LOOKBACK_MINUTES = 60;
const DEFAULT_SIMILAR_LOOKBACK_DAYS = 30;
const LINE_LIMIT_PER_QUERY = 4;
const MAX_LINES_PER_JOB = 6;

const TERM_STOPWORDS = new Set([
  "alert",
  "application",
  "error",
  "service",
  "status",
  "unknown",
  "hogangnono",
]);

function buildAbortError() {
  const error = new Error("Loki context collection aborted");
  error.name = "AbortError";
  return error;
}

function unique(items) {
  return [ ...new Set(items.filter(Boolean)) ];
}

function escapeLogValue(value) {
  return String(value ?? "").replaceAll("\"", "\\\"");
}

function runCurl(url, params, runner = null, signal = null) {
  if (runner) {
    return Promise.resolve(runner(url, params));
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(buildAbortError());
      return;
    }

    const args = [ "-sS", "-G", "--max-time", "15", url ];
    for (const [ key, value ] of Object.entries(params)) {
      args.push("--data-urlencode", `${key}=${value}`);
    }

    const child = spawn("curl", args, {
      stdio: [ "ignore", "pipe", "pipe" ],
    });

    let stdout = "";
    let settled = false;
    const abortHandler = () => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(buildAbortError());
    };

    const finalize = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener("abort", abortHandler);
      resolve(value);
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      finalize(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finalize(null);
        return;
      }

      try {
        finalize(JSON.parse(stdout));
      } catch {
        finalize(null);
      }
    });
  });
}

function epochNs(minutesAgo = 0) {
  return `${Math.floor((Date.now() - (minutesAgo * 60 * 1000)) * 1_000_000)}`;
}

function buildSearchTerms(incident) {
  const messageTokens = (incident.error?.message ?? "")
    .split(/[^A-Za-z0-9/_.-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 6 && !TERM_STOPWORDS.has(token.toLowerCase()));

  return unique([
    incident.request?.path,
    incident.error?.exceptionName,
    ...messageTokens.slice(0, 2),
    ...(incident.searchTerms ?? []).slice(0, 3),
  ]);
}

function buildSimilarityTerms(incident) {
  const messageTokens = (incident.error?.message ?? "")
    .toLowerCase()
    .split(/[^a-z0-9/_.-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !TERM_STOPWORDS.has(token))
    .slice(0, 2);

  const candidates = [
    incident.request?.path,
    incident.error?.exceptionName,
    ...messageTokens,
    ...(incident.searchTerms ?? []).slice(0, 2),
  ];

  return unique(candidates).slice(0, 3);
}

function buildLogFilterQuery(lokiJob, filters) {
  return filters.reduce(
    (query, filter) => `${query} |= "${escapeLogValue(filter)}"`,
    `{job="${escapeLogValue(lokiJob)}"}`,
  );
}

function simplifyLabels(stream = {}) {
  return [
    stream.container_name ? `container=${stream.container_name}` : null,
    stream.ecs_task_definition ? `task=${stream.ecs_task_definition}` : null,
    stream.source ? `source=${stream.source}` : null,
  ].filter(Boolean).join(", ");
}

async function collectMatchesForTerm(baseUrl, lokiJob, term, lookbackMinutes, curlRunner, signal) {
  const query = buildLogFilterQuery(lokiJob, [ term ]);
  const payload = await runCurl(`${baseUrl}/loki/api/v1/query_range`, {
    query,
    start: epochNs(lookbackMinutes),
    end: epochNs(0),
    limit: String(LINE_LIMIT_PER_QUERY),
    direction: "backward",
  }, curlRunner, signal);

  const matches = [];
  for (const streamResult of payload?.data?.result ?? []) {
    const labelSummary = simplifyLabels(streamResult.stream);
    for (const [ timestamp, line ] of streamResult.values ?? []) {
      matches.push({
        timestamp,
        line,
        labels: labelSummary,
        term,
      });
    }
  }

  return matches;
}

async function countSimilarErrors(baseUrl, lokiJob, filters, lookbackDays, curlRunner, signal) {
  if (!filters.length) {
    return null;
  }

  const logQuery = buildLogFilterQuery(lokiJob, filters);
  const payload = await runCurl(`${baseUrl}/loki/api/v1/query`, {
    query: `sum(count_over_time(${logQuery}[${lookbackDays}d]))`,
    time: epochNs(0),
  }, curlRunner, signal);

  const rawValue = payload?.data?.result?.[0]?.value?.[1];
  if (rawValue == null) {
    return 0;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeSimilarErrors(jobs, lookbackDays, terms) {
  const totalCount = jobs.reduce((sum, job) => sum + (job.similarErrorCount ?? 0), 0);
  const preferredJob = jobs.find((job) => job.stage === "prod") ?? jobs[0] ?? null;

  return {
    count: preferredJob?.similarErrorCount ?? 0,
    totalCount,
    lookbackDays,
    terms,
    stage: preferredJob?.stage ?? null,
    hasPreferredStage: Boolean(preferredJob?.stage === "prod"),
  };
}

function trimMatches(matches) {
  return matches
    .filter((item) => item.line && item.line.trim())
    .slice(0, MAX_LINES_PER_JOB);
}

export async function collectLokiContext(incident, options = {}) {
  const baseUrl = options.baseUrl ?? DEFAULT_LOKI_URL;
  const lookbackMinutes = options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  const similarLookbackDays = options.similarLookbackDays ?? DEFAULT_SIMILAR_LOOKBACK_DAYS;
  const curlRunner = options.curlRunner ?? null;
  const signal = options.signal ?? null;
  const targets = resolveServiceTargets(incident);
  const terms = buildSearchTerms(incident);
  const similarityTerms = buildSimilarityTerms(incident);

  if (targets.length === 0) {
    return {
      promptContext: "",
      jobs: [],
      similarErrorSummary: null,
    };
  }

  const jobs = [];

  for (const target of targets) {
    const lokiJob = target.lokiJob;
    if (!lokiJob) {
      continue;
    }

    const collected = [];
    const seen = new Set();

    for (const term of terms) {
      for (const match of await collectMatchesForTerm(baseUrl, lokiJob, term, lookbackMinutes, curlRunner, signal)) {
        const key = `${match.timestamp}:${match.line}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        collected.push(match);
      }
    }

    jobs.push({
      stage: target.stage,
      lokiJob,
      matches: trimMatches(collected),
      similarErrorCount: await countSimilarErrors(baseUrl, lokiJob, similarityTerms, similarLookbackDays, curlRunner, signal),
    });
  }

  if (jobs.length === 0) {
    return {
      promptContext: "",
      jobs: [],
      similarErrorSummary: null,
    };
  }

  const similarErrorSummary = summarizeSimilarErrors(jobs, similarLookbackDays, similarityTerms);

  const promptContext = [
    "### Loki Runtime Context",
    [
      "### Similar Error History",
      `Recent similar Loki matches in the last ${similarLookbackDays} days: ${similarErrorSummary.count}${similarErrorSummary.stage ? ` (preferred stage: ${similarErrorSummary.stage})` : ""}`,
      `Total similar Loki matches across all stages: ${similarErrorSummary.totalCount}`,
      similarityTerms.length > 0 ? `Match filters: ${similarityTerms.join(", ")}` : null,
    ].filter(Boolean).join("\n"),
    ...jobs.map((job, index) => {
      const lines = [
        `#### Loki Job ${index + 1}`,
        `Stage: ${job.stage}`,
        `Job: ${job.lokiJob}`,
        `Recent similar matches (${similarLookbackDays}d): ${job.similarErrorCount ?? 0}`,
      ];

      if (job.matches.length > 0) {
        lines.push("Matched log lines:");
        for (const match of job.matches) {
          lines.push(`- [term=${match.term}] ${match.labels ? `[${match.labels}] ` : ""}${match.line}`);
        }
      } else {
        lines.push(`No direct Loki log matches found in the last ${lookbackMinutes} minutes.`);
      }

      return lines.join("\n");
    }),
  ].join("\n\n");

  return {
    promptContext,
    jobs,
    similarErrorSummary,
  };
}
