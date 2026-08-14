import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specified = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const requiredMajor = Number(specified.replace(/^v/, "").split(".")[0]);
const actualMajor = Number(process.versions.node.split(".")[0]);

if (!Number.isInteger(requiredMajor) || actualMajor !== requiredMajor) {
  console.error(
    `This project requires Node ${requiredMajor} (see .nvmrc). Got ${process.version} (${process.execPath}).`,
  );
  process.exit(1);
}
