// check-redis.mjs — answer "did I paste my Upstash credentials correctly?" in one command.
//
//   npm run redis:check
//
// Writes a throwaway key, reads it back, deletes it, and reports the round-trip time.

import { loadEnvLocal, hasRedisCredentials } from './load-env.mjs';

const found = await loadEnvLocal();
if (!found) {
  console.error('\n  x No .env.local found in the project root.');
  console.error('    Copy .env.example to .env.local and paste your Upstash values in.\n');
  process.exit(1);
}

if (!hasRedisCredentials()) {
  console.error('\n  x .env.local still has the placeholder values.');
  console.error('    Upstash console -> your database -> "REST API" -> ".env" button -> Copy,');
  console.error('    then paste over both lines in .env.local.\n');
  process.exit(1);
}

const { redis } = await import('../api/_lib/redis.js');

const key = `gb:__healthcheck:${Date.now()}`;
try {
  const started = Date.now();
  await redis('SET', key, 'ok', 'EX', '60');
  const value = await redis('GET', key);
  const ms = Date.now() - started;
  await redis('DEL', key);

  if (value !== 'ok') throw new Error(`Read back ${JSON.stringify(value)} instead of "ok".`);

  const dbsize = await redis('DBSIZE');
  console.log(`\n  OK  Connected to Upstash. Round trip ${ms}ms for 2 commands.`);
  console.log(`      Database holds ${dbsize} key(s).`);
  console.log('      (That timing is from your machine; a Vercel function in lhr1 is far closer.)\n');
} catch (err) {
  console.error(`\n  x Could not reach Upstash.\n    ${err.message}\n`);
  console.error('    Most common causes: the token was truncated when pasting, or the URL');
  console.error('    belongs to a different database than the token.\n');
  process.exit(1);
}
