"""Downloadable starting points for a new site: forms to fill in and examples of each file the Kit reads.

The example files are the synthetic demo data set, so they are always in the format the Kit really accepts (a test feeds each
one to the format checks). Nothing here touches the data directory.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List

HERE = Path(__file__).parent
TEMPLATES_DIR = HERE / 'templates'
DEMO = HERE / 'demo_data'

# name -> (file, content type, what it is for)
CATALOG: Dict[str, tuple] = {
    'requirements-form.md': (TEMPLATES_DIR / 'requirements-form.md', 'text/markdown', '導入需求表：要填的項目與最小資料清單'),
    'column-dictionary.csv': (TEMPLATES_DIR / 'column-dictionary.csv', 'text/csv', '欄位字典：每個欄位的意義、型別、單位、缺值意義與角色'),
    'column-mapping.template.json': (TEMPLATES_DIR / 'column-mapping.template.json', 'application/json', '欄位對照：把場域欄名對到引擎讀取的欄名，貼進設定的 columnMapping'),
    'analysis_config.template.json': (DEMO / 'config' / 'analysis_config.json', 'application/json', '分析設定檔範例（每日模式）：特徵、目標、ID、檔案路徑'),
    'ng_code.template.json': (DEMO / 'config' / 'ng_code.json', 'application/json', '不良代碼定義範例'),
    'topology.template.json': (DEMO / 'config' / 'topology.json', 'application/json', '製程拓樸範例：站點、角色、特徵'),
    'knowledge.template.csv': (DEMO / 'config' / 'knowledge.csv', 'text/csv', 'SOP 知識範例（七個欄位，欄位內不可有逗號）'),
    'current-data.example.csv': (DEMO / 'data' / 'current_daily.csv', 'text/csv', '待分析資料範例（合成資料，每日模式）'),
    'baseline.example.csv': (DEMO / 'data' / 'baseline.csv', 'text/csv', '正常基準資料範例（合成資料）'),
}


def listing() -> List[Dict[str, object]]:
    return [{'name': name, 'description': description, 'contentType': content_type, 'bytes': path.stat().st_size}
            for name, (path, content_type, description) in CATALOG.items()]


def read(name: str):
    """(bytes, content type), or None for a name that is not in the catalog. Names are never turned into paths."""
    entry = CATALOG.get(name)
    if entry is None:
        return None
    return entry[0].read_bytes(), entry[1]
