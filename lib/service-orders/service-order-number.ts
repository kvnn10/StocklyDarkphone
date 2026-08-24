export function formatServiceOrderNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Service order sequence must be a positive integer");
  }
  return `ST-${String(sequence).padStart(6, "0")}`;
}

export function calculateServiceOrderTotals(input: {
  labor: number;
  parts: number;
  discount?: number;
  tax?: number;
}) {
  const values = [input.labor, input.parts, input.discount ?? 0, input.tax ?? 0];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Service order amounts must be finite and non-negative");
  }

  const subtotal = input.labor + input.parts;
  const total = Math.max(0, subtotal - (input.discount ?? 0) + (input.tax ?? 0));
  return { subtotal, total };
}
