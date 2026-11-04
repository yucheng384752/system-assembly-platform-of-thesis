#!/bin/bash
# Paths below (SRC, OUT, VM, SSH key trust) are this machine's; see README.md.
# One config, end to end: ship -> images -> pack/sign -> verify/license/plan -> apply -> routes -> (factory e2e) -> smoke -> func -> collect -> clean
cfg=$1
VM=192.168.200.63
OUT=/c/Users/gslab/Desktop/kv-out
HERE=$(cd "$(dirname "$0")" && pwd)   # the kit-matrix folder holding the helper scripts
SRC=$(cd "$HERE/../../../.." && pwd)   # repository root
mkdir -p $OUT/logs $OUT/results/$cfg
LOG=$OUT/logs/$cfg.log
: > $LOG
step() { echo "[$(date +%H:%M:%S)] $*" | tee -a $LOG; }
vm() { ssh -o BatchMode=yes $VM "$@" >> $LOG 2>&1; }
for f in apply plan clean routes pack; do tr -d '\r' < $HERE/$f.sh | ssh $VM "cat > /tmp/kv_$f.sh"; done
tr -d '\r' < $HERE/smoke.py | ssh $VM 'cat > ~/kv/smoke.py'
tr -d '\r' < $HERE/func.py | ssh $VM 'cat > ~/kv/func.py'
tr -d '\r' < $SRC/services/package/e2e/factory_e2e.py | ssh $VM 'cat > ~/kv/factory_e2e.py'
ssh $VM 'mkdir -p ~/kv/fixtures' && tar -c -C $SRC/fixtures/executable-plan valid.json forms.json | ssh $VM 'tar -x -C ~/kv/fixtures'

step "ship package"
tar -c -C $OUT/$cfg . | ssh $VM "rm -rf ~/kv/pkgs/$cfg ~/kv/out/$cfg && mkdir -p ~/kv/pkgs/$cfg ~/kv/out/$cfg && tar -x -C ~/kv/pkgs/$cfg" >> $LOG 2>&1 || { step "FAIL ship"; exit 1; }
step "bundle-images"
t=$(date +%s)
vm "export PATH=\$HOME/kv/node/bin:\$PATH; cd ~/kv/repo && node services/package/bundle-images.mjs ~/kv/pkgs/$cfg --system-version 1.0.0" || { step "FAIL bundle-images"; vm "sh /tmp/kv_clean.sh $cfg"; exit 1; }
step "bundle-images done $(( $(date +%s) - t ))s"
vm "sh /tmp/kv_pack.sh $cfg" || { step "FAIL pack/sign"; exit 1; }
vm "sh /tmp/kv_plan.sh $cfg" && vm "test -f $HOME/kv/out/$cfg/plan.json || test -f ~/kv/out/$cfg/plan.json" || { step "FAIL verify/license/plan"; exit 1; }
step "apply"
t=$(date +%s)
ssh $VM "sh /tmp/kv_apply.sh $cfg" >> $LOG 2>&1
if ! grep -q '"status":"ok","step":"health-check"' $LOG; then
  step "FAIL apply (see log tail)"; tail -3 $LOG | cut -c1-300
  scp -q $VM:kv/out/$cfg/{plan.json,input.json} $OUT/results/$cfg/ 2>/dev/null
  echo "APPLY_FAILED $cfg" > $OUT/results/$cfg/status.txt
  exit 2
fi
step "apply ok $(( $(date +%s) - t ))s"
vm "sh /tmp/kv_routes.sh $cfg"
if [ "$cfg" = factory-core ]; then
  step "factory e2e run"
  ssh $VM 'c=$(docker ps --format "{{.Names}}" | grep "kv-factory-core-.*backend" | head -1); docker cp ~/kv/fixtures/valid.json $c:/tmp/valid.json; docker cp ~/kv/fixtures/forms.json $c:/tmp/forms.json; docker exec -i -e DATABASE_URL="$(docker exec $c cat /run/secrets/database_url)" $c python - run < ~/kv/factory_e2e.py' > $OUT/results/$cfg/factory_run.txt 2>&1
  ssh $VM 'c=$(docker ps --format "{{.Names}}" | grep "kv-factory-core-.*backend" | head -1); docker restart $c >/dev/null; for i in $(seq 1 40); do docker ps --filter name=$c --format "{{.Status}}" | grep -q healthy && break; sleep 3; done; docker exec -i -e DATABASE_URL="$(docker exec $c cat /run/secrets/database_url)" $c python - verify < ~/kv/factory_e2e.py' > $OUT/results/$cfg/factory_verify.txt 2>&1
  step "factory e2e: run $(grep -c '^PASS' $OUT/results/$cfg/factory_run.txt) pass / $(grep -c '^FAIL' $OUT/results/$cfg/factory_run.txt) fail; verify $(grep -c '^PASS' $OUT/results/$cfg/factory_verify.txt) pass / $(grep -c '^FAIL' $OUT/results/$cfg/factory_verify.txt) fail"
fi
step "smoke"
ssh $VM "python3 ~/kv/smoke.py $cfg" > $OUT/results/$cfg/smoke.txt 2>&1
step "$(tail -1 $OUT/results/$cfg/smoke.txt)"
step "func"
ssh $VM "python3 ~/kv/func.py $cfg" > $OUT/results/$cfg/func.txt 2>&1
step "$(tail -1 $OUT/results/$cfg/func.txt)"
scp -q $VM:kv/out/$cfg/{routes.json,smoke.json,func.json,plan.json} $OUT/results/$cfg/ 2>/dev/null
ssh $VM "docker ps --format '{{.Names}} {{.Status}}'; for c in \$(docker ps --format '{{.Names}}' | grep backend); do docker logs \$c 2>&1 | grep -c -E ' 5[0-9][0-9] |Traceback' ; done" > $OUT/results/$cfg/containers.txt 2>&1
step "backend 5xx/Traceback count: $(tail -1 $OUT/results/$cfg/containers.txt)"
echo DONE > $OUT/results/$cfg/status.txt
if [ "${KEEP:-0}" != 1 ]; then vm "sh /tmp/kv_clean.sh $cfg"; step "cleaned"; fi
