import json
import logging
from collections import Counter, defaultdict
from typing import Dict, List, Any, Tuple
import os



class NGDiagnosisSystem:
    def __init__(self, ng_code_path: str):
        self.logger = logging.getLogger(__name__)
        self.ng_code_db = self._load_json(ng_code_path)
        self.knowledge_base = {}

    def _load_json(self, path: str) -> Any:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Failed to load JSON from {path}: {e}")
            return []

    def train_daily_mode(self, serialized_results: List[Dict[str, Any]], observer: str = "P2") -> Dict[str, Any]:
        """
        Daily 模式優化：加入機台與收卷軸動態紀錄。
        """
        ng_stats = defaultdict(lambda: {
            "count": 0,
            "anomalies": Counter(),
            "t2_features": Counter(),
            "spe_features": Counter(),
            "P1.Machine_No.": Counter(),
            "Material": Counter(),
            "Slitting machine": Counter(),
            "Winder number": Counter(),
            "Quality inspection": Counter(),
            "Quality control": Counter(),
            "P3.Machine_No.": Counter()
        })

        if observer == "P2":
            ng_code_field = "P2.NG_code"
        else:
            ng_code_field = "P3.NG_code"

        def _feature_name(entry):
            if isinstance(entry, dict):
                return entry.get("feature")
            return entry
        
        for event in serialized_results:
            context = event.get("context", {})
            ng_code = context.get(ng_code_field)
            if not ng_code: continue

            ng_stats[ng_code]["count"] += 1
            
            # 1. 異常特徵統計
            iqr_data = event.get("detected_by_IQR", {})
            for feature in iqr_data.keys():
                ng_stats[ng_code]["anomalies"][feature] += 1

            # 2. 關鍵指標權重 (Top 3)
            ranked = event.get("ranked_features", {})
            for i, f in enumerate(ranked.get("T2_feature", [])[:3]):
                name = _feature_name(f)
                if name:
                    ng_stats[ng_code]["t2_features"][name] += (3 - i)
            for i, f in enumerate(ranked.get("SPE_feature", [])[:3]):
                name = _feature_name(f)
                if name:
                    ng_stats[ng_code]["spe_features"][name] += (3 - i)

            # 3. 環境統計 (V2.0)
            env_fields = [
                "P1.Machine_No.", "Material", "Slitting machine", 
                "Winder number", "Quality inspection", 
                "Quality control", "P3.Machine_No."
            ]
            INVALID_VALUES = {None, 0, "0", "null", "NULL", "nan", "NaN", "", "None", "none"}

            for field in env_fields:
                val = context.get(field)
                
                # 判斷是否為無效值 (包含字串清洗)
                is_invalid = (
                    val in INVALID_VALUES or 
                    (isinstance(val, str) and val.strip().lower() in {"null", "nan", "", "none"})
                )

                if not is_invalid:
                    ng_stats[ng_code][field][val] += 1

        # 建立知識庫
        self.knowledge_base = {}
        for ng_code, stats in ng_stats.items():
            total = stats["count"]
            
            def get_profile(counter_obj, total, decimals=2):
                # print("counter_obj:", counter_obj)
                sub_total = sum(counter_obj.values())
                if sub_total == 0 : 
                    return {}
                # 計算機率後進行 round
                return {k: round(v / sub_total, decimals) for k, v in counter_obj.items()}
            
            self.knowledge_base[ng_code] = {
                "sample_count": total,
                "anomaly_profile": get_profile(stats["anomalies"], total),
                "t2_profile": get_profile(stats["t2_features"], total),
                "spe_profile": get_profile(stats["spe_features"], total),
                "machine_profile": get_profile(stats["P1.Machine_No."], total),
                "slitting_machine_profile": get_profile(stats["Slitting machine"], total),
                "winder_profile": get_profile(stats["Winder number"], total),
                "quality_inspection_profile": get_profile(stats["Quality inspection"], total),
                "quality_control_profile": get_profile(stats["Quality control"], total),
                "p3_machine_profile": get_profile(stats["P3.Machine_No."], total)
            }
        return self.knowledge_base

    def predict_complain_mode(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Complain 模式優化：利用更多環境特徵（原料、收卷、質檢）來增強預測準確度。
        """
        if not self.knowledge_base:
            return {"error": "Knowledge base is empty."}

        # 提取當前事件特徵
        context = event.get("context", {})
        current_anomalies = set(event.get("detected_by_IQR", {}).keys())
        current_t2 = [
            f.get("feature") if isinstance(f, dict) else f
            for f in event.get("ranked_features", {}).get("T2_feature", [])[:3]
        ]
        current_spe = [
            f.get("feature") if isinstance(f, dict) else f
            for f in event.get("ranked_features", {}).get("SPE_feature", [])[:3]
        ]
        
        # 提取環境特徵
        current_env = {
            "machine_profile": str(context.get("P1.Machine_No.")),
            "slitting_machine_profile": str(context.get("Slitting machine")),
            "winder_profile": str(context.get("Winder number")),
            "quality_inspection_profile": str(context.get("Quality inspection")),
            "quality_control_profile": str(context.get("Quality control")),
            "p3_machine_profile": str(context.get("P3.Machine_No.")),
        }

        scores = {}
        for ng_code, profile in self.knowledge_base.items():
            # --- 1. 異常特徵機率評分 (40%) ---
            # 不再使用門檻值，改為計算該 NG 發生時出現這些異常的累積機率
            raw_anomaly_score = sum(profile["anomaly_profile"].get(feat, 0) for feat in current_anomalies)
            # TODO: 扣分機制
            # 找出哪些當前的異常是這個 profile 完全沒提過的
            unexplained_anomalies = [feat for feat in current_anomalies if feat not in profile["anomaly_profile"]]
            # 根據未解釋特徵的數量給予扣分，例如每個扣 5 分
            penalty_score = len(unexplained_anomalies) * 2.0

            # 正規化：以該 NG 歷史上「平均每筆資料出現的異常數」作為分母
            avg_anomalies = sum(profile["anomaly_profile"].values())
            anomaly_score = (raw_anomaly_score / avg_anomalies * 20) if avg_anomalies > 0 else 0
            # anomaly_score = min(40, anomaly_score)
            anomaly_score = max(0, anomaly_score - penalty_score)

            print(f"NG Code: {ng_code}, Raw Anomaly Score (before penalty): {raw_anomaly_score:.4f}")
            print("penalty_score:", penalty_score)
            print(f"NG Code: {ng_code}, Raw Anomaly Score: {raw_anomaly_score:.4f}, Normalized Anomaly Score: {anomaly_score:.2f}")
            print(f"NG Code: {ng_code}, Final Anomaly Score after penalty: {anomaly_score:.2f}")
        
            # --- 2. 關鍵指標吻合度 (30%) ---
            metrics_score = 0
            for feat in current_t2:
                # 使用平均權重進行平滑計分
                metrics_score += (profile["t2_profile"].get(feat, 0) / 3.0 * 25)
            for feat in current_spe:
                metrics_score += (profile["spe_profile"].get(feat, 0) / 3.0 * 25)
            # print(f"NG Code: {ng_code}, Metrics Score: {metrics_score:.2f}")
            metrics_score = min(30, metrics_score)
            
            print(f"NG Code: {ng_code}, T2 Score: {metrics_score * (25/30):.2f}, SPE Score: {metrics_score * (25/30):.2f}, Total Metrics Score: {metrics_score:.2f}")
            # print(f"NG Code: {ng_code}, Metrics Score: {metrics_score:.2f}")
            
            
            

            # --- 3. 環境與歷史關聯 (30%) ---
            # 綜合所有環境因子的吻合機率
            env_match_score = 0
            valid_env_count = 0
            
            # 定義各環境因子的權重 (可依重要性調整)
            env_weights = {
                "machine_profile": 1.2,          # P1機台影響極大
                "slitting_machine_profile": 1.0, # 分條機
                "winder_profile": 0.8,           # 收卷軸
                "quality_inspection_profile": 0.5, # 人員主觀因素
                "quality_control_profile": 0.5,
                "p3_machine_profile": 1.0
            }

            total_weight = 0
            for profile_key, current_val in current_env.items():
                if profile_key in profile:
                    # 如果當前值是無效的(如 "None", "null"), prob 應該給 0
                    if current_val in {"None", "null", "0", ""}:
                        prob = 0
                    else:
                        prob = profile[profile_key].get(current_val, 0)
                    weight = env_weights.get(profile_key, 1.0)
                    prob = profile[profile_key].get(current_val, 0)
                    env_match_score += prob * weight
                    total_weight += weight
            
            # 正規化環境分數
            final_env_prob = (env_match_score / total_weight) if total_weight > 0 else 0
            
            # 加入靜態知識庫輔助 (若動態資料不足)
            static_env_score = 0
            ng_def = next((item for item in self.ng_code_db if item["category"] == ng_code), None)
            if ng_def:
                for detail in ng_def.get("details", []):
                    if "分條" in detail.get("machine", "") and "Slitting" in str(current_env["slitting_machine_profile"]):
                        static_env_score = 0.2
            
            env_score = max(final_env_prob, static_env_score) * 30
            
            print("anomaly_score:", anomaly_score)
            print("metrics_score:", metrics_score)
            print("env_score:", env_score)

            total_score = anomaly_score + metrics_score + env_score
            scores[ng_code] = {
                "total_score": total_score,
                "breakdown": {"anomaly": round(anomaly_score, 2), "metrics": round(metrics_score, 2), "env": round(env_score, 2)}
            }

        # 取得最高分
        best_ng_code = max(scores, key=lambda k: scores[k]["total_score"])
        best_details = scores[best_ng_code]
        # 取得 root_cause 資訊
        ng_info = next((item for item in self.ng_code_db if item["category"] == best_ng_code), None)
        root_cause = ng_info["details"][0] if ng_info and ng_info["details"] else {}
        return {
            "prediction": {
                "suggested_ng_code": best_ng_code,
                "confidence_score": round(best_details["total_score"] / 100, 2),
                "score_breakdown": best_details["breakdown"]
            },
            "root_cause_analysis": {
                "machine": root_cause.get("machine"),
                "cause": root_cause.get("cause"),
                "action": root_cause.get("action")
            }
        }





# Main Execution for Testing
if __name__ == "__main__":
    # Paths
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ng_code_path = os.path.join(base_dir, "data/raw/ut/daily/ng_code.json")
    # serialized_in_path = os.path.join(base_dir, "data/raw/ut/daily/all_csv_result/ut_serialized_results.json")
    serialized_in_path = os.path.join(base_dir, "data/raw/ut/daily/ut_p2_serialized_results.json")
    complain_path = os.path.join(base_dir, "outputs/complain/ut_serialized_results.json")
    
    # Initialize
    system = NGDiagnosisSystem(ng_code_path)
    
    # Load Data
    try:
        with open(serialized_in_path, 'r', encoding='utf-8') as f:
            serialized_results = json.load(f)
    except FileNotFoundError:
        print(f"File not found: {serialized_in_path}")
        exit()
    print(f"Loaded {len(serialized_results)} serialized events for training.")
    try:
        with open(complain_path, 'r', encoding='utf-8') as f:
            complain_path_results = json.load(f)
    except FileNotFoundError:
        print(f"File not found: {complain_path}")
        exit()

    # 1. Train (Daily Mode)
    print("--- Training Knowledge Base (Daily Mode) ---")
    kb = system.train_daily_mode(serialized_results, observer="P2")
    with open("knowledge_base.json", 'w', encoding='utf-8') as f:
        json.dump(kb, f, indent=2, ensure_ascii=False)

    # 2. Predict (Complain Mode) - Test with the first event but pretend it has no label
    print("\n--- Predicting (Complain Mode) ---")
    count = 0
    results_output = {}
    if serialized_results:
        for i, event in enumerate(serialized_results):  # Test on first 5 events
            print(f"\n--- Test Event {i+1} ---")
            test_event = complain_path_results[i].copy()
            # print(f"Test Event: {test_event['context']}")
            # Remove true label for simulation
                # test_event["context"]["P2.NG_code"] = None # Not needed for logic validation but conceptually
            
            result = system.predict_complain_mode(test_event)
            if result["prediction"]["suggested_ng_code"] == test_event['context']['P2.NG_code']:
                result["actual_ng_code"] = test_event['context']['P2.NG_code']
            else:
                result["actual_ng_code"] = "Mismatch"
                count += 1
            results_output[test_event['context']['Produce_No.']] = result
            # with open("complain_mode_result.json", 'w', encoding='utf-8') as f:
            #     json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"Total mismatches: {count}")
    with open("complain_mode_results.json", 'w', encoding='utf-8') as f:
        json.dump(results_output, f, indent=2, ensure_ascii=False)

