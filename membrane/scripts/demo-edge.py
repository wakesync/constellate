#!/usr/bin/env python3
"""Optional synthetic demo edge. No keys, no free-form model prompts.

Run before a public tunnel: python3 scripts/demo-edge.py. Point the tunnel to
127.0.0.1:18096, never directly at the unrestricted app. In-memory budget resets
on explicit process restart. One upstream request at a time; 30 total route
requests per process. Existing app authentication is not modified.
"""
import http.client
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_PORT = int(os.environ.get('DEMO_UPSTREAM_PORT', '18095'))
PORT = int(os.environ.get('DEMO_EDGE_PORT', '18096'))
BUDGET = int(os.environ.get('DEMO_REQUEST_BUDGET', '30'))
# Fixed synthetic questions only. Coordinate these exact presets with the UI.
PRESETS = {
    'What did I agree to in that private conversation?',
    'Help me write a project proposal.',
    'Pay this invoice.',
}
lock = threading.Lock()
slots = threading.BoundedSemaphore(1)
used = 0

class Edge(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never persist query strings or request bodies.

    def error(self, code, message):
        data = json.dumps({'detail': message}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path not in ('/', '/router', '/router.html', '/healthz'):
            return self.error(404, 'Not exposed on synthetic demo edge')
        self.proxy('GET', None)

    def do_POST(self):
        global used
        if self.path != '/route':
            return self.error(404, 'Not exposed on synthetic demo edge')
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2048 or self.headers.get('Transfer-Encoding'):
                return self.error(413, 'Bounded JSON body required')
            self.connection.settimeout(5)
            obj = json.loads(self.rfile.read(size))
            if not isinstance(obj, dict) or obj.get('user') != 'juno' or obj.get('query') not in PRESETS or set(obj) != {'user', 'query'}:
                return self.error(403, 'Only the three fixed synthetic demo presets are enabled')
        except (ValueError, TimeoutError):
            return self.error(400, 'Invalid JSON body')
        if not slots.acquire(blocking=False):
            return self.error(429, 'A demo request is already running')
        try:
            with lock:
                if used >= BUDGET:
                    return self.error(429, 'Synthetic demo request budget exhausted')
                used += 1
            self.proxy('POST', json.dumps(obj).encode())
        finally:
            slots.release()

    def proxy(self, method, body):
        conn = http.client.HTTPConnection('127.0.0.1', UPSTREAM_PORT, timeout=150)
        try:
            conn.request(method, '/router.html' if self.path == '/' else self.path,
                         body=body, headers={'Content-Type': 'application/json'})
            response = conn.getresponse()
            data = response.read(2_000_000)
            self.send_response(response.status)
            self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Demo-Boundary', 'non-attested-local-router; synthetic-only')
            self.end_headers()
            self.wfile.write(data)
        except (OSError, http.client.HTTPException):
            self.error(502, 'Demo upstream unavailable; no fallback attempted')
        finally:
            conn.close()

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), Edge).serve_forever()
