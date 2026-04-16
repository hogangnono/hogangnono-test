import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { sanitizeSensitiveText } from "./privacy.mjs";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: [ "low", "medium", "high" ] },
    likelyCause: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
    checks: {
      type: "array",
      items: { type: "string" },
    },
    immediateActions: {
      type: "array",
      items: { type: "string" },
    },
    escalation: { type: "string" },
  },
  required: [ "summary", "confidence", "likelyCause", "evidence", "checks", "immediateActions", "escalation" ],
};

function stripCodeFences(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

function parseStructuredOutput(value) {
  if (!value) {
    throw new Error("Empty model output");
  }

  const normalized = stripCodeFences(value);
  const parsed = JSON.parse(normalized);

  if (parsed?.structured_output) {
    return parsed.structured_output;
  }

  if (parsed?.result && typeof parsed.result === "string") {
    return JSON.parse(stripCodeFences(parsed.result));
  }

  if (parsed?.assistant_response && typeof parsed.assistant_response === "string") {
    return JSON.parse(stripCodeFences(parsed.assistant_response));
  }

  return parsed;
}

function commandExists(command) {
  const result = spawnSync("zsh", [ "-lc", `command -v ${command}` ], {
    encoding: "utf8",
  });

  return result.status === 0 && result.stdout.trim().length > 0;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { input = null, timeoutMs = 0, ...spawnOptions } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: [ "pipe", "pipe", "pipe" ],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutHandle = timeoutMs > 0
      ? setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs)
      : null;

    const clearTimeoutHandle = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeoutHandle();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeoutHandle();
      resolve({
        status: code ?? 0,
        stdout,
        stderr,
      });
    });

    if (input != null) {
      child.stdin?.write(input);
    }
    child.stdin?.end();
  });
}

function isAuthenticationFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  return normalized.includes("failed to authenticate")
    || normalized.includes("authentication_error")
    || normalized.includes("invalid authentication credentials")
    || normalized.includes("invalid api key");
}

function hasCodexMcpConnection() {
  if (!commandExists("codex")) {
    return false;
  }

  const result = spawnSync("codex", [ "mcp", "list" ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });

  if (result.status !== 0) {
    return false;
  }

  return result.stdout
    .split("\n")
    .some((line) => line.includes("enabled") && !line.startsWith("Name"));
}

export function resolveAnalysisProvider(preferredProvider = "claude", options = {}) {
  const preferCodexMcp = options.preferCodexMcp ?? true;

  if (preferredProvider === "mock") {
    return "mock";
  }

  if (preferCodexMcp && hasCodexMcpConnection()) {
    return "codex";
  }

  return preferredProvider;
}

export function buildPrompt(incident, contextBundle, options = {}) {
  const provider = options.provider ?? "claude";
  return [
    "You are an incident analysis assistant for Hogangnono.",
    "Respond only with valid JSON matching the provided schema.",
    "Be conservative. Separate evidence from inference.",
    "If the repository evidence is thin, say so directly.",
    "Never include personal data or secrets in the answer. Redact or omit names, emails, phone numbers, IPs, tokens, auth headers, cookies, and user identifiers.",
    provider === "codex"
      ? "If Codex MCP servers are available, use MCP/codebase tools first and treat the provided repository evidence as fallback context."
      : "Use the provided repository evidence as the primary local source context.",
    "",
    "Incident summary:",
    sanitizeSensitiveText(JSON.stringify({
      incidentId: incident.incidentId,
      incidentSlug: incident.incidentSlug,
      serviceLabel: incident.serviceLabel,
      request: incident.request,
      error: incident.error,
    }, null, 2)),
    "",
    "Raw incident text:",
    sanitizeSensitiveText(incident.normalizedText),
    "",
    "Repository evidence:",
    sanitizeSensitiveText(contextBundle.promptContext || "No local repository evidence found."),
    "",
    "Return concise Korean text in all string fields.",
  ].join("\n");
}

async function runClaude(prompt, cwd, timeoutMs) {
  const result = await runCommand("claude", [
    "-p",
    prompt,
    "--tools",
    "",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(ANALYSIS_SCHEMA),
    "--no-session-persistence",
  ], {
    cwd,
    timeoutMs,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "claude execution failed");
  }

  return parseStructuredOutput(result.stdout);
}

async function runCodex(prompt, cwd, timeoutMs) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "incident-assistant-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "output.json");

  fs.writeFileSync(schemaPath, JSON.stringify(ANALYSIS_SCHEMA), "utf8");

  const result = await runCommand("codex", [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    cwd,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-",
  ], {
    cwd,
    input: prompt,
    timeoutMs,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "codex execution failed");
  }

  return parseStructuredOutput(fs.readFileSync(outputPath, "utf8"));
}

function runMock(contextBundle) {
  const files = [ ...new Set(
    contextBundle.evidence
      .map((item) => item.filePath.split("/").at(-1)),
  ) ].slice(0, 3);
  return {
    summary: "news 조회 중 DB 연결이 끊기며 TypeORM 쿼리가 실패한 것으로 보입니다.",
    confidence: "medium",
    likelyCause: "NewsService 경로에서 실행한 MySQL 쿼리 중 연결 단절이 발생했고, 예외가 상위에서 처리되지 않아 UnknownExceptionFilter까지 전파됐을 가능성이 큽니다.",
    evidence: [
      "GET /api/v2/news 경로가 NewsController -> NewsService.getNewsList -> NewsRepository로 이어집니다.",
      "샘플 에러 본문에 QueryFailedError: Connection lost 가 직접 포함되어 있습니다.",
      files.length > 0 ? `로컬 코드 근거 파일: ${files.join(", ")}` : "로컬 코드 근거 파일을 찾지 못했습니다.",
    ],
    checks: [
      "애플리케이션 로그에서 NewsRepository.findHeadlineNewsMaxPusublisedAt 또는 findNewsBeforePublishedAt 직전/직후 에러를 확인합니다.",
      "DB 커넥션 풀 고갈, RDS failover, idle timeout, proxy 연결 종료 여부를 확인합니다.",
      "같은 시각 다른 read query 에서도 Connection lost 가 발생했는지 확인합니다.",
    ],
    immediateActions: [
      "동시간대 DB 상태와 failover 이벤트를 확인합니다.",
      "재현 시점 request volume 과 connection pool 사용량을 같이 봅니다.",
      "반복 발생하면 pool / timeout 설정과 DB 네트워크 상태를 점검합니다.",
    ],
    escalation: "DB 인프라 이상 징후가 함께 보이면 플랫폼 또는 DBA 확인이 필요합니다.",
  };
}

export async function runIncidentAnalysis(incident, contextBundle, options = {}) {
  const provider = options.provider ?? "claude";
  const cwd = options.cwd ?? process.cwd();
  const llmTimeoutMs = options.llmTimeoutMs ?? 180000;
  const providerUsed = options.resolvedProvider ?? resolveAnalysisProvider(provider, options);
  const prompt = buildPrompt(incident, contextBundle, { provider: providerUsed });
  const claudeRunner = options.runClaude ?? runClaude;
  const codexRunner = options.runCodex ?? runCodex;

  if (providerUsed === "mock") {
    return {
      analysis: runMock(contextBundle),
      providerUsed,
      prompt,
    };
  }

  if (providerUsed === "codex") {
    return {
      analysis: await codexRunner(prompt, cwd, llmTimeoutMs),
      providerUsed,
      prompt,
    };
  }

  const claudePrompt = buildPrompt(incident, contextBundle, { provider: "claude" });

  return {
    analysis: await claudeRunner(claudePrompt, cwd, llmTimeoutMs),
    providerUsed: "claude",
    prompt: claudePrompt,
  };
}
