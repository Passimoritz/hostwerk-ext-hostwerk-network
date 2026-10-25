'use strict';
/*
 * Hostwerk network: pair other Hostwerk installations (laptop, home server, rented server), operate them from this
 * interface, set up an own server over SSH (VPS) and see every machine at a glance.
 *
 * Provides ctx.machines (Hostwerk's move, deploy, logs and backup features use it when it is there) and ctx.vps.
 * Data stays where it always was: settings.machines.
 */
const { Machines } = require('./machines');
const { VpsSetup } = require('./vps');

exports.activate = (host) => {
  const machines = host.provide('machines', new Machines(host));
  if (typeof host.contribute === 'function') host.contribute('clickguard', { block: [/^\/machines(\/|$)/] }); // Klick-Test: Rechner koppeln wirkt außerhalb des Test-Ordners
  // Seite für „andere Rechner“: Hostwerk verlinkt darüber (Gesundheits-Check, Terminal, Projekte …), ohne uns zu kennen
  machines.href = '#/server';
  const vps = host.provide('vps', new VpsSetup(host));
  machines.routes(host.router);
  vps.routes(host.router);
  // Ausfall-Wächter: alle 2 Minuten fragen, Ausfälle und Wiederkehr melden
  if (!process.env.HW_TEST) machines.startWatch();
  host.on('shutdown', () => machines.stopWatch());
  // Live channel of a paired machine: /ws/m/<machine>[/term]
  host.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws/m/')) return false;
    machines.bridge(req, socket, head);
    return true;
  });
};

exports.deactivate = () => {};
