// The rules that decide whether a change may be committed or pushed, in one place.
//
// They began as three shell scripts under .githooks, which git did not track: a fresh clone had
// none of them and nobody else's work was checked at all. A rule that only runs where it was
// written is a habit. Now the hooks call this and CI runs the same file against the same commits,
// so adding a rule adds it in both places, and there is no "it passed locally" that differs from
// what the build enforces.
//
//   node scripts/guards.mjs --message <file>        one message being written
//   node scripts/guards.mjs <base> [--branch name]  every commit between base and HEAD
//
// A rule that cannot tell whether it applies must fail rather than guess. Several of the checks
// below exist because a value was handed in and silently refused, which reads as a pass.

import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// git answers "no" by exiting non-zero, which execFileSync raises. A rule that asks a question git
// can answer with no must be able to hear the no, or the check below it never runs and the run ends
// in a stack trace instead — which is the thing several of these rules exist to prevent.
const gitAsks = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};
const argv = process.argv.slice(2);

const problems = [];
const complain = (what, why, remedy) => problems.push({ what, why, remedy });

const report = (counted) => {
  if (!problems.length) {
    console.log(counted === undefined
      ? 'guards: nothing to report'
      : `guards: ${counted} commit(s) checked, nothing to report`);
    process.exit(0);
  }
  for (const { what, why, remedy } of problems) {
    console.error(`\nguards: ${what}`);
    for (const line of why.match(/.{1,86}(\s|$)/g) || [why]) console.error(`        ${line.trim()}`);
    console.error(`        -> ${remedy}`);
  }
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
};

// git commit -v writes the whole diff into the message file, below a scissors line, and that part
// is not comment-prefixed. Reading it as the message makes every rule below scan the code being
// committed and report the code's own words back as if the author had written them.
const messageOnly = (raw) => raw
  .split(/^# -+ >8 -+$/m)[0]
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .trim();

const aboutTheMessage = (message, label) => {
  const subject = message.split('\n')[0];

  // A message names the change, so that a reader learns what happened rather than how it came
  // about. Anything crediting a second hand belongs somewhere else.
  if (/^\s*co-authored-by:/im.test(message) || /\bassisted by\b/i.test(message)) {
    complain(`${label} credits a second hand`,
      'a commit message names the change, not the process behind it', 'remove the line');
  }
  if (/[^\x20-\x7e]/.test(subject)) {
    complain(`${label} has a subject that is not plain ASCII`,
      'commit subjects in this repository are English, always', `rewrite: ${subject}`);
  }
  if (/^[a-z]/.test(subject)) {
    complain(`${label} starts its subject lowercase`,
      'so the log reads as sentences rather than fragments', `rewrite: ${subject}`);
  }
  if (/^(this )?(commit|pr|change) |([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten) (commits?|files?|changes?)/i.test(subject)) {
    complain(`${label} inventories the change in its subject`,
      'git already shows how many commits and files there are; a subject that counts them has not '
      + 'named the change',
      `rewrite: ${subject}`);
  }
};

// A file this repository ignores must not reach it, however it got staged. This catches notes,
// local configuration and anything force-added past .gitignore without naming any of them — the
// ignore file is already the list, and keeping a second copy here is how the two drift apart.
const ignoredAmong = (paths) => paths.filter((path) => {
  if (!path) return false;
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

// --- one message being written: the cheapest moment to say no, and the only one where the remedy
// --- is editing rather than rewriting history
if (argv[0] === '--message') {
  const { readFileSync } = await import('node:fs');
  const message = messageOnly(readFileSync(argv[1], 'utf8'));
  aboutTheMessage(message, 'this message');

  // Deletions excluded: taking an ignored file back out of the index stages its removal, and a
  // rule that refuses that leaves no way to undo the mistake it exists to catch.
  const staged = git('diff', '--cached', '--name-only', '--diff-filter=d').split('\n').filter(Boolean);
  const shouldNotBeHere = ignoredAmong(staged);
  if (shouldNotBeHere.length) {
    complain(`${shouldNotBeHere.join(', ')} is ignored by this repository and is being committed`,
      'the ignore file lists it for a reason: notes and local configuration hold passwords, tokens '
      + 'and things written for one reader',
      'unstage it, and if it genuinely belongs here take it out of .gitignore deliberately');
  }

  // A merge stages everything the other branch had as though this commit were adding it, and those
  // files each stood in front of this same rule when they were written. Asking again turns every
  // merge into a refusal with no honest answer, since there is nothing new here to have run. What a
  // merge can genuinely introduce is a file that is on neither side -- something written while
  // resolving it -- and that is what is left to answer for.
  // asked of git rather than of .git/MERGE_HEAD, because a worktree keeps its own and this repo has
  // one open in another session
  const merging = (() => {
    try { git('rev-parse', '--verify', '--quiet', 'MERGE_HEAD'); return true; } catch { return false; }
  })();
  const addedAgainst = (ref) =>
    git('diff', '--cached', '--name-only', '--diff-filter=A', ...(ref ? [ref] : []), '--', 'src/', 'db/')
      .split('\n').filter(Boolean);
  const brought = merging
    ? addedAgainst().filter((f) => addedAgainst('MERGE_HEAD').includes(f))
    : addedAgainst();
  if (brought.length && !/^Audited:/m.test(message)) {
    complain(`this commit brings source nobody has run here yet: ${brought.join(', ')}`,
      '"it has tests and they pass" is not an answer: tests written by the same hand as the code '
      + "agree with the code's assumptions, so they pass while the assumption is wrong. Run it on "
      + 'inputs the author did not pick, and on the states it only claims to handle',
      "add a line starting with 'Audited:' saying what you ran and what came back");
  }
  report();
}

// --- a branch about to be pushed, or a build checking one
const flag = argv.indexOf('--branch');
if (flag !== -1 && !argv[flag + 1]) {
  complain('--branch was given with no name after it',
    'a guard that invents the value it was meant to be handed reports a pass on a check it never '
    + 'made — an empty name is a broken caller, not a well named branch',
    'pass the name, or leave the flag off and let git answer');
  report();
}

// Only the value after --branch is skipped. The earlier version excluded index 0 whenever the flag
// was absent, so the base a caller passed was dropped every time and quietly replaced.
const base = argv.filter((a, i) => !a.startsWith('--') && !(flag !== -1 && i === flag + 1))[0]
  || 'origin/main';

// CI checks out a detached HEAD, where git knows no branch name, so it has to be handed in.
const branch = flag === -1 ? git('rev-parse', '--abbrev-ref', 'HEAD') : argv[flag + 1];

if (!gitAsks('rev-parse', '--verify', '--quiet', base)) {
  complain(`there is no ${base} here to compare against`,
    'every rule below is about the difference between this branch and that one, and a missing base '
    + 'would otherwise surface as a git stack trace instead of a rule',
    'fetch it first, or pass a base that exists');
  report();
}

if (branch !== 'HEAD' && !['main', 'master'].includes(branch)
    && /^(review|test|tmp|temp|new|changes|update|wip|fix|patch|branch|misc|stuff)$/i.test(branch)) {
  complain(`branch "${branch}" says nothing about the work`,
    "the name stays in this repository's history for good, and a reader of the branch list learns "
    + 'nothing from it',
    'what would a colleague who wrote this change call it?');
}

// A branch carrying commits whose changes are already on base, from an earlier squash merge, is
// reported as conflicted however green the tests are: a test reads one tree, a conflict lives
// between two histories. Base moving ahead on its own does not trigger this — its files count as
// differences, which raises the second number rather than the first.
//
// Only the diagnosis is offered. How to reshape the branch is the author's call, and the obvious
// remedy collapses the separate commits, which are worth something here.
const touched = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean).length;
const differs = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean).length;
if (touched > differs) {
  complain(`this branch replays work ${base} already has`,
    `it touches ${touched} file(s) as a series of commits, but only ${differs} differ from ${base}. `
    + 'the rest arrived on that branch already, so a merge will report conflicts no test can see',
    `compare git diff --name-only ${base}...HEAD with git diff --name-only ${base} HEAD, and decide `
    + 'how this branch should be shaped');
}

// A migration is the shape of the system changing. CHANGELOG.md is what a reader is told the
// system is. When the first moves and the second does not, the document describes something that
// no longer exists — which for a repository whose worth is being understood is worse than an entry
// nobody wrote. It went eleven merged branches out of date before anyone noticed, so the rule fires
// on exactly the change that makes it wrong, and stays quiet otherwise.
const migrations = git('diff', '--name-only', '--diff-filter=A', base, 'HEAD', '--', 'db/history/')
  .split('\n').filter(Boolean);
const described = git('diff', '--name-only', base, 'HEAD', '--', 'CHANGELOG.md').split('\n').filter(Boolean);
if (migrations.length && !described.length) {
  complain(`${migrations.length} migration(s) here, and CHANGELOG.md says nothing about them`,
    'a migration changes what the system is; the changelog is what a reader is told it is. When '
    + 'one moves without the other the description outlives the thing described',
    `say what changed, in a sentence a stranger could use: ${migrations.join(', ')}`);
}

const commits = git('rev-list', `${base}..HEAD`).split('\n').filter(Boolean);
for (const sha of commits) {
  const short = sha.slice(0, 7);
  aboutTheMessage(messageOnly(git('log', '-1', '--format=%B', sha)), short);

  const shouldNotBeHere = ignoredAmong(
    git('diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=d', sha).split('\n'));
  if (shouldNotBeHere.length) {
    complain(`${short} commits ${shouldNotBeHere.join(', ')}, which this repository ignores`,
      'the ignore file lists it for a reason', 'take it out of that commit');
  }
}

report(commits.length);
