'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TargetController } = require('../lib/controller');

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

function makeController(opts = {}) {
  const calls = [];
  const hue = {
    isOn: opts.isOn ?? true,
    async v2(method, path, body) {
      calls.push({ method, path, body });
      return [{ on: { on: this.isOn } }];
    },
  };
  const controller = new TargetController({
    name: 'Bedroom',
    log: silentLog,
    hue,
    resolve: async () => '/resource/grouped_light/g1',
    minIntervalMs: 50,
    ...opts,
  });
  return { controller, calls, hue };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const puts = (calls) => calls.filter((c) => c.method === 'PUT').map((c) => c.body);

test('a burst of scroll steps becomes one bigger step', async () => {
  const { controller, calls } = makeController();
  controller.press('brighter');
  controller.press('brighter');
  controller.press('brighter');
  await settle();
  assert.deepStrictEqual(puts(calls), [
    { on: { on: true }, dimming_delta: { action: 'up', brightness_delta: 30 } },
  ]);
});

test('steps arriving while a command is in flight are sent next, not lost', async () => {
  const { controller, calls } = makeController();
  controller.press('dimmer');
  await settle(10);
  controller.press('dimmer');
  controller.press('dimmer');
  await settle(200);
  assert.deepStrictEqual(puts(calls), [
    { dimming_delta: { action: 'down', brightness_delta: 10 } },
    { dimming_delta: { action: 'down', brightness_delta: 20 } },
  ]);
});

test('opposite steps cancel out', async () => {
  const { controller, calls } = makeController();
  controller.press('brighter');
  controller.press('dimmer');
  await settle();
  assert.deepStrictEqual(calls, []);
});

test('brightness change is capped at 100%', async () => {
  const { controller, calls } = makeController({ step: 40 });
  for (let i = 0; i < 5; i++) controller.press('dimmer');
  await settle();
  assert.deepStrictEqual(puts(calls), [{ dimming_delta: { action: 'down', brightness_delta: 100 } }]);
});

test('toggle turns lights off when on, and on when off', async () => {
  const on = makeController({ isOn: true });
  on.controller.press('toggle');
  await settle();
  assert.deepStrictEqual(puts(on.calls), [{ on: { on: false } }]);

  const off = makeController({ isOn: false });
  off.controller.press('toggle');
  await settle();
  assert.deepStrictEqual(puts(off.calls), [{ on: { on: true } }]);
});

test('warmer and cooler change colour temperature', async () => {
  const { controller, calls } = makeController();
  controller.press('warmer');
  controller.press('warmer');
  await settle();
  controller.press('cooler');
  await settle();
  assert.deepStrictEqual(puts(calls), [
    { color_temperature_delta: { action: 'up', mirek_delta: 100 } },
    { color_temperature_delta: { action: 'down', mirek_delta: 50 } },
  ]);
});

test('colour controls step through the palette in both directions', async () => {
  const palette = [{ xy: [0.1, 0.1] }, { xy: [0.2, 0.2] }, { xy: [0.3, 0.3] }];
  const { controller, calls } = makeController({ palette });
  controller.press('previous_colour');
  await settle();
  controller.press('next_colour');
  controller.press('next_colour');
  await settle();
  assert.deepStrictEqual(puts(calls).map((b) => b.color.xy), [{ x: 0.3, y: 0.3 }, { x: 0.2, y: 0.2 }]);
});

test('a failed lookup is retried on the next press', async () => {
  let attempts = 0;
  const errors = [];
  const { controller, calls } = makeController({
    log: { ...silentLog, error: (m) => errors.push(m) },
    resolve: async () => {
      attempts++;
      if (attempts === 1) throw new Error('bridge offline');
      return '/resource/grouped_light/g1';
    },
  });
  controller.press('brighter');
  await settle();
  assert.deepStrictEqual(errors, ['Bedroom: bridge offline']);
  controller.press('brighter');
  await settle();
  assert.strictEqual(puts(calls).length, 1);
});
