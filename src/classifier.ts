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
