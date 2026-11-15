# Fly Hunt (browser demo)

Play: https://goddrivenbullet.github.io/fly-hunt-web/

A pseudo-AR (3DOF) browser demo for the Househeat game. On an iPhone, the rear camera is the background and you turn the phone to hunt a buzzing cartoon fly with detailed toy blasters. On desktop, you play with mouse look in a virtual room.

- **Blasters:** Zapper (iron sights), Buzzer (rapid fire, red dot), Splatter (spread shot, red dot), Long Shot (scope at 3x/6x/10x, hold breath).
- **Feel:** ADS (aim down sights), sway and breathing, walk bob, recoil, slide/bolt/pump animations, ejected foam darts, ammo and reloads, hit markers and splats. Lighting is matched to the camera feed.
- **Online multiplayer:** Create Room gives a 5-letter code and a `?room=CODE` link. Modes are Fly Race (shared host-run fly, first hit scores) and Duel (FFA with floating avatars and host-authoritative hits). Uses WebRTC via PeerJS's free public broker.
- **Testing:** `?net=local` swaps WebRTC for a same-browser BroadcastChannel so two tabs can test the protocol.

No build step. It's plain HTML, CSS, and JS (`main.js`, `net.js`), with three.js 0.170 and PeerJS 1.5.4 loaded from jsDelivr.
