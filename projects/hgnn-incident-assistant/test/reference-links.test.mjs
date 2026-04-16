import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildReferenceLink } from "../src/reference-links.mjs";

test("buildReferenceLink uses master branch for GitHub references", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "incident-assistant-reference-"));
  const filePath = path.join(repoRoot, "packages", "cas-api", "src", "iros", "controllers", "RegEventController.ts");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export class RegEventController {}\n", "utf8");

  const initResult = spawnSync("git", [ "-C", repoRoot, "init" ], { encoding: "utf8" });
  assert.equal(initResult.status, 0, initResult.stderr);

  const remoteResult = spawnSync(
    "git",
    [ "-C", repoRoot, "remote", "add", "origin", "git@github.com:hogangnono/hogangnono-api.git" ],
    { encoding: "utf8" },
  );
  assert.equal(remoteResult.status, 0, remoteResult.stderr);

  const link = buildReferenceLink(filePath, 4, [ repoRoot ]);
  const repoName = path.basename(repoRoot);

  assert.equal(
    link,
    `<https://github.com/hogangnono/hogangnono-api/blob/master/packages/cas-api/src/iros/controllers/RegEventController.ts#L4|${repoName}/packages/cas-api/src/iros/controllers/RegEventController.ts:4>`,
  );
});
