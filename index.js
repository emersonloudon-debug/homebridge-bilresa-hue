'use strict';

const fs = require('fs');
const path = require('path');
const { HueClient } = require('./lib/hue');
const { TargetController, CONTROLS, SCENE_CONTROLS } = require('./lib/controller');

const PLUGIN_NAME = 'homebridge-bilresa-hue';
const PLATFORM_NAME = 'BilresaHue';
// One switch per thing the BILRESA's three channels do by default:
// channel 1 brightness, channel 2 colour, channel 3 scenes.
const DEFAULT_CONTROLS = [
  'brighter', 'dimmer', 'toggle',
  'next_colour', 'previous_colour', 'white',
  'next_scene', 'previous_scene',
];
const PAIR_TIMEOUT_MS = 120000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exposes one HomeKit accessory per Hue room/zone/light, holding a
// momentary switch for each control ("Living Room Brighter", ...). A Home
// automation on a BILRESA scroll step turns a switch on, the plugin sends
// the matching step to the Hue Bridge, and the switch flips back off.
class BilresaHuePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.cached = new Map();
    this.connection = null;

    api.on('didFinishLaunching', () => this.setupAccessories());
  }

  configureAccessory(accessory) {
    this.cached.set(accessory.UUID, accessory);
  }

  // Connects to the bridge once, on first use, and remembers the result.
  connect() {
    if (!this.connection) {
      this.connection = this.openConnection().catch((err) => {
        this.connection = null;
        throw err;
      });
    }
    return this.connection;
  }

  async openConnection() {
    const storeFile = path.join(this.api.user.storagePath(), 'bilresa-hue.json');
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    } catch (e) {
      // Nothing paired yet.
    }

    const host = this.config.bridgeIp || stored.host || await HueClient.discover();
    let appKey = this.config.appKey || (stored.host === host ? stored.appKey : undefined);

    if (!appKey) {
      appKey = await this.pair(host);
      fs.writeFileSync(storeFile, JSON.stringify({ host, appKey }, null, 2));
      this.log.info(`Paired with the Hue Bridge at ${host}. Key saved to ${storeFile}`);
    }
    return new HueClient({ host, appKey });
  }

  async pair(host) {
    const client = new HueClient({ host });
    this.log.warn(`Press the round link button on your Hue Bridge (${host}) within 2 minutes...`);
    const deadline = Date.now() + PAIR_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const key = await client.tryPair('homebridge-bilresa-hue#homebridge');
      if (key) return key;
      await sleep(2000);
    }
    throw new Error('Link button was not pressed in time. Restart Homebridge to try again.');
  }

  setupAccessories() {
    const { hap } = this.api;
    const targets = Array.isArray(this.config.targets) ? this.config.targets : [];
    const used = new Set();

    if (!targets.length) {
      this.log.warn('No targets configured. Add a Hue room, zone or light under "targets".');
    }

    for (const target of targets) {
      const type = target.type || 'room';
      const name = type === 'all' ? (target.name || 'All Lights') : target.name;
      if (!name) {
        this.log.error('Skipping a target with no name');
        continue;
      }
      const hasScenes = type === 'room' || type === 'zone';
      const custom = target.controls && target.controls.length;
      const controls = (custom ? target.controls : DEFAULT_CONTROLS)
        .filter((c) => {
          if (!CONTROLS[c]) {
            this.log.error(`${name}: ignoring unknown control "${c}"`);
            return false;
          }
          if (SCENE_CONTROLS.includes(c) && !hasScenes) {
            if (custom) this.log.error(`${name}: scene controls need a room or zone, skipping "${c}"`);
            return false;
          }
          return true;
        });

      const uuid = hap.uuid.generate(`${PLUGIN_NAME}:${type}:${name.toLowerCase()}`);
      used.add(uuid);

      let accessory = this.cached.get(uuid);
      const isNew = !accessory;
      if (isNew) accessory = new this.api.platformAccessory(name, uuid);

      const controller = new TargetController({
        name,
        log: this.log,
        step: this.config.brightnessStep,
        mirekStep: this.config.colourTempStep,
        minIntervalMs: this.config.minIntervalMs,
        hue: {
          v2: async (...args) => (await this.connect()).v2(...args),
          scenesFor: async (groupId) => (await this.connect()).scenesFor(groupId),
        },
        resolve: async () => (await this.connect()).resolveTarget(type, name),
      });

      this.configure(accessory, controller, name, controls);

      if (isNew) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      } else {
        this.api.updatePlatformAccessories([accessory]);
      }
    }

    const stale = [...this.cached.values()].filter((a) => !used.has(a.UUID));
    if (stale.length) this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);

    // Connect now so pairing and name mistakes show up in the log right away.
    if (targets.length) {
      this.connect().catch((err) => this.log.error(`Can't reach the Hue Bridge: ${err.message}`));
    }
  }

  configure(accessory, controller, name, controls) {
    const { Service, Characteristic } = this.api.hap;

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'homebridge-bilresa-hue')
      .setCharacteristic(Characteristic.Model, 'Hue Step Controls')
      .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.slice(0, 8));

    for (const service of accessory.services.filter((s) => s.UUID === Service.Switch.UUID)) {
      if (!controls.includes(service.subtype)) accessory.removeService(service);
    }

    for (const control of controls) {
      const label = `${name} ${CONTROLS[control]}`;
      const service = accessory.getServiceById(Service.Switch, control)
        || accessory.addService(Service.Switch, label, control);
      service.setCharacteristic(Characteristic.Name, label);
      if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
        service.addOptionalCharacteristic(Characteristic.ConfiguredName);
        service.setCharacteristic(Characteristic.ConfiguredName, label);
      }

      service.getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value) => {
          if (!value) return;
          controller.press(control);
          // Momentary: flip back off so the next press is a fresh "on".
          setTimeout(() => service.updateCharacteristic(Characteristic.On, false), 300);
        });
    }
  }
}

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, BilresaHuePlatform);
};
module.exports.BilresaHuePlatform = BilresaHuePlatform;
