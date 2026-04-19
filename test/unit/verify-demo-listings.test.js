import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDemoCatalogIntegrity,
  verifyDemoMediaAvailability
} from "../../scripts/deploy/verify-demo-listings.js";
import { listExpectedDemoListings } from "../../src/demo-catalog.js";

test("validateDemoCatalogIntegrity passes for expected demo catalog", () => {
  const expected = listExpectedDemoListings();
  const result = validateDemoCatalogIntegrity(expected);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.demoListings.length, 10);
});

test("validateDemoCatalogIntegrity fails when listing media drifts", () => {
  const expected = listExpectedDemoListings();
  const drifted = expected.map((entry) => ({ ...entry }));
  drifted[0] = {
    ...drifted[0],
    title: "Unexpected title drift",
    photoUrls: ["https://example.com/external.png"]
  };

  const result = validateDemoCatalogIntegrity(drifted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /title mismatch/i);
  assert.match(result.errors.join("\n"), /non-deterministic media URL/i);
});

test("verifyDemoMediaAvailability fails when media endpoint is unavailable", async () => {
  const demoListings = listExpectedDemoListings();
  const media = await verifyDemoMediaAvailability({
    baseUrl: "http://demo.test",
    demoListings,
    fetchImpl: async () => ({
      status: 404,
      headers: {
        get() {
          return "text/plain";
        }
      }
    })
  });

  assert.equal(media.ok, false);
  assert.match(media.errors[0], /returned 404/i);
});
