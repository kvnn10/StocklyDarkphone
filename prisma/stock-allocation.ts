/**
 * Stock Allocation & Transfer Prisma helpers
 *
 * Inventory invariants:
 * - quantities may never become negative
 * - a transfer is atomic: source and destination change together
 * - Product.quantity mirrors the sum of warehouse allocations
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/client";
import { mergeProductListWhere } from "@/lib/products/product-query";
import type {
  CreateStockAllocationInput,
  UpdateStockAllocationInput,
  CreateStockTransferInput,
} from "@/types";

const asQuantity = (value: bigint | number) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error("Stock quantity must be a non-negative integer");
  }
  return quantity;
};

async function syncProductQuantity(productId: string, tx: Prisma.TransactionClient) {
  const allocations = await tx.stockAllocation.findMany({ where: { productId }, select: { quantity: true } });
  const total = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity), 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Total product stock is invalid");
  return tx.product.update({ where: { id: productId }, data: { quantity: BigInt(total), updatedAt: new Date() } });
}

export async function getStockAllocations(userId: string) {
  const products = await prisma.product.findMany({ where: mergeProductListWhere({ userId }), select: { id: true } });
  return prisma.stockAllocation.findMany({ where: { productId: { in: products.map((p) => p.id) } }, orderBy: { createdAt: "desc" } });
}

export async function getStockAllocationsByProduct(productId: string) {
  return prisma.stockAllocation.findMany({ where: { productId }, orderBy: { createdAt: "desc" } });
}

export async function getStockAllocationsByWarehouse(warehouseId: string) {
  return prisma.stockAllocation.findMany({ where: { warehouseId }, orderBy: { createdAt: "desc" } });
}

export async function getStockAllocationById(id: string) {
  return prisma.stockAllocation.findUnique({ where: { id } });
}

export async function upsertStockAllocation(data: CreateStockAllocationInput, userId: string) {
  const quantity = asQuantity(data.quantity);
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: data.productId, userId }, select: { id: true } });
    if (!product) throw new Error("Product not found or access denied");
    const warehouse = await tx.warehouse.findFirst({ where: { id: data.warehouseId, userId }, select: { id: true } });
    if (!warehouse) throw new Error("Warehouse not found or access denied");
    const existing = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.warehouseId } } });
    const allocation = existing
      ? await tx.stockAllocation.update({ where: { id: existing.id }, data: { quantity: BigInt(quantity), updatedAt: new Date() } })
      : await tx.stockAllocation.create({ data: { productId: data.productId, warehouseId: data.warehouseId, quantity: BigInt(quantity), userId, createdAt: new Date() } });
    await syncProductQuantity(data.productId, tx);
    return allocation;
  });
}

export async function updateStockAllocation(id: string, data: UpdateStockAllocationInput) {
  if (data.quantity !== undefined) asQuantity(data.quantity);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.stockAllocation.findUnique({ where: { id } });
    if (!existing) throw new Error("Stock allocation not found");
    const allocation = await tx.stockAllocation.update({ where: { id }, data: { ...data, ...(data.quantity !== undefined ? { quantity: BigInt(asQuantity(data.quantity)) } : {}), updatedAt: new Date() } });
    await syncProductQuantity(existing.productId, tx);
    return allocation;
  });
}

export async function deleteStockAllocation(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.stockAllocation.findUnique({ where: { id } });
    if (!existing) throw new Error("Stock allocation not found");
    const allocation = await tx.stockAllocation.delete({ where: { id } });
    await syncProductQuantity(existing.productId, tx);
    return allocation;
  });
}

export async function getStockTransfers(userId: string) {
  return prisma.stockTransfer.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function getStockTransferById(id: string, userId: string) {
  return prisma.stockTransfer.findFirst({ where: { id, userId } });
}

export async function createStockTransfer(data: CreateStockTransferInput, userId: string) {
  const quantity = asQuantity(data.quantity);
  if (quantity <= 0) throw new Error("Transfer quantity must be greater than zero");
  if (data.fromWarehouseId === data.toWarehouseId) throw new Error("Source and destination warehouses must be different");
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: data.productId, userId }, select: { id: true } });
    if (!product) throw new Error("Product not found or access denied");
    const [sourceWarehouse, destinationWarehouse] = await Promise.all([
      tx.warehouse.findFirst({ where: { id: data.fromWarehouseId, userId }, select: { id: true } }),
      tx.warehouse.findFirst({ where: { id: data.toWarehouseId, userId }, select: { id: true } }),
    ]);
    if (!sourceWarehouse || !destinationWarehouse) throw new Error("Warehouse not found or access denied");
    const sourceAllocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.fromWarehouseId } } });
    if (!sourceAllocation) throw new Error("Source warehouse has no stock allocation for this product");
    const availableStock = Number(sourceAllocation.quantity) - Number(sourceAllocation.reservedQuantity);
    if (availableStock < quantity) throw new Error(`Insufficient stock in source warehouse. Available: ${availableStock}, Requested: ${quantity}`);
    return tx.stockTransfer.create({ data: { productId: data.productId, fromWarehouseId: data.fromWarehouseId, toWarehouseId: data.toWarehouseId, quantity: BigInt(quantity), status: "pending", notes: data.notes || null, userId, createdAt: new Date() } });
  });
}

export async function completeStockTransfer(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({ where: { id, userId } });
    if (!transfer) throw new Error("Transfer not found or access denied");
    if (transfer.status !== "pending") throw new Error("Transfer is not pending");
    const quantity = asQuantity(transfer.quantity);
    const source = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: transfer.productId, warehouseId: transfer.fromWarehouseId } } });
    if (!source) throw new Error("Source allocation no longer exists");
    const available = Number(source.quantity) - Number(source.reservedQuantity);
    if (available < quantity) throw new Error(`Insufficient stock. Available: ${available}, Requested: ${quantity}`);
    await tx.stockAllocation.update({ where: { id: source.id }, data: { quantity: { decrement: BigInt(quantity) }, updatedAt: new Date() } });
    const destination = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: transfer.productId, warehouseId: transfer.toWarehouseId } } });
    if (destination) {
      await tx.stockAllocation.update({ where: { id: destination.id }, data: { quantity: { increment: BigInt(quantity) }, updatedAt: new Date() } });
    } else {
      await tx.stockAllocation.create({ data: { productId: transfer.productId, warehouseId: transfer.toWarehouseId, quantity: BigInt(quantity), userId, createdAt: new Date() } });
    }
    await syncProductQuantity(transfer.productId, tx);
    return tx.stockTransfer.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
  });
}

export async function cancelStockTransfer(id: string, userId: string) {
  const transfer = await prisma.stockTransfer.findFirst({ where: { id, userId } });
  if (!transfer) throw new Error("Transfer not found or access denied");
  if (transfer.status !== "pending") throw new Error("Transfer is not pending");
  return prisma.stockTransfer.update({ where: { id }, data: { status: "cancelled" } });
}

export async function getWarehouseStockSummary(userId: string) {
  const products = await prisma.product.findMany({ where: mergeProductListWhere({ userId }), select: { id: true, price: true } });
  const productIds = products.map((p) => p.id);
  const priceMap = new Map(products.map((p) => [p.id, Number(p.price)]));
  const warehouses = await prisma.warehouse.findMany({ where: { userId }, select: { id: true, name: true, type: true } });
  const allocations = await prisma.stockAllocation.findMany({ where: { productId: { in: productIds } } });
  return warehouses.map((wh) => {
    const warehouseAllocations = allocations.filter((a) => a.warehouseId === wh.id);
    const totalProducts = warehouseAllocations.length;
    const totalQuantity = warehouseAllocations.reduce((sum, a) => sum + Number(a.quantity), 0);
    const totalReserved = warehouseAllocations.reduce((sum, a) => sum + Number(a.reservedQuantity), 0);
    const totalValue = warehouseAllocations.reduce((sum, a) => sum + Number(a.quantity) * (priceMap.get(a.productId) || 0), 0);
    return { warehouseId: wh.id, warehouseName: wh.name, warehouseType: wh.type ?? null, totalProducts, totalQuantity, totalReserved, availableQuantity: totalQuantity - totalReserved, totalValue };
  });
}
