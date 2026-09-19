// Defaults plus commit-gate.json, so every threshold is a project's to set.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "commit-gate.json";

export const DEFAULTS = {
  code: {
    maxFunctionLines: 50,
    maxFileLines: 200,
    forbidAny: true,
    forbidOneLineIf: true,
    forbidDebugger: true,
    forbidConsole: true,
    consoleAllowedIn: ["test", "tests", "spec", "scripts", "bin", "cli"],
  },
  comments: {
    forbidChangelogComments: true,
    warnCommentedOutCode: true,
    warnRestatedComments: true,
    restatementOverlap: 0.6,
  },
  message: {
    maxSubjectLength: 72,
    requireConventional: false,
    forbidSubjectPeriod: true,
    requireImperative: true,
    maxBodyLineLength: 100,
    forbiddenLines: [],
  },
  pr: {
    requiredSections: ["Description", "Motivation", "Testing", "Rollout"],
    maxSectionWords: 120,
    warnNarrativeDuplication: true,
  },
  ignorePaths: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/vendor/**", "**/*.min.js"],
  fixturePaths: [
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/fixtures/**",
  ],
  secrets: true,
};

function merge(base, overrides) {
  if (overrides == null || typeof overrides !== "object" || Array.isArray(overrides)) {
    return overrides ?? base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = key in base ? merge(base[key], value) : value;
  }
  return result;
}

export function loadConfig(root) {
  try {
    const raw = readFileSync(join(root, CONFIG_FILE), "utf8");
    return { config: merge(DEFAULTS, JSON.parse(raw)), source: CONFIG_FILE };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { config: DEFAULTS, source: "defaults" };
    }
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`);
  }
}

export { merge as mergeConfig };
