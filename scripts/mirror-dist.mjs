/** Copy the built website to the repository root as well as apps/web/dist.
 *
 * A static host resolves its output directory relative to whichever directory
 * it treats as the project root, and that is not always the directory the build
 * command ran in. Publishing the bundle in both places means the deployment
 * works whether the host is pointed at the repository root or at apps/web,
 * instead of the setting having to be guessed correctly.
 */
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "apps/web/dist");
const to = resolve(root, "dist");

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`mirrored ${from} -> ${to}`);
