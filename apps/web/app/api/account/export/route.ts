import { authenticatedClient } from "../../../../lib/auth";

export async function GET() {
  const api = await authenticatedClient();
  if (!api) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const exported = (await api.request({ path: "/v1/account/export" })).data;
    return new Response(JSON.stringify(exported, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="sandbox-account-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "export_unavailable" }, { status: 502 });
  }
}
