/**
 * Tool execution timeout - abort and log
 */
export async function withTimeout(fn, ms, toolName) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Tool ${toolName} timed out after ${ms}ms`));
        }, ms);
    });
    try {
        return await Promise.race([fn(), timeoutPromise]);
    }
    finally {
        clearTimeout(timeoutId);
    }
}
