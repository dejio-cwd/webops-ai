export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ memberships: [], status: "onboarding_pending" });
}

export async function POST() {
  return Response.json({ error: "Organization provisioning is not active yet." }, { status: 503 });
}
