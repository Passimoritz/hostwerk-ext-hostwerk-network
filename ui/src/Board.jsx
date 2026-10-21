import { useEffect, useState } from 'react';
import { Monitor, Server, Cpu, MemoryStick, HardDrive, Users, AlertTriangle, CheckCircle2, XCircle, History, SquareTerminal, ArrowRightLeft, RefreshCw, Laptop, ArrowUpCircle, HeartPulse, Archive } from 'lucide-react';
import { useApi, setMachine, currentMachine, fmtBytes } from '@hostwerk/api';
import { Btn, Loading, Empty } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import ServerBackups from './Backups';

/*
 * Every machine at a glance: this PC and every paired server with load, storage, services, players, problems and the
 * last backup. Refreshes every 30 seconds. Also shown on the dashboard (slot "machines.board").
 */
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const level = (p) => (p >= 90 ? 'err' : p >= 75 ? 'warn' : 'ok');
/** Gesundheits-Punktzahl (0–100) → Stufe wie die Balken */
const healthLevel = (score) => (score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'err');
/** Zeitstempel → „heute“, „gestern“, „vor 3 Tagen“ */
const agoTs = (ts) => {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? t('today') : d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
};
const ago = (day) => {
  if (!day) return null;
  const d = Math.round((Date.now() - new Date(`${day}T03:30:00`).getTime()) / 86400000);
  return d <= 0 ? t('today') : d === 1 ? t('yesterday') : t('{n} days ago', { n: d });
};

function Meter({ icon: I, label, value, text }) {
  return (
    <div className="mb-meter" title={label}>
      <I size={12} />
      <div className="mb-bar"><span className={level(value)} style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="tiny">{text}</span>
    </div>
  );
}

function Tile({ m, onBackups, compact }) {
  const cur = currentMachine();
  const isLocal = m.local;
  const memP = m.mem ? pct(m.mem.used, m.mem.total) : 0;
  const diskP = m.disk ? pct(m.disk.total - m.disk.free, m.disk.total) : 0;
  // Older Hostwerk versions on paired machines may not send a service or problem list
  const sv = m.services || { running: 0, total: 0, errors: [] };
  const probs = m.problems || [];
  const bad = !m.online || (sv.errors || []).length || probs.length;
  // Kopie des Servers auf diesem PC (Umziehen/Sichern) – bei älteren Versionen dieser Erweiterung hieß das Feld lastBackup
  const pulled = m.pulledBackup || (typeof m.lastBackup === 'string' ? m.lastBackup : null);
  const backupAge = ago(pulled);
  const staleBackup = !isLocal && pulled && (Date.now() - new Date(`${pulled}T03:30:00`).getTime()) > 2 * 86400000;
  // Aus /summary der Gegenseite (Hostwerk 3.0): eigene letzte Sicherung, Gesundheit, verfügbares Update
  const own = m.lastBackup && typeof m.lastBackup === 'object' ? m.lastBackup : null;
  const ownAge = own ? agoTs(Math.max(own.local || 0, own.offsite || 0)) : null;
  const ownStale = own && Math.max(own.local || 0, own.offsite || 0) && Date.now() - Math.max(own.local || 0, own.offsite || 0) > 7 * 86400000;
  const health = m.health && Number.isFinite(m.health.score) ? m.health : null;
  return (
    <div className={`mb-tile ${!m.online ? 'off' : bad ? 'bad' : ''}`}>
      <div className="mb-head">
        <span className="mb-ico">{isLocal ? <Laptop size={16} /> : <Server size={16} />}</span>
        <div className="grow hn-min0">
          <b className="ellipsis">{m.name}</b>
          <div className="tiny muted ellipsis">{m.online ? `${m.host || ''}${m.version ? ` · Hostwerk ${m.version}` : ''}` : m.error || t('not reachable')}</div>
        </div>
        {m.online ? (bad ? <AlertTriangle size={16} className="c-warn" aria-label={t('Needs attention')} /> : <CheckCircle2 size={16} className="c-ok" aria-label={t('All fine')} />) : <XCircle size={16} className="c-err" aria-label={t('not reachable')} />}
      </div>
      {m.online && (
        <>
          <div className="mb-meters">
            <Meter icon={Cpu} label={t('Processor')} value={m.cpu || 0} text={m.cpu == null ? '–' : `${Math.round(m.cpu)} %`} />
            <Meter icon={MemoryStick} label={t('Memory')} value={memP} text={`${memP} %`} />
            {m.disk && <Meter icon={HardDrive} label={t('Disk space')} value={diskP} text={t('{size} free', { size: fmtBytes(m.disk.free) })} />}
          </div>
          <div className="mb-facts small">
            <span>{t('{running}/{total} services', { running: sv.running, total: sv.total })}</span>
            {m.players > 0 && <span><Users size={11} /> {t('{n} players', { n: m.players })}</span>}
            {!isLocal && <span className={staleBackup ? 'c-warn' : ''} title={t('Copy of this server on this PC')}><History size={11} /> {backupAge ? t('Backup {age}', { age: backupAge }) : t('no backup')}</span>}
            {own && <span className={own.offsiteError || ownStale ? 'c-warn' : ''} title={own.offsiteError ? t('External backup failed: {error}', { error: own.offsiteError }) : t('Last backup there (local or external)')}><Archive size={11} /> {ownAge ? t('Saved {age}', { age: ownAge }) : t('never saved there')}</span>}
            {health && <span className={`c-${healthLevel(health.score)}`} title={t('Health check {age}', { age: agoTs(health.at) || '–' })}><HeartPulse size={11} /> {t('Health {score}/100', { score: health.score })}</span>}
            {m.appUpdate && <span className="c-warn"><ArrowUpCircle size={11} /> {t('Update {version} ready', { version: m.appUpdate })}</span>}
          </div>
          {!compact && ((sv.errors || []).length > 0 || probs.length > 0) && (
            <ul className="mb-problems tiny">
              {(sv.errors || []).map((n) => <li key={n}>{t('{name}: error', { name: n })}</li>)}
              {probs.slice(0, 3).map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </>
      )}
      {!compact && (
        <div className="mb-actions">
          {!isLocal && cur !== m.id && <Btn className="xs primary" icon={ArrowRightLeft} disabled={!m.online} onClick={() => setMachine(m.id)}>Operate</Btn>}
          {isLocal && cur && <Btn className="xs primary" icon={ArrowRightLeft} onClick={() => setMachine(null)}>Operate</Btn>}
          <Btn className="xs ghost" icon={SquareTerminal} disabled={!m.online} onClick={() => { location.hash = '/terminal'; if (!isLocal && cur !== m.id) setMachine(m.id); if (isLocal && cur) setMachine(null); }}>Terminal</Btn>
          {!isLocal && <Btn className="xs ghost" icon={History} onClick={() => onBackups(m)}>Backups</Btn>}
        </div>
      )}
    </div>
  );
}

export default function MachinesBoard({ compact = false }) {
  // Offline machines answer only after 8 s – no reload on every live event (that would throw away each slow answer); own 30 s cycle below
  const o = useApi('/machines/overview', [], { live: false, poll: false });
  // Versteckter Reiter/minimiertes Fenster: nicht fragen – beim Zurückkommen sofort nachholen
  useEffect(() => {
    const x = setInterval(() => { if (!document.hidden) o.reload({ silent: true }); }, 30000);
    const back = () => { if (!document.hidden) o.reload({ silent: true }); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(x); document.removeEventListener('visibilitychange', back); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [backups, setBackups] = useState(null);
  const list = Array.isArray(o.data) ? o.data : null;
  // On the dashboard the tile only shows up once another machine is paired
  if (compact && list && list.length < 2) return null;
  const online = list ? list.filter((m) => m.online).length : 0;
  return (
    <div className="card">
      <div className="card-head"><Monitor size={16} /><h3>Every machine at a glance</h3>
        {list && <span className="badge">{t('{online} of {total} reachable', { online, total: list.length })}</span>}
        <div className="right row-tight">{!compact && <button className="btn ghost sm icon" title="Reload" aria-label={t('Reload')} onClick={o.reload}><RefreshCw /></button>}{compact && <a className="btn sm" href="#/ext/hostwerk-network">Manage</a>}</div>
      </div>
      <div className="card-body">
        {!list && o.error ? <Empty icon={AlertTriangle} title="The machines could not be asked" text={o.error} action={<Btn icon={RefreshCw} onClick={() => o.reload()}>Try again</Btn>} /> : !list ? <Loading text="Asking the machines …" /> : (
          <div className={`mb-grid ${compact ? 'compact' : ''}`}>
            {list.map((m) => <Tile key={m.id} m={m} compact={compact} onBackups={setBackups} />)}
          </div>
        )}
        {list && list.length === 1 && !compact && <div className="small muted hn-mt-3">No other machine paired yet – use “Add machine” below or set up a server with one click.</div>}
      </div>
      {backups && <ServerBackups machine={backups} onClose={() => setBackups(null)} />}
    </div>
  );
}
