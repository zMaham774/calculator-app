(function () {
    'use strict';

    /* ---------------------------------------------------------------------
       State
       --------------------------------------------------------------------- */
    const state = {
        expression: '',      // raw expression string built from key presses, e.g. "12+3×"
        displayExpr: '',     // human-friendly version shown above the result
        currentValue: '0',   // what shows in the big result line
        justEvaluated: false,// true right after "=" — next digit starts fresh
        hasError: false,
        angleMode: 'deg',    // 'deg' | 'rad'
        inverseMode: false,
        history: []          // { expr, result }
    };

    const MAX_DIGITS = 15;

    /* ---------------------------------------------------------------------
       DOM refs
       --------------------------------------------------------------------- */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    const el = {
        calcUnit: $('#calcUnit'),
        expressionRow: $('#expressionRow'),
        resultDisplay: $('#resultDisplay'),
        errorTag: $('#errorTag'),
        angleTag: $('#angleTag'),
        copyBtn: $('#copyBtn'),
        historyToggle: $('#historyToggle'),
        historyTape: $('#historyTape'),
        historyList: $('#historyList'),
        modeToggle: $('#modeToggle'),
        sciPanel: $('#sciPanel'),
        invBtn: $('#invBtn'),
        angleBtn: $('#angleBtn'),
        keys: $$('.key')
    };

    /* ---------------------------------------------------------------------
       Icons
       --------------------------------------------------------------------- */
    if (window.lucide) lucide.createIcons();

    /* ---------------------------------------------------------------------
       Entrance animation (GSAP)
       --------------------------------------------------------------------- */
    window.addEventListener('DOMContentLoaded', () => {
        if (window.gsap) {
            gsap.timeline()
                .to(el.calcUnit, {
                    opacity: 1,
                    y: 0,
                    duration: 0.7,
                    ease: 'power3.out'
                }, 0)
                .from('.calc-topbar', { opacity: 0, y: -8, duration: 0.5, ease: 'power2.out' }, 0.1)
                .from('.display-unit', { opacity: 0, scale: 0.97, duration: 0.5, ease: 'power2.out' }, 0.18)
                .from('.key', {
                    opacity: 0,
                    y: 14,
                    scale: 0.9,
                    duration: 0.4,
                    stagger: { amount: 0.35, from: 'start' },
                    ease: 'back.out(1.6)'
                }, 0.28)
                .from('.keyboard-hint', { opacity: 0, duration: 0.5 }, 0.9);
        } else {
            el.calcUnit.style.opacity = 1;
        }
    });

    // set initial transform for GSAP entrance (avoid flash of full-size)
    gsapSafeSet(el.calcUnit, { y: 22 });
    function gsapSafeSet(target, vars) {
        if (window.gsap) gsap.set(target, vars);
    }

    /* ---------------------------------------------------------------------
       Rendering
       --------------------------------------------------------------------- */
    function render() {
        el.expressionRow.textContent = state.displayExpr || '\u00A0';
        el.resultDisplay.textContent = state.currentValue;
        el.resultDisplay.classList.toggle('is-error', state.hasError);
        el.errorTag.hidden = !state.hasError;
        el.angleTag.textContent = state.angleMode === 'deg' ? 'DEG' : 'RAD';
        el.angleBtn.textContent = state.angleMode;
        el.invBtn.setAttribute('aria-pressed', String(state.inverseMode));
    }

    function animateResultChange() {
        if (!window.motion) return;
        const { animate } = window.motion;
        animate(el.resultDisplay, { opacity: [0.3, 1], y: [4, 0] }, { duration: 0.22, easing: [0.2, 0.8, 0.2, 1] });
    }

    function shakeError() {
        el.resultDisplay.closest('.display-unit').classList.remove('shake');
        // reflow to restart animation
        void el.resultDisplay.offsetWidth;
        el.resultDisplay.closest('.display-unit').classList.add('shake');
        if (navigator.vibrate) navigator.vibrate(40);
    }

    function successPulse() {
        if (!window.motion) return;
        const { animate } = window.motion;
        animate(el.resultDisplay, { scale: [1, 1.06, 1] }, { duration: 0.32, easing: [0.2, 0.8, 0.2, 1] });
    }

    /* ---------------------------------------------------------------------
       Expression helpers
       --------------------------------------------------------------------- */
    const OPERATORS = ['+', '−', '×', '÷'];

    function isOperator(ch) {
        return OPERATORS.includes(ch);
    }

    function lastChar() {
        return state.expression.slice(-1);
    }

    function toMathJsExpr(expr) {
        // convert our display symbols to math.js-compatible syntax
        let e = expr
            .replace(/×/g, '*')
            .replace(/÷/g, '/')
            .replace(/−/g, '-')
            .replace(/π/g, 'pi')
            .replace(/√\(/g, 'sqrt(')
            .replace(/∛\(/g, 'cbrt(')
            .replace(/%/g, '/100');
        return e;
    }

    function formatNumber(num) {
        if (num === null || num === undefined || Number.isNaN(num)) return 'Error';
        if (!Number.isFinite(num)) return num > 0 ? 'Overflow' : '-Overflow';

        // Round tiny floating point noise
        const rounded = math.round(num, 10);

        let str;
        if (Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-9 && rounded !== 0)) {
            str = rounded.toExponential(6).replace(/e\+?/, 'e');
        } else {
            str = math.format(rounded, { notation: 'auto', precision: 12 });
            // trim excessive decimals
            if (str.includes('.')) {
                str = str.replace(/0+$/, '').replace(/\.$/, '');
            }
        }
        if (str.replace(/[^0-9]/g, '').length > MAX_DIGITS) {
            str = rounded.toExponential(6).replace(/e\+?/, 'e');
        }
        return str;
    }

    /* ---------------------------------------------------------------------
       Core input handlers
       --------------------------------------------------------------------- */
    function resetIfNeeded() {
        if (state.justEvaluated) {
            state.expression = '';
            state.displayExpr = '';
            state.justEvaluated = false;
            state.hasError = false;
        }
    }

    function inputDigit(d) {
        clearErrorState();
        resetIfNeeded();
        state.expression += d;
        state.displayExpr += d;
        state.currentValue = liveEvaluate() ?? state.currentValue;
        render();
        animateResultChange();
    }

    function inputDecimal() {
        clearErrorState();
        resetIfNeeded();
        // find the current number segment (after last operator/paren)
        const segment = state.expression.split(/[+\−×÷(]/).pop();
        if (segment.includes('.')) return; // already has a decimal
        if (segment === '') {
            state.expression += '0.';
            state.displayExpr += '0.';
        } else {
            state.expression += '.';
            state.displayExpr += '.';
        }
        render();
    }

    function inputOperator(op) {
        clearErrorState();
        if (state.expression === '' && op !== '−') return; // can't start with + × ÷
        resetIfNeeded();

        if (state.expression === '' && op === '−') {
            state.expression += '−';
            state.displayExpr += '−';
            render();
            return;
        }

        if (isOperator(lastChar())) {
            // replace consecutive operator instead of stacking
            state.expression = state.expression.slice(0, -1) + op;
            state.displayExpr = state.displayExpr.slice(0, -1) + op;
        } else if (lastChar() === '.') {
            return; // dangling decimal, ignore operator
        } else {
            state.expression += op;
            state.displayExpr += op;
        }
        render();
    }

    function inputParen(type) {
        clearErrorState();
        resetIfNeeded();
        const open = (state.expression.match(/\(/g) || []).length;
        const close = (state.expression.match(/\)/g) || []).length;

        if (type === 'open') {
            // implicit multiplication: 2( -> 2*(
            if (/[0-9)]$/.test(state.expression)) {
                state.expression += '×(';
                state.displayExpr += '×(';
            } else {
                state.expression += '(';
                state.displayExpr += '(';
            }
        } else {
            if (open > close && /[0-9)]$/.test(state.expression)) {
                state.expression += ')';
                state.displayExpr += ')';
            } else {
                return; // no matching open paren to close
            }
        }
        render();
    }

    function inputFunction(fnName) {
        clearErrorState();
        resetIfNeeded();

        const funcMap = {
            sin: state.inverseMode ? 'asin' : 'sin',
            cos: state.inverseMode ? 'acos' : 'cos',
            tan: state.inverseMode ? 'atan' : 'tan',
            log: 'log10',
            ln: 'log',
            sqrt: '√',
            cbrt: '∛',
            exp: 'exp',
            abs: 'abs'
        };

        if (fnName === 'square') {
            wrapCurrentNumber((seg) => `(${seg})^2`, `(${lastSegmentDisplay()})²`);
            return;
        }
        if (fnName === 'cube') {
            wrapCurrentNumber((seg) => `(${seg})^3`, `(${lastSegmentDisplay()})³`);
            return;
        }
        if (fnName === 'reciprocal') {
            wrapCurrentNumber((seg) => `(1/(${seg}))`, `1/(${lastSegmentDisplay()})`);
            return;
        }
        if (fnName === 'factorial') {
            wrapCurrentNumber((seg) => `factorial(${seg})`, `(${lastSegmentDisplay()})!`);
            return;
        }

        const label = funcMap[fnName] || fnName;
        const displayLabel = fnName === 'sqrt' ? '√' : fnName === 'cbrt' ? '∛' :
            (state.inverseMode && ['sin', 'cos', 'tan'].includes(fnName)) ? `a${fnName}` : fnName;

        state.expression += `${label}(`;
        state.displayExpr += `${displayLabel}(`;
        render();
    }

    function lastSegmentDisplay() {
        const m = state.displayExpr.match(/[0-9.]+$/);
        return m ? m[0] : state.currentValue;
    }

    function wrapCurrentNumber(exprWrap, displayStr) {
        const m = state.expression.match(/([0-9.]+)$/);
        if (m) {
            const seg = m[1];
            state.expression = state.expression.slice(0, -seg.length) + exprWrap(seg);
        } else if (state.currentValue && state.currentValue !== '0') {
            state.expression += exprWrap(state.currentValue);
        } else {
            return;
        }
        state.displayExpr = state.displayExpr.replace(/[0-9.]+$/, '') + displayStr;
        state.currentValue = liveEvaluate() ?? state.currentValue;
        render();
        animateResultChange();
    }

    function inputConstant(name) {
        clearErrorState();
        resetIfNeeded();
        if (name === 'pi') {
            state.expression += 'pi';
            state.displayExpr += 'π';
        }
        state.currentValue = liveEvaluate() ?? state.currentValue;
        render();
    }

    function inputPercent() {
        clearErrorState();
        const m = state.expression.match(/([0-9.]+)$/);
        if (!m) return;
        const seg = m[1];
        state.expression = state.expression.slice(0, -seg.length) + `(${seg}/100)`;
        state.displayExpr = state.displayExpr.slice(0, -seg.length) + `${seg}%`;
        state.currentValue = liveEvaluate() ?? state.currentValue;
        render();
        animateResultChange();
    }

    function inputPow() {
        clearErrorState();
        if (state.expression === '' || isOperator(lastChar())) return;
        state.expression += '^';
        state.displayExpr += '^';
        render();
    }

    function inputMod() {
        clearErrorState();
        if (state.expression === '' || isOperator(lastChar())) return;
        state.expression += ' mod ';
        state.displayExpr += ' mod ';
        render();
    }

    function toggleSign() {
        clearErrorState();
        const m = state.expression.match(/(-?[0-9.]+)$/);
        if (!m) {
            if (state.currentValue && state.currentValue !== '0' && !state.hasError) {
                const negated = state.currentValue.startsWith('-') ? state.currentValue.slice(1) : '-' + state.currentValue;
                state.expression = negated;
                state.displayExpr = negated.replace('-', '−');
                state.currentValue = negated;
                render();
            }
            return;
        }
        const seg = m[1];
        const negated = seg.startsWith('-') ? seg.slice(1) : '-' + seg;
        state.expression = state.expression.slice(0, -seg.length) + negated;
        state.displayExpr = state.displayExpr.slice(0, -seg.length) + negated.replace('-', '−');
        state.currentValue = liveEvaluate() ?? state.currentValue;
        render();
    }

    function clearErrorState() {
        if (state.hasError) {
            state.hasError = false;
            el.errorTag.hidden = true;
        }
    }

    function clearAll() {
        state.expression = '';
        state.displayExpr = '';
        state.currentValue = '0';
        state.hasError = false;
        state.justEvaluated = false;
        render();
        if (window.motion) {
            window.motion.animate(el.resultDisplay, { opacity: [1, 0.4, 1] }, { duration: 0.3 });
        }
    }

    function deleteLast() {
        clearErrorState();
        if (state.justEvaluated) {
            clearAll();
            return;
        }
        // remove trailing multi-char tokens cleanly
        if (state.displayExpr.endsWith(' mod ')) {
            state.expression = state.expression.slice(0, -5);
            state.displayExpr = state.displayExpr.slice(0, -5);
        } else {
            state.expression = state.expression.slice(0, -1);
            state.displayExpr = state.displayExpr.slice(0, -1);
        }
        state.currentValue = liveEvaluate() ?? (state.expression === '' ? '0' : state.currentValue);
        render();
    }

    /* ---------------------------------------------------------------------
       Evaluation
       --------------------------------------------------------------------- */
    function liveEvaluate() {
        // attempt a "preview" evaluation; return null (keep old value) if incomplete/invalid
        if (state.expression === '' || isOperator(lastChar()) || lastChar() === '.' || lastChar() === '(') {
            return null;
        }
        const open = (state.expression.match(/\(/g) || []).length;
        const close = (state.expression.match(/\)/g) || []).length;
        let exprToEval = state.expression;
        if (open > close) {
            exprToEval += ')'.repeat(open - close);
        }
        try {
            const mjExpr = toMathJsExpr(exprToEval);
            const result = math.evaluate(mjExpr);
            if (typeof result !== 'number' || Number.isNaN(result)) return null;
            return formatNumber(result);
        } catch (e) {
            return null;
        }
    }

    function evaluate() {
        if (state.expression === '') return;

        if (isOperator(lastChar())) {
            shakeError();
            return;
        }

        // auto-close parens
        const open = (state.expression.match(/\(/g) || []).length;
        const close = (state.expression.match(/\)/g) || []).length;
        let exprToEval = state.expression;
        if (open > close) exprToEval += ')'.repeat(open - close);

        try {
            const mjExpr = toMathJsExpr(exprToEval);

            // guard against empty/invalid parens like "()"
            if (/\(\s*\)/.test(mjExpr)) throw new Error('Invalid parentheses');

            const result = math.evaluate(mjExpr);

            if (typeof result !== 'number' || Number.isNaN(result)) {
                throw new Error('Invalid expression');
            }
            if (!Number.isFinite(result)) {
                throw new Error('Overflow');
            }

            const formatted = formatNumber(result);
            pushHistory(state.displayExpr, formatted);

            state.currentValue = formatted;
            state.displayExpr = state.displayExpr + ' =';
            state.expression = String(result);
            state.justEvaluated = true;
            state.hasError = false;
            render();
            successPulse();
        } catch (err) {
            handleError(err);
        }
    }

    function handleError(err) {
        let message = 'Error';
        const msg = (err && err.message) || '';
        if (/division|divide/i.test(msg) || msg.includes('Infinity')) {
            message = 'Cannot divide by 0';
        } else if (/parenthes/i.test(msg)) {
            message = 'Bad parentheses';
        } else if (/overflow/i.test(msg)) {
            message = 'Overflow';
        } else if (/undefined symbol|unexpected/i.test(msg)) {
            message = 'Invalid expression';
        }
        state.hasError = true;
        state.currentValue = message;
        render();
        shakeError();
    }

    /* ---------------------------------------------------------------------
       History
       --------------------------------------------------------------------- */
    function pushHistory(expr, result) {
        state.history.unshift({ expr, result });
        if (state.history.length > 30) state.history.pop();
        renderHistory();
    }

    function renderHistory() {
        if (state.history.length === 0) {
            el.historyList.innerHTML = '<p class="history-empty">No calculations yet — your tape will print here.</p>';
            return;
        }
        el.historyList.innerHTML = state.history.map((h, i) =>
            `<button type="button" class="history-entry" data-history-index="${i}" tabindex="0">
        <span class="history-entry-expr">${escapeHtml(h.expr)}</span>
        <span class="history-entry-result">${escapeHtml(h.result)}</span>
      </button>`
        ).join('');

        $$('.history-entry').forEach((node) => {
            node.addEventListener('click', () => {
                const idx = Number(node.dataset.historyIndex);
                const entry = state.history[idx];
                if (!entry) return;
                state.expression = entry.result;
                state.displayExpr = entry.result;
                state.currentValue = entry.result;
                state.justEvaluated = false;
                render();
                animateResultChange();
            });
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ---------------------------------------------------------------------
       Ripple effect on key press
       --------------------------------------------------------------------- */
    function attachRipple(button) {
        button.addEventListener('pointerdown', (e) => {
            const rect = button.getBoundingClientRect();
            const ripple = document.createElement('span');
            const size = Math.max(rect.width, rect.height);
            const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
            const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
            ripple.className = 'ripple';
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            button.appendChild(ripple);
            setTimeout(() => ripple.remove(), 560);
        });
    }

    /* ---------------------------------------------------------------------
       Micro-interaction: press scale via Motion
       --------------------------------------------------------------------- */
    function attachPressAnimation(button) {
        if (!window.motion) return;
        const { animate } = window.motion;
        button.addEventListener('pointerdown', () => {
            animate(button, { scale: 0.92 }, { duration: 0.1, easing: [0.2, 0.8, 0.2, 1] });
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
            button.addEventListener(evt, () => {
                animate(button, { scale: 1 }, { duration: 0.22, easing: [0.2, 0.8, 0.2, 1] });
            });
        });
    }

    /* ---------------------------------------------------------------------
       Key event wiring
       --------------------------------------------------------------------- */
    el.keys.forEach((btn) => {
        attachRipple(btn);
        attachPressAnimation(btn);

        btn.addEventListener('click', () => {
            const digit = btn.dataset.digit;
            const op = btn.dataset.op;
            const action = btn.dataset.action;
            const fn = btn.dataset.func;

            if (digit !== undefined) {
                inputDigit(digit);
            } else if (op !== undefined) {
                inputOperator(op);
            } else if (fn !== undefined) {
                inputFunction(fn);
            } else if (action !== undefined) {
                handleAction(action, btn);
            }
        });
    });

    function handleAction(action, btn) {
        switch (action) {
            case 'clear': clearAll(); break;
            case 'delete': deleteLast(); break;
            case 'percent': inputPercent(); break;
            case 'sign': toggleSign(); break;
            case 'decimal': inputDecimal(); break;
            case 'equals': evaluate(); break;
            case 'paren-open': inputParen('open'); break;
            case 'paren-close': inputParen('close'); break;
            case 'pow': inputPow(); break;
            case 'mod': inputMod(); break;
            case 'pi': inputConstant('pi'); break;
            case 'inv':
                state.inverseMode = !state.inverseMode;
                render();
                break;
            case 'angle':
                state.angleMode = state.angleMode === 'deg' ? 'rad' : 'deg';
                math.config({ number: 'number' });
                render();
                break;
        }
    }

    // configure math.js angle unit behavior via wrapping trig calls
    const originalEvaluate = math.evaluate;
    math.import({
        sin: function (x) { return state.angleMode === 'deg' ? Math.sin(x * Math.PI / 180) : Math.sin(x); },
        cos: function (x) { return state.angleMode === 'deg' ? Math.cos(x * Math.PI / 180) : Math.cos(x); },
        tan: function (x) { return state.angleMode === 'deg' ? Math.tan(x * Math.PI / 180) : Math.tan(x); },
        asin: function (x) { const r = Math.asin(x); return state.angleMode === 'deg' ? r * 180 / Math.PI : r; },
        acos: function (x) { const r = Math.acos(x); return state.angleMode === 'deg' ? r * 180 / Math.PI : r; },
        atan: function (x) { const r = Math.atan(x); return state.angleMode === 'deg' ? r * 180 / Math.PI : r; }
    }, { override: true });

    /* ---------------------------------------------------------------------
       Scientific mode toggle
       --------------------------------------------------------------------- */
    let sciOpen = false;
    el.modeToggle.addEventListener('click', () => {
        sciOpen = !sciOpen;
        el.modeToggle.setAttribute('aria-pressed', String(sciOpen));
        el.sciPanel.setAttribute('aria-hidden', String(!sciOpen));
        el.sciPanel.classList.toggle('open', sciOpen);

        if (window.gsap) {
            if (sciOpen) {
                gsap.fromTo('.sci-grid .key-sci',
                    { opacity: 0, y: -8, scale: 0.9 },
                    { opacity: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.02, ease: 'back.out(1.7)', delay: 0.08 }
                );
            }
        }
    });

    /* ---------------------------------------------------------------------
       History toggle
       --------------------------------------------------------------------- */
    el.historyToggle.addEventListener('click', () => {
        const isOpen = el.historyTape.classList.toggle('open');
        el.historyToggle.setAttribute('aria-expanded', String(isOpen));
    });

    /* ---------------------------------------------------------------------
       Copy result
       --------------------------------------------------------------------- */
    el.copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(state.currentValue);
            el.copyBtn.classList.add('copied');
            const icon = el.copyBtn.querySelector('i');
            if (window.lucide) {
                el.copyBtn.innerHTML = '<i data-lucide="check" class="icon-xs"></i>';
                lucide.createIcons();
            }
            setTimeout(() => {
                el.copyBtn.classList.remove('copied');
                el.copyBtn.innerHTML = '<i data-lucide="copy" class="icon-xs"></i>';
                if (window.lucide) lucide.createIcons();
            }, 1400);
        } catch (e) {
            // clipboard unavailable — fail silently, no crash
        }
    });

    /* ---------------------------------------------------------------------
       Keyboard support
       --------------------------------------------------------------------- */
    const KEY_MAP = {
        '+': () => inputOperator('+'),
        '-': () => inputOperator('−'),
        '*': () => inputOperator('×'),
        '/': () => inputOperator('÷'),
        '%': () => inputPercent(),
        '.': () => inputDecimal(),
        '(': () => inputParen('open'),
        ')': () => inputParen('close'),
        'Enter': () => evaluate(),
        '=': () => evaluate(),
        'Backspace': () => deleteLast(),
        'Delete': () => clearAll(),
        'Escape': () => clearAll(),
        '^': () => inputPow()
    };

    window.addEventListener('keydown', (e) => {
        if (/^[0-9]$/.test(e.key)) {
            inputDigit(e.key);
            flashKeyForInput(`[data-digit="${e.key}"]`);
            return;
        }
        if (KEY_MAP[e.key]) {
            e.preventDefault();
            KEY_MAP[e.key]();
            const selectorMap = {
                '+': '[data-op="+"]', '-': '[data-op="−"]', '*': '[data-op="×"]', '/': '[data-op="÷"]',
                'Enter': '[data-action="equals"]', '=': '[data-action="equals"]',
                'Backspace': '[data-action="delete"]', 'Escape': '[data-action="clear"]', 'Delete': '[data-action="clear"]',
                '.': '[data-action="decimal"]'
            };
            if (selectorMap[e.key]) flashKeyForInput(selectorMap[e.key]);
        }
    });

    function flashKeyForInput(selector) {
        const btn = document.querySelector(selector);
        if (!btn || !window.motion) return;
        window.motion.animate(btn, { scale: [1, 0.9, 1] }, { duration: 0.18 });
    }

    /* ---------------------------------------------------------------------
       Initial render
       --------------------------------------------------------------------- */
    render();
})();