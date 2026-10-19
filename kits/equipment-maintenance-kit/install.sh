#!/usr/bin/env bash
set -e
echo "equipment-maintenance-kit: equipment list, daily/weekly/monthly checklists, review, repairs, monthly export enabled."
echo "  Backend: /equipment, /equipment-checks, /equipment-repairs"
echo "  Requires entry-permission-kit. Production gate is registered only if batch-production-kit is installed."
echo "  Call app.core.startup.enable_equipment_kit(raw_settings) once at startup."
