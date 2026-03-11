// background.js


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "CALL_GROQ") {
        handleGroqRequest(request.payload)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.type === "SAVE_TO_CRM") {
        handleCrmSave(request.payload)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
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
