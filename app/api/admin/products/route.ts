
function isValidInternalKey(request: NextRequest): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  return Boolean(configuredKey) && request.headers.get("authorization") === `Bearer ${configuredKey}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveReference(kind: "category" | "supplier", value: unknown, ownerId: string) {
  const nameOrId = text(value);
  if (!nameOrId) return { id: null as string | null, error: `${kind} is required` };

  if (kind === "category") {
    const byId = await prisma.category.findFirst({ where: { id: nameOrId, userId: ownerId }, select: { id: true } });
    if (byId) return { id: byId.id, error: undefined };
    const matches = await prisma.category.findMany({ where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } }, select: { id: true }, take: 2 });
    const match = matches[0];
    if (matches.length === 1 && match) return { id: match.id, error: undefined };
    if (matches.length > 1) return { id: null as string | null, error: `Multiple ${kind}s match "${nameOrId}"; use the ID to disambiguate` };
    return { id: null as string | null, error: `${kind} "${nameOrId}" not found for this admin` };
  }

  const byId = await prisma.supplier.findFirst({ where: { id: nameOrId, userId: ownerId }, select: { id: true } });
  if (byId) return { id: byId.id, error: undefined };
  const matches = await prisma.supplier.findMany({ where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } }, select: { id: true }, take: 2 });
  const match = matches[0];
  if (matches.length === 1 && match) return { id: match.id, error: undefined };
  if (matches.length > 1) return { id: null as string | null, error: `Multiple ${kind}s match "${nameOrId}"; use the ID to disambiguate` };
  return { id: null as string | null, error: `${kind} "${nameOrId}" not found for this admin` };
}
