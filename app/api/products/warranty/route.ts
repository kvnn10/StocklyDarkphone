import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

function allowed(session: any) {
  return !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const productId = new URL(request.url).searchParams.get("productId")?.trim() ?? "";
  if (!ObjectId.isValid(productId)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });

  const client = await db();
  try {
    const product = await client.db().collection("Product").findOne(
      { _id: new ObjectId(productId), userId: session.id },
      { projection: { name: 1, sku: 1, warrantyDays: 1 } },
    );
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    return NextResponse.json({
      productId,
      name: String(product.name || ""),
      sku: String(product.sku || ""),
      warrantyDays: Number.isInteger(product.warrantyDays) ? product.warrantyDays : 0,
    });
  } catch (error) {
    console.error("GET /api/products/warranty", error);
    return NextResponse.json({ error: "No se pudo cargar la garantía" }, { status: 500 });
  } finally {
    await client.close();
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  const warrantyDays = Number(body.warrantyDays);
  if (!ObjectId.isValid(productId) || !Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) {
    return NextResponse.json({ error: "Días de garantía inválidos" }, { status: 400 });
  }

  const client = await db();
  try {
    const products = client.db().collection("Product");
    const product = await products.findOne({ _id: new ObjectId(productId), userId: session.id });
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    await products.updateOne(
      { _id: product._id, userId: session.id },
      { $set: { warrantyDays, updatedAt: new Date(), updatedBy: session.id } },
    );

    await writeAuditLog({
      userId: session.id,
      action: "PRODUCT_WARRANTY_UPDATED",
      entityType: "Product",
      entityId: productId,
      details: { productName: String(product.name || ""), sku: String(product.sku || ""), warrantyDays },
    });

    return NextResponse.json({
      productId,
      name: String(product.name || ""),
      sku: String(product.sku || ""),
      warrantyDays,
    });
  } catch (error) {
    console.error("PUT /api/products/warranty", error);
    return NextResponse.json({ error: "No se pudo guardar la garantía" }, { status: 500 });
  } finally {
    await client.close();
  }
}
