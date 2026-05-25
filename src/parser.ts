import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  TranscriptEntry,
  UserEntry,
  AssistantEntry,
  AiTitleEntry,
  SessionData,
  Turn,
  SessionFile,
} from "./types.ts";

const WRAPPER_COMMANDS = new Set([
  "sudo", "env", "time", "nice", "nohup", "command", "exec", "builtin",
]);

function extractBashCommand(command: string): string {
  const trimmed = command.trim().replace(/^\(+/, "");
  const tokens = trimmed.split(/\s+/);

  for (const token of tokens) {
    if (/^\w+=/.test(token)) continue;
    if (token.startsWith("-")) continue;
    if (/^\d+$/.test(token)) continue;
    const base = token.replace(/^.*\//, "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!base) continue;
    if (WRAPPER_COMMANDS.has(base)) continue;
    return base;
  }
  return "unknown";
}

function resolveToolName(
  name: string,
  input: Record<string, unknown> | undefined
): string {
  if (!input) return name;
  switch (name) {
    case "Bash":
      if (input.command) {
        return `Bash(${extractBashCommand(String(input.command))})`;
      }
      break;
    case "Skill":
      if (input.skill) return `Skill(${input.skill})`;
      break;
    case "ToolSearch":
      if (input.query) {
        const q = String(input.query);
        const selectMatch = q.match(/^select:(.+)/);
        if (selectMatch) return `ToolSearch(select)`;
        const first = q.split(/\s+/)[0];
        return `ToolSearch(${first})`;
      }
      break;
    case "Agent":
      if (input.subagent_type) return `Agent(${input.subagent_type})`;
      break;
    case "SendMessage":
      if (input.to) return `SendMessage(${input.to})`;
      break;
  }
  return name;
}

function isRealUserPrompt(entry: TranscriptEntry): entry is UserEntry {
  if (entry.type !== "user") return false;
  const user = entry as UserEntry;

  if (user.isMeta || user.isCompactSummary || user.isSidechain) return false;
  if (user.toolUseResult) return false;
  if (user.sourceToolAssistantUUID) return false;

  if (typeof user.message?.content !== "string") return false;

  const content = user.message.content;
  if (content.startsWith("<command-name>")) return false;
  if (content.startsWith("<local-command-")) return false;
  if (content.startsWith("[Request interrupted")) return false;
  if (content.startsWith("<task-notification")) return false;
  if (content.startsWith("<scheduled-wakeup")) return false;

  return true;
}

function isAssistant(entry: TranscriptEntry): entry is AssistantEntry {
  return entry.type === "assistant" && !entry.isSidechain;
}

function isAiTitle(entry: TranscriptEntry): entry is AiTitleEntry {
  return entry.type === "ai-title";
}

function getUserPromptText(entry: UserEntry): string {
  if (typeof entry.message?.content === "string") {
    return entry.message.content;
  }
  return "";
}

export async function parseSession(
  sessionFile: SessionFile
): Promise<SessionData> {
  const seenUuids = new Set<string>();
  const seenRequestIds = new Set<string>();
  const seenPromptIds = new Set<string>();

  const realPrompts: Array<{
    entry: UserEntry;
    timestamp: Date;
    text: string;
  }> = [];
  const assistantEntries: Array<{
    entry: AssistantEntry;
    timestamp: Date;
    promptId: string | null;
  }> = [];
  const toolCallsByName = new Map<string, { count: number; totalTokens: number }>();
  const skillCallsByName = new Map<string, { count: number; totalTokens: number }>();
  let title = sessionFile.sessionId;
  let firstTimestamp: Date | null = null;
  let lastTimestamp: Date | null = null;

  const rl = createInterface({
    input: createReadStream(sessionFile.filePath),
    crlfDelay: Infinity,
  });

  let currentPromptId: string | null = null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.uuid) {
      if (seenUuids.has(entry.uuid)) continue;
      seenUuids.add(entry.uuid);
    }

    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }

    if (isAiTitle(entry)) {
      title = entry.aiTitle;
      continue;
    }

    if (isRealUserPrompt(entry)) {
      const user = entry as UserEntry;
      currentPromptId = user.promptId ?? null;
      if (user.timestamp && currentPromptId && !seenPromptIds.has(currentPromptId)) {
        seenPromptIds.add(currentPromptId);
        realPrompts.push({
          entry: user,
          timestamp: new Date(user.timestamp),
          text: getUserPromptText(user),
        });
      }
      continue;
    }

    if (isAssistant(entry)) {
      const assistant = entry as AssistantEntry;

      if (assistant.requestId) {
        if (seenRequestIds.has(assistant.requestId)) continue;
        seenRequestIds.add(assistant.requestId);
      }

      if (assistant.timestamp) {
        assistantEntries.push({
          entry: assistant,
          timestamp: new Date(assistant.timestamp),
          promptId: currentPromptId,
        });
      }
    }
  }

  const turns: Turn[] = [];
  for (let i = 0; i < realPrompts.length; i++) {
    const prompt = realPrompts[i];
    const nextPromptTime =
      i < realPrompts.length - 1 ? realPrompts[i + 1].timestamp : null;
    const promptId = prompt.entry.promptId ?? `turn-${i}`;

    const turnAssistants = assistantEntries.filter((a) => {
      if (a.timestamp <= prompt.timestamp) return false;
      if (nextPromptTime && a.timestamp >= nextPromptTime) return false;
      return true;
    });

    let lastAssistantTimestamp: Date | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreateTokens = 0;
    let toolCallCount = 0;

    for (const a of turnAssistants) {
      if (!lastAssistantTimestamp || a.timestamp > lastAssistantTimestamp) {
        lastAssistantTimestamp = a.timestamp;
      }
      const usage = a.entry.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens ?? 0;
        totalOutputTokens += usage.output_tokens ?? 0;
        totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
        totalCacheCreateTokens += usage.cache_creation_input_tokens ?? 0;
      }
      const content = a.entry.message?.content;
      if (Array.isArray(content)) {
        const toolBlocks = content.filter((b) => b.type === "tool_use");
        toolCallCount += toolBlocks.length;
        const entryTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
        const tokensPerCall = toolBlocks.length > 0 ? entryTokens / toolBlocks.length : 0;
        for (const block of toolBlocks) {
          const rawName = block.name ?? "unknown";
          const name = resolveToolName(rawName, block.input);
          const existing = toolCallsByName.get(name);
          if (existing) {
            existing.count++;
            existing.totalTokens += tokensPerCall;
          } else {
            toolCallsByName.set(name, { count: 1, totalTokens: tokensPerCall });
          }
          if (rawName === "Skill" && block.input) {
            const skillName = String(block.input.skill ?? "unknown");
            const existingSkill = skillCallsByName.get(skillName);
            if (existingSkill) {
              existingSkill.count++;
              existingSkill.totalTokens += tokensPerCall;
            } else {
              skillCallsByName.set(skillName, { count: 1, totalTokens: tokensPerCall });
            }
          }
        }
      }
    }

    turns.push({
      promptId,
      promptTimestamp: prompt.timestamp,
      promptText: prompt.text,
      lastAssistantTimestamp,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreateTokens,
      assistantCount: turnAssistants.length,
      toolCallCount,
    });
  }

  return {
    sessionId: sessionFile.sessionId,
    filePath: sessionFile.filePath,
    projectDir: sessionFile.projectDir,
    projectName: sessionFile.projectName,
    title,
    turns,
    toolCallsByName,
    skillCallsByName,
    firstTimestamp,
    lastTimestamp,
  };
}
