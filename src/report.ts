import type { SessionMetrics, ToolCallStat } from "./types.ts";

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

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateReport(
  sessions: SessionMetrics[],
  since: Date,
  until: Date,
  toolStats?: ToolCallStat[],
  skillStats?: ToolCallStat[]
): string {
  const sorted = [...sessions].sort(
    (a, b) =>
      (a.firstTimestamp?.getTime() ?? 0) - (b.firstTimestamp?.getTime() ?? 0)
  );

  const totalTurns = sorted.reduce((s, m) => s + m.turnCount, 0);
  const totalTokens = sorted.reduce((s, m) => s + m.totalTokens, 0);
  const avgP =
    sorted.length > 0
      ? sorted.reduce((s, m) => s + m.probability, 0) / sorted.length
      : 0;

  const chartLabels = JSON.stringify(
    sorted.map((s) => truncate(s.title, 30))
  );
  const successScores = JSON.stringify(
    sorted.map((s) => Math.round(s.successScore))
  );
  const inferenceTimes = JSON.stringify(
    sorted.map((s) => +(s.inferenceTimeMs / 60000).toFixed(1))
  );
  const checkWriteTimes = JSON.stringify(
    sorted.map((s) => +(s.checkWriteTimeMs / 60000).toFixed(1))
  );
  const probabilities = JSON.stringify(
    sorted.map((s) => Math.round(s.probability * 100))
  );
  const avgTokensSuccess = JSON.stringify(
    sorted.map((s) => Math.round(s.avgTokensPerSuccess))
  );
  const avgTokensFailure = JSON.stringify(
    sorted.map((s) => Math.round(s.avgTokensPerFailure))
  );
  const turnCounts = JSON.stringify(sorted.map((s) => s.turnCount));

  const totalCallCount = toolStats?.reduce((s, t) => s + t.count, 0) ?? 0;
  const totalToolTokens = toolStats?.reduce((s, t) => s + t.totalTokens, 0) ?? 0;
  const toolTableRows = (toolStats ?? [])
    .map(
      (t) => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td class="num">${t.count}</td>
      <td class="num">${((t.count / totalCallCount) * 100).toFixed(1)}%</td>
      <td class="num">${formatNumber(t.totalTokens)}</td>
      <td class="num">${((t.totalTokens / totalToolTokens) * 100).toFixed(1)}%</td>
      <td class="num">${formatNumber(t.totalTokens / t.count)}</td>
    </tr>`
    )
    .join("");

  const totalSkillCount = skillStats?.reduce((s, t) => s + t.count, 0) ?? 0;
  const totalSkillTokens = skillStats?.reduce((s, t) => s + t.totalTokens, 0) ?? 0;
  const skillTableRows = (skillStats ?? [])
    .map(
      (t) => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td class="num">${t.count}</td>
      <td class="num">${totalSkillCount > 0 ? ((t.count / totalSkillCount) * 100).toFixed(1) : 0}%</td>
      <td class="num">${formatNumber(t.totalTokens)}</td>
      <td class="num">${totalSkillTokens > 0 ? ((t.totalTokens / totalSkillTokens) * 100).toFixed(1) : 0}%</td>
      <td class="num">${formatNumber(t.totalTokens / t.count)}</td>
    </tr>`
    )
    .join("");

  const tableRows = sorted
    .map(
      (s) => `
    <tr>
      <td title="${escapeHtml(s.title)}">${escapeHtml(truncate(s.title, 45))}</td>
      <td>${escapeHtml(s.projectName)}</td>
      <td>${formatDate(s.firstTimestamp)}</td>
      <td class="num">${s.turnCount}</td>
      <td class="num">${s.totalToolCalls}</td>
      <td class="num">${s.avgToolCallsPerTurn.toFixed(1)}</td>
      <td class="num">${formatDuration(s.inferenceTimeMs)}</td>
      <td class="num">${formatDuration(s.checkWriteTimeMs)}</td>
      <td class="num">${(s.probability * 100).toFixed(0)}%</td>
      <td class="num">${formatNumber(s.successScore)}</td>
      <td class="num">${formatNumber(s.avgTokensPerSuccess)}</td>
      <td class="num">${s.avgTokensPerFailure > 0 ? formatNumber(s.avgTokensPerFailure) : "—"}</td>
      <td class="num">${s.avgTokensPerToolCall > 0 ? formatNumber(s.avgTokensPerToolCall) : "—"}</td>
      <td class="num">${formatNumber(s.totalTokens)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Claude Session Cost Analysis</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --orange: #d29922; --red: #f85149; --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; scroll-padding-top: 56px; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; line-height: 1.5; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: var(--text-dim); margin-bottom: 24px; font-size: 14px; }
  .stats { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; min-width: 140px; }
  .stat-value { font-size: 24px; font-weight: 600; color: var(--accent); }
  .stat-label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .chart-card h3 { font-size: 14px; color: var(--text-dim); margin-bottom: 12px; }
  canvas { width: 100% !important; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--border); color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; user-select: none; }
  th:hover { color: var(--accent); }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover { background: var(--surface); }
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .table-wrap h2 { padding: 16px 20px 0; font-size: 16px; }
  nav { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); margin: -24px -24px 24px; padding: 12px 24px; display: flex; gap: 24px; align-items: center; }
  nav a { color: var(--text-dim); text-decoration: none; font-size: 13px; font-weight: 500; transition: color 0.15s; }
  nav a:hover, nav a.active { color: var(--accent); }
  nav .nav-title { color: var(--text); font-weight: 600; font-size: 14px; margin-right: 8px; }
  @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<nav>
  <span class="nav-title">Session Cost</span>
  <a href="#summary">Summary</a>
  <a href="#charts">Charts</a>
  <a href="#sessions">Sessions</a>
  <a href="#tools">Tools</a>
  <a href="#skills">Skills</a>
</nav>

<h1 id="summary">Claude Session Cost Analysis</h1>
<p class="subtitle">${formatDate(since)} — ${formatDate(until)} &middot; ${sorted.length} sessions</p>

<div class="stats">
  <div class="stat"><div class="stat-value">${sorted.length}</div><div class="stat-label">Sessions</div></div>
  <div class="stat"><div class="stat-value">${totalTurns}</div><div class="stat-label">Total Turns</div></div>
  <div class="stat"><div class="stat-value">${formatNumber(totalTokens)}</div><div class="stat-label">Total Tokens</div></div>
  <div class="stat"><div class="stat-value">${formatNumber(sorted.reduce((s, m) => s + m.totalToolCalls, 0))}</div><div class="stat-label">Tool Calls</div></div>
  <div class="stat"><div class="stat-value">${(avgP * 100).toFixed(0)}%</div><div class="stat-label">Avg Success Rate</div></div>
</div>

<div class="charts" id="charts">
  <div class="chart-card">
    <h3>Success Score per Session (lower = better)</h3>
    <canvas id="successChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Time Breakdown: Inference vs Check/Write (minutes)</h3>
    <canvas id="timeChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Success Probability Trend (%)</h3>
    <canvas id="probChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Avg Tokens per Prompt: Success vs Failure</h3>
    <canvas id="tokenChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Turns per Session over Time</h3>
    <canvas id="turnsChart"></canvas>
  </div>
</div>

<div class="table-wrap" id="sessions">
<h2>All Sessions</h2>
<table id="sessionsTable">
<thead>
<tr>
  <th data-col="0">Title</th>
  <th data-col="1">Project</th>
  <th data-col="2">Date</th>
  <th data-col="3">Turns</th>
  <th data-col="4">Tools</th>
  <th data-col="5">Tools/Turn</th>
  <th data-col="6">Inference (I)</th>
  <th data-col="7">Check/Write (C)</th>
  <th data-col="8">P</th>
  <th data-col="9">Score</th>
  <th data-col="10">Tok/Success</th>
  <th data-col="11">Tok/Failure</th>
  <th data-col="12">Tok/Tool</th>
  <th data-col="13">Tokens</th>
</tr>
</thead>
<tbody>${tableRows}
</tbody>
</table>
</div>

<div class="table-wrap" id="tools" style="margin-top: 24px">
<h2>Tool Call Breakdown</h2>
<table id="toolsTable">
<thead>
<tr>
  <th data-col="0">Tool</th>
  <th data-col="1">Calls</th>
  <th data-col="2">% Calls</th>
  <th data-col="3">Tokens</th>
  <th data-col="4">% Tokens</th>
  <th data-col="5">Tok/Call</th>
</tr>
</thead>
<tbody>${toolTableRows}
</tbody>
</table>
</div>

<div class="table-wrap" id="skills" style="margin-top: 24px">
<h2>Skill Call Breakdown</h2>
<table id="skillsTable">
<thead>
<tr>
  <th data-col="0">Skill</th>
  <th data-col="1">Calls</th>
  <th data-col="2">% Calls</th>
  <th data-col="3">Tokens</th>
  <th data-col="4">% Tokens</th>
  <th data-col="5">Tok/Call</th>
</tr>
</thead>
<tbody>${skillTableRows}
</tbody>
</table>
</div>

<script>
const labels = ${chartLabels};
const successScores = ${successScores};
const inferenceTimes = ${inferenceTimes};
const checkWriteTimes = ${checkWriteTimes};
const probabilities = ${probabilities};
const avgTokensSuccess = ${avgTokensSuccess};
const avgTokensFailure = ${avgTokensFailure};
const turnCounts = ${turnCounts};

Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

new Chart(document.getElementById('successChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [{
      data: successScores,
      backgroundColor: successScores.map(v => {
        if (v < 100) return '#3fb950';
        if (v < 1000) return '#d29922';
        return '#f85149';
      }),
      borderRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxRotation: 45, font: { size: 10 } } },
      y: { type: 'logarithmic', title: { display: true, text: 'Score (log)' } }
    }
  }
});

new Chart(document.getElementById('timeChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'Inference (I)', data: inferenceTimes, backgroundColor: '#58a6ff', borderRadius: 4 },
      { label: 'Check/Write (C)', data: checkWriteTimes, backgroundColor: '#bc8cff', borderRadius: 4 }
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { stacked: true, ticks: { maxRotation: 45, font: { size: 10 } } },
      y: { type: 'logarithmic', stacked: true, title: { display: true, text: 'Minutes (log)' } }
    }
  }
});

new Chart(document.getElementById('probChart'), {
  type: 'line',
  data: {
    labels,
    datasets: [{
      data: probabilities,
      borderColor: '#3fb950',
      backgroundColor: 'rgba(63, 185, 80, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxRotation: 45, font: { size: 10 } } },
      y: { min: 0, max: 100, title: { display: true, text: '% Correct' } }
    }
  }
});

new Chart(document.getElementById('tokenChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'Avg Tokens / Success', data: avgTokensSuccess, backgroundColor: '#3fb950', borderRadius: 4 },
      { label: 'Avg Tokens / Failure', data: avgTokensFailure, backgroundColor: '#f85149', borderRadius: 4 }
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { ticks: { maxRotation: 45, font: { size: 10 } } },
      y: { type: 'logarithmic', title: { display: true, text: 'Tokens (log)' } }
    }
  }
});

new Chart(document.getElementById('turnsChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [{
      data: turnCounts,
      backgroundColor: '#58a6ff',
      borderRadius: 4,
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxRotation: 45, font: { size: 10 } } },
      y: { type: 'logarithmic', title: { display: true, text: 'Turns (log)' } }
    }
  }
});

// Table sorting
document.querySelectorAll('#sessionsTable th, #toolsTable th, #skillsTable th').forEach(th => {
  th.addEventListener('click', () => {
    const col = +th.dataset.col;
    const tbody = th.closest('table').querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const asc = th.classList.toggle('asc');
    rows.sort((a, b) => {
      const av = a.children[col].textContent.trim();
      const bv = b.children[col].textContent.trim();
      const an = parseFloat(av.replace(/[^0-9.-]/g, ''));
      const bn = parseFloat(bv.replace(/[^0-9.-]/g, ''));
      if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    rows.forEach(r => tbody.appendChild(r));
  });
});

// Active nav link on scroll
const navLinks = document.querySelectorAll('nav a[href^="#"]');
const sections = Array.from(navLinks).map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
    }
  }
}, { rootMargin: '-56px 0px -60% 0px' });
sections.forEach(s => observer.observe(s));
</script>
</body>
</html>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
