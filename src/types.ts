export interface BaseEntry {
  type: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface UserEntry extends BaseEntry {
  type: "user";
  promptId?: string;
  message: {
    role: "user";
    content: string | Array<{ type: string; tool_use_id?: string; content?: string }>;
  };
  toolUseResult?: {
    stdout: string;
    stderr: string;
    interrupted: boolean;
  };
  sourceToolAssistantUUID?: string;
}

export interface AssistantEntry extends BaseEntry {
  type: "assistant";
  requestId?: string;
  message: {
    role: "assistant";
    model?: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
    usage?: TokenUsage;
  };
}

export interface AiTitleEntry extends BaseEntry {
  type: "ai-title";
  aiTitle: string;
}

export type TranscriptEntry = UserEntry | AssistantEntry | AiTitleEntry | BaseEntry;

export interface Turn {
  promptId: string;
  promptTimestamp: Date;
  promptText: string;
  lastAssistantTimestamp: Date | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  assistantCount: number;
  toolCallCount: number;
}

export interface SessionData {
  sessionId: string;
  filePath: string;
  projectDir: string;
  projectName: string;
  title: string;
  turns: Turn[];
  toolCallsByName: Map<string, { count: number; totalTokens: number }>;
  skillCallsByName: Map<string, { count: number; totalTokens: number }>;
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
}

export interface SessionMetrics {
  sessionId: string;
  projectName: string;
  title: string;
  turnCount: number;
  inferenceTimeMs: number;
  checkWriteTimeMs: number;
  probability: number;
  successScore: number;
  avgTokensPerSuccess: number;
  avgTokensPerFailure: number;
  totalToolCalls: number;
  avgToolCallsPerTurn: number;
  avgTokensPerToolCall: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
  turns: Turn[];
}

export interface ToolCallStat {
  name: string;
  count: number;
  totalTokens: number;
}

export interface SessionFile {
  filePath: string;
  projectDir: string;
  projectName: string;
  sessionId: string;
  mtime: Date;
}
