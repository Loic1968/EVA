/**
 * Tool registration - all tools
 */
import { registerTool } from '../core/registry.js';
import { envCheckSanity } from './env/check_sanity.js';
import { filesRead } from './files/read.js';
import { dbQueryReadonly } from './db/query_readonly.js';
import { routingScanRoutes } from './routing/scan_routes.js';
import { routingScanLinks } from './routing/scan_links.js';
import { subscriptionScanPlans } from './subscription/scan_plans.js';
import { qaFullPlatformScan } from './qa/full_platform_scan.js';
import { deployStatus, deployTrigger } from './deploy/index.js';
import { commsGmailSearch, commsGmailReadThread } from './comms/index.js';
import { financeCreateTermSheetDraft } from './finance/index.js';
import { docsList, docsSearch, docsReadChunk, docsGetDoc } from './docs/index.js';
import { webSearch, webSearchNews } from './web/search.js';
import { gmailSearch, gmailSearchSchema, gmailRecent, gmailRecentSchema, gmailSendDraft, gmailSendDraftSchema } from './gmail/index.js';
import { calendarEvents, calendarEventsSchema, calendarSearch, calendarSearchSchema, calendarCreateEvent, calendarCreateEventSchema } from './calendar/index.js';
const stubWrap = (fn) => async () => fn();
function reg(domain, name, handler) {
    registerTool({
        domain,
        name,
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler,
    });
}
export function registerAllTools() {
    reg('env', 'check_sanity', envCheckSanity);
    reg('files', 'read', filesRead);
    reg('db', 'query_readonly', dbQueryReadonly);
    reg('routing', 'scan_routes', routingScanRoutes);
    reg('routing', 'scan_links', routingScanLinks);
    reg('subscription', 'scan_plans', subscriptionScanPlans);
    reg('qa', 'full_platform_scan', qaFullPlatformScan);
    registerTool({
        domain: 'deploy',
        name: 'status',
        risk_level: 'READ',
        allowed_roles: ['platform_admin'],
        handler: stubWrap(deployStatus),
    });
    registerTool({
        domain: 'deploy',
        name: 'trigger',
        risk_level: 'WRITE_SAFE',
        allowed_roles: ['platform_admin'],
        handler: stubWrap(deployTrigger),
    });
    registerTool({
        domain: 'comms',
        name: 'gmail_search',
        risk_level: 'READ',
        allowed_roles: ['platform_admin'],
        handler: stubWrap(commsGmailSearch),
    });
    registerTool({
        domain: 'comms',
        name: 'gmail_read_thread',
        risk_level: 'READ',
        allowed_roles: ['platform_admin'],
        handler: stubWrap(commsGmailReadThread),
    });
    registerTool({
        domain: 'finance',
        name: 'create_term_sheet_draft',
        risk_level: 'WRITE_SAFE',
        allowed_roles: ['platform_admin'],
        handler: stubWrap(financeCreateTermSheetDraft),
    });
    // docs.* — EVA Memory Vault (read-only, owner-scoped)
    reg('docs', 'list', docsList);
    reg('docs', 'search', docsSearch);
    reg('docs', 'read_chunk', docsReadChunk);
    reg('docs', 'get_doc', docsGetDoc);
    // web.* — Tavily web search (news, general, finance)
    registerTool({
        domain: 'web',
        name: 'search',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: webSearch,
        schema: {
            query: { type: 'string', required: true },
            topic: { type: 'string' },
            max_results: { type: 'number' },
            search_depth: { type: 'string' },
            time_range: { type: 'string' },
        },
    });
    registerTool({
        domain: 'web',
        name: 'search_news',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: webSearchNews,
        schema: {
            query: { type: 'string', required: true },
            max_results: { type: 'number' },
            time_range: { type: 'string' },
        },
    });
    // gmail.* — User email (read from eva.emails, send via Gmail API)
    registerTool({
        domain: 'gmail',
        name: 'search',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: gmailSearch,
        schema: gmailSearchSchema,
    });
    registerTool({
        domain: 'gmail',
        name: 'recent',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: gmailRecent,
        schema: gmailRecentSchema,
    });
    registerTool({
        domain: 'gmail',
        name: 'send_draft',
        risk_level: 'WRITE_SAFE',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: gmailSendDraft,
        schema: gmailSendDraftSchema,
    });
    // calendar.* — User calendar (read from eva.calendar_events, create via Calendar API)
    registerTool({
        domain: 'calendar',
        name: 'events',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: calendarEvents,
        schema: calendarEventsSchema,
    });
    registerTool({
        domain: 'calendar',
        name: 'search',
        risk_level: 'READ',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: calendarSearch,
        schema: calendarSearchSchema,
    });
    registerTool({
        domain: 'calendar',
        name: 'create_event',
        risk_level: 'WRITE_SAFE',
        allowed_roles: ['platform_admin', 'platform_user', 'platform'],
        handler: calendarCreateEvent,
        schema: calendarCreateEventSchema,
    });
}
