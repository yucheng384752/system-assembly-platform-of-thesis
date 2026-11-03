from .vector_builder.vectorbuilder_factory import VectorBuilderFactory


def feature_rag_analysis(rag_builder: VectorBuilderFactory, event: dict, top_k: int = 1):
        event_features = []
        seen = set()

        def normalize_feature_name(entry):
            if isinstance(entry, dict):
                return entry.get("feature")
            return entry
        
        def add_features(features):
            for f in features:
                feature_name = normalize_feature_name(f)
                if not feature_name:
                    continue
                if feature_name not in seen:
                    seen.add(feature_name)
                    event_features.append(feature_name)
        
        add_features(event["detected_by_IQR"].keys())
        add_features(event["ranked_features"]["T2_feature"])
        add_features(event["ranked_features"]["SPE_feature"])
        
        
        feature_docs = {}
        for feature in event_features:
            results = rag_builder.query(feature, top_k=top_k)
            result_docs = results['documents']
            
            if result_docs and result_docs[0]:
                    feature_docs[feature] = result_docs[0]
            else:
                feature_docs[feature] = []
        return feature_docs