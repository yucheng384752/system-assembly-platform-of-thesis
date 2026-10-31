from abc import ABC, abstractmethod

class BaseDataManager(ABC):

    def _response(self, success, message, data=None):
        return {
            "success": success,
            "message": message,
            "data": data
        }

    @abstractmethod
    def load(self, input_path):
        pass

    @abstractmethod
    def save(self, data, output_path):
        pass

    @abstractmethod
    def update(self, data):
        pass

    @abstractmethod
    def delete(self, condition):
        pass
    
    @abstractmethod
    def select(self, data, sel_cols):
        pass
