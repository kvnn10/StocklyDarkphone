import type { ServiceOrderDraft } from "./types";

const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;
const IMEI_RE = /^\d{14,16}$/;

export function validateServiceOrderDraft(input: ServiceOrderDraft): string[] {
  const errors: string[] = [];

  if (!input.customerName.trim()) errors.push("Customer name is required");
  if (!PHONE_RE.test(input.customerPhone.trim())) errors.push("A valid customer phone is required");
  if (!input.deviceType) errors.push("Device type is required");
  if (!input.brand.trim()) errors.push("Device brand is required");
  if (!input.model.trim()) errors.push("Device model is required");
  if (!input.reportedIssue.trim()) errors.push("Reported issue is required");

  if (input.imei && !IMEI_RE.test(input.imei.replace(/\s/g, ""))) {
    errors.push("IMEI must contain 14 to 16 digits");
  }

  if (input.estimatedLabor != null && (!Number.isFinite(input.estimatedLabor) || input.estimatedLabor < 0)) {
    errors.push("Estimated labor must be a non-negative amount");
  }

  return errors;
}
