const { mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

if (process.platform !== 'win32') process.exit(0);

const dir = mkdtempSync(join(tmpdir(), 'openpets-symlink-check-'));
try {
  const target = join(dir, 'target.txt');
  const link = join(dir, 'link.txt');
  writeFileSync(target, 'ok', 'utf8');
  symlinkSync(target, link, 'file');
} catch (error) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : String(error);
  console.error('Windows symlink privilege is required for desktop packaging.');
  console.error('Enable Windows Developer Mode or run the package command from an elevated PowerShell prompt, then retry.');
  console.error(`Symlink check failed: ${message}`);
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
