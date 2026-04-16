import fs from "node:fs";
import process from "node:process";
import { analyzeIncidentText, prepareIncidentAnalysis } from "./analyze-incident.mjs";
import { loadConfig } from "./config.mjs";
import { loadDotEnv } from "./load-env.mjs";

function readFromStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

async function main() {
  loadDotEnv();

  const fileIndex = process.argv.indexOf("--file");
  const printPrompt = process.argv.includes("--print-prompt");
  let text;

  if (fileIndex !== -1) {
    const filePath = process.argv[fileIndex + 1];
    if (!filePath) {
      throw new Error("Missing file path after --file");
    }
    text = fs.readFileSync(filePath, "utf8");
  } else {
    text = await readFromStdin();
  }

  if (!text.trim()) {
    throw new Error("No incident text provided");
  }

  const config = loadConfig();

  if (printPrompt) {
    const prepared = await prepareIncidentAnalysis(text, config);
    process.stdout.write(`${prepared.prompt}\n`);
    return;
  }

  const result = await analyzeIncidentText(text, config);
  process.stdout.write(`${result.replyText}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
