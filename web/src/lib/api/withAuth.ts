import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { ApiError } from "./httpError";

export interface AuthedRequest {
  uid: string;
  role: string | undefined;
  body: unknown;
}

// Every /api/* route handler re-validates the caller's identity and role
// itself — this is the same requirement Cloud Functions had (Admin SDK
// bypasses Security Rules entirely, so authorization must be re-enforced in
// code), just re-implemented against a Firebase ID token passed as a bearer
// header instead of the callable-functions wire protocol's implicit auth.
export function withAuth(handler: (req: AuthedRequest) => Promise<unknown>) {
  return async function (request: Request): Promise<NextResponse> {
    try {
      const authHeader = request.headers.get("authorization") ?? "";
      const match = authHeader.match(/^Bearer (.+)$/);
      if (!match) throw new ApiError(401, "Missing bearer token.");

      const decoded = await getAdminAuth().verifyIdToken(match[1]);
      const body = await request.json().catch(() => ({}));

      const result = await handler({
        uid: decoded.uid,
        role: decoded.role as string | undefined,
        body,
      });
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal error." }, { status: 500 });
    }
  };
}
