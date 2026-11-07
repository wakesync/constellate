"""Exact scoped shares. Synthetic data, in-process TestClient only.
Run: python3 tests/shares_test.py -v
"""
import hashlib
import hmac
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
_TMP = tempfile.TemporaryDirectory(prefix='shares-qa-')
os.environ.update(DB_PATH=str(Path(_TMP.name) / 'qa.db'), SWARM_SECRET='qa-shares-not-real',
                  ROUTER_DEMO='0', LLM_ENABLED='0', ENCLAVE_URL='', STRIPE_KEY='')
from fastapi.testclient import TestClient
from app import main as m

C = TestClient(m.app)
SECRET_TEXT = 'Ada is a morning person and likes cooking for the house. CANARY-5521'


def h(user):
    ts = str(int(time.time()))
    sig = hmac.new(b'qa-shares-not-real', f'{user}.{ts}'.encode(), hashlib.sha256).hexdigest()
    return {'X-Swarm-User': user, 'X-Swarm-Ts': ts, 'X-Swarm-Sig': sig}


class Shares(unittest.TestCase):
    def share(self, owner='fx_ada', readers=('fx_bram',), text=SECRET_TEXT):
        r = C.post('/shares', json={'context': 'con_fx_1', 'text': text, 'readers': list(readers)}, headers=h(owner))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_exact_read_by_owner_and_reader_only(self):
        s = self.share()
        self.assertEqual(s['sha256'], hashlib.sha256(SECRET_TEXT.encode()).hexdigest())
        for u in ('fx_ada', 'fx_bram'):
            r = C.get(f"/shares/{s['id']}", headers=h(u))
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()['text'], SECRET_TEXT)
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=h('fx_dev')).status_code, 404)
        self.assertEqual(C.get('/shares/shr_doesnotexist', headers=h('fx_ada')).status_code, 404)

    def test_unsigned_and_bad_sig_rejected(self):
        s = self.share()
        self.assertEqual(C.get(f"/shares/{s['id']}").status_code, 422)
        bad = h('fx_bram'); bad['X-Swarm-Sig'] = '0' * 64
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=bad).status_code, 401)
        spoof = h('fx_dev'); spoof['X-Swarm-User'] = 'fx_bram'
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=spoof).status_code, 401)

    def test_revoke_owner_only_idempotent_hard_delete(self):
        s = self.share()
        self.assertEqual(C.delete(f"/shares/{s['id']}", headers=h('fx_bram')).status_code, 404)
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=h('fx_bram')).status_code, 200)
        for _ in range(2):
            self.assertEqual(C.delete(f"/shares/{s['id']}", headers=h('fx_ada')).json()['revoked'], True)
        for u in ('fx_ada', 'fx_bram'):
            self.assertEqual(C.get(f"/shares/{s['id']}", headers=h(u)).status_code, 404)
        with m._lock:
            self.assertIsNone(m.conn().execute('SELECT 1 FROM shares WHERE id=?', (s['id'],)).fetchone())

    def test_drop_reader(self):
        s = self.share(readers=('fx_bram', 'fx_cyd'))
        C.delete(f"/shares/{s['id']}/readers/fx_cyd", headers=h('fx_ada'))
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=h('fx_cyd')).status_code, 404)
        self.assertEqual(C.get(f"/shares/{s['id']}", headers=h('fx_bram')).status_code, 200)

    def test_never_in_memories_or_recall(self):
        self.share(text='zebra quantum lantern CANARY-9001')
        with m._lock:
            self.assertIsNone(m.conn().execute("SELECT 1 FROM memories WHERE text LIKE '%CANARY-9001%'").fetchone())
        r = C.post('/recall', json={'query': 'zebra quantum lantern'}, headers=h('fx_bram'))
        self.assertNotIn('CANARY-9001', r.text)

    def test_validation(self):
        self.assertEqual(C.post('/shares', json={'context': 'c', 'text': 'x', 'readers': ['fx_ada']}, headers=h('fx_ada')).status_code, 400)
        self.assertEqual(C.post('/shares', json={'context': 'c', 'text': 'x', 'readers': []}, headers=h('fx_ada')).status_code, 422)
        self.assertEqual(C.post('/shares', json={'context': 'c', 'text': 'x' * 4001, 'readers': ['fx_b']}, headers=h('fx_ada')).status_code, 422)
        self.assertEqual(C.post('/shares', json={'context': 'c', 'text': 'x', 'readers': ['bad id!']}, headers=h('fx_ada')).status_code, 400)


if __name__ == '__main__':
    unittest.main()
