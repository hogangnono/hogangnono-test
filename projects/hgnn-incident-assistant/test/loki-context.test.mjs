import test from "node:test";
import assert from "node:assert/strict";
import { collectLokiContext } from "../src/loki-context.mjs";

test("collectLokiContext includes matching log lines for api incidents", async () => {
  const incident = {
    incidentSlug: "hogangnono-api-v2-status-error",
    serviceLabel: "Hogangnono Application Alert",
    normalizedText: "sample",
    request: { path: "/api/v2/news" },
    error: {
      exceptionName: "QueryFailedError",
      message: "Connection lost: The server closed the connection.",
    },
    searchTerms: [ "QueryFailedError", "news" ],
  };

  const calls = [];
  const result = await collectLokiContext(incident, {
    curlRunner(url, params) {
      calls.push({ url, params });
      if (params.query.includes("count_over_time")) {
        return {
          data: {
            result: [
              {
                value: [ "1", "17" ],
              },
            ],
          },
        };
      }
      if (params.query.includes("/api/v2/news")) {
        return {
          data: {
            result: [
              {
                stream: {
                  container_name: "hogangnono-api-prod-task-container",
                  ecs_task_definition: "hogangnono-api-prod-task-family:453",
                  source: "stdout",
                },
                values: [
                  [ "1", "  'http.route': '/api/v2/news'," ],
                ],
              },
            ],
          },
        };
      }
      return { data: { result: [] } };
    },
  });

  assert.ok(calls.length >= 1);
  assert.match(result.promptContext, /Loki Runtime Context/);
  assert.match(result.promptContext, /Similar Error History/);
  assert.match(result.promptContext, /Recent similar Loki matches in the last 30 days: 17 \(preferred stage: prod\)/);
  assert.match(result.promptContext, /Total similar Loki matches across all stages: 51/);
  assert.match(result.promptContext, /hogangnono-api-prod/);
  assert.match(result.promptContext, /\/api\/v2\/news/);
  assert.equal(result.similarErrorSummary.count, 17);
  assert.equal(result.similarErrorSummary.totalCount, 51);
  assert.equal(result.similarErrorSummary.stage, "prod");
  assert.equal(result.jobs[0].similarErrorCount, 17);
});
