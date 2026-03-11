// content.js
// Runs invisibly on the LinkedIn profile page to execute DOM actions

const BOT_INIT_FLAG = '__linkedinOutreachBotInitialized';
const normalizeText = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
const hasAnyToken = (value, tokens) => {
  const normalized = normalizeText(value);
  return tokens.some((token) => normalized.includes(token));
};
const isProfilePath = () => window.location.pathname.startsWith('/in/');
const isElementVisible = (element) => {
  if (!element) return false;
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
};
const isElementInteractable = (element) => {
  if (!isElementVisible(element)) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  if (!style) return true;
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  return true;
};
const isElementDisabled = (element) => {
  if (!element) return true;
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
};
const isDialogCandidateForInvite = (dialog) => {
  if (!dialog || !isElementVisible(dialog)) return false;
  const text = normalizeText(dialog.innerText || dialog.textContent || '');
  return (
    text.includes('invito') ||
    text.includes('invitation') ||
    text.includes('collegarsi') ||
    text.includes('connect') ||
    text.includes('add a note') ||
    text.includes('aggiungi una nota') ||
    text.includes('send without') ||
    text.includes('invia senza nota')
  );
};
const ACTION_TOKENS = {
  connect: ['collegati', 'collegarsi', 'connect', 'invite to connect', 'invita a collegarsi'],
  message: ['invia messaggio', 'messaggio', 'message', 'send message'],
  addNote: ['add a note', 'add note', 'aggiungi una nota', 'includi una nota', 'include a note'],
  sendInvite: ['send invitation', 'send normal invitation', 'invia invito', 'invia invito normale', 'send', 'invia'],
  sendMessage: ['send message', 'invia messaggio', 'send', 'invia']
};

class LinkedInBotHeadless {
  constructor() {
    this.profileData = null;
    this.debugTrail = [];
    this.listenForMessages();
  }

  listenForMessages() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'GET_PROFILE') {
        const data = this.extractProfileData();
        sendResponse(data);
        return true;
      }

      if (request.type === 'START_AUTOMATION') {
        this.runAutomation(request.payload)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ error: err.message }));
        return true; // async
      }
      return false;
    });
  }

  extractProfileData() {

    const xp = (xpath) =>
      document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

    const textFromSelector = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.innerText.trim() : '';
    };

    const textFromXpath = (xpath) => {
      const el = xp(xpath);
      return el ? el.innerText.trim() : '';
    };

    const firstNonEmpty = (values) => values.find(Boolean) || '';

    const deriveNameFromUrl = (url) => {
      try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/^\/in\/([^/?#]+)/i);
        if (!match) return '';

        const normalized = decodeURIComponent(match[1])
          .replace(/[-_]+/g, ' ')
          .replace(/\d+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!normalized) return '';
        return normalized
          .split(' ')
          .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
          .join(' ');
      } catch (_error) {
        return '';
      }
    };

    const profileUrl = window.location.href.split('?')[0];
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    const titleName = document.title.split('|')[0]?.trim() || '';

    const fullName = firstNonEmpty([
      textFromSelector('main section:first-of-type h1'),
      textFromSelector('h1.text-heading-xlarge'),
      textFromSelector('h1.inline.t-24'),
      ogTitle.split('|')[0]?.trim() || '',
      titleName,
      deriveNameFromUrl(profileUrl)
    ]);

    const headline = firstNonEmpty([
      textFromSelector('main section:first-of-type div.text-body-medium.break-words'),
      textFromSelector('main section:first-of-type div.text-body-medium'),
      textFromXpath('/html/body/div[7]/div[3]/div/div/div[2]/div/div/main/section[1]/div[2]/div[2]/div[1]/div[2]')
    ]);

    const companyRaw = firstNonEmpty([
      textFromSelector('main section:first-of-type ul li button span div'),
      textFromSelector('main section:first-of-type ul li .hoverable-link-text'),
      textFromXpath('/html/body/div[7]/div[3]/div/div/div[2]/div/div/main/section[1]/div[2]/div[2]/ul/li[1]/button/span/div')
    ]);

    const location = firstNonEmpty([
      textFromSelector('main section:first-of-type span.text-body-small.inline.t-black--light.break-words'),
      textFromSelector('main section:first-of-type div.text-body-small.inline.t-black--light'),
      textFromXpath('/html/body/div[6]/div[3]/div/div/div[2]/div/div/main/section[1]/div[2]/div[2]/div[2]/span[1]')
    ]);

    const cleanCompany = (value) => {
      if (!value) return '';
      return value.split('·').pop().trim();
    };

    this.profileData = {
      name: fullName ? fullName.split(' ')[0] : '',
      fullName: fullName,
      headline: headline,
      company: cleanCompany(companyRaw),
      location: location,
      url: profileUrl
    };

    console.log("profileData", this.profileData);

    this.profileData.isItalian = this.profileData.location.toLowerCase().includes('italy') || this.profileData.location.toLowerCase().includes('italia');

    return this.profileData;
  }

  async runAutomation({ message, type, userNotes }) {
    if (!this.profileData) this.extractProfileData();
    this.debugTrail = [];
    this.debugStep('run:start', {
      lang: document.documentElement.lang || '',
      path: window.location.pathname,
      msgLength: message?.length || 0
    });

    try {
      // Priority requested:
      // 1) If "Connect/Collegati" exists, do Connect + Add note.
      // 2) Only if Connect is not present, do direct message.
      const hasConnectAction = await this.clickConnect();
      this.debugStep('run:connect-detected', { hasConnectAction });

      if (hasConnectAction) {
        await this.sleep(900);
        const sentInviteWithNote = await this.completeInviteWithNote(message);
        this.debugStep('run:invite-result', { sentInviteWithNote });
        if (!sentInviteWithNote) {
          throw this.buildDebugError(
            "Connect action found, but the 'Add note + Send invitation' flow could not be completed."
          );
        }
      } else {
        this.dismissOverlays();
        const sentDirectMessage = await this.sendDirectMessage(message);
        this.debugStep('run:dm-result', { sentDirectMessage });
        if (!sentDirectMessage) {
          throw this.buildDebugError(
            "Connect action not found, and direct message flow could not be completed."
          );
        }
      }

      await this.sendToCRM(message, type, userNotes);
      this.debugStep('run:crm-saved');
      return true;
    } catch (error) {
      const messageWithDebug = error instanceof Error ? error.message : String(error);
      this.debugStep('run:error', { message: messageWithDebug });
      if (messageWithDebug.includes('| debug=')) {
        throw new Error(messageWithDebug);
      }
      throw this.buildDebugError(messageWithDebug);
    }
  }

  async completeInviteWithNote(message) {
    const addNoteBtnOpened = await this.clickAddNote();
    this.debugStep('invite:add-note-clicked', { addNoteBtnOpened });
    if (!addNoteBtnOpened) return false;

    await this.sleep(1000);

    const textareaFilled = await this.fillTextarea(message);
    this.debugStep('invite:textarea-filled', { textareaFilled });
    if (!textareaFilled) return false;

    await this.sleep(1000);

    const sent = await this.clickSend();
    this.debugStep('invite:send-clicked', { sent });
    return sent;
  }

  async sendDirectMessage(message) {
    const opened = await this.clickMessageButton();
    this.debugStep('dm:message-opened', { opened });
    if (!opened) return false;

    await this.sleep(1200);

    let filled = await this.fillDirectMessageTextarea(message);
    if (!filled) {
      await this.sleep(1000);
      filled = await this.fillDirectMessageTextarea(message);
    }
    this.debugStep('dm:textarea-filled', { filled });
    if (!filled) return false;

    await this.sleep(1000);

    let sent = await this.clickDirectSend();
    if (!sent) {
      await this.sleep(800);
      sent = await this.clickDirectSend();
    }
    this.debugStep('dm:send-clicked', { sent });
    return sent;
  }

  async clickConnect() {
    for (const root of this.getProfileActionRoots()) {
      const directConnect = this.findActionElement(
        ACTION_TOKENS.connect,
        root,
        { allowAnchors: true, preferTopArea: true }
      );
      if (directConnect) {
        this.debugStep('connect:direct-found', this.describeElement(directConnect));
        this.safeClick(directConnect);
        await this.sleep(350);
        this.debugStep('connect:surface-after-click', this.getInviteSurfaceState());
        return true;
      }
    }

    const fromOverflow = await this.clickActionFromOverflow(ACTION_TOKENS.connect);
    if (fromOverflow) {
      await this.sleep(350);
      this.debugStep('connect:surface-after-overflow', this.getInviteSurfaceState());
    }
    return fromOverflow;
  }

  async clickMessageButton() {
    for (const root of this.getProfileActionRoots()) {
      const directMessage = this.findActionElement(
        ACTION_TOKENS.message,
        root,
        { allowAnchors: true, preferTopArea: true }
      );
      if (directMessage) {
        this.debugStep('message:direct-found', this.describeElement(directMessage));
        this.safeClick(directMessage);
        return true;
      }
    }

    return this.clickActionFromOverflow(ACTION_TOKENS.message);
  }

  getProfileActionRoots() {
    const topSection = document.querySelector('main section:first-of-type');
    const ctaContainer =
      topSection?.querySelector('.pv-top-card-v2-ctas') ||
      topSection?.querySelector('.pvs-profile-actions') ||
      topSection?.querySelector('[data-view-name*="profile-action"]');

    const roots = [
      ctaContainer,
      document.querySelector('.pv-top-card-v2-ctas'),
      topSection?.querySelector('.pv-top-card'),
      topSection
    ].filter(Boolean);
    return roots;
  }

  getSearchRoots(root = document) {
    const roots = [];
    const queue = [root];
    const seen = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      roots.push(current);

      let descendants = [];
      if (current === document) {
        descendants = Array.from(document.querySelectorAll('*'));
      } else if (typeof current.querySelectorAll === 'function') {
        descendants = Array.from(current.querySelectorAll('*'));
      }

      for (const element of descendants) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          queue.push(element.shadowRoot);
        }
      }
    }

    return roots;
  }

  queryAllDeep(root, selector) {
    const results = [];
    const seen = new Set();
    for (const searchRoot of this.getSearchRoots(root)) {
      if (!searchRoot || typeof searchRoot.querySelectorAll !== 'function') continue;
      const nodes = searchRoot.querySelectorAll(selector);
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        results.push(node);
      }
    }
    return results;
  }

  findActionElement(tokens, root, options = {}) {
    const { allowAnchors = false, preferTopArea = false } = options;
    const selector = allowAnchors
      ? 'button, a, [role="button"], [role="menuitem"]'
      : 'button, [role="button"], [role="menuitem"]';
    const candidates = this.queryAllDeep(root, selector);

    const matched = candidates.filter((element) => {
      if (!isElementInteractable(element)) return false;
      if (element.closest('#global-nav, header.global-nav')) return false;
      if (element.tagName.toLowerCase() === 'a' && !allowAnchors) return false;

      if (preferTopArea) {
        const rect = element.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight * 0.82) return false;
      }

      const label = element.getAttribute('aria-label') || '';
      const text = element.innerText || element.textContent || '';
      const dataControlName = element.getAttribute('data-control-name');
      const dataTest = element.getAttribute('data-test-id');

      return (
        hasAnyToken(label, tokens) ||
        hasAnyToken(text, tokens) ||
        hasAnyToken(dataControlName, tokens) ||
        hasAnyToken(dataTest, tokens)
      );
    });

    const nonAnchor = matched.find((element) => element.tagName.toLowerCase() !== 'a');
    return nonAnchor || matched[0] || null;
  }

  async clickActionFromOverflow(actionTokens) {
    const moreTokens = ['more actions', 'altre azioni', 'altro', 'more', 'overflow'];
    const initialHref = window.location.href;

    try {
      for (const root of this.getProfileActionRoots()) {
        const moreBtn =
          root.querySelector('button[aria-label*="More actions"], button[aria-label*="Altre azioni"]') ||
          root.querySelector('button[data-control-name*="overflow"]') ||
          this.findActionElement(moreTokens, root);

        if (!moreBtn) continue;

        this.debugStep('overflow:more-found', this.describeElement(moreBtn));
        this.safeClick(moreBtn);
        await this.sleep(700);

        const dropdownRoots = Array.from(
          document.querySelectorAll('.artdeco-dropdown__content, [role="menu"], .artdeco-modal, .artdeco-popover__content')
        );

        for (const dropdownRoot of dropdownRoots) {
          const actionElement = this.findActionElement(actionTokens, dropdownRoot, { allowAnchors: true });
          if (actionElement) {
            this.debugStep('overflow:action-found', this.describeElement(actionElement));
            this.safeClick(actionElement);
            await this.sleep(250);
            if (!isProfilePath()) {
              window.history.back();
              await this.sleep(400);
              if (window.location.href !== initialHref) {
                this.dismissOverlays();
                return false;
              }
            }
            return true;
          }
        }

        this.dismissOverlays();
      }
    } catch (error) {
      console.warn('Error while using overflow action menu:', error.message);
    }

    return false;
  }

  findInviteComposerInput(root = document) {
    const selectors = [
      'textarea[name="message"]',
      'textarea#custom-message',
      'textarea[id*="message"]',
      'textarea[aria-label*="invitation"]',
      'textarea[aria-label*="invito"]',
      'textarea[aria-label*="note"]',
      'textarea[aria-label*="nota"]',
      'div[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '.ql-editor[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const input = this.queryAllDeep(root, selector).find((node) => isElementVisible(node));
      if (input) return input;
    }

    return null;
  }

  isInviteComposerOpen(root = document) {
    return Boolean(this.findInviteComposerInput(root));
  }

  async waitForInviteComposer(root = document, attempts = 10, intervalMs = 250) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const input = this.findInviteComposerInput(root) || this.findInviteComposerInput(document);
      if (input) return input;
      await this.sleep(intervalMs);
    }
    return null;
  }

  fillInputElement(element, text) {
    if (!element) return false;

    element.focus();

    if ('value' in element) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
      element.textContent = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      if (document.execCommand) {
        document.execCommand('insertText', false, text);
      } else {
        element.textContent = text;
      }

      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text
        })
      );
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    return false;
  }

  async clickAddNote() {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const inviteDialog = this.getInviteDialogRoot();
      const searchRoot = inviteDialog || document;
      const surface = this.getInviteSurfaceState();
      const composerOpen = this.isInviteComposerOpen(searchRoot) || this.isInviteComposerOpen(document);
      this.debugStep('invite:add-note-attempt', {
        attempt,
        hasDialog: Boolean(inviteDialog),
        surface,
        composerOpen
      });

      if (composerOpen) {
        this.debugStep('invite:composer-detected', {
          attempt,
          input: this.describeElement(this.findInviteComposerInput(searchRoot) || this.findInviteComposerInput(document))
        });
        return true;
      }

      const addNote =
        this.findActionElement(ACTION_TOKENS.addNote, searchRoot, { allowAnchors: true }) ||
        this.findActionElement(ACTION_TOKENS.addNote, document, { allowAnchors: true });
      if (addNote) {
        this.debugStep('invite:add-note-found', this.describeElement(addNote));
        this.safeClick(addNote);
        await this.sleep(280);

        const composerInput = await this.waitForInviteComposer(document, 6, 250);
        if (composerInput) {
          this.debugStep('invite:composer-after-add-note', {
            attempt,
            input: this.describeElement(composerInput)
          });
          return true;
        }
      }
      await this.sleep(300);
    }
    return false;
  }

  async fillDirectMessageTextarea(msg) {
    const textarea = await this.findElementWithRetries(
      ['textarea[name="message"]', 'textarea[aria-label*="message"]', 'textarea[aria-label*="messaggio"]'],
      8,
      250
    );
    if (textarea) {
      textarea.value = msg;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const editor = await this.findElementWithRetries(
      [
        '.msg-form__contenteditable[contenteditable="true"]',
        '.msg-form__contenteditable',
        '.msg-form__msg-content-container div[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]'
      ],
      8,
      250
    );

    if (!editor) return false;

    editor.focus();
    editor.textContent = '';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // contenteditable editors on LinkedIn react better to insertText + input events.
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    if (document.execCommand) {
      document.execCommand('insertText', false, msg);
    } else {
      editor.textContent = msg;
    }

    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: msg
      })
    );
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async fillTextarea(msg) {
    const inviteDialog = this.getInviteDialogRoot();
    const searchRoot = inviteDialog || document;
    this.debugStep('invite:fill-textarea-root', { hasDialog: Boolean(inviteDialog) });
    const textarea =
      await this.waitForInviteComposer(searchRoot, 10, 250) ||
      await this.waitForInviteComposer(document, 10, 250);
    if (textarea) {
      this.debugStep('invite:textarea-found', this.describeElement(textarea));
      const filled = this.fillInputElement(textarea, msg);
      this.debugStep('invite:textarea-fill-result', { filled });
      if (!filled) return false;
      return true;
    }
    return false;
  }

  async clickDirectSend() {
    const primarySend = await this.findElementWithRetries(
      [
        'button.msg-form__send-button',
        '.msg-form button[type="submit"]',
        'button[aria-label*="Send message"]',
        'button[aria-label*="Invia messaggio"]'
      ],
      6,
      250
    );
    if (primarySend) {
      for (let i = 0; i < 5 && isElementDisabled(primarySend); i++) await this.sleep(400);
      if (isElementDisabled(primarySend)) return false;
      this.safeClick(primarySend);
      return true;
    }

    const messageRoot =
      document.querySelector('.msg-overlay-conversation-bubble, .msg-form, .msg-overlay-bubble-header, [role="dialog"]') ||
      document;
    const sendBtn = this.findActionElement(ACTION_TOKENS.sendMessage, messageRoot);

    if (!sendBtn) return false;
    for (let i = 0; i < 5 && isElementDisabled(sendBtn); i++) await this.sleep(400);
    if (isElementDisabled(sendBtn)) return false;
    this.safeClick(sendBtn);
    return true;
  }

  async clickSend() {
    const inviteDialog =
      this.getInviteDialogRoot() || document;
    const sendBtn = this.findActionElement(ACTION_TOKENS.sendInvite, inviteDialog);
    if (sendBtn) {
      this.debugStep('invite:send-found', this.describeElement(sendBtn));
      for (let i = 0; i < 5 && isElementDisabled(sendBtn); i++) await this.sleep(400);
      if (isElementDisabled(sendBtn)) return false;
      this.safeClick(sendBtn);
      return true;
    }
    return false;
  }

  async findElementWithRetries(selectors, attempts = 6, intervalMs = 300) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      for (const selector of selectors) {
        const element = this.queryAllDeep(document, selector).find((node) => isElementVisible(node));
        if (element) return element;
      }
      await this.sleep(intervalMs);
    }
    return null;
  }

  async findElementWithRetriesInRoot(root, selectors, attempts = 6, intervalMs = 300) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      for (const selector of selectors) {
        const element = this.queryAllDeep(root, selector).find((node) => isElementVisible(node));
        if (element) return element;
      }
      await this.sleep(intervalMs);
    }
    return null;
  }

  getInviteDialogRoot() {
    const dialogs = this.queryAllDeep(
      document,
      '[role="dialog"], .artdeco-modal, .artdeco-modal__content, .artdeco-modal__overlay, [data-test-modal], [data-test-id*="modal"], [class*="artdeco-modal"]'
    );

    const inviteDialog = dialogs.find((dialog) => isDialogCandidateForInvite(dialog));
    if (inviteDialog) return inviteDialog;

    const addNoteButton = this.findActionElement(ACTION_TOKENS.addNote, document, { allowAnchors: true });
    if (addNoteButton) {
      const aroundAddNote = addNoteButton.closest(
        '[role="dialog"], .artdeco-modal, .artdeco-modal__content, .artdeco-modal__overlay, [data-test-modal], [data-test-id*="modal"]'
      );
      if (aroundAddNote && isElementVisible(aroundAddNote)) return aroundAddNote;
    }

    return dialogs.find((dialog) => isElementVisible(dialog)) || null;
  }

  safeClick(element) {
    if (!element) return;
    try {
      element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      if (typeof element.click === 'function') {
        element.click();
      }
    } catch (_error) {
      if (typeof element.click === 'function') {
        element.click();
      }
    }
  }

  describeElement(element) {
    if (!element) return {};
    return {
      tag: element.tagName?.toLowerCase() || '',
      text: normalizeText(element.innerText || element.textContent || '').slice(0, 80),
      aria: (element.getAttribute('aria-label') || '').slice(0, 120),
      dataControl: (element.getAttribute('data-control-name') || '').slice(0, 80),
      dataTest: (element.getAttribute('data-test-id') || '').slice(0, 80),
      href: (element.getAttribute('href') || '').slice(0, 120)
    };
  }

  getInviteSurfaceState() {
    const inviteDialog = this.getInviteDialogRoot();
    const addNoteElement = this.findActionElement(ACTION_TOKENS.addNote, document, { allowAnchors: true });
    const sendWithoutElement = this.findActionElement(
      ['send without note', 'invia senza nota', 'send without'],
      document,
      { allowAnchors: true }
    );

    return {
      hasDialog: Boolean(inviteDialog || addNoteElement || sendWithoutElement),
      hasAddNote: Boolean(addNoteElement),
      hasSendWithoutNote: Boolean(sendWithoutElement),
      hasComposer: this.isInviteComposerOpen(inviteDialog || document),
      dialogTextHint: inviteDialog
        ? normalizeText(inviteDialog.innerText || inviteDialog.textContent || '').slice(0, 120)
        : ''
    };
  }

  debugStep(step, details = {}) {
    const entry = {
      step,
      details,
      ts: new Date().toISOString()
    };
    this.debugTrail.push(entry);
    if (this.debugTrail.length > 40) {
      this.debugTrail.shift();
    }
    console.info('[LinkedInBot]', step, details);
  }

  buildDebugError(message) {
    const compact = this.debugTrail
      .slice(-12)
      .map((entry) => `${entry.step}:${JSON.stringify(entry.details)}`)
      .join(' > ');
    return new Error(`${message} | debug=${compact}`);
  }

  dismissOverlays() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27
      })
    );
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  sendToCRM(message, type, userNotes) {
    return new Promise((resolve, reject) => {
      let combinedNotes = "Messaggio (" + type + "):\n" + message;
      if (userNotes) {
        combinedNotes += "\n\nNote esterne:\n" + userNotes;
      }

      const payload = {
        source: 'extension',
        name: this.profileData.fullName,
        company: this.profileData.company,
        role: this.profileData.headline,
        url: this.profileData.url,
        dateSent: new Date().toLocaleDateString('it-IT') + " " + new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        notes: combinedNotes
      };

      console.log(payload);

      chrome.runtime.sendMessage({
        type: "SAVE_TO_CRM",
        payload: payload
      }, (response) => {
        if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });
    });
  }
}

if (!window[BOT_INIT_FLAG]) {
  window[BOT_INIT_FLAG] = true;
  new LinkedInBotHeadless();
}
