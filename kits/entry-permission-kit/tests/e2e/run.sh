#!/bin/sh
# Runs inside python:3.12.8-slim-bookworm on the same docker network as the PostgreSQL container.
set -u
pip install -q --no-cache-dir -r /work/req.txt -r /work/ep-req.txt >/tmp/pip.log 2>&1 || { tail -5 /tmp/pip.log; exit 90; }
cp /work/e2e/e2e_main.py /work/asm/app/e2e_main.py
cd /work/asm
export PYTHONPATH=/work/asm DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000001 ENTRY_POINTS_FILE=/work/e2e/entry_points.json \
  DATABASE_URL=postgresql+asyncpg://e2e:e2e-local-only@epe2e-pg:5432/e2e PG_DSN=postgresql://e2e:e2e-local-only@epe2e-pg:5432/e2e \
  SECRET_KEY=e2e-only-secret-key-0123456789-abcdefghij ENVIRONMENT=e2e LOG_DIR=/tmp/logs UPLOAD_TEMP_DIR=/tmp/up \
  ENDPOINT_PERMISSIONS_FILE=/tmp/endpoint_permissions.json
mkdir -p /tmp/logs /tmp/up; echo '{}' > /tmp/endpoint_permissions.json

echo "== startup fail-loud: missing / short JWT secret"
for secret in "" "0123456789012345678901234567890"; do
  ENTRY_PERMISSION_JWT_SECRET="$secret" timeout 20 python -m uvicorn app.e2e_main:app --port 8001 >/tmp/fail.log 2>&1
  echo "secret_len=${#secret} exit=$? $(grep -c -i 'secret' /tmp/fail.log) secret-mentions"
done

export ENTRY_PERMISSION_JWT_SECRET=e2e-jwt-secret-0123456789-0123456789-abc
python -m uvicorn app.e2e_main:app --host 127.0.0.1 --port 8000 >/tmp/server.log 2>&1 &
i=0; until python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2)" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 40 ] && { echo "server did not start"; tail -30 /tmp/server.log; exit 91; }; sleep 1; done
echo "== server up"

echo "== bootstrap race: two simultaneous create_admin with the same username"
printf '{"username":"admin","password":"bootstrap-secret-1","display_name":"Admin"}' > /tmp/in.json
python -m app.entry_permission.create_admin < /tmp/in.json >/tmp/c1.out 2>/tmp/c1.err & p1=$!
python -m app.entry_permission.create_admin < /tmp/in.json >/tmp/c2.out 2>/tmp/c2.err & p2=$!
wait $p1; e1=$?; wait $p2; e2=$?
echo "create_admin exits: $e1 $e2 (expected one 0 and one 1)"
if grep -q "bootstrap-secret-1" /tmp/c1.out /tmp/c1.err /tmp/c2.out /tmp/c2.err /tmp/server.log; then echo "LEAK: password found in output"; else echo "no password in create_admin output or server log"; fi
printf '{"username":"admin2","password":"bootstrap-secret-1","display_name":"Admin"}' | python -m app.entry_permission.create_admin >/dev/null 2>&1
echo "second bootstrap after the first exit=$? (expected 1)"
printf '{"username":"x","password":"short","display_name":"X"}' | python -m app.entry_permission.create_admin >/dev/null 2>&1
echo "weak password bootstrap exit=$? (expected 1)"

echo "== HTTP end to end"
python /work/e2e/run_e2e.py
rc=$?
echo "== server log errors"
grep -c -E "Traceback|ERROR" /tmp/server.log
grep -E "Traceback|ERROR" -A3 /tmp/server.log | head -20
exit $rc
