'use strict';
/*
 * Own server with one click: sets up Hostwerk on a rented server (VPS) or a Linux home server over SSH and pairs it as a
 * "machine" – afterwards you operate it in Hostwerk like this PC.
 *
 *   1. SSH connection (password or key – used only for this run, never stored)
 *   2. check the system (Debian/Ubuntu/Fedora …, x64/arm64), install missing tools (curl, tar, xz)
 *   3. Node.js LTS to /opt/hostwerk/node, Hostwerk (only the runtime files of this version) to /opt/hostwerk/app
 *   4. own system user "hostwerk", data in /var/lib/hostwerk, service (systemd; otherwise a start script)
 *   5. remote access with a random password + two-factor, pairing key, firewall rule (ufw/firewalld)
 *   6. pair it as a machine (certificate fingerprint checked)
 * "Update" only puts Node/app in place again and restarts the service – data stays.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// Bound at start (see server/index.js): Hostwerk's helpers and its program folder
let H = null;
const T = (s, v) => H.t(s, v);
const REMOTE_PORT = 7443;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** TOTP code (for setting up two-factor sign-in on the server automatically). */
function totpNow(secret) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const key = [];
  for (const ch of secret.replace(/[^A-Z2-7]/gi, '').toUpperCase()) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { key.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

class VpsSetup {
  constructor(host) { H = host; this.ctx = host.ctx; }

  connect({ host, port = 22, user = 'root', password, privateKey, passphrase }) {
    const { Client } = H.lib('ssh2');
    return new Promise((resolve, reject) => {
      const c = new Client();
      let hostKey = null;
      c.on('ready', () => resolve({ c, hostKey }));
      c.on('error', (e) => reject(new Error(/authentication/i.test(e.message) ? T('Sign-in to the server failed – check user, password or key.') : `SSH: ${e.message}`)));
      c.connect({
        host, port: Number(port) || 22, username: user, password: password || undefined, privateKey: privateKey || undefined, passphrase: passphrase || undefined,
        readyTimeout: 20000, keepaliveInterval: 15000,
        hostVerifier: (key) => { hostKey = crypto.createHash('sha256').update(key).digest('base64'); return true; },
      });
    });
  }

  /** Run a command → { code, out }; the output goes into the job log. */
  exec(c, cmd, job, { quiet = false, input } = {}) {
    return new Promise((resolve, reject) => {
      c.exec(cmd, (err, stream) => {
        if (err) { reject(err); return; }
        let out = '';
        const onData = (d) => { out += d; if (!quiet && job) for (const l of String(d).split(/\r?\n/)) if (l.trim()) job.log(l.slice(0, 300)); };
        stream.on('data', onData);
        stream.stderr.on('data', onData);
        stream.on('close', (code) => resolve({ code, out }));
        if (input) stream.end(input);
      });
    });
  }

  async must(c, cmd, job, what, opts) {
    const r = await this.exec(c, cmd, job, opts);
    if (r.code !== 0) throw new Error(T('{what} failed (code {code}): {out}', { what, code: r.code, out: r.out.split('\n').filter(Boolean).slice(-2).join(' ') }));
    return r.out;
  }

  /** Runtime package of this Hostwerk version (server/, ui/dist, packages) as .tgz. */
  async bundle(job) {
    const { ServiceMode } = H.service('live/service');
    const APP_ROOT = H.appRoot;
    const sm = new ServiceMode(this.ctx);
    const stage = path.join(this.ctx.paths.cache, `vps-app-${Date.now()}`);
    fs.mkdirSync(stage, { recursive: true });
    const cp = (rel) => fs.cpSync(path.join(APP_ROOT, rel), path.join(stage, rel), { recursive: true, dereference: true, filter: (src) => !/[\\/]bridge[\\/]target([\\/]|$)/.test(src) });
    cp('server');
    cp(path.join('ui', 'dist'));
    fs.copyFileSync(path.join(APP_ROOT, 'package.json'), path.join(stage, 'package.json'));
    const mods = sm.prodModules();
    job.log(T('Packing {n} packages …', { n: mods.length }));
    for (const m of mods) cp(path.join('node_modules', m));
    const out = stage + '.tgz';
    await new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile(os.platform() === 'win32' ? 'tar.exe' : 'tar', ['-czf', out, '-C', stage, '.'], { windowsHide: true, maxBuffer: 1 << 20 }, (e) => (e ? reject(new Error(T('Packing failed: {msg}', { msg: e.message }))) : resolve()));
    });
    fs.rmSync(stage, { recursive: true, force: true });
    return out;
  }

  upload(c, local, remote, job) {
    return new Promise((resolve, reject) => {
      c.sftp((err, sftp) => {
        if (err) { reject(err); return; }
        const total = fs.statSync(local).size;
        sftp.fastPut(local, remote, { step: (done) => job.progress(30 + (done / total) * 25, T('Uploading Hostwerk – {done} / {total} MB', { done: Math.round(done / 1048576), total: Math.round(total / 1048576) })) }, (e) => { sftp.end(); if (e) reject(e); else resolve(); });
      });
    });
  }

  /** Newest Node.js LTS for Linux. */
  async nodeVersion() {
    const list = await H.core('download').fetchJson('https://nodejs.org/dist/index.json');
    const lts = list.find((v) => v.lts && Number(v.version.slice(1).split('.')[0]) >= 22);
    if (!lts) throw new Error(T('No suitable Node.js version found.'));
    return lts.version;
  }

  /**
   * Domain for the server's remote access: get a certificate on the server (Let's Encrypt, port 80), enter the domain there
   * and switch the pairing here to https://domain:port with the new fingerprint – through the existing, protected connection
   * (no break of trust by the new certificate).
   */
  async setupDomain(mid, { domain, email, staging }, job) {
    const m = this.ctx.machines;
    const wait = async (jobId) => { for (;;) { await new Promise((r) => setTimeout(r, 1500)); const j = await m.raw(mid, 'GET', `/jobs/${jobId}`); if (j.state === 'done') return j.result; if (j.state !== 'running') throw new Error(j.error || T('Certificate failed')); } };
    const st = await m.raw(mid, 'POST', '/live/domains/cert-standalone', { domain, email, agree: true, staging: !!staging });
    const cert = await wait(st.job);
    job.log(T('Certificate for {domain} received (valid until {date}).', { domain, date: new Date(cert.expiresAt).toLocaleDateString() }));
    await m.raw(mid, 'PUT', '/live/remote/domain', { domain });
    const cur = m.get(mid);
    const u = new URL(cur.url);
    const url = `https://${domain}${u.port && u.port !== '443' ? ':' + u.port : ''}`;
    const list = this.ctx.settings.get().machines;
    const entry = list.find((x) => x.id === mid);
    entry.url = url; entry.fp = cert.fingerprint;
    this.ctx.settings.save();
    // Wait a moment until remote access runs with the new certificate, then check
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await m.raw(mid, 'GET', '/app/ping'); job.log(T('Reachable at {url} ✓', { url })); return { url, machine: m.pub(entry), domain }; } catch { /* not yet */ }
    }
    throw new Error(T('Not reachable at {url} yet – does the DNS record (A) of the domain point to the server?', { url }));
  }

  setup(opts) {
    const mode = opts.mode === 'update' ? 'update' : 'install';
    if (!opts.host) throw new Error(T('Please enter the address of the server.'));
    return H.core('jobs').runJob(`${mode === 'update' ? T('Update own server') : T('Set up own server')}: ${opts.host}`, async (job) => {
      job.progress(2, T('Connecting to the server …'));
      const { c, hostKey } = await this.connect(opts);
      job.onCancel(() => { try { c.end(); } catch { /* ignore */ } });
      job.log(T('Connected (SSH key of the server: SHA256:{key}).', { key: hostKey }));
      let bundle = null;
      try {
        const S = (await this.exec(c, 'id -u', job, { quiet: true })).out.trim() === '0' ? '' : 'sudo -n ';
        if (S && (await this.exec(c, 'sudo -n true', job, { quiet: true })).code !== 0) throw new Error(T('The user needs administrator rights (root or sudo without a password prompt).'));
        const osr = (await this.exec(c, 'cat /etc/os-release; uname -m', job, { quiet: true })).out;
        const arch = /aarch64|arm64/.test(osr) ? 'arm64' : /x86_64|amd64/.test(osr) ? 'x64' : null;
        if (!arch) throw new Error(T('Only 64-bit servers (x64 or arm64) are supported.'));
        job.log(`System: ${(osr.match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || 'Linux'} (${arch})`);
        job.progress(8, T('Checking tools …'));
        await this.must(c, `${S}sh -c ${q('command -v curl >/dev/null && command -v tar >/dev/null && command -v xz >/dev/null || { if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl tar xz-utils ca-certificates; elif command -v dnf >/dev/null; then dnf install -y -q curl tar xz; elif command -v yum >/dev/null; then yum install -y -q curl tar xz; else echo "package manager not recognised"; exit 1; fi; }')}`, job, T('Installing tools'));
        job.progress(15, T('Providing Node.js …'));
        const nv = await this.nodeVersion();
        await this.must(c, `${S}sh -c ${q(`mkdir -p /opt/hostwerk && if [ "$(/opt/hostwerk/node/bin/node -v 2>/dev/null)" != "${nv}" ]; then rm -rf /opt/hostwerk/node /opt/hostwerk/node-${nv}-linux-${arch} && curl -fsSL https://nodejs.org/dist/${nv}/node-${nv}-linux-${arch}.tar.xz | tar -xJ -C /opt/hostwerk && mv /opt/hostwerk/node-${nv}-linux-${arch} /opt/hostwerk/node; fi; /opt/hostwerk/node/bin/node -v`)}`, job, T('Installing Node.js'));
        job.progress(22, T('Packing Hostwerk …'));
        bundle = await this.bundle(job);
        await this.upload(c, bundle, '/tmp/hostwerk-app.tgz', job);
        job.progress(57, T('Setting up Hostwerk on the server …'));
        await this.must(c, `${S}sh -c ${q('set -e; id hostwerk >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/hostwerk --shell /usr/sbin/nologin hostwerk; mkdir -p /var/lib/hostwerk; rm -rf /opt/hostwerk/app.neu && mkdir -p /opt/hostwerk/app.neu && tar -xzf /tmp/hostwerk-app.tgz -C /opt/hostwerk/app.neu && rm -f /tmp/hostwerk-app.tgz; rm -rf /opt/hostwerk/app.alt; [ -d /opt/hostwerk/app ] && mv /opt/hostwerk/app /opt/hostwerk/app.alt || true; mv /opt/hostwerk/app.neu /opt/hostwerk/app; chown -R hostwerk:hostwerk /var/lib/hostwerk')}`, job, T('Unpacking Hostwerk'));
        // Service: systemd (normal server) – otherwise a start script (e.g. containers without systemd)
        const systemd = (await this.exec(c, '[ -d /run/systemd/system ] && echo ja', job, { quiet: true })).out.includes('ja');
        // Start script with a fallback for Node.js updates (Hostwerk updates Node.js on the server itself) –
        // so /opt/hostwerk and node belong to the service user
        await this.must(c, `${S}sh -c ${q('cat > /opt/hostwerk/start-node.sh && chmod 755 /opt/hostwerk/start-node.sh && chown hostwerk:hostwerk /opt/hostwerk && chown -R hostwerk:hostwerk /opt/hostwerk/node')}`, job, T('Writing the start script'), { input: H.service('runtime').START_SCRIPT });
        const start = '/opt/hostwerk/start-node.sh';
        if (systemd) {
          const unit = ['[Unit]', 'Description=Hostwerk (server hub, headless)', 'After=network-online.target', 'Wants=network-online.target', '', '[Service]', 'User=hostwerk', 'Environment=HOSTWERK_SERVICE=1', `ExecStart=${start}`, 'AmbientCapabilities=CAP_NET_BIND_SERVICE', 'Restart=on-failure', 'RestartSec=5', 'LimitNOFILE=65536', '', '[Install]', 'WantedBy=multi-user.target', ''].join('\n');
          await this.must(c, `${S}sh -c ${q(`cat > /etc/systemd/system/hostwerk.service && systemctl daemon-reload && systemctl enable hostwerk >/dev/null 2>&1 && systemctl restart hostwerk`)}`, job, T('Setting up the service'), { input: unit });
          job.log(T('Service “hostwerk” set up (also starts after server restarts).'));
        } else {
          const script = ['#!/bin/sh', '# Created by Hostwerk – starts Hostwerk without systemd', 'pkill -f /opt/hostwerk/start-node.sh 2>/dev/null; pkill -f "/opt/hostwerk/app/server/cli.js start" 2>/dev/null; sleep 1', `cd /var/lib/hostwerk && HOSTWERK_SERVICE=1 nohup su -s /bin/sh hostwerk -c "${start}" >> /var/lib/hostwerk/dienst.log 2>&1 &`, ''].join('\n');
          await this.must(c, `${S}sh -c ${q('cat > /opt/hostwerk/start.sh && chmod 755 /opt/hostwerk/start.sh && /opt/hostwerk/start.sh; (crontab -l 2>/dev/null | grep -v hostwerk/start.sh; echo "@reboot /opt/hostwerk/start.sh") | crontab - 2>/dev/null || true')}`, job, T('Setting up the start script'), { input: script });
          job.log(T('Without systemd: start script /opt/hostwerk/start.sh (at reboot through cron).'));
        }
        job.progress(70, T('Waiting until Hostwerk runs …'));
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          // As a service Hostwerk writes run/service.json (otherwise headless.json)
          ready = (await this.exec(c, `${S}sh -c ${q('cat /var/lib/hostwerk/run/ui-token >/dev/null 2>&1 && cat /var/lib/hostwerk/run/service.json /var/lib/hostwerk/run/headless.json 2>/dev/null')}`, job, { quiet: true })).out.includes('"port"');
        }
        if (!ready) throw new Error(T('Hostwerk does not start on the server – details: /var/lib/hostwerk/logs or journalctl -u hostwerk'));
        if (mode === 'update') { job.progress(100, T('Updated')); return { updated: true }; }

        // Set up remote access (password + two-factor) and create a pairing key – right on the server
        job.progress(78, T('Setting up remote access …'));
        const password = crypto.randomBytes(15).toString('base64url');
        const pair = `
          const fs = require('fs'); const crypto = require('crypto'); const run = '/var/lib/hostwerk/run';
          const token = fs.readFileSync(run + '/ui-token', 'utf8').trim(); const port = JSON.parse(fs.readFileSync(run + (fs.existsSync(run + '/service.json') ? '/service.json' : '/headless.json'), 'utf8')).port;
          const api = (m, p, b) => fetch('http://127.0.0.1:' + port + '/api' + p, { method: m, headers: { 'x-hostwerk-token': token, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; });
          ${totpNow.toString()}
          (async () => {
            await api('PUT', '/live/remote', { port: ${REMOTE_PORT}, user: 'admin', password: ${JSON.stringify(password)} });
            const t = await api('POST', '/live/remote/totp/new');
            await api('POST', '/live/remote/totp/confirm', { code: totpNow(t.secret) });
            await api('PUT', '/live/remote', { enabled: true });
            for (let i = 0; i < 20; i++) { const s = await api('GET', '/live/remote'); if (s.running) break; await new Promise((r) => setTimeout(r, 500)); }
            const k = await api('POST', '/live/remote/keys', { name: ${JSON.stringify(os.hostname())} });
            console.log('HWPAIR' + JSON.stringify({ code: k.code, secret: t.secret, uri: t.uri }));
          })().catch((e) => { console.error('ERROR ' + e.message); process.exit(1); });`;
        const pr = await this.exec(c, `${S}/opt/hostwerk/node/bin/node -`, job, { quiet: true, input: pair });
        const m = pr.out.match(/HWPAIR(\{.*\})/);
        if (!m) throw new Error(T('Remote access could not be set up: {out}', { out: pr.out.split('\n').filter(Boolean).slice(-1)[0] || '' }));
        const p = JSON.parse(m[1]);
        // Firewall on the server: allow remote access
        // (with a domain also port 80 for the Let's Encrypt check)
        const fwPorts = [REMOTE_PORT, ...(opts.domain ? [80] : [])];
        await this.exec(c, `${S}sh -c ${q(`if command -v ufw >/dev/null && ufw status | grep -q active; then ${fwPorts.map((x) => `ufw allow ${x}/tcp`).join('; ')}; elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then ${fwPorts.map((x) => `firewall-cmd --permanent --add-port=${x}/tcp`).join(' && ')} && firewall-cmd --reload; fi`)}`, job, {});
        // Pair – with the address this PC reaches the server under
        job.progress(92, T('Pairing as a machine …'));
        const code = JSON.parse(Buffer.from(p.code, 'base64url').toString());
        code.u = [opts.publicUrl || `https://${opts.host}:${REMOTE_PORT}`];
        let machine = await this.ctx.machines.add({ code: Buffer.from(JSON.stringify(code)).toString('base64url'), name: opts.name || opts.host });
        let url = code.u[0];
        // Own domain: Let's Encrypt certificate on the server, then switch the pairing to the domain + new fingerprint
        let domain = null;
        if (opts.domain) {
          try {
            job.progress(94, T('Getting an HTTPS certificate for {domain} …', { domain: opts.domain }));
            domain = await this.setupDomain(machine.id, opts, job);
            machine = domain.machine; url = domain.url;
          } catch (e) { job.log(T('Domain/certificate: {msg} – the server stays reachable at {url}; do it later under Go live → Remote access.', { msg: e.message, url })); domain = { error: e.message }; }
        }
        // Automatic backup of the server to this PC (task, daily)
        let backup = null;
        if (opts.backup) {
          try { backup = this.ctx.scheduler.save({ name: T('Backup: {name}', { name: opts.name || opts.host }), action: { type: 'machine-backup', target: machine.id }, schedule: { mode: 'daily', time: '03:30', days: [] }, retries: 2, retryMin: 30, notify: 'error' }); job.log(T('Daily backup to this PC set up (03:30, under “Tasks”).')); } catch (e) { job.log(T('Backup: {name}', { name: e.message })); }
        }
        const qr = await H.lib('qrcode').toString(p.uri, { type: 'svg', margin: 1, width: 200 });
        job.log(T('Done: the server is paired as a machine.'));
        return { machine, login: { url, user: 'admin', password, totpSecret: p.secret, totpQr: qr }, domain, backup: backup ? { task: backup.id } : null };
      } finally {
        try { c.end(); } catch { /* ignore */ }
        if (bundle) fs.rmSync(bundle, { force: true });
      }
    });
  }

  routes(r) {
    r.post('/vps/setup', (req, res) => res.json({ job: this.setup(req.body || {}).id }));
  }
}

module.exports = { VpsSetup, totpNow };
