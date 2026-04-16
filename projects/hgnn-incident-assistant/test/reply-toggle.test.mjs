import test from "node:test";
import assert from "node:assert/strict";
import { buildToggleBlocks, DETAIL_TOGGLE_ACTION_ID } from "../src/reply-toggle.mjs";

test("buildToggleBlocks appends expand button for collapsed message", () => {
  const blocks = buildToggleBlocks([
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*요약*\n테스트",
      },
    },
  ]);

  assert.equal(blocks.at(-1).type, "actions");
  assert.equal(blocks.at(-1).elements[0].action_id, DETAIL_TOGGLE_ACTION_ID);
  assert.equal(blocks.at(-1).elements[0].text.text, "상세 보기");
  assert.equal(blocks.at(-1).elements[0].value, "expand");
  assert.equal(blocks.at(-1).elements.length, 1);
});

test("buildToggleBlocks appends collapse button for expanded message", () => {
  const blocks = buildToggleBlocks([], { expanded: true });

  assert.equal(blocks[0].type, "actions");
  assert.equal(blocks[0].elements[0].text.text, "요약 보기");
  assert.equal(blocks[0].elements[0].value, "collapse");
  assert.equal(blocks[0].elements.length, 4);
  assert.deepEqual(
    blocks[0].elements.slice(1).map((item) => item.text.text),
    [ "DB 확인", "캐시/Redis 확인", "외부 API 확인" ],
  );
  assert.deepEqual(
    blocks[0].elements.slice(1).map((item) => item.action_id),
    [ "incident_follow_up_db", "incident_follow_up_cache", "incident_follow_up_external" ],
  );
});
