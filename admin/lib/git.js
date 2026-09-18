import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { PATHS } from './paths.js';
import { HttpError } from './errors.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

async function git(args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: PATHS.root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
    throw new HttpError(500, `git ${args[0]} failed: ${detail}`);
  }
}

/** Parses `git status --porcelain` into something the UI can list. */
export async function status() {
  const [porcelain, branch, remote] = await Promise.all([
    git(['status', '--porcelain']),
    git(['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim()).catch(() => ''),
    git(['remote', 'get-url', 'origin']).then((s) => s.trim()).catch(() => ''),
  ]);
  const files = porcelain
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2).trim() || '??', path: line.slice(3).trim() }));

  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/);
    ahead = Number(counts[0] ?? 0);
    behind = Number(counts[1] ?? 0);
  } catch {
    /* no upstream yet */
  }

  let lastCommit = '';
  try {
    lastCommit = (await git(['log', '-1', '--format=%h %s (%cr)'])).trim();
  } catch {
    /* no commits */
  }

  return { branch, remote, files, ahead, behind, lastCommit, clean: files.length === 0 };
}

/** Stages everything, commits and pushes. Returns the combined output. */
export async function publish(message) {
  const text = String(message ?? '').trim() || `Update questlog ${new Date().toISOString().slice(0, 10)}`;
  const out = [];
  out.push(await git(['add', '-A']));
  const staged = (await git(['diff', '--cached', '--name-only'])).trim();
  if (!staged) throw new HttpError(409, 'Nothing to commit - the working tree is clean.');
  out.push(await git(['commit', '-m', text]));
  out.push(await git(['push']));
  return { message: text, output: out.join('\n').trim() };
}

/** Runs the production build so schema errors surface before a push, not on Vercel. */
export async function testBuild() {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execAsync('npm run build', { cwd: PATHS.root, maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 });
    return { ok: true, ms: Date.now() - started, output: stripAnsi(`${stdout}\n${stderr}`) };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, output: stripAnsi(`${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message}`) };
  }
}

const stripAnsi = (s) => s.replace(/\[[0-9;]*[A-Za-z]/g, '').trim();
