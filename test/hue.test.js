'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HueClient } = require('../lib/hue');
const { startFakeBridge } = require('./fake-bridge');

test('resolves rooms, zones, lights and all lights by name', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const hue = new HueClient({ host: bridge.host, appKey: 'test-key', protocol: 'http' });

  assert.deepStrictEqual(await hue.resolveTarget('room', ' bedroom '), { path: '/resource/grouped_light/g-bedroom', groupId: 'r1' });
  assert.deepStrictEqual(await hue.resolveTarget('zone', 'Desk'), { path: '/resource/grouped_light/g-desk', groupId: 'z1' });
  assert.deepStrictEqual(await hue.resolveTarget('light', 'Lamp'), { path: '/resource/light/l1', groupId: null });
  assert.deepStrictEqual(await hue.resolveTarget('all'), { path: '/resource/grouped_light/g-home', groupId: null });
  await assert.rejects(hue.resolveTarget('room', 'Kitchen'), /No room called "Kitchen".*Found: Bedroom/);
});

test('lists a room\'s scenes in alphabetical order', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const hue = new HueClient({ host: bridge.host, appKey: 'test-key', protocol: 'http' });
  assert.deepStrictEqual((await hue.scenesFor('r1')).map((s) => s.metadata.name), ['Bright', 'Read', 'Relax']);
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
