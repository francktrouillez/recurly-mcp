// Detect drift between our tools and Recurly's published OpenAPI spec.
//
//   npm run parity                         # fetch the spec from GitHub
//   npm run parity -- ./api.yaml           # or read a local copy (also via RECURLY_OPENAPI_SPEC)
//   npm run parity -- --strict             # also fail on warnings
//
// Exit 0: no drift. Exit 1: parity errors (or warnings under --strict).
// Exit 2: the spec could not be loaded or parsed.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import {
  compareParity,
  deriveToolActions,
  errorCount,
  errorMessage,
  extractSpecEndpoints,
  formatReport,
  parityTools,
} from './parity.js';

const DEFAULT_SPEC_URL =
  'https://raw.githubusercontent.com/recurly/recurly-client-node/master/openapi/api.yaml';
const FETCH_TIMEOUT_MS = 60_000;
const USAGE = 'usage: check-parity [--strict] [spec-url-or-path]';

async function loadSpecText(source: string): Promise<string> {
  if (!/^https?:\/\//i.test(source)) {
    // npm runs scripts from the package root; resolve relative paths against
    // the directory the user invoked `npm run parity` from.
    return readFile(resolve(process.env.INIT_CWD ?? process.cwd(), source), 'utf8');
  }
  const res = await fetch(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${source} failed: HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

function parseCliArgs(): { strict: boolean; source: string } {
  // `strict: true` makes parseArgs reject unknown flags.
  const { values, positionals } = parseArgs({
    options: { strict: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) {
    throw new Error(`expected at most one spec source, got: ${positionals.join(' ')}`);
  }
  return {
    strict: values.strict,
    // `||`, not `??`: an empty env var (e.g. an unset Actions variable) means unset.
    source: positionals[0] || process.env.RECURLY_OPENAPI_SPEC || DEFAULT_SPEC_URL,
  };
}

async function main(): Promise<number> {
  const { strict, source } = parseCliArgs();
  console.log(`Spec: ${source}${strict ? ' (strict)' : ''}`);
  const spec: unknown = parse(await loadSpecText(source));
  const specEndpoints = extractSpecEndpoints(spec);
  const { actions, errors } = await deriveToolActions(parityTools);
  const report = compareParity(specEndpoints, actions, errors);
  console.log(formatReport(report, strict));
  return errorCount(report, strict) > 0 ? 1 : 0;
}

// Set exitCode rather than calling process.exit() so a piped report is fully
// flushed before the process ends.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`check-parity: ${errorMessage(err)}`);
    console.error(USAGE);
    process.exitCode = 2;
  },
);
