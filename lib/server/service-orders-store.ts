import { MongoClient } from "mongodb";

const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL is required");

const globalForMongo = globalThis as unknown as { serviceMongo?: MongoClient };
const client = globalForMongo.serviceMongo ?? new MongoClient(uri);
if (process.env.NODE_ENV !== "production") globalForMongo.serviceMongo = client;

export async function serviceDb() {
  await client.connect();
  return client.db();
}

export type ServiceStage = "INGRESS" | "REPAIR" | "DELIVERY";

export type ServiceOrder = {
  _id: string;
  userId: string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  device: string;
  imei?: string;
  serialNumber?: string;
  status: string;
  intakeCondition?: string;
  intakeNotes?: string;
  createdAt: string;
  updatedAt: string;
};

export async function listServiceOrders(userId: string) {
  const db = await serviceDb();
  return db.collection<ServiceOrder>("ServiceOrder").find({ userId }).sort({ createdAt: -1 }).toArray();
}

export async function createServiceOrder(input: Omit<ServiceOrder, "_id" | "createdAt" | "updatedAt">) {
  const db = await serviceDb();
  const now = new Date().toISOString();
  const order: ServiceOrder = { ...input, _id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.collection<ServiceOrder>("ServiceOrder").insertOne(order);
  return order;
}

export async function addEvidence(userId: string, serviceOrderId: string, stage: ServiceStage, url: string, name: string) {
  const db = await serviceDb();
  const service = await db.collection<ServiceOrder>("ServiceOrder").findOne({ _id: serviceOrderId, userId });
  if (!service) throw new Error("Service order not found");
  const evidence = {
    _id: crypto.randomUUID(),
    serviceOrderId,
    userId,
    stage,
    url,
    name,
    createdAt: new Date().toISOString(),
  };
  await db.collection("ServiceOrderEvidence").insertOne(evidence);
  return evidence;
}

export async function listEvidence(userId: string, serviceOrderId: string) {
  const db = await serviceDb();
  const service = await db.collection<ServiceOrder>("ServiceOrder").findOne({ _id: serviceOrderId, userId });
  if (!service) throw new Error("Service order not found");
  return db.collection("ServiceOrderEvidence").find({ serviceOrderId, userId }).sort({ createdAt: 1 }).toArray();
}
