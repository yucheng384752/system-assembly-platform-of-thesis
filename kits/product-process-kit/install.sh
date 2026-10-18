#!/usr/bin/env bash
set -e
echo "product-process-kit: product lines, models, recipes, specs and form definitions enabled."
echo "  Backend: /product-lines, /product-models, /forms"
echo "  Requires entry-permission-kit (entry points and product-line scope type) and platform database session."
echo "  Load a line definition file with app.core.seed_loader.apply_seed after migration."
