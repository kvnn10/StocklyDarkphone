export const DEVICE_STATUSES = ["available", "in_repair", "sold", "archived"] as const;

export function normalizeImei(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export function normalizeSerial(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function validateDeviceIdentity(input: { imei1?: unknown; imei2?: unknown; serial?: unknown; phonePasscode?: unknown }) {
  const imei1 = normalizeImei(input.imei1);
  const imei2 = normalizeImei(input.imei2);
  const serial = normalizeSerial(input.serial);
  const phonePasscode = typeof input.phonePasscode === "string" ? input.phonePasscode.trim() : "";
  if (imei1 && !/^\d{15}$/.test(imei1)) return "El IMEI 1 debe tener 15 dígitos";
  if (imei2 && !/^\d{15}$/.test(imei2)) return "El IMEI 2 debe tener 15 dígitos";
  if (imei1 && imei2 && imei1 === imei2) return "El IMEI 1 y el IMEI 2 no pueden ser iguales";
  if (serial && (serial.length < 3 || serial.length > 64)) return "El serial debe tener entre 3 y 64 caracteres";
  if (phonePasscode && !/^\d{4,8}$/.test(phonePasscode)) return "La clave del teléfono debe tener entre 4 y 8 dígitos";
  if (!imei1 && !imei2 && !serial) return "Registra al menos un IMEI o serial";
  return null;
}

export function calculateDeviceMargin(purchasePrice: number, repairCost: number, salePrice: number) {
  const investment = Math.max(0, purchasePrice) + Math.max(0, repairCost);
  const revenue = Math.max(0, salePrice);
  const profit = revenue - investment;
  return { investment, profit, margin: revenue > 0 ? (profit / revenue) * 100 : 0 };
}
