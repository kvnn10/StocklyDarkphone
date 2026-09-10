import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { calculateDeviceMargin, normalizeImei, normalizeSerial, validateDeviceIdentity, DEVICE_STATUSES } from "@/lib/devices/validation";

const ROLES = new Set(["admin", "user", "retailer"]);
const validId = (value: unknown) => typeof value === "string" && ObjectId.isValid(value);
const text = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const money = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? n : null; };

function safeDevice(doc: any) {
  return {
    id: doc._id.toHexString(), name: doc.name, brand: doc.brand, model: doc.model,
    imei1: doc.imei1 ?? "", imei2: doc.imei2 ?? "", serial: doc.serial ?? "",
    clientName: doc.clientName ?? "", contact: doc.contact ?? "", fmi: doc.fmi ?? "", status: doc.status, purchasePrice: doc.purchasePrice ?? 0,
    repairCost: doc.repairCost ?? 0, salePrice: doc.salePrice ?? 0, investment: doc.investment ?? 0,
    profit: doc.profit ?? 0, margin: doc.margin ?? 0, warrantyDays: doc.warrantyDays ?? 0,
    warrantyExpiresAt: doc.warrantyExpiresAt ?? null, serviceOrderId: doc.serviceOrderId ?? null,
    saleOrderId: doc.saleOrderId ?? null, notes: doc.notes ?? "", passcodeSet: Boolean(doc.phonePasscode),
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

async function ensureIndexes(collection: any) {
  await Promise.all([
    collection.createIndex({ userId: 1, createdAt: -1 }),
    collection.createIndex({ userId: 1, imei1: 1 }, { unique: true, partialFilterExpression: { imei1: { $gt: "" } } }),
    collection.createIndex({ userId: 1, imei2: 1 }, { unique: true, partialFilterExpression: { imei2: { $gt: "" } } }),
    collection.createIndex({ userId: 1, serial: 1 }, { unique: true, partialFilterExpression: { serial: { $gt: "" } } }),
  ]);
}

async function buildDevice(row: any, sessionId: string) {
  const name = text(row.name, 120) || [text(row.brand, 80), text(row.model, 120), text(row.storage, 60)].filter(Boolean).join(" ");
  const brand = text(row.brand, 80), model = text(row.model, 120);
  const clientName = text(row.clientName ?? row.cliente, 160), contact = text(row.contact ?? row.contacto, 80), notes = text(row.notes, 1000);
  const imei1 = normalizeImei(row.imei1 ?? row.imei), imei2 = normalizeImei(row.imei2), serial = normalizeSerial(row.serial);
  const phonePasscode = text(row.phonePasscode ?? row.clave, 8), fmi = text(row.fmi, 40);
  const identityError = validateDeviceIdentity({ imei1, imei2, serial, phonePasscode });
  if (identityError) throw new Error(identityError);
  if (!name || !model) throw new Error("Nombre/modelo son obligatorios");
  const purchasePrice = money(row.purchasePrice), repairCost = money(row.repairCost), salePrice = money(row.salePrice);
  if (purchasePrice === null || repairCost === null || salePrice === null) throw new Error("Los valores de costo y venta son inválidos");
  const warrantyDays = Number(row.warrantyDays ?? 0);
  if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) throw new Error("Garantía inválida");
  const status = DEVICE_STATUSES.includes(row.status) ? row.status : "available";
  const serviceOrderId = validId(row.serviceOrderId) ? row.serviceOrderId : null;
  const saleOrderId = validId(row.saleOrderId) ? row.saleOrderId : null;
  const margin = calculateDeviceMargin(purchasePrice, repairCost, salePrice);
  const now = new Date();
  const warrantyExpiresAt = warrantyDays > 0 ? new Date(now.getTime() + warrantyDays * 86400000) : null;
  return { userId: sessionId, name, brand, model, imei1, imei2, serial, clientName, contact, fmi, phonePasscode: phonePasscode || null, status, purchasePrice, repairCost, salePrice, ...margin, warrantyDays, warrantyExpiresAt, serviceOrderId, saleOrderId, notes, createdAt: now, updatedAt: now, createdBy: sessionId };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const q = text(new URL(request.url).searchParams.get("search"), 80);
  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    await client.connect();
    const collection = client.db().collection("CustomerDevice");
    await ensureIndexes(collection);
    const filter: any = { userId: session.id, archivedAt: { $exists: false } };
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [{ name: regex }, { brand: regex }, { model: regex }, { imei1: regex }, { imei2: regex }, { serial: regex }, { clientName: regex }, { contact: regex }, { fmi: regex }];
    }
    const devices = await collection.find(filter, { projection: { phonePasscode: 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
    return NextResponse.json({ devices: devices.map(safeDevice) });
  } catch (error) {
    console.error("GET /api/devices", error);
    return NextResponse.json({ error: "No se pudieron cargar los equipos" }, { status: 500 });
  } finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    const body = await request.json();
    await client.connect();
    const collection = client.db().collection("CustomerDevice");
    await ensureIndexes(collection);

    if (Array.isArray(body.devices)) {
      const rows = body.devices.slice(0, 500);
      const results = await Promise.all(rows.map(async (row: any, index: number) => {
        try {
          const doc = await buildDevice(row, session.id);
          const result = await collection.insertOne(doc);
          await writeAuditLog({ userId: session.id, action: "DEVICE_CREATED", entityType: "CustomerDevice", entityId: result.insertedId.toHexString(), details: { name: doc.name, brand: doc.brand, model: doc.model, imei1: Boolean(doc.imei1), imei2: Boolean(doc.imei2), serial: Boolean(doc.serial), status: doc.status, bulk: true, row: index + 2 } });
          return { ok: true };
        } catch (error: any) {
          if (error?.code === 11000) return { ok: false, duplicate: true };
          return { ok: false, error: error instanceof Error ? error.message : "Fila inválida" };
        }
      }));
      return NextResponse.json({ created: results.filter(r => r.ok).length, duplicates: results.filter(r => r.duplicate).length, errors: results.filter(r => !r.ok && !r.duplicate).length, details: results.map((r, index) => r.ok ? null : { row: index + 2, type: r.duplicate ? "duplicate" : "error", message: r.duplicate ? "El IMEI o serial ya está registrado" : r.error }).filter(Boolean) });
    }

    const doc = await buildDevice(body, session.id);
    try {
      const result = await collection.insertOne(doc);
      await writeAuditLog({ userId: session.id, action: "DEVICE_CREATED", entityType: "CustomerDevice", entityId: result.insertedId.toHexString(), details: { name: doc.name, brand: doc.brand, model: doc.model, imei1: Boolean(doc.imei1), imei2: Boolean(doc.imei2), serial: Boolean(doc.serial), status: doc.status } });
      return NextResponse.json(safeDevice({ ...doc, _id: result.insertedId }), { status: 201 });
    } catch (error: any) {
      if (error?.code === 11000) return NextResponse.json({ error: "El IMEI o serial ya está registrado en otro equipo" }, { status: 409 });
      throw error;
    }
  } catch (error) {
    console.error("POST /api/devices", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar el equipo" }, { status: 500 });
  } finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    const body = await request.json();
    const id = text(body.id, 40);
    if (!validId(id)) return NextResponse.json({ error: "Equipo inválido" }, { status: 400 });
    const imei1 = normalizeImei(body.imei1), imei2 = normalizeImei(body.imei2), serial = normalizeSerial(body.serial);
    const identityError = validateDeviceIdentity({ imei1, imei2, serial, phonePasscode: body.phonePasscode ?? "" });
    if (identityError) return NextResponse.json({ error: identityError }, { status: 400 });
    const purchasePrice = money(body.purchasePrice), repairCost = money(body.repairCost), salePrice = money(body.salePrice);
    if (purchasePrice === null || repairCost === null || salePrice === null) return NextResponse.json({ error: "Los valores de costo y venta son inválidos" }, { status: 400 });
    const warrantyDays = Number(body.warrantyDays ?? 0);
    if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Garantía inválida" }, { status: 400 });
    const status = DEVICE_STATUSES.includes(body.status) ? body.status : "available";
    await client.connect();
    const collection = client.db().collection("CustomerDevice");
    await ensureIndexes(collection);
    const current = await collection.findOne({ _id: new ObjectId(id), userId: session.id, archivedAt: { $exists: false } });
    if (!current) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    const margin = calculateDeviceMargin(purchasePrice, repairCost, salePrice);
    const warrantyExpiresAt = warrantyDays > 0 ? new Date((current.warrantyStartedAt ?? current.createdAt ?? new Date()).getTime() + warrantyDays * 86400000) : null;
    const update: any = { name: text(body.name, 120), brand: text(body.brand, 80), model: text(body.model, 120), clientName: text(body.clientName, 160), contact: text(body.contact ?? body.contacto, 80), fmi: text(body.fmi, 40), imei1, imei2, serial, status, purchasePrice, repairCost, salePrice, ...margin, warrantyDays, warrantyExpiresAt, serviceOrderId: validId(body.serviceOrderId) ? body.serviceOrderId : null, saleOrderId: validId(body.saleOrderId) ? body.saleOrderId : null, notes: text(body.notes, 1000), updatedAt: new Date(), updatedBy: session.id };
    if (body.phonePasscode !== undefined) update.phonePasscode = text(body.phonePasscode, 8) || null;
    try {
      await collection.updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update });
    } catch (error: any) {
      if (error?.code === 11000) return NextResponse.json({ error: "El IMEI o serial ya está registrado en otro equipo" }, { status: 409 });
      throw error;
    }
    await writeAuditLog({ userId: session.id, action: "DEVICE_UPDATED", entityType: "CustomerDevice", entityId: id, details: { fields: Object.keys(update), passcodeChanged: body.phonePasscode !== undefined } });
    const saved = await collection.findOne({ _id: new ObjectId(id), userId: session.id }, { projection: { phonePasscode: 0 } });
    return NextResponse.json(safeDevice(saved));
  } catch (error) {
    console.error("PUT /api/devices", error);
    return NextResponse.json({ error: "No se pudo actualizar el equipo" }, { status: 500 });
  } finally { await client.close(); }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!validId(id)) return NextResponse.json({ error: "Equipo inválido" }, { status: 400 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    await client.connect();
    const collection = client.db().collection("CustomerDevice");
    const result = await collection.updateOne({ _id: new ObjectId(id), userId: session.id, archivedAt: { $exists: false } }, { $set: { archivedAt: new Date(), archivedBy: session.id, updatedAt: new Date() } });
    if (!result.matchedCount) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    await writeAuditLog({ userId: session.id, action: "DEVICE_ARCHIVED", entityType: "CustomerDevice", entityId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/devices", error);
    return NextResponse.json({ error: "No se pudo archivar el equipo" }, { status: 500 });
  } finally { await client.close(); }
}
