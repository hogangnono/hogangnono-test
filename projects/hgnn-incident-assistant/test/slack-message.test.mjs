import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyAlertIncident, parseIncidentMessage } from "../src/incident-parser.mjs";
import {
  buildConversationText,
  buildMessageText,
  normalizeMessageEvent,
  selectSourceThreadMessages,
} from "../src/slack-message.mjs";

test("buildMessageText extracts text from blocks, attachments, and file previews", () => {
  const text = buildMessageText({
    text: "root text",
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: "block detail" },
            ],
          },
        ],
      },
    ],
    attachments: [
      {
        pretext: "attachment pretext",
        fields: [
          { title: "field title", value: "field value" },
        ],
      },
    ],
    files: [
      {
        title: "stack.txt",
        preview_plain_text: "QueryFailedError: Connection lost",
      },
    ],
  });

  assert.match(text, /root text/);
  assert.match(text, /block detail/);
  assert.match(text, /attachment pretext/);
  assert.match(text, /field title/);
  assert.match(text, /field value/);
  assert.match(text, /stack\.txt/);
  assert.match(text, /Connection lost/);
});

test("selectSourceThreadMessages keeps only root and same-source bot replies", () => {
  const rootMessage = {
    ts: "100.1",
    botId: "B123",
    botProfileName: "AlertNow",
  };
  const selected = selectSourceThreadMessages([
    rootMessage,
    { ts: "100.2", botId: "B123", botProfileName: "AlertNow" },
    { ts: "100.3", botProfileName: "hgnn-incident-assistant" },
    { ts: "100.4", user: "U123" },
  ], rootMessage, "AlertNow");

  assert.deepEqual(selected.map((message) => message.ts), [ "100.1", "100.2" ]);
});

test("buildConversationText de-duplicates repeated thread content", () => {
  const text = buildConversationText([
    { text: "same text" },
    { text: "same text" },
    { text: "new detail" },
  ]);

  assert.equal(text, "same text\n\nnew detail");
});

test("normalizeMessageEvent uses edited message payload", () => {
  const normalized = normalizeMessageEvent({
    channel: "C123",
    subtype: "message_changed",
    message: {
      ts: "100.1",
      text: "edited text",
      thread_ts: "100.1",
      username: "AlertNow",
    },
  });

  assert.equal(normalized.text, "edited text");
  assert.equal(normalized.subtype, "message_changed");
  assert.equal(normalized.botProfileName, "AlertNow");
});

test("root alert plus AlertNow thread detail becomes actionable incident text", () => {
  const combinedText = buildConversationText([
    {
      text: [
        "인시던트가 생성되었습니다.생성 #66568: hogangnono-api-v2-status-error 가 에러 상태로 들어갔습니다.",
        "최근 5분 동안 1 개의 에러가 발생했습니다.",
        "",
        "stack:",
        "",
        "담당자:서비스: Hogangnono Application Alert",
      ].join("\n"),
    },
    {
      text: [
        "[UnknownExceptionFilter] Connection lost: The server closed the connection.",
        "status: 500,",
        "request: {",
        "  \"url\": \"/api/v2/news?isScrapOnly=false\",",
        "  \"method\": \"GET\"",
        "}",
      ].join("\n"),
    },
  ]);

  const incident = parseIncidentMessage(combinedText);

  assert.equal(isLikelyAlertIncident(combinedText), true);
  assert.equal(incident.incidentId, "66568");
  assert.equal(incident.request.path, "/api/v2/news");
  assert.equal(incident.error.statusCode, 500);
  assert.match(incident.error.message, /Connection lost/);
});
