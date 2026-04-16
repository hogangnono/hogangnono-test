import test from "node:test";
import assert from "node:assert/strict";
import { formatSlackReplyMessages } from "../src/formatter.mjs";

test("formatSlackReplyMessages returns full detail blocks without interactive toggle", () => {
  const incident = {
    incidentId: "66351",
    incidentSlug: "hogangnono-api-v2-status-error",
    serviceLabel: "Hogangnono Application Alert",
    request: { method: "GET", path: "/api/v2/news" },
    error: { recentCount5m: 469 },
  };
  const analysis = {
    summary: "뉴스 조회 중 DB 연결이 끊긴 것으로 보입니다.",
    confidence: "medium",
    likelyCause: "읽기 DB 연결 손실",
    evidence: [ "NewsController -> NewsService -> NewsRepository 경로 확인", "에러 본문에 Connection lost 포함" ],
    checks: [ "RDS 이벤트 확인", "앱 로그 확인" ],
    immediateActions: [ "읽기 DB 상태 확인", "재발 시 재시도 검토" ],
    escalation: "DB 인프라 확인 필요",
  };
  const contextBundle = {
    evidence: [
      { filePath: "/workspace/hgnn/hogangnono-api/packages/api/src/services/NewsService.ts", lineNumber: 27 },
    ],
    repoRoots: [ "/workspace/hgnn/hogangnono-api" ],
    lokiContext: {
      similarErrorSummary: {
        count: 17,
        lookbackDays: 30,
      },
    },
  };

  const result = formatSlackReplyMessages(incident, analysis, contextBundle);

  assert.match(result.summaryText, /\*장애 분석\*/);
  assert.match(result.summaryText, /\*요약\*/);
  assert.doesNotMatch(result.summaryText, /\*원인 가설\*/);
  assert.doesNotMatch(result.summaryText, /\*즉시 조치\*/);
  assert.match(result.summaryText, /#66351 · GET \/api\/v2\/news · 중간 · 5분 469건 · 30일 17건/);
  assert.match(result.detailText, /\*상세 분석\*/);
  assert.match(result.detailText, /\*원인 가설\*/);
  assert.match(result.detailText, /\*반복 추이\*/);
  assert.match(result.detailText, /최근 30일 유사 17건/);
  assert.match(result.detailText, /\*에스컬레이션\*/);
  assert.match(result.detailText, /\*참고 파일\*/);
  assert.match(result.fullDetailText, /## 메타/);
  assert.match(result.fullDetailText, /## 반복 추이/);
  assert.match(result.fullDetailText, /## 근거/);
  assert.equal(result.summaryBlocks[0].type, "header");
  assert.match(result.summaryBlocks[0].text.text, /상세 분석:/);
  assert.ok(result.summaryBlocks.some((block) => block.type === "divider"));
  assert.ok(result.summaryBlocks.some((block) => block.type === "context" && block.elements?.[0]?.text.includes("#66351")));
  assert.ok(result.summaryBlocks.some((block) => block.type === "section" && block.text?.text.includes("*요약*")));
  assert.ok(result.detailBlocks.some((block) => block.type === "section" && block.text?.text.includes("*핵심 근거*")));
  assert.ok(result.detailBlocks.some((block) => block.type === "section" && block.text?.text.includes("*참고 파일*")));
  assert.ok(result.detailBlocks.every((block) => block.type !== "actions"));
  assert.ok(result.detailBlocks.some((block) => block.type === "section" && block.expand === false));
  assert.equal(result.detailFile.filename, "hogangnono-api-v2-status-error-analysis.md");
});
