const fs = require('node:fs');
const path = require('node:path');
const target = process.argv.find(arg => arg.startsWith('--frontend='))?.slice('--frontend='.length);
if (!target) throw Error('Usage: node scripts/sync-api-contracts.cjs --frontend=/path/to/Flowlio-Frontend [--check]');
const source = fs.readFileSync(path.resolve(__dirname, '../src/contracts/core-api.ts'), 'utf8').replace(/\r\n/g, '\n');
const destination = path.resolve(target, 'src/contracts/core-api.ts');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Frontend API contract is out of sync');
  console.log('API contracts match');
} else {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
  console.log('Updated frontend API contract');
}
