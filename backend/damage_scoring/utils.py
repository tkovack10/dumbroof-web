"""Shared utilities for damage scoring modules."""


def get_all_forensic_text(config: dict) -> str:
    """Combine all text fields from forensic findings into one searchable string.
    Result is cached on config['_forensic_text'] to avoid recomputation."""
    cached = config.get("_forensic_text")
    if cached is not None:
        return cached

    forensic = config.get("forensic_findings", {})
    parts = []
    # Narrative fields
    for key in ("damage_summary", "recommended_scope"):
        val = forensic.get(key, "")
        if isinstance(val, str):
            parts.append(val)
    # List-of-string fields (key_arguments, conclusion_findings)
    for key in ("key_arguments", "conclusion_findings"):
        val = forensic.get(key, [])
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str):
                    parts.append(item)
    # List-of-dict fields
    for key in ("critical_observations", "damage_thresholds", "differentiation_table"):
        val = forensic.get(key, [])
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    parts.extend(str(v) for v in item.values())

    result = " ".join(parts).lower()
    config["_forensic_text"] = result
    return result
