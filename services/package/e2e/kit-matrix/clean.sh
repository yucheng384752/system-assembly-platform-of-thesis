cfg=$1
ids=$(docker ps -aq --filter name=kv-$cfg-); [ -n "$ids" ] && docker rm -f $ids >/dev/null
v=$(docker volume ls -q --filter name=kv-$cfg-); [ -n "$v" ] && docker volume rm $v >/dev/null
sudo rm -rf /opt/kv-$cfg-1.0.0 /etc/kv-$cfg /var/lib/kv-$cfg
docker rmi composer-kv-$cfg-backend:1.0.0 >/dev/null 2>&1 || true
docker network prune -f >/dev/null
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null
rm -rf $HOME/kv/pkgs/$cfg $HOME/kv/out/$cfg/system.tar.gz
echo cleaned $cfg; docker ps -a --format "{{.Names}}"; df -h / | tail -1
