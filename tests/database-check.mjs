import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.ts';
import { createAuthApp } from '../app.js';

const suffix = randomBytes(8).toString('hex');
const username = `check_${suffix}`;
const email = `${username}@example.invalid`;
const rollback = new Error('ROLLBACK_TEST_DATA');
let server;
try {
  try {
    await prisma.$transaction(async tx => {
      const makeUser = n => tx.user.create({ data: {
        username: `schema_${suffix}_${n}`, email: `schema_${suffix}_${n}@example.invalid`,
        name: 'Schema check', passwordHash: 'test-only-hash',
      }});
      const first = await makeUser(1), second = await makeUser(2);
      assert.equal(typeof first.id, 'bigint');
      assert.equal(first.role, 'USER'); assert.equal(first.status, 'ACTIVE');
      assert.equal(first.theme, 'DARK'); assert.equal(first.avatar, null);
      await assert.rejects(makeUser(1), { code: 'P2002' });
      const friendship = await tx.friendship.create({ data: { senderId:first.id, recipientId:second.id }});
      assert.equal(friendship.status, 'PENDING');
      await tx.friendship.update({where:{id:friendship.id}, data:{status:'ACCEPTED'}});
      await assert.rejects(tx.friendship.create({data:{senderId:first.id,recipientId:first.id}}));
      await assert.rejects(tx.friendship.create({data:{senderId:first.id,recipientId:second.id}}), {code:'P2002'});
      await assert.rejects(tx.friendship.create({data:{senderId:first.id,recipientId:-1n}}), {code:'P2003'});
      const match = await tx.match.create({data:{mode:'classic',startedAt:new Date('2026-01-01'),endedAt:new Date('2026-01-02')}});
      await assert.rejects(tx.match.create({data:{mode:'classic',startedAt:new Date('2026-01-02'),endedAt:new Date('2026-01-01')}}));
      await tx.matchPlayer.create({data:{matchId:match.id,userId:first.id,result:'WIN'}});
      await tx.matchPlayer.create({data:{matchId:match.id,guestName:'Guest test',result:'DURAK'}});
      await assert.rejects(tx.matchPlayer.create({data:{matchId:match.id,result:'WIN'}}));
      await assert.rejects(tx.matchPlayer.create({data:{matchId:match.id,userId:second.id,guestName:'Both',result:'WIN'}}));
      await assert.rejects(tx.matchPlayer.create({data:{matchId:match.id,userId:first.id,result:'WIN'}}), {code:'P2002'});
      await assert.rejects(tx.matchPlayer.create({data:{matchId:-1n,userId:second.id,result:'WIN'}}), {code:'P2003'});
      const history = await tx.match.findUnique({where:{id:match.id},include:{players:{include:{user:true}}}});
      assert.equal(history.players.length,2);
      assert.equal(history.players.find(p=>p.userId)?.user.username,first.username);
      await tx.match.delete({where:{id:match.id}});
      assert.equal(await tx.matchPlayer.count({where:{matchId:match.id}}),0);
      throw rollback;
    }, {timeout:60000});
  } catch (error) { if (error !== rollback) throw error; }
  console.log('PASS: database types, defaults, uniqueness, foreign keys, CHECK constraints, guest and user results. Test transaction rolled back.');

  server = createAuthApp(prisma).listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const base = `http://127.0.0.1:${server.address().port}`;
  const values = {email,username,name:'Auth check',password:randomBytes(24).toString('hex')};
  const post = (route,cookie) => fetch(`${base}/api/auth/${route}`, {
    method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(values),
  });
  const me = cookie => fetch(`${base}/api/auth/me`,{headers:{cookie}});
  const registration = await post('register'); assert.equal(registration.status,201);
  const user = (await registration.json()).user;
  assert.equal(typeof user.id,'string'); assert.equal(user.username,username);
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  assert.equal((await me(cookie)).status,200);
  assert.equal((await post('logout',cookie)).status,204);
  assert.equal((await me(cookie)).status,401);
  const login = await post('login'); assert.equal(login.status,200);
  const newCookie = login.headers.get('set-cookie').split(';')[0];
  await prisma.user.update({where:{email},data:{status:'BANNED'}});
  assert.equal((await post('login')).status,403);
  assert.equal((await me(newCookie)).status,401);
  console.log('PASS: registration, bigint JSON, login, logout and banned accounts against the real database.');
} finally {
  try { await prisma.user.deleteMany({where:{email,username}}); }
  finally {
    await prisma.$disconnect();
    if(server) await new Promise(resolve=>server.close(resolve));
  }
}
