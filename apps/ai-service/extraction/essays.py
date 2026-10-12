"""From raw file contents to a list of essays, with the model only pointing.

The model never rewrites an essay. For documents it returns line ranges and for
spreadsheets a column mapping; code then cuts the student's exact words out of
the source. A hallucinated or "corrected" essay would be graded as if the
student wrote it, so the text itself must never pass through the model.
"""

import logging
import re
from dataclasses import asdict, dataclass, field

from pydantic import BaseModel

from extraction.llm import ExtractionLLM, Image

logger = logging.getLogger(__name__)

TRANSCRIBE_CHUNK = 8  # images per vision call
PREVIEW_ROWS = 15
PREVIEW_CELL_CHARS = 80
MIN_ESSAY_WORDS = 30


@dataclass
class Essay:
    essay_text: str
    student_label: str | None = None
    task_type: str | None = None
    task_prompt: str | None = None
    ref: dict = field(default_factory=dict)

    def to_payload(self) -> dict:
        d = asdict(self)
        return {
            "essayText": d["essay_text"],
            "studentLabel": d["student_label"],
            "taskType": d["task_type"],
            "taskPrompt": d["task_prompt"],
            "ref": d["ref"],
        }


def words(text: str) -> int:
    return len(text.split())


def normalize_task_type(value: str | None) -> str | None:
    if not value:
        return None
    v = value.lower().replace("_", " ").strip()
    if v == "1" or re.search(r"\btask\s*1\b", v):
        return "task_1"
    if v == "2" or re.search(r"\btask\s*2\b", v):
        return "task_2"
    return None


# ---------------------------------------------------------------- images / OCR


async def transcribe_all(llm: ExtractionLLM, images: list[Image]) -> tuple[list[str], str]:
    """Page transcripts in order, plus the task question if one was visible."""
    pages: list[str] = []
    prompt = ""
    for i in range(0, len(images), TRANSCRIBE_CHUNK):
        chunk = images[i : i + TRANSCRIBE_CHUNK]
        result = await llm.transcribe(chunk)
        if len(result.pages) != len(chunk):
            raise ValueError(f"Transcriber returned {len(result.pages)} pages for {len(chunk)} images")
        pages.extend(p.strip() for p in result.pages)
        prompt = prompt or result.task_prompt.strip()
    return pages, prompt


async def essay_from_images(llm: ExtractionLLM, images: list[Image], label: str | None) -> list[Essay]:
    """Several photos of one essay (pages in order) become one essay."""
    pages, prompt = await transcribe_all(llm, images)
    text = "\n\n".join(p for p in pages if p)
    if not text:
        raise ValueError("No text could be read from the image")
    return [Essay(essay_text=text, student_label=label, task_prompt=prompt or None, ref={"pages": len(images)})]


# ------------------------------------------------------------------ documents

SPLIT_SYSTEM = """
You receive a document whose lines are numbered like "L12: text". It holds one or
more IELTS Writing answers, possibly with the task question, student names, class
headers or page numbers around them. Find every student answer and return its
first and last line number. For each answer also give the student's name or ID if
the document shows one, the task type ("task_1", "task_2" or "" if unclear), and
the line range of the task question if it appears (-1 when it does not).
Do not include names, headers or the question inside an answer's line range.
"""


class Segment(BaseModel):
    start_line: int
    end_line: int
    student_label: str = ""
    task_type: str = ""
    prompt_start_line: int = -1
    prompt_end_line: int = -1


class Segmentation(BaseModel):
    essays: list[Segment]


def _slice(lines: list[str], start: int, end: int) -> str:
    return "\n".join(lines[start : end + 1]).strip()


def segments_to_essays(lines: list[str], seg: Segmentation, source: str) -> list[Essay]:
    essays = []
    for i, s in enumerate(seg.essays):
        if not (0 <= s.start_line <= s.end_line < len(lines)):
            raise ValueError(f"Answer {i + 1} has line range {s.start_line}-{s.end_line} outside 0-{len(lines) - 1}")
        prompt = None
        if 0 <= s.prompt_start_line <= s.prompt_end_line < len(lines):
            prompt = _slice(lines, s.prompt_start_line, s.prompt_end_line) or None
        text = _slice(lines, s.start_line, s.end_line)
        if text:
            essays.append(
                Essay(
                    essay_text=text,
                    student_label=s.student_label.strip() or None,
                    task_type=normalize_task_type(s.task_type),
                    task_prompt=prompt,
                    ref={"source": source, "lines": [s.start_line, s.end_line]},
                )
            )
    if not essays:
        raise ValueError("No answers found")
    return essays


async def split_document(llm: ExtractionLLM, text: str, source: str) -> list[Essay]:
    """One or many essays from a document's text. Falls back to the whole
    text as one essay if the model is unavailable or answers nonsense."""
    lines = text.splitlines()
    numbered = "\n".join(f"L{i}: {line}" for i, line in enumerate(lines))
    try:
        data = await llm.complete_json(SPLIT_SYSTEM, numbered, Segmentation)
        return segments_to_essays(lines, Segmentation.model_validate(data), source)
    except NotImplementedError:
        pass
    except Exception as exc:  # the fallback below keeps the essay, so a bad split never loses it
        logger.warning(f"Document split failed for {source}, keeping it as one essay: {exc}")
    return [Essay(essay_text=text.strip(), ref={"source": source})]


# --------------------------------------------------------------- spreadsheets

MAP_SYSTEM = """
You map a teacher's spreadsheet of IELTS Writing answers onto columns. The
spreadsheet may be messy: title rows, merged headers, Vietnamese column names,
blank rows. Rows are numbered from 0 and columns are written [C0], [C1], ...
Return: the sheet that holds the answers; header_row, the row holding column
names (-1 if none); essay_col, the column with the students' full written
answers; and when present name_col (student name or ID), prompt_col (the task
question) and task_type_col (Task 1 / Task 2). Use -1 for a column that does
not exist.
"""


class SheetMapping(BaseModel):
    sheet: str
    header_row: int
    essay_col: int
    name_col: int = -1
    prompt_col: int = -1
    task_type_col: int = -1


def preview(sheets: dict[str, list[list[str]]]) -> str:
    out = []
    for name, rows in sheets.items():
        out.append(f'Sheet "{name}" ({len(rows)} rows)')
        for r, row in enumerate(rows[:PREVIEW_ROWS]):
            cells = " | ".join(f"[C{c}] {v[:PREVIEW_CELL_CHARS]}" for c, v in enumerate(row) if v)
            out.append(f"R{r}: {cells}")
    return "\n".join(out)


def _col(row: list[str], c: int) -> str:
    return row[c] if 0 <= c < len(row) else ""


def validate_mapping(m: SheetMapping, sheets: dict[str, list[list[str]]]) -> str | None:
    """Why the mapping is unusable, or None when it is fine."""
    rows = sheets.get(m.sheet)
    if rows is None:
        return f'There is no sheet called "{m.sheet}". Sheets: {list(sheets)}'
    width = max((len(r) for r in rows), default=0)
    for label, c in (("essay_col", m.essay_col), ("name_col", m.name_col), ("prompt_col", m.prompt_col), ("task_type_col", m.task_type_col)):
        if c >= width or c < -1 or (label == "essay_col" and c < 0):
            return f"{label}={c} is outside the sheet's columns 0-{width - 1}"
    if not -1 <= m.header_row < len(rows):
        return f"header_row={m.header_row} is outside rows -1-{len(rows) - 1}"
    cells = [_col(r, m.essay_col) for r in rows[m.header_row + 1 :]]
    filled = [c for c in cells if c]
    if not filled or sum(words(c) for c in filled) / len(filled) < MIN_ESSAY_WORDS:
        return f"Column C{m.essay_col} does not hold full essays (average under {MIN_ESSAY_WORDS} words)"
    return None


def guess_mapping(sheets: dict[str, list[list[str]]]) -> SheetMapping:
    """No model: the column with the most words is the essay column."""
    best = None
    for name, rows in sheets.items():
        width = max((len(r) for r in rows), default=0)
        for c in range(width):
            total = sum(words(_col(r, c)) for r in rows)
            if best is None or total > best[0]:
                best = (total, name, c)
    if best is None or best[0] == 0:
        raise ValueError("The spreadsheet is empty")
    _, name, c = best
    rows = sheets[name]
    first = next((r for r in rows if _col(r, c)), [])
    header = rows.index(first) if first and words(_col(first, c)) < 8 else -1
    return SheetMapping(sheet=name, header_row=header, essay_col=c, name_col=_guess_name_col(rows, header, c))


def _guess_name_col(rows: list[list[str]], header: int, essay_col: int) -> int:
    """The first column whose filled essay rows all hold a short, non-numeric label."""
    data = [r for r in rows[header + 1 :] if _col(r, essay_col)]
    width = max((len(r) for r in data), default=0)
    for c in range(width):
        cells = [_col(r, c) for r in data]
        if c != essay_col and all(cells) and all(1 <= words(v) <= 5 and not v.replace(".", "").isdigit() for v in cells):
            return c
    return -1


async def map_sheet(llm: ExtractionLLM, sheets: dict[str, list[list[str]]]) -> SheetMapping:
    """Asks the model for a mapping, gives it one correction round, then guesses."""
    user = preview(sheets)
    for _ in range(2):
        try:
            mapping = SheetMapping.model_validate(await llm.complete_json(MAP_SYSTEM, user, SheetMapping))
        except NotImplementedError:
            break
        except Exception as exc:
            logger.warning(f"Sheet mapping call failed: {exc}")
            break
        problem = validate_mapping(mapping, sheets)
        if problem is None:
            return mapping
        user = f"{preview(sheets)}\n\nYour previous answer {mapping.model_dump_json()} was wrong: {problem}. Try again."
    mapping = guess_mapping(sheets)
    problem = validate_mapping(mapping, sheets)
    if problem:
        raise ValueError(f"Could not find an essay column: {problem}")
    return mapping


def apply_mapping(m: SheetMapping, sheets: dict[str, list[list[str]]]) -> tuple[list[Essay], list[str]]:
    """Essays from every data row, and the header names (for the export)."""
    rows = sheets[m.sheet]
    headers = rows[m.header_row] if m.header_row >= 0 else []
    essays = []
    for r in range(m.header_row + 1, len(rows)):
        row = rows[r]
        text = _col(row, m.essay_col)
        if not text:
            continue
        essays.append(
            Essay(
                essay_text=text,
                student_label=_col(row, m.name_col) or None,
                task_type=normalize_task_type(_col(row, m.task_type_col)),
                task_prompt=_col(row, m.prompt_col) or None,
                ref={"sheet": m.sheet, "row": r, "cells": row},
            )
        )
    return essays, headers
