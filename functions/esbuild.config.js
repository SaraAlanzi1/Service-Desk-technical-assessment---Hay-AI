const esbuild = require("esbuild");

// Bundles shared/ directly into lib/index.js so the deployed function is
// self-contained. Cloud Functions deploy uploads only this functions/
// directory and runs `npm install` on it in isolation — it has no
// visibility into sibling workspace packages, so @hay-service-desk/shared
// cannot be a runtime dependency. firebase-admin/firebase-functions stay
// external since they're real npm deps Cloud Build installs normally.
esbuild
  .build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: "lib/index.js",
    sourcemap: true,
    external: ["firebase-admin", "firebase-functions"],
  })
  .catch(() => process.exit(1));
