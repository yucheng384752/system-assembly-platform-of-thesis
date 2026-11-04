cfg=$1
c=$(docker ps --format "{{.Names}}" | grep "kv-$cfg-.*backend" | head -1)
docker exec $c python -c "
import json
from app.main import app
print(json.dumps([[sorted(r.methods), r.path] for r in app.routes if getattr(r, 'methods', None)]))
" > $HOME/kv/out/$cfg/routes.json
python3 -c "import json;print('routes',len(json.load(open('$HOME/kv/out/$cfg/routes.json'))))"
