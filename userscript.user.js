// ==UserScript==
// @name         GitHub 日本語化プラグイン
// @namespace    https://github.com/grmpnk
// @version      1.0
// @description  誤訳を見つけたら教えてください。まだ作業中のため、未翻訳の報告は受け付けていません。
// @author       grmpneko
// @match        https://github.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @resource     translationmap https://raw.githubusercontent.com/grmpnk/github-japanese-localize/refs/heads/main/translationmap.json
// @grant        GM_getResourceText
// ==/UserScript==
(() => {
    'use strict';
    const raw = GM_getResourceText('translationmap');
    if (!raw) {
        console.error('translationmap resource is missing or empty')
        return;
    }
    let maps = [];
    try {
        const cfg = JSON.parse(raw || '{}');
        // JSON 側で既定セレクタを指定する。無ければ undefined のままにする
        const globalDefault = cfg.defaultSelector && cfg.defaultSelector.trim() ? cfg.defaultSelector.trim() : undefined;
        // 既存の互換 map を処理する
        (cfg.map || []).forEach(entry => {
            const sel = entry.selector && entry.selector.trim() ? entry.selector.trim() : globalDefault;
            maps.push({ selector: sel, text: entry.text || {} });
        });
        // mapBySelector を処理して texts を展開
        (cfg.mapBySelector || []).forEach(block => {
            const sel = block.selector && block.selector.trim() ? block.selector.trim() : globalDefault;
            const texts = block.texts || block.texts === undefined ? block.texts : {};
            // texts が配列形式の場合にも対応する
            if (Array.isArray(block.texts)) {
                block.texts.forEach(t => maps.push({ selector: sel, text: t || {} }));
            } else {
                maps.push({ selector: sel, text: texts || {} });
            }
        });
        // 最後に、selector が undefined のエントリは document 全体に適用するため selector を null にしておく
        maps = maps.map(m => ({ selector: m.selector === undefined ? null : m.selector, text: m.text }));
    } catch (e) {
        maps = [];
    }

    const replaceTextNode = (node, from, to) => {
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        const v = node.nodeValue;
        if (v === from) node.nodeValue = to;
        else if (v.includes(from)) node.nodeValue = v.split(from).join(to);
    };

    const translateElement = (el, textMap) => {
        if (!el || !textMap) return;
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
    };

    const walkAndTranslate = root => {
        if (!root) return;
        for (const { selector, text } of maps) {
            try {
                const nodes = root.querySelectorAll ? root.querySelectorAll(selector) : [];
                nodes.forEach(n => translateElement(n, text));
            } catch {}
        }
        const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = w.nextNode())) if (n.shadowRoot) walkAndTranslate(n.shadowRoot);
    };

    const findTextMap = el => {
        for (const { selector, text } of maps) {
            try {
                if (el.matches && el.matches(selector)) return text;
            } catch {}
        }
        return null;
    };

    const init = () => walkAndTranslate(document);
    setTimeout(init, 100);

    let scheduled = 0;
    const obs = new MutationObserver(ms => {
        if (scheduled) return;
        scheduled = requestAnimationFrame(() => {
            scheduled = 0;
            for (const m of ms) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            walkAndTranslate(node);
                            if (node.shadowRoot) walkAndTranslate(node.shadowRoot);
                        }
                    });
                } else if (m.type === 'attributes' && m.attributeName === 'data-content') {
                    translateElement(m.target, findTextMap(m.target));
                }
            }
        });
    });

    obs.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, });

    const _push = history.pushState;
    history.pushState = function () { _push.apply(this, arguments); setTimeout(init, 200); };
    const _replace = history.replaceState;
    history.replaceState = function () { _replace.apply(this, arguments); setTimeout(init, 200); };
    window.addEventListener('popstate', () => setTimeout(init, 200));
})();
