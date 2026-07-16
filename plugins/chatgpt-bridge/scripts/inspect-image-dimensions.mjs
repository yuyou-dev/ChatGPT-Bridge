#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { checksumSha256, imageDimensions } from "./chatgpt-bridge.mjs";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/inspect-image-dimensions.mjs <image> [image...]");
  process.exit(2);
}

const results = [];
for (const file of files) {
  const bytes = await readFile(file);
  const dimensions = imageDimensions(bytes);
  results.push({
    file,
    bytes: bytes.length,
    sha256: checksumSha256(bytes),
    format: dimensions.format,
    width: dimensions.width,
    height: dimensions.height,
    status: dimensions.width && dimensions.height ? "ok" : "unknown_dimensions"
  });
}

console.log(JSON.stringify(results, null, 2));
