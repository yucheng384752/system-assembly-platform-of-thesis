import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

@dataclass
class FeatureNode:
    """
    Represents a single feature (node) in the topology.
    """
    id: str
    name: str
    role: str  # e.g., "parameter", "outcome"
    level: int
    station_id: str
    attributes: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ProcessStation:
    """
    Represents a processing station in the environment.
    """
    id: str
    name: str
    order: int
    features: List[FeatureNode] = field(default_factory=list)

class Topology:
    """
    Represents the generated environment topology.
    """
    def __init__(self):
        self.stations: Dict[str, ProcessStation] = {}
        self.station_sequence: List[str] = []  # Station IDs in process order
        self.all_features: Dict[str, FeatureNode] = {}
        self.features_by_name: Dict[str, FeatureNode] = {}  # New: Lookup by name
        self.roles_definition: Dict[str, Any] = {}

    def get_features_by_station(self, station_id: str) -> List[FeatureNode]:
        if station_id in self.stations:
            return self.stations[station_id].features
        return []

    def get_feature(self, key: str) -> Optional[FeatureNode]:
        """
        Retrieves a feature by its ID or Name.
        """
        # Try ID first
        if key in self.all_features:
            return self.all_features[key]
        # Try Name
        if key in self.features_by_name:
            return self.features_by_name[key]
        return None
    
    def get_role_priority(self, role: str) -> int:
        """
        Returns sortable priority for a role based on roles_definition.
        Lower value = earlier in causal chain.
        """
        role_def = self.roles_definition.get(role)

        if role_def is None:
            # Unknown role → push to the end
            return 999

        # Use role-level if provided (lower = earlier)
        return role_def.get("level", 999)

    def get_features_ordered(self) -> List[FeatureNode]:
        """
        Returns all features ordered by station process order, then by level/role if applicable.
        """
        ordered_features = []
        for station_id in self.station_sequence:
            # Sort features within station by level (assuming lower level comes first/lower id)
            # You might want to customize the sort logic
            st_features = sorted(self.stations[station_id].features, key=lambda x: (x.level, x.role))
            ordered_features.extend(st_features)
        return ordered_features

class TopologyGenerator:
    """
    Generates a Topology object from a JSON configuration file.
    """
    def __init__(self, topology_setting: Dict[str, Any]):
        self.topology_setting = topology_setting
        # self.config_path = config_path
        # self.config = self._load_config()

    # def _load_config(self) -> Dict[str, Any]:
    #     with open(self.config_path, 'r', encoding='utf-8') as f:
    #         return json.load(f)

    def generate(self) -> Topology:
        """
        Builds the Topology object based on the loaded configuration.
        """
        topology = Topology()

        # 1. Parse Roles Definition
        topology.roles_definition = self.topology_setting.get('roles', {})

        # 2. Parse Stations (Process Flow)
        process_data = self.topology_setting.get('process', {})
        stations_data = process_data.get('stations', [])
        
        # Sort stations by 'order'
        sorted_stations_data = sorted(stations_data, key=lambda x: x.get('order', 0))

        for st_data in sorted_stations_data:
            st_id = st_data['id']
            station = ProcessStation(
                id=st_id,
                name=st_data['name'],
                order=st_data['order']
            )
            topology.stations[st_id] = station
            topology.station_sequence.append(st_id)

        # 3. Parse Features (Topology Structure)
        topology_data = self.topology_setting.get('topology', {})
        
        for station_id, content in topology_data.items():
            # Ensure the station exists in our process flow, otherwise create or warn
            # If the JSON topology has stations not in 'process', we might skip or add them.
            # Assuming 'process' defines the valid sequence.
            if station_id not in topology.stations:
                # Fallback: if topological station is not in process list, maybe log it or skip
                continue 

            features_list = content.get('feature', [])
            for f_data in features_list:
                feature = FeatureNode(
                    id=f_data['id'],
                    name=f_data['name'],
                    role=f_data['role'],
                    level=f_data['level'],
                    station_id=station_id,
                    attributes={k: v for k, v in f_data.items() if k not in ['id', 'name', 'role', 'level']}
                )
                
                # Bi-directional linking
                topology.all_features[feature.id] = feature
                topology.features_by_name[feature.name] = feature
                topology.stations[station_id].features.append(feature)

        return topology
    
    def serialized_feature_sources(self, serialized_dict):
        feature_sources = {}

        def _feature_name(entry):
            if isinstance(entry, dict):
                return entry.get("feature")
            return entry

        # --- IQR ---
        for f in serialized_dict.get("detected_by_IQR", {}):
            feature_sources.setdefault(f, []).append("IQR")

        # --- T2 ---
        for f in serialized_dict.get("ranked_features", {}).get("T2_feature", []):
            name = _feature_name(f)
            if name:
                feature_sources.setdefault(name, []).append("T2")

        # --- SPE ---
        for f in serialized_dict.get("ranked_features", {}).get("SPE_feature", []):
            name = _feature_name(f)
            if name:
                feature_sources.setdefault(name, []).append("SPE")
        return feature_sources
    
    def categorize_feature_sources(self, summary_dict:dict):
        feature_sources = {}
        
        for f in summary_dict.get("core_features", []):
            name = f["feature"]
            evidence = f.get("evidence", {})
            sources = []

            # 對每個 evidence 判斷是否有效，加入 sources
            if evidence.get("IQR"):
                sources.append("IQR")
            if evidence.get("T2_rank_freq", 0) > 0:
                sources.append("T2")
            if evidence.get("SPE_rank_freq", 0) > 0:
                sources.append("SPE")

            feature_sources[name] = sources
        return feature_sources

    def summarize_serialized(self, feature_sources, topology: Topology) -> Dict[str, Any]:
        """
        Summarizes features into a hierarchical structure grouped by causal layers.
        """
        feature_topology = []
        unique_stations = set()
        
        for feat_key, sources in feature_sources.items():
            feature_node = topology.get_feature(feat_key)
            if feature_node is None:
                continue 

            unique_stations.add(feature_node.station_id)
            st_name = topology.stations[feature_node.station_id].name if feature_node.station_id in topology.stations else "Unknown"

            feature_summary = {
                "id": feature_node.id,
                "name": feature_node.name,
                "role": feature_node.role,
                "level": feature_node.level,
                "station_id": feature_node.station_id,
                "station_name": st_name,
                "sources": list(set(sources))
            }
            feature_topology.append(feature_summary)
        
        # 1. Event Summary
        path_station_id = [sid for sid in topology.station_sequence if sid in unique_stations]
        
        # 2. Group by Layers
        layers_map = {}
        for feat in feature_topology:
            # Key for unique layer
            key = (feat["station_id"], feat["level"], feat["role"])
            
            if key not in layers_map:
                layers_map[key] = {
                    "station_id": feat["station_id"],
                    "station_name": feat["station_name"],
                    "level": feat["level"],
                    "role": feat["role"],
                    "features": []
                }
            
            layers_map[key]["features"].append({
                "id": feat["id"],
                "name": feat["name"],
                "sources": feat["sources"]
            })
            
        # 3. Sort Layers
        station_index = {st: idx for idx, st in enumerate(topology.station_sequence)}
        
        sorted_layers_data = sorted(
            layers_map.values(),
            key=lambda l: (
                station_index.get(l["station_id"], 999),
                topology.get_role_priority(l["role"]),
                l["level"] 
            )
        )

        formatted_layers = []
        for l_data in sorted_layers_data:
            station_obj = topology.stations.get(l_data["station_id"])
            order = station_obj.order if station_obj else 0
            
            meaning = f"{l_data['station_name']} - Level {l_data['level']} {l_data['role']}"
            
            formatted_layers.append({
                "station_id": l_data["station_id"],
                "station_order": order,
                "level": l_data["level"],
                "role": l_data["role"],
                "layer_meaning": meaning, 
                "features": l_data["features"]
            })

        result = {
            "event_summary": {
                "path_station_id": path_station_id,
                "total_anomalies": len(feature_topology)
            },
            "causal_layers": {
                "layers": formatted_layers
            }
        }
        
        return result



if __name__ == "__main__":
    # Example usage
    with open("ut_DAG.json", 'r', encoding='utf-8') as f:
        topology_setting = json.load(f)
    generator = TopologyGenerator(topology_setting)
    topology = generator.generate()

    # Print out the ordered features
    for feature in topology.get_features_ordered():
        print(f"Feature ID: {feature.id}, Name: {feature.name}, Station: {feature.station_id}, Role: {feature.role}")
        
    serialized_dict = {
        "event_id": "53a9279f-b2d4-4023-8f9c-33a9bde2694f",
        "event_date": "2026-01-13T08:29:41.850406+00:00",
        "context": {
            "Produce_No.": "row_19",
            "Lot_No.": None,
            "lot": None,
            "project_timestamp": None,
            "P1.Machine_No.": None,
            "Semi_No.": None,
            "Material": None,
            "Slitting date": "20250807_16_00",
            "Slitting machine": "1",
            "Winder number": 20,
            "Quality inspecrion": "ronie",
            "Quality control": "ling",
            "P3.Machine_No.": None
        },
        "detected_by_IQR": {
            "Appearance": {
                "value": 0,
                "range": [
                    1.0,
                    1.0
                ],
                "source": "IQR Thresholds",
                "message": "Value 0 is below the IQR Thresholds lower bound 1.0."
            },
            "rough edge": {
                "value": 0,
                "range": [
                    1.0,
                    1.0
                ],
                "source": "IQR Thresholds",
                "message": "Value 0 is below the IQR Thresholds lower bound 1.0."
            }
        },
        "ranked_features": {
            "T2_feature": [
                "Semi-finished impedance",
                "Thicknessss High(μm)",
                "Thicknessss Low(μm)",
                "Board Width(mm)",
                "Meters completed"
            ],
            "SPE_feature": [
                "Board Width(mm)",
                "Rubber wheel gasket thickness (in)",
                "Rubber wheel gasket thickness (out)",
                "Semi-finished impedance",
                "Meters completed"
            ]
        }
    }
    
    summary_dict = {
        "summary_id": "827c408a-e931-4e00-966f-acde03e0403e",
        "analysis_dimension": "Slitting machine",
        "sample_count": 16,
        "event_ids": [
            "240a74a7-6472-409d-9c77-6ab7cd928193",
            "8c2e2153-2e93-4b9c-8faa-449df0bf0525",
            "81144c21-90c0-43f6-b13f-2a59e8d87635",
            "e32a83a6-2344-4ed0-9723-5a42ed2369e5",
            "64ba25be-bc70-4277-8dd2-93b24d93ac04",
            "2b786626-2f77-4d3a-ab1e-9e98cd5fd0fb",
            "4516cea0-50ac-4fc1-9070-95325406daeb",
            "39a03393-617e-4b8f-9bc8-0af40e096c25",
            "4ebabc9b-fc6c-4b90-802f-b32c71ff5d4c",
            "ef36bfc1-44e2-402c-8d55-a82bc10e5fee",
            "15ee5594-5e22-4c14-9370-11a65617e74c",
            "a6c169f4-e3ac-4525-9090-a4b4cc9cc16e",
            "46a87cd4-656a-4125-864b-4fc6c168d88e",
            "46c1d2e0-6690-4d7b-a8b2-802251e73cf5",
            "ff83a0d9-ccdb-4fda-9a9d-bf1eed3dac1a",
            "9214805a-e074-4cbd-b5f6-dda97345694a"
        ],
        "context": {
            "Slitting machine": "1"
        },
        "core_features": [
            {
                "feature": "Appearance",
                "evidence": {
                    "IQR": True,
                    "SPE_rank_freq": 0.0,
                    "T2_rank_freq": 0.0
                }
            },
            {
                "feature": "rough edge",
                "evidence": {
                    "IQR": True,
                    "SPE_rank_freq": 0.0,
                    "T2_rank_freq": 0.0
                }
            },
            {
                "feature": "Meters completed",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.5,
                    "T2_rank_freq": 1.0
                }
            },
            {
                "feature": "Board Width(mm)",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.94,
                    "T2_rank_freq": 0.94
                }
            },
            {
                "feature": "Semi-finished impedance",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.25,
                    "T2_rank_freq": 0.75
                }
            },
            {
                "feature": "Thicknessss High(μm)",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.5,
                    "T2_rank_freq": 0.75
                }
            },
            {
                "feature": "Thickness diff",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.0,
                    "T2_rank_freq": 0.62
                }
            },
            {
                "feature": "Thicknessss Low(μm)",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 0.81,
                    "T2_rank_freq": 0.56
                }
            },
            {
                "feature": "Rubber wheel gasket thickness (in)",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 1.0,
                    "T2_rank_freq": 0.38
                }
            },
            {
                "feature": "Rubber wheel gasket thickness (out)",
                "evidence": {
                    "IQR": False,
                    "SPE_rank_freq": 1.0,
                    "T2_rank_freq": 0.0
                }
            }
        ]
    }
    
    serialized_feature_sources = generator.serialized_feature_sources(serialized_dict)
    feature_sources = generator.categorize_feature_sources(summary_dict)
    summary = generator.summarize_serialized(feature_sources, topology)




