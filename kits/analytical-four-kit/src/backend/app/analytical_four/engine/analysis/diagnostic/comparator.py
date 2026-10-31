from ast import Dict, List, Tuple
import logging
import math
import pandas as pd
from typing import Dict, Any, Tuple, List, Optional

from app.analytical_four.engine.analysis.models import DataFrameSummary, StatisticsSummary


class Comparator:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}.Comparator")

    def threshold_check(self, data, thresholds):
        """門檻值檢查"""
        self.logger.debug(f"檢查資料: {data}, 門檻: {thresholds}")
        if isinstance(data, bool):
            self.logger.debug(f"布林值檢查: {data}")
            return self._check_boolean_threshold(data, thresholds)
        elif isinstance(data, (int, float)):
            self.logger.debug(f"數值型別檢查: {data}")
            return self._check_numeric_threshold(data, thresholds)
        elif data is None or data in ("", "N/A"):
            self.logger.debug(f"無效資料檢查: {data}")
            return False
        elif isinstance(data, str):
            self.logger.debug(f"字串型別檢查: {data}")
            return data in thresholds
        elif isinstance(data, list):
            self.logger.debug(f"列表型別檢查: {data}")
            return self._check_list_threshold(data, thresholds)
        else:
            self.logger.error(f"不支援的資料型別: {type(data)}")
            raise TypeError(f"Unsupported data type: {type(data)}")

    def _check_boolean_threshold(self, data: bool, thresholds: list):
        return data in thresholds

    def _check_numeric_threshold(self, data: float, thresholds: list):
        return thresholds[0] <= data <= thresholds[1]

    def _check_list_threshold(self, data: list, thresholds: list):
        return len(data) >= thresholds[0]

    def shift_magnitude(self, data:dict, baseline:dict):
        """
        計算偏移量，包含零除錯誤處理
        """
        self.logger.debug("計算偏移量。")
        def safe_relative_calculation(current, base, metric_name="unknown"):
            """安全的相對偏移計算"""
            if base == 0:
                if current == 0:
                    return 0.0  # 兩者都是0，沒有變化
                else:
                    return None  # 從0變為非0，無法計算百分比 (改為 None)
            else:
                return (current - base) / base * 100
        
        try:
            # 計算平均值偏移
            mean_abs = data["mean"] - baseline["mean"]
            mean_rel = safe_relative_calculation(data["mean"], baseline["mean"], "mean")
        except KeyError as e:
            mean_abs = None
            mean_rel = None
        
        try:
            # 計算中位數偏移
            median_abs = data["median"] - baseline["median"]
            median_rel = safe_relative_calculation(data["median"], baseline["median"], "median")
        except KeyError as e:
            median_abs = None
            median_rel = None
        
        try:
            # 計算標準差偏移
            std_abs = data["std"] - baseline["std"]
            std_rel = safe_relative_calculation(data["std"], baseline["std"], "std")
        except KeyError as e:
            std_abs = None
            std_rel = None
        
        try:
            # 計算範圍偏移
            min_abs = data["min"] - baseline["min"]
            min_rel = safe_relative_calculation(data["min"], baseline["min"], "min")
                
            max_abs = data["max"] - baseline["max"]
            max_rel = safe_relative_calculation(data["max"], baseline["max"], "max")
        except KeyError as e:
            min_abs = None
            min_rel = None
            max_abs = None
            max_rel = None
        
        # 組建結果
        result = {
            "mean_shifts_absolute": mean_abs,
            "mean_shifts_relative": mean_rel,
            "median_shifts_absolute": median_abs,
            "median_shifts_relative": median_rel,
            "std_shifts_absolute": std_abs,
            "std_shifts_relative": std_rel,
            "range_shifts_min_absolute": min_abs,
            "range_shifts_max_absolute": max_abs,
            "range_shifts_min_relative": min_rel,
            "range_shifts_max_relative": max_rel,
        }
        self.logger.info("偏移量計算完成")
        return result

    def std_detect_outliers(self, data: float, mean: float, sample_std: float, threshold_z: float = 3) -> list:
        det_val = []
        self.logger.debug("進行標準差異常值檢測。")
        if sample_std == 0:
            z = 0
        else:
            for val in data:
                z = (val - mean) / sample_std
                if abs(z) > threshold_z:
                    det_val.append(val)
        self.logger.info(f"檢測到異常值: {det_val}")
        return det_val

    def iqr_detect_outliers(self, value: float, lower_bound: float, upper_bound: float):
        self.logger.debug("進行四分位距異常值檢測。")
        if value < lower_bound or value > upper_bound:
            self.logger.info(f"檢測到異常值: {value}")
            return True
        self.logger.info(f"未檢測到異常值: {value}")
        return False

    @staticmethod
    def calculate_range(stats: StatisticsSummary, method: str) -> Tuple[float, float]:
        try:
            if method == 'IQR Thresholds':
                # 使用統計字典中預設的 'bound' 欄位
                raw_min, raw_max = stats.bound[0], stats.bound[1]
                return min(raw_min, raw_max), max(raw_min, raw_max)
            
            elif method == '3sigma':
                # 使用 mean ± 3 * population_std 作為範圍
                mean = stats.mean
                std = stats.population_std
                if std is None:
                    # 如果標準備差缺失，可以視為無效或使用 min/max
                    raise ValueError("Cannot use 3sigma: 'population_std' is missing.")
                return mean - 3 * std, mean + 3 * std
            
            elif method == "min_max":
                # 使用數據集的 min 和 max 作為範圍
                return stats.min, stats.max
                
            else:
                raise ValueError(f"Unsupported outlier detection method: {method}")
        
        except KeyError as e:
            raise ValueError(f"Missing required key in stats dictionary for method '{method}': {e}")
        except Exception as e:
            # 處理 0.0/0.0 導致的數學錯誤 (例如 std=0 時的 mean/std 運算，但這裡的計算是乘法，應該安全)
            if math.isnan(stats['mean']):
                # 如果 mean 是 NaN，通常數據有問題
                raise ValueError("Stats data is invalid (e.g., mean is NaN).")
            raise e

    def check_outlier(
        self,
        data: pd.DataFrame, 
        stats: DataFrameSummary, 
        base_line: Dict[str, Any], 
        method: str, 
        id_feature: str,
        numerical_features: List[str]
    ) -> Dict[str, Dict[str, Any]]:

        comparison_results: Dict[str, Dict[str, Any]] = {}
        
        # 遍歷 DataFrame 的每一行
        for index, row in data.iterrows():
            sample_id = row.get(id_feature, f"row_{index}")
            current_outliers: Dict[str, Any] = {}
            
            # 遍歷所有數值特徵
            for feature in numerical_features:
                
                # 檢查特徵是否存在於當前行中
                if feature not in row:
                    continue
                    
                data_point = row[feature]
                
                # 確保數據點是數值
                if pd.isna(data_point) or not isinstance(data_point, (int, float)):
                    continue
                    
                # 1. 決定基準線範圍和來源
                min_bound: Optional[float] = None
                max_bound: Optional[float] = None
                source: str = method
                
                # 優先檢查 base_line (假設 base_line 是 {feature: [min, max]})
                if base_line and feature in base_line:
                    try:
                        min_bound, max_bound = base_line[feature]
                        min_bound = min(min_bound, max_bound) 
                        max_bound = max(min_bound, max_bound)
                        source = "Base Line"
                    except Exception as e:
                        # base_line 格式錯誤，回退到 stats
                        self.logger.warning(f"Base line for '{feature}' is invalid: {e}. Falling back to stats.")
                        pass

                # 如果 min_bound 仍為 None，則使用 stats 字典和 method 計算
                if min_bound is None and feature in stats.results:
                    try:
                        min_bound, max_bound = Comparator.calculate_range(stats.results[feature], method)
                        source = method
                    except ValueError as e:
                        self.logger.warning(f"Cannot calculate range for '{feature}' using {method}: {e}")
                        continue # 跳過無法計算範圍的特徵
                elif min_bound is None:
                    # 該特徵不在任何基準線中
                    continue
                    
                # 2. 執行檢查
                is_outlier = (data_point < min_bound) or (data_point > max_bound)
                
                # 3. 記錄結果
                if is_outlier:
                    
                    if data_point < min_bound:
                        message = f"Value {data_point} is below the {source} lower bound {min_bound}."
                    else:
                        message = f"Value {data_point} is above the {source} upper bound {max_bound}."
                        
                    current_outliers[feature] = {
                        "value": data_point,
                        "range": (min_bound, max_bound),
                        "source": source,
                        "message": message
                    }
            
            # 將結果附加到總結果字典
            if current_outliers:
                comparison_results[sample_id] = current_outliers
            else:
                comparison_results[sample_id] = {}
                
        return comparison_results