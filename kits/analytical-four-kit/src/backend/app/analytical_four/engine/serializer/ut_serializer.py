import logging
import pandas as pd
from typing import Any, Dict, List, Optional
from .base_serializer import BaseSerializer

class UTSerializer(BaseSerializer):

    def __init__(self):
        super().__init__("UT")
        self.logger = logging.getLogger(__name__)
    

    def process_context(self, product_id:str, data:pd.DataFrame):
        # 處理 context 部分的資料邏輯
        self.logger.debug(f"處理 context，產品: {product_id}")

        def safe_get(row_obj, col_name, as_type=str):
            if col_name not in row_obj.columns:
                return None
            val = row_obj[col_name].values[0]
            if pd.isna(val):
                return None
            try:
                return as_type(val)
            except Exception:
                return None

        row = None
        # 1. 嘗試透過 Produce_No. 欄位搜尋
        if "Produce_No." in data.columns:
            matches = data.loc[data["Produce_No."] == product_id]
            if not matches.empty:
                row = matches
        if "Semi_produce_No."in data.columns:
            matches = data.loc[data["Semi_produce_No."] == product_id]
            if not matches.empty:
                row = matches
        if "Lot_No." in data.columns:
            matches = data.loc[data["Lot_No."] == product_id]
            if not matches.empty:
                row = matches
        
        # 2. 嘗試透過 Index 搜尋 (若 product_id 為 row_X 格式)
        if row is None and product_id.startswith("row_"):
            try:
                idx_val = int(product_id.split("_")[1])
                if idx_val in data.index:
                    row = data.loc[[idx_val]]
            except (ValueError, IndexError):
                pass
        
        # 若仍找不到 row，回傳全 None 的結構
        if row is None:
            self.logger.warning(f"找不到產品編號 {product_id} 的資料")
            return {
                "Produce_No.": None,
                "Lot_No.": None,
                "project_timestamp": None,
                "P1.Machine_No.": None,
                "Semi_No.": None,
                "Material": None,
                "Slitting date": None,
                "Slitting machine": None,
                "Winder number": None,
                "Quality inspection": None,
                "Quality control": None,
                "P3.Machine_No.": None,
                "P2.NG_code": None,
                "P3.NG_code": None,
            }

        context = {
            "Produce_No.": safe_get(row, "Produce_No.") or product_id,
            "Semi_produce_No.": safe_get(row, "Semi_produce_No."),
            "project_timestamp":  safe_get(row, "timestamp"),
            "P1.Machine_No.": safe_get(row, "P1.Machine_No."),
            "Material": safe_get(row, "P1.Material"),
            "Slitting date": safe_get(row, "Slitting date"),
            "Slitting machine": safe_get(row, "Slitting machine"),
            "Winder number": safe_get(row, "Winder number", int),
            "Quality inspection": safe_get(row, "Quality inspection"),
            "Quality control": safe_get(row, "Quality control"),
            "P3.Machine_No.": safe_get(row, "P3.Machine_No."),
            "P2.NG_code": safe_get(row, "P2.NG_code"),
            "P3.NG_code": safe_get(row, "P3.NG_code"),
        }
        return context

    def process_detected_by_IQR(self, data:dict):
        self.logger.debug("處理 detected_by_IQR 部分的資料")
        # 處理 detected_by_IQR 部分的資料邏輯
        try:
            if not data:
                self.logger.warning("detected_by_IQR 資料為空")
                return {}
        except Exception as e:
            self.logger.error(f"處理 detected_by_IQR 資料時發生錯誤: {e}")
            return {}
        return data

    def _find_row_by_product_id(self, product_id: str, data: pd.DataFrame, id_col: str) -> Optional[pd.Series]:
        target = str(product_id)

        candidate_cols = [id_col, "Produce_No.", "Semi_produce_No.", "Lot_No."]
        for col in candidate_cols:
            if col in data.columns:
                matches = data.loc[data[col].astype(str) == target]
                if not matches.empty:
                    return matches.iloc[0]

        if target.startswith("row_"):
            try:
                idx_val = int(target.split("_")[1])
                if idx_val in data.index:
                    row = data.loc[idx_val]
                    if isinstance(row, pd.DataFrame):
                        return row.iloc[0]
                    return row
            except (ValueError, IndexError):
                return None

        return None

    def _safe_scalar(self, value: Any) -> Any:
        if pd.isna(value):
            return None
        if hasattr(value, "item"):
            try:
                return value.item()
            except Exception:
                return value
        return value

    def _merge_feature_entries(
        self,
        metric_name: str,
        ranked_list: List[Dict[str, Any]],
        raw_feature_map: Dict[str, Dict[str, Any]],
        csv_row: Optional[pd.Series],
    ) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []

        for ranked_item in ranked_list:
            if not isinstance(ranked_item, dict):
                continue

            feature = ranked_item.get("feature")
            if not feature:
                continue

            raw_item = raw_feature_map.get(feature, {})
            csv_measurement = None
            if csv_row is not None and feature in csv_row.index:
                csv_measurement = self._safe_scalar(csv_row[feature])

            merged.append(
                {
                    "feature": feature,
                    "feature_score": raw_item.get("score"),
                    "contribution_value": raw_item.get("raw"),
                    "csv_measurement": csv_measurement,
                    "weighted_raw_score": ranked_item.get("raw_score"),
                    "global_weight(%)": ranked_item.get("global_weight(%)"),
                    "x_factor": ranked_item.get("x_factor"),
                    "final_score": ranked_item.get("final_score"),
                    "original_rank": ranked_item.get("original_rank"),
                    "final_rank": ranked_item.get("final_rank"),
                    "metric": metric_name,
                }
            )

        return merged

    def process_SPE_T2_analysis(
        self,
        product_id: str,
        ranked_data: dict,
        raw_data: dict,
        csv_data: pd.DataFrame,
        id_col: str,
    ):
        self.logger.debug("處理 SPE_T2_analysis 部分的資料")
        # 處理 SPE_T2_analysis 部分的資料邏輯
        try:
            ranked_record = ranked_data.get(product_id)
            raw_record = raw_data.get(product_id)

            if ranked_record is None and raw_record is None:
                self.logger.warning(f"找不到產品編號 {product_id} 的 SPE/T2 資料")
                return {"Produce_No.": product_id, "error": "No SPE/T2 data found"}

            ranked_record = ranked_record or {}
            raw_record = raw_record or {}

            csv_row = self._find_row_by_product_id(product_id=product_id, data=csv_data, id_col=id_col)

            t2_ranked = ranked_record.get("T2_feature", [])
            spe_ranked = ranked_record.get("SPE_feature", [])
            t2_raw = raw_record.get("T2_feature", {})
            spe_raw = raw_record.get("SPE_feature", {})

            t2_merged = self._merge_feature_entries(
                metric_name="T2_feature",
                ranked_list=t2_ranked,
                raw_feature_map=t2_raw,
                csv_row=csv_row,
            )
            spe_merged = self._merge_feature_entries(
                metric_name="SPE_feature",
                ranked_list=spe_ranked,
                raw_feature_map=spe_raw,
                csv_row=csv_row,
            )

            result = {
                "summary": {
                    "T2": raw_record.get("T2"),
                    "SPE": raw_record.get("SPE"),
                    "T2_UCL": raw_record.get("T2_UCL"),
                    "SPE_UCL": raw_record.get("SPE_UCL"),
                    "is_T2_Outlier": raw_record.get("is_T2_Outlier"),
                    "is_SPE_Outlier": raw_record.get("is_SPE_Outlier"),
                    "x_T2": ranked_record.get("x_T2"),
                    "x_SPE": ranked_record.get("x_SPE"),
                },
                "T2_feature": t2_merged,
                "SPE_feature": spe_merged,
            }
            return result
        except Exception as e:
            self.logger.error(f"處理 SPE_T2_analysis 資料時發生錯誤: {e}")
            return {"Produce_No.": product_id, "error": str(e)}

    def process_PCA_and_correlation_analysis(self, data):
        self.logger.debug("處理 PCA_and_correlation_analysis 部分的資料")
        # 處理 PCA_and_correlation_analysis 部分的資料邏輯
        try:
            # data 現在是 feature_scores dict，直接返回
            if isinstance(data, dict):
                if not data:
                    self.logger.warning("feature_scores 資料為空")
                return data
            else:
                self.logger.warning("feature_scores 資料類型不正確")
                return {}
        except Exception as e:
            self.logger.error(f"處理 PCA_and_correlation_analysis 資料時發生錯誤: {e}")
            return {}