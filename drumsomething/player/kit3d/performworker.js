// Worker que monta a performance (perform.js) fora da página.

import { prepareSong } from "./timeline.js";
import { loadMoves } from "./moves.js";
import { buildPlan, planBuffers } from "./perform.js";
import { createRig } from "./rig.js";

self.onmessage = async (e) => {
  const { id, song, url } = e.data;
  try {
    const lib = await loadMoves(url);
    const plan = buildPlan(prepareSong(song), lib, { rigFactory: createRig });
    self.postMessage({ id, plan }, planBuffers(plan));
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
