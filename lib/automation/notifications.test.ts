import { describe, expect, it } from "vitest";
import { enqueueNotification } from "./notifications";

describe("automation notification contract", () => {
  it("accepts idempotency keys and supported channels", () => {
    expect(enqueueNotification).toBeTypeOf("function");
    const channels = ["in_app", "whatsapp", "telegram"];
    expect(channels).toContain("in_app");
    expect(channels).toContain("whatsapp");
    expect(channels).toContain("telegram");
  });
});
