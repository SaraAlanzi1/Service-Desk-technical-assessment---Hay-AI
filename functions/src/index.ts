import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";

setGlobalOptions({ region: "us-central1" });
initializeApp();

export * from "./triggers/assignRoleClaim";
export * from "./callable/createTenant";
export * from "./callable/createProviderStaff";
export * from "./transitions/acknowledge";
export * from "./transitions/openPause";
export * from "./transitions/resumeTicket";
export * from "./transitions/resolveTicket";
export * from "./reports/generateMonthlyReport";
