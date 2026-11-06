set -eu
cfg=$1; o=$HOME/kv/out/$cfg; E="sh $HOME/kv/repo/services/installer/install.sh"
PKG="--system-id kv-$cfg --archive $o/system.tar.gz --signature $o/sig/system-package.sig.json --key $HOME/kv/keys/root/signing-public-key.pem --confirm-key-prefix caf273f7"
cd $HOME/kv
echo "== verify"; $E verify $PKG --json 2>&1 | cut -c1-120 | tail -1
exp=$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
printf '{"passphrase":"kv-test-passphrase-1","expiresAt":"%s"}' "$exp" > $o/issue.json; chmod 600 $o/issue.json
rm -f $o/license.lic $o/plan.json $o/rollback.json
echo "== issue-license"; $E issue-license $PKG --subkey $HOME/kv/keys/sub/subkey.enc.pem --certificate $HOME/kv/keys/sub/subkey.cert.json --input-file $o/issue.json --out $o/license.lic --json 2>&1 | tail -1
echo "== plan"; $E plan $PKG --license $o/license.lic --plan $o/plan.json --json 2>&1 | cut -c1-80 | tail -1
