'use strict';

// Colours the "next colour" / "previous colour" controls step through, as
// CIE xy. The bridge maps each one to the closest colour the bulb can show.
const DEFAULT_PALETTE = [
  { name: 'red', xy: [0.6915, 0.3083] },
  { name: 'orange', xy: [0.5916, 0.3824] },
  { name: 'yellow', xy: [0.4432, 0.5154] },
  { name: 'green', xy: [0.1700, 0.7000] },
  { name: 'cyan', xy: [0.1607, 0.3423] },
  { name: 'blue', xy: [0.1532, 0.0475] },
  { name: 'purple', xy: [0.2725, 0.1096] },
  { name: 'pink', xy: [0.4149, 0.1776] },
];

const CONTROLS = {
  brighter: 'Brighter',
  dimmer: 'Dimmer',
  warmer: 'Warmer',
  cooler: 'Cooler',
  next_colour: 'Next Colour',
  previous_colour: 'Previous Colour',
  toggle: 'On-Off',
};

// Turns button presses for one Hue room, zone or light into bridge commands.
//
// A scroll wheel sends a burst of presses, but the bridge only accepts about
// one group command per second. Presses that arrive while a command is
// waiting are added together and sent as a single bigger step.
class TargetController {
  constructor({ resolve, hue, log, name, step = 10, mirekStep = 50, minIntervalMs = 400, palette = DEFAULT_PALETTE }) {
    this.resolve = resolve;
    this.hue = hue;
    this.log = log;
    this.name = name;
    this.step = step;
    this.mirekStep = mirekStep;
    this.minIntervalMs = minIntervalMs;
    this.palette = palette;

    this.path = null;
    this.colourIndex = -1;
    this.lastSent = 0;
    this.timer = null;
    this.inFlight = false;
    this.resetPending();
  }

  resetPending() {
    this.pending = { dim: 0, mirek: 0, colour: false, toggle: false };
  }

  hasPending() {
    const p = this.pending;
    return p.dim !== 0 || p.mirek !== 0 || p.colour || p.toggle;
  }

  press(control) {
    const p = this.pending;
    switch (control) {
      case 'brighter': p.dim += this.step; break;
      case 'dimmer': p.dim -= this.step; break;
      // Higher mirek is a warmer white.
      case 'warmer': p.mirek += this.mirekStep; break;
      case 'cooler': p.mirek -= this.mirekStep; break;
      case 'next_colour':
      case 'previous_colour': {
        const n = this.palette.length;
        const delta = control === 'next_colour' ? 1 : -1;
        this.colourIndex = this.colourIndex < 0 && delta < 0 ? n - 1 : (this.colourIndex + delta + n) % n;
        p.colour = true;
        break;
      }
      case 'toggle': p.toggle = !p.toggle; break;
      default: throw new Error(`Unknown control "${control}"`);
    }
    this.schedule();
  }

  schedule() {
    if (this.timer || this.inFlight || !this.hasPending()) return;
    const wait = Math.max(0, this.lastSent + this.minIntervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  async flush() {
    const p = this.pending;
    this.resetPending();
    this.inFlight = true;
    try {
      if (!this.path) this.path = await this.resolve();
      const body = await this.buildBody(p);
      if (body) {
        this.log.debug(`${this.name}: PUT ${this.path} ${JSON.stringify(body)}`);
        await this.hue.v2('PUT', this.path, body);
      }
    } catch (err) {
      this.log.error(`${this.name}: ${err.message}`);
    } finally {
      this.inFlight = false;
      this.lastSent = Date.now();
      this.schedule();
    }
  }

  async buildBody(p) {
    const body = {};

    if (p.toggle) {
      const [state] = await this.hue.v2('GET', this.path);
      const isOn = Boolean(state && state.on && state.on.on);
      if (isOn) return { on: { on: false } };
      body.on = { on: true };
    }

    if (p.dim !== 0) {
      body.dimming_delta = {
        action: p.dim > 0 ? 'up' : 'down',
        brightness_delta: Math.min(Math.abs(p.dim), 100),
      };
      // Scrolling up on lights that are off turns them on.
      if (p.dim > 0) body.on = { on: true };
    }

    if (p.colour) {
      const [x, y] = this.palette[this.colourIndex].xy;
      body.color = { xy: { x, y } };
      body.on = { on: true };
    } else if (p.mirek !== 0) {
      body.color_temperature_delta = {
        action: p.mirek > 0 ? 'up' : 'down',
        mirek_delta: Math.min(Math.abs(p.mirek), 347),
      };
    }

    return Object.keys(body).length ? body : null;
  }
}

module.exports = { TargetController, CONTROLS, DEFAULT_PALETTE };
