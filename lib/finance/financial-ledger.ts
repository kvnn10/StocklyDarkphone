import { MongoClient, ObjectId } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

function getClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada");
  if (!clientPromise) {
    const client = new MongoClient(process.env.DATABASE_URL);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export function validObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

export function oid(value: string) {
  return new ObjectId(value);
}

export async function financeDb() {
  const client = await getClient();
  return client.db();
}

export async function nextDocumentNumber(prefix: string, collectionName: string, field: string) {
  const db = await financeDb();
  const row = await db.collection(collectionName).find({ [field]: { $regex: `^${prefix}-` } }).sort({ createdAt: -1 }).limit(1).next();
  const match = row?.[field]?.match?.(/(\d+)$/);
  return `${prefix}-${String((match ? Number(match[1]) : 0) + 1).padStart(6, "0")}`;
}

export function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}
