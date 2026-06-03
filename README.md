# claude-session-cost

A CLI tool that analyzes [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session transcripts and generates productivity metrics. It reads `.jsonl` transcript files from `~/.claude/projects/`, computes per-session statistics (tokens, tool calls, timing, success rate), and produces an interactive HTML report with charts and sortable tables.

## What it does

- **Discovers sessions** in `~/.claude/projects/` filtered by date range and project name
- **Parses transcripts** to extract user prompts, assistant responses, token counts, and tool calls
- **Classifies turns** as success or retry using heuristics (or optionally AI-powered classification via Claude Haiku)
- **Computes metrics** including inference time, success probability, tokens per outcome, and an overall efficiency score
- **Generates reports** as an interactive dark-themed HTML page with Chart.js visualizations, or as raw JSON

### HTML report includes

- Summary stats (sessions, turns, tokens, tool calls, success rate)
- Charts: success score trend, time breakdown, success probability, tokens per prompt, turns per session
- Sortable session table with per-session metrics
- Tool call and skill call breakdowns

## Prerequisites

- **Node.js** v24+ (ES2024 target)
- **pnpm** v11+ (`corepack enable` to activate)
- For `--ai-classify`: the `claude` CLI must be installed and authenticated

## Install

```bash
git clone <repo-url>
cd claude-session-cost
pnpm install
```

## Build

```bash
pnpm build          # compiles TypeScript to dist/
```

## Usage

### Development (no build required)

```bash
pnpm dev [options]
```

### Production

```bash
pnpm build
pnpm start [options]
# or directly:
node dist/cli.js [options]
```

### Global install

```bash
pnpm link --global
claude-session-cost [options]
```

### Options

| Option | Default | Description |
|---|---|---|
| `--since <date>` | `14d` | Start date -- ISO 8601 or relative (`14d`, `7d`, `24h`, `30m`) |
| `--until <date>` | `now` | End date -- ISO 8601 or relative |
| `--project <name>` | all | Filter to projects matching substring |
| `--exclude <pattern>` | none | Exclude projects matching substring (repeatable) |
| `--ai-classify` | off | Classify turns with Claude Haiku instead of heuristics |
| `--json` | off | Output raw JSON instead of HTML |
| `--no-open` | off | Don't auto-open the HTML report in your browser |
| `--out <path>` | `/tmp/claude-session-cost.html` | Output file path |

### Examples

```bash
# Default: last 14 days, all projects, open HTML report
pnpm dev

# Last 7 days
pnpm dev --since 7d

# Specific project
pnpm dev --project my-app

# Exclude test projects
pnpm dev --exclude test --exclude scratch

# AI-powered turn classification
pnpm dev --ai-classify

# Export JSON
pnpm dev --json --out metrics.json

# Fixed date range
pnpm dev --since 2025-05-01 --until 2025-05-31
```

## Console output

The tool prints a formatted table to the terminal:

```
Session                                        Turns  Tools  T/Turn     I       C     P   Score  Tok/Ok  Tok/Fail  Tok/Tool  Tokens
fix auth token refresh                            12     47    3.9   4m30s   2m10s   83%   0.42    8.2k     12.1k     2.1k    98k
add search endpoint                                8     31    3.9   3m05s   1m45s   88%   0.35    7.5k      9.8k     1.9k    72k
```

Columns: **I** = inference time, **C** = check/write time (gap between turns), **P** = success probability, **Score** = efficiency score (lower is better), **Tok/Ok** and **Tok/Fail** = avg tokens per successful and failed turn.

## How it works

```
~/.claude/projects/**/*.jsonl
        |
  discoverSessions()    find .jsonl files matching date/project filters
        |
  parseSession()        extract turns, tokens, tool calls from each file
        |
  classifyTurnBatch()   heuristic or AI classification (success vs retry)
        |
  computeMetrics()      timing, success rate, token efficiency
        |
  generateReport()      HTML report with charts, or JSON output
        |
  open in browser
```

## Project structure

```
src/
  cli.ts            CLI entry point and argument parsing
  discovery.ts      Session file discovery and filtering
  parser.ts         JSONL transcript parsing and turn extraction
  classifier.ts     Turn classification (heuristic + AI)
  metrics.ts        Metrics computation
  report.ts         HTML report generation with Chart.js
  types.ts          TypeScript type definitions
```

## License

MIT
