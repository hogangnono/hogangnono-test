import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectRepositoryContext } from "../src/context-collector.mjs";
import { isAlertNotificationWithoutDetails, isLikelyAlertIncident, parseIncidentMessage } from "../src/incident-parser.mjs";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "alertnow-news.txt",
);
const fixtureRepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "repos",
);
const apiRepoRoot = path.join(fixtureRepoRoot, "hogangnono-api");
const botRepoRoot = path.join(fixtureRepoRoot, "hogangnono-bot");

const fixture = fs.readFileSync(fixturePath, "utf8");

test("parseIncidentMessage extracts core incident details", () => {
  const incident = parseIncidentMessage(fixture);

  assert.equal(isLikelyAlertIncident(fixture), true);
  assert.equal(incident.incidentId, "66351");
  assert.equal(incident.incidentSlug, "hogangnono-api-v2-status-error");
  assert.equal(incident.request.method, "GET");
  assert.equal(incident.request.path, "/api/v2/news");
  assert.equal(incident.error.statusCode, 500);
  assert.equal(incident.error.exceptionName, "UnknownExceptionFilter");
  assert.match(incident.error.message, /Connection lost/);
  assert.equal(incident.similarityFingerprint, "GET:/api/v2/news:UnknownExceptionFilter:_connection:lost");
});

test("creation-style batch alerts are also recognized", async () => {
  const sample = [
    "AlertNow",
    "",
    "인시던트가 생성되었습니다.생성 #66367: hogangnono-batch-legacy-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 1 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "[crawling-reconstruction-apt-gyeonggi] crawling-reconstruction-apt-gyeonggi배치 에러담당자:서비스: Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(isLikelyAlertIncident(sample), true);
  assert.equal(incident.incidentId, "66367");
  assert.equal(incident.incidentSlug, "hogangnono-batch-legacy-status-error");
  assert.equal(incident.error.exceptionName, "crawling-reconstruction-apt-gyeonggi");
  assert.match(incident.error.message, /crawling-reconstruction-apt-gyeonggi배치 에러/);
  assert.ok(incident.searchTerms.includes("crawling-reconstruction-apt-gyeonggi"));
  assert.ok(incident.searchTerms.includes("batch"));
});

test("service label drops broken opsnow redirect links", () => {
  const sample = [
    "AlertNow",
    "",
    "담당자 지정됨 #66849: hogangnono-legacy-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 163 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "담당자: 김준연",
    "서비스: <https://sso.an.opsnow.com/realms/BESPIN/protocol/openid-connect/auth?client_id=platform_web&redirect_uri=https%3A%2F%2Falertnow.opsnow.com%2Fservice%2Fdetail%2F%25257Bfoo|Hogangnono Application Alert>",
    "지정된 사용자: 김준연 | 2026-03-23 오후 1:36:40",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(incident.serviceLabel, "Hogangnono Application Alert");
});

test("assignee alerts with stack detail are recognized as actionable incidents", () => {
  const sample = [
    "AlertNow",
    "",
    "Mason Choi 님이 담당자로 지정되었습니다.",
    "*담당자 지정됨 <https://alertnow.opsnow.com/incident/incident/foo|#67116>:* hogangnono-api-v2-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 34 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "[UnknownExceptionFilter] Cannot read properties of undefined (reading 'get'),",
    "status: 500,",
    "request: {",
    "  \"url\": \"/api/v2/apts/gwT16/agents\",",
    "  \"method\": \"GET\"",
    "}",
    "담당자: Mason Choi",
    "서비스: Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(isLikelyAlertIncident(sample), true);
  assert.equal(incident.incidentId, "67116");
  assert.equal(incident.request.path, "/api/v2/apts/gwT16/agents");
  assert.equal(incident.error.statusCode, 500);
  assert.match(incident.error.message, /Cannot read properties of undefined/);
});

test("escalation-only alerts without detail are ignored", () => {
  const sample = [
    "AlertNow",
    "",
    "인시던트 알림이 확대 되었습니다.",
    "- 에스컬레이션 실행 : 1 회, 단계 1 → 1 회, 단계 2 (편집됨) 에스컬레이션됨 #66367: hogangnono-batch-legacy-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 1 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "담당자:서비스: Hogangnono Application Alert에스컬레이션: 호갱노노팀_에스컬레이션 | 2026-03-16 오전 11:42:02",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(isLikelyAlertIncident(sample), false);
  assert.equal(incident.hasActionableDetails, false);
  assert.equal(incident.error.message, null);
});

test("creation alerts without detail are marked as waiting for details", () => {
  const sample = [
    "인시던트가 생성되었습니다.생성 #66568: hogangnono-api-v2-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 1 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "담당자:서비스: Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(isLikelyAlertIncident(sample), false);
  assert.equal(isAlertNotificationWithoutDetails(sample), true);
  assert.equal(incident.incidentId, "66568");
  assert.equal(incident.incidentSlug, "hogangnono-api-v2-status-error");
  assert.equal(incident.hasActionableDetails, false);
});

test("detailed escalation alerts are recognized", () => {
  const sample = [
    "인시던트 알림이 확대 되었습니다.",
    "*에스컬레이션됨 <https://alertnow.opsnow.com/incident/incident/foo|#66367>:* hogangnono-batch-legacy-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 1 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "[crawling-reconstruction-apt-gyeonggi] _crawling-reconstruction-apt-gyeonggi배치 에러_",
    "*담당자:*",
    "*서비스:* Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(isLikelyAlertIncident(sample), true);
  assert.equal(incident.incidentType, "에스컬레이션됨");
  assert.equal(incident.incidentSlug, "hogangnono-batch-legacy-status-error");
  assert.match(incident.error.message, /crawling-reconstruction-apt-gyeonggi배치 에러/);
});

test("collectRepositoryContext finds matching news flow code", async () => {
  const incident = parseIncidentMessage(fixture);
  const contextBundle = await collectRepositoryContext(incident, {
    repoRoots: [ apiRepoRoot ],
    maxContextChars: 20000,
    awsOptions: { awsCli: () => null },
    lokiOptions: { curlRunner: () => null },
  });

  const files = contextBundle.evidence.map((item) => item.filePath);

  assert.ok(files.some((filePath) => filePath.endsWith("NewsController.ts")));
  assert.ok(files.some((filePath) => filePath.endsWith("NewsService.ts")));
  assert.ok(files.some((filePath) => filePath.endsWith("NewsRepository.ts")));
});

test("collectRepositoryContext can find batch job references in js sources", async () => {
  const sample = [
    "AlertNow",
    "",
    "인시던트가 생성되었습니다.생성 #66367: hogangnono-batch-legacy-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 1 개의 에러가 발생했습니다.",
    "",
    "stack:",
    "",
    "[crawling-reconstruction-apt-gyeonggi] crawling-reconstruction-apt-gyeonggi배치 에러담당자:서비스: Hogangnono Application Alert",
  ].join("\n");
  const incident = parseIncidentMessage(sample);
  const contextBundle = await collectRepositoryContext(incident, {
    repoRoots: [ botRepoRoot ],
    maxContextChars: 20000,
    awsOptions: { awsCli: () => null },
    lokiOptions: { curlRunner: () => null },
  });

  const files = contextBundle.evidence.map((item) => item.filePath);

  assert.ok(files.some((filePath) => filePath.endsWith("task/reconstruction.js")));
});

test("parseIncidentMessage extracts recent 5 minute error count", () => {
  const sample = [
    "인시던트가 생성되었습니다.",
    "생성 #67045: hogangnono-api-v2-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 469 개의 에러가 발생했습니다.",
    "stack:",
    "",
    "담당자:",
    "서비스: Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.equal(incident.error.recentCount5m, 469);
});

test("parseIncidentMessage compacts repeated stack lines", () => {
  const repeated = Array.from({ length: 20 }, () => "[CacheRedisService] SCAN 반복 횟수 초과 (prefix: NotiCenterCache:1:, maxIterations: 1000)").join("\n");
  const sample = [
    "인시던트의 상태가 변경되었습니다.",
    "확인 #67045: hogangnono-api-v2-status-error 가 에러 상태로 들어갔습니다.",
    "최근 5분 동안 469 개의 에러가 발생했습니다.",
    "stack:",
    repeated,
    "담당자:",
    "서비스: Hogangnono Application Alert",
  ].join("\n");

  const incident = parseIncidentMessage(sample);

  assert.match(incident.normalizedText, /동일 패턴 19건 추가/);
});
