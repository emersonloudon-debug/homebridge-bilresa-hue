# homebridge-bilresa-hue

Use an **IKEA BILRESA scroll wheel** (E2490) to control **Philips Hue**
lights. Each of the remote's three channels does a different job:

| Channel (LED) | Scroll forward | Scroll back     | Click  |
|---------------|----------------|-----------------|--------|
| 1             | brighter       | dimmer          | on/off |
| 2             | next colour    | previous colour | white  |
| 3             | next scene     | previous scene  | on/off |

Double-click is left free for anything you like.

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
   using the room's name exactly as it appears in the Hue app. Leave
   "Switches to create" empty to get every switch the table above needs. Or
   add this to `config.json`:
   ```json
   {
     "platform": "BilresaHue",
     "targets": [
       { "name": "Bedroom" }
     ]
   }
   ```
   That creates eight switches: *Bedroom Brighter*, *Dimmer*, *On-Off*,
   *Next Colour*, *Previous Colour*, *White*, *Next Scene* and *Previous Scene*.

3. **Pair with the Hue Bridge.** Restart Homebridge and watch the log. When
   it says *"Press the round link button on your Hue Bridge"*, press it. The
   key is saved, so you only do this once.

4. **Add BILRESA to Apple Home.** In the Home app tap + → Add Accessory and
   scan the Matter code on the back of the remote.

5. **Create the automations.** Open the BILRESA in the Home app. Each of its
   three channels shows up as three buttons, in this order: clockwise
   scroll, anticlockwise scroll, then click. For each one, choose
   *Single Press* and turn on a switch from this plugin:

   | Button | Channel | Action               | Turn on                |
   |--------|---------|----------------------|------------------------|
   | 1      | 1       | scroll forward       | Bedroom Brighter       |
   | 2      | 1       | scroll back          | Bedroom Dimmer         |
   | 3      | 1       | click                | Bedroom On-Off         |
   | 4      | 2       | scroll forward       | Bedroom Next Colour    |
   | 5      | 2       | scroll back          | Bedroom Previous Colour |
   | 6      | 2       | click                | Bedroom White          |
   | 7      | 3       | scroll forward       | Bedroom Next Scene     |
   | 8      | 3       | scroll back          | Bedroom Previous Scene |
   | 9      | 3       | click                | Bedroom On-Off         |

   Scroll buttons may also report a *Double Press* when you scroll quickly.
   If fast scrolling seems to skip steps, set Double Press on buttons 1, 2,
   4, 5, 7 and 8 to the same switch as their Single Press.

   Click buttons (3, 6, 9) also have *Double Press* and *Long Press*. These
   are free: point them at any Apple Home scene or accessory.

   If the Home app doesn't list all nine buttons, use a third-party HomeKit
   app such as *Eve* or *Controller for HomeKit*. They show every button
   and save into the same Apple Home automations.

## Controls

| Control           | What one click does                                |
|-------------------|----------------------------------------------------|
| `brighter`        | +10 % brightness (turns the lights on if off)      |
| `dimmer`          | −10 % brightness (stops at the lowest level, never off) |
| `toggle`          | on ↔ off                                           |
| `next_colour`     | next colour: red → orange → yellow → green → cyan → blue → purple → pink |
| `previous_colour` | previous colour                                    |
| `white`           | back to warm white                                 |
| `next_scene`      | the room's next Hue scene, in alphabetical order   |
| `previous_scene`  | the room's previous Hue scene                      |
| `warmer`          | warmer white (not in the default set)              |
| `cooler`          | cooler white (not in the default set)              |

Scenes are the ones you've saved for that room or zone in the Hue app. The
plugin starts from whichever scene is showing now and wraps round at the
end of the list.

Targets can be a Hue `room` (default), a `zone`, a single `light`, or `all`.
Single lights and `all` have no scenes, so they get no scene switches.
To pick your own set of switches, list them in `controls`, e.g.
`"controls": ["brighter", "dimmer", "warmer", "cooler"]`.

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
