import { spawn } from "node:child_process";

const AWS_REGION = "ap-northeast-2";
const DEFAULT_AWS_TIMEOUT_MS = 10000;

function buildAbortError() {
  const error = new Error("AWS context collection aborted");
  error.name = "AbortError";
  return error;
}

const SERVICE_TARGETS = [
  {
    matchers: [ "hogangnono-api-v2", "hogangnono-api" ],
    services: [
      { stage: "prod", cluster: "hogangnono-api-prod-cluster", service: "hogangnono-api-prod-ecs-service", lokiJob: "hogangnono-api-prod" },
      { stage: "beta", cluster: "hogangnono-api-beta-cluster", service: "hogangnono-api-beta-ecs-service", lokiJob: "hogangnono-api-beta" },
      { stage: "dev", cluster: "hogangnono-api-dev-cluster", service: "hogangnono-api-dev-ecs-service", lokiJob: "hogangnono-api-dev" },
    ],
  },
];

function runAwsCli(args, runner = null, timeoutMs = DEFAULT_AWS_TIMEOUT_MS, signal = null) {
  if (runner) {
    return Promise.resolve(runner(args));
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(buildAbortError());
      return;
    }

    const child = spawn("aws", args, {
      stdio: [ "ignore", "pipe", "pipe" ],
    });

    let stdout = "";
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      resolve(null);
    }, timeoutMs);
    const abortHandler = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      child.kill("SIGTERM");
      reject(buildAbortError());
    };

    const finalize = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", abortHandler);
      resolve(value);
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => {
      finalize(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finalize(null);
        return;
      }

      try {
        finalize(JSON.parse(stdout));
      } catch {
        finalize(null);
      }
    });
  });
}

export function resolveServiceTargets(incident) {
  const haystack = [
    incident.incidentSlug,
    incident.serviceLabel,
    incident.normalizedText,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  for (const target of SERVICE_TARGETS) {
    if (target.matchers.some((matcher) => haystack.includes(matcher))) {
      return target.services;
    }
  }

  return [];
}

function summarizeEvents(events = [], limit = 3) {
  return events
    .slice(0, limit)
    .map((event) => `- ${event.createdAt}: ${event.message}`)
    .join("\n");
}

function extractTaskRevision(taskDefinitionArn) {
  if (!taskDefinitionArn) {
    return null;
  }

  return taskDefinitionArn.split(":").at(-1) ?? null;
}

export async function collectAwsContext(incident, options = {}) {
  const awsCli = options.awsCli ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AWS_TIMEOUT_MS;
  const signal = options.signal ?? null;
  const targets = resolveServiceTargets(incident);

  if (targets.length === 0) {
    return {
      promptContext: "",
      services: [],
    };
  }

  const services = [];

  for (const target of targets) {
    const payload = await runAwsCli([
      "ecs",
      "describe-services",
      "--cluster",
      target.cluster,
      "--services",
      target.service,
      "--region",
      AWS_REGION,
    ], awsCli, timeoutMs, signal);

    const service = payload?.services?.[0];
    if (!service) {
      continue;
    }

    services.push({
      stage: target.stage,
      cluster: target.cluster,
      serviceName: service.serviceName,
      desiredCount: service.desiredCount,
      runningCount: service.runningCount,
      pendingCount: service.pendingCount,
      taskDefinition: service.taskDefinition,
      taskRevision: extractTaskRevision(service.taskDefinition),
      events: (service.events ?? []).slice(0, 3).map((event) => ({
        createdAt: event.createdAt,
        message: event.message,
      })),
    });
  }

  if (services.length === 0) {
    return {
      promptContext: "",
      services: [],
    };
  }

  const promptContext = [
    "### AWS Runtime Context",
    ...services.map((service, index) => [
      `#### AWS Service ${index + 1}`,
      `Stage: ${service.stage}`,
      `Cluster: ${service.cluster}`,
      `Service: ${service.serviceName}`,
      `Desired/Running/Pending: ${service.desiredCount}/${service.runningCount}/${service.pendingCount}`,
      `Task definition revision: ${service.taskRevision ?? "unknown"}`,
      service.events.length > 0
        ? `Recent ECS events:\n${summarizeEvents(service.events)}`
        : "Recent ECS events: none",
    ].join("\n")),
  ].join("\n\n");

  return {
    promptContext,
    services,
  };
}
