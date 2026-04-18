import assert from "node:assert/strict";
import test from "node:test";

import { buildJobXml, resolveBuildTriggerPlan } from "../../scripts/jenkins/provision-job.js";

test("buildJobXml includes AUTH_TOKEN_SECRET password parameter definition", () => {
  const xml = buildJobXml({
    repoUrl: "https://github.com/example/GreJiJi",
    credentialsId: "",
    branch: "*/main",
    scriptPath: "Jenkinsfile"
  });

  assert.match(xml, /<hudson\.model\.ParametersDefinitionProperty>/);
  assert.match(xml, /<hudson\.model\.PasswordParameterDefinition>/);
  assert.match(xml, /<name>AUTH_TOKEN_SECRET<\/name>/);
});

test("resolveBuildTriggerPlan defaults to safe auto mode when no secret is provided", () => {
  const plan = resolveBuildTriggerPlan({
    triggerBuild: "auto",
    authTokenSecret: ""
  });

  assert.equal(plan.shouldTrigger, false);
  assert.equal(plan.useParameters, false);
  assert.match(plan.reason, /skipped/i);
});

test("resolveBuildTriggerPlan uses parameterized build when secret is provided", () => {
  const plan = resolveBuildTriggerPlan({
    triggerBuild: "auto",
    authTokenSecret: "super-secret"
  });

  assert.equal(plan.shouldTrigger, true);
  assert.equal(plan.useParameters, true);
  assert.match(plan.reason, /parameter/i);
});

test("resolveBuildTriggerPlan throws on unsupported trigger mode", () => {
  assert.throws(
    () => resolveBuildTriggerPlan({ triggerBuild: "sometimes", authTokenSecret: "" }),
    /Invalid --trigger-build value/i
  );
});
