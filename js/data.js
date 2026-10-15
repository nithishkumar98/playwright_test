// Loading reports from storage/ and normalising the Playwright JSON reporter
// format into a flat list of test rows (one row per spec × project).
import { stripAnsi } from './util.js';

const STORAGE = 'storage/';
const cache = new Map(); // run.id -> normalized data

export async function loadManifest() {
  const res = await fetch(`${STORAGE}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${STORAGE}manifest.json (HTTP ${res.status}). Run "node scripts/build-manifest.mjs".`);
  const manifest = await res.json();
  return (manifest.runs ?? []).map((r) => ({ ...r, source: 'storage' }));
}

export async function loadRun(run) {
  if (cache.has(run.id)) return cache.get(run.id);
  let report = run.report;
  if (!report) {
    const res = await fetch(STORAGE + run.file);
    if (!res.ok) throw new Error(`Could not load ${STORAGE + run.file} (HTTP ${res.status})`);
    report = await res.json();
  }
  const data = normalize(report, run);
  cache.set(run.id, data);
  return data;
}

/** Turns an uploaded/dropped report into a run entry (kept in memory only). */
export function runFromReport(report, fileName) {
  if (!report || !Array.isArray(report.suites) || !report.stats) {
    throw new Error('That file is not a Playwright JSON report (missing "suites"/"stats"). Use the json reporter.');
  }
  const s = report.stats;
  const meta = report.config?.metadata ?? {};
  return {
    id: `local-${Date.now().toString(36)}`,
    file: fileName,
    label: fileName,
    source: 'local',
    report,
    startTime: s.startTime,
    duration: s.duration,
    stats: { passed: s.expected, failed: s.unexpected, flaky: s.flaky, skipped: s.skipped },
    branch: meta['ci.branch'] ?? meta.gitBranch ?? null,
    commit: meta['ci.commit.sha'] ?? meta.gitCommit ?? null,
    playwrightVersion: report.config?.version ?? null,
  };
}

function mapStatus(test) {
  switch (test.status) {
    case 'expected': return test.expectedStatus === 'skipped' ? 'skipped' : 'passed';
    case 'unexpected': return 'failed';
    case 'flaky': return 'flaky';
    case 'skipped': return 'skipped';
    default: {
      const last = test.results?.at(-1)?.status;
      if (last === 'passed') return 'passed';
      if (last === 'skipped') return 'skipped';
      return 'failed';
    }
  }
}

/** First line of an error, without ANSI codes — used for grouping and previews. */
export function errorSummary(message) {
  const lines = stripAnsi(message).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[0] ?? '';
}

function normalize(report, run) {
  const tests = [];
  const projectsFromConfig = (report.config?.projects ?? []).map((p) => p.name).filter(Boolean);

  const walk = (suite, path, file) => {
    const f = suite.file ?? file;
    // The top-level suite for each file has the file path as its title — leave it out of the describe path.
    const isFileSuite = !path.length && (suite.title === suite.file || suite.title === f);
    const nextPath = isFileSuite || !suite.title ? path : [...path, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const status = mapStatus(t);
        const failing = results.find((r) => r.error || r.errors?.length);
        const errMsg = failing?.error?.message ?? failing?.errors?.[0]?.message ?? '';
        const project = t.projectName || t.projectId || 'default';
        const titleTags = (spec.title.match(/@[\w-]+/g) ?? []).map((x) => x.slice(1));
        const tags = [...new Set([...(spec.tags ?? []), ...titleTags])];
        const describe = nextPath;
        const histKey = [spec.file ?? f, ...describe, spec.title, project].join(' › ');
        tests.push({
          key: `${spec.id ?? hash(histKey)}~${project}`,
          histKey,
          specKey: [spec.file ?? f, ...describe, spec.title].join(' › '),
          title: spec.title,
          describe,
          file: spec.file ?? f ?? '(unknown)',
          line: spec.line,
          column: spec.column,
          project,
          status,
          rawStatus: t.status,
          expectedStatus: t.expectedStatus,
          duration: results.reduce((a, r) => a + (r.duration ?? 0), 0),
          lastDuration: results.at(-1)?.duration ?? 0,
          retries: Math.max(0, results.length - 1),
          tags,
          annotations: [...(t.annotations ?? []), ...results.flatMap((r) => r.annotations ?? [])].filter(
            (a, i, arr) => arr.findIndex((b) => b.type === a.type && b.description === a.description) === i,
          ),
          results,
          error: errMsg ? errorSummary(errMsg) : '',
          timeout: t.timeout,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, nextPath, f);
  };
  for (const s of report.suites ?? []) walk(s, [], s.file);

  const files = [...new Set(tests.map((t) => t.file))].sort();
  const projects = [...new Set([...projectsFromConfig, ...tests.map((t) => t.project)])];
  const tags = [...new Set(tests.flatMap((t) => t.tags))].sort();
  const byKey = new Map(tests.map((t) => [t.key, t]));

  return {
    run,
    report,
    stats: report.stats ?? {},
    config: report.config ?? {},
    globalErrors: report.errors ?? [],
    tests,
    files,
    projects,
    tags,
    byKey,
  };
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
