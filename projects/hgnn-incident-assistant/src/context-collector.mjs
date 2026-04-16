import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { collectAwsContext } from "./aws-context.mjs";
import { collectLokiContext } from "./loki-context.mjs";

function emitProgress(onProgress, stage, payload = {}) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(stage, payload);
}

function buildAbortError() {
  const error = new Error("Context collection aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw buildAbortError();
  }
}

function titleizeVariableName(name) {
  if (!name) {
    return null;
  }

  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

function runRg({ cwd, pattern, globs = [], maxCount = 5, fixed = true, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(buildAbortError());
      return;
    }

    const args = [ "--json", "-n", "-m", String(maxCount) ];

    if (fixed) {
      args.push("-F");
    }

    for (const glob of globs) {
      args.push("-g", glob);
    }

    args.push(pattern, cwd);

    const child = spawn("rg", args, {
      stdio: [ "ignore", "pipe", "pipe" ],
    });
    const abortHandler = () => {
      child.kill("SIGTERM");
      reject(buildAbortError());
    };

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    signal?.addEventListener("abort", abortHandler, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abortHandler);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abortHandler);
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr || `rg failed for pattern: ${pattern}`));
        return;
      }

      const matches = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) {
          continue;
        }

        const payload = JSON.parse(line);
        if (payload.type !== "match") {
          continue;
        }

        matches.push({
          filePath: payload.data.path.text,
          lineNumber: payload.data.line_number,
          lineText: payload.data.lines.text.trimEnd(),
        });
      }

      resolve(matches);
    });
  });
}

function readSnippet(filePath, lineNumber, context = 8) {
  const contents = fs.readFileSync(filePath, "utf8").split("\n");
  const start = Math.max(0, lineNumber - context - 1);
  const end = Math.min(contents.length, lineNumber + context);

  return contents
    .slice(start, end)
    .map((line, index) => {
      const currentLine = start + index + 1;
      return `${String(currentLine).padStart(4, " ")} | ${line}`;
    })
    .join("\n");
}

function addEvidence(evidence, seen, item) {
  const key = `${item.filePath}:${item.lineNumber}:${item.reason}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  evidence.push(item);
}

function routePatternsFromIncident(incident) {
  const patterns = [];
  const requestPath = incident.request.path;
  const method = incident.request.method?.toUpperCase();

  if (requestPath) {
    patterns.push(requestPath);

    const noPrefix = requestPath.replace(/^\/api\/v\d+/, "");
    if (noPrefix && noPrefix !== requestPath) {
      if (noPrefix.split("/").filter(Boolean).length > 1) {
        patterns.push(noPrefix);
      }
      if (method) {
        patterns.push(`@${method[0]}${method.slice(1).toLowerCase()}("${noPrefix}")`);
      }
    }
  }

  return [ ...new Set(patterns.filter(Boolean)) ];
}

function parseControllerCalls(snippet) {
  return [ ...snippet.matchAll(/this\.(\w+)\.(\w+)\(/g) ].map((match) => ({
    propertyName: match[1],
    methodName: match[2],
  }));
}

function parseServiceRepositoryCalls(snippet) {
  return [ ...snippet.matchAll(/this\.(\w+Repository)\.(\w+)\(/g) ].map((match) => ({
    propertyName: match[1],
    methodName: match[2],
  }));
}

async function findClassDefinition(repoRoot, className, globs, signal) {
  const matches = await runRg({
    cwd: repoRoot,
    pattern: `class ${className}`,
    globs,
    maxCount: 2,
    fixed: true,
    signal,
  });

  return matches[0] ?? null;
}

async function enrichMethodSnippet(filePath, methodName, signal) {
  const matches = await runRg({
    cwd: filePath,
    pattern: `${methodName}(`,
    globs: [],
    maxCount: 1,
    fixed: true,
    signal,
  });

  if (matches[0]) {
    return {
      ...matches[0],
      filePath,
      snippet: readSnippet(filePath, matches[0].lineNumber, 12),
    };
  }

  return null;
}

function searchKeywordHits(repoRoot, keyword, signal) {
  return runRg({
    cwd: repoRoot,
    pattern: keyword,
    globs: [ "**/*.ts", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.py", "**/*.md", "**/*.json", "**/*.yml", "**/*.yaml" ],
    maxCount: 2,
    fixed: true,
    signal,
  });
}

function trimEvidence(evidence, maxChars) {
  const scored = [ ...evidence ].sort((left, right) => scoreEvidence(right) - scoreEvidence(left));
  const trimmed = [];
  let total = 0;

  for (const item of scored) {
    const block = [
      `FILE: ${item.filePath}:${item.lineNumber}`,
      `REASON: ${item.reason}`,
      item.snippet,
    ].join("\n");

    if (total + block.length > maxChars) {
      break;
    }

    trimmed.push(item);
    total += block.length;
  }

  return trimmed;
}

function scoreEvidence(item) {
  if (item.filePath.includes("/test/") || item.filePath.includes(".spec.")) {
    return -100;
  }
  if (item.reason.startsWith("Service call ")) {
    return 100;
  }
  if (item.reason.startsWith("Repository call ")) {
    return 95;
  }
  if (item.filePath.includes("/controllers/")) {
    return 50;
  }
  if (item.filePath.includes("/services/")) {
    return 40;
  }
  if (item.filePath.includes("/repositories/")) {
    return 30;
  }
  if (item.filePath.includes("/core/exception/")) {
    return 20;
  }
  if (item.filePath.endsWith(".md")) {
    return 10;
  }
  if (item.reason.startsWith("Keyword hit ")) {
    return 5;
  }
  return 0;
}

export async function collectRepositoryContext(incident, options = {}) {
  const repoRoots = options.repoRoots ?? [];
  const maxChars = options.maxContextChars ?? 24000;
  const onProgress = options.onProgress;
  const signal = options.signal;
  const evidence = [];
  const seen = new Set();
  throwIfAborted(signal);
  emitProgress(onProgress, "context-aws-start");
  const awsContext = await collectAwsContext(incident, {
    ...(options.awsOptions ?? {}),
    timeoutMs: options.awsTimeoutMs ?? options.awsOptions?.timeoutMs,
    signal,
  });
  throwIfAborted(signal);
  emitProgress(onProgress, "context-aws-finish", {
    awsServiceCount: awsContext.services.length,
  });
  emitProgress(onProgress, "context-loki-start");
  const lokiContext = await collectLokiContext(incident, {
    ...(options.lokiOptions ?? {}),
    signal,
  });
  throwIfAborted(signal);
  emitProgress(onProgress, "context-loki-finish", {
    lokiJobCount: lokiContext.jobs.length,
    similarErrorCount: lokiContext.similarErrorSummary?.count ?? null,
  });

  for (const repoRoot of repoRoots) {
    throwIfAborted(signal);
    emitProgress(onProgress, "context-repo-start", {
      repoRoot,
      evidenceCount: evidence.length,
    });
    for (const pattern of routePatternsFromIncident(incident)) {
      const routeHits = runRg({
        cwd: repoRoot,
        pattern,
        globs: [ "**/controllers/**/*.ts", "**/docs/**/*.md" ],
        maxCount: 4,
        fixed: true,
        signal,
      });
      const resolvedRouteHits = await routeHits;

      for (const hit of resolvedRouteHits) {
        const snippet = readSnippet(hit.filePath, hit.lineNumber, 20);
        addEvidence(evidence, seen, {
          ...hit,
          snippet,
          reason: `Route or endpoint match for ${pattern}`,
        });

        if (!hit.filePath.endsWith(".ts")) {
          continue;
        }

        for (const call of parseControllerCalls(snippet)) {
          const className = titleizeVariableName(call.propertyName);
          const serviceHit = await findClassDefinition(repoRoot, className, [ "**/services/**/*.ts" ], signal);

          if (!serviceHit) {
            continue;
          }

          const serviceSnippet = await enrichMethodSnippet(serviceHit.filePath, call.methodName, signal) ?? {
            ...serviceHit,
            snippet: readSnippet(serviceHit.filePath, serviceHit.lineNumber, 12),
          };

          addEvidence(evidence, seen, {
            ...serviceSnippet,
            reason: `Service call ${className}.${call.methodName}`,
          });

          for (const repoCall of parseServiceRepositoryCalls(serviceSnippet.snippet)) {
            const repositoryClass = titleizeVariableName(repoCall.propertyName);
            const repositoryHit = await findClassDefinition(repoRoot, repositoryClass, [ "**/repositories/**/*.ts" ], signal);

            if (!repositoryHit) {
              continue;
            }

            const repositorySnippet = await enrichMethodSnippet(repositoryHit.filePath, repoCall.methodName, signal) ?? {
              ...repositoryHit,
              snippet: readSnippet(repositoryHit.filePath, repositoryHit.lineNumber, 12),
            };

            addEvidence(evidence, seen, {
              ...repositorySnippet,
              reason: `Repository call ${repositoryClass}.${repoCall.methodName}`,
            });
          }
        }
      }
    }

    for (const keyword of [
      ...incident.searchTerms,
      incident.error.exceptionName,
      incident.error.message,
      "UnknownExceptionFilter",
    ].filter(Boolean)) {
      throwIfAborted(signal);
      const keywordHits = await searchKeywordHits(repoRoot, keyword, signal);
      for (const hit of keywordHits) {
        addEvidence(evidence, seen, {
          ...hit,
          snippet: readSnippet(hit.filePath, hit.lineNumber, 8),
          reason: `Keyword hit for "${keyword}"`,
        });
      }
    }

    emitProgress(onProgress, "context-repo-finish", {
      repoRoot,
      evidenceCount: evidence.length,
    });
  }

  const trimmed = trimEvidence(evidence, maxChars);

  return {
    repoRoots,
    evidence: trimmed,
    awsContext,
    lokiContext,
    promptContext: [
      trimmed.map((item, index) => {
      const relativePath = repoRoots
        .map((root) => path.relative(root, item.filePath))
        .find((relative) => !relative.startsWith("..")) ?? item.filePath;

      return [
        `### Evidence ${index + 1}`,
        `File: ${relativePath}:${item.lineNumber}`,
        `Reason: ${item.reason}`,
        item.snippet,
      ].join("\n");
      }).join("\n\n"),
      awsContext.promptContext,
      lokiContext.promptContext,
    ].filter(Boolean).join("\n\n"),
  };
}
