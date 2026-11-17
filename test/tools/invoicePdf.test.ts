import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pdfFileName, preparePdfDir, writeInvoicePdf } from '../../src/tools/invoicePdf.js';
import { invoicesTool } from '../../src/tools/invoices.js';
import type { ToolContext } from '../../src/tools/types.js';

const PDF_BYTES = Buffer.from('%PDF-1.4\n\x00\x01\x02\xff binary body\n%%EOF');

function wrapper(bytes: Buffer = PDF_BYTES) {
  return {
    object: 'binary_file',
    content_type: 'application/pdf',
    encoding: 'base64',
    byte_length: bytes.length,
    data: bytes.toString('base64'),
  };
}

function ctxFor(pdfDir: string, response: unknown = wrapper()) {
  const paths: string[] = [];
  const ctx = {
    client: {
      request: async (_method: string, p: string) => {
        paths.push(p);
        return response;
      },
    },
    config: { pdfDir },
  } as unknown as ToolContext;
  return { ctx, paths };
}

const isPosix = process.platform !== 'win32';
const save = async (dir: string, id: string, response: unknown = wrapper()) =>
  writeInvoicePdf(await preparePdfDir(dir), id, response);
const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'recurly-mcp-test-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('recurly_invoices get_pdf delivery', () => {
  it('defaults to file delivery: writes the bytes and returns small metadata', async () => {
    const dir = path.join(root, 'nested', 'pdfs');
    const { ctx, paths } = ctxFor(dir);
    const result = (await invoicesTool.handler(ctx, {
      action: 'get_pdf',
      invoice_id: 'number-1234',
    })) as Record<string, unknown>;

    expect(paths).toEqual(['/invoices/number-1234.pdf']);
    const realDir = await fs.realpath(dir);
    expect(result).toEqual({
      object: 'binary_file',
      content_type: 'application/pdf',
      byte_length: PDF_BYTES.length,
      sha256: createHash('sha256').update(PDF_BYTES).digest('hex'),
      path: path.join(realDir, 'invoice-number-1234.pdf'),
    });
    expect(await fs.readFile(result.path as string)).toEqual(PDF_BYTES);
    // No temp files left behind.
    expect(await fs.readdir(realDir)).toEqual(['invoice-number-1234.pdf']);
  });

  it.runIf(isPosix)('creates the directory 0700 and the file 0600', async () => {
    const dir = path.join(root, 'pdfs');
    const result = await save(dir, 'i1');
    expect(await mode(dir)).toBe(0o700);
    expect(await mode(result.path)).toBe(0o600);
  });

  it.runIf(isPosix)('replaces an existing world-readable file with a 0600 one', async () => {
    const dir = path.join(root, 'pdfs');
    await fs.mkdir(dir, { mode: 0o700 });
    const target = path.join(dir, 'invoice-i1.pdf');
    await fs.writeFile(target, 'stale');
    await fs.chmod(target, 0o644);

    const result = await save(dir, 'i1');
    expect(result.path).toBe(path.join(await fs.realpath(dir), 'invoice-i1.pdf'));
    expect(await fs.readFile(target)).toEqual(PDF_BYTES);
    expect(await mode(target)).toBe(0o600);
  });

  it.runIf(isPosix)('replaces a symlink at the target instead of writing through it', async () => {
    const dir = path.join(root, 'pdfs');
    await fs.mkdir(dir, { mode: 0o700 });
    const victim = path.join(root, 'victim.txt');
    await fs.writeFile(victim, 'untouched');
    await fs.symlink(victim, path.join(dir, 'invoice-i1.pdf'));

    const result = await save(dir, 'i1');
    expect(await fs.readFile(victim, 'utf8')).toBe('untouched');
    expect((await fs.lstat(result.path)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(result.path)).toEqual(PDF_BYTES);
  });

  it.each([
    ['../x', /^invoice-\.\._x~[0-9a-f]{12}\.pdf$/],
    ['a/b', /^invoice-a_b~[0-9a-f]{12}\.pdf$/],
    ['..', /^invoice-\.\.\.pdf$/],
    ['a\\b', /^invoice-a_b~[0-9a-f]{12}\.pdf$/],
    ['number-1234', /^invoice-number-1234\.pdf$/],
  ])('sanitizes invoice id %j into a single segment inside the directory', async (id, expected) => {
    expect(pdfFileName(id)).toMatch(expected);
    const dir = path.join(root, 'pdfs');
    const result = await save(dir, id);
    expect(path.dirname(result.path)).toBe(await fs.realpath(dir));
    expect(path.basename(result.path)).toMatch(expected);
    expect(await fs.readdir(root)).toEqual(['pdfs']);
  });

  it('keeps ids that sanitize to the same text in distinct files', () => {
    // `hashed` is an unchanged id that spells out a/b's hashed name.
    const hashed = pdfFileName('a/b').slice('invoice-'.length, -'.pdf'.length);
    const names = new Set(['a/b', 'a_b', 'a:b', 'a\\b', hashed].map(pdfFileName));
    expect(names.size).toBe(5);
    expect(pdfFileName('x'.repeat(200))).not.toBe(pdfFileName('x'.repeat(201)));
  });

  it('caps the file-name length for very long ids', () => {
    expect(pdfFileName('x'.repeat(1000)).length).toBeLessThanOrEqual(160);
  });

  it.runIf(isPosix)('refuses an existing directory accessible to group/others', async () => {
    for (const m of [0o777, 0o755, 0o750]) {
      const dir = path.join(root, `shared-${m.toString(8)}`);
      await fs.mkdir(dir);
      await fs.chmod(dir, m);
      await expect(save(dir, 'i1')).rejects.toThrow(/group\/others/);
    }
  });

  it('accepts only an exact application/pdf content type (parameters allowed)', async () => {
    const dir = path.join(root, 'pdfs');
    await expect(
      save(dir, 'i1', { ...wrapper(), content_type: 'application/pdf; charset=binary' }),
    ).resolves.toMatchObject({ content_type: 'application/pdf; charset=binary' });
    await expect(
      save(dir, 'i2', { ...wrapper(), content_type: 'application/pdf-preview' }),
    ).rejects.toThrow(/application\/pdf/);
  });

  it.runIf(isPosix)(
    'writes into the real directory behind a symlinked RECURLY_PDF_DIR',
    async () => {
      const real = path.join(root, 'real');
      await fs.mkdir(real, { mode: 0o700 });
      const link = path.join(root, 'link');
      await fs.symlink(real, link);
      const result = await save(link, 'i1');
      expect(result.path).toBe(path.join(await fs.realpath(real), 'invoice-i1.pdf'));
    },
  );

  it('rejects a non-binary upstream payload without writing anything', async () => {
    const dir = path.join(root, 'pdfs');
    const { ctx } = ctxFor(dir, { object: 'invoice', id: 'i1' });
    await expect(
      invoicesTool.handler(ctx, { action: 'get_pdf', invoice_id: 'i1' }),
    ).rejects.toThrow(/application\/pdf/);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('rejects a binary payload that is not a PDF', async () => {
    const dir = path.join(root, 'pdfs');
    const png = { ...wrapper(), content_type: 'image/png' };
    await expect(save(dir, 'i1', png)).rejects.toThrow(/application\/pdf/);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('checks the directory before downloading, so a bad RECURLY_PDF_DIR costs no API call', async () => {
    const file = path.join(root, 'not-a-dir');
    await fs.writeFile(file, '');
    const { ctx, paths } = ctxFor(file);
    await expect(
      invoicesTool.handler(ctx, { action: 'get_pdf', invoice_id: 'i1' }),
    ).rejects.toThrow();
    expect(paths).toEqual([]);
  });

  it('inline delivery returns the base64 wrapper unchanged and writes nothing', async () => {
    const dir = path.join(root, 'pdfs');
    const { ctx } = ctxFor(dir);
    const result = await invoicesTool.handler(ctx, {
      action: 'get_pdf',
      invoice_id: 'i1',
      delivery: 'inline',
    });
    expect(result).toEqual(wrapper());
    await expect(fs.stat(dir)).rejects.toThrow();
  });

  it('rejects an unknown delivery value', async () => {
    const { ctx } = ctxFor(root);
    await expect(
      invoicesTool.handler(ctx, {
        action: 'get_pdf',
        invoice_id: 'i1',
        delivery: 'email',
      } as never),
    ).rejects.toThrow();
  });
});
