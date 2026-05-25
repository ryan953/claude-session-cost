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

export async function classifyTurnBatch(
  turns: Array<{ currentPrompt: string; nextPrompt: string | null }>,
  onProgress?: (done: number, total: number) => void
): Promise<Array<"success" | "retry">> {
  const cache = loadCache();
  const results: Array<"success" | "retry"> = [];
  const uncached: Array<{ index: number; current: string; next: string }> = [];

  for (let i = 0; i < turns.length; i++) {
    const { currentPrompt, nextPrompt } = turns[i];
    if (nextPrompt === null) {
      results[i] = "success";
      continue;
    }
    const key = cacheKey(currentPrompt, nextPrompt);
    if (cache[key]) {
      results[i] = cache[key];
    } else {
      uncached.push({ index: i, current: currentPrompt, next: nextPrompt });
      results[i] = "success";
    }
  }

  if (uncached.length === 0) {
    onProgress?.(turns.length, turns.length);
    return results;
  }

  const BATCH_SIZE = 8;
  let done = turns.length - uncached.length;

  for (let b = 0; b < uncached.length; b += BATCH_SIZE) {
    const batch = uncached.slice(b, b + BATCH_SIZE);
    const promises = batch.map(async ({ index, current, next }) => {
      try {
        const prompt = `CURRENT PROMPT:\n${truncate(current, 300)}\n\nNEXT PROMPT:\n${truncate(next, 300)}`;
        const text = (await callClaude(prompt)).toLowerCase();
        const classification: "success" | "retry" =
          text === "retry" ? "retry" : "success";
        const key = cacheKey(current, next);
        cache[key] = classification;
        results[index] = classification;
      } catch (err) {
        console.error(`  AI classify error: ${err}`);
        results[index] = classifyTurn(current, next);
      }
    });

    await Promise.all(promises);
    done += batch.length;
    onProgress?.(done, turns.length);
  }

  saveCache(cache);
  return results;
}
