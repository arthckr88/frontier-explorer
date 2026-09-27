import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Header names and client identities that must not ship in Pages output. */
export const FORBIDDEN_PAGES_MARKERS = [
  "ocp-apim-subscription-key",
  "frontiertoken",
  "x-px-authorization",
  "x-px-hello",
  "x-px-device-fp",
  "x-px-uuid",
  "x-px-device-model",
  "x-px-mobile-sdk-version",
  "NCPAndroid/",
  "set-cookie",
  "device-id",
  "x-px-",
];

export function findForbiddenMarkers(text) {
  const lower = text.toLowerCase();
  return FORBIDDEN_PAGES_MARKERS.filter((marker) => lower.includes(marker.toLowerCase()));
}

export function scanDirectory(root) {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const stat = statSync(file);
      if (stat.isDirectory()) {
        walk(file);
        continue;
      }
      if (stat.size > 8_000_000) continue;
      const markers = findForbiddenMarkers(readFileSync(file, "utf8"));
      if (markers.length) hits.push({ file, markers });
    }
  };
  walk(root);
  return hits;
}
