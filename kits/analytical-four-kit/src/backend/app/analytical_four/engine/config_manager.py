from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json
from app.analytical_four.engine.data_manager.json_manager import JSONDataManager

class Method:
    IQR_THRESHOLDS = "IQR Thresholds"
    THREE_SIGMA = "3sigma"
    MIN_MAX = "min_max"

class Observer:
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    ALL = "All"

class Mode:
    DAILY = "daily"
    COMPLAIN = "complain"

@dataclass
class CurrentDataConfig:
    descriptive: str

@dataclass
class BaselineDataConfig:
    descriptive: str
    diagnostic: str
    prescriptive: str
    topology: str
    rag_knowledge: str
    prompts: str
    ng_code: str

@dataclass
class CaseDataConfig:
    llm_records: str
    llm_error_records: str

@dataclass
class LLMSettingConfig:
    api_endpoint: str

@dataclass
class RAGSettingConfig:
    builder_type: str
    db_path: str
    collection_name: str

@dataclass
class DataSourceConfig:
    current_data: CurrentDataConfig
    baseline_data: BaselineDataConfig
    case_data: CaseDataConfig
    llm_setting: LLMSettingConfig
    rag_setting: RAGSettingConfig

@dataclass
class FeatureConfig:
    numerical: List[str]
    categorical: Dict[str, List[str]] 
    target: str
    id: str
    
    @property
    def all_categorical_cols(self) -> List[str]:
        """
        獲取所有類別特徵（不區分類別組別）的唯一列表。
        """
        all_features = set()
        for features_list in self.categorical.values():
            all_features.update(features_list) 
            
        return list(all_features)

    def merge(self, other: 'FeatureConfig') -> 'FeatureConfig':
        """將另一個 FeatureConfig 合併到當前配置中，並回傳新的實例"""
        
        # 1. 合併數值特徵
        new_numerical = self.numerical + other.numerical
        
        # 2. 合併類別特徵 (深度合併)
        new_categorical = {k: v.copy() for k, v in self.categorical.items()}
        for cat_key, cat_list in other.categorical.items():
            if cat_key in new_categorical:
                new_categorical[cat_key].extend(cat_list)
            else:
                new_categorical[cat_key] = cat_list

        # 3. Target 與 ID (以後者覆蓋前者)
        new_target = other.target if other.target else self.target
        new_id = other.id if other.id else self.id

        return FeatureConfig(
            numerical=new_numerical,
            categorical=new_categorical,
            target=new_target,
            id=new_id
        )

@dataclass
class Config:
    data_source: DataSourceConfig 
    feature: Dict[str, FeatureConfig]
    datetime: List[Dict[str, Any]]
    method: str
    serializer: str
    observer: str
    mode: str
    
    @property
    def active_feature_config(self) -> FeatureConfig:
        """根據 observer 的設定，回傳最終要使用的 FeatureConfig 物件"""
        
        # 情況 1: 單一觀察者 (P1, P2, P3)
        if self.observer in self.feature:
            return self.feature[self.observer]
            
        # 情況 2: All (合併所有特徵)
        elif self.observer == "All":
            # 初始化一個空的 FeatureConfig
            merged_config = FeatureConfig(
                numerical=[], 
                categorical={
                    "Man": [], "Machine": [], "Material": [], 
                    "Method": [], "Environment": [], "Measurement": []
                }, 
                target="", 
                id=""
            )
            
            # 依序合併 P1, P2, P3...
            for stage_name, stage_config in self.feature.items():
                merged_config = merged_config.merge(stage_config)
            
            return merged_config
            
        else:
            raise ValueError(f"Unknown observer: {self.observer}")

class ConfigManager:
    def __init__(self, file_path: str):
        self._data_manager = JSONDataManager(file_path)
        self._config: Optional[Config] = None
        self.file_path = file_path

    def load_config(self) -> Optional[Config]:
        load_result = self._data_manager.load()
        if not load_result["success"]:
            print(f"Error loading config file: {load_result['message']}")
            self._config = None
            return None
        
        data = load_result["data"]
        try:
            data_source_data = data.get("data_source", {})
            
            # Use get directly as they are dictionaries in the json
            curr_data_dict = data_source_data.get("current_data", {})
            base_data_dict = data_source_data.get("baseline_data", {})
            case_data_dict = data_source_data.get("case_data", {})
            llm_setting_dict = data_source_data.get("llm_setting", {})

            rag_setting_dict = data_source_data.get("rag_setting")
            if rag_setting_dict is None:
                raise ValueError(
                    "Missing required config section: data_source.rag_setting"
                )
            required_rag_fields = ["builder_type", "db_path", "collection_name"]
            missing_rag_fields = [
                f for f in required_rag_fields if f not in rag_setting_dict
            ]
            if missing_rag_fields:
                raise ValueError(
                    f"Missing required data_source.rag_setting fields: "
                    f"{missing_rag_fields}"
                )

            current_data_config = CurrentDataConfig(
                descriptive=curr_data_dict.get("descriptive", "")
            )

            baseline_data_config = BaselineDataConfig(
                descriptive=base_data_dict.get("descriptive", ""),
                diagnostic=base_data_dict.get("diagnostic", ""),
                prescriptive=base_data_dict.get("prescriptive", ""),
                topology=base_data_dict.get("topology", ""),
                rag_knowledge=base_data_dict.get("rag_knowledge", ""),
                prompts=base_data_dict.get("prompts", ""),
                ng_code=base_data_dict.get("ng_code", "")
            )
            
            case_data_config = CaseDataConfig(
                llm_records=case_data_dict.get("llm_records", ""),
                llm_error_records=case_data_dict.get("llm_error_records", "")
            )

            llm_setting_config = LLMSettingConfig(
                api_endpoint=llm_setting_dict.get("api_endpoint", "")
            )

            rag_setting_config = RAGSettingConfig(
                builder_type=rag_setting_dict["builder_type"],
                db_path=rag_setting_dict["db_path"],
                collection_name=rag_setting_dict["collection_name"]
            )

            data_source_config = DataSourceConfig(
                current_data=current_data_config,
                baseline_data=baseline_data_config,
                case_data=case_data_config,
                llm_setting=llm_setting_config,
                rag_setting=rag_setting_config
            )
            
            feature_config_data_raw = data.get("feature", {})
            feature_configs = {}

            # Handle both single FeatureConfig (old style, if any) or Dict of FeatureConfigs
            # Assuming strictly new style based on request:
            for key, val in feature_config_data_raw.items():
                feature_configs[key] = FeatureConfig(
                    numerical=val.get("numerical", []),
                    categorical=val.get("categorical", {}),
                    target=val.get("target", ""),
                    id=val.get("id", "")
                )

            config_datetime = data.get("datetime", [])
            config_method = data.get("method", "IQR Thresholds")
            config_serializer = data.get("serializer", "UT")
            config_observer = data.get("observer", "P2")
            config_mode = data.get("mode", "daily")
            # Default to P2 if missing, or maybe ""

            self._config = Config(
                data_source=data_source_config,
                feature=feature_configs,
                datetime=config_datetime,
                method=config_method,
                serializer=config_serializer,
                observer=config_observer,
                mode=config_mode
            )
            
            # 邊界檢查
            valid_methods = [
                Method.IQR_THRESHOLDS, 
                Method.THREE_SIGMA, 
                Method.MIN_MAX
            ]
            if config_method not in valid_methods:
                print(f"Warning: Method '{config_method}' from config is invalid. Using 'IQR Thresholds'.")
                self._config.method = Method.IQR_THRESHOLDS
            
            # 觀察站點檢查
            valid_observers = [
                Observer.P1,
                Observer.P2,
                Observer.P3,
                Observer.ALL
            ]
            if config_observer not in valid_observers:
                print(f"Warning: Observer '{config_observer}' from config is invalid. Using 'All'.")
                self._config.observer = Observer.ALL
            
            # 模式檢查
            valid_modes = [
                Mode.DAILY,
                Mode.COMPLAIN
            ]
            if config_mode not in valid_modes:
                print(f"Warning: Mode '{config_mode}' from config is invalid. Using 'daily'.")
                self._config.mode = Mode.DAILY
                
            return self._config
        except TypeError as e:
            print(f"Error parsing config structure: {e}")
            self._config = None
            return None

    @property
    def config(self) -> Optional[Config]:
        """屬性：獲取當前已載入的配置物件，如果尚未載入，則嘗試載入。"""
        if self._config is None:
            return self.load_config()
        return self._config