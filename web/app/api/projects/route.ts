export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ projects: [], status: "onboarding_pending" });
}

export async function POST() {
  return Response.json({ error: "Project provisioning is not active yet." }, { status: 503 });
}
