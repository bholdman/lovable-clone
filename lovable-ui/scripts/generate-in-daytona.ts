import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function generateWebsiteInDaytona(
  sandboxIdArg?: string,
  prompt?: string
) {
  console.log("🚀 Starting website generation in Daytona sandbox...\n");

  if (!process.env.DAYTONA_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY and ANTHROPIC_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  let sandbox;
  let sandboxId = sandboxIdArg;

  try {
    // Step 1: Create or get sandbox
    if (sandboxId) {
      console.log(`1. Using existing sandbox: ${sandboxId}`);
      // Get existing sandbox
      const sandboxes = await daytona.list();
      sandbox = sandboxes.find((s: any) => s.id === sandboxId);
      if (!sandbox) {
        throw new Error(`Sandbox ${sandboxId} not found`);
      }
      console.log(`✓ Connected to sandbox: ${sandbox.id}`);
    } else {
      console.log("1. Creating new Daytona sandbox...");
      sandbox = await daytona.create({
        public: true,
        image: "node:20",
      });
      sandboxId = sandbox.id;
      console.log(`✓ Sandbox created: ${sandboxId}`);
    }

    // Get the root directory
    const rootDir = await sandbox.getUserRootDir();
    if (!rootDir) {
      throw new Error("Failed to get sandbox root directory");
    }
    console.log(`✓ Working directory: ${rootDir}`);

    // Step 2: Create project directory
    console.log("\n2. Setting up project directory...");
    const projectDir = `${rootDir}/website-project`;
    await sandbox.process.executeCommand(`mkdir -p ${projectDir}`, rootDir);
    console.log(`✓ Created project directory: ${projectDir}`);

    // Step 3: Initialize npm project
    console.log("\n3. Initializing npm project...");
    await sandbox.process.executeCommand("npm init -y", projectDir);
    console.log("✓ Package.json created");

    // Step 4: Install Claude Code SDK at sandbox level (not in the generated app)
    console.log("\n4. Installing Claude Code SDK at sandbox level...");

    // Create claude-code directory at sandbox root
    const claudeCodeDir = `${rootDir}/claude-code-tools`;
    await sandbox.process.executeCommand(`mkdir -p ${claudeCodeDir}`, rootDir);
    await sandbox.process.executeCommand("npm init -y", claudeCodeDir);

    const installResult = await sandbox.process.executeCommand(
      "npm install @anthropic-ai/claude-code@latest",
      claudeCodeDir,
      undefined,
      240000 // 4 minute timeout
    );

    if (installResult.exitCode !== 0) {
      console.error("Claude Code installation failed:", installResult.result);
      console.log("Will continue without self-healing capabilities");
    } else {
      console.log("✅ Claude Code SDK installed at sandbox level");
    }

    // Step 6: Create the generation script file
    console.log("\n6. Creating generation script file...");

    const generationScript = `const { query } = require('@anthropic-ai/claude-code');
const fs = require('fs');
const path = require('path');

async function generateWebsite() {
  const targetDir = process.env.TARGET_DIR || './website-project';

  // Change to target directory
  console.log('Target directory:', targetDir);
  process.chdir(targetDir);

  const prompt = \`${
    prompt ||
    "Create a modern blog website with markdown support and a dark theme"
  }

  Important requirements:
  - Create a NextJS app with TypeScript and Tailwind CSS
  - Use the app directory structure
  - Create all files in the current directory
  - Include a package.json with all necessary dependencies
  - Make the design modern and responsive
  - Add at least a home page and one other page but should include as many pages as needed by the application requirements
  - Include proper navigation between pages
  \`;

  console.log('Starting website generation with Claude Code...');
  console.log('Working directory:', process.cwd());

  const messages = [];
  const abortController = new AbortController();

  try {
    for await (const message of query({
      prompt: prompt,
      abortController: abortController,
      options: {
        maxTurns: 20,
        allowedTools: [
          'Read',
          'Write',
          'Edit',
          'MultiEdit',
          'Bash',
          'LS',
          'Glob',
          'Grep'
        ]
      }
    })) {
      messages.push(message);

      // Log progress
      if (message.type === 'text') {
        console.log('[Claude]:', (message.text || '').substring(0, 80) + '...');
        console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: message.text }));
      } else if (message.type === 'tool_use') {
        console.log('[Tool]:', message.name, message.input?.file_path || '');
        console.log('__TOOL_USE__', JSON.stringify({
          type: 'tool_use',
          name: message.name,
          input: message.input
        }));
      } else if (message.type === 'result') {
        console.log('__TOOL_RESULT__', JSON.stringify({
          type: 'tool_result',
          result: message.result
        }));
      }
    }

    console.log('\\nGeneration complete!');
    console.log('Total messages:', messages.length);

    // Save generation log
    fs.writeFileSync('generation-log.json', JSON.stringify(messages, null, 2));

    // List generated files
    const files = fs.readdirSync('.').filter(f => !f.startsWith('.'));
    console.log('\\nGenerated files:', files.join(', '));

  } catch (error) {
    console.error('Generation error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

generateWebsite().catch(console.error);`;

    // Write the script to sandbox root (where it can access Claude Code)
    await sandbox.process.executeCommand(
      `cat > generate.js << 'SCRIPT_EOF'
${generationScript}
SCRIPT_EOF`,
      rootDir
    );
    console.log("✓ Generation script written to sandbox root");

    // Verify the script was created
    const checkScript = await sandbox.process.executeCommand(
      "ls -la generate.js && head -5 generate.js",
      rootDir
    );
    console.log("Script verification:", checkScript.result);

    // Step 7: Run the generation script using sandbox-level Claude Code
    console.log("\n7. Running Claude Code generation...");
    console.log(`Prompt: "${prompt || "Create a modern blog website"}"`);
    console.log("\nThis may take several minutes...\n");

    const genResult = await sandbox.process.executeCommand(
      `NODE_PATH=${claudeCodeDir}/node_modules node generate.js`,
      rootDir,
      {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        TARGET_DIR: projectDir,
      },
      600000 // 10 minute timeout
    );

    console.log("\nGeneration output:");
    console.log(genResult.result);

    if (genResult.exitCode !== 0) {
      throw new Error("Generation failed");
    }

    // Step 8: Check generated files
    console.log("\n8. Checking generated files...");
    const filesResult = await sandbox.process.executeCommand(
      "ls -la",
      projectDir
    );
    console.log(filesResult.result);

    // Step 9: Install dependencies if package.json was updated
    const hasNextJS = await sandbox.process.executeCommand(
      "test -f package.json && grep -q next package.json && echo yes || echo no",
      projectDir
    );

    if (hasNextJS.result?.trim() === "yes") {
      console.log("\n9. Installing project dependencies...");
      const npmInstall = await sandbox.process.executeCommand(
        "npm install",
        projectDir,
        undefined,
        300000 // 5 minute timeout
      );

      if (npmInstall.exitCode !== 0) {
        console.log("Warning: npm install had issues:", npmInstall.result);
      } else {
        console.log("✓ Dependencies installed");
      }

      // Step 10: Verify build and fix any errors
      console.log("\n10. Verifying build and fixing any errors...");
      await verifyAndFixBuild(sandbox, projectDir, claudeCodeDir, rootDir);

      // Step 11: Start dev server in background
      console.log("\n11. Starting development server in background...");

      // Start the server in background using nohup
      await sandbox.process.executeCommand(
        `nohup npm run dev > dev-server.log 2>&1 &`,
        projectDir,
        { PORT: "3000" }
      );

      console.log("✓ Server started in background");

      // Wait a bit for server to initialize
      console.log("Waiting for server to start...");
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Check if server is running
      const checkServer = await sandbox.process.executeCommand(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'failed'",
        projectDir
      );

      if (checkServer.result?.trim() === "200") {
        console.log("✓ Server is running!");
      } else {
        console.log("⚠️  Server might still be starting...");
        console.log("You can check logs with: cat dev-server.log");
      }
    }

    // Step 12: Get preview URL
    console.log("\n12. Getting preview URL...");
    const preview = await sandbox.getPreviewLink(3000);

    console.log("\n✨ SUCCESS! Website generated!");
    console.log("\n📊 SUMMARY:");
    console.log("===========");
    console.log(`Sandbox ID: ${sandboxId}`);
    console.log(`Project Directory: ${projectDir}`);
    console.log(`Preview URL: ${preview.url}`);
    if (preview.token) {
      console.log(`Access Token: ${preview.token}`);
    }

    console.log("\n🌐 VISIT YOUR WEBSITE:");
    console.log(preview.url);

    console.log("\n💡 TIPS:");
    console.log("- The sandbox will stay active for debugging");
    console.log(
      "- Server logs: SSH in and run 'cat website-project/dev-server.log'"
    );
    console.log(
      `- To get preview URL again: npx tsx scripts/get-preview-url.ts ${sandboxId}`
    );
    console.log(
      `- To reuse this sandbox: npx tsx scripts/generate-in-daytona.ts ${sandboxId}`
    );
    console.log(`- To remove: npx tsx scripts/remove-sandbox.ts ${sandboxId}`);

    return {
      success: true,
      sandboxId: sandboxId,
      projectDir: projectDir,
      previewUrl: preview.url,
    };
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);

    if (sandbox) {
      console.log(`\nSandbox ID: ${sandboxId}`);
      console.log("The sandbox is still running for debugging.");

      // Try to get debug info
      try {
        const debugInfo = await sandbox.process.executeCommand(
          "pwd && echo '---' && ls -la && echo '---' && test -f generate.js && cat generate.js | head -20 || echo 'No script'",
          `${await sandbox.getUserRootDir()}/website-project`
        );
        console.log("\nDebug info:");
        console.log(debugInfo.result);
      } catch (e) {
        // Ignore
      }
    }

    throw error;
  }
}

async function verifyAndFixBuild(
  sandbox: any,
  projectDir: string,
  claudeCodeDir: string,
  rootDir: string
) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\n🔍 Build verification attempt ${attempt}/${maxAttempts}...`);

    // Try to build the project
    const buildResult = await sandbox.process.executeCommand(
      "npm run build",
      projectDir,
      undefined,
      180000 // 3 minute timeout
    );

    if (buildResult.exitCode === 0) {
      console.log("✅ Build successful!");
      return;
    }

    console.log(`❌ Build failed (attempt ${attempt}/${maxAttempts})`);
    console.log("Build errors:");
    console.log(buildResult.result);

    if (attempt < maxAttempts) {
      console.log(`\n🔧 Attempting to fix build errors with Claude Code...`);
      console.log("__HEALING_START__");

      // Create a fixing script that analyzes and fixes the build errors
      const fixScript = `console.log('🔧 Starting build error analysis and fix...');
const { query } = require('@anthropic-ai/claude-code');
const fs = require('fs');

async function fixBuildErrors() {
  const buildError = \`${
    buildResult.result?.replace(/`/g, "\\`") || "Unknown build error"
  }\`;

  console.log('Analyzing build error:', buildError.substring(0, 200) + '...');

  const prompt = \`I have a Next.js application that failed to build with the following error:

\${buildError}

Please analyze the error and fix it by:
1. Reading the relevant files to understand the issue
2. Creating any missing components or files
3. Fixing import/export issues
4. Ensuring all required dependencies are properly installed
5. Making sure the application builds successfully

The application is located in the current directory. Focus on fixing the specific build errors mentioned.

Important: Only make the minimal necessary changes to fix the build errors.\`;

  try {
    console.log('__CLAUDE_FIX__', JSON.stringify({
      type: 'assistant',
      content: 'Analyzing build errors and creating fixes...',
      attempt: ${attempt}
    }));

    for await (const message of query({
      prompt: prompt,
      options: {
        maxTurns: 8,
        allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'LS', 'Glob', 'Grep']
      }
    })) {
      if (message.type === 'text') {
        console.log('__CLAUDE_FIX__', JSON.stringify({
          type: 'assistant',
          content: message.text,
          attempt: ${attempt}
        }));
      } else if (message.type === 'tool_use') {
        console.log('__TOOL_FIX__', JSON.stringify({
          type: 'tool_use',
          name: message.name,
          input: message.input,
          attempt: ${attempt}
        }));
      }
    }

    console.log('✅ Build error fixing completed');

  } catch (error) {
    console.error('Build fixing failed:', error.message);
    throw error;
  }
}

fixBuildErrors().catch((error) => {
  console.error('Fatal build fixing error:', error);
  process.exit(1);
});`;

      // Write and execute the fix script
      await sandbox.process.executeCommand(
        `cat > fix-build.js << 'FIX_EOF'
${fixScript}
FIX_EOF`,
        rootDir
      );

      console.log("🚀 Running build error fix...");
      const fixResult = await sandbox.process.executeCommand(
        `NODE_PATH=${claudeCodeDir}/node_modules node fix-build.js`,
        projectDir,
        {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        },
        300000 // 5 minute timeout
      );

      console.log("Fix result:", fixResult.result);
      console.log("__HEALING_END__");

      if (fixResult.exitCode !== 0) {
        console.log(
          "⚠️ Build fixing encountered issues, will retry build anyway"
        );
      }
    } else {
      console.log(`❌ Build still failing after ${maxAttempts} attempts`);
      console.log(
        "__HEAL_FAILED__",
        JSON.stringify({
          error: "Build verification failed after multiple fix attempts",
          attempts: maxAttempts,
        })
      );

      // Don't throw error - let the process continue with the dev server
      // The user can still see and use the app even if build fails
      console.log(
        "⚠️ Continuing with development server despite build issues..."
      );
      return;
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let sandboxId: string | undefined;
  let prompt: string | undefined;

  // Parse arguments
  if (args.length > 0) {
    // Check if first arg is a sandbox ID (UUID format)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(args[0])) {
      sandboxId = args[0];
      prompt = args.slice(1).join(" ");
    } else {
      prompt = args.join(" ");
    }
  }

  if (!prompt) {
    prompt =
      "Create a modern blog website with markdown support and a dark theme. Include a home page, blog listing page, and individual blog post pages.";
  }

  console.log("📝 Configuration:");
  console.log(
    `- Sandbox: ${sandboxId ? `Using existing ${sandboxId}` : "Creating new"}`
  );
  console.log(`- Prompt: ${prompt}`);
  console.log();

  try {
    await generateWebsiteInDaytona(sandboxId, prompt);
  } catch (error) {
    console.error("Failed to generate website:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Exiting... The sandbox will continue running.");
  process.exit(0);
});

main();
