#!/usr/bin/env python3
"""Isolated, bounded synthetic demonstration of the REAL app authorization.
No connection to the deployed backend, no model, no user-provided identities/text.
Each request reconstructs a two-note fixture in a temporary SQLite database,
uses signed TestClient calls through app.main, and destroys it afterwards.
Only this HTTP handler is public, never the underlying FastAPI app.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update(SWARM_SECRET=secrets.token_hex(32), LLM_ENABLED='0', MEMORY_BACKEND='sqlite',
                  ROUTER_DEMO='0', ENCLAVE_URL='', STRIPE_KEY='', LLM_API_KEY='', FRONTIER_API_KEY='')
import numpy as np
from fastapi.testclient import TestClient
from app import main as m
# Deliberately identical deterministic vectors: both records would match. Only
# the actual backend's SQL authorization can exclude the personal record.
m.embed = lambda texts: np.array([[1., 0., 0.] for _ in texts], dtype=np.float32)
LOCK = threading.Lock()
COUNT = 0
BUDGET = 10000
DEMO_ORIGIN = os.environ.get('DEMO_ALLOWED_ORIGIN', 'http://127.0.0.1:8000')
DEADLINE = 'The Atlas project deadline is Friday at 17:00 UTC.'
PRIVATE = 'My private personal note: a surprise birthday dinner for my sister.'


def signed(user):
    ts = str(int(time.time()))
    sig = hmac.new(m.SWARM_SECRET.encode(), f'{user}.{ts}'.encode(), hashlib.sha256).hexdigest()
    return {'x-swarm-user': user, 'x-swarm-ts': ts, 'x-swarm-sig': sig}


def exercise(granted):
    with tempfile.TemporaryDirectory(prefix='membrane-synthetic-') as temp:
        m.DB_PATH = str(Path(temp) / 'demo.db')
        m._conn = None
        client = TestClient(m.app)
        trace = []
        def post(path, body, user, expected=200):
            r = client.post(path, json=body, headers=signed(user))
            assert r.status_code == expected, (path, r.status_code)
            trace.append({'method': 'POST', 'path': path, 'actor': user, 'status': r.status_code})
            return r.json()
        try:
            post('/orgs', {'id':'atlas-project','name':'Atlas project','wall':'sealed'}, 'mira')
            post('/remember', {'text':DEADLINE,'org':'atlas-project'}, 'mira')
            post('/remember', {'text':PRIVATE}, 'mira')
            # Positive control confirms the supposedly private record really exists.
            owner = post('/recall', {'query':'Project context and personal notes'}, 'mira')
            assert 'birthday' in owner['answer']
            if granted:
                post('/orgs/atlas-project/members', {'user':'relay','role':'member'}, 'mira')
            # The requesting agent cannot self-grant membership or write to owner scope.
            post('/orgs/atlas-project/members', {'user':'relay','role':'admin'}, 'relay', 403)
            post('/remember', {'text':'Rejected synthetic write','scope':'mira'}, 'relay', 403)
            unsigned = client.post('/recall', json={'query':'Project context'})
            assert unsigned.status_code == 422
            result = post('/recall', {'query':'What is the Atlas project deadline?'}, 'relay')
            assert 'birthday' not in result['answer']
            assert result['access']['personal_memories'] == 0
            assert result['access']['member_memories'] == (1 if granted else 0)
            return {'synthetic':True,'execution':'real-local-backend','attested':False,
                    'retrieval':'deterministic fixture vectors; actual SQL authorization; no LLM',
                    'permission':'member' if granted else 'no membership', 'requester':'relay',
                    'result':result,'trace':trace,
                    'checks':{'owner_can_recall_private':True,'private_excluded':True,
                              'self_grant_denied':True,'scope_spoof_denied':True,'unsigned_denied':True}}
        finally:
            client.close()
            if m._conn:
                m._conn.close()
            m._conn = None


class Edge(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def reply(self, code, body, kind='application/json'):
        data = json.dumps(body).encode() if kind == 'application/json' else body
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('Access-Control-Allow-Origin',DEMO_ORIGIN)
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',DEMO_ORIGIN)
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()
    def do_GET(self):
        if self.path in ('/', '/demo.html'):
            return self.reply(200, (ROOT/'web/demo.html').read_bytes(), 'text/html; charset=utf-8')
        if self.path == '/healthz':
            return self.reply(200, {'ok':True,'synthetic':True,'attested':False,'remaining':max(0,BUDGET-COUNT)})
        self.reply(404, {'detail':'Not exposed'})
    def do_POST(self):
        global COUNT
        if self.path != '/demo/run':
            return self.reply(404, {'detail':'Not exposed'})
        try:
            self.connection.settimeout(5)
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= 128 or self.headers.get('Transfer-Encoding'):
                return self.reply(413, {'detail':'Bounded body required'})
            body = json.loads(self.rfile.read(size))
            if not isinstance(body,dict) or set(body) != {'granted'} or type(body['granted']) is not bool:
                return self.reply(403, {'detail':'Only the fixed synthetic permission toggle is accepted'})
        except (ValueError,TimeoutError):
            return self.reply(400, {'detail':'Invalid JSON'})
        if not LOCK.acquire(blocking=False):
            return self.reply(429, {'detail':'Demo busy. Try again.'})
        try:
            if COUNT >= BUDGET:
                return self.reply(429, {'detail':'Demo lifetime request budget exhausted'})
            COUNT += 1
            self.reply(200, exercise(body['granted']))
        except Exception:
            self.reply(500, {'detail':'Backend check failed. No simulated fallback.'})
        finally:
            LOCK.release()

if __name__ == '__main__':
    if '--proof' in sys.argv:
        print(json.dumps([exercise(True), exercise(False), exercise(True)], indent=2))
    else:
        ThreadingHTTPServer(('127.0.0.1',18097), Edge).serve_forever()
