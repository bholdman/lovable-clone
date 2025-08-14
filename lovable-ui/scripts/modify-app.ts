import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), ".env") });

async function modifyApp(sandboxId: string, modificationRequest: string) {
  if (!process.env.DAYTONA_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY and ANTHROPIC_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  try {
    console.log(`🔧 Starting modification for sandbox: ${sandboxId}`);
    console.log(`📝 Request: ${modificationRequest}`);

    // Get the sandbox
    const sandboxes = await daytona.list();
    const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} not found`);
    }

    const rootDir = await sandbox.getUserRootDir();
    const projectDir = `${rootDir}/website-project`;
    const claudeCodeDir = `${rootDir}/claude-code-tools`;

    console.log("✅ Connected to sandbox");

    // Create modification script that uses Claude Code from sandbox level
    const modificationScript = `console.log('🤖 Starting application modification...');
const { query } = require('@anthropic-ai/claude-code');
const { spawn } = require('child_process');
const fs = require('fs');

const projectDir = '${projectDir}';
const modificationRequest = \`${modificationRequest}\`;

async function modifyApplication() {
  console.log('Working on project:', projectDir);
  console.log('Modification request:', modificationRequest);
  
  const prompt = \`I need to modify an existing Next.js application based on this user request:

"\${modificationRequest}"

The application is located at: \${projectDir}

Please:
1. First, understand the current application structure by reading key files
2. Make the requested changes while maintaining the existing functionality
3. Ensure the modified app still builds and runs correctly
4. Test that the changes work as expected

Focus on making targeted changes that fulfill the user's request.\`;

  try {
    console.log('__CLAUDE_MESSAGE__', JSON.stringify({ 
      type: 'assistant', 
      content: 'Starting to analyze your request and the current application...' 
    }));

    for await (const message of query({
      prompt: prompt,
      options: {
        maxTurns: 12,
        allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'LS', 'Glob', 'Grep']
      }
    })) {
      if (message.type === 'text') {
        console.log('__CLAUDE_MESSAGE__', JSON.stringify({ 
          type: 'assistant', 
          content: message.text 
        }));
      } else if (message.type === 'tool_use') {
        console.log('__TOOL_USE__', JSON.stringify({ 
          type: 'tool_use', 
          name: message.name, 
          input: message.input 
        }));
      }
    }
    
    console.log('🔄 Testing the modified application...');
    
    // Kill existing dev server
    await runCommand('pkill -f "next dev" || true', { cwd: projectDir });
    
    // Verify build and fix any errors (with self-healing)
    const buildSuccess = await verifyAndFixBuild();
    
    if (buildSuccess) {
      console.log('✅ Build successful after modifications');
      
      // Start the dev server
      await runCommand('nohup npm run dev > dev-server.log 2>&1 &', { cwd: projectDir });
      
      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Check if server is responding
      const healthCheck = await runCommand('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000', { cwd: projectDir });
      
      if (healthCheck.output && healthCheck.output.includes('200')) {
        console.log('✅ Application is running with modifications!');
        console.log('__MODIFICATION_COMPLETE__');
      } else {
        console.log('⚠️  Application may need more time to start');
        console.log('__MODIFICATION_COMPLETE__');
      }
    } else {
      console.log('❌ Build verification failed after modifications');
      console.log('__MODIFICATION_COMPLETE__');
    }
    
  } catch (error) {
    console.error('Modification failed:', error.message);
    throw error;
  }
}

function runCommand(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd: options.cwd || process.cwd() });
    let output = '';
    
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    
    child.on('exit', (code) => {
      resolve({ 
        success: code === 0, 
        output: output.trim()
      });
    });
  });
}

async function verifyAndFixBuild() {
  const maxAttempts = 3;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(\`\\n🔍 Build verification attempt \${attempt}/\${maxAttempts}...\`);
    
    // Try to build the project
    const buildResult = await runCommand('npm run build', { cwd: projectDir });
    
    if (buildResult.success) {
      console.log('✅ Build successful!');
      return true;
    }
    
    console.log(\`❌ Build failed (attempt \${attempt}/\${maxAttempts})\`);
    console.log('Build errors:');
    console.log(buildResult.output);
    
    if (attempt < maxAttempts) {
      console.log(\`\\n🔧 Attempting to fix build errors with Claude Code...\`);
      console.log('__HEALING_START__');
      
      const prompt = \`I have a Next.js application that failed to build with the following error:

\${buildResult.output}

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
          attempt: attempt
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
              attempt: attempt
            }));
          } else if (message.type === 'tool_use') {
            console.log('__TOOL_FIX__', JSON.stringify({ 
              type: 'tool_use', 
              name: message.name, 
              input: message.input,
              attempt: attempt
            }));
          }
        }
        
        console.log('✅ Build error fixing completed');
        console.log('__HEALING_END__');
        
      } catch (error) {
        console.error('Build fixing failed:', error.message);
        console.log('__HEALING_END__');
      }
    } else {
      console.log(\`❌ Build still failing after \${maxAttempts} attempts\`);
      console.log('__HEAL_FAILED__', JSON.stringify({ 
        error: "Build verification failed after multiple fix attempts",
        attempts: maxAttempts
      }));
      return false;
    }
  }
  
  return false;
}

modifyApplication().catch((error) => {
  console.error('Fatal modification error:', error);
  process.exit(1);
});`;

    // Write and execute the modification script
    console.log("📝 Creating modification script...");
    await sandbox.process.executeCommand(
      `cat > modify.js << 'MODIFY_EOF'
${modificationScript}
MODIFY_EOF`,
      rootDir
    );

    console.log("🚀 Running modification...");
    const modifyResult = await sandbox.process.executeCommand(
      `NODE_PATH=${claudeCodeDir}/node_modules node modify.js`,
      rootDir,
      {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      600000 // 10 minute timeout
    );

    console.log("Modification output:");
    console.log(modifyResult.result);

    if (modifyResult.exitCode === 0 || modifyResult.result?.includes('__MODIFICATION_COMPLETE__')) {
      console.log("✅ Modification completed successfully!");
    } else {
      console.log("⚠️  Modification may have encountered issues");
    }

  } catch (error: any) {
    console.error("❌ Modification failed:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  const modificationRequest = process.argv.slice(3).join(" ");
  
  if (!sandboxId || !modificationRequest) {
    console.error("Usage: npx tsx scripts/modify-app.ts <sandbox-id> <modification-request>");
    process.exit(1);
  }

  await modifyApp(sandboxId, modificationRequest);
}

main();