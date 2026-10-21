"""Offline syntax and local import closure check; standard library only, no imports executed."""
import ast
import importlib.util
import json
import sys
from pathlib import Path


GUARD_EXCEPTIONS = {"Exception", "ImportError", "ModuleNotFoundError"}


def _caught(handler):
    if handler.type is None:
        return None
    nodes = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    names = {n.id if isinstance(n, ast.Name) else None for n in nodes}
    return names if None not in names else None


def guarded_nodes(tree):
    """T13: nodes inside a try whose every handler names an import-style exception and ends by raising.

    A missing module then fails loudly at call time instead of silently; any other shape stays a build error.
    """
    guarded = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try) or not node.handlers:
            continue
        if all((_caught(h) or set()) and _caught(h) <= GUARD_EXCEPTIONS and h.body and isinstance(h.body[-1], ast.Raise)
               for h in node.handlers):
            guarded.update(id(child) for stmt in node.body for child in ast.walk(stmt))
    return guarded


def _text(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def declared_tables(tree):
    """Table names declared by `__tablename__ = "x"` or `Table("x", ...)`."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__tablename__" for t in node.targets):
            if _text(node.value):
                names.add(_text(node.value))
        elif isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", None)) == "Table" and node.args:
            if _text(node.args[0]):
                names.add(_text(node.args[0]))
    return names


def foreign_key_targets(tree):
    """(line, table) for every string `ForeignKey("table.column")`; SQLAlchemy resolves these only at startup."""
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", None)) == "ForeignKey" and node.args:
            parts = (_text(node.args[0]) or "").split(".")
            if len(parts) >= 2:
                found.append((node.lineno, parts[-2]))
    return found


def check(root, optional=None):
    """Raises on closed-import errors; guarded gaps are appended to `optional` (a list) instead of failing."""
    root = Path(root)
    modules = {}
    for path in sorted((root / "app").rglob("*.py")):
        relative = path.relative_to(root).with_suffix("")
        parts = relative.parts[:-1] if path.name == "__init__.py" else relative.parts
        name = ".".join(parts)
        source = path.read_text(encoding="utf-8-sig")
        compile(source, str(relative), "exec")
        modules[name] = (path, ast.parse(source))
    errors = []
    for name, (path, tree) in modules.items():
        guarded = guarded_nodes(tree)
        package = name if path.name == "__init__.py" else name.rpartition(".")[0]
        for node in ast.walk(tree):
            targets = []
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                target = node.module or ""
                if node.level:
                    target = importlib.util.resolve_name("." * node.level + target, package)
                targets = [target]
                if target in modules and modules[target][0].name == "__init__.py":
                    exports = {child.name for child in modules[target][1].body
                               if isinstance(child, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))}
                    for alias in node.names:
                        if alias.name != "*" and alias.name not in exports:
                            targets.append(target + "." + alias.name)
            for target in targets:
                if (target == "app" or target.startswith("app.")) and target not in modules:
                    if id(node) in guarded:
                        if optional is not None:
                            optional.append(f"{name}:{node.lineno}: optional {target}")
                    else:
                        errors.append(f"{name}:{node.lineno}: missing {target}")
    # T13: a string foreign key to a table no included model declares would only fail when the app starts.
    tables = set().union(*(declared_tables(tree) for _, tree in modules.values()))
    for name, (path, tree) in modules.items():
        for line, table in foreign_key_targets(tree):
            if table not in tables:
                errors.append(f"{name}:{line}: foreign key to missing table {table}")
    registry = root / "app/preview_registry.json"
    if registry.exists():
        for item in json.loads(registry.read_text(encoding="utf-8")):
            if item["module"] not in modules:
                errors.append(f"registry: missing {item['module']}")
    if errors:
        raise ValueError("\n".join(errors))
    return len(modules)


if __name__ == "__main__":
    optional = []
    count = check(sys.argv[1], optional)
    print(f"STATIC_OK: {count} Python modules; syntax and app imports closed")
    if optional:
        print("OPTIONAL_IMPORTS: " + json.dumps(optional, ensure_ascii=False))
