import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
const record = (event) =>
  appendFileSync(
    process.env.MANAGED_BROWSER_GUARD_TRACE,
    JSON.stringify(event) + '\n',
  );
const deny = (api) => () => {
  attempts += 1;
  record({ event: 'blocked-network', api });
  throw new Error(
    'Installer network attempt blocked by benign verification guard',
  );
};
http.request = deny('http.request');
http.get = deny('http.get');
https.request = deny('https.request');
https.get = deny('https.get');
globalThis.fetch = deny('fetch');
syncBuiltinESMExports();
record({ event: 'guard-ready', node: process.version });
process.on('exit', (code) => record({ event: 'guard-exit', code, attempts }));
if (process.env.MANAGED_BROWSER_GUARD_SELFTEST === '1') {
  try {
    https.get('https://127.0.0.1:9/');
  } catch {}
}
