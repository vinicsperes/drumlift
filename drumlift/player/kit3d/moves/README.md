# Strokes from a real drummer

The player's drummer can use strokes from a real capture, stored in `mmip.json` in this
folder. The file isn't in the repo: it derives from the **MMIP** database (Multi-Modal
Instrument Performances), University of Cyprus and CYENS Centre of Excellence
(https://mmip.cs.ucy.ac.cy), licensed **CC BY-NC-SA 4.0** (non-commercial, with credit,
derivatives under the same license). Without it, the drummer uses the procedural model.

The file holds each hand's motion between two consecutive notes (about 15,000 strokes from
14 performances), relative to the straight path between the two strike poses, compressed
with PCA. To build it:

```sh
uv run python tools/mmip.py fetch 1 2 3 4 5 6 7 8 9 10 11 12 13 14
node tools/mmip_bones.mjs songs/mmip/*/
uv run python tools/mmip_moves.py
```

The generated `mmip.json` follows the MMIP license and stays out of git.
