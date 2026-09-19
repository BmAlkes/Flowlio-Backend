const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');const path=require('node:path');
const {readReleaseMigrations}=require('../src/utils/release-migrations.util');
const {generateDrizzleJson,generateMigration}=require('drizzle-kit/api');
const folder=path.resolve('drizzle/releases');
test('release journal registers every SQL file and the snapshot matches the current model',async()=>{
 const migrations=await readReleaseMigrations(folder);assert.equal(migrations.length,2);
 const previous=JSON.parse(await fs.readFile(path.join(folder,'meta/0000_snapshot.json'),'utf8'));
 const current=generateDrizzleJson(require('../src/schema/schema'),previous.id,['public'],'snake_case');
 assert.deepEqual(await generateMigration(previous,current),[]);
});
test('malformed journals and unregistered SQL fail before opening a database',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowlio-release-validation-'));
 try{
  await fs.cp(folder,temp,{recursive:true});
  await fs.writeFile(path.join(temp,'unregistered.sql'),'select 1');
  await assert.rejects(readReleaseMigrations(temp),/Unregistered/);
  await fs.unlink(path.join(temp,'unregistered.sql'));
  const file=path.join(temp,'meta/_journal.json');const journal=JSON.parse(await fs.readFile(file,'utf8'));
  journal.entries[0].tag='../outside';await fs.writeFile(file,JSON.stringify(journal));
  await assert.rejects(readReleaseMigrations(temp),/Invalid release migration entry/);
 }finally{assert.equal(path.dirname(temp),os.tmpdir());await fs.rm(temp,{recursive:true});}
});
