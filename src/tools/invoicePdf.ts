import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// The client base64-wraps every binary response (see client/recurly.ts). We
// decode that wrapper here rather than adding a bytes-returning client method:
// the client stays a single generic GET, and the extra base64 round-trip is
// bounded by the client's 25 MB body cap.
interface BinaryFile {
  object: 'binary_file';
  content_type: string;
  encoding: 'base64';
  data: string;
}

export interface PdfFileResult {
  object: 'binary_file';
  content_type: string;
  byte_length: number;
  sha256: string;
  path: string;
}

// The client wraps ANY non-JSON, non-text body as binary_file, so check it is
// actually a PDF before saving it under a `.pdf` name and reporting success.
function asPdf(value: unknown): BinaryFile {
  const v = value as Partial<BinaryFile> | null;
  if (
    v === null ||
    typeof v !== 'object' ||
    v.object !== 'binary_file' ||
    v.encoding !== 'base64' ||
    typeof v.data !== 'string' ||
    typeof v.content_type !== 'string' ||
    !/^application\/pdf\s*(;|$)/i.test(v.content_type)
  ) {
    throw new Error('expected an application/pdf response from Recurly, got something else');
  }
  return v as BinaryFile;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

// Keeps `invoice-` + id + hash + `.pdf` plus the temp-file decoration well
// under the common 255-byte file-name limit.
const MAX_ID_CHARS = 128;

// Map an invoice id (already validated by idParam, but otherwise free-form) to
// a single safe path segment. Anything outside [A-Za-z0-9._-] — including path
// separators — becomes `_`, and the fixed `invoice-` prefix means the result
// can never be `.` or `..`. When sanitizing or truncating changed the id, a
// short hash of the raw id keeps distinct ids (`a/b` vs `a_b`) from colliding
// and silently overwriting each other's PDF. The `~` separator is outside the
// sanitized alphabet, so no unchanged id can mimic a hashed name.
export function pdfFileName(invoiceId: string): string {
  const safe = invoiceId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, MAX_ID_CHARS);
  const suffix = safe === invoiceId ? '' : `~${sha256(invoiceId).slice(0, 12)}`;
  return `invoice-${safe}${suffix}.pdf`;
}

// Create the directory (0700) if missing and return its real path. We write
// into the realpath so a symlink swapped in after this check cannot redirect
// the write. We refuse a directory owned by another user or accessible to
// group/others, and a symlink at `dir` owned by another user — e.g. a
// `recurly-mcp` entry pre-created in a shared /tmp by someone else, who could
// then read or replace the files, or point them into another private dir.
export async function preparePdfDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(dir);
  // POSIX only: Windows has no uid and synthesizes permissive mode bits.
  if (typeof process.getuid === 'function') {
    const uid = process.getuid();
    const refuse = (why: string) =>
      new Error(`refusing to write invoice PDFs into ${dir}: ${why} (use a private directory)`);
    if ((await fs.lstat(dir)).uid !== uid) throw refuse('owned by another user');
    const st = await fs.stat(real);
    if (st.uid !== uid) throw refuse('owned by another user');
    if ((st.mode & 0o077) !== 0) throw refuse('accessible by group/others, expected mode 0700');
  }
  return real;
}

// Write `bytes` to `target` with mode 0600. The bytes go to a fresh temp file
// (O_EXCL, so never through a pre-existing file or symlink) that is then
// renamed over the target: an existing file at the target is replaced rather
// than rewritten in place, so its old (possibly looser) mode never survives.
async function writePrivateFile(target: string, bytes: Buffer): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

// `realDir` must come from preparePdfDir (called before downloading, so a
// misconfigured directory fails fast without spending an API call).
export async function writeInvoicePdf(
  realDir: string,
  invoiceId: string,
  response: unknown,
): Promise<PdfFileResult> {
  const file = asPdf(response);
  const bytes = Buffer.from(file.data, 'base64');
  const target = path.join(realDir, pdfFileName(invoiceId));
  // Defense in depth: the sanitized name is a single segment, so this holds by
  // construction — fail loudly if that ever stops being true.
  if (path.dirname(target) !== realDir) {
    throw new Error(`refusing to write outside ${realDir}`);
  }
  await writePrivateFile(target, bytes);
  return {
    object: 'binary_file',
    content_type: file.content_type,
    byte_length: bytes.length,
    sha256: sha256(bytes),
    path: target,
  };
}
