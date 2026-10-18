'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HomebridgeAPI } = require('homebridge/lib/api');
const { User } = require('homebridge/lib/user');
const plugin = require('..');
const { HueClient } = require('../lib/hue');
const { startFakeBridge } = require('./fake-bridge');

const log = Object.assign(() => {}, { debug() {}, info() {}, warn() {}, error() {} });
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

function boot(config, bridge, cached = []) {
  User.setStoragePath(fs.mkdtempSync(path.join(os.tmpdir(), 'bilresa-')));
  const api = new HomebridgeAPI();
  let Platform;
  api.on('registerPlatform', (name, ctor) => { Platform = ctor; });
  plugin(api);
  const registered = [];
  const unregistered = [];
  api.on('registerPlatformAccessories', (a) => registered.push(...a));
  api.on('unregisterPlatformAccessories', (a) => unregistered.push(...a));

  const platform = new Platform(log, { platform: 'BilresaHue', ...config }, api);
  cached.forEach((a) => platform.configureAccessory(a));
  platform.connection = Promise.resolve(new HueClient({ host: bridge.host, appKey: 'test-key', protocol: 'http' }));
  api.signalFinished();
  return { api, platform, registered, unregistered };
}

function switchFor(accessory, api, subtype) {
  return accessory.getServiceById(api.hap.Service.Switch, subtype);
}

test('creates momentary switches that drive the Hue Bridge', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const { api, registered } = boot({
    targets: [
      { name: 'Bedroom' },
      { name: 'Everything', type: 'all', controls: ['toggle', 'next_colour'] },
    ],
  }, bridge);

  assert.deepStrictEqual(registered.map((a) => a.displayName), ['Bedroom', 'Everything']);
  const [bedroom, everything] = registered;
  const { Characteristic } = api.hap;

  const names = bedroom.services
    .filter((s) => s.UUID === api.hap.Service.Switch.UUID)
    .map((s) => s.getCharacteristic(Characteristic.ConfiguredName).value);
  assert.deepStrictEqual(names, ['Bedroom Brighter', 'Bedroom Dimmer', 'Bedroom On-Off']);

  const brighter = switchFor(bedroom, api, 'brighter').getCharacteristic(Characteristic.On);
  await brighter.handleSetRequest(true);
  await brighter.handleSetRequest(true);
  await switchFor(everything, api, 'toggle').getCharacteristic(Characteristic.On).handleSetRequest(true);
  await settle();

  const puts = bridge.state.requests.filter((r) => r.method === 'PUT');
  assert.deepStrictEqual(puts.map((r) => [r.url, r.body]), [
    ['/clip/v2/resource/grouped_light/g-bedroom', { on: { on: true }, dimming_delta: { action: 'up', brightness_delta: 20 } }],
    ['/clip/v2/resource/grouped_light/g-home', { on: { on: false } }],
  ]);
  assert.strictEqual(brighter.value, false, 'switch flips back off');
});

test('cleans up accessories and switches that were removed from the config', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const first = boot({ targets: [{ name: 'Bedroom', controls: ['brighter', 'warmer'] }, { name: 'Desk', type: 'zone' }] }, bridge);
  const second = boot({ targets: [{ name: 'Bedroom', controls: ['brighter'] }] }, bridge, first.registered);

  assert.deepStrictEqual(second.registered, []);
  assert.deepStrictEqual(second.unregistered.map((a) => a.displayName), ['Desk']);
  const bedroom = first.registered[0];
  assert.ok(switchFor(bedroom, second.api, 'brighter'));
  assert.strictEqual(switchFor(bedroom, second.api, 'warmer'), undefined);
});
