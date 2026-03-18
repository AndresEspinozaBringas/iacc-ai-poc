import Anthropic from "@anthropic-ai/sdk";
import { Langfuse } from "langfuse";
import "dotenv/config";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

async function main() {
  const trace = langfuse.trace({ name: "test-claude-poc" });
  const generation = trace.generation({
    name: "primera-llamada",
    model: "claude-haiku-4-5-20251001",
    input: [{ role: "user", content: "¿Cuál es la capital de Chile? Responde en una sola oración." }],
  });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{ role: "user", content: "¿Cuál es la capital de Chile? Responde en una sola oración." }],
  });

  const output = response.content[0].text;
  console.log("Respuesta:", output);

  generation.end({
    output,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  });

  await langfuse.flushAsync();
  console.log("Traza enviada a Langfuse → http://localhost:3000");
}

main().catch(console.error);
