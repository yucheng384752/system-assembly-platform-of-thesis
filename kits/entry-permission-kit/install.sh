#!/usr/bin/env bash
set -e
echo "entry-permission-kit: account login, role defaults and per-account entry overrides enabled."
echo "  Backend: /auth (login, me, change-password), /users (manage, entry overrides, scopes)"
echo "  Requires platform settings JWT_SECRET (secret reference), ACCESS_TOKEN_EXPIRE_MINUTES, PASSWORD_MIN_LENGTH."
