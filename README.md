# Fly Hunt (browser demo)

Play: https://goddrivenbullet.github.io/fly-hunt-web/

A pseudo-AR (3DOF) browser demo for the Househeat game. On an iPhone, the rear camera is the background and you turn the phone to hunt a buzzing cartoon fly with detailed toy blasters. Walk with the on-screen stick (or WASD on a computer), or turn on 👣 Walk and take real steps; the live camera picture stays still because iPhone Safari cannot track your position. On desktop, you play with mouse look in a virtual room.

- **Blasters:** Zapper (iron sights), Buzzer (rapid fire, red dot), Splatter (spread shot, red dot), Long Shot (scope at 3x/6x/10x, hold breath).
- **Feel:** ADS (aim down sights), sway and breathing, walk bob, recoil, slide/bolt/pump animations, ejected foam darts, ammo and reloads, hit markers and splats. Lighting is matched to the camera feed.
- **Moving:** A virtual joystick sits on the bottom left. Walking is relative to the way you are facing (turning only). Optional walk-to-move uses the phone's step motion; it defaults on if motion permission is granted. Players stay inside the virtual room. In a Duel, your avatar is sent to friends at your real position.
- **Online multiplayer:** Create Room gives a 5-letter code and a `?room=CODE` link. Modes are Fly Race (shared host-run fly, first hit scores) and Duel (FFA with floating avatars and host-authoritative hits). Uses WebRTC via PeerJS's free public broker.
- **Testing:** `?net=local` swaps WebRTC for a same-browser BroadcastChannel so two tabs can test the protocol.

No build step. It's plain HTML, CSS, and JS (`main.js`, `net.js`), with three.js 0.170 and PeerJS 1.5.4 loaded from jsDelivr.
