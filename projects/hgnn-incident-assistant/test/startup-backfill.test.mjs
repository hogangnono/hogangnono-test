import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStartupBackfillOldest,
  resolveStartupBackfillLookbackHours,
  selectMostRecentMessages,
  selectStartupBackfillMessages,
} from "../src/startup-backfill.mjs";

test("buildStartupBackfillOldest returns Slack oldest timestamp from lookback hours", () => {
  const oldest = buildStartupBackfillOldest(72, new Date("2026-03-19T12:00:00Z"));
  assert.equal(oldest, "1773662400.000000");
});

test("resolveStartupBackfillLookbackHours extends Monday startup scans to include weekend backlog", () => {
  const effectiveHours = resolveStartupBackfillLookbackHours(
    24,
    new Date("2026-03-23T12:00:00+09:00"),
    { includeWeekendOnMonday: true },
  );

  assert.equal(effectiveHours, 72);
});

test("buildStartupBackfillOldest matches a 72 hour window on Monday startup even when configured smaller", () => {
  const mondayNoon = new Date("2026-03-23T12:00:00+09:00");
  const oldest = buildStartupBackfillOldest(24, mondayNoon, { includeWeekendOnMonday: true });

  assert.equal(oldest, buildStartupBackfillOldest(72, mondayNoon));
});

test("resolveStartupBackfillLookbackHours keeps configured hours on non-Monday startup", () => {
  const effectiveHours = resolveStartupBackfillLookbackHours(
    24,
    new Date("2026-03-24T12:00:00+09:00"),
    { includeWeekendOnMonday: true },
  );

  assert.equal(effectiveHours, 24);
});

test("selectStartupBackfillMessages keeps only root messages and sorts oldest first", () => {
  const messages = selectStartupBackfillMessages([
    { ts: "200.3", thread_ts: "200.1", text: "thread detail" },
    { ts: "200.2", text: "second root" },
    { ts: "200.1", text: "first root" },
  ], "C123");

  assert.deepEqual(messages.map((message) => message.ts), [ "200.1", "200.2" ]);
  assert.equal(messages[0].channel, "C123");
});

test("selectMostRecentMessages returns latest roots first up to limit", () => {
  const messages = selectStartupBackfillMessages([
    { ts: "200.4", text: "fourth root" },
    { ts: "200.3", text: "third root" },
    { ts: "200.2", text: "second root" },
    { ts: "200.1", text: "first root" },
  ], "C123");

  const recent = selectMostRecentMessages(messages, 2);

  assert.deepEqual(recent.map((message) => message.ts), [ "200.4", "200.3" ]);
});
