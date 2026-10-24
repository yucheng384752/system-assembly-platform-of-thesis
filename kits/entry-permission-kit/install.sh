#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
echo "No additional kit setup required. Python packages are listed in requirements.txt; the initial administrator is created with python -m app.entry_permission.create_admin."
