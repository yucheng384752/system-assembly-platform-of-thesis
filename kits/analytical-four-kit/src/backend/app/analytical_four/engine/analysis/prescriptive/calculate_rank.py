import json
from typing import Dict, Any, List
from ..models import PCAContributionResults, FeatureImportanceResults



class CalculateRank:
    def __init__(self):
        pass
    
    def _clip(self, value: float, min_v: float, max_v: float) -> float:
        return max(min_v, min(value, max_v))

    def _compute_x_factor(
        self,
        value: float, ucl: float, power: float = 1.0,
        min_x: float = 0.3, max_x: float = 2.0) -> float:
        """
        根據指標值與 UCL 計算風險調節係數 x
        """
        if ucl <= 0:
            return 1.0
        ratio = (value / ucl) ** power
        return self._clip(ratio, min_x, max_x)

    def rank_features_with_outlier_scaling(
        self,
        event_id: str,
        sample_data: Dict[str, Any],
        feature_scores: Dict[str, float],
        top_k: int = 5,
        epsilon: float = 0.01):
        
        results = {}
        
        weight_map = feature_scores

        t2 = sample_data.get("T2", 0.0)
        spe = sample_data.get("SPE", 0.0)
        # UCLs might not be in sample_data, defaulting to 1.0
        t2_ucl = sample_data.get("T2_UCL", 1.0)
        spe_ucl = sample_data.get("SPE_UCL", 1.0)
        
        x_t2 = self._compute_x_factor(t2, t2_ucl, power=1.0)
        x_spe = self._compute_x_factor(spe, spe_ucl, power=1.5)
        
        sample_result = {
            "x_T2": round(x_t2, 3),
            "x_SPE": round(x_spe, 3),
            "T2_feature": [],
            "SPE_feature": []
        }
        
        for metric, x_factor in [("T2_feature", x_t2),("SPE_feature", x_spe)]:
            features = sample_data.get(metric, {})
            if not features:
                continue

            all_features: List[Dict[str, Any]] = []

            for feature_name, details in features.items():
                raw_score = details.get("score", 0.0)
                weight = weight_map.get(feature_name, 0.0)

                effective_weight = max(weight / 100.0, epsilon)

                final_score = x_factor * raw_score * effective_weight

                all_features.append({
                    "feature": feature_name,
                    "raw_score": raw_score,
                    "global_weight(%)": weight,
                    "x_factor": round(x_factor, 3),
                    "final_score": final_score,
                    "original_rank": details.get("rank")
                })

            all_features.sort(key=lambda x: x["final_score"], reverse=True)
            ranked_list = all_features[:top_k]
            
            ranked_list.sort(key=lambda x: x["final_score"], reverse=True)

            prev_score = None
            current_rank = 0
            for idx, item in enumerate(ranked_list, start=1):
                score_val = float(item.get("final_score", 0.0) or 0.0)
                if prev_score is None or score_val != prev_score:
                    current_rank = idx
                item["final_rank"] = current_rank
                prev_score = score_val

            sample_result[metric] = ranked_list
        results[event_id] = sample_result

        return results
        
        