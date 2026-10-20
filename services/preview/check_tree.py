"""Offline syntax and local import closure check; standard library only, no imports executed."""
import ast
import importlib.util
import json
import sys
from pathlib import Path


def check(root):
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
                    errors.append(f"{name}:{node.lineno}: missing {target}")
    registry = root / "app/preview_registry.json"
    if registry.exists():
        for item in json.loads(registry.read_text(encoding="utf-8")):
            if item["module"] not in modules:
                errors.append(f"registry: missing {item['module']}")
    if errors:
        raise ValueError("\n".join(errors))
    return len(modules)


if __name__ == "__main__":
    print(f"STATIC_OK: {check(sys.argv[1])} Python modules; syntax and app imports closed")
