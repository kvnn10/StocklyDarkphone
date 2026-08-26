import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const MAX_PHOTOS = 12;
const MAX_DATA_URL = 900_000;
const PHOTO_CATEGORIES = ["ingreso", "reparacion", "entrega"] as const;
type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

function allowed(session: any) {
  return !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

function normalizeCategory(value: unknown): PhotoCategory {
  return PHOTO_CATEGORIES.includes(value as PhotoCategory)
    ? (value as PhotoCategory)
    : "ingreso";
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const filename =
    typeof body.filename === "string" ? body.filename : "evidencia.jpg";
  const category = normalizeCategory(body.category);

  if (!ObjectId.isValid(orderId) || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Fotografía inválida" }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATA_URL) {
    return NextResponse.json(
      { error: "La fotografía comprimida sigue siendo demasiado grande" },
      { status: 400 },
    );
  }

  const client = await db();
  try {
    const collection = client.db().collection("ServiceOrder");
    const order = await collection.findOne({
      _id: new ObjectId(orderId),
      userId: session.id,
    });
    if (!order) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    }
    if (["delivered", "cancelled"].includes(String(order.status))) {
      return NextResponse.json({ error: "La orden está cerrada" }, { status: 409 });
    }

    const photos = Array.isArray(order.photos) ? order.photos : [];
    if (photos.length >= MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_PHOTOS} fotografías por orden` },
        { status: 400 },
      );
    }

    const photo = {
      id: new ObjectId().toString(),
      url: dataUrl,
      filename,
      category,
      uploadedAt: new Date(),
      uploadedBy: session.id,
    };

    await collection.updateOne(
      { _id: order._id },
      {
        $push: { photos: photo },
        $set: { updatedAt: new Date(), updatedBy: session.id },
      },
    );

    await writeAuditLog({
      userId: session.id,
      action: "SERVICE_ORDER_PHOTO_ADDED",
      entityType: "ServiceOrder",
      entityId: orderId,
      details: { photoId: photo.id, filename, category },
    });

    return NextResponse.json({ photo });
  } catch (error) {
    console.error("POST /api/service-orders/photos", error);
    return NextResponse.json(
      { error: "No se pudo guardar la fotografía" },
      { status: 500 },
    );
  } finally {
    await client.close();
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  if (!ObjectId.isValid(orderId) || !photoId) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const client = await db();
  try {
    const collection = client.db().collection("ServiceOrder");
    const order = await collection.findOne({
      _id: new ObjectId(orderId),
      userId: session.id,
    });
    if (!order) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    }
    if (["delivered", "cancelled"].includes(String(order.status))) {
      return NextResponse.json({ error: "La orden está cerrada" }, { status: 409 });
    }

    await collection.updateOne(
      { _id: order._id },
      {
        $pull: { photos: { id: photoId } },
        $set: { updatedAt: new Date(), updatedBy: session.id },
      },
    );

    await writeAuditLog({
      userId: session.id,
      action: "SERVICE_ORDER_PHOTO_REMOVED",
      entityType: "ServiceOrder",
      entityId: orderId,
      details: { photoId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/service-orders/photos", error);
    return NextResponse.json(
      { error: "No se pudo eliminar la fotografía" },
      { status: 500 },
    );
  } finally {
    await client.close();
  }
}
