"""The Analytical-Four pipeline, split into the A / B / C layers the Kit lets an operator switch on and off.

Method bodies are the originals from Analytical-Four main.py (commit f49cfd3) except for the edits listed in SOURCE.md:
failures raise instead of being logged and skipped, the LLM call has a timeout and a status check, and the known base
is written to the configured path. The stage runner at the bottom is the Kit's own.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import pandas as pd
import requests

from app.analytical_four import offline_vectors  # noqa: F401  (registers the builtin-hash builder)
from app.analytical_four.engine.analysis.descriptive.categorical_analyzer import CategoricalAnalyzer
from app.analytical_four.engine.analysis.descriptive.statistical_calculator import BasicStatistics
from app.analytical_four.engine.analysis.diagnostic.comparator import Comparator
from app.analytical_four.engine.analysis.diagnostic.contribution import ContributionAnalyzer
from app.analytical_four.engine.analysis.diagnostic.correlation import CorrelationAnalyzer
from app.analytical_four.engine.analysis.diagnostic.extraction import Extractor
from app.analytical_four.engine.analysis.models import (
    CategoricalAnalysisResults,
    CompareOutliersResults,
    CorrelationComparisonResults,
    DataFrameSummary,
    FeatureImportanceResults,
    MergedFeatureScores,
    PCAContributionResults,
    PCALoadingItem,
    SearchKeySchema,
    SerializationInputs,
    StatisticsSummary,
)
from app.analytical_four.engine.analysis.prescriptive.RAG.rag_analysis import feature_rag_analysis
from app.analytical_four.engine.analysis.prescriptive.RAG.vector_builder import VectorBuilderFactory
from app.analytical_four.engine.analysis.prescriptive.calculate_rank import CalculateRank
from app.analytical_four.engine.analysis.prescriptive.ng_diagnosis import NGDiagnosisSystem
from app.analytical_four.engine.analysis.prescriptive.similar_searcher import SimilarSearcher
from app.analytical_four.engine.analysis.prescriptive.topology_generator import TopologyGenerator
from app.analytical_four.engine.config_manager import ConfigManager
from app.analytical_four.engine.data_manager import CSVDataManager, JSONDataManager
from app.analytical_four.engine.data_preprocessor.data_splitter import DataSplitter
from app.analytical_four.engine.serializer import SerializerFactory


class PipelineError(Exception):
    """A pipeline step could not do its job. The message is meant for the operator, so it carries no stack trace."""


class StrictCSVManager(CSVDataManager):
    """A failed read, select or save raises instead of returning data=None for the next step to trip over."""

    def _response(self, success, message, data=None):
        if not success:
            raise PipelineError(message)
        return super()._response(success, message, data)


class StrictJSONManager(JSONDataManager):
    def _response(self, success, message, data=None):
        if not success:
            raise PipelineError(message)
        return super()._response(success, message, data)


class Analytical_Four_System:
    def __init__(self, config: ConfigManager):
        self.config = config
        self.csv_data_manager = StrictCSVManager()
        self.json_data_manager = StrictJSONManager()
        self.logger = logging.getLogger(__name__)

        # data_path
        self.current_data_path = self.config.config.data_source.current_data.descriptive
        self.baseline_data = self.config.config.data_source.baseline_data
        self.descriptive_baseline_path = self.baseline_data.descriptive
        self.diagnostic_baseline_path = self.baseline_data.diagnostic
        self.prescriptive_baseline_path = self.baseline_data.prescriptive
        self.topology_path = self.baseline_data.topology
        self.rag_knowledge_path = self.baseline_data.rag_knowledge
        self.prompts_path = self.baseline_data.prompts
        self.ng_code_path = self.baseline_data.ng_code
        self.llm_records_path =  self.config.config.data_source.case_data.llm_records
        self.llm_error_records_path = self.config.config.data_source.case_data.llm_error_records

        # settings
        self.method = self.config.config.method
        self.mode = self.config.config.mode
        self.serializer = self.config.config.serializer
        self.observer = self.config.config.observer
        self.feature_set = self.config.config.active_feature_config
        self.nums_feature = self.feature_set.numerical
        self.cat_features = self.feature_set.all_categorical_cols
        self.target_feature = self.feature_set.target
        self.id_feature = self.feature_set.id
        self.machine_feature = self.feature_set.categorical["Machine"]
        self.measurement_feature = self.feature_set.categorical["Measurement"]
        self.feature_list = (
            self.nums_feature
            + self.cat_features
            + [self.target_feature]
            + [self.id_feature]
        )
        self.llm_api = self.config.config.data_source.llm_setting.api_endpoint
        self.rag_setting = self.config.config.data_source.rag_setting
        # Set by the runner from the Kit settings; the API key itself is read from the environment and never stored.
        self.llm_timeout = 120
        self.llm_api_key = None
        self.missing_features: List[str] = []

    def read_data(
        self, manager: Union[CSVDataManager, JSONDataManager], data_path: str
    ) -> Tuple[pd.DataFrame, pd.DataFrame, dict, dict]:
        return manager.load(input_path=data_path)["data"]

    def data_cleaning(self, data: pd.DataFrame) -> pd.DataFrame:
        data = self.csv_data_manager.select(data, self.feature_list)["data"]
        self.logger.info("Selected data with analyze columns: %s", self.feature_list)
        self.logger.info("Selected data shape: %s", data.shape)
        data = self.csv_data_manager.drop_empty_columns(data)["data"]
        data = self.csv_data_manager.drop_empty_rows(data)["data"]
        return data

    def data_splitting(self, data: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
        splitter = DataSplitter()
        self.logger.info("target: %s", self.target_feature)
        split_data = splitter.split(data, target=self.target_feature, threshold=5)
        self.logger.info(
            "Data split into %d groups based on target '%s'",
            len(split_data),
            self.target_feature,
        )
        return split_data[0], split_data[1]  # 回傳主要類別與次要類別的資料

    def output_data(self, data, output_path):
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        self.logger.info(f"Data saved to {output_path}")

    def align_features(
        self, baseline_data: pd.DataFrame, current_data: pd.DataFrame
    ) -> pd.DataFrame:
        baseline_cols = set(baseline_data.columns)
        current_cols = set(current_data.columns)
        common_cols = list(baseline_cols.intersection(current_cols))
        self.logger.info(
            "Common columns between baseline and current data: %s", common_cols
        )
        aligned_baseline_data = baseline_data[common_cols]
        return aligned_baseline_data

    def basic_statistics(
        self, data: pd.DataFrame, output_path: str = None
    ) -> DataFrameSummary:
        summary_result: dict[str, StatisticsSummary] = {}
        stats = BasicStatistics()

        num_data = self.csv_data_manager.select(data, self.nums_feature)["data"]

        for col in num_data.columns.tolist():
            col_data = num_data[col].dropna().tolist()
            stats_result = stats.calculate_summary(col_data)
            summary_result[col] = stats_result

        if output_path:
            serializable_results = {
                col: asdict(stats_obj) if is_dataclass(stats_obj) else stats_obj
                for col, stats_obj in summary_result.items()
            }
            self.output_data(serializable_results, output_path)
        return DataFrameSummary(results=summary_result)

    def categorical_statistics(
        self, data: pd.DataFrame, normalize=True, output_path: str = None
    ) -> CategoricalAnalysisResults:
        analyzer = CategoricalAnalyzer()
        result = analyzer.analyze_target_distribution_by_category(
            data=data,
            target_col=self.target_feature,
            categorical_cols=self.cat_features,
            normalize=normalize,
        )

        if output_path:
            self.output_data(result, output_path)
        return CategoricalAnalysisResults(results=result)

    def compare_outliers(
        self,
        data: pd.DataFrame,
        stats: DataFrameSummary,
        base_line: dict = None,
        output_path: str = None,
    ) -> CompareOutliersResults:
        comparator = Comparator()

        compare_result = comparator.check_outlier(
            data=data,
            stats=stats,
            base_line=base_line,  # diagnostic_config
            method=self.method,  # bound / 3sigma / minmax
            id_feature=self.id_feature,
            numerical_features=self.nums_feature,
        )

        if output_path:
            self.output_data(compare_result, output_path)
        return CompareOutliersResults(results=compare_result)

    def correlation_analysis(
        self,
        data: pd.DataFrame,
        baseline_data: pd.DataFrame,
        method: str = "pearson",
        output_path: str = None,
    ) -> CorrelationComparisonResults:
        analyzer = CorrelationAnalyzer()

        num_sample_data = self.csv_data_manager.select(data, self.nums_feature)["data"]
        sample_df = analyzer.prepare_df(num_sample_data, self.nums_feature)

        num_baseline_data = self.csv_data_manager.select(
            baseline_data, self.nums_feature
        )["data"]
        baseline_df = analyzer.prepare_df(num_baseline_data, self.nums_feature)

        comparison_result = analyzer.compare_corr(
            abnormal_df=baseline_df, normal_df=sample_df, method=method
        )

        if output_path:
            serializable_results = asdict(comparison_result)
            self.output_data(serializable_results, output_path)
        return comparison_result

    def contribution_analysis(
        self,
        data: pd.DataFrame,
        baseline_data: pd.DataFrame,
        sample_id_list: list[str],
        loadings_output_path: str = None,
        spe_t2_output_path: str = None,
    ) -> PCAContributionResults:
        analyzer = ContributionAnalyzer()
        num_sample_data = self.csv_data_manager.select(data, self.nums_feature)["data"]
        num_baseline_data = self.csv_data_manager.select(
            baseline_data, self.nums_feature
        )["data"]

        # 1. 準備數據並標準化
        # std_df = analyzer.calculate_simple_std(data)
        # std_baseline_df = analyzer.calculate_simple_std(baseline_data)
        scaler = analyzer.fit_scaler(num_baseline_data)
        std_df = analyzer.transform_with_scaler(num_sample_data, scaler)
        std_baseline_df = analyzer.transform_with_scaler(num_baseline_data, scaler)

        # 2. PCA
        pca, transformed, cum_var, sel_var = analyzer.PCA(std_baseline_df)

        # 3. 計算負荷量與特徵總貢獻度
        loadings_dict_list = analyzer.loadings(std_baseline_df, pca)

        loadings_list_for_class = []
        for item in loadings_dict_list:
            # 提取固定屬性
            feature = item.pop("feature")
            contribution = item.pop("contribution")

            # item 字典中現在只剩下動態的 PC1, PC2, ... 載荷量
            loadings_detail = {k: v for k, v in item.items() if k.startswith("PC")}

            # 實例化 Class
            loading_item = PCALoadingItem(
                feature=feature,
                contribution=contribution,
                loadings_detail=loadings_detail,
            )
            loadings_list_for_class.append(loading_item)

        # 4. 計算診斷統計量
        alpha: float = 0.05
        t2_ucl = analyzer.calculate_t2_limit(std_baseline_df, pca, alpha=alpha)
        spe_ucl = analyzer.calculate_spe_limit(std_baseline_df, pca, alpha=alpha)

        self.logger.info(f"T2 Upper Control Limit (UCL): {t2_ucl:.4f}")
        self.logger.info(f"SPE Upper Control Limit (UCL): {spe_ucl:.4f}")

        # T² / SPE / SPE_feature / T²_feature
        t2, t2_feature, t2_feature_score, t2_feature_rank = analyzer.hotelling_t2(
            std_df, pca
        )
        spe, spe_feature, spe_feature_score, spe_feature_rank = analyzer.SPE(
            std_df, pca
        )

        # 構建樣本診斷結果
        sample_diagnostics = analyzer.construct_sample_diagnostics(
            sample_id_list,
            std_df,
            t2,
            t2_ucl,
            t2_feature,
            t2_feature_score,
            t2_feature_rank,
            spe,
            spe_ucl,
            spe_feature,
            spe_feature_score,
            spe_feature_rank,
        )
        pca_results = PCAContributionResults(
            explained_variance=sel_var.tolist(),
            cumulative_variance=cum_var.tolist(),
            n_components=pca.n_components_,
            loadings=loadings_list_for_class,
            sample_diagnostics=sample_diagnostics,
            features_used=self.nums_feature,
        )

        # 存結果
        serializable_results = asdict(pca_results)
        if loadings_output_path:
            loadings_data = serializable_results["loadings"]
            self.output_data(loadings_data, loadings_output_path)
        if spe_t2_output_path:
            spe_t2_data = serializable_results["sample_diagnostics"]
            self.output_data(spe_t2_data, spe_t2_output_path)
        self.logger.info("Contribution analysis results saved via JSON files.")
        return pca_results

    def extract_feature_importance(
        self,
        boundary_data: CompareOutliersResults,
        spe_t2_data: Dict[str, Any],
        delta_corr: Dict[str, Dict[str, float]],
        loadings: List[PCALoadingItem],
        alpha: float = 0.5,
        threshold: float = 0.8,
        merge_delta_corr_with_loadings_output_path: str = None,
        merge_boundary_spe_with_t2_output_path: str = None,
    ) -> Tuple[FeatureImportanceResults, MergedFeatureScores]:
        extractor = Extractor()
        delta_corr = extractor.extract_delta_corr(delta_corr)
        loadings_dict = {item.feature: item.contribution for item in loadings}

        delta_corr_with_loadings_results = extractor.merge_delta_corr_with_loadings(
            delta_corr, loadings_dict, alpha=alpha, threshold=threshold
        )

        boundary_spe_with_t2_results = extractor.merge_boundary_spe_with_t2(
            boundary=boundary_data, spe_with_t2=spe_t2_data
        )

        delta_corr_with_loadings_results_asdict = asdict(
            delta_corr_with_loadings_results
        )
        boundary_spe_with_t2_results_asdict = asdict(boundary_spe_with_t2_results)

        if merge_delta_corr_with_loadings_output_path:
            self.output_data(
                delta_corr_with_loadings_results_asdict,
                merge_delta_corr_with_loadings_output_path,
            )
        if merge_boundary_spe_with_t2_output_path:
            self.output_data(
                boundary_spe_with_t2_results_asdict,
                merge_boundary_spe_with_t2_output_path,
            )

        self.logger.info("Feature importance extraction results saved.")
        return delta_corr_with_loadings_results, boundary_spe_with_t2_results

    def calculate_weighted_contributions(
        self,
        pca_contribution_results: PCAContributionResults,
        extract_result: FeatureImportanceResults,
        output_path: str = None,
    ):
        calculate_rank = CalculateRank()

        weighted_results = {}
        for (
            event_id,
            sample_data,
        ) in pca_contribution_results.sample_diagnostics.items():
            rank_result = calculate_rank.rank_features_with_outlier_scaling(
                event_id=event_id,
                sample_data=sample_data,
                feature_scores=extract_result.feature_scores,
            )
            weighted_results.update(rank_result)

        if output_path:
            self.output_data(weighted_results, output_path)
        return weighted_results

    def serialization(
        self, inputs: SerializationInputs, output_path: str = None
    ) -> List[Dict[str, Any]]:
        serializer_instance = SerializerFactory.create_serializer(
            inputs.serializer_type
        )
        serialized_results = serializer_instance.serialization_file(
            csv_data=inputs.csv_data,
            iqr_data=inputs.iqr_anomalies,
            spe_t2_data=inputs.spe_t2_diagnostics,
            raw_spe_t2_data=inputs.raw_spe_t2_diagnostics,
            id_col=inputs.id_col,
        )
        if output_path:
            if not os.path.exists(output_path):
                os.makedirs(output_path)
            for event in serialized_results:
                event_id = event.get("event_id")
                if not event_id:
                    self.logger.warning(
                        "Skip serialization output for event without event_id"
                    )
                    continue
                event_path = os.path.join(output_path, f"event_{event_id}.json")
                self.output_data(event, event_path)
        return serialized_results

    def topology_analysis(
        self, serialization_results: List[Dict[str, Any]], output_path: str = None
    ):
        topology_setting = self.read_data(self.json_data_manager, self.topology_path)
        generator = TopologyGenerator(topology_setting)
        topology = generator.generate()

        for event in serialization_results:
            result = generator.serialized_feature_sources(event)
            event_aov = generator.summarize_serialized(result, topology)

            if output_path:
                if output_path and not os.path.exists(output_path):
                    os.makedirs(output_path)
                output_folder_path = os.path.join(
                    output_path, f"topology_event_{event['event_id']}.json"
                )
                self.output_data(event_aov, output_folder_path)

    def rag_analysis(
        self, serialization_results: List[Dict[str, Any]], output_path: str = None
    ):
        """建立或載入向量資料庫，然後執行 RAG 分析
        
        首次執行會建立向量庫，後續執行會檢測是否需要更新。
        提升效能 5-10 倍（跳過重複的 embedding 生成）。
        """
        rag_builder = VectorBuilderFactory.create(
            builder_type=self.rag_setting.builder_type,
            db_path=self.rag_setting.db_path,
            collection_name=self.rag_setting.collection_name,
        )
        knowledge = rag_builder.load_csv_knowledge(self.rag_knowledge_path)
        rag_builder.build_vector_database_if_needed(knowledge)

        event_results = {}
        for event in serialization_results:
            result = feature_rag_analysis(rag_builder, event, top_k=1)
            event_results[event["event_id"]] = result
        if output_path:
            self.output_data(event_results, output_path)
        return event_results

    def ng_code_analysis(
        self,
        mode: str = "daily",
        observer: str = "P3",
        serialization_results: List[Dict[str, Any]] = None,
        output_path: str = None,
    ):
        system = NGDiagnosisSystem(self.ng_code_path)
        if mode == "daily":
            kb = system.train_daily_mode(serialization_results, observer=observer)
            self.output_data(kb, self.prescriptive_baseline_path)
        elif mode == "complain":
            results_output = {}
            system.knowledge_base = self.read_data(
                self.json_data_manager, self.prescriptive_baseline_path
            )
            for i, event in enumerate(serialization_results):
                test_event = serialization_results[i].copy()
                result = system.predict_complain_mode(test_event)
                results_output[test_event["event_id"]] = result
                # results_output[test_event['context']['Produce_No.']] = result
            if output_path:
                self.output_data(results_output, output_path)
            return results_output

    def compilation_events(
        self,
        serialization_results: List[Dict[str, Any]],
        ng_code_events: dict,
        rag_events: dict,
        output_path: str = None,
        topology_folder: str = "outputs/complain/topology/",
        ):

        def get_top3_anomalies(ranked_features: dict) -> list:
            # 建立一個字典來存儲總分與細節
            scores = {}

            # 計算得分 (Rank 1 -> 5 pts, Rank 2 -> 4 pts, ... Rank >=5 -> 1 pt)
            for weight_type in ["T2_feature", "SPE_feature"]:
                raw_entries = ranked_features.get(weight_type, [])
                feature_items = [
                    (item.get("feature"), item)
                    for item in raw_entries
                    if isinstance(item, dict) and item.get("feature")
                ]

                if not feature_items:
                    continue

                for feature_name, item in feature_items:
                    rank_no = int(
                        item.get("final_rank") or item.get("original_rank") or 999
                    )
                    score = max(1, 6 - rank_no)
                    if feature_name not in scores:
                        scores[feature_name] = {
                            "Total": 0,
                            "T2_score": 0,
                            "SPE_score": 0,
                            "T2_contribution": None,
                            "SPE_contribution": None,
                            "csv_measurement": None,
                        }

                    scores[feature_name]["Total"] += score
                    if weight_type == "T2_feature":
                        scores[feature_name]["T2_score"] = score
                        if isinstance(item, dict):
                            scores[feature_name]["T2_contribution"] = item.get(
                                "contribution_value"
                            )
                            if scores[feature_name]["csv_measurement"] is None:
                                scores[feature_name]["csv_measurement"] = item.get(
                                    "csv_measurement"
                                )
                    else:
                        scores[feature_name]["SPE_score"] = score
                        if isinstance(item, dict):
                            scores[feature_name]["SPE_contribution"] = item.get(
                                "contribution_value"
                            )
                            if scores[feature_name]["csv_measurement"] is None:
                                scores[feature_name]["csv_measurement"] = item.get(
                                    "csv_measurement"
                                )

            # 根據總分排序，取前3名，如有同分則一起列出
            sorted_features = sorted(
                scores.items(),
                key=lambda x: (x[1]["Total"], x[1]["T2_score"], x[1]["SPE_score"]),
                reverse=True,
            )
            top3 = []
            for feature, score_details in sorted_features:
                if len(top3) < 3 or score_details["Total"] == top3[-1][1]["Total"]:
                    top3.append((feature, score_details))
                else:
                    break
            return top3

        event_results = []
        for event in serialization_results:
            topology_name = f"topology_event_{event['event_id']}"
            topology_data = self.read_data(
                self.json_data_manager,
                f"{topology_folder}{topology_name}.json",
            )
            ng_code_data = ng_code_events.get(event["event_id"], {})
            rag_data = rag_events.get(event["event_id"], {})
            top3_anomalies = get_top3_anomalies(event["ranked_features"])
            event_result = {
                "event_id": event["event_id"],
                "event_date": event["event_date"],
                "context": event["context"],
                "topology": topology_data,
                "top3_anomalies": top3_anomalies,
                "ng_code_analysis": ng_code_data,
                "rag_analysis": rag_data,
            }
            event_results.append(event_result)

        if output_path:
            self.output_data(event_results, output_path)
        return event_results

    def extract_search_key(self, raw: dict) -> SearchKeySchema:
        ctx = raw.get("context", {})
        topo = raw.get("topology", {})
        ng = raw.get("ng_code_analysis", {})
        rag = raw.get("rag_analysis", {})
        top3 = raw.get("top3_anomalies", [])

        anomaly_features = []
        for layer in topo.get("causal_layers", {}).get("layers", []):
            for feat in layer.get("features", []):
                fid = feat.get("id")
                if fid and fid not in anomaly_features:
                    anomaly_features.append(fid)

        name_to_id = {}
        for layer in topo.get("causal_layers", {}).get("layers", []):
            for feat in layer.get("features", []):
                name_to_id[feat.get("name", "")] = feat.get("id", "")

        anomaly_measurements = {}
        for entry in top3:
            feat_name = entry[0]
            feat_data = entry[1] if len(entry) > 1 else {}
            feat_id = name_to_id.get(feat_name, feat_name)
            anomaly_measurements[feat_id] = {
                "T2_score": feat_data.get("T2_score"),
                "SPE_score": feat_data.get("SPE_score"),
                "csv_measurement": feat_data.get("csv_measurement"),
            }

        sop_keys = []
        sop_details = {}
        for feat_name, sop_list in rag.items():
            for sop_str in sop_list:
                # 1. 先處理前後空白，再進行分割
                parts = [p.strip() for p in sop_str.strip().split(",")]
                
                # 2. 檢查長度是否足以提供所有欄位 (至少需要 7 個元素才能存取到 index 6)
                if len(parts) < 7:
                    self.logger.warning("Skip SOP text with fewer than 7 fields: %s", sop_str)
                    continue
                    
                sop_key = parts[0]
                
                # 3. 檢查 key 是否有效且尚未存在
                if sop_key and sop_key not in sop_details:
                    sop_keys.append(sop_key)
                    sop_details[sop_key] = {
                        "feature": parts[2],
                        "issue": parts[4],
                        "suggestion": parts[5],
                        "sop_source": parts[6]
                    }

        pred = ng.get("prediction", {})
        rca = ng.get("root_cause_analysis", {})

        diagnosis_results = {
            "suggested_ng_code": pred.get("suggested_ng_code"),
            "confidence_score": pred.get("confidence_score"),
            "score_breakdown": pred.get("score_breakdown", {}),
            "suggested_actions": [rca.get("action")] if rca.get("action") else [],
            "root_cause": {"machine": rca.get("machine"), "cause": rca.get("cause")},
        }

        feedback = {
            "confirmed_ng": None,
            "actual_cause": None,
            "confirmed_by": None,
            "confirmed_at": None,
            "was_correct": None,
            "label_source": None,
        }

        return {
            "schema_version": "2.0",
            "event_id": raw.get("event_id"),
            "generated_at": raw.get("event_date")
            or datetime.now(timezone.utc).isoformat(),
            "mode": "complain",
            "summary": {
                "categorical": {
                    "Produce_No._or_Semi_produce_No.": ctx.get("Produce_No.")
                    or ctx.get("Semi_produce_No."),
                    "P1.Machine_No.": ctx.get("P1.Machine_No."),
                    "Material": ctx.get("Material"),
                    "Slitting machine": ctx.get("Slitting machine"),
                    "Winder number": ctx.get("Winder number"),
                    "Quality inspection": ctx.get("Quality inspection"),
                    "Quality control": ctx.get("Quality control"),
                    "P3.Machine_No.": ctx.get("P3.Machine_No."),
                },
                "anomaly_count": len(anomaly_features),
                "anomaly_features": anomaly_features,
                "anomaly_measurements": anomaly_measurements,
                "sop_keys": sop_keys,
                "sop_details": sop_details,
            },
            "diagnosis_results": diagnosis_results,
            "llm_analysis": {
                "evidence_for": [],
                "evidence_against": [],
                "uncertainty": "",
                "similar_cases": [],
                "case_agreement": None,
            },
            "conclusion": {
                "final_ng": "",
                "source": "",
                "confidence": "",
                "action": "",
                "needs_human": None,
            },
            "error_analysis": {"was_correct": None, "error_reasons": [], "delta": {}},
            "feedback": feedback,
        }

    def similarity_search(
        self,
        result_schema: List[Dict[str, Any]],
        output_path: str = None
        ):
        searcher = SimilarSearcher()
        
        def read_jsonl(path):
            records = []
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        record = json.loads(line.strip())
                        records.append(record)
                    except json.JSONDecodeError as e:
                        if line.strip():
                            raise PipelineError(f"{os.path.basename(path)} 含無效的 JSON 行：{e}") from e
            return records
        llm_records = read_jsonl(self.llm_records_path)
        error_records = read_jsonl(self.llm_error_records_path)
        self.logger.info("Loaded %d LLM records and %d error records for similarity search.", len(llm_records), len(error_records))

        all_similar_results = []
        for event in result_schema:
            similar_cases, _ = searcher.find_similar_cases(
                new_record=event,
                case_base=llm_records,
                top_n=3,
                min_score=0.3,
                require_same_machine=True
            )
            error_hints = searcher.find_error_hints(
                new_record=event,
                error_log=error_records,
                top_n=3,
                min_overlap=2,
                require_same_machine=True
            )
            all_similar_results.append({
                "target_event_id": event.get("event_id"),
                "similar_cases": similar_cases,
                "error_hints": error_hints
            })
        
        if output_path:
            self.output_data(all_similar_results, output_path)
        return all_similar_results

    def analyze_with_llm(
        self,
        result_schema: List[Dict[str, Any]],
        all_similar_results: List[Dict[str, Any]],
        output_path: str = None
        ):
        
        llm_responses = []
        for event in result_schema:
            event_id =  event["event_id"]
            
            similar_entry = next((r for r in all_similar_results if r["target_event_id"] == event_id), {})
            similar_cases = similar_entry.get("similar_cases", [])
            error_hints   = similar_entry.get("error_hints") or None

            data = {
                "new_event": event,
                "top3_cases": similar_cases,
                "error_hints": error_hints
            }
            llm_responses.append(self._post_llm(data))
            
        if output_path:
            self.output_data(llm_responses, output_path)
        return llm_responses

    def _post_llm(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.llm_api:
            raise PipelineError("尚未設定 LLM 服務位址")
        headers = {"Authorization": f"Bearer {self.llm_api_key}"} if self.llm_api_key else {}
        try:
            response = requests.post(self.llm_api, json=payload, headers=headers, timeout=self.llm_timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as error:
            raise PipelineError(f"LLM 服務呼叫失敗：{type(error).__name__}") from error
        except ValueError as error:
            raise PipelineError("LLM 服務回應不是 JSON") from error

    # ---- Kit stage runner -------------------------------------------------------------------------------------------

    def prepare_data(self) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Returns (current_data, sample_data, baseline_data) the way main() builds them for each mode."""
        current_data = self.read_data(self.csv_data_manager, self.current_data_path)
        if self.target_feature not in current_data.columns:
            raise PipelineError(f"待分析資料沒有目標欄位「{self.target_feature}」")
        if self.mode == "daily":
            current_data = self.data_cleaning(current_data)
            sample_data, baseline_data = self.data_splitting(current_data)
        elif self.mode == "complain":
            baseline_data = self.read_data(self.csv_data_manager, self.descriptive_baseline_path)
            current_data = self.data_cleaning(current_data)
            baseline_data = self.align_features(baseline_data, current_data)
            sample_data = current_data
        else:
            raise PipelineError(f"不支援的分析模式：{self.mode}")
        present = [c for c in self.nums_feature if c in sample_data.columns]
        if not present:
            raise PipelineError("設定的數值特徵在資料中一個也找不到")
        # The engine ignores a configured column the data does not have; keep that, but let the run record say how many.
        self.missing_features = [c for c in self.nums_feature if c not in sample_data.columns]
        if sample_data.empty or baseline_data.empty:
            raise PipelineError("待分析樣本或正常基準沒有資料列")
        return current_data, sample_data, baseline_data

    def descriptive_stage(self, current_data, sample_data, baseline_data, out: str) -> CompareOutliersResults:
        stats = self.basic_statistics(baseline_data, output_path=f"{out}baseline.json")
        self.categorical_statistics(data=current_data, normalize=True, output_path=f"{out}categorical_statistics.json")
        return self.compare_outliers(data=sample_data, stats=stats, base_line=None, output_path=f"{out}compare_outliers_result.json")

    def diagnostic_stage(self, sample_data, baseline_data, compare_result, out: str) -> List[Dict[str, Any]]:
        correlation = self.correlation_analysis(data=sample_data, baseline_data=baseline_data, method="pearson",
                                                output_path=f"{out}correlation_comparison.json")
        if self.id_feature in sample_data.columns:
            sample_ids = sample_data[self.id_feature].astype(str).tolist()
        else:
            sample_ids = [f"row_{i}" for i in sample_data.index]
        pca = self.contribution_analysis(data=sample_data, baseline_data=baseline_data, sample_id_list=sample_ids,
                                         loadings_output_path=f"{out}pca_loadings.json", spe_t2_output_path=f"{out}pca_spe_t2.json")
        extracted, _ = self.extract_feature_importance(
            boundary_data=compare_result, spe_t2_data=pca.sample_diagnostics, delta_corr=correlation.delta_corr,
            loadings=pca.loadings, alpha=0.6, threshold=0.8,
            merge_delta_corr_with_loadings_output_path=f"{out}ut_corr_pca_extraction_result.json",
            merge_boundary_spe_with_t2_output_path=f"{out}ut_bou_spe_t2_extraction_result.json")
        weighted = self.calculate_weighted_contributions(pca_contribution_results=pca, extract_result=extracted,
                                                         output_path=f"{out}weighted_contributions.json")
        inputs = SerializationInputs(serializer_type=self.serializer, csv_data=sample_data, iqr_anomalies=compare_result.results,
                                     spe_t2_diagnostics=weighted, raw_spe_t2_diagnostics=pca.sample_diagnostics, id_col=self.id_feature)
        events = self.serialization(inputs=inputs, output_path=f"{out}serialized_events/")
        if not events:
            raise PipelineError("診斷沒有產生任何事件")
        broken = [e for e in events if "error" in e.get("ranked_features", {})]
        if broken:
            # The serializer records a per-event failure inside the event instead of raising; surface it here.
            raise PipelineError(f"{len(broken)} 件事件沒有診斷資料：{broken[0]['ranked_features']['error']}")
        return events
