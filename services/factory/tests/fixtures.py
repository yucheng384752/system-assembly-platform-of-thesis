"""Shared helpers: the contract fixtures, and a way to change a plan and re-seal it so only the structural check is exercised."""
import copy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from factory_core.canonical import parse_json
from factory_core.plan import plan_id_of

ROOT = Path(__file__).resolve().parents[3]
PLAN_DIR = ROOT / 'fixtures' / 'executable-plan'


def load(name: str) -> dict:
    return parse_json((PLAN_DIR / name).read_text(encoding='utf-8'))


def resealed(plan: dict) -> dict:
    """A copy whose planId matches its (changed) content, as a new plan version would."""
    plan = copy.deepcopy(plan)
    plan['planId'] = plan_id_of(plan)
    return plan


def text(plan: dict) -> str:
    return json.dumps(plan, ensure_ascii=False)


KITS = {'inventory-kit', 'work-order-kit', 'quality-kit'}
EVALUATOR = load('valid.json')['source']['aovCoreCommit']
FORMS = {n['form']['formId']: n['form']['contentSha256'] for n in load('valid.json')['nodes'] if n.get('form')}
NOW = '2026-10-28T12:00:00Z'
