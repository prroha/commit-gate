// Checking a pull-request body: every section filled, none of them an essay.
import { SEVERITY } from "./rules.mjs";

const HEADING = /^#{1,4}\s*(.+?)\s*$/;
const BOLD_HEADING = /^\*\*(.+?)\*\*\s*:?\s*$/;
const NARRATIVE_MATCH_LENGTH = 60;

export function sectionsOf(body) {
  const sections = new Map();
  let current = null;
  for (const line of body.split("\n")) {
    const heading = HEADING.exec(line) ?? BOLD_HEADING.exec(line);
    if (heading) {
      current = heading[1].replace(/[:*]/g, "").trim();
      sections.set(current, []);
      continue;
    }
    if (current) {
      sections.get(current).push(line);
    }
  }
  return new Map([...sections].map(([name, lines]) => [name, lines.join("\n").trim()]));
}

function wordCount(text) {
  return (text.match(/\S+/g) ?? []).length;
}

function longestSharedRun(first, second, minimum) {
  const normalise = (text) => text.replace(/\s+/g, " ").toLowerCase();
  const a = normalise(first);
  const b = normalise(second);
  for (let length = Math.min(a.length, 400); length >= minimum; length -= 10) {
    for (let start = 0; start + length <= a.length; start += 10) {
      const slice = a.slice(start, start + length);
      if (b.includes(slice)) {
        return slice;
      }
    }
  }
  return null;
}

export function checkPullRequest(body, config, commitBody = "") {
  const findings = [];
  const at = (rule, severity, message, fix) => findings.push({ rule, severity, path: "pull request", line: 1, message, fix });
  const sections = sectionsOf(body);
  const names = [...sections.keys()].map((name) => name.toLowerCase());

  if (body.trim() === "") {
    at("empty-pr", SEVERITY.error, "the pull request body is empty", `fill in: ${config.requiredSections.join(", ")}`);
    return findings;
  }

  for (const required of config.requiredSections) {
    const index = names.findIndex((name) => name.includes(required.toLowerCase()));
    if (index === -1) {
      at("missing-section", SEVERITY.error, `no ${required} section`, `add a "${required}" heading`);
      continue;
    }
    const content = [...sections.values()][index];
    if (content.replace(/[-*\s]/g, "") === "") {
      at("empty-section", SEVERITY.error, `the ${required} section is empty`, "a sentence is enough, but it has to be there");
      continue;
    }
    if (wordCount(content) > config.maxSectionWords) {
      at("long-section", SEVERITY.warn, `the ${required} section is ${wordCount(content)} words (limit ${config.maxSectionWords})`, "a reviewer reads this to decide what to look at; keep it short");
    }
  }

  if (config.warnNarrativeDuplication && commitBody.trim() !== "") {
    const shared = longestSharedRun(commitBody, body, NARRATIVE_MATCH_LENGTH);
    if (shared) {
      at("duplicated-narrative", SEVERITY.warn, "the body repeats the commit message", "reasoning belongs in the commit; the pull request says what to review");
    }
  }
  return findings;
}
