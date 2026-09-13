import { describe, expect, it } from "vitest";
import { band, isBand, overallFromCriteria, signedBand, stripRef } from "./format";

describe("isBand", () => {
  it("accepts valid IELTS bands", () => {
    for (const v of [0, 0.5, 6, 6.5, 9]) expect(isBand(v)).toBe(true);
  });

  it("rejects out-of-range, wrong-step and non-numbers", () => {
    for (const v of [-0.5, 9.5, 66.5, 6.3]) expect(isBand(v)).toBe(false);
    expect(isBand(undefined)).toBe(false);
    expect(isBand(Number.NaN)).toBe(false);
  });
});

describe("overallFromCriteria", () => {
  it("averages four bands to the nearest half band", () => {
    expect(
      overallFromCriteria({
        task_response: 6.5,
        coherence_cohesion: 7,
        lexical_resource: 6.5,
        grammatical_range_accuracy: 6,
      }),
    ).toBe(6.5);
  });

  it("refuses to average an out-of-band figure", () => {
    expect(
      overallFromCriteria({
        task_response: 6.5,
        coherence_cohesion: 7,
        lexical_resource: 66.5,
        grammatical_range_accuracy: 6,
      }),
    ).toBeUndefined();
  });
});

describe("band figures", () => {
  it("prints one decimal, or an em dash when absent", () => {
    expect(band(7)).toBe("7.0");
    expect(band(undefined)).toBe("—");
  });

  it("signs a deviation", () => {
    expect(signedBand(0.5)).toBe("+0.5");
    expect(signedBand(0)).toBe("±0.0");
  });

  it("builds a strip ref from the submission id", () => {
    expect(stripRef("03f65b54-061f-4118-a641-59f96cc1cf09", 2)).toBe("BB-C1CF09/2");
  });
});
