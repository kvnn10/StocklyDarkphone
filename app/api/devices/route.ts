import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

function allowed(session: any) { return !!session && ["admin", "user", "retailer"].includes(session.role ?? ""); }
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = await db();
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get("search")?.trim() ?? "";
    const devicesCol = client.db().collection("CustomerDevice");
    const usersCol = client.db().collection("User");
    const query: any = { userId: session.id, archivedAt: { $exists: false } };
    if (search) query.$or = [
      { name: { $regex: search, $options: "i" } },
      { brand: { $regex: search, $options: "i" } },
      { model: { $regex: search, $options: "i" } },
      { imei: { $regex: search, $options: "i" } },
      { serial: { $regex: search, $options: "i" } },
      { clientName: { $regex: search, $options: "i" } },
    ];
    const [devices, clients] = await Promise.all([
      devicesCol.find(query).sort({ updatedAt: -1 }).limit(500).toArray(),
      usersCol.find({ role: "client" }, { projection: { name: 1, email: 1, image: 1 } }).sort({ name: 1 }).limit(1000).toArray(),
    ]);
    return NextResponse.json({ devices, clients });
  } catch (error) {
    console.error("GET /api/devices", error);
    return NextResponse.json({ error: "No se pudieron cargar los equipos" }, { status: 500 });
  } finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const clientId = typeof body.clientId === "string" && ObjectId.isValid(body.clientId) ? body.clientId : "";
  const brand = typeof body.brand === "string" ? body.brand.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : `${brand} ${model}`.trim();
  const imei = typeof body.imei === "string" ? body.imei.trim() : "";
  const serial = typeof body.serial === "string" ? body.serial.trim() : "";
  const phonePasscode = typeof body.phonePasscode === "string" ? body.phonePasscode.trim() : "";
  if (!clientId || !name || (!imei && !serial)) return NextResponse.json({ error: "Cliente, equipo y al menos IMEI o serial son obligatorios" }, { status: 400 });
  const client = await db();
  try {
    const users = client.db().collection("User"), devices = client.db().collection("CustomerDevice");
    const user = await users.findOne({ _id: new ObjectId(clientId), role: "client" }, { projection: { name: 1, email: 1 } });
    if (!user) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const duplicateQuery: any = { userId: session.id, $or: [] };
    if (imei) duplicateQuery.$or.push({ imei });
    if (serial) duplicateQuery.$or.push({ serial });
    if (duplicateQuery.$or.length && await devices.findOne(duplicateQuery)) return NextResponse.json({ error: "Ya existe un equipo con ese IMEI o serial" }, { status: 409 });
    const now = new Date();
    const device = { userId: session.id, clientId, clientName: user.name, clientEmail: user.email ?? "", name, brand, model, imei, serial, phonePasscode, color: typeof body.color === "string" ? body.color.trim() : "", storage: typeof body.storage === "string" ? body.storage.trim() : "", notes: typeof body.notes === "string" ? body.notes.trim() : "", status: "active", createdAt: now, updatedAt: now, createdBy: session.id, updatedBy: session.id };
    const result = await devices.insertOne(device);
    await writeAuditLog({ userId: session.id, action: "CUSTOMER_DEVICE_CREATED", entityType: "CustomerDevice", entityId: String(result.insertedId), details: { clientId, name, imei, serial } });
    return NextResponse.json({ ...device, _id: result.insertedId }, { status: 201 });
  } catch (error) {
    console.error("POST /api/devices", error);
    return NextResponse.json({ error: "No se pudo registrar el equipo" }, { status: 500 });
  } finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const id = typeof body.id === "string" && ObjectId.isValid(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Equipo inválido" }, { status: 400 });
  const client = await db();
  try {
    const devices = client.db().collection("CustomerDevice"), existing = await devices.findOne({ _id: new ObjectId(id), userId: session.id, archivedAt: { $exists: false } });
    if (!existing) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    const update: any = { updatedAt: new Date(), updatedBy: session.id };
    for (const key of ["name", "brand", "model", "imei", "serial", "phonePasscode", "color", "storage", "notes", "status"]) if (body[key] !== undefined) update[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
    await devices.updateOne({ _id: existing._id }, { $set: update });
    const auditUpdate = { ...update };
    delete auditUpdate.phonePasscode;
    await writeAuditLog({ userId: session.id, action: "CUSTOMER_DEVICE_UPDATED", entityType: "CustomerDevice", entityId: id, details: auditUpdate });
    return NextResponse.json(await devices.findOne({ _id: existing._id }));
  } finally { await client.close(); }
}
