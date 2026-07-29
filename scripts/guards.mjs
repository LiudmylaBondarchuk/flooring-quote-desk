// The rules that decide whether a change may be pushed, in one place.
//
// They started as git hooks, which meant they were three files on one machine: not tracked, so a
// fresh clone had none of them, and nobody else's push was checked at all. A guard that only runs
// where it was written is a habit, not a rule.
//
// Now the hooks are thin callers and CI runs the same script against the same commits. Adding a
// rule here adds it in both places at once, and there is no version of "it passed locally" that
// differs from what the build enforces.
//
//   node scripts/guards.mjs <base>
//
// base defaults to origin/main. Every commit between base and HEAD is checked.

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);

// CI checks out a detached HEAD, where git knows no branch name — so the name has to be handed in
// or the rule about it would be enforced on this laptop and nowhere else, which is the whole
// problem this script was written to end.
const named = args.indexOf('--branch');
const givenBranch = named === -1 ? null : args[named + 1];
const base = args.filter((a, i) => !a.startsWith('--') && i !== named + 1)[0] || 'origin/main';

const problems = [];
const complainAbout = (subject, message, label) => {
  if (/co-authored-by:.*(claude|copilot|chatgpt|gemini)|generated (with|by)|ai-(generated|assisted)/i.test(message)) {
    complain(`${label} credits a tool in its message`, 'nobody needs to know what wrote it', 'remove the line');
  }
  if (/[^\x20-\x7e]/.test(subject)) {
    complain(`${label} has a subject that is not plain ASCII`,
      'commit subjects in this repository are English, always', `rewrite: ${subject}`);
  }
  if (/^[a-z]/.test(subject)) {
    complain(`${label} starts its subject lowercase`, 'so the log reads as sentences', `rewrite: ${subject}`);
  }
  if (/^(this )?(commit|pr|change) |([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) (commits?|files?|changes?)/i.test(subject)) {
    complain(`${label} inventories the change in its subject`,
      'git already shows how many commits and files there are; a subject that counts them has not named the change',
      `rewrite: ${subject}`);
  }
};
const complain = (what, why, remedy) => problems.push({ what, why, remedy });

if (args[0] === '--message') {
  const { readFileSync } = await import('node:fs');
  const message = readFileSync(args[1], 'utf8');
  complainAbout(message.split('\n')[0], message, 'this message');
  report();
}

function report(counted) {
  if (!problems.length) {
    console.log(counted === undefined
      ? 'guards: nothing to report'
      : `guards: ${counted} commit(s) against ${base}, nothing to report`);
    process.exit(0);
  }
  for (const { what, why, remedy } of problems) {
    console.error(`\nguards: ${what}`);
    for (const line of why.match(/.{1,86}(\s|$)/g) || [why]) console.error(`        ${line.trim()}`);
    console.error(`        -> ${remedy}`);
  }
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

const branch = givenBranch || git('rev-parse', '--abbrev-ref', 'HEAD');

// --- the branch is named after the work, not the tool that helped
if (branch !== 'HEAD' && !['main', 'master'].includes(branch)) {
  if (/copilot|chatgpt|claude|gemini|assistant|(^|-)ai(-|$)|(^|-)bot(-|$)/i.test(branch)) {
    complain(`branch "${branch}" is named after a tool`,
      'the name stays in the public history of this repository forever, and says nothing about the change',
      'name it for what changes in it: intake-router, stairs-pricing, hero-image');
  }
  if (/^(review|test|tmp|temp|new|changes|update|wip|fix|patch|branch)$/i.test(branch)) {
    complain(`branch "${branch}" says nothing about the work`,
      'a reviewer reading the branch list learns nothing from it',
      'what would a colleague who wrote this change call it?');
  }
}

// --- the branch is not replaying work main already has
const touched = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean).length;
const differs = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean).length;
if (touched > differs) {
  complain(`the branch replays work ${base} already has`,
    `it touches ${touched} file(s) as a series of commits, but only ${differs} differ from ${base}. `
    + 'the rest were squash-merged already, so the merge will report conflicts however green the '
    + 'tests are — a test reads one tree, a conflict lives between two histories',
    `git reset --soft ${base}, then commit once`);
}

// --- every commit on the branch
const commits = git('rev-list', `${base}..HEAD`).split('\n').filter(Boolean);
for (const sha of commits) {
  const short = sha.slice(0, 7);
  const message = git('log', '-1', '--format=%B', sha);
  const subject = message.split('\n')[0];

  complainAbout(subject, message, short);

  const added = git('diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', sha, '--', 'src/', 'db/')
    .split('\n').filter(Boolean);
  if (added.length && !/^Audited:/m.test(message)) {
    complain(`${short} brings source nobody has run here yet`,
      `it adds ${added.join(', ')}. "It has tests and they pass" is not an answer: tests written by `
      + "the same hand as the code agree with the code's assumptions, so they pass while the "
      + 'assumption is wrong. A paid reviewer is for what survives being run on inputs the author '
      + 'did not pick, not for what that would have caught',
      "add a line starting with 'Audited:' saying what you ran and what came back");
  }

  const staged = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n');
  if (staged.includes('CLAUDE.md')) {
    complain(`${short} commits CLAUDE.md`, 'it can hold passwords, tokens and private notes',
      'remove it from the commit and keep it in .gitignore');
  }
}

report(commits.length);
