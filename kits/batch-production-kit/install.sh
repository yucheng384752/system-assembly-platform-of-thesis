#!/usr/bin/env bash
set -e
echo "batch-production-kit: batch open, dispatch, measurement entry, material weighing, sign-off and completion enabled."
echo "  Backend: /batches"
echo "  Requires entry-permission-kit, product-process-kit and platform database session."
echo "  Apply settings with app.core.batch_settings.configure(load_batch_settings(raw)) at startup."
