"""Offline research and analysis for the IELTS assessment benchmark.

This package is a thesis research tool. It is deliberately NOT part of the
running service: nothing in main.py or worker.py imports it, and its
dependencies live in requirements-analysis.txt, which the deployed image
never installs.

Entry point:  python -m analysis.report --csv <export.csv>
"""

__all__ = ["load", "agreement", "feedback_divergence", "catboost_eval", "report"]
