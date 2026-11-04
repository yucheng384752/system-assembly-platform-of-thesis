set -eu
export PATH=$HOME/kv/node/bin:$PATH
cfg=$1; d=$HOME/kv/pkgs/$cfg; o=$HOME/kv/out/$cfg
rm -rf $o; mkdir -p $o
cd $d && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - $(ls -A) | gzip -n > $o/system.tar.gz
ls -la $o/system.tar.gz | awk '{print "archive bytes",$5}'
cd $HOME/kv/repo
node scripts/security/sign-system-package.mjs --key $HOME/kv/keys/root/signing-private-key.pem --archive $o/system.tar.gz --manifest $d/system-manifest.json --system-id kv-$cfg --system-version 1.0.0 --out-dir $o/sig
ls $o/sig
