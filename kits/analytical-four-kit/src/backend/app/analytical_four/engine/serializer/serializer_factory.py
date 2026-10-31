import logging
from .ut_serializer import UTSerializer






class SerializerFactory:
    """序列化器工廠類別"""
    
    _serializers = {
        "UT": UTSerializer,
    }

    @classmethod
    def create_serializer(cls, data_type):
        """
        根據資料類型建立對應的序列化器
        
        Args:
            data_type: 資料類型 ("UT", ...)
        
        Returns:
            對應的序列化器實例
        """
        if data_type not in cls._serializers:
            raise ValueError(f"不支援的資料類型: {data_type}")
        
        return cls._serializers[data_type]()
    
    @classmethod
    def get_supported_types(cls):
        """取得支援的資料類型列表"""
        return list(cls._serializers.keys())
    
    @classmethod
    def register_serializer(cls, data_type, serializer_class):
        """註冊新的資料序列化器"""
        cls._serializers[data_type] = serializer_class