import { program } from "commander";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { discoverSessions } from "./discovery.ts";
import { parseSession } from "./parser.ts";
import { computeMetrics } from "./metrics.ts";
import { classifyTurnBatch } from "./classifier.ts";
import { generateReport } from "./report.ts";
import type { SessionData, SessionMetrics, ToolCallStat } from "./types.ts";

function parseRelativeDate(input: string): Date {
  const match = input.match(/^(\d+)(d|h|m)$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const now = new Date();
    switch (unit) {
      case "d":
        return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
      case "h":
        return new Date(now.getTime() - value * 60 * 60 * 1000);
      case "m":
        return new Date(now.getTime() - value * 60 * 1000);
    }
  }
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    console.error(
      `Invalid date: "${input}". Use ISO 8601 or relative format (14d, 24h, 30m).`
    );
    process.exit(1);
  }
  return date;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remaining = sec % 60;
  return `${min}m ${remaining.toFixed(0)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

program
  .name("claude-session-cost")
  .description("Analyze Claude Code session transcripts for productivity metrics")
  .option("--since <date>", "Start date (ISO or relative: 14d, 7d, 24h)", "14d")
  .option("--until <date>", "End date (ISO or relative, default: now)")
  .option("--project <name>", "Filter to project directory (substring match)")
  .option("--exclude <pattern>", "Exclude projects matching pattern (substring, repeatable)", (val: string, prev: string[]) => prev.concat(val), [] as string[])
  .option("--ai-classify", "Use Claude CLI (Haiku) to classify turns")
  .option("--json", "Output raw JSON instead of HTML report")
  .option("--no-open", "Don't auto-open the HTML report")
  .option("--out <path>", "Output file path", "/tmp/claude-session-cost.html")
  .action(async (opts) => {
    const since = parseRelativeDate(opts.since);
    const until = opts.until ? parseRelativeDate(opts.until) : new Date();

    console.log(
      `Scanning sessions from ${since.toLocaleDateString()} to ${until.toLocaleDateString()}...`
    );

    const sessionFiles = discoverSessions(since, until, opts.project, opts.exclude);
    if (sessionFiles.length === 0) {
      console.log("No sessions found in the specified date range.");
      return;
    }
    const claudeCount = sessionFiles.filter(s => s.source === "claude").length;
    const cursorCount = sessionFiles.filter(s => s.source === "cursor").length;
    const sourceSummary = [
      claudeCount > 0 ? `${claudeCount} Claude` : "",
      cursorCount > 0 ? `${cursorCount} Cursor` : "",
    ].filter(Boolean).join(", ");
    console.log(`Found ${sessionFiles.length} session files (${sourceSummary}). Parsing...`);

    const parsedSessions: SessionData[] = [];
    const globalToolStats = new Map<string, { count: number; totalTokens: number }>();
    const globalSkillStats = new Map<string, { count: number; totalTokens: number }>();
    for (const sf of sessionFiles) {
      try {
        const session = await parseSession(sf);
        if (session.turns.length === 0) continue;
        parsedSessions.push(session);
        for (const [name, stat] of session.toolCallsByName) {
          const existing = globalToolStats.get(name);
          if (existing) {
            existing.count += stat.count;
            existing.totalTokens += stat.totalTokens;
          } else {
            globalToolStats.set(name, { count: stat.count, totalTokens: stat.totalTokens });
          }
        }
        for (const [name, stat] of session.skillCallsByName) {
          const existing = globalSkillStats.get(name);
          if (existing) {
            existing.count += stat.count;
            existing.totalTokens += stat.totalTokens;
          } else {
            globalSkillStats.set(name, { count: stat.count, totalTokens: stat.totalTokens });
          }
        }
      } catch (err) {
        console.error(`  Error parsing ${sf.sessionId}: ${err}`);
      }
    }

    if (parsedSessions.length === 0) {
      console.log("No sessions with turns found.");
      return;
    }

    // Classify turns (AI or heuristic)
    let classificationsBySession: Map<string, Array<"success" | "retry">> | undefined;
    if (opts.aiClassify) {
      const allTurnPairs: Array<{ sessionId: string; currentPrompt: string; nextPrompt: string | null }> = [];
      for (const session of parsedSessions) {
        for (let i = 0; i < session.turns.length; i++) {
          allTurnPairs.push({
            sessionId: session.sessionId,
            currentPrompt: session.turns[i].promptText,
            nextPrompt: i < session.turns.length - 1 ? session.turns[i + 1].promptText : null,
          });
        }
      }
      console.log(`Classifying ${allTurnPairs.length} turns with AI...`);
      const allClassifications = await classifyTurnBatch(
        allTurnPairs.map((t) => ({ currentPrompt: t.currentPrompt, nextPrompt: t.nextPrompt })),
        (done, total) => {
          if (process.stdout.isTTY) {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(`  Classified ${done}/${total} turns`);
          }
        }
      );
      if (process.stdout.isTTY) console.log();
      console.log(`  Classification complete.`);

      classificationsBySession = new Map();
      let offset = 0;
      for (const session of parsedSessions) {
        classificationsBySession.set(
          session.sessionId,
          allClassifications.slice(offset, offset + session.turns.length)
        );
        offset += session.turns.length;
      }
    }

    const allMetrics: SessionMetrics[] = [];
    for (const session of parsedSessions) {
      const classifications = classificationsBySession?.get(session.sessionId);
      allMetrics.push(computeMetrics(session, classifications));
    }

    console.log(`Analyzed ${allMetrics.length} sessions.\n`);

    if (opts.json) {
      const output = JSON.stringify(allMetrics, null, 2);
      if (opts.out && opts.out !== "/tmp/claude-session-cost.html") {
        writeFileSync(opts.out, output);
        console.log(`JSON written to ${opts.out}`);
      } else {
        console.log(output);
      }
      return;
    }

    // Print summary table to console
    console.log(
      "Session".padEnd(48) +
        "Turns".padStart(6) +
        "Tools".padStart(7) +
        "T/Turn".padStart(7) +
        "I".padStart(10) +
        "C".padStart(10) +
        "P".padStart(6) +
        "Score".padStart(10) +
        "Tok/Ok".padStart(9) +
        "Tok/Fail".padStart(9) +
        "Tok/Tool".padStart(9) +
        "Tokens".padStart(10)
    );
    console.log("─".repeat(141));

    const sorted = [...allMetrics].sort(
      (a, b) =>
        (a.firstTimestamp?.getTime() ?? 0) - (b.firstTimestamp?.getTime() ?? 0)
    );

    for (const m of sorted) {
      const title =
        m.title.length > 45 ? m.title.slice(0, 44) + "…" : m.title;
      console.log(
        title.padEnd(48) +
          String(m.turnCount).padStart(6) +
          String(m.totalToolCalls).padStart(7) +
          m.avgToolCallsPerTurn.toFixed(1).padStart(7) +
          formatDuration(m.inferenceTimeMs).padStart(10) +
          formatDuration(m.checkWriteTimeMs).padStart(10) +
          `${(m.probability * 100).toFixed(0)}%`.padStart(6) +
          formatNumber(m.successScore).padStart(10) +
          formatNumber(m.avgTokensPerSuccess).padStart(9) +
          (m.avgTokensPerFailure > 0 ? formatNumber(m.avgTokensPerFailure) : "—").padStart(9) +
          (m.avgTokensPerToolCall > 0 ? formatNumber(m.avgTokensPerToolCall) : "—").padStart(9) +
          formatNumber(m.totalTokens).padStart(10)
      );
    }

    console.log("─".repeat(141));
    const totalTokens = sorted.reduce((s, m) => s + m.totalTokens, 0);
    const totalTurns = sorted.reduce((s, m) => s + m.turnCount, 0);
    const totalTools = sorted.reduce((s, m) => s + m.totalToolCalls, 0);
    console.log(
      "TOTAL".padEnd(48) +
        String(totalTurns).padStart(6) +
        String(totalTools).padStart(7) +
        "".padStart(7) +
        "".padStart(10) +
        "".padStart(10) +
        "".padStart(6) +
        "".padStart(10) +
        "".padStart(9) +
        "".padStart(9) +
        "".padStart(9) +
        formatNumber(totalTokens).padStart(10)
    );

    // Print tool call breakdown
    const toolStats: ToolCallStat[] = Array.from(globalToolStats.entries())
      .map(([name, s]) => ({ name, count: s.count, totalTokens: s.totalTokens }))
      .sort((a, b) => b.count - a.count);

    const totalToolTokens = toolStats.reduce((s, t) => s + t.totalTokens, 0);

    console.log("\n\nTool Call Breakdown");
    console.log(
      "Tool".padEnd(35) +
        "Calls".padStart(8) +
        "% Calls".padStart(9) +
        "Tokens".padStart(10) +
        "% Tokens".padStart(10) +
        "Tok/Call".padStart(10)
    );
    console.log("─".repeat(82));
    const totalCallCount = toolStats.reduce((s, t) => s + t.count, 0);
    for (const t of toolStats) {
      console.log(
        t.name.padEnd(35) +
          String(t.count).padStart(8) +
          `${((t.count / totalCallCount) * 100).toFixed(1)}%`.padStart(9) +
          formatNumber(t.totalTokens).padStart(10) +
          `${((t.totalTokens / totalToolTokens) * 100).toFixed(1)}%`.padStart(10) +
          formatNumber(t.totalTokens / t.count).padStart(10)
      );
    }

    // Print skill call breakdown
    const skillStats: ToolCallStat[] = Array.from(globalSkillStats.entries())
      .map(([name, s]) => ({ name, count: s.count, totalTokens: s.totalTokens }))
      .sort((a, b) => b.count - a.count);

    if (skillStats.length > 0) {
      const totalSkillTokens = skillStats.reduce((s, t) => s + t.totalTokens, 0);
      const totalSkillCount = skillStats.reduce((s, t) => s + t.count, 0);

      console.log("\n\nSkill Call Breakdown");
      console.log(
        "Skill".padEnd(35) +
          "Calls".padStart(8) +
          "% Calls".padStart(9) +
          "Tokens".padStart(10) +
          "% Tokens".padStart(10) +
          "Tok/Call".padStart(10)
      );
      console.log("─".repeat(82));
      for (const t of skillStats) {
        console.log(
          t.name.padEnd(35) +
            String(t.count).padStart(8) +
            `${((t.count / totalSkillCount) * 100).toFixed(1)}%`.padStart(9) +
            formatNumber(t.totalTokens).padStart(10) +
            `${((t.totalTokens / totalSkillTokens) * 100).toFixed(1)}%`.padStart(10) +
            formatNumber(t.totalTokens / t.count).padStart(10)
        );
      }
    }

    // Generate HTML report
    const html = generateReport(sorted, since, until, toolStats, skillStats);
    const outPath = opts.out.endsWith(".json")
      ? opts.out
      : opts.out;
    writeFileSync(outPath, html);
    console.log(`\nReport written to ${outPath}`);

    if (opts.open !== false) {
      try {
        execSync(`open "${outPath}"`, { stdio: "ignore" });
      } catch {
        console.log(`Open the report manually: ${outPath}`);
      }
    }
  });

program.parse();
