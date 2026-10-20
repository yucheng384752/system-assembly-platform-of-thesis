"""Recipe validation and access policy; no database or web framework dependency."""
import copy
import json
import os
import re
import tempfile
from pathlib import Path

from jsonschema import Draft202012Validator


def validate_recipe(recipe, catalog, schema):
    errors = [f"{list(e.absolute_path)}: {e.message}"
              for e in Draft202012Validator(schema).iter_errors(recipe)]
    if errors:
        raise ValueError("; ".join(errors))
    enabled = set(recipe["enabledKits"])
    warnings = []
    for kit in sorted(enabled):
        item = catalog["kits"].get(kit)
        if item is None:
            errors.append(f"未知或已廢除 Kit：{kit}")
            continue
        if not item["available"]:
            warnings.append(f"{kit}：預覽無來源")
        elif not item["assembled"]:
            errors.append(f"{kit}：未納入此映像，請重新組裝")
        for dependency in item["dependencies"]:
            target = catalog["kits"].get(dependency)
            if target and not target["available"]:
                warnings.append(f"{kit} 依賴 {dependency}：預覽無來源，依賴未滿足")
            elif dependency not in enabled:
                errors.append(f"{kit} 缺少依賴 {dependency}")
    for kit, selected in recipe.get("selectedSubfeatures", {}).items():
        if kit not in enabled or kit not in catalog["kits"]:
            errors.append(f"子功能引用未選取或未知 Kit：{kit}")
            continue
        known = catalog["kits"][kit]["subfeatures"]
        for feature in selected:
            if feature not in known:
                errors.append(f"{kit} 未知子功能：{feature}")
    if errors:
        raise ValueError("; ".join(errors))
    return sorted(set(warnings))


def matches(template, path):
    parts = re.split(r"(\{[^{}]+\})", template.rstrip("/"))
    pattern = "".join("[^/]+" if p.startswith("{") else re.escape(p) for p in parts)
    return re.fullmatch(pattern + "/?", path) is not None


class Gate:
    def __init__(self, catalog, schema, state_path, initial=None):
        self.catalog = catalog
        self.schema = schema
        self.state_path = Path(state_path)
        self.recipe = None
        self.warnings = []
        self.routes = []
        # Persisted null explicitly means all, including after deleting an image's initial Recipe.
        candidate = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else initial
        if candidate is not None:
            self.warnings = validate_recipe(candidate, catalog, schema)
            self.recipe = copy.deepcopy(candidate)

    def replace(self, recipe):
        candidate = copy.deepcopy(recipe)
        warnings = validate_recipe(candidate, self.catalog, self.schema) if candidate is not None else []
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".recipe-", dir=self.state_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(candidate, stream, ensure_ascii=False, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.state_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        self.recipe, self.warnings = candidate, warnings

    def deny(self, kit, capability=None):
        item = self.catalog["kits"].get(kit)
        reason = None
        if item is None:
            reason = "未知路由或能力，預設拒絕"
        elif not item["available"]:
            reason = "預覽無來源"
        elif not item["assembled"]:
            reason = "未納入此映像"
        elif self.recipe is not None:
            if kit not in self.recipe["enabledKits"]:
                reason = "Kit 未開放"
            else:
                bound = self.catalog["capabilities"].get(capability, {}).get("subfeatures", [])
                if bound and not any(
                    b["kit"] in self.recipe["enabledKits"] and b["feature"] in
                    self.recipe.get("selectedSubfeatures", {}).get(b["kit"], [
                        f for f, default in self.catalog["kits"][b["kit"]]["subfeatures"].items() if default])
                    for b in bound
                ):
                    reason = "子功能未開放"
        return {"detail": reason, "capability": capability, "kit": kit} if reason else None

    def capability(self, capability):
        return self.deny(self.catalog["capabilities"].get(capability, {}).get("kit"), capability)

    def request(self, method, path):
        if path == "/healthz" or path.startswith("/_preview/"):
            return None
        broker = "/api/kit/call/"
        if path.startswith(broker):
            return self.deny("platform-core-kit") or self.capability(path[len(broker):].rstrip("/"))
        candidates = [(identifier, item) for identifier, item in self.catalog["capabilities"].items()
                      if item.get("method") == method and item.get("path") and matches(item["path"], path)]
        if candidates:
            # Literal routes win over parameter routes, like the registry's static endpoints.
            candidates.sort(key=lambda pair: (pair[1]["path"].count("{"), -len(pair[1]["path"])))
            identifier, item = candidates[0]
            return self.deny(item["kit"], identifier)
        for route in self.routes:
            if method in route["methods"] and matches(route["path"], path):
                return self.deny(route["kit"])
        return self.deny(None)

    def snapshot(self):
        allowed, denied = [], []
        for identifier in sorted(self.catalog["capabilities"]):
            rejection = self.capability(identifier)
            if rejection:
                denied.append(rejection)
            else:
                allowed.append(identifier)
        enabled = self.recipe["enabledKits"] if self.recipe else [
            kit for kit, item in self.catalog["kits"].items() if item["assembled"]]
        return {"mode": "recipe" if self.recipe else "all", "enabledKits": enabled,
                "selectedSubfeatures": self.recipe.get("selectedSubfeatures", {}) if self.recipe else {},
                "allowed": allowed, "denied": denied,
                "unavailable": [{"kit": kit, "reason": "預覽無來源"} for kit, item in self.catalog["kits"].items()
                                if not item["available"]],
                "warnings": self.warnings}


active_gate = None


def require_access(kit, capability=None):
    # Delayed import keeps validation usable offline without FastAPI.
    from fastapi import HTTPException
    rejection = active_gate.capability(capability) if active_gate and capability else (
        active_gate.deny(kit) if active_gate else {"detail": "預覽閘門尚未初始化", "kit": kit, "capability": capability})
    if rejection:
        raise HTTPException(status_code=403, detail=rejection)


class GateMiddleware:
    def __init__(self, app, gate):
        self.app, self.gate = app, gate

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            rejection = self.gate.request(scope["method"], scope["path"])
            if rejection:
                body = json.dumps(rejection, ensure_ascii=False).encode()
                await send({"type": "http.response.start", "status": 403,
                            "headers": [(b"content-type", b"application/json; charset=utf-8")]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


if __name__ == "__main__":
    import sys
    data = json.load(sys.stdin)
    try:
        print(json.dumps(validate_recipe(data["recipe"], data["catalog"], data["schema"]), ensure_ascii=False))
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
