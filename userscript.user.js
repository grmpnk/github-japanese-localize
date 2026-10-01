// ==UserScript==
// @name         GitHub 日本語化プラグイン
// @namespace    https://github.com/grmpnk
// @version      1.2
// @description  誤訳を見つけたら教えてください。まだ作業中のため、未翻訳の報告は受け付けていません。
// @author       grmpneko
// @match        https://github.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==
(async () => {
    'use strict';
    const TRANSLATION_URL = 'https://raw.githubusercontent.com/grmpnk/github-japanese-localize/refs/heads/main/translationmap.json'

    const fetchText = url => new Promise((resolve, reject) => {
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'text',
                onload: res => {
                    if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                    else reject(new Error('HTTP error: ' + res.status));
                },
                onerror: err => reject(err),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        } catch (e) {
            reject(e);
        }
    });

    let raw;
    try {
        raw = await fetchText(TRANSLATION_URL);
    } catch (e) {
        console.error('translationmap fetch failed:', e);
        return;
    }

    if (!raw) return;

    let maps = [];
    try {
        const cfg = JSON.parse(raw || '{}');
        const globalDefault = cfg.defaultSelector && cfg.defaultSelector.trim() ? cfg.defaultSelector.trim() : undefined;
        (cfg.map || []).forEach(entry => {
            const sel = entry.selector && entry.selector.trim() ? entry.selector.trim() : globalDefault;
            maps.push({ selector: sel, text: entry.text || {} });
        });
        (cfg.mapBySelector || []).forEach(block => {
            const sel = block.selector && block.selector.trim() ? block.selector.trim() : globalDefault;
            if (Array.isArray(block.texts)) {
                block.texts.forEach(t => maps.push({ selector: sel, text: t || {} }));
            } else {
                maps.push({ selector: sel, text: block.texts || {} });
            }
        });
        maps = maps.map((m, i) => ({ selector: m.selector === undefined ? null : m.selector, text: m.text, id: i }));
    } catch (e) {
        maps = [];
    }

    const appliedMaps = new WeakMap(); // 重複処理を避け、負荷を下げる

    const replaceTextNode = (node, from, to) => {
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        const v = node.nodeValue;
        if (v === from) node.nodeValue = to;
        else if (v.includes(from)) node.nodeValue = v.split(from).join(to);
    };

    const hasApplied = (el, id) => {
        const s = appliedMaps.get(el);
        return s && s.has(id);
    };

    const markApplied = (el, id) => {
        let s = appliedMaps.get(el);
        if (!s) {
            s = new Set();
            appliedMaps.set(el, s);
        }
        s.add(id);
    };

    const translateElement = (el, textMap, mapId, force) => {
        if (!el || !textMap) return;
        if (!force && hasApplied(el, mapId)) return;

        if (el.hasAttribute && el.hasAttribute('data-content')) {
            const dc = el.getAttribute('data-content');
            if (dc && textMap[dc]) {
                el.setAttribute('data-content', textMap[dc]);
                if (el.textContent && el.textContent.trim() === dc) el.textContent = textMap[dc];
                else for (const n of Array.from(el.childNodes)) replaceTextNode(n, dc, textMap[dc]);
            }
        }

        for (const [from, to] of Object.entries(textMap)) {
            if (!from) continue;
            for (const n of Array.from(el.childNodes)) replaceTextNode(n, from, to);
            if (el.textContent && el.textContent.trim() === from) el.textContent = to;
            if (el.getAttribute && el.getAttribute('aria-label') === from) el.setAttribute('aria-label', to);
            if (el.title === from) el.title = to;
        }
        markApplied(el, mapId);
    };

    const walkAndTranslate = root => {
        if (!root) return;
        for (const { selector, text, id } of maps) {
            try {
                let nodes = [];
                if (selector === null) {
                    nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
                } else {
                    nodes = root.querySelectorAll ? root.querySelectorAll(selector) : [];
                }
                nodes.forEach(n => translateElement(n, text, id, false));
                if (selector !== null && root.matches && root.matches(selector)) translateElement(root, text, id, false);
                if (selector === null && root.nodeType === Node.ELEMENT_NODE) translateElement(root, text, id, false);
            } catch (e) {}
        }

        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = w.nextNode())) if (n.shadowRoot) walkAndTranslate(n.shadowRoot);
    };

    const findTextMap = el => {
        for (const { selector, text, id } of maps) {
            try {
                if (selector === null) return { text, id };
                if (el.matches && el.matches(selector)) return { text, id };
            } catch {}
        }
        return null;
    };

    const init = () => walkAndTranslate(document);
    init();

    const obs = new MutationObserver(ms => {
        for (const m of ms) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        walkAndTranslate(node);
                        if (node.shadowRoot) walkAndTranslate(node.shadowRoot);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        const p = node.parentElement;
                        if (p) {
                            const found = findTextMap(p);
                            if (found) translateElement(p, found.text, found.id, false);
                        }
                    }
                });
            } else if (m.type === 'attributes') {
                const target = m.target;
                if (target && target.nodeType === Node.ELEMENT_NODE) {
                    const attr = m.attributeName;
                    if (attr === 'data-content') {
                        const found = findTextMap(target);
                        if (found) translateElement(target, found.text, found.id, true);
                    } else {
                        const found = findTextMap(target);
                        if (found) translateElement(target, found.text, found.id, false);
                        walkAndTranslate(target);
                        if (target.shadowRoot) walkAndTranslate(target.shadowRoot);
                    }
                }
            }
        }
    });

    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-content','class'], attributeOldValue: true });

    const _push = history.pushState;
    history.pushState = function () {
        _push.apply(this, arguments);
        init();
    };

    const _replace = history.replaceState;
    history.replaceState = function () {
        _replace.apply(this, arguments);
        init();
    };

    window.addEventListener('popstate', () => init());
})();
