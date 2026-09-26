"""The analysis folder is a research tool. It must not reach the running service
or the deployed image. These tests need no analysis dependency and always run."""

import ast
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
SERVICE_MODULES = (
    "main.py",
    "worker.py",
    "scorer.py",
    "schemas.py",
    "config.py",
    "prompt.py",
    "cache.py",
    "retry.py",
    "rate_limit.py",
    "image_fetch.py",
    "providers/__init__.py",
    "providers/base.py",
    "providers/gemini.py",
    "providers/ollama.py",
    "providers/stub.py",
    "providers/throttled.py",
    "providers/openai_compatible.py",
    "providers/rotating.py",
    "providers/hosts.py",
)


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_service_modules_do_not_import_analysis():
    for name in SERVICE_MODULES:
        path = SERVICE_ROOT / name
        assert path.exists(), f"expected service module {name} to exist"
        assert "analysis" not in _imported_roots(path), (
            f"{name} imports the analysis package; the research layer must stay "
            "out of the running service"
        )


def test_analysis_requirements_file_is_separate():
    base = (SERVICE_ROOT / "requirements.txt").read_text(encoding="utf-8")
    extra = (SERVICE_ROOT / "requirements-analysis.txt").read_text(encoding="utf-8")
    for package in ("pandas", "scikit-learn", "catboost", "rapidfuzz"):
        assert package not in base, f"{package} must not be in requirements.txt"
        assert package in extra, f"{package} must be in requirements-analysis.txt"


def test_dockerfile_installs_only_the_service_requirements():
    dockerfile = (SERVICE_ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "pip install --no-cache-dir -r requirements.txt" in dockerfile
    assert "requirements-analysis" not in dockerfile


def test_every_service_module_is_covered_by_the_import_check():
    """A new module beside the service must not escape the analysis check."""
    on_disk = {
        path.name
        for path in SERVICE_ROOT.glob("*.py")
        if not path.name.startswith("test_")
    }
    assert on_disk == {name for name in SERVICE_MODULES if "/" not in name}

    providers = {f"providers/{path.name}" for path in (SERVICE_ROOT / "providers").glob("*.py")}
    assert providers == {name for name in SERVICE_MODULES if name.startswith("providers/")}


def test_dockerignore_excludes_the_research_layer():
    entries = {
        line.strip()
        for line in (SERVICE_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    for excluded in ("analysis", "tests", "requirements-analysis.txt"):
        assert excluded in entries, f".dockerignore must exclude {excluded}"
