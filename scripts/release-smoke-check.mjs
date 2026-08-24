const baseUrl = process.env.SMOKE_BASE_URL || "https://stockly-darkphone.vercel.app";
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;

if (!email || !password) {
  console.error("Missing SMOKE_EMAIL or SMOKE_PASSWORD");
  process.exit(2);
}

const checks = [
  ["public home", "/"],
  ["login", "/login"],
];

for (const [name, path] of checks) {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`${name} failed: HTTP ${response.status}`);
  console.log(`PASS ${name}: ${response.status}`);
}

const login = await fetch(new URL("/api/auth/login", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
  redirect: "manual",
});

console.log(`LOGIN ${login.status}`);
if ([400, 401, 403, 404, 405].includes(login.status)) {
  throw new Error(`Login smoke check rejected request: HTTP ${login.status}`);
}

console.log("Smoke preflight completed. Authenticated business operations are intentionally not executed against production by this script.");
