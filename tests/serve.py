#!/usr/bin/env python3
"""Tiny dev server for the browser test runner (Python stdlib only).

  python3 tests/serve.py [port] [--results-file PATH]

Serves the repo root on 127.0.0.1 and accepts POST /__results from
tests/test-runner.html?report=1 (used by tests/run-browser-tests.sh).
"""
import http.server, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = int(args[0]) if args else 8765
RESULTS = sys.argv[sys.argv.index('--results-file') + 1] if '--results-file' in sys.argv else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # always test the latest code
        super().end_headers()

    def do_POST(self):
        if self.path != '/__results':
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        data = json.loads(body)
        if RESULTS:
            with open(RESULTS, 'w') as f:
                json.dump(data, f, indent=2)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'Serving {ROOT} at http://127.0.0.1:{PORT}/tests/test-runner.html')
    http.server.ThreadingHTTPServer.request_queue_size = 128  # browsers open many parallel connections
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
