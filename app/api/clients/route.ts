import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";

function isAllowed(role?: string | null) {
  return role === "admin" || role === "user" || role === "retailer";
}

async function withClientsCollection<T>(fn: (collection: any) => Promise<T>) {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const collection = client.db().collection("User");
    return await fn(collection);
  } finally {
    await client.close();
  }
}

async function getOrderStats(clientIds: string[]) {
  if (clientIds.length === 0) return new Map<string, { orderCount: number; totalSpent: number }>();

  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const rows = await client.db().collection("Order").aggregate([
      { $match: { clientId: { $in: clientIds } } },
      {
        $group: {
          _id: "$clientId",
          orderCount: { $sum: 1 },
          totalSpent: { $sum: "$total" },
        },
      },
    ]).toArray();

    return new Map(
      rows.map((row: any) => [
        String(row._id),
        {
          orderCount: Number(row.orderCount ?? 0),
          totalSpent: Number(row.totalSpent ?? 0),
        },
      ]),
    );
  } finally {
    await client.close();
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || !isAllowed(session.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const clients = await withClientsCollection(async (users) =>
      users.find(
        { role: "client" },
        { projection: { password: 0 } },
      ).sort({ createdAt: -1 }).toArray(),
    );

    const clientIds = clients.map((client: any) => client._id.toString());
    const statsMap = await getOrderStats(clientIds);

    return NextResponse.json(clients.map((client: any) => {
      const id = client._id.toString();
      const stats = statsMap.get(id) ?? { orderCount: 0, totalSpent: 0 };
      return {
        ...client,
        id,
        _id: undefined,
        orderCount: stats.orderCount,
        totalSpent: stats.totalSpent,
      };
    }));
  } catch (error) {
    logger.error("Error fetching clients:", error);
    return NextResponse.json({ error: "No se pudieron cargar los clientes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || !isAllowed(session.role)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : phone;
    const document = typeof body.document === "string" ? body.document.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    if (!name || !email) return NextResponse.json({ error: "Nombre y correo electrónico son obligatorios" }, { status: 400 });

    const result = await withClientsCollection(async (users) => {
      const existing = await users.findOne({ email });
      if (existing) return { conflict: true };

      const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "") || `cliente${Date.now()}`;
      let username = usernameBase;
      let counter = 1;
      while (await users.findOne({ username })) username = `${usernameBase}${counter++}`;

      const temporaryPassword = `${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}A1!`;
      const password = await bcrypt.hash(temporaryPassword, 10);
      const now = new Date();
      const doc = {
        name,
        email,
        password,
        username,
        role: "client",
        phone,
        whatsapp,
        document,
        address,
        city,
        notes,
        status: true,
        createdAt: now,
        createdBy: session.id,
      };
      const inserted = await users.insertOne(doc);
      return {
        client: { id: inserted.insertedId.toString(), name, email, phone, whatsapp, document, address, city, notes, status: true, createdAt: now, orderCount: 0, totalSpent: 0 },
        temporaryPassword,
      };
    });

    if (result.conflict) return NextResponse.json({ error: "Ya existe un usuario con ese correo electrónico" }, { status: 409 });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logger.error("Error creating client:", error);
    return NextResponse.json({ error: "No se pudo crear el cliente" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || !isAllowed(session.role)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const body = await request.json();
    if (!body.id || !ObjectId.isValid(body.id)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });

    const allowed = ["name", "email", "phone", "whatsapp", "document", "address", "city", "notes", "status"];
    const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: session.id };
    for (const key of allowed) if (body[key] !== undefined) update[key] = typeof body[key] === "string" ? body[key].trim() : body[key];

    const result = await withClientsCollection(async (users) => users.updateOne({ _id: new ObjectId(body.id), role: "client" }, { $set: update }));
    if (!result.matchedCount) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error updating client:", error);
    return NextResponse.json({ error: "No se pudo actualizar el cliente" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || !isAllowed(session.role)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
    const result = await withClientsCollection(async (users) => users.updateOne({ _id: new ObjectId(id), role: "client" }, { $set: { status: false, updatedAt: new Date(), updatedBy: session.id } }));
    if (!result.matchedCount) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error disabling client:", error);
    return NextResponse.json({ error: "No se pudo desactivar el cliente" }, { status: 500 });
  }
}
