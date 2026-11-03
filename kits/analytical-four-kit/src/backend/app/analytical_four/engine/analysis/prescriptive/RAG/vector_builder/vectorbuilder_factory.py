from .intfloat_vectorbuilder import IntFloatVectorBuilder
from .sentence_transformers_vectorbilder import SenTransVectorBuilder
from .base_vectorbuilder import BaseVectorBuilder

class VectorBuilderFactory:
    """模型名稱創建對應的工廠類別"""
    
    # 註冊可用的 VectorBuilder 類別
    _VECTOR_BUILDERS_ = {
        "intfloat/multilingual-e5-large-instruct": IntFloatVectorBuilder,
        # 確保 key 和 SenTransVectorBuilder 中的 model_name 一致
        "paraphrase-multilingual-minilm-l12-v2": SenTransVectorBuilder 
    }
    
    @classmethod
    def create(
        cls, 
        builder_type: str, 
        db_path: str = "./chroma_db", 
        collection_name: str = "knowledge_base") -> BaseVectorBuilder:
        """
        根據指定的類型創建 VectorBuilder
        
        Args:
            builder_type (str): VectorBuilder 的類型名稱
            db_path (str): ChromaDB 儲存路徑
            collection_name (str): ChromaDB 集合名稱
        
        Returns:
            BaseVectorBuilder: 對應的 VectorBuilder
        """
        builder_class = cls._VECTOR_BUILDERS_.get(builder_type.lower())
        
        if builder_class is None:
            available_types = ", ".join(cls._VECTOR_BUILDERS_.keys())
            raise ValueError(
                f"未知的 VectorBuilder 類型: '{builder_type}'. "
                f"可用類型: {available_types}"
            )
        
        # 傳入 db_path 和 collection_name
        return builder_class(db_path=db_path, collection_name=collection_name)
    
    @classmethod
    def get_available_builders(cls) -> list[str]:
        return list(cls._VECTOR_BUILDERS_.keys())
    
    @classmethod
    def register(cls, name: str, builder_class: type[BaseVectorBuilder]) -> None:
        if not issubclass(builder_class, BaseVectorBuilder):
            raise TypeError(
                f"{builder_class.__name__} 必須繼承自 BaseVectorBuilder"
            )
        cls._VECTOR_BUILDERS_[name.lower()] = builder_class