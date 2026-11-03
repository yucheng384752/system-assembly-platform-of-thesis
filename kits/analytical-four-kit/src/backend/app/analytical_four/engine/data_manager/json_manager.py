import json
from .base_manager import BaseDataManager

class JSONDataManager(BaseDataManager):

    def __init__(self, file_path=None):
        self.file_path = file_path

    def load(self, input_path=None):
        try:
            if input_path is None:
                input_path = self.file_path
            with open(input_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return self._response(True, "JSON loaded", data)
        except Exception as e:
            return self._response(False, f"JSON load failed: {e}", None)

    def save(self, data, output_path=None):
        try:
            if output_path is None:
                output_path = self.file_path
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            return self._response(True, "JSON saved")
        except Exception as e:
            return self._response(False, f"JSON save failed: {e}")

    def update(self, new_data):
        try:
            load_res = self.load()
            if not load_res["success"]:
                return load_res

            data = load_res["data"]
            data.update(new_data)
            return self.save(data)

        except Exception as e:
            return self._response(False, f"JSON update failed: {e}")

    def delete(self, key):
        try:
            load_res = self.load()
            if not load_res["success"]:
                return load_res

            data = load_res["data"]

            if key not in data:
                return self._response(False, f"Key '{key}' not found", None)

            del data[key]
            save_res = self.save(data)

            if save_res["success"]:
                return self._response(True, f"Key '{key}' deleted", key)
            else:
                return save_res

        except Exception as e:
            return self._response(False, f"JSON delete failed: {e}")

    def select(self, data, sel_cols):
        try:
            if sel_cols:
                self.logger.debug(f"selected columns: {sel_cols}")

                if isinstance(data, dict):
                    all_cols = data.keys()
                elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                    all_cols = set().union(*(item.keys() for item in data))
                else:
                    return self._response(False, "Unsupported JSON format", None)

                missing = [c for c in sel_cols if c not in all_cols]
                if missing:
                    self.logger.warning(f"those columns are missing and ignored: {missing}")

                selected_cols = [c for c in sel_cols if c in all_cols]

                if isinstance(data, dict):
                    selected_data = {c: data.get(c) for c in selected_cols}
                else:
                    selected_data = [
                        {c: item.get(c) for c in selected_cols}
                        for item in data
                    ]

            return self._response(True, "JSON select success", selected_data)

        except Exception as e:
            return self._response(False, f"JSON select failed: {e}", None)