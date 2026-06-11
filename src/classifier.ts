import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const FRUSTRATION_PATTERNS = [
  /\bno[,.]?\s/i,
  /\bwrong\b/i,
  /\btry again\b/i,
  /\bthat'?s not\b/i,
  /\binstead\b/i,
  /\bactually[,.]?\s/i,
  /\bi said\b/i,
  /\bnot what i\b/i,
  /\bstill\s+(wrong|broken|failing|not working)\b/i,
  /\bredo\b/i,
  /\brevert\b/i,
  /\bdon'?t\b.*\b(do|change|add|remove|modify)\b/i,
  /\bthat broke\b/i,
  /\bundo\b/i,
];

const OPERATIONAL_PATTERNS = [
  /^\/\w+/,
  /\bcommit\b/i,
  /\bcreate a pr\b/i,
  /\bopen a pr\b/i,
  /\bpush\b/i,
  /\bmerge\b/i,
  /\blgtm\b/i,
  /\bship it\b/i,
  /\blooks good\b/i,
  /\bthanks\b/i,
  /\bthank you\b/i,
];

function normalize(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function classifyTurn(
  currentPrompt: string,
  nextPrompt: string | null
): "success" | "retry" {
  if (nextPrompt === null) return "success";

  const next = normalize(nextPrompt);

  for (const pattern of OPERATIONAL_PATTERNS) {
    if (pattern.test(next)) return "success";
  }

  for (const pattern of FRUSTRATION_PATTERNS) {
    if (pattern.test(next)) return "retry";
  }

  const curr = normalize(currentPrompt);
  if (jaccardSimilarity(curr, next) > 0.5) return "retry";

  return "success";
}

const CACHE_DIR = join(homedir(), ".cache", "claude-session-cost");

function getCachePath(): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return join(CACHE_DIR, "classifications.json");
}

function getSessionCachePath(): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return join(CACHE_DIR, "session-classifications.json");
}

function loadCache(): Record<string, "success" | "retry"> {
  try {
    return JSON.parse(readFileSync(getCachePath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, "success" | "retry">): void {
  writeFileSync(getCachePath(), JSON.stringify(cache, null, 2));
}

interface SessionCacheEntry {
  mtime: number;
  classifications: Array<"success" | "retry">;
}

function loadSessionCache(): Record<string, SessionCacheEntry> {
  try {
    return JSON.parse(readFileSync(getSessionCachePath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveSessionCache(cache: Record<string, SessionCacheEntry>): void {
  writeFileSync(getSessionCachePath(), JSON.stringify(cache));
}

function cacheKey(current: string, next: string): string {
  const hash = createHash("sha256");
  hash.update(current.slice(0, 500));
  hash.update("\0");
  hash.update(next.slice(0, 500));
  return hash.digest("hex").slice(0, 16);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

const SYSTEM_PROMPT = `You classify pairs of consecutive user prompts in a coding assistant conversation.

Given the CURRENT prompt (what the user asked) and the NEXT prompt (what the user said after receiving a response), determine if the CURRENT turn was successful or if the user is retrying.

Classification rules:
- "retry" = the user is correcting, complaining, rephrasing the same request, expressing frustration, asking to undo/revert, or indicating the response was wrong
- "success" = the user moved on to a new topic, gave a follow-up task building on the result, expressed satisfaction, or issued an operational command (commit, push, create PR, etc.)

Respond with ONLY the word "success" or "retry".`;

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      [
        "-p",
        prompt,
        "--model", "haiku",
        "--system-prompt", SYSTEM_PROMPT,
        "--no-session-persistence",
        "--allowedTools", "",
      ],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout.trim());
        }
      }
    );
    child.stdin?.end();
  });
}

export interface SessionTurns {
  sessionId: string;
  mtime: Date;
  turns: Array<{ currentPrompt: string; nextPrompt: string | null }>;
}

export async function classifySessionsBatch(
  sessions: SessionTurns[],
  useAi: boolean,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, Array<"success" | "retry">>> {
  const sessionCache = loadSessionCache();
  const result = new Map<string, Array<"success" | "retry">>();

  const totalTurns = sessions.reduce((s, sess) => s + sess.turns.length, 0);
  let cachedTurns = 0;

  const uncachedSessions: SessionTurns[] = [];

  for (const session of sessions) {
    const cached = sessionCache[session.sessionId];
    if (
      cached &&
      cached.mtime === session.mtime.getTime() &&
      cached.classifications.length === session.turns.length
    ) {
      result.set(session.sessionId, cached.classifications);
      cachedTurns += session.turns.length;
    } else {
      uncachedSessions.push(session);
    }
  }

  // Initialize results for uncached sessions with heuristic fallback
  for (const session of uncachedSessions) {
    const classifications: Array<"success" | "retry"> = session.turns.map((t) =>
      classifyTurn(t.currentPrompt, t.nextPrompt)
    );
    result.set(session.sessionId, classifications);
  }

  if (!useAi || uncachedSessions.length === 0) {
    // Heuristic-only: still cache the results for uncached sessions
    if (uncachedSessions.length > 0) {
      for (const session of uncachedSessions) {
        sessionCache[session.sessionId] = {
          mtime: session.mtime.getTime(),
          classifications: result.get(session.sessionId)!,
        };
      }
      saveSessionCache(sessionCache);
    }
    onProgress?.(totalTurns, totalTurns);
    return result;
  }

  // AI classification for uncached sessions
  const uncachedTurns: Array<{ sessionId: string; index: number; current: string; next: string }> = [];
  for (const session of uncachedSessions) {
    for (let i = 0; i < session.turns.length; i++) {
      const { currentPrompt, nextPrompt } = session.turns[i];
      if (nextPrompt !== null) {
        uncachedTurns.push({
          sessionId: session.sessionId,
          index: i,
          current: currentPrompt,
          next: nextPrompt,
        });
      }
    }
  }

  const turnCache = loadCache();
  const toClassify: Array<{ sessionId: string; index: number; current: string; next: string }> = [];

  for (const turn of uncachedTurns) {
    const key = cacheKey(turn.current, turn.next);
    if (turnCache[key]) {
      result.get(turn.sessionId)![turn.index] = turnCache[key];
      cachedTurns++;
    } else {
      toClassify.push(turn);
    }
  }

  let done = cachedTurns;
  onProgress?.(done, totalTurns);

  if (toClassify.length > 0) {
    const BATCH_SIZE = 8;
    for (let b = 0; b < toClassify.length; b += BATCH_SIZE) {
      const batch = toClassify.slice(b, b + BATCH_SIZE);
      const promises = batch.map(async (turn) => {
        try {
          const prompt = `CURRENT PROMPT:\n${truncate(turn.current, 300)}\n\nNEXT PROMPT:\n${truncate(turn.next, 300)}`;
          const text = (await callClaude(prompt)).toLowerCase();
          const classification: "success" | "retry" =
            text === "retry" ? "retry" : "success";
          const key = cacheKey(turn.current, turn.next);
          turnCache[key] = classification;
          result.get(turn.sessionId)![turn.index] = classification;
        } catch (err) {
          console.error(`  AI classify error: ${err}`);
          result.get(turn.sessionId)![turn.index] = classifyTurn(turn.current, turn.next);
        }
      });

      await Promise.all(promises);
      done += batch.length;
      onProgress?.(done, totalTurns);
    }

    saveCache(turnCache);
  }

  // Update session cache for all uncached sessions
  for (const session of uncachedSessions) {
    sessionCache[session.sessionId] = {
      mtime: session.mtime.getTime(),
      classifications: result.get(session.sessionId)!,
    };
  }
  saveSessionCache(sessionCache);

  return result;
}
