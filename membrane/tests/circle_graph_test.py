"""Cognee circle graph: approved-only, revoke removes, second reading gets first reading's themes.
Synthetic members only. Needs `pip install cognee` (skipped otherwise). No LLM/embedding calls.
Run: python3 tests/circle_graph_test.py -v
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
_TMP = tempfile.TemporaryDirectory(prefix='cgraph-qa-')
os.environ.update(DB_PATH=str(Path(_TMP.name) / 'qa.db'), SWARM_SECRET='qa-cgraph-not-real', ROUTER_DEMO='0',
                  LLM_ENABLED='0', ENCLAVE_URL='', STRIPE_KEY='',
                  SYSTEM_ROOT_DIRECTORY=str(Path(_TMP.name) / 'cognee-sys'), DATA_ROOT_DIRECTORY=str(Path(_TMP.name) / 'cognee-data'))
try:
    import cognee  # noqa: F401
    HAVE_COGNEE = True
except Exception:
    HAVE_COGNEE = False

from fastapi.testclient import TestClient
from app import main as m

C = TestClient(m.app)
CTX = 'cst:circle_qa_1'
ADA = 'Ada is a morning person who plans the house routine and talks things through. CANARY-ADA-77'
BRAM = 'Bram is a night owl builder who needs space and some independence. CANARY-BRAM-88'


def h(user):
    ts = str(int(time.time()))
    sig = hmac.new(b'qa-cgraph-not-real', f'{user}.{ts}'.encode(), hashlib.sha256).hexdigest()
    return {'X-Swarm-User': user, 'X-Swarm-Ts': ts, 'X-Swarm-Sig': sig}


def share(owner, reader, text, ctx=CTX):
    r = C.post('/shares', json={'context': ctx, 'text': text, 'readers': [reader]}, headers=h(owner))
    assert r.status_code == 200, r.text
    return r.json()['id']


@unittest.skipUnless(HAVE_COGNEE, 'cognee not installed')
class CircleGraph(unittest.TestCase):
    def test_flow(self):
        a, b, eve = 'cst:fx_ada', 'cst:fx_bram', 'cst:fx_eve'
        sa = share(a, b, ADA)
        # A non-approved / unshared summary never enters: only share ids, owner-only.
        self.assertEqual(C.post(f'/circle-graph/{CTX}/summaries', json={'share_id': sa}, headers=h(b)).status_code, 404)
        self.assertEqual(C.post(f'/circle-graph/{CTX}/summaries', json={'share_id': 'shr_doesnotexist'}, headers=h(a)).status_code, 404)
        self.assertEqual(C.post(f'/circle-graph/{CTX}/summaries', json={'share_id': sa}, headers=h(a)).status_code, 200)
        # Bram has not approved anything yet: reading cannot be recorded.
        r = C.post(f'/circle-graph/{CTX}/readings', json={'reading_id': 'rd1', 'pair': [a, b], 'themes': ['communication'], 'sources': [sa]}, headers=h(a))
        self.assertEqual(r.status_code, 409)
        sb = share(b, a, BRAM)
        self.assertEqual(C.post(f'/circle-graph/{CTX}/summaries', json={'share_id': sb}, headers=h(b)).status_code, 200)
        snap = C.get(f'/circle-graph/{CTX}', headers=h(a)).json()
        self.assertEqual(snap['backend'], 'cognee')
        self.assertEqual(snap['members'], sorted([a, b]))
        self.assertEqual({s['text'] for s in snap['summaries']}, {ADA, BRAM})
        self.assertEqual(C.get(f'/circle-graph/{CTX}', headers=h(eve)).status_code, 404)

        # First reading for the pair, then the second reading receives its themes.
        r = C.post(f'/circle-graph/{CTX}/readings', json={'reading_id': 'rd1', 'pair': [a, b], 'themes': ['communication', 'independence', 'not-a-theme'], 'sources': [sa, sb]}, headers=h(a))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['themes'], ['communication', 'independence'])
        prior = C.get(f'/circle-graph/{CTX}/prior-themes', params={'a': b, 'b': a}, headers=h(b)).json()['themes']
        self.assertEqual(set(prior), {'communication', 'independence'})
        self.assertEqual(C.get(f'/circle-graph/{CTX}/prior-themes', params={'a': a, 'b': b}, headers=h(eve)).status_code, 403)

        # Revoke Ada's share through the exact-share API only: graph purges lazily.
        self.assertEqual(C.delete(f'/shares/{sa}', headers=h(a)).status_code, 200)
        snap = C.get(f'/circle-graph/{CTX}', headers=h(b)).json()
        dump = repr(snap)
        self.assertNotIn('CANARY-ADA-77', dump)
        self.assertEqual(snap['members'], [b])
        self.assertEqual(snap['readings'], [])
        self.assertEqual(C.get(f'/circle-graph/{CTX}/prior-themes', params={'a': a, 'b': b}, headers=h(b)).json()['themes'], [])
        # Explicit member drop also works and is self-only.
        self.assertEqual(C.delete(f'/circle-graph/{CTX}/members/{b}', headers=h(a)).status_code, 404)
        self.assertEqual(C.delete(f'/circle-graph/{CTX}/members/{b}', headers=h(b)).status_code, 200)


if __name__ == '__main__':
    unittest.main()
