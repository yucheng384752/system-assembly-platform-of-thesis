"""Writes the synthetic demo data set into a data directory (default: the Kit's demo_data folder).

Everything here is made up: machine names, lot numbers and measurements come from a seeded random generator and describe no
real production line. Column names follow the Analytical-Four format because the serializer and the NG diagnosis read them
by name. Run it again with the same seed and you get byte-identical files.

    python generate_demo.py [target-directory]
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

SEED = 20261101
NUMERIC = {  # column -> (mean, std)
    'Actual Temp_C1': (195.0, 1.5), 'Actual Temp_C2': (195.0, 1.5), 'Actual Temp_C3': (194.0, 1.5),
    'Line Speed(M/min)': (15.0, 0.4), 'Extruder Speed (rpm)': (60.0, 1.2),
    'Heat gun temperature': (10.0, 0.5), 'Rewind torque': (8.5, 0.3), 'Slitting speed': (60.0, 1.5), 'Thickness diff': (3.0, 0.4),
    'pasteirontemp': (235.0, 2.0), 'blowirontemp': (175.0, 2.0), 'Burr': (2.0, 0.6),
}
# What each defect pushes away from normal, in standard deviations.
DEFECTS = {
    'NG-A': {'pasteirontemp': 5.0, 'blowirontemp': 4.0, 'P3.Machine_No.': 'P22'},
    'NG-B': {'Burr': 6.0, 'P3.Machine_No.': 'P22'},
    'NG-C': {'Heat gun temperature': 5.0, 'Rewind torque': 4.5, 'Slitting machine': 'S2'},
    'NG-D': {'Actual Temp_C1': 5.0, 'Actual Temp_C2': 4.0, 'P1.Machine_No.': 'E2'},
}
COLUMNS = ['Produce_No.', 'Semi_produce_No.', 'timestamp', 'P1.Machine_No.', 'P1.Material', 'Slitting machine', 'Winder number',
           'Quality inspection', 'Quality control', 'P3.Machine_No.', *NUMERIC, 'P2.NG_code', 'P3.NG_code', 'Finish']


def rows(rng: np.random.Generator, prefix: str, count: int, defect_codes: list[str | None]) -> list[dict]:
    result = []
    for index in range(count):
        code = defect_codes[index % len(defect_codes)]
        row = {
            'Produce_No.': f'{prefix}-{index + 1:04d}', 'Semi_produce_No.': f'{prefix}-S{index // 3 + 1:03d}',
            'timestamp': f'2026{(index % 9) + 1:02d}{(index % 27) + 1:02d}',
            'P1.Machine_No.': str(rng.choice(['E1', 'E2'])), 'P1.Material': str(rng.choice(['H5', 'H6'])),
            'Slitting machine': str(rng.choice(['S1', 'S2'])), 'Winder number': int(rng.integers(1, 5)),
            'Quality inspection': str(rng.choice(['QA1', 'QA2'])), 'Quality control': str(rng.choice(['QC1', 'QC2'])),
            'P3.Machine_No.': str(rng.choice(['P21', 'P22'])),
            'P2.NG_code': 0, 'P3.NG_code': code or 0, 'Finish': 0 if code else 1,
        }
        for name, (mean, std) in NUMERIC.items():
            row[name] = round(float(rng.normal(mean, std)), 3)
        if code:
            for name, shift in DEFECTS[code].items():
                if isinstance(shift, str):
                    row[name] = shift
                else:
                    row[name] = round(NUMERIC[name][0] + shift * NUMERIC[name][1] + float(rng.normal(0, NUMERIC[name][1] * 0.3)), 3)
        result.append(row)
    return result


def write_csv(path: Path, data: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(data)


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def feature(feature_id: str, name: str, role: str, level: int) -> dict:
    return {'id': feature_id, 'name': name, 'role': role, 'level': level}


def build(target: Path) -> None:
    rng = np.random.default_rng(SEED)
    write_csv(target / 'data/baseline.csv', rows(rng, 'BASE', 80, [None]))
    # daily: a mixed day; the NG rows are what gets diagnosed and what trains the known base
    write_csv(target / 'data/current_daily.csv', rows(rng, 'DAY', 60, [None, None, None, None, None, 'NG-A', None, 'NG-B', None, 'NG-C', None, 'NG-D']))
    write_csv(target / 'data/complaint.csv', rows(rng, 'CMP', 6, ['NG-A', 'NG-B', 'NG-C', 'NG-D', 'NG-A', 'NG-C']))
    (target / 'cases').mkdir(parents=True, exist_ok=True)
    for name in ('llm_records.jsonl', 'llm_error_records.jsonl'):  # no history yet; blank files are valid
        (target / 'cases' / name).write_text('', encoding='utf-8')
    write_json(target / 'config/ng_code.json', [
        {'category': 'NG-A', 'details': [{'machine': 'Paste iron', 'process': 'P3', 'phenomenon': 'Poor bonding', 'cause': 'Paste iron temperature too high', 'action': 'Lower the paste iron set point and recheck'}]},
        {'category': 'NG-B', 'details': [{'machine': 'Punch', 'process': 'P3', 'phenomenon': 'Burr', 'cause': 'Worn punch edge', 'action': 'Replace the punch'}]},
        {'category': 'NG-C', 'details': [{'machine': 'Slitting machine', 'process': 'P2', 'phenomenon': 'Rough edge', 'cause': 'Heat gun and rewind torque out of range', 'action': 'Adjust the heat gun and rewind torque'}]},
        {'category': 'NG-D', 'details': [{'machine': 'Extruder', 'process': 'P1', 'phenomenon': 'Surface defect', 'cause': 'Barrel zone temperature drift', 'action': 'Recalibrate the barrel zone heaters'}]},
    ])
    write_json(target / 'config/topology.json', {
        'process': {'stations': [{'id': 'P1', 'order': 1, 'name': 'Extrusion'}, {'id': 'P2', 'order': 2, 'name': 'Slitting'}, {'id': 'P3', 'order': 3, 'name': 'Punching'}]},
        'roles': {'parameter': {'direction': 'cause', 'level': 1}, 'outcome': {'direction': 'effect', 'level': 2}},
        'topology': {
            'P1': {'feature': [feature('ActualTemp_C1', 'Actual Temp_C1', 'parameter', 1), feature('ActualTemp_C2', 'Actual Temp_C2', 'parameter', 1),
                               feature('ActualTemp_C3', 'Actual Temp_C3', 'parameter', 1), feature('LineSpeed', 'Line Speed(M/min)', 'parameter', 2),
                               feature('ExtruderSpeed', 'Extruder Speed (rpm)', 'parameter', 2)]},
            'P2': {'feature': [feature('HeatGunTemperature', 'Heat gun temperature', 'parameter', 1), feature('RewindTorque', 'Rewind torque', 'parameter', 1),
                               feature('SlittingSpeed', 'Slitting speed', 'parameter', 2), feature('ThicknessDiff', 'Thickness diff', 'outcome', 3)]},
            'P3': {'feature': [feature('PasteIronTemp', 'pasteirontemp', 'parameter', 1), feature('BlowIronTemp', 'blowirontemp', 'parameter', 1),
                               feature('Burr', 'Burr', 'outcome', 2)]},
        },
    })
    knowledge = [
        ('K-P1-001', 'P1', 'Actual Temp_C1', 'Method', 'Barrel zone 1 temperature abnormal', 'Report the extruder temperature fault', 'P1 setup sheet'),
        ('K-P1-002', 'P1', 'Actual Temp_C2', 'Method', 'Barrel zone 2 temperature abnormal', 'Report the extruder temperature fault', 'P1 setup sheet'),
        ('K-P1-003', 'P1', 'Actual Temp_C3', 'Method', 'Barrel zone 3 temperature abnormal', 'Report the extruder temperature fault', 'P1 setup sheet'),
        ('K-P1-004', 'P1', 'Line Speed(M/min)', 'Method', 'Line speed outside the recipe range', 'Return the line speed to the recipe value', 'P1 setup sheet'),
        ('K-P1-005', 'P1', 'Extruder Speed (rpm)', 'Method', 'Extruder speed outside the recipe range', 'Return the extruder speed to the recipe value', 'P1 setup sheet'),
        ('K-P2-001', 'P2', 'Heat gun temperature', 'Method', 'Heat gun temperature abnormal', 'Check the heat gun and its set point', 'P2 work instruction'),
        ('K-P2-002', 'P2', 'Rewind torque', 'Method', 'Rewind torque abnormal', 'Check the rewind tension setting', 'P2 work instruction'),
        ('K-P2-003', 'P2', 'Slitting speed', 'Method', 'Slitting speed abnormal', 'Check the slitting speed setting', 'P2 work instruction'),
        ('K-P2-004', 'P2', 'Thickness diff', 'Measurement', 'Thickness difference across the width too large', 'Inspect the rubber wheel gasket', 'P2 work instruction'),
        ('K-P3-001', 'P3', 'pasteirontemp', 'Method', 'Paste iron temperature abnormal', 'Report the paste iron temperature fault', 'P3 work instruction'),
        ('K-P3-002', 'P3', 'blowirontemp', 'Method', 'Blow iron temperature abnormal', 'Report the blow iron temperature fault', 'P3 work instruction'),
        ('K-P3-003', 'P3', 'Burr', 'Measurement', 'Burr count above the limit', 'Inspect and replace the punch', 'P3 work instruction'),
    ]
    with (target / 'config/knowledge.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(['Knowledge_ID', 'Station_ID', 'Feature_Target', 'Issue_Category', 'Root_Cause_Description', 'Recommended_Action', 'Source_Ref'])
        writer.writerows(knowledge)
    features = {
        'P1': {'numerical': ['Actual Temp_C1', 'Actual Temp_C2', 'Actual Temp_C3', 'Line Speed(M/min)', 'Extruder Speed (rpm)'],
               'categorical': {'Man': [], 'Machine': ['P1.Machine_No.'], 'Material': ['P1.Material'], 'Method': [], 'Environment': [], 'Measurement': []},
               'target': '', 'id': 'Produce_No.'},
        'P2': {'numerical': ['Heat gun temperature', 'Rewind torque', 'Slitting speed', 'Thickness diff'],
               'categorical': {'Man': ['Quality inspection', 'Quality control'], 'Machine': ['Slitting machine', 'Winder number'], 'Material': [], 'Method': [], 'Environment': [], 'Measurement': ['P2.NG_code']},
               'target': '', 'id': 'Produce_No.'},
        'P3': {'numerical': ['pasteirontemp', 'blowirontemp', 'Burr'],
               'categorical': {'Man': [], 'Machine': ['P3.Machine_No.'], 'Material': [], 'Method': [], 'Environment': [], 'Measurement': ['P3.NG_code']},
               'target': 'Finish', 'id': 'Produce_No.'},
    }
    config = {
        'data_source': {
            'current_data': {'descriptive': 'data/current_daily.csv'},
            'baseline_data': {
                'descriptive': 'data/baseline.csv', 'diagnostic': '', 'prescriptive': 'known_base.json',
                'topology': 'config/topology.json', 'rag_knowledge': 'config/knowledge.csv', 'prompts': '', 'ng_code': 'config/ng_code.json',
            },
            'case_data': {'llm_records': 'cases/llm_records.jsonl', 'llm_error_records': 'cases/llm_error_records.jsonl'},
            'llm_setting': {'api_endpoint': ''},
            # builtin-hash needs no model download; switch to intfloat/multilingual-e5-large-instruct on a site that can fetch it.
            'rag_setting': {'builder_type': 'builtin-hash', 'db_path': 'rag/chroma', 'collection_name': 'demo_sops'},
        },
        'method': 'IQR Thresholds', 'mode': 'daily', 'serializer': 'UT', 'observer': 'All', 'feature': features,
        'datetime': [{'name': 'timestamp', 'format': '%Y%m%d', 'components': ['DayOfWeek', 'Month']}],
    }
    write_json(target / 'config/analysis_config.json', config)
    # the same configuration pointed at the complaint rows; use it with the Kit setting mode = complain
    complaint = json.loads(json.dumps(config))
    complaint['data_source']['current_data']['descriptive'] = 'data/complaint.csv'
    complaint['mode'] = 'complain'
    write_json(target / 'config/analysis_config_complaint.json', complaint)


if __name__ == '__main__':
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[1] / 'src/backend/app/analytical_four/demo_data'
    build(destination)
    print(f'demo data written to {destination}')
