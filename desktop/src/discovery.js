// Lets the other PCs find the main PC on the office network without typing
// an IP address: the main PC answers UDP broadcasts on DISCOVERY_PORT with
// its name and app port; a client broadcasts and collects the answers.
const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 47333;
const QUERY = 'WARESYS_DISCOVER_1';

let responder = null;

function startResponder(info) {
  if (responder) return;
  responder = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  responder.on('message', (msg, rinfo) => {
    if (msg.toString() !== QUERY) return;
    const reply = Buffer.from(JSON.stringify({ app: 'waresys', name: os.hostname(), ...info }));
    responder.send(reply, rinfo.port, rinfo.address);
  });
  // Discovery is a convenience; clients can still type the address.
  responder.on('error', (err) => console.error('Discovery responder:', err.message));
  responder.bind(DISCOVERY_PORT);
}

function stopResponder() {
  responder?.close();
  responder = null;
}

// Directed broadcast for every IPv4 network this PC is on, plus the
// limited broadcast address (which some Windows setups only send on one
// adapter).
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

// Resolves with every main PC that answered within timeoutMs, as
// { name, addresses }.
function search(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      try {
        const info = JSON.parse(msg.toString());
        if (info.app !== 'waresys' || !info.port) return;
        // A PC on several networks (Wi-Fi + cable, VPN, Docker) answers
        // once per adapter: one entry per PC, every address it answered on.
        const pc = found.get(info.name) || { name: info.name, addresses: [] };
        const address = `http://${rinfo.address}:${info.port}`;
        if (!pc.addresses.includes(address)) pc.addresses.push(address);
        found.set(info.name, pc);
      } catch {
        // Not ours.
      }
    });
    sock.on('error', () => {});
    sock.bind(() => {
      sock.setBroadcast(true);
      for (const addr of broadcastAddresses()) sock.send(QUERY, DISCOVERY_PORT, addr, () => {});
    });
    setTimeout(() => {
      sock.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// This PC's own office-network addresses, to show on the main PC.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

module.exports = { startResponder, stopResponder, search, lanAddresses, DISCOVERY_PORT };
