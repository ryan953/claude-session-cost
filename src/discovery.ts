import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { SessionFile } from "./types.ts";

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");

export function projectDisplayName(dirName: string): string {
  const home = basename(homedir());
  const prefix = `-Users-${home}-`;
  let name = dirName;
  if (name.startsWith(prefix)) {
    name = name.slice(prefix.length);
  } else if (name.startsWith("-")) {
    name = name.slice(1);
  }
  return name.replace(/-/g, "/");
}

export function discoverSessions(
  since: Date,
  until: Date,
  projectFilter?: string,
  excludePatterns?: string[]
): SessionFile[] {
  const results: SessionFile[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(PROJECTS_ROOT);
  } catch {
    console.error(`Cannot read ${PROJECTS_ROOT}`);
    return results;
  }

  for (const projectDir of projectDirs) {
    const displayName = projectDisplayName(projectDir);
    if (projectFilter && !displayName.includes(projectFilter)) {
      continue;
    }
    if (excludePatterns?.some((p) => displayName.includes(p))) {
      continue;
    }

    const projectPath = join(PROJECTS_ROOT, projectDir);
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
      });
    }
  }

  return results.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
}
