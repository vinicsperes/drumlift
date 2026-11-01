# The 3D stage

A drummer playing the tab in sync with the song, to show which limb hits what, and when.

The module has no build step and no CDN (`drumlift/player/vendor/` holds Three.js, so the
player works offline). It plays no audio and owns no clock: each frame it calls `getTime()`
and computes the whole pose from that time, so seek, loop and speed just work.

```js
import { mountKit3D } from "./kit3d/kit3d.js";

const view = mountKit3D(container, { song, getTime: () => seconds });
view.setSong(song);      // after a tab edit
view.setCamera(name);    // "front" | "drummer" | "side" | "top"
view.setMuted(pieces);   // Set of muted pieces
view.dispose();
```

`kit3d-dev.html` runs it without audio: serve the repo root (`python -m http.server`) and open
`/drumlift/player/kit3d-dev.html`.

## Modules

| file | |
|---|---|
| `timeline.js` | clean notes, beat clock, toms spread over the kit, strokes per limb |
| `sticking.js` | which limb plays each note |
| `motion.js` | stroke timing as a pure function of time |
| `skeleton.js`, `ik.js` | human skeleton solved from a per-frame drive |
| `rig.js` | decides the drive: where sticks, torso, head and feet are |
| `perform.js`, `moves.js` | performance baked from a real capture, in a Worker |
| `mocap.js`, `layout.js`, `pieces.js` | the stage drawing and the kit's measures |

## Who plays what

Right-handed rules, written for common grooves. They are worked out, so they may differ from
what the original drummer did.

- The right foot plays the kick. The left foot stays on the hi-hat pedal and invents no notes.
- Same step: cymbal + snare or tom goes right hand on the cymbal; snare + tom goes left on the
  snare. With 3 or more hand notes, the 2 most important play (cymbal > snare > tom).
- Alone: cymbals go to the right hand, or the left if the right has under ~90 ms. The snare goes
  to the left hand and alternates R-L-R-L in fast runs (under ~180 ms, or a sixteenth at slow
  tempos). Toms alternate within a fill, starting with the free hand.
- A run of toms goes from high to low (tom 1, tom 2, floor). A lone tom goes to tom 2.

## Moving like a person

Three layers, baked once when the song opens:

1. **Real capture.** The [MMIP](https://mmip.cs.ucy.ac.cy) database has 14 performances captured
   with a sensor suit and in sync with MIDI. `tools/mmip_moves.py` distills it into a library of
   strokes and body motion. It stays out of the repo because of its non-commercial license; see
   `drumlift/player/kit3d/moves/README.md`.
2. **Matching.** Each stroke takes the most similar real one (same hand and pieces, similar
   interval and strength), described as a residual from the straight path between two strike
   poses, so it fits our kit. Segments that would cross a piece are rejected. The torso, head and
   clavicles come from a regression on the wrists plus real 8-beat groove clips.
3. **Exact contact.** The residual is zero at each end of a stroke, so the stick touches the piece
   exactly at the note. Without the library, a procedural model does the same job less naturally.

`lab.html` plays a real performance beside ours on the same clock and compares the same metrics.
