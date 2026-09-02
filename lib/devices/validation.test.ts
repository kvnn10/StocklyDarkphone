import { describe, expect, it } from "vitest";
import { calculateDeviceMargin, normalizeImei, normalizeSerial, validateDeviceIdentity } from "@/lib/devices/validation";

describe("DarkPhone device invariants", () => {
  it("normalizes IMEI and serial safely", () => {
    expect(normalizeImei("35-1234 5678 90123")).toBe("351234567890123");
    expect(normalizeSerial("  ab-cd-12 ")).toBe("AB-CD-12");
  });

  it("requires at least one device identifier", () => {
    expect(validateDeviceIdentity({})).toBe("Registra al menos un IMEI o serial");
  });

  it("rejects invalid IMEI and duplicated dual IMEI", () => {
    expect(validateDeviceIdentity({ imei1: "123" })).toContain("IMEI 1");
    expect(validateDeviceIdentity({ imei1: "351234567890123", imei2: "351234567890123" })).toContain("no pueden ser iguales");
  });

  it("allows an optional numeric phone passcode", () => {
    expect(validateDeviceIdentity({ serial: "ABC123", phonePasscode: "" })).toBeNull();
    expect(validateDeviceIdentity({ serial: "ABC123", phonePasscode: "12A4" })).toContain("clave");
    expect(validateDeviceIdentity({ serial: "ABC123", phonePasscode: "0123" })).toBeNull();
  });

  it("calculates true device investment and margin", () => {
    expect(calculateDeviceMargin(1000000, 150000, 1400000)).toEqual({ investment: 1150000, profit: 250000, margin: (250000 / 1400000) * 100 });
  });
});
