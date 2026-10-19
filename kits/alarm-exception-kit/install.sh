#!/usr/bin/env bash
set -e
echo "alarm-exception-kit: spec-range / threshold / consistency alarms and exception sign-off enabled."
echo "  Backend: /alarms, /batches/{id}/exception-requests, /exception-requests/{id}/decision"
echo "  Requires entry-permission-kit and batch-production-kit."
echo "  Call app.core.alarm_startup.enable_alarm_kit(raw_settings) once at startup."
