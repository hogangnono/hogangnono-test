import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProcessedSourceKeys,
  loadReplyToggleStates,
  saveProcessedSourceKeys,
  saveReplyToggleStates,
} from "../src/state-store.mjs";

test("state store preserves processed keys and reply toggle states together", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "incident-assistant-state-"));
  const stateFile = path.join(tempDir, "state.json");
  const processedSourceKeys = new Set([ "C1:111.222" ]);
  const replyToggleStates = new Map([
    [
      "C1:333.444",
      {
        summaryText: "summary",
        detailText: "detail",
        summaryBlocks: [ { type: "section" } ],
        detailBlocks: [ { type: "section" } ],
      },
    ],
  ]);

  saveProcessedSourceKeys(stateFile, processedSourceKeys);
  saveReplyToggleStates(stateFile, replyToggleStates);

  const loadedProcessedSourceKeys = loadProcessedSourceKeys(stateFile);
  const loadedReplyToggleStates = loadReplyToggleStates(stateFile);

  assert.deepEqual(Array.from(loadedProcessedSourceKeys), [ "C1:111.222" ]);
  assert.deepEqual(loadedReplyToggleStates.get("C1:333.444"), {
    summaryText: "summary",
    detailText: "detail",
    summaryBlocks: [ { type: "section" } ],
    detailBlocks: [ { type: "section" } ],
  });
});
