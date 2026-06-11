import type { SessionData, SessionMetrics } from "./types.ts";
import { classifyTurn } from "./classifier.ts";

const MAX_GAP_MS = 30 * 60 * 1000; // 30 minutes

export function computeMetrics(
  session: SessionData,
  classifications?: Array<"success" | "retry">
): SessionMetrics {
  const { turns } = session;

  if (turns.length === 0) {
    return {
      sessionId: session.sessionId,
      projectName: session.projectName,
      source: session.source,
      title: session.title,
      turnCount: 0,
      inferenceTimeMs: 0,
      checkWriteTimeMs: 0,
      probability: 1,
      successScore: 0,
      avgTokensPerSuccess: 0,
      avgTokensPerFailure: 0,
      totalToolCalls: 0,
      avgToolCallsPerTurn: 0,
      avgTokensPerToolCall: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreateTokens: 0,
      firstTimestamp: session.firstTimestamp,
      lastTimestamp: session.lastTimestamp,
      turns,
    };
  }

  let inferenceTimeMs = 0;
  for (const turn of turns) {
    if (turn.lastAssistantTimestamp) {
      const diff =
        turn.lastAssistantTimestamp.getTime() -
        turn.promptTimestamp.getTime();
      if (diff > 0) inferenceTimeMs += diff;
    }
  }

  let checkWriteTimeMs = 0;
  for (let i = 0; i < turns.length - 1; i++) {
    const endOfTurn = turns[i].lastAssistantTimestamp;
    const startOfNext = turns[i + 1].promptTimestamp;
    if (endOfTurn) {
      const gap = startOfNext.getTime() - endOfTurn.getTime();
      if (gap > 0 && gap < MAX_GAP_MS) {
        checkWriteTimeMs += gap;
      }
    }
  }

  let successCount = 0;
  let successTokens = 0;
  let failureTokens = 0;
  for (let i = 0; i < turns.length; i++) {
    const turnTokens = turns[i].totalInputTokens + turns[i].totalOutputTokens;
    const classification = classifications
      ? classifications[i]
      : classifyTurn(
          turns[i].promptText,
          i < turns.length - 1 ? turns[i + 1].promptText : null
        );
    if (classification === "success") {
      successCount++;
      successTokens += turnTokens;
    } else {
      failureTokens += turnTokens;
    }
  }
  const failureCount = turns.length - successCount;
  const probability = Math.max(0.1, successCount / turns.length);

  const avgTokensPerSuccess = successCount > 0 ? successTokens / successCount : 0;
  const avgTokensPerFailure = failureCount > 0 ? failureTokens / failureCount : 0;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreateTokens = 0;
  for (const turn of turns) {
    totalInputTokens += turn.totalInputTokens;
    totalOutputTokens += turn.totalOutputTokens;
    totalCacheReadTokens += turn.totalCacheReadTokens;
    totalCacheCreateTokens += turn.totalCacheCreateTokens;
  }
  const totalTokens = totalInputTokens + totalOutputTokens;

  const totalToolCalls = turns.reduce((s, t) => s + t.toolCallCount, 0);
  const avgToolCallsPerTurn = turns.length > 0 ? totalToolCalls / turns.length : 0;
  const avgTokensPerToolCall = totalToolCalls > 0 ? totalTokens / totalToolCalls : 0;

  const avgInferencePerTurn = inferenceTimeMs / 1000 / turns.length;
  const avgCheckWritePerTurn = checkWriteTimeMs / 1000 / turns.length;
  const successScore = (avgInferencePerTurn + avgCheckWritePerTurn) / probability;

  return {
    sessionId: session.sessionId,
    projectName: session.projectName,
    source: session.source,
    title: session.title,
    turnCount: turns.length,
    inferenceTimeMs,
    checkWriteTimeMs,
    probability,
    successScore,
    avgTokensPerSuccess,
    avgTokensPerFailure,
    totalToolCalls,
    avgToolCallsPerTurn,
    avgTokensPerToolCall,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreateTokens,
    firstTimestamp: session.firstTimestamp,
    lastTimestamp: session.lastTimestamp,
    turns,
  };
}
