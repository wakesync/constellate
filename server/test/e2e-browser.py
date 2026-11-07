"""Real Chromium, real auth/SQLite, no inference mocks. Run against an isolated QA instance.
BASE_URL defaults to local QA only; set SCREENSHOT_DIR for release receipts.
A real provider success is ONLY recorded if the production endpoint returns 201.
"""
import json, os, secrets
from pathlib import Path
from playwright.sync_api import sync_playwright

base = os.environ.get('BASE_URL', 'http://127.0.0.1:3488').rstrip('/')
out = Path(os.environ.get('SCREENSHOT_DIR', 'artifacts/e2e'))
out.mkdir(parents=True, exist_ok=True)
receipts = []
def check(value, label):
    assert value, label
    receipts.append(label)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    a, b = browser.new_context(), browser.new_context()
    page = a.new_page()
    page.goto(base)
    page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    def req(ctx, method, path, data=None, origin=None):
        return ctx.request.fetch(base+path, method=method, data=data,
            headers={'Origin': origin or base})
    password = secrets.token_urlsafe(24)
    suffix = secrets.token_hex(6)
    emails = [f'qa-{suffix}-{n}@example.test' for n in ('alice', 'bob')]
    for ctx, email in zip((a,b), emails):
        r = req(ctx,'POST','/api/auth/sign-up/email',{'name':'QA synthetic','email':email,'password':password})
        check(r.status == 200, 'real signup '+email.split('@')[0].split('-')[-1])
    cookies = a.cookies()
    check(any(c['httpOnly'] and c['sameSite']=='Lax' for c in cookies), 'HttpOnly SameSite session cookie')
    if base.startswith('https:'):
        check(all(c['secure'] for c in cookies), 'HTTPS secure cookies')
    birth = dict(date='2000-01-01',time='12:00',timeZone='UTC',latitude=None,longitude=None,consent=True)
    check(req(a,'PUT','/api/profile',{**birth,'consent':False}).status==400, 'consent mandatory')
    r = req(a,'PUT','/api/profile',birth)
    check(r.status==200, 'real chart saved')
    check(r.json()['chart']['placements'][0]['sign']=='Capricorn', 'known solar fixture')
    check(req(b,'GET','/api/me').json()['profile'] is None, 'two-account profile isolation')
    check(req(a,'DELETE','/api/profile',origin='https://evil.example').status==403, 'cross-origin mutation rejected')
    r = req(a,'POST','/api/readings',{})
    if r.status == 201:
        reading = r.json()['reading']
        check(reading['verification']=='sdk-attested' and reading['provider']=='tinfoil', 'REAL private provider response')
        rid = reading['id']
        check(req(b,'GET','/api/readings/'+rid).status==404, 'cross-account reading read denied')
        check(req(b,'DELETE','/api/readings/'+rid).status==404, 'cross-account reading delete denied')
    else:
        check(r.status==503, 'unconfigured/unavailable private provider fails closed')
        check(req(a,'GET','/api/readings').json()['readings']==[], 'provider failure saved no reading')
        receipts.append('BLOCKER: no real provider success; reading isolation success path not exercised here')
    check(req(a,'POST','/api/auth/sign-out',{}).status==200, 'logout')
    check(req(a,'GET','/api/me').status==401, 'logged-out session denied')
    check(req(a,'POST','/api/auth/sign-in/email',{'email':emails[0],'password':password}).status==200, 'real login')
    check(req(a,'GET','/api/me').json()['profile']['birth']['date']==birth['date'], 'profile persisted across logout/login')
    page.reload()
    page.screenshot(path=str(out / 'authenticated.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(out / 'mobile.png'), full_page=True)
    check(req(a,'DELETE','/api/profile').status==204, 'profile deletion')
    check(req(a,'GET','/api/me').json()['profile'] is None, 'birth details removed')
    check(req(a,'GET','/api/readings').json()['readings']==[], 'readings removed with profile')
    for ctx in (a,b):
        check(req(ctx,'DELETE','/api/account').status==204, 'synthetic account deleted')
        check(req(ctx,'GET','/api/me').status==401, 'deleted account session denied')
    browser.close()
(out / 'browser-results.json').write_text(json.dumps({'baseURL':base,'checks':receipts},indent=2))
print(json.dumps(receipts,indent=2))
