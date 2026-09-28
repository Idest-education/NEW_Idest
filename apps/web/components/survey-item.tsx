"use client";

import type { CSSProperties } from "react";
import {
  LIKERT5,
  NPS_ANCHORS,
  NPS_OPTIONS,
  labelFor,
  type SurveyItem,
  type SurveyRole,
} from "@repo/feedback-contract";
import { board as s } from "./board";
import f from "./survey.module.css";

type Value = number | string | undefined;

/**
 * One questionnaire item. The wrapper carries id `q-<code>` so the page can
 * scroll to and focus the first failing item.
 */
export function SurveyItemField({
  item,
  role,
  value,
  error,
  disabled,
  onChange,
}: {
  item: SurveyItem;
  role: SurveyRole;
  value: Value;
  error: string | null;
  disabled: boolean;
  onChange: (value: Value) => void;
}) {
  const id = `q-${item.code}`;
  const errorId = error ? `${id}-error` : undefined;
  const label = labelFor(item, role);
  const wrapClass = `${f.item} ${error ? f.itemError : ""}`;
  const errorLine = error ? (
    <p id={errorId} className={f.errorText}>
      {error}
    </p>
  ) : null;

  if (item.type === "text") {
    const text = typeof value === "string" ? value : "";
    return (
      <div id={id} className={wrapClass}>
        <label className={f.question} htmlFor={`${id}-input`}>
          {label} <span className={f.optional}>(không bắt buộc)</span>
        </label>
        <textarea
          id={`${id}-input`}
          className={s.field}
          rows={3}
          value={text}
          maxLength={item.maxLength}
          disabled={disabled}
          aria-describedby={errorId}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        />
        <p className={s.fieldHint}>
          {text.length}/{item.maxLength}
        </p>
        {errorLine}
      </div>
    );
  }

  if (item.type === "number") {
    return (
      <div id={id} className={wrapClass}>
        <label className={f.question} htmlFor={`${id}-input`}>
          {label}
        </label>
        <div className={f.numberRow}>
          <input
            id={`${id}-input`}
            className={s.field}
            type="number"
            inputMode="numeric"
            min={item.min}
            max={item.max}
            step={1}
            value={typeof value === "number" ? value : ""}
            disabled={disabled}
            aria-describedby={errorId}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          <span>phút</span>
        </div>
        {errorLine}
      </div>
    );
  }

  const scale = item.type === "likert5" || item.type === "nps";
  const options = item.type === "likert5" ? LIKERT5 : item.type === "nps" ? NPS_OPTIONS : (item.options ?? []);
  const anchors =
    item.type === "nps"
      ? [NPS_ANCHORS.low, NPS_ANCHORS.high]
      : [LIKERT5[0]?.label ?? "", LIKERT5[LIKERT5.length - 1]?.label ?? ""];

  return (
    <fieldset id={id} className={wrapClass} aria-describedby={errorId}>
      <legend className={f.question}>{label}</legend>
      <div
        className={scale ? f.scale : f.choices}
        style={scale ? ({ "--points": options.length } as CSSProperties) : undefined}
      >
        {options.map((option) => (
          <label key={option.code} className={scale ? f.scalePoint : f.choice}>
            <input
              type="radio"
              className={scale ? f.hiddenRadio : undefined}
              name={item.code}
              value={option.code}
              checked={value === option.code}
              disabled={disabled}
              aria-label={scale && item.type === "likert5" ? `${option.code} — ${option.label}` : undefined}
              onChange={() => onChange(option.code)}
            />
            <span>{scale ? option.code : option.label}</span>
          </label>
        ))}
      </div>
      {scale ? (
        <div className={f.anchors} aria-hidden="true">
          <span>{anchors[0]}</span>
          <span>{anchors[1]}</span>
        </div>
      ) : null}
      {errorLine}
    </fieldset>
  );
}
