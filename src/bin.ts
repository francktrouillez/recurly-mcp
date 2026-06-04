#!/usr/bin/env node
import { startStdioServer } from './server.js';

// Last-resort handlers: terminate with a single stderr line rather than letting
// an unexpected error crash the stdio transport with a raw stack trace (which can
// leak file paths). The per-tool catch in server.ts already handles normal tool
// failures; these only cover anything that escapes it.
process.on('unhandledRejection', (reason) => {
  process.stderr.write(
    `recurly-mcp: unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}\n`,
  );
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`recurly-mcp: uncaught exception: ${err.message}\n`);
  process.exit(1);
});

startStdioServer().catch((err) => {
  process.stderr.write(
    `recurly-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
