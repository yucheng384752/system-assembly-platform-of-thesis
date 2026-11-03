import uuid
import pandas as pd
import json
from datetime import datetime, timezone
from abc import ABC, abstractmethod
import logging



class BaseSerializer(ABC):
    """資料序列化器基底類別"""
    
    def __init__(self,data_type):
        self.data_type = data_type
        self.logger = logging.getLogger(__name__)
    
    def load_csv_data(self, csv_path: str):
        """讀取 CSV 檔案資料"""
        self.logger.debug(f"讀取 CSV 檔案: {csv_path}")
        try:
            data = pd.read_csv(csv_path)
            return data
        except Exception as e:
            self.logger.error(f"讀取 CSV 檔案時發生錯誤: {e}")
            raise
    
    def load_json_data(self, json_path: str):
        """讀取 JSON 檔案資料"""
        self.logger.debug(f"讀取 JSON 檔案: {json_path}")
        try:
            with open(json_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
            return data
        except Exception as e:
            self.logger.error(f"讀取 JSON 檔案時發生錯誤: {e}")
            raise

    @abstractmethod
    def process_context(self, data):
        """處理 context 部分的資料"""
        pass
    
    @abstractmethod
    def process_detected_by_IQR(self, data):
        """處理 detected_by_IQR 部分的資料"""
        pass
    
    @abstractmethod
    def process_PCA_and_correlation_analysis(self, data):
        """處理 PCA_and_correlation_analysis 部分的資料"""
        pass
    
    @abstractmethod
    def process_SPE_T2_analysis(self, product_id, ranked_data, raw_data, csv_data, id_col):
        """處理 SPE_T2_analysis 部分的資料"""
        pass
    
    def load_all_data(self, csv_path: str, iqr_path: str, spe_t2_path: str, selected_features_path: str):
        """讀取所有需要的資料檔案"""
        self.logger.debug("開始讀取所有資料檔案")
        try:
            csv_data = self.load_csv_data(csv_path)
            iqr_data = self.load_json_data(iqr_path)
            spe_t2_data = self.load_json_data(spe_t2_path)
            selected_features_data = self.load_json_data(selected_features_path)
            self.logger.debug("所有資料檔案讀取完成")
            return csv_data, iqr_data, spe_t2_data, selected_features_data
        except Exception as e:
            self.logger.error(f"讀取所有資料檔案時發生錯誤: {e}")
            raise
    
    def create_event_id(
        self,
        product_id: str,
        csv_data: pd.DataFrame,
        iqr_anomalies: dict, 
        spe_t2_data: dict,
        raw_spe_t2_data: dict,
        id_col: str,
        ):
        event_id = str(uuid.uuid4())
        try:
            event_data = {
                "event_id": event_id,
                "event_date": datetime.now(timezone.utc).isoformat(),
                "context": self.process_context(product_id, csv_data),
                "detected_by_IQR": self.process_detected_by_IQR(iqr_anomalies),
                "ranked_features": self.process_SPE_T2_analysis(
                    product_id=product_id,
                    ranked_data=spe_t2_data,
                    raw_data=raw_spe_t2_data,
                    csv_data=csv_data,
                    id_col=id_col,
                ),
            }
            return event_data
                
        except Exception as e:
            self.logger.error(f"序列化資料時發生錯誤: {e}")
            return {}
    
    def serialization_file(
        self,
        csv_data: pd.DataFrame,
        iqr_data: str,
        spe_t2_data: str,
        raw_spe_t2_data: str,
        id_col: str = "Produce_No."
        ):
        """處理檔案：讀取資料，序列化後輸出"""
        
        self.logger.debug("開始序列化檔案資料")
        try:
            serialized_results = []
            
            # 以 CSV 中的 ID 為主鍵
            if id_col in csv_data.columns:
                product_ids = csv_data[id_col].unique()
                self.logger.info(f"從 CSV 識別到 {len(product_ids)} 個 {id_col}")
            else:
                # 若 CSV 沒 ID 欄位，fallback 到使用 iqr_data 的 keys (舊邏輯)
                self.logger.warning(f"CSV 中找不到 ID 欄位 '{id_col}'，改用 IQR keys")
                product_ids = list(iqr_data.keys())

            for product_id in product_ids:
                # 取得對應的 IQR 資料，若無則為空字典
                current_iqr = iqr_data.get(product_id, {})
                
                # 若兩個分析都沒結果，且不需要強制輸出所有 CSV 行，可考慮 skip
                # 但通常會希望保留 context，所以還是產生 event
                
                self.logger.debug(f"處理產品 ID: {product_id}")
                
                event_data = self.create_event_id(
                    product_id,
                    csv_data,
                    current_iqr,
                    spe_t2_data,
                    raw_spe_t2_data,
                    id_col,
                    # extract_result
                )
                if event_data:
                    serialized_results.append(event_data)
            
            self.logger.info(f"序列化完成，共處理 {len(serialized_results)} 筆資料")
            return serialized_results
        
        except Exception as e:
            self.logger.error(f"處理檔案時發生錯誤: {e}")
            raise
    
    def save_results(self, results, output_path: str):
        """將序列化結果儲存為 JSON 檔案"""
        self.logger.debug(f"將序列化結果儲存至: {output_path}")
        try:
            with open(output_path, 'w', encoding='utf-8') as file:
                json.dump(results, file, ensure_ascii=False, indent=4)
            self.logger.info(f"序列化結果成功儲存至: {output_path}")
        except Exception as e:
            self.logger.error(f"儲存序列化結果時發生錯誤: {e}")
            raise