import { prisma } from "@/prisma/client";

export type PromotionType = "price" | "2x1" | "3x2" | "quantity";

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  productId?: string | null;
  value: number;
  minQuantity?: number | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  priority: number;
  stackable: boolean;
}

export interface PricingItemInput {
  productId: string;
  quantity: number;
  discountType?: "percent" | "fixed";
  discountValue?: number;
}

export interface PricingLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  regularUnitPrice: number;
  unitPrice: number;
  gross: number;
  promotionDiscount: number;
  manualDiscount: number;
  discount: number;
  subtotal: number;
  purchaseCost: number;
  margin: number;
  promotion: Promotion | null;
}

const CONFIG_PREFIX = "sales_promotions:";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isPromotionActive(promotion: Promotion, now = new Date()) {
  return promotion.active && new Date(promotion.startsAt) <= now && now <= new Date(promotion.endsAt);
}

export function applyPromotion(price: number, quantity: number, promotion: Promotion | null) {
  if (!promotion) return { unitPrice: price, discount: 0 };
  if (promotion.type === "price") {
    const unitPrice = Math.max(0, Math.min(price, promotion.value));
    return { unitPrice, discount: roundMoney((price - unitPrice) * quantity) };
  }
  if (promotion.type === "2x1") {
    return { unitPrice: price, discount: roundMoney(Math.floor(quantity / 2) * price) };
  }
  if (promotion.type === "3x2") {
    return { unitPrice: price, discount: roundMoney(Math.floor(quantity / 3) * price) };
  }
  if (promotion.type === "quantity") {
    const min = Math.max(1, Math.floor(promotion.minQuantity ?? 2));
    if (quantity < min) return { unitPrice: price, discount: 0 };
    const unitPrice = Math.max(0, Math.min(price, promotion.value));
    return { unitPrice, discount: roundMoney((price - unitPrice) * quantity) };
  }
  return { unitPrice: price, discount: 0 };
}

/** Returns the actual line subtotal after the selected promotion. */
export function calculatePromotionSubtotal(price: number, quantity: number, promotion: Promotion | null) {
  if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid quantity");
  const gross = roundMoney(price * quantity);
  const promotionResult = applyPromotion(price, quantity, promotion);
  return roundMoney(Math.max(0, gross - promotionResult.discount));
}

export function choosePromotion(promotions: Promotion[], productId: string, now = new Date()) {
  return promotions
    .filter((p) => (!p.productId || p.productId === productId) && isPromotionActive(p, now))
    .sort((a, b) => b.priority - a.priority || new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime())[0] ?? null;
}

export function calculateManualDiscount(base: number, type: "percent" | "fixed" | undefined, value: number | undefined) {
  if (!value) return 0;
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid discount value");
  const discount = type === "percent" ? base * Math.min(100, value) / 100 : value;
  return roundMoney(Math.min(base, Math.max(0, discount)));
}

export async function getPromotions(userId: string): Promise<Promotion[]> {
  const config = await prisma.systemConfig.findUnique({ where: { key: `${CONFIG_PREFIX}${userId}` } });
  if (!config) return [];
  try {
    const parsed = JSON.parse(config.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePromotions(userId: string, promotions: Promotion[], updatedBy: string) {
  const value = JSON.stringify(promotions);
  await prisma.systemConfig.upsert({
    where: { key: `${CONFIG_PREFIX}${userId}` },
    create: {
      key: `${CONFIG_PREFIX}${userId}`,
      value,
      type: "json",
      label: "Promociones de ventas",
      description: "Promociones comerciales de Stockly",
      category: "sales",
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy,
    },
    update: { value, type: "json", updatedAt: new Date(), updatedBy },
  });
}

export async function quotePricing(userId: string, items: PricingItemInput[], allowManualDiscount: boolean) {
  const [products, promotions] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, userId, deletedAt: null } }),
    getPromotions(userId),
  ]);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const lines: PricingLine[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("Quantity must be a positive integer");
    const product = productMap.get(item.productId);
    if (!product) throw new Error(`Product not found: ${item.productId}`);
    const regularUnitPrice = Math.max(0, Number(product.price));
    const purchaseCost = Math.max(0, Number(product.purchasePrice ?? 0));
    const promotion = choosePromotion(promotions, product.id);
    const promoSubtotal = calculatePromotionSubtotal(regularUnitPrice, item.quantity, promotion);
    const manualDiscount = allowManualDiscount
      ? calculateManualDiscount(promoSubtotal, item.discountType, item.discountValue)
      : 0;
    if (!allowManualDiscount && (item.discountValue ?? 0) > 0) throw new Error("Manual discounts require administrator permission");
    const subtotal = roundMoney(Math.max(0, promoSubtotal - manualDiscount));
    const discount = roundMoney(promotion ? regularUnitPrice * item.quantity - subtotal : manualDiscount);
    const margin = roundMoney(subtotal - purchaseCost * item.quantity);
    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: item.quantity,
      regularUnitPrice,
      unitPrice: roundMoney(subtotal / item.quantity),
      gross: roundMoney(regularUnitPrice * item.quantity),
      promotionDiscount: roundMoney(regularUnitPrice * item.quantity - promoSubtotal),
      manualDiscount,
      discount,
      subtotal,
      purchaseCost,
      margin,
      promotion,
    });
  }
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const gross = roundMoney(lines.reduce((sum, line) => sum + line.gross, 0));
  const discount = roundMoney(gross - subtotal);
  const cost = roundMoney(lines.reduce((sum, line) => sum + line.purchaseCost * line.quantity, 0));
  return { lines, gross, subtotal, discount, cost, margin: roundMoney(subtotal - cost) };
}
