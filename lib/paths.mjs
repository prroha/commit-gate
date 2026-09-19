// Matching paths: which files a rule applies to.

const LEADING_GLOBSTAR = "\u0000";
const GLOBSTAR = "\u0001";

// A small glob: **/ means "any directories, or none", ** means any characters,
// and * stops at a separator.
export function globToRegExp(pattern) {
  const expression = pattern
    .replace(/\*\*\//g, LEADING_GLOBSTAR)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .split(LEADING_GLOBSTAR)
    .join("(?:.*/)?")
    .split(GLOBSTAR)
    .join(".*");
  return new RegExp(`^${expression}$`);
}

export function isIgnored(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function allowsConsole(path, allowed) {
  return allowed.some((segment) => path.split("/").includes(segment) || path.includes(`.${segment}.`));
}

