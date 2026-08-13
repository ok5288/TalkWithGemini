import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDirectory = join(projectRoot, "public", "vendor");
const heicModulePath = require.resolve("heic-to/csp");
const heicPackageRoot = resolve(dirname(heicModulePath), "../..");

await mkdir(vendorDirectory, { recursive: true });
await Promise.all([
  copyFile(heicModulePath, join(vendorDirectory, "heic-to-csp.mjs")),
  copyFile(
    join(heicPackageRoot, "LICENSE"),
    join(vendorDirectory, "heic-to.LICENSE.txt"),
  ),
]);

console.log("Prepared browser-only vendor assets.");
