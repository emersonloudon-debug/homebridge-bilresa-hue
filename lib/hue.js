'use strict';

const http = require('http');
const https = require('https');

// The Hue Bridge serves HTTPS with a certificate signed by Signify's own CA,
// which Node doesn't trust. This agent is only ever pointed at the bridge's
// LAN address.
const bridgeAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

class HueError extends Error {}

function request(url, { method = 'GET', headers = {}, body, agent } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = lib.request(u, {
      method,
      agent: u.protocol === 'http:' ? undefined : agent,
      timeout: 5000,
      headers: {
        ...headers,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new HueError('Hue Bridge rate limit hit (429), try a larger minIntervalMs'));
          return;
        }
        let json;
        try {
          json = data ? JSON.parse(data) : {};
        } catch (e) {
          reject(new HueError(`Unexpected response from ${u.host} (HTTP ${res.statusCode})`));
          return;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new HueError(`Timed out talking to ${u.host}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class HueClient {
  constructor({ host, appKey, protocol = 'https' }) {
    this.base = `${protocol}://${host}`;
    this.appKey = appKey;
  }

  // Calls the CLIP v2 API and returns its `data` array.
  async v2(method, path, body) {
    const { status, json } = await request(`${this.base}/clip/v2${path}`, {
      method,
      body,
      agent: bridgeAgent,
      headers: { 'hue-application-key': this.appKey },
    });
    if (json.errors && json.errors.length) {
      throw new HueError(json.errors.map((e) => e.description).join('; '));
    }
    if (status >= 400) throw new HueError(`Hue Bridge returned HTTP ${status} for ${path}`);
    return json.data || [];
  }

  // Finds the Hue resource a target controls, by its name in the Hue app.
  // Returns the CLIP v2 path to send commands to, and for rooms and zones
  // the group id its scenes belong to.
  async resolveTarget(type, name) {
    if (type === 'all') {
      const homes = await this.v2('GET', '/resource/bridge_home');
      const grouped = homes[0] && homes[0].services.find((s) => s.rtype === 'grouped_light');
      if (!grouped) throw new HueError('The bridge has no "all lights" group');
      return { path: `/resource/grouped_light/${grouped.rid}`, groupId: null };
    }

    const items = await this.v2('GET', `/resource/${type}`);
    const wanted = name.trim().toLowerCase();
    const match = items.find((i) => i.metadata && i.metadata.name.trim().toLowerCase() === wanted);
    if (!match) {
      const names = items.map((i) => i.metadata && i.metadata.name).filter(Boolean);
      throw new HueError(`No ${type} called "${name}" on the bridge. Found: ${names.join(', ') || 'none'}`);
    }
    if (type === 'light') return { path: `/resource/light/${match.id}`, groupId: null };

    const grouped = match.services.find((s) => s.rtype === 'grouped_light');
    if (!grouped) throw new HueError(`The ${type} "${name}" has no lights in it`);
    return { path: `/resource/grouped_light/${grouped.rid}`, groupId: match.id };
  }

  // The scenes saved for a room or zone, sorted by name so scrolling through
  // them always goes in the same order as the Hue app's alphabetical list.
  async scenesFor(groupId) {
    const scenes = await this.v2('GET', '/resource/scene');
    return scenes
      .filter((s) => s.group && s.group.rid === groupId)
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }

  // One attempt at creating an app key. Returns the key once the bridge's
  // link button has been pressed, or null while it hasn't.
  async tryPair(deviceType) {
    const { json } = await request(`${this.base}/api`, {
      method: 'POST',
      agent: bridgeAgent,
      body: { devicetype: deviceType, generateclientkey: true },
    });
    const result = Array.isArray(json) ? json[0] : undefined;
    if (result && result.success) return result.success.username;
    if (result && result.error && result.error.type === 101) return null;
    throw new HueError(`Pairing failed: ${JSON.stringify(json)}`);
  }

  static async discover() {
    const { json } = await request('https://discovery.meethue.com/');
    if (!Array.isArray(json) || !json.length) {
      throw new HueError('No Hue Bridge found via discovery.meethue.com; set bridgeIp in the config');
    }
    return json[0].internalipaddress;
  }
}

module.exports = { HueClient, HueError };
