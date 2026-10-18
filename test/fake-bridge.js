'use strict';

const http = require('http');

// A tiny stand-in for a Hue Bridge's CLIP v2 API. Records every request.
function startFakeBridge() {
  const state = {
    requests: [],
    linkPressed: false,
    groupOn: { 'g-bedroom': false, 'g-home': true },
  };
  const data = {
    room: [{ id: 'r1', metadata: { name: 'Bedroom' }, services: [{ rid: 'g-bedroom', rtype: 'grouped_light' }] }],
    zone: [{ id: 'z1', metadata: { name: 'Desk' }, services: [{ rid: 'g-desk', rtype: 'grouped_light' }] }],
    light: [{ id: 'l1', metadata: { name: 'Lamp' } }],
    bridge_home: [{ id: 'h1', services: [{ rid: 'g-home', rtype: 'grouped_light' }] }],
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      state.requests.push({ method: req.method, url: req.url, body, key: req.headers['hue-application-key'] });
      const send = (json, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };

      if (req.url === '/api' && req.method === 'POST') {
        return send(state.linkPressed
          ? [{ success: { username: 'new-key', clientkey: 'x' } }]
          : [{ error: { type: 101, description: 'link button not pressed' } }]);
      }
      if (req.headers['hue-application-key'] !== 'test-key' && req.headers['hue-application-key'] !== 'new-key') {
        return send({ errors: [{ description: 'unauthorized user' }], data: [] }, 403);
      }
      const m = req.url.match(/^\/clip\/v2\/resource\/([a-z_]+)(?:\/(.+))?$/);
      if (!m) return send({ errors: [{ description: 'not found' }] }, 404);
      const [, type, id] = m;
      if (type === 'grouped_light' && id) {
        if (req.method === 'PUT' && body.on) state.groupOn[id] = body.on.on;
        return send({ errors: [], data: [{ id, on: { on: Boolean(state.groupOn[id]) } }] });
      }
      if (type === 'light' && id) return send({ errors: [], data: [{ id, on: { on: true } }] });
      return send({ errors: [], data: data[type] || [] });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ host: `127.0.0.1:${server.address().port}`, state, close: () => server.close() });
    });
  });
}

module.exports = { startFakeBridge };
