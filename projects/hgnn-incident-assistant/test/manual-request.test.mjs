import test from "node:test";
import assert from "node:assert/strict";
import { parseManualAnalyzeRequest } from "../src/manual-request.mjs";

test("parseManualAnalyzeRequest recognizes analyze command with direct mention", () => {
  const result = parseManualAnalyzeRequest("<@U123> 분석해줘", {
    assistantUserId: "U123",
    assistantBotName: "hgnn-incident-assistant",
  });

  assert.deepEqual(result, {
    command: "analyze",
    force: false,
  });
});

test("parseManualAnalyzeRequest recognizes force reanalyze command by bot name", () => {
  const result = parseManualAnalyzeRequest("@hgnn-incident-assistant 다시분석", {
    assistantUserId: "U123",
    assistantBotName: "hgnn-incident-assistant",
  });

  assert.deepEqual(result, {
    command: "reanalyze",
    force: true,
  });
});

test("parseManualAnalyzeRequest ignores unrelated text", () => {
  const result = parseManualAnalyzeRequest("분석해줘", {
    assistantUserId: "U123",
    assistantBotName: "hgnn-incident-assistant",
  });

  assert.equal(result, null);
});
