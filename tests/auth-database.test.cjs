const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.AUTH_TEST_DATABASE_URL) test('auth PostgreSQL', {skip:true},()=>{});
else {
  const url = new URL(process.env.AUTH_TEST_DATABASE_URL);
  assert.ok(url.hostname === '127.0.0.1' && url.port === '55442' && url.pathname === '/flowlio_auth_test');
  process.env.CONNECTION_URL = url.toString();
  const {connection} = require('../src/configs/connection.config');
  const {auth} = require('../src/lib/auth');
  const {hashPassword} = require('better-auth/crypto');
  before(async()=>{
    await connection.query('drop schema public cascade;create schema public;drop schema if exists flowlio_releases cascade;drop schema if exists drizzle cascade');
    await require('../src/utils/release-migrations.util').runReleaseMigrations(connection);
    await connection.query(`insert into users(id,name,email,role,status,email_verified,two_factor_enabled,is_super_admin,is_organization_owner,timezone,created_at,updated_at) values('auth-user','Test','auth@example.test','user','active',true,false,false,false,'UTC',now(),now());`);
    await connection.query(`insert into account(id,account_id,provider_id,user_id,password,created_at,updated_at) values('auth-account','auth-user','credential','auth-user',$1,now(),now())`,[await hashPassword('Test-only-password-123!')]);
  });
  after(()=>connection.end());
  test('real Drizzle auth reads legacy user fields and writes a valid session', async()=>{
    const response = await auth.handler(new Request('http://127.0.0.1:3333/api/auth/sign-in/email',{
      method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:4000'},
      body:JSON.stringify({email:'auth@example.test',password:'Test-only-password-123!'})
    }));
    const body = await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(body.user.id,'auth-user');
    assert.equal(body.user.isSuperAdmin,false);
    assert.equal(body.user.isOrganizationOwner,false);
    assert.ok(response.headers.getSetCookie().length);
    assert.equal((await connection.query('select count(*)::int n from session where user_id=$1',['auth-user'])).rows[0].n,1);
  });
}
