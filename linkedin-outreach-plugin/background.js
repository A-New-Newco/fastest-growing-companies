// background.js
// Supports both legacy mode (Groq + Google CRM) and dashboard mode.

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === "CALL_GROQ") {
        handleGroqRequest(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "SAVE_TO_CRM") {
        handleCrmSave(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_START_PAIRING") {
        handlePluginStartPairing()
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_COMPLETE_PAIRING") {
        handlePluginCompletePairing(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_START_RUN") {
        handlePluginStartRun(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_UPDATE_RUN") {
        handlePluginUpdateRun(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_CLAIM_NEXT") {
        handlePluginClaimNext(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_MARK_CONTACTED") {
        handlePluginMarkContacted(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_FAIL_CONTACT") {
        handlePluginFailContact(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_PARSE_OPERATOR_PROFILE") {
        handlePluginParseOperatorProfile(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (request.type === "PLUGIN_CONFIRM_OPERATOR_PROFILE") {
        handlePluginConfirmOperatorProfile(request.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    return false;
});

async function handleGroqRequest(payload) {
    const { groqApiKey } = await chrome.storage.local.get(['groqApiKey']);

    if (!groqApiKey) {
        throw new Error("Groq API Key not set. Please configure it in extension options.");
    }

    const { prompt, systemPrompt, modelOverride } = payload;

    const requestBody = {
        model: modelOverride || "llama-3.3-70b-versatile",
        messages: [
            { role: "system", "content": systemPrompt },
            { role: "user", "content": prompt }
        ],
        temperature: 0.7,
        max_tokens: 150 // max 300 chars usually means < 100 words
    };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${groqApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return { text: data.choices[0].message.content };
}

async function handleCrmSave(payload) {
    const { googleAppUrl, crmWebhookToken } = await chrome.storage.local.get(['googleAppUrl', 'crmWebhookToken']);

    if (!googleAppUrl) {
        throw new Error("Google Web App URL not set. Please configure it in extension options.");
    }

    const normalizedToken = (crmWebhookToken || '').trim();
    const requestPayload = normalizedToken
        ? { ...payload, token: normalizedToken }
        : payload;

    const response = await fetch(googleAppUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
    });

    const rawBody = await response.text();
    let parsedBody = null;

    if (rawBody) {
        try {
            parsedBody = JSON.parse(rawBody);
        } catch (_error) {
            parsedBody = null;
        }
    }

    if (!response.ok) {
        const detail = parsedBody?.error || rawBody || `HTTP ${response.status}`;
        throw new Error(`CRM save failed: ${detail}`);
    }

    if (!parsedBody || parsedBody.result !== 'success') {
        const detail = parsedBody?.error || rawBody || 'Unexpected CRM response.';
        throw new Error(`CRM save failed: ${detail}`);
    }

    return { success: true, crmResult: parsedBody };
}

async function getSettings() {
    return await chrome.storage.local.get([
        "integrationMode",
        "dashboardBaseUrl",
        "pluginToken",
        "campaignId",
        "groqApiKey",
        "googleAppUrl",
        "crmWebhookToken",
    ]);
}

function normalizeDashboardBaseUrl(value) {
    const raw = (value || "").trim();
    return raw.replace(/\/+$/, "");
}

function buildDashboardHeaders(pluginToken) {
    const headers = { "Content-Type": "application/json" };
    if (pluginToken) {
        headers.Authorization = `Bearer ${pluginToken}`;
    }
    return headers;
}

async function dashboardFetch(path, options = {}) {
    const settings = await getSettings();
    const base = normalizeDashboardBaseUrl(settings.dashboardBaseUrl);
    if (!base) throw new Error("Dashboard Base URL not configured.");

    const url = `${base}${path}`;
    const res = await fetch(url, {
        method: options.method || "POST",
        headers: buildDashboardHeaders(options.pluginToken || settings.pluginToken),
        credentials: "include",
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const raw = await res.text();
    let parsed = {};
    if (raw) {
        try {
            parsed = JSON.parse(raw);
        } catch (_e) {
            parsed = { raw };
        }
    }

    if (!res.ok) {
        const detail = parsed?.error || raw || `HTTP ${res.status}`;
        throw new Error(detail);
    }

    return parsed;
}

function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function handlePluginStartPairing() {
    return await dashboardFetch("/api/plugin/device/start", {
        method: "POST",
        body: {},
        pluginToken: "",
    });
}

async function handlePluginCompletePairing(payload) {
    const pairCode = String(payload?.pairCode || "").trim();
    const pairSecret = String(payload?.pairSecret || "").trim();
    if (!pairCode || !pairSecret) throw new Error("pairCode and pairSecret are required.");

    return await dashboardFetch("/api/plugin/device/complete", {
        method: "POST",
        body: { pairCode, pairSecret },
        pluginToken: "",
    });
}

async function handlePluginStartRun(payload) {
    const settings = await getSettings();
    const campaignId = String(payload?.campaignId || settings.campaignId || "").trim();
    if (!campaignId) throw new Error("campaignId is required.");

    return await dashboardFetch("/api/plugin/runs/start", {
        method: "POST",
        body: { campaignId },
    });
}

async function handlePluginUpdateRun(payload) {
    const runId = String(payload?.runId || "").trim();
    const action = String(payload?.action || "").trim();
    const reason = String(payload?.reason || "").trim();
    if (!runId || !action) throw new Error("runId and action are required.");

    return await dashboardFetch(`/api/plugin/runs/${runId}`, {
        method: "PATCH",
        body: { action, reason: reason || null },
    });
}

async function handlePluginClaimNext(payload) {
    const settings = await getSettings();
    const campaignId = String(payload?.campaignId || settings.campaignId || "").trim();
    if (!campaignId) throw new Error("campaignId is required.");

    return await dashboardFetch(`/api/plugin/campaigns/${campaignId}/claim-next`, {
        method: "POST",
        body: {
            runId: payload?.runId || null,
            leaseSeconds: payload?.leaseSeconds || 300,
        },
    });
}

async function handlePluginMarkContacted(payload) {
    const contactId = String(payload?.contactId || "").trim();
    const campaignId = String(payload?.campaignId || "").trim();
    if (!contactId || !campaignId) throw new Error("contactId and campaignId are required.");

    return await dashboardFetch(`/api/plugin/contacts/${contactId}/mark-contacted`, {
        method: "POST",
        body: {
            campaignId,
            runId: payload?.runId || null,
            idempotencyKey: payload?.idempotencyKey || uuidv4(),
            metadata: payload?.metadata || {},
        },
    });
}

async function handlePluginFailContact(payload) {
    const contactId = String(payload?.contactId || "").trim();
    const campaignId = String(payload?.campaignId || "").trim();
    const code = String(payload?.code || "ui_unknown").trim();
    const message = String(payload?.message || "").trim();
    if (!contactId || !campaignId) throw new Error("contactId and campaignId are required.");

    return await dashboardFetch(`/api/plugin/contacts/${contactId}/fail`, {
        method: "POST",
        body: {
            campaignId,
            runId: payload?.runId || null,
            idempotencyKey: payload?.idempotencyKey || uuidv4(),
            code,
            message,
            metadata: payload?.metadata || {},
        },
    });
}

async function handlePluginParseOperatorProfile(payload) {
    const html = String(payload?.html || "");
    const profileUrl = payload?.profileUrl ? String(payload.profileUrl) : null;
    if (!html) throw new Error("html is required.");

    return await dashboardFetch("/api/plugin/operator/parse-profile", {
        method: "POST",
        body: { html, profileUrl },
    });
}

async function handlePluginConfirmOperatorProfile(payload) {
    const fullName = String(payload?.fullName || "").trim();
    const headline = String(payload?.headline || "").trim();
    const linkedinUrl = String(payload?.linkedinUrl || "").trim();
    const htmlHash = String(payload?.htmlHash || "").trim();

    if (!fullName || !linkedinUrl || !htmlHash) {
        throw new Error("fullName, linkedinUrl and htmlHash are required.");
    }

    return await dashboardFetch("/api/plugin/operator/confirm", {
        method: "POST",
        body: {
            fullName,
            headline,
            linkedinUrl,
            htmlHash,
            confidence: Number(payload?.confidence || 0),
        },
    });
}
