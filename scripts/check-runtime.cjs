const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const expected = readFileSync(join(__dirname, '..', '.node-version'), 'utf8').trim();
if (process.versions.node !== expected) {
  console.error(`Flowlio requires Node ${expected}; received ${process.versions.node}. Check the hosting runtime override.`);
  process.exit(1);
}
console.log(`Flowlio runtime: Node ${process.versions.node}, OpenSSL ${process.versions.openssl}`);
