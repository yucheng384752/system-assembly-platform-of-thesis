
import pandas as pd
import json
import numpy as np
import logging

from app.analytical_four.engine.analysis.models import CompareOutliersResults, FeatureImportanceResults, MergedFeatureScores

class Extractor:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}.Extractor")
    
    def extract_delta_corr(self, delta_corr: dict, threshold:float = 0.5) -> dict:
        """從 delta correlation 中提取高相關特徵對，並計算每個特徵的最高 delta correlation 分數。"""
        delta_corr_score = {}
        df = pd.DataFrame(delta_corr)
        self.logger.debug("開始提取 delta correlation 特徵")
        try:
            df = df.fillna(0) # 填補 NaN/None 為 0，避免 abs() 報錯
            df = df.abs()
            high_corr = df[df > threshold].stack()
            high_corr = high_corr[high_corr.index.get_level_values(0) != high_corr.index.get_level_values(1)]
            unique_pairs = {(min(a, b), max(a, b)): val for (a, b), val in high_corr.items()}
            
            feature_data = [
                {"Feature1": a, "Feature2": b, "DeltaCorr": val}
                for (a, b), val in unique_pairs.items()
            ]

            for item in feature_data:
                f1, f2, score = item["Feature1"], item["Feature2"], item["DeltaCorr"]
                # 更新 Feature1
                if f1 not in delta_corr_score or score > delta_corr_score[f1]:
                    delta_corr_score[f1] = score
                # 更新 Feature2
                if f2 not in delta_corr_score or score > delta_corr_score[f2]:
                    delta_corr_score[f2] = score
            return delta_corr_score
        except Exception as e:
            self.logger.error(f"Error in extract_delta_corr: {e}")
            return {}

    def merge_delta_corr_with_loadings(
        self,
        delta_corr_score: dict,
        loadings: dict,
        alpha: float = 0.5,
        threshold: float = 0.8
        ) -> dict:
        """合併 delta correlation 分數與 PCA loadings，計算綜合特徵重要性分數，並選取重要特徵。"""
        self.logger.debug("開始合併 delta correlation 與 PCA loadings")
        
        try:
            # 正規化分數
            pca_values = np.array(list(loadings.values()))
            if len(pca_values) > 0:
                pca_norm = {k: v/np.max(pca_values) for k, v in loadings.items()}
            else:
                pca_norm = {}

            delta_values = np.array(list(delta_corr_score.values()))
            if len(delta_values) > 0:
                min_val = delta_values.min()
                max_val = delta_values.max()
                if max_val - min_val != 0:
                    delta_norm = {k: (v - min_val) / (max_val - min_val) for k, v in delta_corr_score.items()}
                else:
                    delta_norm = {k: 0.0 for k in delta_corr_score}
            else:
                delta_norm = {}
        
            # 合併分數
            feature_score = {}
            for f in set(list(loadings.keys()) + list(delta_corr_score.keys())):
                feature_score[f] = alpha * pca_norm.get(f,0) + (1 - alpha) * delta_norm.get(f,0)

            # 排序
            feature_score_sorted = dict(sorted(feature_score.items(), key=lambda x: x[1], reverse=True))
            # 將特徵和分數轉成 array
            features = np.array(list(feature_score_sorted.keys()))
            scores = np.array(list(feature_score_sorted.values()))

            # 計算累積分數比例
            total_score = np.sum(scores)
            percentages = (np.array(scores) / total_score) * 100
            cumsum_ratio = np.cumsum(percentages)  # 累積百分比

            # 轉換為字典
            percentages_dict = dict(zip(features, percentages))
            cumsum_ratio_dict = dict(zip(features, cumsum_ratio))

            threshold_percentage = threshold * 100 
            threshold_indices = np.where(cumsum_ratio >= threshold_percentage)[0]
                
            if len(threshold_indices) > 0:
                # 取到第一個超過閾值的特徵（包含該特徵）
                cutoff_index = threshold_indices[0] + 1  # +1 是因為要包含該特徵
                selected_features = features[:cutoff_index].tolist()
            else:
                # 如果沒有任何特徵達到閾值，選擇所有特徵
                selected_features = features.tolist()
            
            return FeatureImportanceResults(
                selected_features=selected_features,
                feature_scores=feature_score_sorted,
                delta_norm=delta_norm,
                pca_norm=pca_norm,
                all_features=features.tolist(),
                feature_pct=percentages_dict,
                cumsum_ratio=cumsum_ratio_dict
            )
        except Exception as e:
            self.logger.error(f"合併 delta correlation 與 PCA loadings 時發生錯誤: {e}")
            return {
                'selected_features': [],
                'feature_scores': {},
                "delta_norm": {},
                "pca_norm": {},
                'all_features': [],
                'percentages': {},
                'cumsum_ratio': {}
            }

    def merge_boundary_spe_with_t2(
        self,
        boundary: CompareOutliersResults,
        spe_with_t2: dict[str, dict],
        w_bound = 0.4,
        w_spe = 0.3,
        w_t2 = 0.3
        ) -> MergedFeatureScores:
        # 計算 boundary 出現的特徵數量
        feature_boundaries = {}
        for simple_id, bounds in boundary.results.items():
            for feature_name in bounds.keys():
                # 如果特徵已在字典中，加 1；否則初始化為 1
                feature_boundaries[feature_name] = feature_boundaries.get(feature_name, 0) + 1

        # 計算 spe t2 出現的特徵數量
        spe_feature_total = {}
        t2_feature_total = {}
        for simple_id, simple in spe_with_t2.items():
            is_t2 = simple.get("is_T2_Outlier", False)
            is_spe = simple.get("is_SPE_Outlier", False)
            # 只處理異常事件
            if not (is_t2 or is_spe):
                continue

            # T² 貢獻
            if is_t2:
                print("doing t2 feature accumulation...")
                for feat, info in simple.get("T2_feature", {}).items():
                    t2_feature_total[feat] = t2_feature_total.get(feat, 0.0) + info.get("score", 0.0)

            # SPE 貢獻
            if is_spe:
                print("doing spe feature accumulation...")
                for feat, info in simple.get("SPE_feature", {}).items():
                    spe_feature_total[feat] = spe_feature_total.get(feat, 0.0) + info.get("score", 0.0)

        # 計算最終合併分數
        all_features = set(list(feature_boundaries.keys()) + list(spe_feature_total.keys()) + list(t2_feature_total.keys()))
        
        output = MergedFeatureScores(
            boundary_count={},
            spe_score={},
            t2_score={},
            final_raw_score={}
        )

        # 4. 填充數據
        for f in all_features:
            b_val = feature_boundaries.get(f, 0)
            s_val = spe_feature_total.get(f, 0)
            t_val = t2_feature_total.get(f, 0)
            
            # 計算加權總分
            score = (w_bound * b_val) + (w_spe * s_val) + (w_t2 * t_val)
            
            output.boundary_count[f] = b_val
            output.spe_score[f] = s_val
            output.t2_score[f] = t_val
            output.final_raw_score[f] = score
        
        return output

# 畫圖
def plot_feature_importance(features, percentages, cumsum_ratio, threshold=0.8):
        import matplotlib.pyplot as plt
        
        # 如果輸入是字典，則根據 features 的順序轉換為列表
        if isinstance(percentages, dict):
            percentages_list = [percentages[f] for f in features]
        else:
            percentages_list = percentages
            
        if isinstance(cumsum_ratio, dict):
            cumsum_ratio_list = [cumsum_ratio[f] for f in features]
        else:
            cumsum_ratio_list = cumsum_ratio

        num_features = len(features)
        fig, ax1 = plt.subplots(figsize=(max(14, num_features * 0.4), 7))

        # 長條圖：各特徵貢獻量
        ax1.bar(features, percentages_list, color='skyblue', label='Feature Contribution (%)', alpha=0.7)
        ax1.set_ylabel("Feature Contribution (%)", fontsize=12, color='blue')
        ax1.tick_params(axis='y', labelcolor='blue')
        ax1.set_ylim(0, 100)  # 動態調整Y軸範圍


        # 第二軸：累積貢獻率折線
        ax2 = ax1.twinx()
        ax2.plot(features, cumsum_ratio_list, color='orange', marker='o', label='Cumulative Ratio')
        ax2.axhline(threshold * 100, color='r', linestyle='--', label=f'{int(threshold*100)}% threshold')
        ax2.set_ylabel("Cumulative Proportion", fontsize=12, color='orange')
        ax2.tick_params(axis='y', labelcolor='orange')
        ax2.set_ylim(0, 100)

        ax1.set_xticklabels(features, rotation=45, ha='right', fontsize=8)
        
        # 圖表設定
        plt.title("Feature Contribution and Cumulative Importance", fontsize=14)
        ax1.legend(loc='upper left')
        ax2.legend(loc='lower right')
        
        plt.tight_layout()
        plt.savefig("./feature_importance.png", dpi=300)
        plt.show()

if __name__ == "__main__":
    extractor = Extractor()

    # with open("../../data/raw/ut/september/correlation/delta_correlation.json", "r", encoding="utf-8") as f:
    #     delta_corr = json.load(f)

    # with open("../../data/raw/ut/september/contribution/loadings.json", "r", encoding="utf-8") as f:
    #     loadings =  json.load(f)
    # delta_corr = extractor.extract_delta_corr(delta_corr["delta_corr"])

    # loadings_dict = {item["feature"]: item["contribution"] for item in loadings}
    # results = extractor.merge_delta_corr_with_loadings(
    #     delta_corr, loadings_dict, alpha=0.6, threshold=0.8
    #     )
    
    # with open("../../data/raw/ut/september/extraction/selected_features.json", "w", encoding="utf-8") as f:
    #     json.dump(results, f, indent=4, ensure_ascii=False)

    # plot_feature_importance(results["all_features"], results["percentages"], results["cumsum_ratio"])

    with open("../../ut_contribution_analysis_result.json", "r", encoding="utf-8") as f:
        spe_t2_data = json.load(f)
    
    with open("../../ut_compare_outliers_result.json", "r", encoding="utf-8") as f:
        boundary_data = json.load(f)
    
    # print("Merging SPE and T² boundaries...", boundary_data)
    
    merged_boundaries = extractor.merge_boundary_spe_with_t2(
        boundary=boundary_data,
        spe_with_t2=spe_t2_data
        )