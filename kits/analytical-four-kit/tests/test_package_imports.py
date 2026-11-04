"""The system package builder rejects `from package import Name` when the package only re-exports Name (services/preview/check_tree.py).
Its Node tests stub that check, so this is where the rule is kept for this Kit: import from the module that defines the name."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / 'src' / 'backend' / 'app'


def module_file(dotted: str):
    path = APP.parent.joinpath(*dotted.split('.'))
    if path.with_suffix('.py').is_file():
        return path.with_suffix('.py')
    return path / '__init__.py' if (path / '__init__.py').is_file() else None


def defined_in(tree: ast.Module) -> set:
    return {node.name for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))}


def test_no_import_goes_through_a_package_that_only_re_exports_the_name():
    problems = []
    for path in sorted(APP.rglob('*.py')):
        tree = ast.parse(path.read_text(encoding='utf-8-sig'))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.level or not (node.module or '').startswith('app.'):
                continue
            target = module_file(node.module)
            if target is None or target.name != '__init__.py':
                continue
            exports = defined_in(ast.parse(target.read_text(encoding='utf-8-sig')))
            for alias in node.names:
                if alias.name != '*' and alias.name not in exports and module_file(f'{node.module}.{alias.name}') is None:
                    problems.append(f'{path.relative_to(APP)}:{node.lineno}: {alias.name} comes through {node.module}')
    assert problems == []


def test_every_app_import_names_a_module_that_exists():
    missing = []
    for path in sorted(APP.rglob('*.py')):
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
            if isinstance(node, ast.ImportFrom) and not node.level and (node.module or '').startswith('app.analytical_four') and module_file(node.module) is None:
                missing.append(f'{path.relative_to(APP)}:{node.lineno}: {node.module}')
    assert missing == []
