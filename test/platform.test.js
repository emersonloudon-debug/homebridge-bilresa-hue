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

const byName = (accessories, name) => accessories.find((a) => a.displayName === name);
const onOf = (api, accessory) => accessory.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On);

test('creates a named momentary switch accessory per control that drives the Hue Bridge', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const { api, registered } = boot({
    targets: [
      { name: 'Bedroom' },
      { name: 'Everything', type: 'all', controls: ['toggle', 'next_colour'] },
    ],
  }, bridge);

  assert.deepStrictEqual(registered.map((a) => a.displayName), [
    'Bedroom Brighter', 'Bedroom Dimmer', 'Bedroom On-Off',
    'Bedroom Next Colour', 'Bedroom Previous Colour', 'Bedroom White',
    'Bedroom Next Scene', 'Bedroom Previous Scene',
    'Everything On-Off', 'Everything Next Colour',
  ]);
  const dimmer = byName(registered, 'Bedroom Dimmer');
  assert.strictEqual(dimmer.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.Name).value, 'Bedroom Dimmer');
  assert.strictEqual(dimmer.services.filter((s) => s.UUID === api.hap.Service.Switch.UUID).length, 1);

  const brighter = onOf(api, byName(registered, 'Bedroom Brighter'));
  await brighter.handleSetRequest(true);
  await brighter.handleSetRequest(true);
  await onOf(api, byName(registered, 'Everything On-Off')).handleSetRequest(true);
  await settle();
  // Relax is showing, so the next scene alphabetically wraps round to Bright.
  await onOf(api, byName(registered, 'Bedroom Next Scene')).handleSetRequest(true);
  await settle();

  const puts = bridge.state.requests.filter((r) => r.method === 'PUT');
  assert.deepStrictEqual(puts.map((r) => [r.url, r.body]), [
    ['/clip/v2/resource/grouped_light/g-bedroom', { on: { on: true }, dimming_delta: { action: 'up', brightness_delta: 20 } }],
    ['/clip/v2/resource/grouped_light/g-home', { on: { on: false } }],
    ['/clip/v2/resource/scene/s-bright', { recall: { action: 'active' } }],
  ]);
  assert.strictEqual(brighter.value, false, 'switch flips back off');
});

test('lights and "all lights" get no scene switches by default', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const { registered } = boot({ targets: [{ name: 'Lamp', type: 'light' }] }, bridge);
  assert.deepStrictEqual(registered.map((a) => a.displayName), [
    'Lamp Brighter', 'Lamp Dimmer', 'Lamp On-Off', 'Lamp Next Colour', 'Lamp Previous Colour', 'Lamp White',
  ]);
});

test('keeps cached switches and removes ones dropped from the config', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const first = boot({ targets: [{ name: 'Bedroom', controls: ['brighter', 'warmer'] }, { name: 'Desk', type: 'zone', controls: ['dimmer'] }] }, bridge);
  const second = boot({ targets: [{ name: 'Bedroom', controls: ['brighter'] }] }, bridge, first.registered);

  assert.deepStrictEqual(second.registered, []);
  assert.deepStrictEqual(second.unregistered.map((a) => a.displayName).sort(), ['Bedroom Warmer', 'Desk Dimmer']);
});
