# homebridge-bilresa-hue

Use an **IKEA BILRESA scroll wheel** (E2490) to dim, recolour and switch
**Philips Hue** lights, one scroll click at a time.

## Why this exists

BILRESA is a Matter-over-Thread remote. The Hue Bridge only pairs Hue's own
Zigbee accessories, so it can't see the remote at all. Pretending to be a Hue
Tap Dial won't work either: the radios and protocols are different.

Apple Home *can* see BILRESA, and each scroll click arrives as a button press.
But a Home automation can only set a **fixed** brightness ("set to 40 %"). It
can't say "10 % brighter than now", and that is what a scroll wheel needs.

This plugin fills that gap. For each Hue room you choose, it adds switches to
Apple Home such as **Bedroom Brighter** and **Bedroom Dimmer**. An automation
turns one on, the plugin sends a relative step to the Hue Bridge, and the
switch flips back off, ready for the next click.

```
BILRESA click ──Thread──▶ Apple Home hub ──automation──▶ "Bedroom Brighter" switch
                                                               │ (Homebridge)
                                                               ▼
                                              Hue Bridge: brightness +10 %
```

## What you need

- A Homebridge server on your home network (Raspberry Pi, NAS, etc.).
- A Hue Bridge.
- An Apple home hub with Thread (HomePod mini, HomePod 2nd gen, or Apple
  TV 4K with Ethernet). It pairs the BILRESA and runs the automations.

## Setup

1. **Install the plugin.** Copy this folder onto your Homebridge machine,
   open the Homebridge UI terminal (⋮ menu → Terminal) and run:
   ```
   cd /path/to/homebridge-bilresa-hue
   sudo npm install -g .
   ```
   Restart Homebridge.

2. **Configure it.** In the Homebridge UI, open Plugins → BILRESA Scroll
   Wheel for Hue → Settings. Add a target for each room you want to control,
   using the room's name exactly as it appears in the Hue app. Or add this to
   `config.json`:
   ```json
   {
     "platform": "BilresaHue",
     "targets": [
       { "name": "Bedroom", "controls": ["brighter", "dimmer", "toggle"] },
       { "name": "Living Room", "controls": ["warmer", "cooler", "next_colour", "previous_colour"] }
     ]
   }
   ```

3. **Pair with the Hue Bridge.** Restart Homebridge and watch the log. When
   it says *"Press the round link button on your Hue Bridge"*, press it. The
   key is saved, so you only do this once.

4. **Add BILRESA to Apple Home.** In the Home app tap + → Add Accessory and
   scan the Matter code on the back of the remote.

5. **Create the automations.** Open the BILRESA in the Home app. Each of its
   three channels (the dots on the front) shows up as three buttons: clockwise
   scroll, anticlockwise scroll and press. For each one, choose
   *Single Press* and select a switch from this plugin. For example:

   | Channel | Button                   | Turn on                |
   |---------|--------------------------|------------------------|
   | 1       | clockwise scroll         | Bedroom Brighter       |
   | 1       | anticlockwise scroll     | Bedroom Dimmer         |
   | 1       | press                    | Bedroom On-Off         |
   | 2       | clockwise scroll         | Living Room Warmer     |
   | 2       | anticlockwise scroll     | Living Room Cooler     |
   | 3       | clockwise scroll         | Living Room Next Colour |
   | 3       | anticlockwise scroll     | Living Room Previous Colour |

   If the Home app doesn't list all nine buttons, use a third-party HomeKit
   app such as *Eve* or *Controller for HomeKit*. They show every button
   and save into the same Apple Home automations.

## Controls

| Control           | What one click does                                |
|-------------------|----------------------------------------------------|
| `brighter`        | +10 % brightness (turns the lights on if off)      |
| `dimmer`          | −10 % brightness (stops at the lowest level, never off) |
| `warmer`          | warmer white                                       |
| `cooler`          | cooler white                                       |
| `next_colour`     | next colour: red → orange → yellow → green → cyan → blue → purple → pink |
| `previous_colour` | previous colour                                    |
| `toggle`          | on ↔ off                                           |

Targets can be a Hue `room` (default), a `zone`, a single `light`, or `all`.

## Settings

| Setting          | Default   | Meaning                                       |
|------------------|-----------|-----------------------------------------------|
| `bridgeIp`       | automatic | The Hue Bridge's IP address, if discovery fails |
| `brightnessStep` | 10        | % per click                                   |
| `colourTempStep` | 50        | mirek per click (the full white range is about 350) |
| `minIntervalMs`  | 400       | Minimum gap between commands to the bridge    |

The Hue Bridge only accepts about one room command per second. When you
scroll fast, the plugin combines the clicks into one bigger step instead of
dropping them. Five quick clicks become one +50 % command.

## Known limits

- Each click goes Thread → Apple hub → Homebridge → Hue, so expect a little
  lag. It feels like stepping, not a smooth analogue dimmer.
- Some people report the BILRESA's Matter events are a bit unreliable when
  scrolling very fast. That happens before the events reach this plugin.

## Development

```
npm install
npm test
```

The tests run the plugin inside the real Homebridge API against a fake Hue
Bridge.
