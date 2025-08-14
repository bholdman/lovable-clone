import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { sandboxId, message, projectDir } = await req.json();
    
    if (!sandboxId || !message) {
      return new Response(
        JSON.stringify({ error: "Sandbox ID and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!process.env.DAYTONA_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing API keys" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[API] Starting modification for sandbox ${sandboxId}:`, message);
    
    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    // Start the async modification
    (async () => {
      try {
        // Use the modify-app.ts script
        const scriptPath = path.join(process.cwd(), "scripts", "modify-app.ts");
        const child = spawn("npx", ["tsx", scriptPath, sandboxId, message], {
          env: {
            ...process.env,
            DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          },
        });
        
        let buffer = "";
        
        // Capture stdout
        child.stdout.on("data", async (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            // Parse Claude messages
            if (line.includes('__CLAUDE_MESSAGE__')) {
              const jsonStart = line.indexOf('__CLAUDE_MESSAGE__') + '__CLAUDE_MESSAGE__'.length;
              try {
                const message = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "claude_message", 
                    content: message.content 
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse tool uses
            else if (line.includes('__TOOL_USE__')) {
              const jsonStart = line.indexOf('__TOOL_USE__') + '__TOOL_USE__'.length;
              try {
                const toolUse = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "tool_use", 
                    name: toolUse.name,
                    input: toolUse.input 
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse self-healing messages
            else if (line.includes('__CLAUDE_FIX__')) {
              const jsonStart = line.indexOf('__CLAUDE_FIX__') + '__CLAUDE_FIX__'.length;
              try {
                const fixMessage = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "healing_message", 
                    content: fixMessage.content,
                    attempt: fixMessage.attempt
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse healing tool uses
            else if (line.includes('__TOOL_FIX__')) {
              const jsonStart = line.indexOf('__TOOL_FIX__') + '__TOOL_FIX__'.length;
              try {
                const toolFix = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "healing_tool", 
                    name: toolFix.name,
                    input: toolFix.input,
                    attempt: toolFix.attempt
                  })}\n\n`)
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Parse healing status
            else if (line.includes('__HEALING_START__')) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: "healing_status", 
                  status: "starting"
                })}\n\n`)
              );
            }
            else if (line.includes('__HEALING_END__')) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: "healing_status", 
                  status: "ended"
                })}\n\n`)
              );
            }
            else if (line.includes('__HEAL_SUCCESS__')) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: "healing_status", 
                  status: "success"
                })}\n\n`)
              );
            }
            else if (line.includes('__HEAL_FAILED__')) {
              const jsonStart = line.indexOf('__HEAL_FAILED__') + '__HEAL_FAILED__'.length;
              try {
                const failInfo = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "healing_status", 
                    status: "failed",
                    error: failInfo.error,
                    attempts: failInfo.attempts
                  })}\n\n`)
                );
              } catch (e) {
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "healing_status", 
                    status: "failed"
                  })}\n\n`)
                );
              }
            }
            // Parse modification completion
            else if (line.includes('__MODIFICATION_COMPLETE__')) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ 
                  type: "modification_complete" 
                })}\n\n`)
              );
            }
            // Regular progress messages
            else {
              const output = line.trim();
              
              // Filter out internal logs
              if (output && 
                  !output.includes('[Claude]:') && 
                  !output.includes('[Tool]:') &&
                  !output.includes('__')) {
                
                // Send as progress
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: "progress", 
                    message: output 
                  })}\n\n`)
                );
              }
            }
          }
        });
        
        // Capture stderr
        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Modify Error]:", error);
          
          // Only send actual errors, not debug info
          if (error.includes("Error") || error.includes("Failed")) {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({ 
                type: "error", 
                message: error.trim() 
              })}\n\n`)
            );
          }
        });
        
        // Wait for process to complete
        await new Promise((resolve, reject) => {
          child.on("exit", (code) => {
            if (code === 0) {
              resolve(code);
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });
          
          child.on("error", reject);
        });
        
        // Send completion
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ 
            type: "complete" 
          })}\n\n`)
        );
        console.log(`[API] Modification complete for sandbox ${sandboxId}`);
        
        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during modification:", error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ 
            type: "error", 
            message: error.message 
          })}\n\n`)
        );
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await writer.close();
      }
    })();
    
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
    
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}