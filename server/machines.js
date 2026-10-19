'use strict';
/*
 * Several machines: operate other Hostwerk installations (laptop, home server, rented server) from this interface.
 * Pairing uses a code from the other machine (Go live → Remote access → "Pair this machine"): addresses, pairing key,
 * certificate fingerprint.
 *
 *   /api/m/<machine>/…   requests of the interface → to the other machine (remote access, HTTPS)
 *   /ws/m/<machine>      live channel → to the other machine
 *
 * Security: before every request the TLS connection is opened and the certificate checked against the stored fingerprint –
 * only then does the key go over the line (so even self-issued certificates are safe). The key is stored encrypted.
 * Data stays where it always was: settings.machines.
 */
const tls = require('tls');
const https = require('https');
const crypto = require('crypto');
// Hostwerk's helpers – bound at start (bindCore)
let secrets = null;
let WebSocketLib = null;
let T = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);
function bindCore(host) { secrets = host.core('secrets'); WebSocketLib = host.lib('ws'); if (host.t) T = host.t; }

const norm = (fp) => String(fp || '').toUpperCase().replace(/[^0-9A-F]/g, '');
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie', 'origin', 'referer', 'x-hostwerk-token', 'content-length']);

/** Open the TLS connection and check the certificate – only then is anything sent. */
function pinnedSocket(url, fp) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
    const t = setTimeout(() => { s.destroy(); reject(new Error(T('The other machine does not answer (timeout).'))); }, 8000);
    s.once('error', (e) => { clearTimeout(t); reject(new Error(T('No connection to {host}: {msg}', { host: u.host, msg: e.message }))); });
    s.once('secureConnect', () => {
      clearTimeout(t);
      const got = norm(s.getPeerCertificate().fingerprint256);
      if (!fp || got !== norm(fp)) { s.destroy(); reject(Object.assign(new Error(T('The certificate of the other machine changed – not connected for safety. Please pair again.')), { status: 495 })); return; }
      resolve(s);
    });
  });
}

class Machines {
  constructor(host) { bindCore(host); this.ctx = host.ctx; this.reach = new Map(); }
  get list() { const s = this.ctx.settings.get(); s.machines = s.machines || []; return s.machines; }
  pub(m) { const st = this.reach.get(m.id) || {}; return { id: m.id, name: m.name, url: m.url, host: new URL(m.url).host, addedAt: m.addedAt, online: st.online ?? null, version: st.version || null, checkedAt: st.at || null, error: st.error || null }; }
  get(id) { const m = this.list.find((x) => x.id === id); if (!m) throw Object.assign(new Error(T('Machine not found')), { status: 404 }); return m; }

  /** Request to a machine (for checks and status). */
  async request(m, method, p, body) {
    const sock = await pinnedSocket(m.url, m.fp);
    const u = new URL(m.url);
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({ host: u.hostname, port: Number(u.port) || 443, method, path: `/api${p}`, createConnection: () => sock, headers: { 'x-hostwerk-key': secrets.open(m.key), accept: 'application/json', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, timeout: 15000 }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch { /* no JSON */ } if (res.statusCode >= 400) reject(new Error(res.statusCode === 401 ? T('The other machine refuses the key (revoked or remote access off) – please pair again.') : (j && j.error) || `HTTP ${res.statusCode}`)); else resolve(j); });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(T('Timeout'))));
      if (data) req.write(data);
      req.end();
    });
  }

  /**
   * Bigger request to a paired machine (e.g. move packages): body as Buffer (binary) or object (JSON), answer as Buffer (raw)
   * or JSON. Same protection as request() (certificate fingerprint, key). Hostwerk's "move" feature uses it as well.
   */
  async raw(mid, method, p, body, { raw = false, timeout = 600000 } = {}) {
    const m = this.get(mid);
    const sock = await pinnedSocket(m.url, m.fp);
    const u = new URL(m.url);
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request({ host: u.hostname, port: Number(u.port) || 443, method, path: `/api${p}`, createConnection: () => sock, timeout,
        headers: { 'x-hostwerk-key': secrets.open(m.key), accept: raw ? '*/*' : 'application/json', ...(data ? { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'content-length': data.length } : {}) } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) { let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch { /* no JSON */ } return reject(new Error(res.statusCode === 401 ? T('The other machine refuses the key – please pair again.') : (j && j.error) || `HTTP ${res.statusCode}`)); }
          if (raw) return resolve(buf);
          try { resolve(JSON.parse(buf.toString('utf8'))); } catch { resolve(null); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(T('Timeout during the transfer'))));
      if (data) req.write(data);
      req.end();
    });
  }

  /** Redeem the pairing code of the other machine. */
  async add({ code, name }) {
    let c;
    try { c = JSON.parse(Buffer.from(String(code || '').trim(), 'base64url').toString('utf8')); } catch { throw new Error(T('The pairing code is invalid – please copy all of it.')); }
    if (!c || c.v !== 1 || !Array.isArray(c.u) || !c.k || !c.f) throw new Error(T('The pairing code is invalid.'));
    const sealed = secrets.seal(c.k);
    let last = null;
    // Take the first reachable address (domain, otherwise home network address)
    for (const url of c.u) {
      const m = { id: crypto.randomBytes(5).toString('hex'), name: String(name || c.n || new URL(url).hostname).slice(0, 60), url, key: sealed, fp: c.f, addedAt: Date.now() };
      try {
        const ping = await this.request(m, 'GET', '/app/ping');
        if (this.list.some((x) => norm(x.fp) === norm(c.f) && x.url === url)) throw new Error(T('This machine is already paired.'));
        this.list.push(m);
        this.ctx.settings.save();
        this.reach.set(m.id, { online: true, version: ping.version, at: Date.now() });
        return this.pub(m);
      } catch (e) { last = e; }
    }
    throw last || new Error(T('The other machine cannot be reached.'));
  }

  remove(id) { const s = this.ctx.settings.get(); s.machines = this.list.filter((m) => m.id !== id); this.ctx.settings.save(); this.reach.delete(id); }
  rename(id, name) { const m = this.get(id); m.name = String(name || m.name).slice(0, 60); this.ctx.settings.save(); return this.pub(m); }

  async status() {
    await Promise.all(this.list.map(async (m) => {
      try { const p = await this.request(m, 'GET', '/app/ping'); this.reach.set(m.id, { online: true, version: p.version, at: Date.now() }); } catch (e) { this.reach.set(m.id, { online: false, error: e.message, at: Date.now() }); }
    }));
    return this.list.map((m) => this.pub(m));
  }

  /** Pass /api/m/<id>/… on to the other machine (streams, uploads and downloads too). */
  async proxy(req, res, id, rest) {
    const m = this.get(id);
    const sock = await pinnedSocket(m.url, m.fp);
    const u = new URL(m.url);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
    headers['x-hostwerk-key'] = secrets.open(m.key);
    // express.json() has already read JSON bodies → serialise again; pass everything else on as a stream
    const parsed = req.body && typeof req.body === 'object' && /json/i.test(req.headers['content-type'] || '') ? JSON.stringify(req.body) : null;
    if (parsed !== null) headers['content-length'] = Buffer.byteLength(parsed);
    else if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const out = https.request({ host: u.hostname, port: Number(u.port) || 443, method: req.method, path: `/api/${rest}${q}`, createConnection: () => sock, headers }, (r) => {
      const h = { ...r.headers };
      delete h['set-cookie'];
      res.writeHead(r.statusCode, h);
      r.pipe(res);
    });
    out.on('error', (e) => { if (!res.headersSent) res.status(502).json({ error: T('Other machine: {msg}', { msg: e.message }) }); else res.destroy(); });
    req.on('close', () => { if (!res.writableEnded) out.destroy(); });
    if (parsed !== null) out.end(parsed);
    else if (['GET', 'HEAD', 'DELETE'].includes(req.method) && !req.headers['content-length']) out.end();
    else req.pipe(out);
  }

  /** Connect the live channel (WebSocket) to the other machine. */
  bridge(req, socket, head) {
    const id = (req.url.match(/^\/ws\/m\/([a-f0-9]{10})/) || [])[1];
    const m = id && this.list.find((x) => x.id === id);
    if (!m) { socket.destroy(); return; }
    const WebSocket = WebSocketLib;
    const local = new WebSocket.WebSocketServer({ noServer: true });
    local.handleUpgrade(req, socket, head, async (client) => {
      let remote;
      try {
        const sock = await pinnedSocket(m.url, m.fp);
        const u = new URL(m.url);
        // /ws/m/<id>/term → /ws/term on the other machine (terminal); otherwise the normal event connection
        const rest = req.url.slice(`/ws/m/${id}`.length);
        remote = new WebSocket(`wss://${u.host}/ws${rest.startsWith('/term') ? rest : ''}`, { createConnection: () => sock, headers: { 'x-hostwerk-key': secrets.open(m.key) }, rejectUnauthorized: false });
      } catch (e) { client.send(JSON.stringify({ type: 'toast', kind: 'error', text: e.message })); client.close(); return; }
      remote.on('message', (d, bin) => { if (client.readyState === 1) client.send(d, { binary: bin }); });
      client.on('message', (d, bin) => { if (remote.readyState === 1) remote.send(d, { binary: bin }); });
      const end = () => { try { client.close(); } catch { /* ignore */ } try { remote.close(); } catch { /* ignore */ } };
      remote.on('close', end); remote.on('error', end); client.on('close', end);
    });
  }

  routes(r) {
    r.get('/machines', async (req, res) => res.json(req.query.check === '1' ? await this.status() : this.list.map((m) => this.pub(m))));
    // Every machine at a glance: this PC + every paired one (in parallel, at most 8 s each)
    r.get('/machines/overview', async (req, res) => {
      const backups = this.ctx.transfer ? this.ctx.transfer.backups() : [];
      const one = async (m) => {
        const bk = backups.find((b) => b.machine === m.id);
        const lastBackup = bk && bk.days[0] ? bk.days[0].day : null;
        try {
          const s = await Promise.race([this.raw(m.id, 'GET', '/summary', null, { timeout: 8000 }), new Promise((_, rej) => setTimeout(() => rej(new Error(T('does not answer'))), 8000))]);
          return { id: m.id, name: m.name, url: m.url, online: true, lastBackup, ...s };
        } catch (e) { return { id: m.id, name: m.name, url: m.url, online: false, error: e.message, lastBackup }; }
      };
      const local = this.ctx.summary ? await this.ctx.summary() : {};
      res.json([{ id: 'local', name: T('This PC'), online: true, local: true, ...local }, ...(await Promise.all(this.list.map(one)))]);
    });
    r.post('/machines', async (req, res) => res.json(await this.add(req.body || {})));
    r.put('/machines/:id', (req, res) => res.json(this.rename(req.params.id, (req.body || {}).name)));
    r.delete('/machines/:id', (req, res) => { this.remove(req.params.id); res.json(this.list.map((m) => this.pub(m))); });
    r.all('/m/:mid/*rest', (req, res) => {
      const rest = [].concat(req.params.rest || []).join('/');
      this.proxy(req, res, req.params.mid, rest).catch((e) => { if (!res.headersSent) res.status(e.status || 502).json({ error: e.message }); });
    });
  }
}

module.exports = { Machines, pinnedSocket, norm };
