"""Static checks on the public Tinfoil configs (no network). Run: python3 tests/tinfoil_config_test.py
Guards the properties clients attest against: every image digest-pinned (or the documented
placeholder), secrets never inlined as env, only memory-api behind the shim, model off the shim.
"""
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1] / "tinfoil"
CONFIGS = [ROOT / "tinfoil-config.yml", *sorted((ROOT / "fallback").glob("*.yml"))]
VALID_CPUS = {2, 4, 8, 16, 32}
VALID_MEM = {8192, 16384, 32768, 65536, 131072, 262144, 524288}
FORBIDDEN = ("depends_on", "environment:", "network_mode", "cvm_admin: true", "ipc: host")


def field(text, key):
    m = re.search(rf"^{key}:\s*(\S+)", text, re.M)
    return m.group(1) if m else None


class TinfoilConfigs(unittest.TestCase):
    def test_configs_exist(self):
        self.assertGreaterEqual(len(CONFIGS), 3)

    def test_each_config(self):
        for path in CONFIGS:
            with self.subTest(config=path.name):
                text = path.read_text()
                self.assertTrue(field(text, "cvm-version"))
                self.assertIn(int(field(text, "cpus")), VALID_CPUS)
                self.assertIn(int(field(text, "memory")), VALID_MEM)
                images = re.findall(r'^\s*image:\s*"([^"]+)"', text, re.M)
                self.assertTrue(images)
                for img in images:
                    self.assertRegex(img, r"@sha256:([0-9a-f]{64}|__API_DIGEST__)$", img)
                for bad in FORBIDDEN:
                    self.assertNotIn(bad, text)
                self.assertRegex(text, r'upstream-container:\s*"memory-api"')
                self.assertNotRegex(text, r'upstream-container:\s*"vllm"')
                self.assertRegex(text, r"secrets:\s*\n\s*- SWARM_SECRET")
                self.assertNotRegex(text, r"SWARM_SECRET:\s*\"")   # never a literal value
                if "vllm" in text:
                    self.assertRegex(text, r"swarm: \{\}")              # closed network
                else:
                    self.assertRegex(text, r'LLM_ENABLED:\s*"0"')


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
