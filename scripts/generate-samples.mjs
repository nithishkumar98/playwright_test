#!/usr/bin/env node
/**
 * Generates realistic sample reports in the Playwright JSON reporter format
 * (https://playwright.dev/docs/test-reporters#json-reporter) into storage/reports/,
 * then rebuilds storage/manifest.json.
 *
 *   node scripts/generate-samples.mjs            # 6 runs (default)
 *   node scripts/generate-samples.mjs --runs 10
 *
 * Output is deterministic (seeded PRNG), so re-running produces the same files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'storage', 'reports');

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 6;

// ---------- seeded PRNG ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(42);
const between = (a, b) => Math.round(a + rand() * (b - a));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------- the "app under test" ----------
// Each test: [title, tags, baseDurationMs, risk] — risk ∈ stable | flaky | fragile | broken | skip
const CATALOG = [
  {
    file: 'auth/login.spec.ts',
    describe: 'Login',
    tests: [
      ['should log in with valid credentials', ['@smoke', '@critical'], 2400, 'stable'],
      ['should show an error for a wrong password', ['@smoke'], 1800, 'stable'],
      ['should lock the account after 5 failed attempts', ['@regression'], 6200, 'fragile'],
      ['should remember the user with "Keep me signed in"', ['@regression'], 3100, 'flaky'],
      ['should redirect to SSO for enterprise domains', ['@regression', '@sso'], 4200, 'flaky'],
    ],
  },
  {
    file: 'auth/logout.spec.ts',
    describe: 'Logout',
    tests: [
      ['should clear the session on logout', ['@smoke'], 1500, 'stable'],
      ['should log out all tabs at once', ['@regression'], 3900, 'flaky'],
    ],
  },
  {
    file: 'dashboard/widgets.spec.ts',
    describe: 'Dashboard',
    nested: 'Widgets',
    tests: [
      ['should render the KPI tiles', ['@smoke'], 2200, 'stable'],
      ['should refresh the queue widget every 10s', ['@regression'], 11200, 'fragile'],
      ['should let users rearrange widgets by drag and drop', ['@regression', '@dnd'], 5400, 'flaky'],
      ['should persist widget layout across reloads', ['@regression'], 3600, 'stable'],
      ['should show an empty state when there is no data', ['@regression'], 1400, 'stable'],
    ],
  },
  {
    file: 'tasks/inbox.spec.ts',
    describe: 'Task inbox',
    tests: [
      ['should list incoming tasks in arrival order', ['@smoke', '@critical'], 2900, 'stable'],
      ['should accept a task and open the workspace', ['@smoke', '@critical'], 3300, 'fragile'],
      ['should decline a task with a reason code', ['@regression'], 2600, 'stable'],
      ['should play a notification sound on new task', ['@regression', '@a11y'], 1900, 'skip'],
      ['should filter tasks by channel', ['@regression'], 2100, 'stable'],
    ],
  },
  {
    file: 'tasks/transfer.spec.ts',
    describe: 'Task transfer',
    tests: [
      ['should transfer a task to another queue', ['@regression', '@critical'], 4800, 'flaky'],
      ['should consult before transferring', ['@regression'], 6900, 'broken'],
      ['should block transfer to an offline agent', ['@regression'], 2300, 'stable'],
    ],
  },
  {
    file: 'settings/profile.spec.ts',
    describe: 'Profile settings',
    tests: [
      ['should update the display name', ['@regression'], 1700, 'stable'],
      ['should upload an avatar image', ['@regression'], 3400, 'fragile'],
      ['should validate the phone number format', ['@regression'], 1200, 'stable'],
      ['should switch between light and dark theme', ['@regression', '@a11y'], 1600, 'stable'],
    ],
  },
  {
    file: 'search/global-search.spec.ts',
    describe: 'Global search',
    tests: [
      ['should return results as the user types', ['@smoke'], 2700, 'stable'],
      ['should highlight matched terms', ['@regression'], 1900, 'stable'],
      ['should support keyboard navigation of results', ['@regression', '@a11y'], 2500, 'flaky'],
      ['should show recent searches', ['@regression'], 1300, 'skip'],
    ],
  },
  {
    file: 'api/health.spec.ts',
    describe: 'API health',
    tests: [
      ['GET /health returns 200', ['@smoke', '@api'], 350, 'stable'],
      ['GET /config returns the tenant config', ['@api'], 620, 'stable'],
      ['POST /tasks rejects an invalid payload', ['@api'], 480, 'fragile'],
    ],
  },
];

const PROJECTS = ['chromium', 'firefox', 'webkit'];
const BRANCHES = ['main', 'main', 'main', 'feature/task-transfer', 'fix/login-lockout'];

const ERRORS = [
  (sel) => ({
    message: `Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoBeVisible\u001b[2m()\u001b[22m\n\nLocator: ${sel}\nExpected: visible\nReceived: <element(s) not found>\nTimeout: 5000ms\n\nCall log:\n  - expect.toBeVisible with timeout 5000ms\n  - waiting for ${sel}`,
    kind: 'expect.toBeVisible',
  }),
  (sel) => ({
    message: `TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for ${sel}\n  - locator resolved to <button disabled class="btn btn-primary">…</button>\n  - attempting click action\n  - element is not enabled - waiting...`,
    kind: 'locator.click',
  }),
  () => ({
    message: `Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBe\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m) // Object.is equality\u001b[22m\n\nExpected: \u001b[32m200\u001b[39m\nReceived: \u001b[31m503\u001b[39m`,
    kind: 'expect.toBe',
  }),
  (sel) => ({
    message: `Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoHaveText\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m\n\nLocator: ${sel}\nExpected string: \u001b[32m"Transferred"\u001b[39m\nReceived string: \u001b[31m"Pending"\u001b[39m\nTimeout: 5000ms`,
    kind: 'expect.toHaveText',
  }),
  () => ({
    message: `Error: page.goto: net::ERR_CONNECTION_RESET at https://staging.example.app/desktop\nCall log:\n  - navigating to "https://staging.example.app/desktop", waiting until "load"`,
    kind: 'page.goto',
  }),
];
const SELECTORS = [
  "getByRole('button', { name: 'Accept' })",
  "getByTestId('queue-widget')",
  "locator('.toast-success')",
  "getByRole('dialog', { name: 'Transfer task' })",
  "getByLabel('Phone number')",
  "getByText('Welcome back')",
];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function hashId(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + slug(s).slice(0, 24);
}

/** Outcome of one test in one run. `quality` 0..1 = how healthy this run is. */
function outcome(risk, quality, project) {
  const webkitPenalty = project === 'webkit' ? 0.04 : 0;
  const r = rand();
  switch (risk) {
    case 'skip': return 'skipped';
    case 'broken': return r < 0.85 - quality * 0.5 ? 'failed' : r < 0.9 ? 'flaky' : 'passed';
    case 'fragile': return r < 0.18 - quality * 0.12 + webkitPenalty ? 'failed' : r < 0.26 ? 'flaky' : 'passed';
    case 'flaky': return r < 0.03 + webkitPenalty ? 'failed' : r < 0.3 - quality * 0.1 ? 'flaky' : 'passed';
    default: return r < 0.015 + webkitPenalty / 2 ? 'failed' : r < 0.03 ? 'flaky' : 'passed';
  }
}

function makeSteps(title, total, failIndex, err) {
  const actions = [
    'page.goto(/desktop)',
    `locator.fill(getByLabel('Search'))`,
    `locator.click(${pick(SELECTORS)})`,
    `expect.toBeVisible(${pick(SELECTORS)})`,
    'page.waitForResponse(/api/tasks)',
    `expect.toHaveURL(/workspace/)`,
  ];
  const n = between(3, 5);
  let chosen = [];
  for (let i = 0; i < n; i++) chosen.push(actions[(i + title.length) % actions.length]);
  if (failIndex > -1) {
    failIndex = Math.min(failIndex, chosen.length - 1);
    chosen = chosen.slice(0, failIndex + 1); // nothing runs after the failing step
    if (err?.sel) chosen[failIndex] = `${err.kind}(${err.sel})`;
  }
  const hookBefore = Math.round(total * 0.12);
  const hookAfter = Math.round(total * 0.06);
  let remaining = total - hookBefore - hookAfter;
  const steps = [
    {
      title: 'Before Hooks',
      duration: hookBefore,
      steps: [
        { title: 'fixture: browser', duration: Math.round(hookBefore * 0.5) },
        { title: 'fixture: context', duration: Math.round(hookBefore * 0.2) },
        { title: 'fixture: page', duration: Math.round(hookBefore * 0.3) },
      ],
    },
  ];
  chosen.forEach((t, i) => {
    const d = i === chosen.length - 1 ? remaining : Math.round(remaining * (0.15 + rand() * 0.3));
    remaining -= d;
    const step = { title: t, duration: Math.max(d, 8) };
    if (failIndex === i) step.error = { message: err.message };
    steps.push(step);
  });
  steps.push({ title: 'After Hooks', duration: hookAfter, steps: [{ title: 'fixture: page', duration: Math.round(hookAfter * 0.6) }] });
  return steps;
}

function makeResult({ status, retry, duration, start, file, line, title, project }) {
  const res = {
    workerIndex: between(0, 3),
    parallelIndex: between(0, 3),
    status,
    duration,
    errors: [],
    stdout: [],
    stderr: [],
    retry,
    startTime: new Date(start).toISOString(),
    annotations: [],
    attachments: [],
  };
  let failIndex = -1;
  let err;
  if (status === 'failed' || status === 'timedOut') {
    const sel = pick(SELECTORS);
    const e = { ...pick(ERRORS)(sel), sel };
    err = e;
    const errLine = line + between(3, 14);
    const location = { file: `/work/app/tests/${file}`, line: errLine, column: between(5, 30) };
    const stack = `${e.message.split('\n')[0]}\n    at /work/app/tests/${file}:${location.line}:${location.column}`;
    res.error = { message: e.message, stack, location, snippet: `  ${errLine - 1} |     await page.goto('/desktop');\n> ${errLine} |     await expect(page.${e.sel}).toBeVisible();\n    |                                     ^\n  ${errLine + 1} |   });` };
    res.errors = [{ message: e.message, location }];
    res.errorLocation = location;
    failIndex = between(1, 3);
    const base = `test-results/${slug(file)}-${slug(title).slice(0, 40)}-${project}${retry ? '-retry' + retry : ''}`;
    res.attachments = [
      { name: 'screenshot', contentType: 'image/png', path: `${base}/test-failed-1.png` },
      { name: 'video', contentType: 'video/webm', path: `${base}/video.webm` },
      { name: 'trace', contentType: 'application/zip', path: `${base}/trace.zip` },
    ];
    if (rand() < 0.5) res.stderr.push({ text: `[browser] console.error: Failed to load resource: the server responded with a status of 503 ()\n` });
  }
  if (rand() < 0.15) res.stdout.push({ text: `[${project}] tenant=qa-${between(1, 9)} agent=agent${between(100, 999)}@example.com\n` });
  res.steps = makeSteps(title, duration, failIndex, err);
  return res;
}

function buildRun(runIndex, totalRuns) {
  rand = mulberry32(1000 + runIndex * 7919);
  // Quality improves over time, with a dip in the middle (a "bad deploy").
  const quality = Math.min(1, runIndex / (totalRuns - 1)) * (runIndex === Math.floor(totalRuns / 2) ? 0.3 : 1);
  const day = 24 * 3600 * 1000;
  const startTime = Date.UTC(2026, 9, 15, 3, 30) - (totalRuns - 1 - runIndex) * day + between(0, 3600) * 1000;
  const branch = runIndex === totalRuns - 1 ? 'main' : pick(BRANCHES);
  const sha = Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');

  const stats = { startTime: new Date(startTime).toISOString(), duration: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  let clock = startTime;
  const suites = [];

  for (const spec of CATALOG) {
    const specs = [];
    spec.tests.forEach(([title, tags, base, risk], i) => {
      const line = 8 + i * 14;
      const tests = PROJECTS.map((project) => {
        const out = outcome(risk, quality, project);
        const pf = project === 'webkit' ? 1.25 : project === 'firefox' ? 1.12 : 1;
        const dur = () => Math.round(base * pf * (0.75 + rand() * 0.6));
        const results = [];
        let status;
        if (out === 'skipped') {
          results.push({ ...makeResult({ status: 'skipped', retry: 0, duration: 0, start: clock, file: spec.file, line, title, project }), steps: [] });
          status = 'skipped';
          stats.skipped++;
        } else if (out === 'passed') {
          results.push(makeResult({ status: 'passed', retry: 0, duration: dur(), start: clock, file: spec.file, line, title, project }));
          status = 'expected';
          stats.expected++;
        } else if (out === 'flaky') {
          results.push(makeResult({ status: rand() < 0.2 ? 'timedOut' : 'failed', retry: 0, duration: dur(), start: clock, file: spec.file, line, title, project }));
          results.push(makeResult({ status: 'passed', retry: 1, duration: dur(), start: clock + 20000, file: spec.file, line, title, project }));
          status = 'flaky';
          stats.flaky++;
        } else {
          results.push(makeResult({ status: 'failed', retry: 0, duration: dur(), start: clock, file: spec.file, line, title, project }));
          results.push(makeResult({ status: rand() < 0.25 ? 'timedOut' : 'failed', retry: 1, duration: dur(), start: clock + 20000, file: spec.file, line, title, project }));
          status = 'unexpected';
          stats.unexpected++;
        }
        clock += results.reduce((a, r) => a + r.duration, 0) / 3; // ~3 parallel workers
        const annotations = out === 'skipped' ? [{ type: 'skip', description: 'Blocked by audio permissions in CI' }] : [];
        if (risk === 'broken') annotations.push({ type: 'issue', description: 'https://github.com/example/app/issues/482' });
        return {
          timeout: 30000,
          annotations,
          expectedStatus: out === 'skipped' ? 'skipped' : 'passed',
          projectId: project,
          projectName: project,
          results,
          status,
        };
      });
      specs.push({
        title,
        ok: tests.every((t) => t.status !== 'unexpected'),
        tags: tags.map((t) => t.slice(1)),
        tests,
        id: hashId(spec.file + title),
        file: spec.file,
        line,
        column: 7,
      });
    });

    const describeSuite = spec.nested
      ? { title: spec.describe, file: spec.file, line: 3, column: 6, specs: [], suites: [{ title: spec.nested, file: spec.file, line: 5, column: 8, specs }] }
      : { title: spec.describe, file: spec.file, line: 3, column: 6, specs };
    suites.push({ title: spec.file, file: spec.file, column: 0, line: 0, specs: [], suites: [describeSuite] });
  }
  stats.duration = Math.round(clock - startTime + 4200);

  return {
    config: {
      configFile: '/work/app/playwright.config.ts',
      rootDir: '/work/app/tests',
      forbidOnly: true,
      fullyParallel: true,
      globalTimeout: 0,
      maxFailures: 0,
      metadata: {
        actualWorkers: 3,
        'ci.commit.sha': sha,
        'ci.branch': branch,
        'ci.buildHref': `https://ci.example.com/builds/${2400 + runIndex}`,
      },
      preserveOutput: 'always',
      reporter: [['json', { outputFile: 'storage/reports/results.json' }]],
      reportSlowTests: { max: 5, threshold: 15000 },
      quiet: false,
      projects: PROJECTS.map((p) => ({
        outputDir: '/work/app/test-results',
        repeatEach: 1,
        retries: 1,
        metadata: {},
        id: p,
        name: p,
        testDir: '/work/app/tests',
        testIgnore: [],
        testMatch: ['**/*.@(spec|test).?(c|m)[jt]s?(x)'],
        timeout: 30000,
      })),
      shard: null,
      updateSnapshots: 'missing',
      version: '1.48.2',
      workers: 3,
      webServer: null,
    },
    suites,
    errors: [],
    stats,
  };
}

mkdirSync(OUT, { recursive: true });
for (let i = 0; i < RUNS; i++) {
  const report = buildRun(i, RUNS);
  const d = new Date(report.stats.startTime);
  const name = `run-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  writeFileSync(join(OUT, name), JSON.stringify(report, null, 2));
  const s = report.stats;
  console.log(`${name}  passed=${s.expected} failed=${s.unexpected} flaky=${s.flaky} skipped=${s.skipped}`);
}
buildManifest();
