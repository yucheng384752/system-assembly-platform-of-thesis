#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
echo "No additional kit setup required. Python packages are listed in requirements.txt; the factory tables are created by the system init step (python -m app.system_init)."
