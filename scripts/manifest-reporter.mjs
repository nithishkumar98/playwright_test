// Playwright reporter that refreshes storage/manifest.json once the JSON reporter
// (listed before it in playwright.config.js) has written its report.
import { buildManifest } from './build-manifest.mjs';

export default class ManifestReporter {
  printsToStdio() { return false; }
  async onEnd() { buildManifest(); }
}
