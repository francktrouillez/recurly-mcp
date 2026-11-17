import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toMcpInputSchema } from '../src/server.js';
import { requestTool } from '../src/tools/request.js';

// Union flattening and the `action` enum are covered against every real tool
// in integration.test.ts; these pin the zod 4 conversion details.
type Props = Record<string, Record<string, unknown>>;

describe('toMcpInputSchema (zod 4 → MCP JSON Schema)', () => {
  it('omits $schema and keeps only the action required across all branches', () => {
    const schema = z.discriminatedUnion('action', [
      z.object({ action: z.literal('list'), limit: z.number().optional() }),
      z.object({ action: z.literal('get'), id: z.string() }),
    ]);
    const json = toMcpInputSchema(schema);
    expect(json).not.toHaveProperty('$schema');
    expect(json.required).toEqual(['action']);
  });

  it('closes nested plain objects but leaves catchall objects open', () => {
    const json = toMcpInputSchema(
      z.object({
        filter: z.object({ state: z.string() }),
        extra: z.object({}).catchall(z.string()),
      }),
    );
    const props = json.properties as Props;
    expect(json.additionalProperties).toBe(false);
    expect(props.filter.additionalProperties).toBe(false);
    expect(props.extra.additionalProperties).toEqual({ type: 'string' });
  });

  it('emits only standard keywords for the recurly_request path', () => {
    const json = toMcpInputSchema(requestTool.inputSchema);
    const path = (json.properties as Props).path;
    expect(path).not.toHaveProperty('format');
    expect(path.pattern).toBe('^\\/');
  });
});
