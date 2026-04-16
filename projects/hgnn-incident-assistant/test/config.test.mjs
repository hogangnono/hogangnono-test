import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateSlackConfig } from "../src/config.mjs";

test("loadConfig defaults max analyses per run to max messages per scan", () => {
  const previousEnv = {
    RUN_MODE: process.env.RUN_MODE,
    SLACK_ALERT_CHANNEL_IDS: process.env.SLACK_ALERT_CHANNEL_IDS,
    MAX_MESSAGES_PER_SCAN: process.env.MAX_MESSAGES_PER_SCAN,
    MAX_ANALYSES_PER_RUN: process.env.MAX_ANALYSES_PER_RUN,
  };

  try {
    delete process.env.RUN_MODE;
    delete process.env.SLACK_ALERT_CHANNEL_IDS;
    delete process.env.MAX_MESSAGES_PER_SCAN;
    delete process.env.MAX_ANALYSES_PER_RUN;

    const config = loadConfig();

    assert.equal(config.runMode, "scan");
    assert.deepEqual(config.slackAlertChannelIds, []);
    assert.equal(config.maxMessagesPerScan, 10);
    assert.equal(config.maxAnalysesPerRun, 10);
    assert.match(config.stateFile, /\.data\/state\.json$/);
    assert.match(config.logFilePath, /\.data\/runtime\.log$/);
  } finally {
    if (previousEnv.RUN_MODE == null) {
      delete process.env.RUN_MODE;
    } else {
      process.env.RUN_MODE = previousEnv.RUN_MODE;
    }

    if (previousEnv.SLACK_ALERT_CHANNEL_IDS == null) {
      delete process.env.SLACK_ALERT_CHANNEL_IDS;
    } else {
      process.env.SLACK_ALERT_CHANNEL_IDS = previousEnv.SLACK_ALERT_CHANNEL_IDS;
    }

    if (previousEnv.MAX_MESSAGES_PER_SCAN == null) {
      delete process.env.MAX_MESSAGES_PER_SCAN;
    } else {
      process.env.MAX_MESSAGES_PER_SCAN = previousEnv.MAX_MESSAGES_PER_SCAN;
    }

    if (previousEnv.MAX_ANALYSES_PER_RUN == null) {
      delete process.env.MAX_ANALYSES_PER_RUN;
    } else {
      process.env.MAX_ANALYSES_PER_RUN = previousEnv.MAX_ANALYSES_PER_RUN;
    }
  }
});

test("loadConfig maps legacy oneshot mode to scan", () => {
  const previousRunMode = process.env.RUN_MODE;

  try {
    process.env.RUN_MODE = "oneshot";

    const config = loadConfig();

    assert.equal(config.runMode, "scan");
  } finally {
    if (previousRunMode == null) {
      delete process.env.RUN_MODE;
    } else {
      process.env.RUN_MODE = previousRunMode;
    }
  }
});

test("validateSlackConfig no longer requires app token", () => {
  assert.doesNotThrow(() => {
    validateSlackConfig({
      slackBotToken: "xoxb-test",
      slackAlertChannelIds: [ "C0123456789" ],
      runMode: "loop",
    });
  });
});

test("validateSlackConfig requires at least one alert channel", () => {
  assert.throws(() => {
    validateSlackConfig({
      slackBotToken: "xoxb-test",
      slackAlertChannelIds: [],
      runMode: "loop",
    });
  }, /SLACK_ALERT_CHANNEL_IDS/);
});
