import pandas as pd
import logging
from typing import Optional, Any

class CategoricalAnalyzer:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.logger.debug("Initializing CategoricalAnalyzer")
    

    def analyze_target_distribution_by_category(self,
                data: pd.DataFrame,
                target_col: str,
                categorical_cols: list[str],
                normalize: bool = True, 
                fillna_value: Optional[Any] = '__MISSING__') -> dict:
        
        # 建立專屬 logger
        logger = logging.getLogger(f"{__name__}.CategoricalAnalyzer")
        logger.debug("Start analyzing categorical features")
        
        # 基本檢查
        if target_col not in data.columns:
            raise ValueError(f"Target column '{target_col}' not found in data.")
        
        missing_in_df = [f for f in categorical_cols if f not in data.columns]
        if missing_in_df:
            raise ValueError(f"DataFrame missing columns: {missing_in_df}")

        result = {}

        try:
            self.logger.debug("start processing features")
            cols_to_use = list(set([target_col] + categorical_cols))
            df_working = data[cols_to_use].copy()

            # 確保 Target 轉為字串 (確保 JSON Key 為 "0", "1")
            df_working[target_col] = df_working[target_col].astype(str)

            for category in categorical_cols:
                if category == target_col:
                    continue

                if fillna_value is not None:
                    df_working[category] = df_working[category].fillna(fillna_value)

                # 確保 Feature Value 轉為字串 (確保 JSON Key 為 "Machine_1")
                df_working[category] = df_working[category].astype(str)

                # 計算各分類 (Category) 下的 Target 分佈 (Row-wise normalization)
                # Group by [category, target_col]
                grouped_counts = (
                    df_working.groupby([category, target_col])
                    .size()
                    .unstack(fill_value=0)
                )
                # Index = Feature Value (e.g., "0.32mm"), Columns = Target (e.g., "0", "1")

                # 計算統計量：總數 (Total) 與 Target="0" (Count_0)
                total_counts = grouped_counts.sum(axis=1)
                count_0 = grouped_counts['0'] if '0' in grouped_counts.columns else pd.Series(0, index=grouped_counts.index)

                # 若開啟 normalize，計算該「類別」下，各 Target 的佔比 (總和=1.0)
                if normalize:
                    grouped_output = grouped_counts.div(total_counts, axis=0)
                else:
                    grouped_output = grouped_counts

                # 轉為字典並注入統計資訊
                cat_dict = grouped_output.to_dict(orient="index")
                for k, v in cat_dict.items():
                    v['total_count'] = int(total_counts[k])
                    v['count_0'] = int(count_0[k])

                result[category] = cat_dict
                
                self.logger.debug(f"Completed analysis for feature: {category}")
            
            return result
        
        except Exception as e:
            self.logger.error(f"Error occurred while analyzing: {e}")
            raise
    

    def analyze_category_distribution_by_product_ids(
        self,
        data: pd.DataFrame,
        product_id_list: list[str],
        categorical_cols: list[str]
    ) -> dict:

        # ---------- 1. 驗證欄位 ----------
        missing_cols = [c for c in categorical_cols if c not in data.columns]
        if missing_cols:
            raise ValueError(f"Columns not found in data: {missing_cols}")

        if "Produce_No." not in data.columns:
            raise ValueError("Column 'Produce_No.' not found in data.")

        # ---------- 2. 建立完整類別空間（一次掃描） ----------
        categorical_values = {
            col: sorted(data[col].dropna().unique())
            for col in categorical_cols
        }

        # ---------- 3. 過濾目標資料 ----------
        df_filtered = data[data["Produce_No."].isin(product_id_list)]

        missing_ids = sorted(
            set(product_id_list) - set(df_filtered["Produce_No."].unique())
        )

        # ---------- 4. 計數（向量化） ----------
        total_count = len(df_filtered)

        value_percentages = {}

        for col, full_values in categorical_values.items():
            counts = (
                df_filtered[col]
                .value_counts()
                .reindex(full_values, fill_value=0)
            )

            distribution = {}
            for val, cnt in counts.items():
                if total_count > 0:
                    pct = round(cnt / total_count * 100, 2)
                else:
                    pct = 0.0

                distribution[val] = {
                    "count": int(cnt),
                    "percentage": pct
                }

            value_percentages[col] = {
                "total_count": int(total_count),
                "distribution": distribution
            }

        return value_percentages