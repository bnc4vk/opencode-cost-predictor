import { createHash } from "node:crypto";

export const OUTCOMES = new Set(["success", "partial", "failed", "abandoned"]);

export function nowIso() {
  return new Date().toISOString();
}

export function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function safeJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
      };
    }
    if (typeof item === "function") return `[function ${item.name || "anonymous"}]`;
    return item;
  });
}

export function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function commandSegments(command) {
  return String(command ?? "")
    .split(/\s*(?:&&|\|\||;|\n)\s*/g)
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);
}

function stripWrappers(segment) {
  let value = compactWhitespace(segment);
  value = value.replace(/^env\s+(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/u, "");
  value = value.replace(/^command\s+/u, "");
  value = value.replace(/^sudo\s+(?:-\S+\s+)*/u, "");
  return compactWhitespace(value);
}

export function classifyCommand(command) {
  const normalized = compactWhitespace(command);
  if (!normalized) return null;

  for (const rawSegment of commandSegments(normalized)) {
    const segment = stripWrappers(rawSegment);

    if (/^git\s+(?:-[^\s]+\s+\S+\s+)*commit(?:\s|$)/u.test(segment)) {
      return {
        triggerType: "git_commit",
        outcome: "awaiting_label",
        labelSource: "pending_user",
        confidence: null,
      };
    }

    if (/^gh\s+pr\s+create(?:\s|$)/u.test(segment)) {
      return {
        triggerType: "github_pr_publish",
        outcome: "awaiting_label",
        labelSource: "pending_user",
        confidence: null,
      };
    }

    if (/^gh\s+pr\s+ready(?:\s|$)/u.test(segment)) {
      return {
        triggerType: "github_pr_publish",
        outcome: "awaiting_label",
        labelSource: "pending_user",
        confidence: null,
      };
    }

    if (/^gh\s+pr\s+edit(?:\s|$)/u.test(segment) && /(?:--draft=false|--ready)\b/u.test(segment)) {
      return {
        triggerType: "github_pr_publish",
        outcome: "awaiting_label",
        labelSource: "pending_user",
        confidence: null,
      };
    }
  }

  return null;
}

export function extractCommands(value, limit = 20) {
  const found = [];
  const seen = new Set();

  function visit(item, depth = 0) {
    if (found.length >= limit || depth > 8 || item == null) return;

    if (typeof item === "string") {
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }

    if (typeof item !== "object") return;

    for (const [key, child] of Object.entries(item)) {
      const lower = key.toLowerCase();
      if (
        typeof child === "string" &&
        ["command", "cmd", "script", "shell", "input"].includes(lower) &&
        /\b(?:git|gh)\s+/u.test(child)
      ) {
        const command = compactWhitespace(child);
        if (!seen.has(command)) {
          seen.add(command);
          found.push(command);
        }
      } else {
        visit(child, depth + 1);
      }
    }
  }

  visit(value);
  return found;
}

export function extractFilePaths(value, limit = 200) {
  const found = [];
  const seen = new Set();
  const pathKeys = new Set(["file", "filepath", "filename", "path", "abs", "relative"]);

  function push(candidate) {
    const value = String(candidate ?? "").trim();
    if (!value || value.length > 4096 || value.includes("\n")) return;
    if (!/[/\\.]/u.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    found.push(value);
  }

  function visit(item, depth = 0) {
    if (found.length >= limit || depth > 8 || item == null) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (typeof item !== "object") return;

    for (const [key, child] of Object.entries(item)) {
      const lower = key.toLowerCase();
      if (typeof child === "string" && pathKeys.has(lower)) push(child);
      else visit(child, depth + 1);
    }
  }

  visit(value);
  return found;
}

export function extractSessionId(value) {
  const preferred = [
    ["sessionID"],
    ["sessionId"],
    ["session_id"],
    ["session", "id"],
    ["session", "sessionID"],
    ["session", "sessionId"],
    ["properties", "sessionID"],
    ["properties", "sessionId"],
  ];

  for (const path of preferred) {
    let item = value;
    for (const part of path) item = item?.[part];
    if (typeof item === "string" && item.trim()) return item.trim();
  }

  const seen = new Set();
  function visit(item, depth = 0) {
    if (depth > 6 || item == null || typeof item !== "object" || seen.has(item)) return null;
    seen.add(item);

    if (Array.isArray(item)) {
      for (const child of item) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
      return null;
    }

    for (const [key, child] of Object.entries(item)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, "");
      if (
        typeof child === "string" &&
        child.trim() &&
        ["sessionid", "session"].includes(normalized)
      ) {
        return child.trim();
      }
      const found = visit(child, depth + 1);
      if (found) return found;
    }

    return null;
  }

  const recursive = visit(value);
  if (recursive) return recursive;

  return null;
}

export function sessionKey({ sessionId, projectDir, fallback }) {
  if (sessionId) return sessionId;
  return `local-${stableHash(`${projectDir || process.cwd()}-${fallback || process.pid}`)}`;
}

export function eventType(name, payload) {
  if (name) return String(name);
  const type = payload?.type ?? payload?.event ?? payload?.name;
  return typeof type === "string" && type ? type : "unknown";
}
