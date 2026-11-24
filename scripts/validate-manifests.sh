#!/usr/bin/env bash
# Offline validation: parses every YAML file and renders kustomize overlays if kustomize is installed.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import glob, sys
try:
    import yaml
except ImportError:
    print("PyYAML not installed: pip install pyyaml"); sys.exit(1)
bad = 0
for f in glob.glob("**/*.yml", recursive=True) + glob.glob("**/*.yaml", recursive=True):
    if "node_modules" in f: continue
    try:
        list(yaml.safe_load_all(open(f)))
        print("ok   ", f)
    except Exception as e:
        bad += 1; print("ERROR", f, e)
sys.exit(1 if bad else 0)
PY
if command -v kustomize >/dev/null; then
  for o in k8s/overlays/*/; do kustomize build "$o" >/dev/null && echo "ok    kustomize $o"; done
fi
