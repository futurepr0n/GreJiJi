#!/usr/bin/env node

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    args[key] = value;
    if (value !== true) i += 1;
  }
  return args;
}

function required(args, key) {
  const value = String(args[key] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required argument --${key}`);
  }
  return value;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baseUrl = required(args, 'base-url').replace(/\/$/, '');
  const user = required(args, 'user');
  const token = required(args, 'token');
  const repoUrl = required(args, 'repo-url');
  const credentialsId = String(args['credentials-id'] ?? '').trim();
  const branch = String(args.branch ?? '*/main');
  const folder = String(args.folder ?? '').trim();
  const job = String(args.job ?? (folder ? 'deploy' : 'GreJiJi')).trim();
  const scriptPath = String(args['script-path'] ?? 'Jenkinsfile');

  const authHeader = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

  async function call(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: authHeader,
        ...(options.headers ?? {})
      },
      body: options.body
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status} ${response.statusText}\n${body}`);
    }
    return response;
  }

  let crumbHeader = {};
  try {
    const crumbResponse = await call('/crumbIssuer/api/json');
    const crumb = await crumbResponse.json();
    crumbHeader = { [crumb.crumbRequestField]: crumb.crumb };
  } catch {
    crumbHeader = {};
  }

  async function exists(path) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: authHeader }
    });
    return response.ok;
  }

  if (folder) {
    const folderApiPath = `/job/${encodeURIComponent(folder)}/api/json`;
    const folderExists = await exists(folderApiPath);

    if (!folderExists) {
      const folderXml = `<?xml version='1.1' encoding='UTF-8'?>
<com.cloudbees.hudson.plugins.folder.Folder plugin="cloudbees-folder">
  <actions/>
  <description>GreJiJi deployment pipelines</description>
  <properties/>
  <folderViews class="com.cloudbees.hudson.plugins.folder.views.DefaultFolderViewHolder"/>
  <healthMetrics/>
  <icon class="com.cloudbees.hudson.plugins.folder.icons.StockFolderIcon"/>
</com.cloudbees.hudson.plugins.folder.Folder>`;

      try {
        await call(`/createItem?name=${encodeURIComponent(folder)}`, {
          method: 'POST',
          headers: {
            ...crumbHeader,
            'Content-Type': 'application/xml'
          },
          body: folderXml
        });
        console.log(`Created folder: ${folder}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('already exists')) {
          throw error;
        }
        console.log(`Folder exists: ${folder}`);
      }
    } else {
      console.log(`Folder exists: ${folder}`);
    }
  }

  const jobRootPath = folder
    ? `/job/${encodeURIComponent(folder)}/job/${encodeURIComponent(job)}`
    : `/job/${encodeURIComponent(job)}`;
  const jobApiPath = `${jobRootPath}/api/json`;
  const jobExists = await exists(jobApiPath);

  const jobXml = `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <actions/>
  <description>GreJiJi CI/CD pipeline using Docker deployment.</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>${xmlEscape(repoUrl)}</url>
          <credentialsId>${xmlEscape(credentialsId)}</credentialsId>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>${xmlEscape(branch)}</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>${xmlEscape(scriptPath)}</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers>
    <hudson.triggers.SCMTrigger>
      <spec>H/5 * * * *</spec>
      <ignorePostCommitHooks>false</ignorePostCommitHooks>
    </hudson.triggers.SCMTrigger>
  </triggers>
  <disabled>false</disabled>
</flow-definition>`;

  if (jobExists) {
    await call(`${jobRootPath}/config.xml`, {
      method: 'POST',
      headers: {
        ...crumbHeader,
        'Content-Type': 'application/xml'
      },
      body: jobXml
    });
    console.log(`Updated job: ${folder ? `${folder}/${job}` : job}`);
  } else {
    const createPath = folder
      ? `/job/${encodeURIComponent(folder)}/createItem?name=${encodeURIComponent(job)}`
      : `/createItem?name=${encodeURIComponent(job)}`;
    await call(createPath, {
      method: 'POST',
      headers: {
        ...crumbHeader,
        'Content-Type': 'application/xml'
      },
      body: jobXml
    });
    console.log(`Created job: ${folder ? `${folder}/${job}` : job}`);
  }

  await call(`${jobRootPath}/build`, {
    method: 'POST',
    headers: {
      ...crumbHeader
    }
  });

  console.log(`Triggered build: ${folder ? `${folder}/${job}` : job}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
