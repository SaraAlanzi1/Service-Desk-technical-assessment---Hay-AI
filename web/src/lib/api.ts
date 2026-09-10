import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase/client";

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === "true";

// Cloud Function name -> this app's own /api/* route path. Only consulted
// when NOT running against the local emulator suite.
const API_PATH: Record<string, string> = {
  acknowledge: "acknowledge",
  openPause: "pause",
  resumeTicket: "resume",
  resolveTicket: "resolve",
  generateMonthlyReport: "reports/generate",
};

// Every ticket-transition/report-generation mutation goes through this one
// function. Against the local emulator suite it calls the real Cloud
// Function (httpsCallable) exactly as before — that path is untouched.
// Everywhere else it calls this app's own /api/* route handlers, which are
// the zero-cost Vercel serverless replacement for Cloud Functions Gen 2 in
// production (see SECURITY.md). Same call shape on both paths, so callers
// don't need to know which one they're on.
export async function callMutation<T = unknown>(name: string, data: Record<string, unknown>): Promise<T> {
  if (USE_EMULATOR) {
    const result = await httpsCallable(functions, name)(data);
    return result.data as T;
  }

  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const idToken = await user.getIdToken();

  const res = await fetch(`/api/${API_PATH[name]}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json.error === "string" ? json.error : `Request failed (${res.status}).`);
  }
  return json as T;
}
