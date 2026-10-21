'use strict';
/*
 * Streaming between machines (Hostwerk's "move" uses it): rawFile sends a file or stream without buffering it, download
 * writes straight into a file (via .part), errors of the other side arrive as messages, the key only goes to the pinned
 * certificate. A local HTTPS server with a self-signed certificate plays the other machine.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Machines } = require('../server/machines');

async function other(t) {
  let selfsigned;
  try { selfsigned = require(require.resolve('selfsigned', { paths: [path.join(__dirname, '..', '..', '..', 'hostwerk')] })); } catch { t.skip('selfsigned not available'); return null; }
  const pems = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 1, keySize: 2048 }));
  const seen = [];
  const big = crypto.randomBytes(3 * 1048576 + 17);
  const srv = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    if (req.headers['x-hostwerk-key'] !== 'secret-key') { res.writeHead(401); res.end('{}'); return; }
    if (req.method === 'POST' && req.url.startsWith('/api/up')) {
      const h = crypto.createHash('sha256'); let n = 0;
      req.on('data', (c) => { n += c.length; h.update(c); });
      req.on('end', () => { seen.push({ len: req.headers['content-length'] || null, chunked: req.headers['transfer-encoding'] === 'chunked' }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ bytes: n, sha: h.digest('hex') })); });
      return;
    }
    if (req.url === '/api/pkg') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); Readable.from([big.subarray(0, 1048576), big.subarray(1048576)]).pipe(res); return; }
    if (req.url === '/api/half') { res.writeHead(200, { 'content-length': 1000 }); res.write(Buffer.alloc(100)); setTimeout(() => res.destroy(), 20); return; }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'No such package' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const S = { machines: [{ id: 'abcdef0123', name: 'Other', url: `https://127.0.0.1:${srv.address().port}`, key: 'sealed:secret-key', fp: new crypto.X509Certificate(pems.cert).fingerprint256 }] };
  const host = { ctx: { settings: { get: () => S, save: () => {} } }, core: () => ({ open: (x) => String(x).replace(/^sealed:/, '') }), lib: () => ({}) };
  t.after(() => srv.close());
  return { m: new Machines(host), seen, big };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hn-'));

test('rawFile streams a file (with length) and a stream (chunked)', async (t) => {
  const o = await other(t); if (!o) return;
  const file = path.join(tmp(), 'pkg.bin'); fs.writeFileSync(file, o.big);
  const r = await o.m.rawFile('abcdef0123', 'POST', '/up?x=1', file);
  assert.deepStrictEqual(r, { bytes: o.big.length, sha: crypto.createHash('sha256').update(o.big).digest('hex') });
  assert.strictEqual(o.seen[0].len, String(o.big.length));
  const r2 = await o.m.rawFile('abcdef0123', 'POST', '/up', Readable.from([Buffer.from('ab'), Buffer.from('cd')]));
  assert.strictEqual(r2.bytes, 4); assert.ok(o.seen[1].chunked);
  await assert.rejects(o.m.rawFile('abcdef0123', 'POST', '/nope', file), /No such package/);
});

test('download writes straight into the file; errors leave nothing behind', async (t) => {
  const o = await other(t); if (!o) return;
  const dir = tmp(); const dest = path.join(dir, 'got.bin');
  const n = await o.m.download('abcdef0123', '/pkg', dest);
  assert.strictEqual(n, o.big.length);
  assert.ok(fs.readFileSync(dest).equals(o.big));
  await assert.rejects(o.m.download('abcdef0123', '/missing', path.join(dir, 'x.bin')), /No such package/);
  await assert.rejects(o.m.download('abcdef0123', '/half', path.join(dir, 'half.bin')));
  assert.deepStrictEqual(fs.readdirSync(dir), ['got.bin'], 'no half or .part file');
});
