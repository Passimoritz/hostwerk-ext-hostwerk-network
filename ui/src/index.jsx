import { useState } from 'react';
import { Monitor, Server, Plus, Trash2, Pencil, Link2, KeyRound, Copy, RefreshCw, ArrowRightLeft, CheckCircle2, XCircle, Laptop, Cloud, SquareTerminal, History, Smartphone, Network, ArrowUpCircle, AlertTriangle, Truck } from 'lucide-react';
import { useApi, post, put, del, currentMachine, setMachine, useStore, waitJob } from '@hostwerk/api';
import { Btn, Callout, Modal, Field, InfoTip, Loading, Empty, Seg, Progress, TileEmpty, toast, confirmDialog, promptDialog } from '@hostwerk/ui';
import { contextMenu, useNew, FavMark, favSort, favMenuItem } from '@hostwerk/kit';
import { t } from '@hostwerk/i18n';
import { openNew } from '@hostwerk/kit';
import MachinesBoard from './Board';
import ServerBackups from './Backups';
import { AddonTabs } from './addons';
import './style.css';

/*
 * Hostwerk network: pair other Hostwerk PCs and operate them from here; share this PC with others; set up a Linux
 * server with one click. The switch in the title bar (slot "titlebar") turns the whole interface to the other machine.
 */
const copy = (x) => navigator.clipboard.writeText(x).then(() => toast.success('Copied'));
const openTerminal = (id, cur) => { location.hash = '/terminal'; if (cur !== id) setMachine(id); };
const locale = () => (document.documentElement.lang === 'en' ? 'en-US' : document.documentElement.lang || 'de-DE');
const when = (ts) => new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** Dinge von diesem Rechner woanders hin umziehen – Hostwerks Umzugs-Dialog, Quelle schon gewählt */
const moveFrom = (id) => window.dispatchEvent(new CustomEvent('hw:move', { detail: { from: id } }));
/** Hostwerk auf der Gegenseite aktualisieren (Desktop-App mit eigenem Updater) */
async function updateThere(m, reload) {
  if (!(await confirmDialog({ title: t('Update Hostwerk on “{name}”?', { name: m.name }), text: t('The other machine looks for an update and installs it. Hostwerk restarts there – its services start again afterwards.'), confirm: t('Update') }))) return;
  try {
    const r = await post(`/machines/${m.id}/update`);
    if (r.started) toast.success(t('“{name}” is updating to {version}', { name: m.name, version: r.version || '' }));
    else toast.success(t('“{name}” is already up to date', { name: m.name }));
    setTimeout(reload, 60000);
  } catch (e) { toast.error(e.message); }
}

export function MachinesTab() {
  // Slow when a machine is offline (8 s) – reloaded on purpose after changes, not on every live event
  const list = useApi('/machines?check=1', [], { live: false, poll: false });
  const keys = useApi('/live/remote/keys');
  const remote = useApi('/live/remote');
  const [add, setAdd] = useState(null);
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState(null);
  const cur = currentMachine();
  const share = async () => {
    const name = await promptDialog({ title: 'Share this PC', label: 'For which machine? (just as a reminder)', value: t('My laptop') });
    if (name === null) return;
    try { const r = await post('/live/remote/keys', { name }); setCode(r.code); keys.setData(r.keys); } catch (e) { toast.error(e.message); }
  };
  const rename = async (m) => { const n = await promptDialog({ title: 'Rename machine', label: 'Name', value: m.name }); if (n) { await put(`/machines/${m.id}`, { name: n }); list.reload(); } };
  const menu = (e, m) => contextMenu(e, [favMenuItem('machine', m.id), { label: t('Operate'), icon: ArrowRightLeft, disabled: m.online === false || cur === m.id, onClick: () => setMachine(m.id) }, { label: t('Terminal'), icon: SquareTerminal, onClick: () => openTerminal(m.id, cur) }, { label: t('Move from this machine …'), icon: Truck, disabled: m.online === false, onClick: () => moveFrom(m.id) }, { label: t('Update Hostwerk there'), icon: ArrowUpCircle, disabled: m.online === false, onClick: () => updateThere(m, list.reload) }, { label: t('Backups'), icon: History, onClick: () => setBackups(m) }, { label: t('Rename'), icon: Pencil, onClick: () => rename(m) }, { label: t('Remove'), icon: Trash2, danger: true, onClick: () => remove(m) }]);
  const remove = async (m) => { if (await confirmDialog({ title: t('Remove “{name}”?', { name: m.name }), text: 'The pairing is deleted. Everything stays as it is on the other machine – you can also revoke the key there.', confirm: 'Remove', danger: true })) list.setData(await del(`/machines/${m.id}`)); };
  return (
    <div className="stack">
      <MachinesBoard />
      {backups && <ServerBackups machine={backups} onClose={() => setBackups(null)} />}
      {cur && <Callout kind="info" icon={ArrowRightLeft} title="You are operating another machine right now">The machine list always belongs to this PC. <button className="link-btn" onClick={() => setMachine(null)}>Back to this PC</button></Callout>}
      {/* Rechner verwalten und „Diesen PC freigeben“ nebeneinander statt untereinander (schmal wieder untereinander) */}
      <div className="grid grid-2 hn-cols">
      <div className="card">
        <div className="card-head"><Server size={16} /><h3>Computers & servers</h3>
          <div className="right row-tight"><button className="btn ghost sm icon" title="Check again" aria-label={t('Check again')} onClick={list.reload}><RefreshCw /></button><Btn className="sm" icon={ArrowRightLeft} onClick={() => window.dispatchEvent(new CustomEvent('hw:move', { detail: {} }))}>Move …</Btn><Btn className="sm primary" icon={Plus} onClick={() => setAdd({ code: '', name: '' })}>Add machine</Btn></div>
        </div>
        {!list.data && list.error ? <Empty icon={AlertTriangle} title="The machines could not be checked" text={list.error} action={<Btn icon={RefreshCw} onClick={() => list.reload()}>Try again</Btn>} /> : !list.data ? <Loading text="Checking the machines …" /> : list.data.length === 0 ? (
          <TileEmpty icon={Server} text="None yet. On the other machine (laptop, home server, rented server): Extensions → Hostwerk network → “Share this PC” – then paste the code here." />
        ) : favSort('machine', list.data).map((m) => (
          <div key={m.id} className="list-item" onContextMenu={(e) => menu(e, m)}>
            <div className="ico"><Monitor /></div><FavMark kind="machine" id={m.id} />
            <div className="grow hn-min0">
              <div className="row-tight hn-wrap"><b>{m.name}</b>{m.online === true ? <span className="badge ok"><CheckCircle2 size={10} /> {t('reachable')}</span> : m.online === false ? <span className="badge err"><XCircle size={10} /> {m.downSince ? t('not reachable since {when}', { when: when(m.downSince) }) : t('not reachable')}</span> : null}{cur === m.id && <span className="badge accent">{t('being operated')}</span>}
                {m.versionDiff && <span className={`badge ${m.versionDiff === 'older' ? 'warn' : ''}`} title={t('This PC: Hostwerk {local}', { local: m.localVersion })}>{m.versionDiff === 'older' ? t('older version ({v})', { v: m.version }) : t('newer version ({v})', { v: m.version })}</span>}</div>
              <div className="small muted ellipsis">{m.host}{m.version ? ` · Hostwerk ${m.version}` : ''}{m.error ? ` · ${m.error}` : ''}</div>
            </div>
            <Btn className="xs ghost" icon={SquareTerminal} disabled={m.online === false} title="Terminal on this machine" onClick={() => openTerminal(m.id, cur)}>Terminal</Btn>
            {m.versionDiff === 'older' && m.online && <Btn className="xs" icon={ArrowUpCircle} title="Update Hostwerk on this machine" onClick={() => updateThere(m, list.reload)}>Update</Btn>}
            <Btn className="xs ghost" icon={History} title="Backups of this machine on this PC" onClick={() => setBackups(m)}>Backups</Btn>
            {cur !== m.id && <Btn className="xs primary" icon={ArrowRightLeft} disabled={m.online === false} onClick={() => setMachine(m.id)}>Operate</Btn>}
            <button className="btn ghost xs icon" title="Rename" aria-label={t('Rename')} onClick={() => rename(m)}><Pencil /></button>
            <Btn className="ghost xs icon" icon={Trash2} title="Remove" aria-label={t('Remove')} onClick={() => remove(m)} />
          </div>
        ))}
        <VpsCard onDone={list.reload} />
      </div>

      <div className="card">
        <div className="card-head"><Link2 size={16} /><h3>Share this PC with others</h3>
          <InfoTip>Another Hostwerk PC can then operate this machine – through remote access (HTTPS) with its own key that you can revoke at any time. The key is shown only once.</InfoTip>
        </div>
        <div className="card-body stack hn-gap-3">
          {remote.data && !remote.data.running ? (
            <Callout kind="warn">This needs remote access to be running (password and two-factor). <a href="#/live/fernzugriff">Set up remote access →</a></Callout>
          ) : <div><Btn className="primary sm" icon={KeyRound} onClick={share}>Share this PC</Btn></div>}
          {keys.data && keys.data.length > 0 && (
            <div className="stack hn-gap-1">
              <div className="label">Shares</div>
              {keys.data.map((k) => (
                <div key={k.id} className="row small">
                  <Laptop size={14} className="muted" /><span className="grow">{k.name}</span>
                  <span className="tiny muted">{k.lastUsed ? t('last used {when}', { when: when(k.lastUsed) }) : t('not used yet')}</span>
                  <Btn className="ghost xs" onClick={async () => { if (await confirmDialog({ title: t('Revoke share “{name}”?', { name: k.name }), text: 'The other machine can no longer operate this PC afterwards.', confirm: 'Revoke', danger: true })) keys.setData(await del(`/live/remote/keys/${k.id}`)); }}>Revoke</Btn>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {add && (
        <Modal title="Add machine" onClose={() => setAdd(null)} footer={<><Btn onClick={() => setAdd(null)}>Cancel</Btn><Btn className="primary" busy={busy} disabled={add.code.trim().length < 40} onClick={async () => { setBusy(true); try { await post('/machines', add); toast.success('Paired'); setAdd(null); list.reload(); } catch (e) { toast.error(e.message); } setBusy(false); }}>Pair</Btn></>}>
          <div className="stack">
            <div className="small muted">On the other machine: Extensions → Hostwerk network → “Share this PC” and copy the code shown.</div>
            <Field label="Pairing code"><textarea className="input mono" rows={4} value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} /></Field>
            <Field label="Name (optional)"><input className="input" placeholder="e.g. home server" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {code && (
        <Modal title="Pairing code" subtitle="Only visible now – paste it on the other machine under Extensions → Hostwerk network → “Add machine”" onClose={() => setCode(null)} footer={<Btn className="primary" icon={Copy} onClick={() => copy(code)}>Copy</Btn>}>
          <textarea className="input mono" rows={5} readOnly aria-label={t('Pairing code')} value={code} onFocus={(e) => e.target.select()} />
          <div className="tiny muted hn-mt-2">The code holds the addresses of this PC, a key and the fingerprint of the certificate – so nobody can listen in between.</div>
        </Modal>
      )}
    </div>
  );
}

const emptyVps = (mode) => ({ host: '', port: 22, user: 'root', auth: 'password', password: '', key: '', passphrase: '', name: '', mode, domain: '', email: '', backup: true });

/** Own server with one click: set up a Linux server over SSH and pair it. */
function VpsCard({ onDone }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(null);
  useNew('vps', () => setF(emptyVps('install')));
  const job = useStore((s) => (busy && busy !== true ? s.jobs[busy] : null));
  const start = async () => {
    setBusy(true);
    try {
      const r = await post('/vps/setup', { host: f.host.trim(), port: Number(f.port) || 22, user: f.user.trim() || 'root', name: f.name.trim() || undefined, ...(f.auth === 'key' ? { privateKey: f.key, passphrase: f.passphrase || undefined } : { password: f.password }), mode: f.mode, ...(f.mode !== 'update' ? { domain: f.domain.trim() || undefined, email: f.email.trim() || undefined, backup: !!f.backup } : {}) });
      setBusy(r.job);
      const j = await waitJob(r.job);
      if (j.result && j.result.login) { setLogin(j.result.login); toast.success('Server set up and paired'); if (j.result.domain && j.result.domain.error) toast.warn(t('Domain: {msg}', { msg: j.result.domain.error })); } else toast.success('Server updated');
      setF(null); onDone();
    } catch (e) { if (!e.cancelled) toast.error(e.message); }
    setBusy(false);
  };
  const readKey = (file) => { if (!file) return; const r = new FileReader(); r.onload = () => setF((x) => ({ ...x, key: String(r.result) })); r.readAsText(file); };
  return (
    <div className="card-body stack hn-gap-3 hn-top-line">
      <div className="row-tight hn-wrap"><Cloud size={15} className="muted" /><b className="small">Own server with one click</b><span className="badge">{t('Linux over SSH')}</span>
        <InfoTip>Rented server (e.g. at Hetzner, Netcup, IONOS) or a home server with Ubuntu, Debian or Fedora: Hostwerk sets itself up there – Node.js, Hostwerk without a window as a service, remote access with two-factor, firewall – and then shows up here as a machine. Your SSH sign-in is only used for the setup and never stored.</InfoTip>
        <span className="grow" />
        <Btn className="sm" icon={Cloud} onClick={() => setF(emptyVps('install'))}>Set up server</Btn><Btn className="sm ghost" icon={RefreshCw} onClick={() => setF(emptyVps('update'))}>Update an existing server</Btn>
      </div>
      {f && (
        <Modal title={f.mode === 'update' ? 'Update server' : 'Set up own server'} subtitle={f.mode === 'update' ? 'Puts this Hostwerk version on the server – data and pairing stay' : 'Takes 2–6 minutes depending on the server'} onClose={() => !busy && setF(null)}
          footer={<><Btn onClick={() => setF(null)} disabled={!!busy}>Cancel</Btn><Btn className="primary" icon={Cloud} busy={!!busy} disabled={!f.host.trim() || (f.auth === 'key' ? !f.key : !f.password)} onClick={start}>{f.mode === 'update' ? t('Update') : t('Set up')}</Btn></>}>
          <div className="stack">
            <div className="form-grid">
              <Field label="Address (IP or name)"><input className="input mono" placeholder="203.0.113.10" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} /></Field>
              <Field label="SSH port"><input className="input mono" type="number" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></Field>
              <Field label="User" hint="root or a user with sudo without a password prompt"><input className="input mono" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} /></Field>
              {f.mode !== 'update' && <Field label="Name in Hostwerk (optional)"><input className="input" placeholder="e.g. rented server" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
            </div>
            <Seg value={f.auth} onChange={(v) => setF({ ...f, auth: v })} options={[{ id: 'password', label: t('Password') }, { id: 'key', label: t('SSH key') }]} />
            {f.auth === 'password'
              ? <Field label="SSH password"><input className="input" type="password" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
              : <div className="form-grid"><Field label="Private key (file)"><input type="file" className="input" onChange={(e) => readKey(e.target.files[0])} />{f.key && <span className="hint">{t('✓ Key loaded')}</span>}</Field><Field label="Passphrase (if set)"><input className="input" type="password" value={f.passphrase} onChange={(e) => setF({ ...f, passphrase: e.target.value })} /></Field></div>}
            {f.mode !== 'update' && (
              <div className="vps-extra">
                <div className="form-grid">
                  <Field label="Own domain (optional)" hint="The DNS record (A) has to point to the server. Hostwerk then gets a real HTTPS certificate (Let's Encrypt)."><input className="input mono" placeholder="hostwerk.example.com" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} /></Field>
                  {f.domain.trim() && <Field label="E-mail for Let's Encrypt (optional)" hint="Hostwerk renews by itself and reports problems through your alerts. By setting up you agree to the terms of Let's Encrypt."><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
                </div>
                <label className="check small"><input type="checkbox" checked={f.backup} onChange={(e) => setF({ ...f, backup: e.target.checked })} />{t('Back up to this PC automatically every night (projects, databases, Minecraft – 7 days)')}</label>
              </div>
            )}
            {job && <div><div className="small muted hn-mb-1">{job.text}</div><Progress value={job.progress} indeterminate={!job.progress} /></div>}
          </div>
        </Modal>
      )}
      {login && (
        <Modal title="Server is ready" subtitle="Sign-in for the browser – please note it now, it is not shown again" onClose={() => setLogin(null)} footer={<Btn className="primary" onClick={() => setLogin(null)}>Noted</Btn>}>
          <div className="phone-pair">
            <div className="phone-qr" role="img" aria-label={t('QR code for the authenticator app')} dangerouslySetInnerHTML={{ __html: login.totpQr }} />
            <div className="stack small hn-gap-1">
              <div>Scan the QR code in your authenticator app (for signing in in the browser).</div>
              <div className="row-tight"><span className="muted">{t('Address')}</span><code>{login.url}</code><button className="btn ghost xs icon" aria-label={t('Copy')} onClick={() => copy(login.url)}><Copy /></button></div>
              <div className="row-tight"><span className="muted">{t('User')}</span><code>{login.user}</code></div>
              <div className="row-tight"><span className="muted">{t('Password')}</span><code>{login.password}</code><button className="btn ghost xs icon" aria-label={t('Copy')} onClick={() => copy(login.password)}><Copy /></button></div>
              <div className="tiny muted">You don't need this in Hostwerk itself – the server is already paired as a machine (title bar → switch machine).</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Switch in the title bar (only visible once machines are paired). */
export function MachineSwitch() {
  const list = useApi('/machines', [], { live: false, poll: true });
  const cur = currentMachine();
  if (!list.data || (!list.data.length && !cur)) return null;
  const m = list.data.find((x) => x.id === cur);
  return (
    <label className={`machine-switch no-drag ${cur ? 'remote' : ''}`} title="Switch machine">
      {cur ? <Server size={13} /> : <Monitor size={13} />}
      <select value={cur || ''} aria-label={t('Switch machine')} onChange={(e) => setMachine(e.target.value || null)}>
        <option value="">{t('This PC')}</option>
        {list.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      {cur && !m && <span className="tiny">?</span>}
    </label>
  );
}

function NetworkPage({ ext }) {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div><h1><Network size={22} /> Hostwerk network</h1><p>More PCs and servers with Hostwerk – operate all of them from here, move projects and game servers, put backups back.</p></div>
      </div>
      <InfoTip title="How it works">
        Install Hostwerk on the other machine (Windows or Linux; a rented server works with “Own server with one click”), switch on remote access there and enter the pairing code here. Then switch between the devices in the machine bar at the top – services, files, terminal and AI then run on the chosen machine.
        <span className="small muted hn-block"><Cloud size={12} /> {t('Linux servers in a data centre')} · <Monitor size={12} /> {t('Windows or Linux PCs at home')} · <Smartphone size={12} /> {t('Phone: under Go live → Remote access')}</span>
      </InfoTip>
      <AddonTabs ext={ext}><MachinesTab /></AddonTabs>
    </div>
  );
}

export default {
  pages: { main: NetworkPage },
  slots: {
    titlebar: [{ id: 'machine-switch', title: 'Switch machine', Component: MachineSwitch, order: 10 }],
    'machines.board': [{ id: 'board', title: 'Every machine at a glance', Component: () => <MachinesBoard compact />, order: 10 }],
    // Hostwerks Menü „Neu“ → Abschnitt „Verbinden“
    'new.items': [
      { id: 'pair', section: 'verbinden', title: 'Pair a computer', hint: 'Control another PC or server from here', icon: Monitor, color: '#475569', keys: 'rechner koppeln pc server verbinden', href: '/server' },
      { id: 'vps', section: 'verbinden', title: 'Own server (VPS)', hint: 'Set up a rented server via SSH with one click', icon: Cloud, color: '#0284c7', keys: 'vps hetzner ssh mietserver linux', onClick: () => openNew('vps', '/server') },
    ],
  },
};
