#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
echo "Python packages are listed in requirements.txt. Analysis files live in ANALYTICAL_FOUR_DATA_DIR (default /system/data/analytical-four)."
echo "To start with the synthetic demo data set run: python -m app.analytical_four.seed_demo  (or POST /api/analytical-four/demo as an administrator)."
