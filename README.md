# Playwright Report Dashboard

A zero-build dashboard (plain HTML, CSS and JavaScript modules) for browsing and filtering
[Playwright JSON reports](https://playwright.dev/docs/test-reporters#json-reporter) kept in `storage/`.

## Quick start

```bash
npm start            # serves the folder at http://localhost:4173
```

- No install needed to view the dashboard — `npm start` uses a tiny built-in Node server
- Any static server works too: `npx serve .` or `python3 -m http.server 8080`
- Opening `index.html` straight from disk won't work — browsers block `fetch()` on `file://`

## Features

- **Overview** — KPI tiles, pass-rate trend across runs, status breakdown by project, top failure reasons (grouped by error), slowest tests, per-file summary
- **Tests** — sortable table with filters for status, project, tag, spec file and free-text search (title, file, tag or error text); optional grouping by file or project
- **Test detail** — every attempt/retry with the error, code snippet, stack trace, step tree with timings, attachments, stdout/stderr; the same test across projects; pass/fail history across all stored runs
- **Runs & history** — every stored run with branch, commit and pass rate; failed/flaky chart; least stable tests across runs
- **Navigation** — all state lives in the URL (`#/tests?status=failed&project=webkit`), so views are shareable and back/forward work
- **Load a report** — drag a `results.json` onto the page or use *Load report* (kept in the tab only, nothing uploaded)
- Keyboard: `/` focuses search, `j` / `k` move to next/previous test in detail view
- Light/dark theme, responsive down to phone width

## Folder layout

```
index.html               app shell
css/styles.css           styles and theme tokens
js/
  app.js                 bootstrapping, routing, sidebar, run picker, uploads
  data.js                loads storage/ and normalises the Playwright JSON format
  router.js              hash router helpers
  charts.js              small SVG line/bar charts
  util.js                formatting, escaping, ANSI → HTML
  views/                 overview, tests, detail, runs
storage/
  manifest.json          index of runs (generated)
  reports/*.json         Playwright JSON reports — one file per run
scripts/
  serve.mjs              static server used by `npm start`
  build-manifest.mjs     rebuilds storage/manifest.json from storage/reports/
  generate-samples.mjs   creates the deterministic sample reports
  manifest-reporter.mjs  Playwright reporter that refreshes the manifest after a run
tests/dashboard.spec.js  Playwright tests for the dashboard itself
```

## Adding your own reports

1. Enable the JSON reporter in your project's `playwright.config`:
   ```js
   reporter: [['json', { outputFile: 'results.json' }]]
   ```
2. Copy the file into `storage/reports/` (give each run its own name, e.g. `run-2026-10-15-09-30.json`)
3. Rebuild the index: `npm run manifest`

Static hosts (GitHub Pages, S3) can't list folders, which is why `manifest.json` exists.
Branch and commit are read from `config.metadata` (`ci.branch` / `ci.commit.sha`, or `gitBranch` / `gitCommit`) when present.

To make attachments clickable, copy the `test-results/` folder into `storage/` — paths are resolved as `storage/test-results/...`.

## Testing the dashboard

```bash
npm install
npx playwright install chromium
npm test
```

- Tests run against the sample report `run-2026-10-15-04-27`, with expected numbers read from the file
- Each test run writes its own JSON report into `storage/reports/` and refreshes the manifest, so the dashboard shows its own results next to the samples
- Regenerate samples with `npm run samples` (output is deterministic)

## Publishing on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / root. All paths are relative, so it works from a sub-path.
