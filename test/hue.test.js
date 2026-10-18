'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HueClient } = require('../lib/hue');
const { startFakeBridge } = require('./fake-bridge');

test('resolves rooms, zones, lights and all lights by name', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const hue = new HueClient({ host: bridge.host, appKey: 'test-key', protocol: 'http' });

  assert.strictEqual(await hue.resolveTarget('room', ' bedroom '), '/resource/grouped_light/g-bedroom');
  assert.strictEqual(await hue.resolveTarget('zone', 'Desk'), '/resource/grouped_light/g-desk');
  assert.strictEqual(await hue.resolveTarget('light', 'Lamp'), '/resource/light/l1');
  assert.strictEqual(await hue.resolveTarget('all'), '/resource/grouped_light/g-home');
  await assert.rejects(hue.resolveTarget('room', 'Kitchen'), /No room called "Kitchen".*Found: Bedroom/);
});

test('reports bridge errors', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const hue = new HueClient({ host: bridge.host, appKey: 'wrong', protocol: 'http' });
  await assert.rejects(hue.v2('GET', '/resource/room'), /unauthorized user/);
});

test('pairing waits for the link button', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const hue = new HueClient({ host: bridge.host, protocol: 'http' });
  assert.strictEqual(await hue.tryPair('test#x'), null);
  bridge.state.linkPressed = true;
  assert.strictEqual(await hue.tryPair('test#x'), 'new-key');
  assert.deepStrictEqual(bridge.state.requests[0].body, { devicetype: 'test#x', generateclientkey: true });
});
