import json
import pandas as pd
import numpy as np
import logging

from app.analytical_four.engine.analysis.models import CorrelationComparisonResults



class CorrelationAnalyzer:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}")

    def prepare_df(self, data: pd.DataFrame, selected_columns: list = [], strict: bool = False):
        """準備資料框架"""
        self.logger.debug("準備資料框架。")
        df = pd.DataFrame(data)
        if selected_columns:
            self.logger.debug(f"選擇欄位: {selected_columns}")
            missing = [c for c in selected_columns if c not in df.columns]

            if missing:
                if strict:
                    raise ValueError(f"欄位不存在: {missing}")
                else:
                    self.logger.warning(f"以下欄位不存在並已忽略: {missing}")
                    selected_columns = [c for c in selected_columns if c in df.columns]
                return df[selected_columns]

        self.logger.debug("未選擇任何欄位，返回所有欄位。")
        return df

    def compare_corr(self, abnormal_df: pd.DataFrame, normal_df: pd.DataFrame, method: str = "pearson"):
        """比較兩個資料框架的相關性差異"""
        self.logger.debug(f"比較相關性，方法: {method}")
        if method not in ["pearson", "spearman", "kendall"]:
            self.logger.error(f"不支援的相關性方法: {method}")
            raise ValueError("Unsupported correlation method.")
        
        try:
            self.logger.debug("計算相關性。")
            # 各自計算
            corr_normal = normal_df.corr(method=method)
            corr_abnormal = abnormal_df.corr(method=method)
            
            # 計算差異
            delta_corr = corr_abnormal - corr_normal
            
            # 轉換 NaN -> None
            def df_to_dict_with_none(df: pd.DataFrame):
                # 先把 NaN 轉 None
                return df.replace({np.nan: None}).to_dict()
            
            corr_normal = df_to_dict_with_none(corr_normal)
            corr_abnormal = df_to_dict_with_none(corr_abnormal)
            delta_corr = df_to_dict_with_none(delta_corr)
            
            self.logger.debug("相關性計算完成。")
            return CorrelationComparisonResults(
                corr_normal=corr_normal,
                corr_abnormal=corr_abnormal,
                delta_corr=delta_corr,
                method=method # 將方法名稱也記錄在 Class 內
            )
        except Exception as e:
            self.logger.error(f"計算相關性時發生錯誤: {e}")
            raise

    def get_feature_dependence(self, target_fea: str, corr_matrix: dict, top_k: int = 10):
        """取得目標特徵的相關性依賴排序"""
        self.logger.debug(f"取得特徵依賴，目標特徵: {target_fea}, 前K名: {top_k}")
        if target_fea not in corr_matrix:
            self.logger.error(f"目標特徵 {target_fea} 不在相關矩陣中。")
            raise ValueError(f"Target feature {target_fea} not in correlation matrix.")
        try:
            self.logger.debug("計算特徵依賴。")
            target_corr = {
            k: v for k, v in corr_matrix.items()
            if k != target_fea and v is not None
            }
            
            # 分開正負相關
            positive_corrs = {k: v for k, v in target_corr.items() if v > 0}
            negative_corrs = {k: v for k, v in target_corr.items() if v < 0}

            # 排序：由大到小（正相關），由小到大（負相關，但取絕對值排序）
            positive_sorted = [k for k, _ in sorted(positive_corrs.items(), key=lambda x: x[1], reverse=True)]
            negative_sorted = [k for k, _ in sorted(negative_corrs.items(), key=lambda x: x[1])]

            return {
                target_fea: {
                    "positive": positive_sorted,
                    "negative": negative_sorted
                }
            }
        except Exception as e:
            self.logger.error(f"取得特徵依賴時發生錯誤: {e}")
            raise



if __name__ == "__main__":
    with open("../../test_output/preprocesser/test_hardware_info.json", "r", encoding="utf-8") as f:
        preprocesser_data = json.load(f)
    
    with open("../../test_output/preprocesser/test_hardware_info_error.json", "r", encoding="utf-8") as f:
        preprocesser_data_error = json.load(f)
    
    selected_cols = [
        "cpu_usage",
        "cpu_temperature",
        "memory_percent",
        "memory_total",
        "memory_used",

    ]
    
    analyzer = CorrelationAnalyzer()
    
    df1 = analyzer.prepare_df(preprocesser_data_error, selected_cols)