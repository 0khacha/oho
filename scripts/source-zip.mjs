// Source package for Firefox Add-ons (AMO) review: oho-source.zip with the committed, tracked files
// only (no node_modules, dist, zips or live-test results, which are untracked).
//   npm run source-zip
// Uses `git archive HEAD`, so uncommitted changes are NOT included (a warning lists them). Line
// endings are kept as stored in the repository (LF), whatever core.autocrlf says, so a build from
// this zip is byte-identical to one from the repository.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty) console.warn(`warning: uncommitted changes are not in the source zip:\n${dirty}`);
const out = 'oho-source.zip';
execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', '-o', out, 'HEAD']);
const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').length;
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(1)} KB, ${files} files, from ${git('rev-parse', '--short', 'HEAD')}`);
