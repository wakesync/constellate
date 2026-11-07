"""Pytest collection config for services/astro.

test_hd.py is a script-style verification suite (it runs checks at import time
and sys.exit()s with a status code), which pytest cannot collect. It stays
untouched per the no-touch rule for existing tropical tests; run it directly:

    .venv/bin/python test_hd.py

test_acg.py collects fine under pytest (plain test_ functions).
"""

collect_ignore = ["test_hd.py"]
