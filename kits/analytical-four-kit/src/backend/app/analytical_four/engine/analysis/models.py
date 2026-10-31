from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple, Optional, Union, TypedDict
import pandas as pd


@dataclass
class StatisticsSummary:
    """單一數據序列的摘要統計結果"""
    mean: float
    median: float
    population_std: float
    sample_std: float
    cv: float
    min: float
    max: float
    # iqr 是一個包含 Q1, Q2(中位數), Q3 的 Tuple
    iqr: Tuple[float, float, float] 
    # bound 是一個包含 (upper_bound, lower_bound) 的 Tuple
    bound: Tuple[float, float]
    # skewness 是一個包含 (skewness, M2, M3) 的 Tuple
    skewness: Tuple[float, float, float]
    # kurtosis 是一個包含 (kurtosis, M4) 的 Tuple
    kurtosis: Tuple[float, float]
    count: int

@dataclass
class DataFrameSummary:
    results: dict[str, StatisticsSummary]

@dataclass
class CategoricalAnalysisResults:
    results: dict[str, dict[any, dict[any, float]]]

@ dataclass
class CompareOutliersResults:
    results: dict[str, dict[any, list[any]]]

@dataclass
class CorrelationComparisonResults:
    CorrelationMatrix = Dict[str, Dict[str, Optional[float]]]
    """比較正常資料集和異常資料集的相關性結果"""
    corr_normal: CorrelationMatrix      # 正常資料集的相關矩陣
    corr_abnormal: CorrelationMatrix    # 異常資料集的相關矩陣
    delta_corr: CorrelationMatrix       # 差異矩陣 (abnormal - normal)
    method: str = "pearson"             # 使用的相關性方法

@dataclass
class PCALoadingItem:
    feature: str
    contribution: float
    loadings_detail: Dict[str, float] = field(default_factory=dict)

@dataclass
class PCAContributionResults:
    explained_variance: List[float]
    cumulative_variance: List[float]
    n_components: int
    loadings: List[PCALoadingItem]         # 載荷量與總貢獻度
    sample_diagnostics: Dict[str, Any]     # 樣本點診斷結果 (T2/SPE/貢獻度)
    features_used: List[str]

@dataclass
class FeatureImportanceResults:
    """特徵重要性綜合提取與排序結果"""
    # 核心結果
    selected_features: List[str]            # 根據閾值選取的特徵列表
    feature_scores: Dict[str, float]        # 最終綜合分數 (已排序)
    
    # 標準化分數
    delta_norm: Dict[str, float]            # Delta Correlation 標準化分數
    pca_norm: Dict[str, float]              # PCA Loadings 標準化分數
    
    # 視覺化資料
    all_features: List[str]                 # 所有特徵 (按分數排序)
    feature_pct: Dict[str, float]           # 各特徵佔總分數的百分比
    cumsum_ratio: Dict[str, float]          # 累積貢獻比例

@dataclass
class SerializationInputs:
    """序列化流程所需的所有數據輸入"""
    # 原始數據（CSV/DataFrame）
    csv_data: pd.DataFrame
    # IQR 異常檢測結果 (來自 comparator.check_outlier)
    iqr_anomalies: Dict[str, Dict[str, Any]] 
    # SPE/T2 診斷結果 (來自 PCAContributionResults.sample_diagnostics)
    spe_t2_diagnostics: Dict[str, Any]
    # 原始 SPE/T2 明細 (含 T2/SPE 整體值與各特徵 raw/score)
    raw_spe_t2_diagnostics: Dict[str, Any]
    # 序列化器類型
    serializer_type: str
    id_col: str

@dataclass
class MergedFeatureScores:
    boundary_count: Dict[str, int]
    spe_score: Dict[str, float]
    t2_score: Dict[str, float]
    final_raw_score: Dict[str, float]

class SopDetail(TypedDict, total=False):
    """標準作業程序詳情"""
    feature: str
    issue: str
    suggestion: str
    sop_source: str

class SummarySchema(TypedDict):
    """摘要資訊"""
    categorical: Dict[str, Any]                # 原始 CSV 欄位名:值 (含特殊字符)
    anomaly_count: int                         # 異常特徵數量
    anomaly_features: List[str]                # 異常特徵列表
    anomaly_measurements: Dict[str, Any]       # 特徵 ID: {T2/SPE/測量}
    sop_keys: List[str]                        # SOP 關鍵字列表
    sop_details: Dict[str, SopDetail]         # SOP 詳情

class DiagnosisResultsSchema(TypedDict, total=False):
    """診斷結果"""
    suggested_ng_code: Optional[str]
    confidence_score: Optional[float]
    score_breakdown: Dict[str, Any]
    suggested_actions: List[str]
    root_cause: Dict[str, Optional[str]]

class LLMAnalysisSchema(TypedDict, total=False):
    """LLM 分析結果"""
    evidence_for: List[str]
    evidence_against: List[str]
    uncertainty: str
    similar_cases: List[Dict[str, Any]]
    case_agreement: Optional[bool]

class ConclusionSchema(TypedDict, total=False):
    """結論"""
    final_ng: str
    source: str
    confidence: str
    action: str
    needs_human: Optional[bool]

class ErrorAnalysisSchema(TypedDict, total=False):
    """錯誤分析"""
    was_correct: Optional[bool]
    error_reasons: List[str]
    delta: Dict[str, Any]

class FeedbackSchema(TypedDict, total=False):
    """回饋資訊"""
    confirmed_ng: Optional[str]
    actual_cause: Optional[str]
    confirmed_by: Optional[str]
    confirmed_at: Optional[str]
    was_correct: Optional[bool]
    label_source: Optional[str]

class SearchKeySchema(TypedDict):
    schema_version: str                    # "2.0"
    event_id: str                          # 事件 ID
    generated_at: str                      # 生成時間戳
    mode: str                              # "complain" 或 "daily"
    summary: SummarySchema                 # 摘要資訊
    diagnosis_results: DiagnosisResultsSchema  # 診斷結果
    llm_analysis: LLMAnalysisSchema       # LLM 分析結果
    conclusion: ConclusionSchema          # 結論
    error_analysis: ErrorAnalysisSchema   # 錯誤分析
    feedback: FeedbackSchema              # 回饋資訊
