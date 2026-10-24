"""Strict reader for schemas/entry-points.schema.json; no runtime Kit discovery."""
import json
import re
from pathlib import Path

from .policy import allows, builtin_admin

# D128: the MOD webhook has no user token; the endpoint verifies X-Mod-Webhook-Secret itself, and a system package
# that includes mod-subscription-kit must require MOD_WEBHOOK_SECRET (the baseline only checks it when set).
PUBLIC = {"/healthz": "GET", "/api/auth/login": "POST", "/api/mod/subscriptions/webhook": "POST"}


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def _fields(value, names):
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise ValueError("Invalid directory fields")


def _string(value, pattern, maximum, minimum=1):
    if (not isinstance(value, str) or not minimum <= len(value) <= maximum
            or re.fullmatch(pattern, value) is None):
        raise ValueError("Invalid directory string")


def _array(value, maximum, minimum=0):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError("Invalid directory array")


def _path_pattern(path):
    _string(path, r"/[A-Za-z0-9._/{}-]*", 200)
    parts = path.split("/")
    names = set()
    patterns = []
    for part in parts:
        if "{" in part or "}" in part:
            if not re.fullmatch(r"\{[A-Za-z_][A-Za-z0-9_]*\}", part) or part in names:
                raise ValueError("Invalid path parameter")
            names.add(part)
            patterns.append("[^/]+")
        else:
            patterns.append(re.escape(part))
    return re.compile("/".join(patterns))


class Directory:
    def __init__(self, document):
        _fields(document, "format version entryPoints publicPaths")
        if document["format"] != "composer-entry-points" or type(document["version"]) is not int or document["version"] != 1:
            raise ValueError("Unsupported entry directory")
        _array(document["publicPaths"], 20)
        for path in document["publicPaths"]:
            _string(path, r"/[A-Za-z0-9._/{}-]*", 200)
            if path not in PUBLIC:
                raise ValueError("Public path is outside the authentication exceptions")
        if len(set(document["publicPaths"])) != len(document["publicPaths"]):
            raise ValueError("Duplicate public path")
        _array(document["entryPoints"], 300)
        self.document = document
        self.entries = {}
        self.routes = []
        for entry in document["entryPoints"]:
            _fields(entry, "key label access defaultRoles kitId routes")
            _string(entry["key"], r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*", 100)
            if entry["key"] in self.entries:
                raise ValueError("Duplicate entry-point key")
            _string(entry["label"], r"[\s\S]+", 100)
            _string(entry["kitId"], r"[a-z0-9-]+", 100)
            if entry["access"] not in ("read", "write"):
                raise ValueError("Invalid access")
            _array(entry["defaultRoles"], 50)
            for role in entry["defaultRoles"]:
                _string(role, r"[a-z][a-z0-9_]*", 50)
            if len(set(entry["defaultRoles"])) != len(entry["defaultRoles"]):
                raise ValueError("Duplicate default role")
            _array(entry["routes"], 50, 1)
            for route in entry["routes"]:
                _fields(route, "capability method path")
                _string(route["capability"], r"[a-z0-9._-]+", 100)
                if route["method"] not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    raise ValueError("Invalid route method")
                self.routes.append((route["method"], _path_pattern(route["path"]), entry))
            self.entries[entry["key"]] = entry

    @classmethod
    def load(cls, path):
        return cls(json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_object))

    def is_public(self, method, path):
        return path in self.document["publicPaths"] and PUBLIC.get(path) == method

    def matching(self, method, path):
        return {entry["key"]: entry for verb, pattern, entry in self.routes
                if method == verb and pattern.fullmatch(path)}

    def entry_allowed(self, entry, actor, grants, overrides):
        return allows(active=actor.is_active, readonly=actor.role.is_readonly,
                      role_name=actor.role.name, access=entry["access"],
                      default_roles=entry["defaultRoles"],
                      override=overrides.get(entry["key"]), role_grant=grants.get(entry["key"]))

    def request_allowed(self, method, path, actor, grants, overrides):
        matches = self.matching(method, path)
        if not matches:
            return actor.is_active and builtin_admin(actor.role.name, actor.role.is_builtin)
        # Multiple matching declarations cannot weaken one another's restrictions.
        return all(self.entry_allowed(entry, actor, grants, overrides) for entry in matches.values())
