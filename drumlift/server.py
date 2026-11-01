"""Local player server. Serves the song folder and receives tab edits."""

import json
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import pipeline
from .pieces import BY_KEY


class Handler(SimpleHTTPRequestHandler):
    lock = threading.Lock()

    def log_message(self, fmt, *args):  # silence the per-file log
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path != "/api/save":
            self.send_error(404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            outdir = Path(self.directory)
            with self.lock:
                grid, _, meta = pipeline.load(outdir)
                limit = grid.n_bars * grid.steps_per_bar
                notes = {}
                for n in body["notes"]:
                    piece, step = str(n["piece"]), int(n["step"])
                    if piece not in BY_KEY or not 0 <= step < limit:
                        continue
                    notes[(piece, step)] = {
                        "piece": piece, "step": step,
                        "vel": float(min(1.0, max(0.0, n.get("vel", 0.8)))),
                        "conf": float(n.get("conf", 1.0)),
                        "ghost": bool(n.get("ghost", False)),
                        **({"t_raw": n["t_raw"]} if "t_raw" in n else {}),
                    }
                ordered = sorted(notes.values(), key=lambda n: (n["step"], n["piece"]))
                pipeline.save(outdir, grid, ordered, meta)
            data = (outdir / "song.json").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # hand the error to the player to show
            self.send_error(400, str(e))


def serve(outdir: Path, port: int = 8765, open_browser: bool = True) -> None:
    if not (outdir / "song.json").exists():
        raise SystemExit(f"{outdir} has no song.json. Run `drumlift run` first.")
    handler = partial(Handler, directory=str(outdir))
    for p in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", p), handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit("No free port.")
    url = f"http://127.0.0.1:{httpd.server_port}/"
    print(f"Player at {url}  (Ctrl+C to quit)", flush=True)
    if open_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
