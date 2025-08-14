import { Daytona } from "@daytonaio/sdk";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function removeSandbox(sandboxId: string) {
  if (!process.env.DAYTONA_API_KEY) {
    console.error("ERROR: DAYTONA_API_KEY must be set");
    process.exit(1);
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  try {
    console.log(`Removing sandbox: ${sandboxId}...`);
    // Get the list of sandboxes first
    const sandboxes = await daytona.list();
    const sandbox = sandboxes.find((s: any) => s.id === sandboxId);
    
    if (!sandbox) {
      console.error(`Sandbox ${sandboxId} not found`);
      process.exit(1);
    }
    
    // Use destroy method if available, or remove
    if (typeof (sandbox as any).destroy === 'function') {
      await (sandbox as any).destroy();
    } else if (typeof (daytona as any).destroy === 'function') {
      await (daytona as any).destroy(sandboxId);
    } else if (typeof (daytona as any).delete === 'function') {
      await (daytona as any).delete(sandboxId);
    } else {
      console.error("No remove/destroy/delete method found on the Daytona SDK");
      console.log("Available methods on daytona:", Object.getOwnPropertyNames(Object.getPrototypeOf(daytona)));
      console.log("Available methods on sandbox:", Object.getOwnPropertyNames(Object.getPrototypeOf(sandbox)));
      process.exit(1);
    }
    
    console.log("✓ Sandbox removed successfully");
  } catch (error: any) {
    console.error("Failed to remove sandbox:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const sandboxId = process.argv[2];
  
  if (!sandboxId) {
    console.error("Usage: npx tsx scripts/remove-sandbox.ts <sandbox-id>");
    process.exit(1);
  }

  await removeSandbox(sandboxId);
}

main();