import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { SessionFile, SessionSource } from "./types.ts";

const CLAUDE_PROJECTS_ROOT = join(homedir(), ".claude", "projects");
const CURSOR_PROJECTS_ROOT = join(homedir(), ".cursor", "projects");

export function projectDisplayName(dirName: string): string {
  const home = basename(homedir());
  const prefix = `-Users-${home}-`;
  const prefixNoDash = `Users-${home}-`;
  let name = dirName;
  if (name.startsWith(prefix)) {
    name = name.slice(prefix.length);
  } else if (name.startsWith(prefixNoDash)) {
    name = name.slice(prefixNoDash.length);
  } else if (name.startsWith("-")) {
    name = name.slice(1);
  }
  return name.replace(/-/g, "/");
}

function discoverClaudeSessions(
  since: Date,
  until: Date,
  projectFilter?: string,
  excludePatterns?: string[]
): SessionFile[] {
  return discoverFromRoot(CLAUDE_PROJECTS_ROOT, "claude", since, until, projectFilter, excludePatterns);
}

function discoverCursorSessions(
  since: Date,
  until: Date,
  projectFilter?: string,
  excludePatterns?: string[]
): SessionFile[] {
  const results: SessionFile[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CURSOR_PROJECTS_ROOT);
  } catch {
    return results;
  }

  for (const projectDir of projectDirs) {
    const displayName = projectDisplayName(projectDir);
    if (projectFilter && !displayName.includes(projectFilter)) continue;
    if (excludePatterns?.some((p) => displayName.includes(p))) continue;

    const transcriptsPath = join(CURSOR_PROJECTS_ROOT, projectDir, "agent-transcripts");
    let sessionDirs: string[];
    try {
      sessionDirs = readdirSync(transcriptsPath);
    } catch {
      continue;
    }

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(transcriptsPath, sessionDir);
      let stat;
      try {
        stat = statSync(sessionPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const filePath = join(sessionPath, `${sessionDir}.jsonl`);
      let fileStat;
      try {
        fileStat = statSync(filePath);
      } catch {
        continue;
      }

      if (fileStat.mtime < since || fileStat.mtime > until) continue;

      results.push({
        filePath,
        projectDir,
        projectName: projectDisplayName(projectDir),
        sessionId: sessionDir,
        mtime: fileStat.mtime,
        source: "cursor",
      });
    }
  }

  return results;
}

function discoverFromRoot(
  root: string,
  source: SessionSource,
  since: Date,
  until: Date,
  projectFilter?: string,
  excludePatterns?: string[]
): SessionFile[] {
  const results: SessionFile[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return results;
  }

  for (const projectDir of projectDirs) {
    const displayName = projectDisplayName(projectDir);
    if (projectFilter && !displayName.includes(projectFilter)) continue;
    if (excludePatterns?.some((p) => displayName.includes(p))) continue;

    const projectPath = join(root, projectDir);
    let stat;
    try {
      stat = statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, file);
      let fileStat;
      try {
        fileStat = statSync(filePath);
      } catch {
        continue;
      }

      if (fileStat.mtime < since || fileStat.mtime > until) continue;

      const sessionId = file.replace(".jsonl", "");
      results.push({
        filePath,
        projectDir,
        projectName: projectDisplayName(projectDir),
        sessionId,
        mtime: fileStat.mtime,
        source,
      });
    }
  }

  return results;
}

export function discoverSessions(
  since: Date,
  until: Date,
  projectFilter?: string,
  excludePatterns?: string[]
): SessionFile[] {
  const claude = discoverClaudeSessions(since, until, projectFilter, excludePatterns);
  const cursor = discoverCursorSessions(since, until, projectFilter, excludePatterns);
  return [...claude, ...cursor].sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
}
