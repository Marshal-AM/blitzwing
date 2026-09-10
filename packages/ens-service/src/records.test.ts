import { describe, expect, it } from "vitest";
import {
  hostIdToEnsName,
  hostIdToLabel,
  recordToTexts,
  validateBlockIndices,
  validateHederaAccountId,
} from "./records.js";

describe("records", () => {
  it("derives stable labels from host ids", () => {
    expect(hostIdToLabel("mother")).toBe("mother");
    expect(hostIdToLabel("host-f5e7d3cdd518")).toBe("host-f5e7d3cd");
    expect(hostIdToEnsName("host-f5e7d3cdd518", "blitzwing.eth")).toBe(
      "host-f5e7d3cd.blitzwing.eth",
    );
  });

  it("validates hedera account ids", () => {
    expect(validateHederaAccountId("0.0.123456")).toBe("0.0.123456");
    expect(() => validateHederaAccountId("bad")).toThrow();
  });

  it("validates block indices", () => {
    expect(validateBlockIndices("0:24")).toBe("0:24");
    expect(() => validateBlockIndices("24:0")).toThrow();
  });

  it("round-trips record texts", () => {
    const texts = recordToTexts({
      hostId: "host-abc",
      hederaAccountId: "0.0.1",
      blockIndices: "0:8",
      layersHosted: 8,
      model: "test/model",
      role: "contributor",
      status: "online",
    });
    expect(texts.find((t) => t.key.endsWith("hederaAccountId"))?.value).toBe("0.0.1");
  });
});
