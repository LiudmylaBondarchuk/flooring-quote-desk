// Wait for GitHub to finish thinking about what is here, and refuse if it went red.
//
//   npm run ci:wait            the commit checked out right now
//   npm run ci:wait -- <sha>   a particular one
//
// This exists because the rule it enforces was broken within a day of being written. Pushing,
// opening a pull request and merging are three moments, and between each pair GitHub runs something
// that nobody has looked at yet. Merging before the pull request's own run has finished is not
// merely risky: the branch then replays what main already has, the guard says so correctly, and a
// red run is left in the public history of the repository, caused by the order rather than by the
// code. That cannot be taken back.
//
// A step in a command is kept. A resolution is not.

import { execFileSync } from 'node:child_process';

const EVERY = 15_000;
const GIVE_UP_AFTER = 15 * 60 * 1000;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// the same credential the pushing uses, asked of git rather than kept anywhere. Never printed:
// this script says what CI concluded, and nothing about how it was allowed to ask.
const token = () => {
  const answer = execFileSync('git', ['credential', 'fill'],
    { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const found = answer.split('\n').find((line) => line.startsWith('password='));
  if (!found) {
    console.error('No GitHub credential is stored for this machine, so nothing here can ask what');
    console.error('CI concluded. Push once by hand to store one.');
    process.exit(1);
  }
  return found.slice('password='.length);
};

const repo = () => {
  const url = git('remote', 'get-url', 'origin');
  const found = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!found) {
    console.error(`origin does not look like a GitHub repository: ${url}`);
    process.exit(1);
  }
  return { owner: found[1], name: found[2] };
};

const sha = process.argv[2] || git('rev-parse', 'HEAD');
const { owner, name } = repo();
const auth = { Authorization: `token ${token()}`, Accept: 'application/vnd.github+json' };

const runsFor = async () => {
  const url = `https://api.github.com/repos/${owner}/${name}/actions/runs?head_sha=${sha}&per_page=20`;
  const answer = await fetch(url, { headers: auth });
  if (!answer.ok) {
    console.error(`GitHub answered ${answer.status} when asked about ${sha.slice(0, 8)}`);
    process.exit(1);
  }
  return (await answer.json()).workflow_runs || [];
};

const started = Date.now();
console.log(`waiting on ${sha.slice(0, 8)} in ${owner}/${name}`);

let told = new Set();
for (;;) {
  const runs = await runsFor();

  for (const run of runs) {
    const line = `  ${run.name} (${run.event}) — ${run.status}${run.conclusion ? `, ${run.conclusion}` : ''}`;
    if (!told.has(line)) { console.log(line); told.add(line); }
  }

  // Nothing yet is not the same as nothing to wait for: GitHub takes a few seconds to register a
  // push, and treating an empty answer as a pass is exactly the mistake this script exists to stop.
  if (runs.length) {
    const running = runs.filter((r) => r.status !== 'completed');
    if (!running.length) {
      const red = runs.filter((r) => r.conclusion !== 'success');
      if (red.length) {
        console.error(`\n${red.length} run(s) did not pass on ${sha.slice(0, 8)}:`);
        for (const run of red) console.error(`  ${run.name} (${run.event}) — ${run.conclusion}`);
        console.error(`\n  ${red[0].html_url}`);
        console.error('\nNothing goes further until this is green. Not the pull request, not the merge.');
        process.exit(1);
      }
      console.log(`\nall ${runs.length} run(s) green`);
      process.exit(0);
    }
  }

  if (Date.now() - started > GIVE_UP_AFTER) {
    console.error(`\nstill unfinished after ${GIVE_UP_AFTER / 60000} minutes — look for yourself:`);
    console.error(`  https://github.com/${owner}/${name}/actions?query=${sha}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, EVERY));
}
