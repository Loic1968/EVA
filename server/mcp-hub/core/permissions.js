/**
 * Tool permission checks - risk level gating, write blocking
 */
import { loadConfig } from '../config/mcp.config.js';
export function checkToolPermission(riskLevel, toolName) {
    const config = loadConfig();
    if (riskLevel === 'READ') {
        return { allowed: true };
    }
    if (config.mcpIncidentMode) {
        return { allowed: false, reason: 'MCP_INCIDENT_MODE: all writes blocked' };
    }
    if (riskLevel === 'WRITE_SAFE') {
        if (!config.mcpWriteSafeEnabled) {
            return { allowed: false, reason: 'MCP_WRITE_SAFE_ENABLED=false' };
        }
        return { allowed: true };
    }
    if (riskLevel === 'WRITE_DANGEROUS') {
        if (!config.mcpWriteDangerousEnabled) {
            return { allowed: false, reason: 'MCP_WRITE_DANGEROUS_ENABLED=false' };
        }
        return { allowed: true };
    }
    return { allowed: false, reason: `unknown risk level: ${riskLevel}` };
}
