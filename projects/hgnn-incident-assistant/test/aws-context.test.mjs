import test from "node:test";
import assert from "node:assert/strict";
import { collectAwsContext } from "../src/aws-context.mjs";

test("collectAwsContext includes ECS service events for api incidents", async () => {
  const incident = {
    incidentSlug: "hogangnono-api-v2-status-error",
    serviceLabel: "Hogangnono Application Alert",
    normalizedText: "sample",
  };

  const calls = [];
  const result = await collectAwsContext(incident, {
    awsCli(args) {
      calls.push(args);
      return {
        services: [
          {
            serviceName: "hogangnono-api-prod-ecs-service",
            desiredCount: 68,
            runningCount: 68,
            pendingCount: 0,
            taskDefinition: "arn:aws:ecs:ap-northeast-2:123:task-definition/hogangnono-api-prod-task-family:453",
            events: [
              { createdAt: "2026-03-19T10:00:00Z", message: "service reached a steady state" },
            ],
          },
        ],
      };
    },
  });

  assert.equal(calls.length, 3);
  assert.match(result.promptContext, /AWS Runtime Context/);
  assert.match(result.promptContext, /hogangnono-api-prod-ecs-service/);
  assert.match(result.promptContext, /steady state/);
});
