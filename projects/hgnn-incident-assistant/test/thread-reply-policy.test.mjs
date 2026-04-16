import test from "node:test";
import assert from "node:assert/strict";
import { decideThreadReplyHandling } from "../src/thread-reply-policy.mjs";

test("decideThreadReplyHandling skips non-empty thread in strict scan mode", () => {
  const decision = decideThreadReplyHandling({
    replyCount: 1,
    hasAssistantFinalReply: false,
    hasAssistantWaitingReply: false,
    hasAssistantFailureReply: false,
    reusableAssistantReplyTs: null,
    hasHumanReply: false,
  }, {
    pendingReason: null,
  }, {
    allowReusableAssistantReply: false,
  });

  assert.deepEqual(decision, {
    shouldSkip: true,
    reusableAssistantReplyTs: null,
  });
});

test("decideThreadReplyHandling reuses waiting assistant reply during recovery", () => {
  const decision = decideThreadReplyHandling({
    replyCount: 1,
    hasAssistantFinalReply: false,
    hasAssistantWaitingReply: true,
    hasAssistantFailureReply: false,
    reusableAssistantReplyTs: "1710000000.000100",
    hasHumanReply: false,
  }, {
    pendingReason: null,
  }, {
    allowReusableAssistantReply: true,
  });

  assert.deepEqual(decision, {
    shouldSkip: false,
    reusableAssistantReplyTs: "1710000000.000100",
  });
});
