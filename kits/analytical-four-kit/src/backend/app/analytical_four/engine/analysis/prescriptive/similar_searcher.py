import json
from datetime import datetime

class SimilarSearcher:
    def __init__(self):
        # 如果有需要，可以在這裡預存 case_base，但目前我們選擇從外部傳入
        pass

    def weighted_similarity(self, new_record: dict, case: dict):
        # ... (保持不變，略過以節省篇幅) ...
        new_feat = set(new_record["summary"]["anomaly_features"])
        case_feat = set(case["summary"]["anomaly_features"])
        union_feat = new_feat | case_feat
        feat_score = len(new_feat & case_feat) / len(union_feat) if union_feat else 0.0

        new_sop = set(new_record["summary"]["sop_keys"])
        case_sop = set(case["summary"]["sop_keys"])
        union_sop = new_sop | case_sop
        sop_score = len(new_sop & case_sop) / len(union_sop) if union_sop else 0.0

        ns = new_record["diagnosis_results"]["score_breakdown"]
        cs = case["diagnosis_results"]["score_breakdown"]
        score_diff = (abs(ns["anomaly"] - cs["anomaly"]) / 40 + abs(ns["metrics"] - cs["metrics"]) / 30 + abs(ns["env"] - cs["env"]) / 30) / 3
        score_sim = max(0.0, 1.0 - score_diff)

        new_machine = new_record["summary"]["categorical"].get("Slitting machine")
        case_machine = case["summary"]["categorical"].get("Slitting machine")
        machine_score = float(new_machine == case_machine)

        ng_score = float(new_record["diagnosis_results"]["suggested_ng_code"] == case["diagnosis_results"]["suggested_ng_code"])

        total = (feat_score * 0.30 + sop_score * 0.20 + score_sim * 0.20 + machine_score * 0.20 + ng_score * 0.10)

        return {
            "total": round(total, 4),
            "feat_overlap": round(feat_score, 4),
            "sop_overlap": round(sop_score, 4),
            "score_sim": round(score_sim, 4),
            "machine_match": bool(machine_score),
            "ng_match": bool(ng_score),
            "overlap_feat_ids": sorted(new_feat & case_feat),
            "overlap_sop_keys": sorted(new_sop & case_sop),
        }

    def find_similar_cases(
        self,
        new_record: dict,
        case_base: list,  # 改為接收資料清單
        top_n: int = 3,
        min_score: float = 0.3,
        require_same_machine: bool = False,
    ) -> tuple:
        """
        不再負責文件讀取，專注於相似度運算
        """
        excluded = {"no_overlap": 0, "unconfirmed": 0, "low_score": 0, "machine_mismatch": 0}
        
        if not case_base:
            return [], excluded

        results = []
        new_feat = set(new_record["summary"]["anomaly_features"])
        new_sop = set(new_record["summary"]["sop_keys"])
        new_categorical= new_record["summary"]["categorical"]

        print(f"\n── Step 1 相似度搜尋 event={new_record['event_id'][:8]} feat={sorted(new_feat)} ──")
        for case in case_base:
            # 排除未確認（入庫條件：confirmed_ng 不為 null）
            if not case["feedback"].get("confirmed_ng"):
                excluded["unconfirmed"] += 1
                continue

            # 第一層過濾：特徵或 SOP 至少一個重疊
            case_feat = set(case["summary"]["anomaly_features"])
            case_sop = set(case["summary"]["sop_keys"])
            if not (new_feat & case_feat) and not (new_sop & case_sop):
                excluded["no_overlap"] += 1
                continue

            # 可選：機台限制
            if require_same_machine:
                is_match = all(case["summary"]["categorical"].get(key) == val for key, val in new_categorical.items())
                if not is_match:
                    excluded["machine_mismatch"] += 1
                    continue

            # 第二層：加權相似度
            sim = self.weighted_similarity(new_record, case)

            # was_correct=False 的案例降權 0.7
            was_correct = case.get("error_analysis", {}).get("was_correct")
            raw_total = sim["total"]
            final_total = round(raw_total * 0.7, 4) if was_correct is False else raw_total
            sim = {**sim, "total": final_total, "raw_total": raw_total}

            penalty_note = f" (降權 0.7，raw={raw_total})" if was_correct is False else ""
            print(
                f"  [Step1] {case['event_id'][:8]}  confirmed_ng={case['feedback']['confirmed_ng']}"
                f"  total={final_total}{penalty_note}"
                f"  feat={sim['feat_overlap']}  sop={sim['sop_overlap']}"
                f"  score_sim={sim['score_sim']}  machine={sim['machine_match']}"
            )

            if final_total < min_score:
                excluded["low_score"] += 1
                continue

            results.append({
                "rank": 0,
                "event_id": case["event_id"],
                "similarity": sim,
                "confirmed_ng": case["feedback"]["confirmed_ng"],
                "was_correct": was_correct,
                "actual_cause": case["feedback"]["actual_cause"],
                "machine": case["summary"]["categorical"].get("Slitting machine"),
            })

        results.sort(key=lambda x: x["similarity"]["total"], reverse=True)
        for i, r in enumerate(results[:top_n], 1):
            r["rank"] = i

        return results[:top_n], excluded

    def find_error_hints(
        self,
        new_record: dict,
        error_log: list,
        top_n: int = 3,
        min_overlap: int = 1,
        require_same_machine: bool = False,
    ) -> list:
        """
        Step 1.5：從 error_log 找出特徵相似且曾判錯的歷史案例，產生 error_hints。

        條件：
        - anomaly_features 至少 min_overlap 個重疊
        - （可選）Slitting machine 相符

        回傳 error_hints，可直接注入 Step 2 prompt。
        """
        new_feat = set(new_record["summary"]["anomaly_features"])
        new_machine = new_record["summary"]["categorical"].get("Slitting machine")

        print(f"\n── Step 1.5 error_hints 搜尋 event={new_record['event_id'][:8]} feat={sorted(new_feat)} ──")
        hints = []
        for case in error_log:
            # 只處理確認判錯的案例
            if case.get("error_analysis", {}).get("was_correct") is not False:
                continue

            case_feat = set(case["summary"]["anomaly_features"])
            overlap = new_feat & case_feat
            if len(overlap) < min_overlap:
                continue

            if require_same_machine:
                case_machine = case["summary"]["categorical"].get("Slitting machine")
                if new_machine != case_machine:
                    continue

            print(
                f"  [Step1.5] {case['event_id'][:8]}"
                f"  was_final_ng={case['conclusion']['final_ng']}"
                f"  confirmed_ng={case['feedback']['confirmed_ng']}"
                f"  overlap={sorted(overlap)}  count={len(overlap)}"
            )

            hints.append({
                "event_id": case["event_id"],
                "was_final_ng": case["conclusion"]["final_ng"],
                "confirmed_ng": case["feedback"]["confirmed_ng"],
                "overlap_features": sorted(overlap),
                "overlap_count": len(overlap),
                "machine": case["summary"]["categorical"].get("Slitting machine"),
                "error_reasons": case.get("error_analysis", {}).get("error_reasons", []),
            })

        hints.sort(key=lambda x: x["overlap_count"], reverse=True)
        return hints[:top_n]



if __name__ == "__main__":
    searcher = SimilarSearcher()

    # ── 1. 讀取主索引（Step 1 來源） ──────────────
    main_index = []
    main_path = "./v2/round_1/llm_records_confirmed.jsonl"
    try:
        with open(main_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    main_index.append(json.loads(line))
        print(f"主索引載入：{len(main_index)} 筆")
    except FileNotFoundError:
        print(f"Warning: {main_path} not found.")

    # ── 2. 讀取 error_log（Step 1.5 來源） ────────
    error_log = []
    error_log_path = "./v2/round_1/error_log.jsonl"
    try:
        with open(error_log_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    error_log.append(json.loads(line))
        print(f"error_log 載入：{len(error_log)} 筆")
    except FileNotFoundError:
        print(f"Warning: {error_log_path} not found.")

    # ── 3. 讀取測試事件 ───────────────────────────
    with open("./v2/round_1/search_key_results.json", "r", encoding="utf-8") as f:
        test_events = json.load(f)

    # ── 4. Step 1 + Step 1.5 ──────────────────────
    all_results = []
    for event in test_events:
        similar_cases, stats = searcher.find_similar_cases(
            event,
            case_base=main_index,
            top_n=3,
            min_score=0.3,
            require_same_machine=True
        )
        error_hints = searcher.find_error_hints(
            event,
            error_log=error_log,
            top_n=3,
            require_same_machine=True,
        )
        all_results.append({
            "target_event_id": event["event_id"],
            "similar_cases": similar_cases,
            "error_hints": error_hints,
        })

    # ── 5. 輸出結果 ───────────────────────────────
    print(f"\n處理事件數：{len(all_results)}")
    with open("./similar_cases_results.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print("結果已寫入 similar_cases_results.json")