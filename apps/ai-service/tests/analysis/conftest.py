"""Skip the analysis test directory when the research dependencies are absent.

`pytest.ini` sets `testpaths = tests`, so a plain `pytest` run in the service
environment would try to collect these files and fail at import on `pandas`.
`collect_ignore_glob` is the supported pytest mechanism for conditional
collection: it runs before any test module is imported.
"""

import importlib.util
import warnings

collect_ignore_glob: list[str] = []

if importlib.util.find_spec("pandas") is None:
    collect_ignore_glob = ["test_*.py"]
    warnings.warn(
        "Skipping apps/ai-service/tests/analysis: the research dependencies are "
        "not installed. Run `pip install -r requirements-analysis.txt` and then "
        "`pnpm test:analysis` to execute them.",
        stacklevel=1,
    )
