import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";

const ROLES = new Set(["admin", "user", "retailer"]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Equipo inválido" }, { status: 400 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    await client.connect();
    const db = client.db();
    const device = await db.collection("CustomerDevice").findOne({ _id: new ObjectId(id), userId: session.id, archivedAt: { $exists: false } }, { projection: { phonePasscode: 0 } });
    if (!device) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    const [history, movements] = await Promise.all([
      db.collection("CustomerDeviceHistory").find({ deviceId: id, userId: session.id }).sort({ createdAt: -1 }).limit(500).toArray(),
      device.productId ? db.collection("InventoryMovement").find({ userId: session.id, productId: new ObjectId(device.productId) }).sort({ createdAt: -1 }).limit(100).toArray() : Promise.resolve([]),
    ]);
    return NextResponse.json({ device, history, inventoryMovements: movements });
  } catch (error) {
    console.error("GET /api/devices/[id]/history", error);
    return NextResponse.json({ error: "No se pudo cargar el historial" }, { status: 500 });
  } finally { await client.close(); }
}
