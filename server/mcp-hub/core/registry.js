/**
 * Tool registry - all tools declare domain, name, risk_level, allowed_roles
 */
const tools = new Map();
export function registerTool(descriptor) {
    const key = `${descriptor.domain}.${descriptor.name}`;
    tools.set(key, descriptor);
}
export function getTool(name) {
    return tools.get(name);
}
export function listTools() {
    return Array.from(tools.values());
}
