#!/usr/bin/env node
/**
 * Scans storage/reports/*.json (Playwright JSON reporter output) and writes
 * storage/manifest.json — the index the dashboard reads to list runs.
 *
 * Static hosts (GitHub Pages, S3, `python -m http.server`) can't list folders,
 * so run this after adding or removing a report:
 *
 *   node scripts/build-manifest.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE = join(ROOT, 'storage');
const REPORTS = join(STORAGE, 'reports');

export function buildManifest() {
  const runs = [];
  for (const file of readdirSync(REPORTS).filter((f) => f.endsWith('.json'))) {
    let report;
    try {
      report = JSON.parse(readFileSync(join(REPORTS, file), 'utf8'));
    } catch (e) {
      console.warn(`skip ${file}: not valid JSON (${e.message})`);
      continue;
    }
    if (!report.stats || !Array.isArray(report.suites)) {
      console.warn(`skip ${file}: not a Playwright JSON report`);
      continue;
    }
    const s = report.stats;
    const meta = report.config?.metadata ?? {};
    runs.push({
      id: file.replace(/\.json$/, ''),
      file: `reports/${file}`,
      startTime: s.startTime,
      duration: s.duration,
      stats: { passed: s.expected, failed: s.unexpected, flaky: s.flaky, skipped: s.skipped },
      branch: meta['ci.branch'] ?? meta.gitBranch ?? null,
      commit: meta['ci.commit.sha'] ?? meta.gitCommit ?? null,
      playwrightVersion: report.config?.version ?? null,
    });
  }
  runs.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  const manifest = { generatedAt: new Date().toISOString(), runs };
  writeFileSync(join(STORAGE, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`manifest.json: ${runs.length} run(s)`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) buildManifest();
