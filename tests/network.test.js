'use strict';
/*
 * Hostwerk network without real machines: pairing codes are checked, the list lives in settings.machines as before,
 * rename/remove, routes and the live channel hook are registered, VPS setup asks for an address, messages in German, and
 * the certificate pin refuses a server with another certificate. Real pairing between two Hostwerk instances is tested by
 * Hostwerk's scripts/machines-test.js and scripts/transfer-test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { Machines, pinnedSocket, norm } = require('../server/machines');
const { VpsSetup, totpNow } = require('../server/vps');
const ext = require('../server/index');
const de = require('../locales/de.json');

const fill = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);

function fakeHost(lang = 'en') {
  const S = { general: { language: lang } };
  const routes = [];
  const router = new Proxy({}, { get: (_, method) => (p) => routes.push(`${method.toUpperCase()} ${p}`) });
  const hooks = {};
  const provided = {};
  const ctx = { settings: { get: () => S, save: () => {} }, paths: { cache: require('os').tmpdir() } };
  const host = {
    ctx, router, S, routes, hooks, provided,
    appRoot: path.join(__dirname, '..'),
    t: (s, v) => fill(lang === 'de' && de[s] ? de[s] : s, v),
    core: (n) => ({ secrets: { seal: (x) => `sealed:${x}`, open: (x) => String(x).replace(/^sealed:/, '') } }[n]),
    lib: (n) => ({ ws: {} }[n]),
    provide: (name, obj) => { provided[name] = obj; ctx[name] = obj; return obj; },
    on: (ev, fn) => { (hooks[ev] = hooks[ev] || []).push(fn); },
  };
  return host;
}

const code = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('activate: provides machines + vps, routes and the live channel hook', () => {
  const h = fakeHost();
  ext.activate(h);
  assert.ok(h.provided.machines instanceof Machines);
  assert.ok(h.provided.vps instanceof VpsSetup);
  for (const r of ['GET /machines', 'GET /machines/overview', 'POST /machines', 'PUT /machines/:id', 'DELETE /machines/:id', 'ALL /m/:mid/*rest', 'POST /vps/setup']) assert.ok(h.routes.includes(r), r);
  assert.strictEqual(h.hooks.upgrade.length, 1);
  let destroyed = false;
  assert.strictEqual(h.hooks.upgrade[0]({ url: '/ws/other' }, {}, null), false, 'other paths stay with Hostwerk');
  assert.strictEqual(h.hooks.upgrade[0]({ url: '/ws/m/0123456789' }, { destroy: () => { destroyed = true; } }, null), true);
  assert.ok(destroyed, 'unknown machine → socket closed');
});

test('pairing code: broken and incomplete codes are refused (German too)', async () => {
  const m = new Machines(fakeHost('en'));
  await assert.rejects(m.add({ code: '%%%' }), /pairing code is invalid – please copy all/);
  await assert.rejects(m.add({ code: code({ v: 1, u: ['https://x'] }) }), /The pairing code is invalid\./);
  const g = new Machines(fakeHost('de'));
  await assert.rejects(g.add({ code: code({ v: 2 }) }), /Kopplungscode ist ungültig/);
  assert.throws(() => g.get('nope'), /Rechner nicht gefunden/);
});

test('list in settings.machines: pub, rename, remove', () => {
  const h = fakeHost();
  h.S.machines = [{ id: 'a1b2c3d4e5', name: 'Home server', url: 'https://192.168.1.5:7443', key: 'sealed:k', fp: 'AA:BB', addedAt: 1 }];
  const m = new Machines(h);
  const p = m.pub(m.list[0]);
  assert.strictEqual(p.host, '192.168.1.5:7443');
  assert.strictEqual(p.online, null);
  assert.ok(!('key' in p) && !('fp' in p), 'key and fingerprint never leave the server');
  assert.strictEqual(m.rename('a1b2c3d4e5', 'Cellar').name, 'Cellar');
  m.remove('a1b2c3d4e5');
  assert.deepStrictEqual(h.S.machines, []);
});

test('fingerprints compare without colons and case', () => {
  assert.strictEqual(norm('aa:bb:cc'), norm('AABBCC'));
});

test('VPS setup needs an address; TOTP codes have six digits', () => {
  const v = new VpsSetup(fakeHost('de'));
  assert.throws(() => v.setup({}), /Adresse des Servers/);
  assert.match(totpNow('JBSWY3DPEHPK3PXP'), /^\d{6}$/);
});

test('certificate pin: a server with another certificate is refused', async (t) => {
  let selfsigned;
  try { selfsigned = require(require.resolve('selfsigned', { paths: [path.join(__dirname, '..', '..', '..', 'hostwerk')] })); } catch { t.skip('selfsigned not available'); return; }
  const tls = require('tls');
  const pems = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048 }));
  const srv = tls.createServer({ key: pems.private, cert: pems.cert }, (s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `https://127.0.0.1:${srv.address().port}`;
  try {
    new Machines(fakeHost('en')); // binds T
    await assert.rejects(pinnedSocket(url, 'AA:BB'), /certificate of the other machine changed/);
    const fp = new (require('crypto').X509Certificate)(pems.cert).fingerprint256;
    const s = await pinnedSocket(url, fp);
    s.destroy();
  } finally { srv.close(); }
});

test('every German text has a value', () => {
  for (const [k, v] of Object.entries(de)) if (k !== '$patterns') assert.ok(typeof v === 'string' && v.trim(), k);
});

test('versions are compared; an older machine is marked', () => {
  const { cmpVersion } = require('../server/machines');
  assert.strictEqual(cmpVersion('2.11.0', '2.12.1'), -1); assert.strictEqual(cmpVersion('2.12.1', '2.12.1'), 0); assert.strictEqual(cmpVersion('3.0.0', '2.99.9'), 1);
  assert.strictEqual(cmpVersion(null, '2.1.0'), 0); assert.strictEqual(cmpVersion('x', '2.1.0'), 0);
  const h = fakeHost(); const m = new Machines(h);
  m.localVersion = '2.12.0';
  h.S.machines = [{ id: 'a1b2c3d4e5', name: 'Server', url: 'https://10.0.0.2:8443', key: 'k', fp: 'AA' }];
  m.reach.set('a1b2c3d4e5', { online: true, version: '2.10.3', at: 1 });
  assert.strictEqual(m.pub(h.S.machines[0]).versionDiff, 'older');
  m.reach.set('a1b2c3d4e5', { online: true, version: '2.12.0', at: 1 });
  assert.strictEqual(m.pub(h.S.machines[0]).versionDiff, null);
});

test('outage watch: reported after two failed checks, and again when it is back', () => {
  const h = fakeHost(); const m = new Machines(h);
  h.S.machines = [{ id: 'a1b2c3d4e5', name: 'Server', url: 'https://10.0.0.2:8443', key: 'k', fp: 'AA' }];
  m.reach.set('a1b2c3d4e5', { online: false, error: 'timeout' });
  assert.deepStrictEqual(m.transitions(1000), [], 'one hiccup is not an outage');
  const e = m.transitions(2000);
  assert.deepStrictEqual(e.map((x) => x.type), ['down']);
  assert.strictEqual(m.pub(h.S.machines[0]).downSince, 1000);
  assert.deepStrictEqual(m.transitions(3000), [], 'reported once');
  m.reach.set('a1b2c3d4e5', { online: true, version: '2.12.0' });
  assert.deepStrictEqual(m.transitions(4000).map((x) => x.type), ['up']);
  assert.deepStrictEqual(m.transitions(5000), []);
});
