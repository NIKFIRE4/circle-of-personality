import { getSession } from "@/lib/auth";
import { handleRouteError, jsonResponse } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return jsonResponse({ authenticated: false, user: null }, { status: 401 });
    }

    return jsonResponse({
      authenticated: true,
      user: session.user,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
