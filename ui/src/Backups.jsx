import { useState } from 'react';
import { History, Undo2, Laptop, Server, FolderOpen, Database, Box } from 'lucide-react';
import { post, useApi, waitJob, fmtBytes } from '@hostwerk/api';
import { Btn, Modal, Empty, Loading, Seg, Switch, toast } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';

/*
 * Restore from server backups: everything the nightly backup of a paired machine put on this PC – by day and content.
 * Back to the original machine or onto this PC. (The backups themselves are Hostwerk's "move" feature: /transfer.)
 */
const KIND = { project: ['Project', FolderOpen], db: ['Database', Database], mc: ['Minecraft server', Box] };
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

export default function ServerBackups({ machine, onClose }) {
  const list = useApi('/transfer/backups', [], { live: false, poll: true });
  const [day, setDay] = useState(null);
  const [to, setTo] = useState('orig');
  const [test, setTest] = useState(true);
  const [busy, setBusy] = useState(null);
  if (!list.data) return <Modal title="Backups" onClose={onClose}><Loading /></Modal>;
  const entry = list.data.find((x) => (machine ? x.machine === machine.id : true));
  const days = entry ? entry.days : [];
  const cur = days.find((d) => d.day === day) || days[0];
  const restore = async (it) => {
    setBusy(it.file);
    try {
      const target = to === 'orig' && entry.machine ? entry.machine : 'local';
      const r = await post('/transfer/restore', { folder: entry.folder, day: cur.day, file: it.file, to: target, test });
      const res = await waitJob(r.job);
      toast.success(res && res.kind === 'mc' ? t('Created as its own server “{name}” (port {port})', { name: res.name, port: res.port }) : res && res.backup ? t('Restored – the previous folder was renamed first') : t('Restored'));
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  return (
    <Modal title={entry ? t('Backups of {name}', { name: entry.name }) : t('Backups')} subtitle="Nightly backups on this PC – put back single projects, databases and Minecraft servers." size="wide" onClose={onClose}>
      {!entry ? <Empty icon={History} title="No backup yet" text="When you set up a server (or under Tasks → “Back up server”) Hostwerk puts a backup on this PC every night." /> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <select className="select sm" style={{ width: 'auto' }} aria-label={t('Day')} value={cur.day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d.day} value={d.day}>{t('{day} · {n} parts', { day: fmtDay(d.day), n: d.items.length })}</option>)}
            </select>
            <Seg value={to} onChange={setTo} options={[{ id: 'orig', label: <><Server size={12} /> {t('To {name}', { name: entry.name })}</>, disabled: !entry.machine }, { id: 'local', label: <><Laptop size={12} /> {t('To this PC')}</> }]} />
            <label className="row small" style={{ gap: 6 }}><Switch checked={test} onChange={setTest} />{t('Test run afterwards')}</label>
          </div>
          <div className="list">
            {cur.items.map((it) => {
              const [label, Icon] = KIND[it.kind] || KIND.project;
              return (
                <div key={it.file} className="list-item">
                  <Icon size={16} />
                  <div className="grow"><b>{it.name}</b><div className="tiny muted">{t(label)} · {fmtBytes(it.size)}</div></div>
                  <Btn className="sm" icon={Undo2} busy={busy === it.file} disabled={!!busy} onClick={() => restore(it)}>Restore</Btn>
                </div>
              );
            })}
          </div>
          <div className="tiny muted">Safe: projects – an existing folder is renamed first. Databases – a safety backup of the target first. Minecraft – created as its own server, the original stays.</div>
        </div>
      )}
    </Modal>
  );
}
