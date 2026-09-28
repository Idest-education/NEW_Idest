import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "./download";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saveBlob", () => {
  it("clicks a download link and revokes the object URL only after the browser has started the download", () => {
    vi.useFakeTimers();
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    const revoke = vi.fn();
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { append } });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:1"), revokeObjectURL: revoke });

    saveBlob(new Blob(["x"]), "feedback-2026-09-28.csv");

    expect(link.href).toBe("blob:1");
    expect(link.download).toBe("feedback-2026-09-28.csv");
    expect(append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });
});
