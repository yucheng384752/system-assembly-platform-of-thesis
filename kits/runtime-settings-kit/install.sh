#!/usr/bin/env bash
set -e
echo "runtime-settings-kit: runtime parameter center enabled (effective values, edit with version check, change log)."
echo "  Backend: /settings"
echo "  Requires entry-permission-kit. Start it AFTER all other kits so they have registered their parameters."
echo "  Call app.core.settings_startup.enable_runtime_settings_kit(raw) then app.core.settings_service.apply_all(db)."
