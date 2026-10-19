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
  const vps = host.provide('vps', new VpsSetup(host));
  machines.routes(host.router);
  vps.routes(host.router);
  // Live channel of a paired machine: /ws/m/<machine>[/term]
  host.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws/m/')) return false;
    machines.bridge(req, socket, head);
    return true;
  });
};

exports.deactivate = () => {};
