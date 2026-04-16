import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIncidentMessage } from "../src/incident-parser.mjs";
import { runIncidentAnalysis } from "../src/llm-runner.mjs";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "alertnow-news.txt",
);

const fixture = fs.readFileSync(fixturePath, "utf8");

function createAnalysis() {
  return {
    summary: "테스트 요약",
    confidence: "medium",
    likelyCause: "테스트 원인",
    evidence: [ "테스트 근거" ],
    checks: [ "테스트 확인" ],
    immediateActions: [ "테스트 조치" ],
    escalation: "테스트 에스컬레이션",
  };
}

test("runIncidentAnalysis uses codex when provider is codex", async () => {
  const incident = parseIncidentMessage(fixture);
  const contextBundle = {
    promptContext: "local evidence",
    evidence: [],
  };

  const result = await runIncidentAnalysis(incident, contextBundle, {
    provider: "codex",
    resolvedProvider: "codex",
    cwd: "/tmp",
    async runCodex(prompt) {
      assert.match(prompt, /If Codex MCP servers are available/);
      return createAnalysis();
    },
  });

  assert.equal(result.providerUsed, "codex");
  assert.equal(result.analysis.summary, "테스트 요약");
  assert.match(result.prompt, /If Codex MCP servers are available/);
});

test("runIncidentAnalysis does not hide codex failures", async () => {
  const incident = parseIncidentMessage(fixture);
  const contextBundle = {
    promptContext: "local evidence",
    evidence: [],
  };

  await assert.rejects(() => runIncidentAnalysis(incident, contextBundle, {
    provider: "codex",
    resolvedProvider: "codex",
    cwd: "/tmp",
    async runCodex() {
      throw new Error("codex timed out after 900000ms");
    },
  }), /codex timed out after 900000ms/);
});

test("runIncidentAnalysis uses claude when provider is claude", async () => {
  const incident = parseIncidentMessage(fixture);
  const contextBundle = {
    promptContext: "local evidence",
    evidence: [],
  };

  const result = await runIncidentAnalysis(incident, contextBundle, {
    provider: "claude",
    resolvedProvider: "claude",
    cwd: "/tmp",
    async runClaude(prompt) {
      assert.match(prompt, /Use the provided repository evidence as the primary local source context/);
      return createAnalysis();
    },
  });

  assert.equal(result.providerUsed, "claude");
  assert.equal(result.analysis.summary, "테스트 요약");
  assert.match(result.prompt, /Use the provided repository evidence as the primary local source context/);
});

test("runIncidentAnalysis does not hide claude failures", async () => {
  const incident = parseIncidentMessage(fixture);
  const contextBundle = {
    promptContext: "local evidence",
    evidence: [],
  };

  await assert.rejects(() => runIncidentAnalysis(incident, contextBundle, {
    provider: "claude",
    resolvedProvider: "claude",
    cwd: "/tmp",
    async runClaude() {
      throw new Error("claude timed out after 30000ms");
    },
  }), /claude timed out after 30000ms/);
});
