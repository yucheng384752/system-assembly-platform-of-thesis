from typing import Any, Dict, List, Union
import pandas as pd
import numpy as np
import json
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler, MinMaxScaler
import logging



class ContributionAnalyzer:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}")
    
    def calculate_simple_std(self, data:pd.DataFrame):
        """資料標準化"""
        self.logger.debug("資料標準化處理。")
        scaler = StandardScaler()
        try:
            std_df = pd.DataFrame(
                scaler.fit_transform(data),
                columns=data.columns
            )
            return std_df
        except Exception as e:
            self.logger.error(f"標準化處理失敗: {e}")
            raise e
    
    def fit_scaler(self, baseline_df: pd.DataFrame):
        scaler = StandardScaler()
        scaler.fit(baseline_df)
        return scaler

    def transform_with_scaler(self, df: pd.DataFrame, scaler: StandardScaler):
        return pd.DataFrame(
            scaler.transform(df),
            columns=df.columns
        )


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

    def PCA(self, df: pd.DataFrame, threshold: float = 0.95):
        """
        根據解釋率門檻 (threshold)，自動決定要取多少主成分。
        """
        self.logger.debug("進行主成分分析 (PCA)。")
        # 先做 full PCA
        pca_full = PCA()
        
        try:
            pca_full.fit(df)

            # 累積解釋率
            cum_var = np.cumsum(pca_full.explained_variance_ratio_)

            # 找到最小的 n_components，讓累積解釋率 >= threshold
            n_components = np.argmax(cum_var >= threshold) + 1
            
            # 再做一次 PCA，只取需要的主成分
            pca = PCA(n_components=n_components)
            transformed = pca.fit_transform(df)

            sel_var = pca.explained_variance_ratio_

            return pca, transformed, cum_var, sel_var
        except Exception as e:
            self.logger.error(f"PCA 分析失敗: {e}")
            raise e

    def loadings(self, df: pd.DataFrame, pca: PCA):
        # 計算主成分負荷量 (loadings)
        self.logger.debug("計算主成分負荷量 (loadings) 及特徵貢獻度。")
        try:
            loadings = pd.DataFrame(
                pca.components_.T,
                columns=[f"PC{i+1}" for i in range(pca.n_components_)],
                index=df.columns
            )
            
            # 每個特徵的貢獻度計算
            feature_contrib = np.sum((loadings**2) * pca.explained_variance_ratio_, axis=1)

            self.logger.debug(f"特徵貢獻度總和: {np.sum(feature_contrib)}")

            # 正規化成百分比
            feature_contrib = feature_contrib / np.sum(feature_contrib)
            
            # 將 contribution 加到 loadings DataFrame
            loadings["contribution"] = feature_contrib
            try:
                # 將 index 變成欄位
                df_loadings_reset = loadings.reset_index().rename(columns={"index": "feature"})
                
                # 轉成 JSON
                # json_loadings = df_loadings_reset.to_json(orient="records", force_ascii=False)
                return df_loadings_reset.to_dict(orient="records")
            except Exception as e:
                self.logger.error(f"轉換負荷量為 JSON 失敗: {e}")
        except Exception as e:
            self.logger.error(f"計算負荷量失敗: {e}")
            return None

    def _calculate_percent_contrib(self, feature_contrib_matrix: np.ndarray):
        """
        [私有方法] 將特徵貢獻度矩陣轉換為百分比貢獻度 (總和 100%)。
        (適用於 T2 (絕對值) 和 SPE (本身為正))
        """
        self.logger.debug("計算特徵貢獻度的百分比。")
        
        # 使用絕對值進行歸因 (T2 影響力包含正負，SPE 本身為正)
        abs_contrib = np.abs(feature_contrib_matrix)
            
        # 計算每個樣本 (行) 的總絕對貢獻度
        sum_contrib = np.sum(abs_contrib, axis=1, keepdims=True)
        
        # 避免除以零：如果總和接近零，則所有特徵貢獻皆為零
        percent_contrib = np.where(
            sum_contrib > 1e-10,
            (abs_contrib / sum_contrib) * 100,
            0.0
        )
        
        return percent_contrib

    def calculate_t2_limit(self, baseline_df: pd.DataFrame, pca: PCA, alpha: float = 0.05):
        """計算 Hotelling's T^2 的門檻值 (UCL)，使用您的 F 分佈公式。"""
        from scipy.stats import f
        self.logger.debug("計算 T^2 門檻值 (F-distribution)。")
        try:
            A = pca.n_components_    # 主成分數
            N = baseline_df.shape[0] # 基線樣本數
            
            if N <= A:
                self.logger.warning("基線樣本數過少 (N <= A)，T^2 門檻值無效。")
                return np.inf

            # UCL = (A * (N - 1) / (N - A)) * F_{1-alpha, A, N - A}
            ucl_t2 = (A * (N - 1) / (N - A)) * f.ppf(1 - alpha, A, N - A)
            
            return ucl_t2
        except Exception as e:
            self.logger.error(f"計算 T^2 門檻值失敗: {e}")
            return np.inf

    def calculate_spe_limit(self, baseline_df: pd.DataFrame, pca: PCA, alpha: float = 0.05):
            """
            計算 SPE (Q) 的門檻值 (UCL)，使用經驗百分位數法。
            """
            self.logger.debug("計算 SPE 門檻值 (Percentile Method)。")
            try:
                # 1. 計算基線數據的 SPE 值
                X_baseline = baseline_df.values
                T_baseline = pca.transform(X_baseline)
                P = pca.components_.T
                
                # X_hat = T P^T
                X_hat_baseline = T_baseline @ P.T
                
                # SPE = sum((X - X_hat)^2)
                spe_baseline = np.sum((X_baseline - X_hat_baseline)**2, axis=1)

                # 2. 應用百分位數
                percentile = 100 * (1 - alpha)
                ucl_spe = np.percentile(spe_baseline, percentile)
                
                return ucl_spe
            except Exception as e:
                self.logger.error(f"計算 SPE 門檻值失敗: {e}")
                return np.inf

    def hotelling_t2(self, df: pd.DataFrame, pca: PCA):
        # 計算 Hotelling's T^2 統計量
        self.logger.debug("計算 Hotelling's T^2 統計量。")
        try:
            transformed = pca.transform(df)
            
            n_components = transformed.shape[1]
            P = pca.components_[:n_components, :]
            
            Lambda_inv = np.diag(1 / pca.explained_variance_[:n_components])
            T2 = np.sum((transformed @ Lambda_inv) * transformed, axis=1)
            
            M = (transformed @ Lambda_inv) @ P
            t2_feature = M * df.values
            
            # 標準化 score (0~1)
            t2_feature_score = np.abs(t2_feature) / np.max(np.abs(t2_feature), axis=1, keepdims=True)
            
            # 計算 rank
            t2_feature_rank = np.argsort(np.argsort(-t2_feature_score, axis=1), axis=1) + 1  # 越大越重要
            
            return T2, t2_feature, t2_feature_score, t2_feature_rank
        except Exception as e:
            self.logger.error(f"計算 Hotelling's T^2 失敗: {e}")
            return None, None, None, None

    def SPE(self, df: pd.DataFrame, pca: PCA):
        """計算 SPE 統計量及各特徵貢獻度"""
        self.logger.debug("計算 SPE 統計量及各特徵貢獻度。")
        try:
            transformed = pca.transform(df)
            
            n_components = transformed.shape[1]
            
            P = pca.components_[:n_components, :]
            
            X_hat = transformed @ P
            
            SPE = np.sum((df.values - X_hat)**2, axis=1)

            SPE_feature = (df.values - X_hat)**2
            
            # 標準化 score (0~1)
            SPE_feature_score = SPE_feature / np.max(SPE_feature, axis=1, keepdims=True)
            
            # 計算 rank
            SPE_feature_rank = np.argsort(np.argsort(-SPE_feature_score, axis=1), axis=1) + 1
            
            return SPE, SPE_feature, SPE_feature_score, SPE_feature_rank
        except Exception as e:
            self.logger.error(f"計算 SPE 失敗: {e}")
            return None, None, None, None

    def construct_sample_diagnostics(
        self,
        sample_id_list: List[str],
        std_df: pd.DataFrame,
        # T2 相關參數
        t2: Union[List[float], np.ndarray],
        t2_ucl: float,
        t2_feature: Union[List, np.ndarray],
        t2_feature_score: Union[List, np.ndarray],
        t2_feature_rank: Union[List, np.ndarray],
        # SPE 相關參數
        spe: Union[List[float], np.ndarray],
        spe_ucl: float,
        spe_feature: Union[List, np.ndarray],
        spe_feature_score: Union[List, np.ndarray],
        spe_feature_rank: Union[List, np.ndarray],
        # 其他設定
        top_n: int = 10) -> Dict[str, Any]:
        """
        建構 PCA 樣本診斷報告，包含 T2/SPE 異常判斷與關鍵特徵貢獻度。
        """
        
        sample_diagnostics: Dict[str, Any] = {}
        std_cols = std_df.columns.tolist()

        # 內部 Helper: 用來提取 Top N 特徵，避免重複寫兩次相同的邏輯
        def _extract_top_features(
            raw_vals, 
            score_vals, 
            rank_vals, 
            columns, 
            limit
        ) -> Dict[str, Dict[str, Union[float, int]]]:
            return {
                col: {
                    "raw": float(raw),
                    "score": float(score),
                    "rank": int(rank)
                }
                for col, raw, score, rank in zip(columns, raw_vals, score_vals, rank_vals)
                if rank <= limit
            }

        # 主迴圈
        for i, produce_id in enumerate(sample_id_list):
            
            # 1. T2 / SPE 是否超過門檻值的判斷
            is_t2_outlier = float(t2[i]) > t2_ucl
            is_spe_outlier = float(spe[i]) > spe_ucl
            
            # 2. 建構 T2 Feature Dict
            t2_feature_dict = _extract_top_features(
                t2_feature[i], 
                t2_feature_score[i], 
                t2_feature_rank[i], 
                std_cols, 
                top_n
            )

            # 3. 建構 SPE Feature Dict
            spe_feature_dict = _extract_top_features(
                spe_feature[i], 
                spe_feature_score[i], 
                spe_feature_rank[i], 
                std_cols, 
                top_n
            )
            
            # 4. 組合最終結果
            sample_diagnostics[produce_id] = {
                "T2": float(t2[i]),
                "SPE": float(spe[i]),
                "T2_UCL": float(t2_ucl),
                "SPE_UCL": float(spe_ucl),
                "is_T2_Outlier": str(is_t2_outlier),   # 依照需求轉為字串
                "is_SPE_Outlier": str(is_spe_outlier), # 依照需求轉為字串
                "T2_feature": t2_feature_dict,
                "SPE_feature": spe_feature_dict
            }

        return sample_diagnostics


if __name__ == "__main__":
    with open("../../test_output/preprocesser/test_hardware_info.json", "r", encoding="utf-8") as f:
        preprocesser_data = json.load(f)
    
    with open("../../test_output/preprocesser/test_hardware_info_error.json", "r", encoding="utf-8") as f:
        preprocesser_error_data = json.load(f)
    
    analyzer = ContributionAnalyzer()
    
    selected_cols = [
        "cpu_usage",
        "cpu_temperature",
        "memory_percent",
        "memory_total",
        "memory_used",

    ]
    
    df1 = analyzer.prepare_df(preprocesser_data, selected_cols)
    std_df = analyzer.calculate_simple_std(df1)

    pca, transformed, cum_var, sel_var = analyzer.PCA(std_df)
    loadings_json = analyzer.loadings(std_df, pca)
    
    # with open("loadings_real.json", "w", encoding="utf-8") as f:
    #     f.write(loadings_json) 
        
    
    df2 = analyzer.prepare_df(preprocesser_data, selected_cols)
    std_df2 = analyzer.calculate_simple_std(df2)
    
    print(std_df2)
    
    t2, t2_feature_abs = analyzer.hotelling_t2(std_df2, pca)
    print("T2:", t2)
    
    spe, spe_feature = analyzer.SPE(std_df2, pca)
    print("SPE:", spe)
    print("SPE Feature:", spe_feature)
    
    results = []
    for ts, t2_val, spe_val, spe_feat in zip(preprocesser_error_data["timestamp"], t2, spe, spe_feature.values):
        result = {
            "timestamp": ts,
            "T2": float(t2_val),
            "SPE": float(spe_val),
            "SPE_feature": {col: float(v) for col, v in zip(spe_feature.columns, spe_feat)}
        }
        results.append(result)

    # 存成 JSON
    with open("monitoring_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=4)

