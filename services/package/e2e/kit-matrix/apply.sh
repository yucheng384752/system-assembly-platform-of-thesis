set -eu
cfg=$1; o=$HOME/kv/out/$cfg; E="sh $HOME/kv/repo/services/installer/install.sh"
cd $HOME/kv
sha=$(python3 -c "import json;print(json.load(open('$o/plan.json'))['planSha256'])")
MOD=''
[ "$cfg" = mod-subscription ] && MOD=',"MOD_WEBHOOK_SECRET":"kv-webhook-secret-0123456789-0123"'
cat > $o/input.json <<JSON
{"env":{"POSTGRES_USER":"sysuser","POSTGRES_DB":"sysdb","POSTGRES_PASSWORD":"kv-db-secret-0123456789","SECRET_KEY":"kv-secret-key-0123456789-0123456789","ENTRY_PERMISSION_JWT_SECRET":"kv-jwt-secret-0123456789-0123456789","DEFAULT_TENANT_ID":"00000000-0000-4000-8000-000000000001"${MOD}},"admin":{"username":"admin","password":"bootstrap-secret-1","display_name":"Admin"}}
JSON
chmod 600 $o/input.json
echo "== apply (planSha256 $sha)"
$E apply --system-id kv-$cfg --plan $o/plan.json --plan-sha256 $sha --license $o/license.lic --input-file $o/input.json --json 2>&1 | cut -c1-300 | tail -20
