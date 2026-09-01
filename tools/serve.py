#!/usr/bin/env python3
"""
Serve src/ over HTTP so Scriptum can be run in a plain browser, without
Electron. Useful for development and for trying the app on a machine where
you would rather not install anything.

    python3 tools/serve.py [port]     # then open http://localhost:8123

Responses are sent with no-store so that an edited module is picked up on the
next reload instead of being served from the browser's cache.
"""

import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quiet by default; errors still surface through the exception path.
        if not args or not str(args[0]).startswith("GET"):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"Scriptum running at http://localhost:{port}  (Ctrl-C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
