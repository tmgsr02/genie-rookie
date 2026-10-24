// Reads a description file (one JSON op per line). Node only.
import { readFileSync } from "node:fs";

export const readOps = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
