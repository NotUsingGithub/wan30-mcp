import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { PACKAGE_PATHS, buildZip, extensionFiles, readZip } from "../package.mjs";
import { encodePng, renderIcon } from "../icons.mjs";

test("the upload zip is the extension itself and the icon is generated locally", () => {
  const files = extensionFiles();
  assert.deepEqual(
    files.map((file) => file.name),
    PACKAGE_PATHS
  );
  const zip = buildZip(files);
  assert.deepEqual(zip, buildZip(files));
  const packed = readZip(zip);
  assert.deepEqual(
    packed.map((file) => file.name),
    [...PACKAGE_PATHS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  );
  for (const file of packed) {
    const source = files.find((item) => item.name === file.name);
    assert.deepEqual(inflateRawSync(file.compressed), source.data);
  }
  const manifestBytes = inflateRawSync(packed.find((file) => file.name === "manifest.json").compressed);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Wan30 MCP Setup");
  assert.equal(manifest.version, "0.1.0");
  assert.ok(manifest.description.length > 0 && manifest.description.length <= 132);
  assert.equal(manifest.action.default_popup, "popup.html");
  for (const key of [
    "permissions",
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "content_scripts",
    "background",
    "devtools_page",
    "chrome_url_overrides",
    "externally_connectable",
    "content_security_policy",
    "oauth2",
    "update_url",
  ]) {
    assert.equal(Object.hasOwn(manifest, key), false, key);
  }
  for (const size of [16, 32, 48, 128]) {
    const png = encodePng(size);
    assert.deepEqual(readFileSync(new URL(`../icons/icon${size}.png`, import.meta.url)), png);
  }
  const pixels = renderIcon(128);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(64 * 128 + 64) * 4 + 3], 255);
  const joined = files.map((file) => file.data.toString("utf8")).join("\n");
  for (const secret of ["WAN30_ACCESS_TOKEN", "BEGIN PRIVATE", "AKIA", "ghp_"]) {
    assert.equal(joined.includes(secret), false, secret);
  }
});
