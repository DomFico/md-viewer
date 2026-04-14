export const LoggerSettings = {
    enabled: true
};

export function logDebug(context: string, message: string, data?: any) {
    if (!LoggerSettings.enabled) return;
    const timestamp = new Date().toISOString();
    let msg = `[${timestamp}] [${context}] ${message}`;
    if (data !== undefined) {
        msg += ` | Payload: ${JSON.stringify(data, null, 2)}`;
    }
    console.log(msg);
}
