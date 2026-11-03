import pandas as pd
from .base_manager import BaseDataManager
import logging

class CSVDataManager(BaseDataManager):

    def __init__(self, file_path=None):
        self.file_path = file_path
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    def load(self, input_path=None):
        try:
            if input_path is None:
                input_path = self.file_path
            df = pd.read_csv(input_path)
            return self._response(True, "CSV loaded", df)
        except Exception as e:
            return self._response(False, f"CSV load failed: {e}", None)

    def save(self, data, output_path=None):
        try:
            if output_path is None:
                output_path = self.file_path
            data.to_csv(output_path, index=False)
            return self._response(True, "CSV saved")
        except Exception as e:
            return self._response(False, f"CSV save failed: {e}")

    def update(self, new_data):
        try:
            load_res = self.load()
            if not load_res["success"]:
                return load_res

            df = load_res["data"]
            df = pd.concat([df, new_data], ignore_index=True)
            return self.save(df)

        except Exception as e:
            return self._response(False, f"CSV update failed: {e}")

    def delete(self, condition):
        try:
            load_res = self.load()
            if not load_res["success"]:
                return load_res

            df = load_res["data"]
            original_len = len(df)

            # 保留不符合 condition 的列（＝刪除符合條件的列）
            df = df[~df.apply(condition, axis=1)]

            deleted_count = original_len - len(df)

            save_res = self.save(df)
            if save_res["success"]:
                return self._response(
                    True,
                    f"CSV delete success, deleted {deleted_count} rows",
                    deleted_count
                )
            else:
                return save_res

        except Exception as e:
            return self._response(False, f"CSV delete failed: {e}")

    def select(self, data, sel_cols):
        try:
            if sel_cols:
                self.logger.debug(f"selected columns: {sel_cols}")
                missing = [c for c in sel_cols if c not in data.columns]
                if missing:
                    self.logger.warning(f"those columns are missing and ignored: {missing}")
                selected_cols = [c for c in sel_cols if c in data.columns]
                selected_data = data[selected_cols]
            return self._response(True, "CSV select success", selected_data)
        except Exception as e:
            return self._response(False, f"CSV select failed: {e}", None)
    
    # 清除有缺失值的列
    def drop_empty_rows(self, data):
        try:
            cleaned_data = data.dropna(axis=0, how='any')
            dropped_count = len(data) - len(cleaned_data)
            self.logger.info(f"Dropped {dropped_count} empty rows")
            return self._response(True, "CSV drop_empty_rows success", cleaned_data)
        except Exception as e:
            return self._response(False, f"CSV drop_empty_rows failed: {e}", None)
    
    # 清除全為空值的欄
    def drop_empty_columns(self, data):
        try:
            cleaned_data = data.dropna(axis=1, how='all')
            dropped_count = len(data.columns) - len(cleaned_data.columns)
            self.logger.info(f"Dropped {dropped_count} empty columns")
            return self._response(True, "CSV drop_empty_columns success", cleaned_data)
        except Exception as e:
            return self._response(False, f"CSV drop_empty_columns failed: {e}", None)