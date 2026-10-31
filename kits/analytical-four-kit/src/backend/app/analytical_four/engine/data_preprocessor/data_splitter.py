import pandas as pd
import logging
from typing import List, Union, Any




class DataSplitter:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    def _execute_split(self, data: pd.DataFrame, group_by_col: str, temp_col_name: str = None) -> List[pd.DataFrame]:
        """執行通用的分組操作並返回結果列表。"""
        split_results: List[pd.DataFrame] = []
        data_to_split = data.copy()
        
        for _, group in data_to_split.groupby(group_by_col):
            # 移除臨時分組欄位 (如果存在)
            if temp_col_name and temp_col_name in group.columns:
                group = group.drop(columns=[temp_col_name])
                
            split_results.append(group.copy())
            
        self.logger.info(f"Splitting completed. Total {len(split_results)} groups created.")
        return split_results

    def split_for_timestamp(
        self,
        data: pd.DataFrame,
        target: str,
        num_segments: int = 2
    ) -> List[pd.DataFrame]:
        
        self.logger.debug("Splitting data based on timestamp target column using pd.qcut.")
        temp_col_name = "__temp_qcut_group"
        
        # 1. 嘗試轉換為 datetime 格式
        try:
            # 確保欄位是 datetime 類型
            dt_series = pd.to_datetime(data[target])
        except Exception as e:
            self.logger.error(f"Cannot convert target column '{target}' to datetime: {e}")
            raise TypeError(f"Target column '{target}' conversion to datetime failed.")
        
        # 2. 根據時間點的數量（等量）分割資料 (qcut)
        try:
            grouping_column = pd.qcut(
                dt_series.astype(int), # 將 datetime 轉為 int (納秒級別的時間戳)
                q=num_segments,
                duplicates='drop' # 處理邊界日期重複的情況
            ).astype(str)
        except ValueError as e:
            self.logger.error(f"pd.qcut failed: {e}. Check if num_segments is too large relative to unique values.")
            # 如果 qcut 失敗 (例如數據值太少)，退化為直接按唯一值分組
            self.logger.warning("Qcut failed, falling back to direct unique value split.")
            return self._execute_split(data, target)

        # 3. 創建帶有臨時分組欄位的 DataFrame
        data_to_split = data.assign(**{temp_col_name: grouping_column})
        
        # 4. 執行分組並返回結果
        return self._execute_split(data_to_split, temp_col_name, temp_col_name)

    def split(self, data: pd.DataFrame, target: str, num_segments: int = 2, threshold: int = 5) -> List[pd.DataFrame]:
        
        if target not in data.columns:
            raise ValueError(f"Target column '{target}' not found in data.")
        
        # 檢查是否為日期時間類型，如果是，使用專門的分割邏輯
        if pd.api.types.is_datetime64_any_dtype(data[target]):
            return self.split_for_timestamp(data, target, num_segments)
        
        # 檢查是否為高基數數值型
        is_numeric = pd.api.types.is_numeric_dtype(data[target])
        is_high_cardinality = is_numeric and data[target].nunique() > threshold

        if is_high_cardinality:
            self.logger.warning(
                f"The number of unique values in target column '{target}' ({data[target].nunique()}) "
                f"exceeds the threshold ({threshold}). Treating as high-cardinality data. "
                "Consider using pd.cut (等寬分箱) instead of direct unique value split."
            )
            
        # 處理所有其他類型 (低基數數值、分類型)
        return self._execute_split(data, target)




if __name__ == '__main__':
    import io
    csv_data = """timestamp,type,location,LOT NO.,P1.Specification,P1.Material,Semi-finished Sheet Width(mm),Semi-finished Length(M),Weight(Kg),Actual Temp_C1(℃),Actual Temp_C2(℃),Actual Temp_C3(℃),Actual Temp_C4(℃),Actual Temp_C5(℃),Actual Temp_C6(℃),Actual Temp_C7(℃),Actual Temp_C8(℃),Set Temp_C1(℃),Set Temp_C2(℃),Set Temp_C3(℃),Set Temp_C4(℃),Set Temp_C5(℃),Set Temp_C6(℃),Set Temp_C7(℃),Set Temp_C8(℃),Actual Temp_A bucket(℃),Set Temp_A bucket(℃),Actual Temp_Top(℃),Actual Temp_Mid(℃),Actual Temp_Bottom(℃),Set Temp_Top(℃),Set Temp_Mid(℃),Set Temp_Bottom(℃),Line Speed(M/min),Current(A),Extruder Speed (rpm),Frame (cm),Machine_No.,Semi_No.,format,P2.Material,Semi-finished No.,Slitting date,Slitting machine,Semi-finished impedance,Heat gun temperature,Rubber wheel gasket thickness (in),Rubber wheel gasket thickness (out),Rewind torque,Slitting speed,Meters completed,Winder number,Board Width(mm),Thicknessss High(μm),Thicknessss Low(μm),Appearance,rough edge,Striped Results,Thickness diff,Qaulity inspecrion,Qaulity control,P3.Specification,BottomTape,Machine No.,Mold No.,pasteirontemp,blowirontemp,firstAsize,lastAsize,firstBsize,lastBsize,Lot_No.,EValue,10PO,Burr,Shift,Iron,Mold,RubberWheel,glue,lot,AdjustmentRecord,Finish,operator,Produce_No.,Specification
20250930,ut,P1+P2+P3,2508283_01,0.32mm,H5,167.0,1450.0,76.0,195.0,195.0,194.0,196.0,194.0,196.0,195.0,192.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,75.0,75.0,24.0,24.0,24.0,24.0,24.0,24.0,15.0,42.22,60.7,13.5,3,01,PE32,H5,2508283_01,20250925_15_54,1.0,1000000000.0,0.0,8.5,10.2,0.0,60.0,1466.0,5.0,7.996,326.0,311.0,1.0,1.0,1.0,15.0,ronie,ling,PE32,MT6000,P02,238-5,235,175,0.475,0.471,0.667,0.672,2508283_01_05,990,1,5,1,1,1,1,3,301,1,1,anna,20250930_P02_238-5_301,
20250930,ut,P1+P2+P3,2508283_01,0.32mm,H5,167.0,1450.0,76.0,195.0,195.0,194.0,196.0,194.0,196.0,195.0,192.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,75.0,75.0,24.0,24.0,24.0,24.0,24.0,24.0,15.0,42.22,60.7,13.5,3,01,PE32,H5,2508283_01,20250925_15_54,1.0,1000000000.0,0.0,8.5,10.2,0.0,60.0,1466.0,7.0,7.987,320.0,308.0,1.0,1.0,1.0,12.0,ronie,ling,PE32,MT6000,P02,238-5,235,175,0.475,0.471,0.667,0.672,2508283_01_07,990,1,6,1,1,1,1,3,302,1,1,anna,20250930_P02_238-5_302,
20250901,ut,P1+P2+P3,2507173_02,0.32mm,H5,167.0,4320.0,239.0,195.0,195.0,195.0,197.0,196.0,193.0,195.0,196.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,75.0,75.0,24.0,24.0,24.0,24.0,24.0,24.0,16.0,41.77,61.65,13.5,3,02,PE32,H5,2507173_02,20250820_11_00,1.0,10000000000.0,0.0,8.5,10.2,0.0,60.0,4375.0,10.0,7.977,321.0,310.0,1.0,1.0,1.0,11.0,ronie,ling,PE32,MT6000,P02,238-5,235,175,0.469,0.478,0.667,0.662,2507173_02_10,990,1,4,1,1,1,1,3,301,1,1,anna,20250901_P02_238-5_301,
20250901,ut,P1+P2+P3,2507173_02,0.32mm,H5,167.0,4320.0,239.0,195.0,195.0,195.0,197.0,196.0,193.0,195.0,196.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,195.0,75.0,75.0,24.0,24.0,24.0,24.0,24.0,24.0,16.0,41.77,61.65,13.5,3,02,PE32,H5,2507173_02,20250820_11_00,1.0,10000000000.0,0.0,8.5,10.2,0.0,60.0,4375.0,13.0,7.99,328.0,314.0,1.0,1.0,1.0,14.0,ronie,ling,PE32,MT6000,P03,238-5,235,175,0.465,0.467,0.668,0.671,2507173_02_13,990,1,5,1,1,1,1,3,301,1,1,anna,20250901_P03_238-5_301,"""
    
    # 讀取數據，假設 'timestamp' 欄位是日期時間
    # 🌟 關鍵：確保 timestamp 欄位在讀取後是字串，以讓 pd.to_datetime(..., format='%Y%m%d') 正確解析
    data = pd.read_csv(io.StringIO(csv_data), dtype={'timestamp': str})
    
    splitter = DataSplitter()
    
    # 將數據依照時間點數量切分成 2 等份
    print("\n--- 等數量切分 (num_segments=2) ---")
    equal_freq_groups = splitter.split(data, target='timestamp', num_segments=2)
    
    # print(f"分組數量: {len(equal_freq_groups)}") 
    
    # 驗證結果
    for i, group in enumerate(equal_freq_groups):
        # 🌟 修正後的驗證：在驗證時將原始字串欄位轉換為 datetime
        min_date = pd.to_datetime(group['timestamp'], format='%Y%m%d').min().strftime('%Y-%m-%d')
        max_date = pd.to_datetime(group['timestamp'], format='%Y%m%d').max().strftime('%Y-%m-%d')
        print(f"Group {i+1}: Rows={len(group)} (日期範圍: {min_date} 到 {max_date})")