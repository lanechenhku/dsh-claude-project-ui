
import { createTools } from "../src/tools.js";

const ANNOTATION = ["description", "title", "default", "examples"];
const TYPES = new Set(["string", "number", "integer", "boolean", "null", "array", "object", "json"]);

function checkValue(node, path, allowRequired, problems) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    problems.push(path + ": must be a schema object");
    return;
  }
  const allowed = new Set([...ANNOTATION, "type", "enum", "const", ...(allowRequired ? ["required"] : []),
    ...(node.type === "array" ? ["items"] : []),
    ...(node.type === "object" ? ["properties", "additionalProperties"] : [])]);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) problems.push(path + "." + key + ": not in the host DSL vocabulary");
  }
  if (Object.hasOwn(node, "required") && node.required !== true) problems.push(path + ".required: must be true when present");
  if (Object.hasOwn(node, "type") && !TYPES.has(node.type)) problems.push(path + ".type: unsupported (" + node.type + ")");
  if (node.type === "object" && (typeof node.additionalProperties !== "boolean" || !Object.hasOwn(node, "additionalProperties"))) {
    problems.push(path + ".additionalProperties: required boolean for object nodes");
  }
  if (node.type === "array" && node.items !== undefined) checkValue(node.items, path + ".items", false, problems);
}

const fake = {
  config: { knowledgeIndexMaxChars: 900, boardContextMaxChars: 700, digestContextMaxChars: 700, briefMaxChars: 4000, maxNotes: 200, maxDocs: 200, maxKnowledgeChars: 4000000 },
  store: {},
  registry: {}
};
const tools = createTools(fake, "session-test", (spec) => spec);
const problems = [];
for (const tool of tools) {
  if (typeof tool.name !== "string" || tool.name.length === 0) problems.push("tool without name");
  if (typeof tool.description !== "string" || tool.description.length === 0) problems.push(tool.name + ": missing description");
  if (typeof tool.execute !== "function") problems.push(tool.name + ": missing execute");
  if (tool.output === undefined || typeof tool.output.render !== "function") problems.push(tool.name + ": missing output.render");
  if (tool.output?.schema === undefined) problems.push(tool.name + ": missing output.schema");
  else checkValue(tool.output.schema, tool.name + ".output.schema", false, problems);
  for (const [key, node] of Object.entries(tool.parameters ?? {})) checkValue(node, tool.name + ".parameters." + key, true, problems);
}
console.log("tools:", tools.length, tools.map((t) => t.name).join(", "));
console.log(problems.length === 0 ? "SPEC CHECK PASSED" : "SPEC CHECK FAILED:\n" + problems.join("\n"));
process.exit(problems.length === 0 ? 0 : 1);
