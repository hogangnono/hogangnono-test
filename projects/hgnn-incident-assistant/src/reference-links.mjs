import path from "node:path";
import { spawnSync } from "node:child_process";

const repoCache = new Map();
const DEFAULT_REFERENCE_BRANCH = "master";

function normalizeRemoteUrl(remoteUrl) {
  if (!remoteUrl || remoteUrl === "no-remote") {
    return null;
  }

  if (remoteUrl.startsWith("git@github.com:")) {
    return `https://github.com/${remoteUrl.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }

  if (remoteUrl.startsWith("https://github.com/")) {
    return remoteUrl.replace(/\.git$/, "");
  }

  return null;
}

function getRepoMeta(repoRoot) {
  if (repoCache.has(repoRoot)) {
    return repoCache.get(repoRoot);
  }

  const remoteResult = spawnSync("git", [ "-C", repoRoot, "remote", "get-url", "origin" ], {
    encoding: "utf8",
  });

  const meta = {
    repoName: path.basename(repoRoot),
    repoRoot,
    remoteUrl: normalizeRemoteUrl(remoteResult.status === 0 ? remoteResult.stdout.trim() : null),
    referenceBranch: DEFAULT_REFERENCE_BRANCH,
  };

  repoCache.set(repoRoot, meta);
  return meta;
}

function findRepoRoot(filePath, repoRoots) {
  const normalized = path.resolve(filePath);
  return repoRoots
    .map((root) => path.resolve(root))
    .filter((root) => normalized.startsWith(root + path.sep) || normalized === root)
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

export function buildReferenceLink(filePath, lineNumber, repoRoots) {
  const repoRoot = findRepoRoot(filePath, repoRoots);
  if (!repoRoot) {
    return `${path.basename(filePath)}:${lineNumber}`;
  }

  const meta = getRepoMeta(repoRoot);
  const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
  const label = `${meta.repoName}/${relativePath}:${lineNumber}`;

  if (meta.remoteUrl && meta.referenceBranch) {
    return `<${meta.remoteUrl}/blob/${meta.referenceBranch}/${relativePath}#L${lineNumber}|${label}>`;
  }

  return label;
}
