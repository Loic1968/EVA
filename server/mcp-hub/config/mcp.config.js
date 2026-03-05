/**
 * MCP Hub configuration
 * All feature flags default to safe/disabled.
 */
function parseEnv(name, def) {
    const v = process.env[name];
    return typeof v === 'string' && v.trim() ? v.trim() : def;
}
function parseEnvBool(name, def) {
    const v = process.env[name];
    if (typeof v !== 'string')
        return def;
    const lower = v.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
}
export function loadConfig() {
    const envRaw = parseEnv('ENVIRONMENT', process.env.NODE_ENV || 'development');
    const env = ['development', 'staging', 'production'].includes(envRaw)
        ? envRaw
        : 'development';
    return {
        environment: env,
        mcpWriteSafeEnabled: parseEnvBool('MCP_WRITE_SAFE_ENABLED', false),
        mcpWriteDangerousEnabled: parseEnvBool('MCP_WRITE_DANGEROUS_ENABLED', false),
        mcpPrOnlyMode: parseEnvBool('MCP_PR_ONLY_MODE', true),
        mcpIncidentMode: parseEnvBool('MCP_INCIDENT_MODE', false),
        defaultToolTimeoutMs: parseInt(process.env.MCP_TOOL_TIMEOUT_MS || '10000', 10) || 10000,
        rateLimitPerActorPerMinute: parseInt(process.env.MCP_RATE_LIMIT_PER_ACTOR || '20', 10) || 20,
        allowlistRoots: ['src/', 'server/', 'config/', 'docs/', 'migrations/', 'eva-local/'],
        denylistPatterns: [
            'node_modules',
            '.env',
            '\\.env\\.',
            '\\.pem$',
            '\\.key$',
            'credentials',
            'secret',
            'password',
        ],
        projectRoot: parseEnv('MCP_PROJECT_ROOT', process.cwd()),
    };
}
