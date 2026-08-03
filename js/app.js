/* mORA for KaiOS 2.5 — application shell.
 *
 * Input model (D-pad only, no touch):
 *   ↑/↓        scroll the reading / move the selection in menus
 *   ←/→        previous / next day
 *   Enter      open the hour chooser (Horas) / select in menus
 *   SoftLeft   options menu                (desktop testing: q)
 *   SoftRight  back / exit                 (desktop testing: e)
 *   Backspace  back / exit (KaiOS back key)
 *   1–5        jump straight to a canonical hour
 *   7          options menu (alias — reaches the page even in browsers
 *              that keep the softkeys for themselves)
 *   9          switch Horas ⇄ Missa
 *   0          toggle autoscroll
 *   * / #      smaller / larger text
 *
 * Every control is also clickable (header day arrows, softkey bar,
 * overlay items): in the KaiOS *browser* — as opposed to the packaged
 * app — the D-pad drives a virtual cursor, so clicks are the reliable
 * channel there. Same for mouse users on desktop.
 *
 * SoftLeft/SoftRight/Backspace keep their browser meaning in a browser
 * tab (only a packaged/installed app claims them); the number pad is
 * claimed everywhere. ?browser=1 hands everything back to the browser.
 *
 * Syntax budget: Gecko 48 — no async/await, no ?., no ??, no spread.
 */
(function () {
  'use strict';

  var L = window.MoraLiturgy;

  var COLORS = {
    verde: '#1a7a3c',
    roxo: '#6d3fa0',
    vermelho: '#b3372e',
    branco: '#b09232',
    rosa: '#c26a8d'
  };

  // Brighter liturgical accents for readability on the dark background.
  var COLORS_DARK = {
    verde: '#4caf72',
    roxo: '#a678d8',
    vermelho: '#e0645a',
    branco: '#d4b95e',
    rosa: '#d98aa8'
  };

  var WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  var FONT_KEY = 'mora_kaios_font';
  var FONT_CLASSES = ['font-s', '', 'font-l'];
  var THEME_KEY = 'mora_kaios_theme';
  var SERIF_KEY = 'mora_kaios_serif';

  // Key ownership is split in two:
  //  - SoftLeft/SoftRight/Backspace (the action keys) belong to the
  //    browser unless we run as a packaged/installed app — so the KaiOS
  //    browser's own softkey menu ("Add to Home Screen", back) keeps
  //    working in a tab. The q/e/7 aliases and clicks drive those app
  //    functions in the browser instead.
  //  - The number pad (digits, *, #) is claimed everywhere: the browser's
  //    digit shortcuts conflict with the app's and are suppressed.
  // ?browser=1 hands everything back to the browser.
  var ownsSoftkeys = window.location.protocol === 'app:';
  // The KaiOS browser floats round buttons over the page's bottom corners
  // — the in-browser class lifts the softkey bar clear of them.
  document.documentElement.classList.toggle('in-browser', !ownsSoftkeys);
  if (!ownsSoftkeys && navigator.mozApps && navigator.mozApps.getSelf) {
    try {
      var selfReq = navigator.mozApps.getSelf();
      selfReq.onsuccess = function () {
        if (selfReq.result) {
          ownsSoftkeys = true;
          document.documentElement.classList.remove('in-browser');
        }
      };
    } catch (err) {
      /* not a KaiOS app context */
    }
  }
  var browserAll = /[?&]browser=1/.test(window.location.search);

  var state = {
    view: 'horas',          // 'horas' | 'missa'
    date: new Date(),
    hourId: null,           // selected canonical hour id
    subHour: null,          // 'Tércia' | 'Sexta' | 'Noa' | null = by time
    missaFull: false,       // Missa defaults to readings-only
    liturgy: null,
    loading: false,
    error: null,
    overlay: null,          // { type, title, items: [{label, hint, action}], index }
    fontSize: 1,
    theme: 'light',         // 'light' | 'dark'
    serif: false,           // serif face for the reading text
    autoscroll: null        // interval id or null
  };

  var el = {
    header: document.getElementById('header'),
    navPrev: document.getElementById('nav-prev'),
    navNext: document.getElementById('nav-next'),
    dateLine: document.getElementById('date-line'),
    banner: document.getElementById('banner'),
    content: document.getElementById('content'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayList: document.getElementById('overlay-list'),
    skLeft: document.getElementById('sk-left'),
    skCenter: document.getElementById('sk-center'),
    skRight: document.getElementById('sk-right')
  };

  // ---- HTML sanitisation ---------------------------------------------
  // The privileged-app CSP already blocks inline script execution; this
  // scrub keeps active content out of the DOM regardless of context
  // (e.g. desktop-browser testing, where there is no packaged-app CSP).

  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    var bad = doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form');
    Array.prototype.forEach.call(bad, function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    var all = doc.querySelectorAll('*');
    Array.prototype.forEach.call(all, function (node) {
      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var attr = node.attributes[i];
        var name = attr.name.toLowerCase();
        if (name.indexOf('on') === 0) {
          node.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
          node.removeAttribute(attr.name);
        }
      }
    });
    return doc.body.firstChild ? doc.body.firstChild.innerHTML : '';
  }

  // Slice the Mass text down to the readings (port of the mORA web app's
  // readings-only view): from "LEITURA I" up to the Credo/offertory, with
  // the Aleluia block before the Gospel dropped. Falls back to the full
  // text when the markers aren't found.
  function extractReadings(html) {
    var startIdx = html.indexOf('<p><strong>LEITURA I');
    if (startIdx === -1) return html;
    var postStart = html.slice(startIdx);
    var endMatch = postStart.search(
      /<p>(?:<b>(?:Oração sobre as oblatas|Prefácio)|Diz-se o Credo|<strong>(?:Credo|Oração sobre as oblatas))/i
    );
    var endIdx = endMatch !== -1 ? startIdx + endMatch : html.length;
    var extracted = html.substring(startIdx, endIdx);
    return extracted.replace(
      /<p><strong>(?:ALELUIA|ACLAMAÇÃO ANTES DO EVANGELHO)<\/strong>[\s\S]*?(?=<p><strong>EVANGELHO<\/strong>)/i,
      ''
    );
  }

  // ---- Rendering ------------------------------------------------------

  function formatDateLabel(d) {
    return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' de ' + MONTHS[d.getMonth()];
  }

  function renderHeader() {
    el.dateLine.textContent = formatDateLabel(state.date);
    var lit = state.liturgy;
    var palette = state.theme === 'dark' ? COLORS_DARK : COLORS;
    var color = lit && palette[lit.color] ? palette[lit.color] : palette.verde;
    document.documentElement.style.setProperty('--accent', color);
  }

  function renderBanner() {
    var lit = state.liturgy;
    if (lit && lit.sample) {
      el.banner.textContent = 'Sem ligação — a mostrar dados de exemplo.';
      el.banner.className = '';
    } else {
      el.banner.className = 'hidden';
    }
  }

  function currentMoments() {
    return state.liturgy ? L.buildCanonicalHours(state.liturgy.parts) : [];
  }

  function currentMoment() {
    var moments = currentMoments();
    for (var i = 0; i < moments.length; i++) {
      if (moments[i].id === state.hourId) return moments[i];
    }
    return moments.length > 0 ? moments[0] : null;
  }

  // Which of Tércia/Sexta/Noa fits the time of day (the mORA web app's
  // defaulting: mid-morning, midday, mid-afternoon).
  function defaultSubHour(now) {
    now = now || new Date();
    var h = now.getHours();
    if (h < 12) return 'Tércia';
    if (h < 15) return 'Sexta';
    return 'Noa';
  }

  // The parts to display for a moment: Hora Intermédia narrows to the
  // chosen (or time-appropriate) sub-hour; other hours show everything.
  function displayedParts(moment) {
    if (moment.id !== 'intermedia') return moment.parts;
    var wanted = state.subHour || defaultSubHour();
    for (var i = 0; i < moment.parts.length; i++) {
      if (moment.parts[i].title === wanted) return [moment.parts[i]];
    }
    return moment.parts;
  }

  function renderContent() {
    stopAutoscroll();
    var html = '';

    if (state.loading) {
      html = '<div class="center-note">A carregar a liturgia…</div>';
    } else if (state.error) {
      html = '<div class="center-note">Não foi possível obter a liturgia.<br><br>' +
        'Verifique a ligação e prima <strong>OK</strong> para tentar de novo.</div>';
    } else if (!state.liturgy) {
      html = '<div class="center-note">Não há liturgia para este dia.</div>';
    } else if (state.view === 'missa') {
      var massHtml = state.liturgy.massHtml;
      if (!state.missaFull) massHtml = extractReadings(massHtml);
      html = sanitizeHtml(massHtml);
    } else {
      var moment = currentMoment();
      if (!moment) {
        html = '<div class="center-note">Sem Liturgia das Horas para este dia.</div>';
      } else {
        var parts = displayedParts(moment);
        var heading = moment.label;
        if (moment.id === 'intermedia' && parts.length === 1) {
          heading = 'Hora Intermédia (' + parts[0].title + ')';
        }
        html = '<div class="hour-heading">' + escapeText(heading) + '</div>';
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          // The chip labels the part inside a composite hour (Invitatório +
          // Laudes); a single-part hour would just repeat the heading
          // ("Completas" twice), so skip it there.
          html += '<div class="part">';
          if (parts.length > 1) {
            html += '<span class="part-title">' + escapeText(part.title) + '</span>';
          }
          var verses = (part.verses || []).slice().sort(function (a, b) { return a.order - b.order; });
          for (var j = 0; j < verses.length; j++) {
            html += '<div class="verse">' + sanitizeHtml(verses[j].text) + '</div>';
          }
          html += '</div>';
        }
      }
    }

    el.content.innerHTML = html;
    el.content.scrollTop = 0;
  }

  function escapeText(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function renderSoftkeys() {
    if (state.overlay) {
      el.skLeft.textContent = '';
      el.skCenter.textContent = 'OK';
      el.skRight.textContent = 'Voltar';
    } else if (state.error) {
      el.skLeft.textContent = 'Opções';
      el.skCenter.textContent = 'Tentar';
      el.skRight.textContent = 'Sair';
    } else {
      el.skLeft.textContent = 'Opções';
      el.skCenter.textContent = state.view === 'horas' ? 'Horas' : '';
      el.skRight.textContent = 'Sair';
    }
  }

  function renderOverlay() {
    if (!state.overlay) {
      el.overlay.className = 'hidden';
      return;
    }
    el.overlay.className = '';
    el.overlayTitle.textContent = state.overlay.title;
    el.overlayList.innerHTML = '';
    var items = state.overlay.items;
    for (var i = 0; i < items.length; i++) {
      var li = document.createElement('li');
      li.textContent = items[i].label;
      if (items[i].hint) {
        var hint = document.createElement('span');
        hint.className = 'item-hint';
        hint.textContent = items[i].hint;
        li.appendChild(hint);
      }
      if (i === state.overlay.index) li.className = 'selected';
      el.overlayList.appendChild(li);
    }
    var selected = el.overlayList.children[state.overlay.index];
    if (selected && selected.scrollIntoView) selected.scrollIntoView(false);
  }

  function renderAll() {
    renderHeader();
    renderBanner();
    renderContent();
    renderOverlay();
    renderSoftkeys();
  }

  // ---- Data loading ---------------------------------------------------

  function loadDay() {
    state.loading = true;
    state.error = null;
    state.liturgy = null;
    renderAll();

    var dateStr = L.formatLocalDate(state.date);
    L.fetchDailyLiturgy(dateStr).then(
      function (result) {
        if (L.formatLocalDate(state.date) !== dateStr) return; // user moved on
        state.loading = false;
        state.liturgy = result;
        ensureHourSelection();
        renderAll();
      },
      function () {
        if (L.formatLocalDate(state.date) !== dateStr) return;
        state.loading = false;
        // No network and no cache: fall back to the bundled sample day so
        // the app remains demonstrable; the banner flags it clearly.
        if (window.MoraSample) {
          state.liturgy = window.MoraSample(dateStr);
          ensureHourSelection();
        } else {
          state.error = true;
        }
        renderAll();
      }
    );
  }

  function ensureHourSelection() {
    var moments = currentMoments();
    if (moments.length === 0) return;
    for (var i = 0; i < moments.length; i++) {
      if (moments[i].id === state.hourId) return;
    }
    var wanted = L.getHourForTime(new Date());
    for (var j = 0; j < moments.length; j++) {
      if (moments[j].id === wanted) { state.hourId = wanted; return; }
    }
    state.hourId = moments[0].id;
  }

  function changeDay(delta) {
    var d = new Date(state.date.getTime());
    d.setDate(d.getDate() + delta);
    state.date = d;
    loadDay();
  }

  // ---- Overlays -------------------------------------------------------

  function openHourChooser() {
    var moments = currentMoments();
    if (moments.length === 0) return;
    var items = [];
    for (var i = 0; i < moments.length; i++) {
      (function (moment, n) {
        items.push({
          label: moment.label,
          hint: String(n + 1),
          action: function () {
            if (moment.id === 'intermedia' && moment.parts.length > 1) {
              openSubHourChooser(moment);
              return;
            }
            state.view = 'horas';
            state.hourId = moment.id;
            closeOverlay();
            renderAll();
          }
        });
      })(moments[i], i);
    }
    state.overlay = { type: 'hours', title: 'Liturgia das Horas', items: items, index: 0 };
    for (var k = 0; k < moments.length; k++) {
      if (moments[k].id === state.hourId) state.overlay.index = k;
    }
    renderOverlay();
    renderSoftkeys();
  }

  function openSubHourChooser(moment) {
    var current = state.subHour || defaultSubHour();
    var items = [];
    for (var i = 0; i < moment.parts.length; i++) {
      (function (part, n) {
        items.push({
          label: part.title,
          hint: String(n + 1),
          action: function () {
            state.view = 'horas';
            state.hourId = 'intermedia';
            state.subHour = part.title;
            closeOverlay();
            renderAll();
          }
        });
      })(moment.parts[i], i);
    }
    state.overlay = { type: 'hours', title: 'Hora Intermédia', items: items, index: 0 };
    for (var k = 0; k < moment.parts.length; k++) {
      if (moment.parts[k].title === current) state.overlay.index = k;
    }
    renderOverlay();
    renderSoftkeys();
  }

  function openOptionsMenu() {
    var items = [];
    items.push({
      label: state.view === 'horas' ? 'Ver Missa do dia' : 'Ver Liturgia das Horas',
      hint: '9',
      action: function () {
        state.view = state.view === 'horas' ? 'missa' : 'horas';
        closeOverlay();
        renderAll();
      }
    });
    if (state.view === 'horas') {
      items.push({ label: 'Escolher Hora…', action: function () { openHourChooser(); } });
    }
    if (state.view === 'missa') {
      items.push({
        label: state.missaFull ? 'Ver só as leituras' : 'Ver missal completo',
        action: function () {
          state.missaFull = !state.missaFull;
          closeOverlay();
          renderAll();
        }
      });
    }
    items.push({
      label: 'Hoje',
      action: function () {
        state.date = new Date();
        closeOverlay();
        loadDay();
      }
    });
    items.push({
      label: 'Deslocamento automático',
      hint: '0',
      action: function () {
        closeOverlay();
        renderSoftkeys();
        toggleAutoscroll();
      }
    });
    items.push({
      label: isFullscreen() ? 'Sair de ecrã inteiro' : 'Ecrã inteiro',
      action: function () {
        closeOverlay();
        toggleFullscreen();
      }
    });
    items.push({
      label: state.theme === 'dark' ? 'Tema claro' : 'Tema escuro',
      action: function () {
        closeOverlay();
        setTheme(state.theme === 'dark' ? 'light' : 'dark');
      }
    });
    items.push({
      label: state.serif ? 'Letra sem serifa' : 'Letra com serifa',
      action: function () {
        closeOverlay();
        setSerif(!state.serif);
      }
    });
    items.push({ label: 'Texto maior', hint: '#', action: function () { closeOverlay(); setFontSize(state.fontSize + 1); } });
    items.push({ label: 'Texto menor', hint: '*', action: function () { closeOverlay(); setFontSize(state.fontSize - 1); } });
    items.push({
      label: 'Atualizar este dia',
      action: function () {
        try { localStorage.removeItem('mora_liturgy_' + L.formatLocalDate(state.date)); } catch (e) { /* ignore */ }
        closeOverlay();
        loadDay();
      }
    });
    state.overlay = { type: 'menu', title: 'Opções', items: items, index: 0 };
    renderOverlay();
    renderSoftkeys();
  }

  function exitApp() {
    // Packaged apps close with window.close(); a browser tab the user
    // opened ignores it, so fall back to leaving the page via history —
    // and if there's nowhere to go back to, stay put with the menu closed.
    window.close();
    setTimeout(function () {
      if (window.closed) return;
      if (window.history.length > 1) {
        window.history.back();
      } else {
        closeOverlay();
        renderAll();
      }
    }, 150);
  }

  function openExitConfirm() {
    state.overlay = {
      type: 'confirm',
      title: 'Sair do mORA?',
      items: [
        { label: 'Sair', action: exitApp },
        { label: 'Continuar a rezar', action: function () { closeOverlay(); renderAll(); } }
      ],
      index: 1
    };
    renderOverlay();
    renderSoftkeys();
  }

  function closeOverlay() {
    state.overlay = null;
    el.overlay.className = 'hidden';
    renderSoftkeys();
  }

  // ---- Autoscroll & font size ----------------------------------------

  function toggleAutoscroll() {
    if (state.autoscroll) {
      stopAutoscroll();
    } else {
      state.autoscroll = setInterval(function () {
        el.content.scrollTop += 1;
      }, 60);
      // KaiOS packaged apps can keep the screen on while autoscrolling.
      if (navigator.requestWakeLock) {
        try { state.wakeLock = navigator.requestWakeLock('screen'); } catch (e) { /* unsupported */ }
      }
    }
  }

  function stopAutoscroll() {
    if (state.autoscroll) {
      clearInterval(state.autoscroll);
      state.autoscroll = null;
    }
    if (state.wakeLock) {
      try { state.wakeLock.unlock(); } catch (e) { /* already released */ }
      state.wakeLock = null;
    }
  }

  function setSerif(on) {
    state.serif = !!on;
    document.documentElement.classList.toggle('serif', state.serif);
    try { localStorage.setItem(SERIF_KEY, state.serif ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // Fullscreen hides the browser/system chrome that otherwise sits above
  // the app (Gecko 48 uses the moz-prefixed Fullscreen API).
  function isFullscreen() {
    return !!(document.fullscreenElement || document.mozFullScreenElement);
  }

  function toggleFullscreen() {
    var root = document.documentElement;
    if (isFullscreen()) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
    } else {
      if (root.requestFullscreen) root.requestFullscreen();
      else if (root.mozRequestFullScreen) root.mozRequestFullScreen();
    }
  }

  function setTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    try { localStorage.setItem(THEME_KEY, state.theme); } catch (e) { /* ignore */ }
    renderHeader(); // accent palette differs per theme
  }

  function setFontSize(size) {
    if (size < 0) size = 0;
    if (size > 2) size = 2;
    state.fontSize = size;
    var root = document.documentElement;
    root.classList.remove('font-s');
    root.classList.remove('font-l');
    if (FONT_CLASSES[size]) root.classList.add(FONT_CLASSES[size]);
    try { localStorage.setItem(FONT_KEY, String(size)); } catch (e) { /* ignore */ }
  }

  // ---- Shared actions (keys and clicks route through these) ----------

  function overlayActivate(index) {
    var overlay = state.overlay;
    if (!overlay || index < 0 || index >= overlay.items.length) return;
    overlay.index = index;
    overlay.items[index].action();
  }

  // What Enter means outside an overlay (also the centre softkey's click).
  function primaryAction() {
    if (state.error) {
      loadDay();
    } else if (state.view === 'horas') {
      openHourChooser();
    }
  }

  // What SoftRight/Backspace mean (also the right softkey's click).
  function backAction() {
    if (state.overlay) {
      closeOverlay();
      renderAll();
    } else {
      openExitConfirm();
    }
  }

  // ---- Key handling ---------------------------------------------------

  var SCROLL_STEP = 48;

  function onKeyDown(e) {
    var key = e.key;

    // Aliases: q/e for desktop testing, 7 for browsers where the real
    // softkeys belong to the browser chrome. Alias presses are always
    // ours, even in browser mode.
    var fromAlias = false;
    if (key === 'q' || key === '7') { key = 'SoftLeft'; fromAlias = true; }
    if (key === 'e') { key = 'SoftRight'; fromAlias = true; }

    // Any key press stops hands-free scrolling (except its own toggle).
    if (state.autoscroll && key !== '0') stopAutoscroll();

    if (state.overlay) {
      handleOverlayKey(key, e);
      return;
    }

    switch (key) {
      case 'ArrowUp':
        el.content.scrollTop -= SCROLL_STEP;
        e.preventDefault();
        break;
      case 'ArrowDown':
        el.content.scrollTop += SCROLL_STEP;
        e.preventDefault();
        break;
      case 'ArrowLeft':
        changeDay(-1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        changeDay(1);
        e.preventDefault();
        break;
      case 'Enter':
        primaryAction();
        e.preventDefault();
        break;
      case 'SoftLeft':
        // In a browser tab the physical softkeys stay with the browser
        // (its right-softkey menu is how the page gets added as an app).
        if (!ownsSoftkeys && !fromAlias) return;
        openOptionsMenu();
        e.preventDefault();
        break;
      case 'SoftRight':
      case 'Backspace':
        if (!ownsSoftkeys && !fromAlias) return;
        backAction();
        e.preventDefault();
        break;
      // The KaiOS browser has its own number-key functions (zoom, scroll
      // shortcuts); in app mode every digit/*/# is claimed and
      // preventDefault()ed — including 6 and 8, which the app doesn't use
      // — so the browser's shortcuts can't fire underneath ours.
      case '9':
        if (browserAll) return;
        state.view = state.view === 'horas' ? 'missa' : 'horas';
        renderAll();
        e.preventDefault();
        break;
      case '0':
        if (browserAll) return;
        toggleAutoscroll();
        e.preventDefault();
        break;
      case '*':
        if (browserAll) return;
        setFontSize(state.fontSize - 1);
        e.preventDefault();
        break;
      case '#':
        if (browserAll) return;
        setFontSize(state.fontSize + 1);
        e.preventDefault();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        if (browserAll) return;
        selectHourByNumber(Number(key));
        e.preventDefault();
        break;
      case '6':
      case '8':
        if (!browserAll) e.preventDefault();
        break;
      default:
        break;
    }
  }

  function selectHourByNumber(n) {
    var moments = currentMoments();
    if (n >= 1 && n <= moments.length) {
      state.view = 'horas';
      state.hourId = moments[n - 1].id;
      renderAll();
    }
  }

  function handleOverlayKey(key, e) {
    var overlay = state.overlay;
    switch (key) {
      case 'ArrowUp':
        overlay.index = (overlay.index - 1 + overlay.items.length) % overlay.items.length;
        renderOverlay();
        e.preventDefault();
        break;
      case 'ArrowDown':
        overlay.index = (overlay.index + 1) % overlay.items.length;
        renderOverlay();
        e.preventDefault();
        break;
      case 'Enter':
        overlay.items[overlay.index].action();
        e.preventDefault();
        break;
      case 'SoftRight':
      case 'Backspace':
      case 'Escape':
        closeOverlay();
        renderAll();
        e.preventDefault();
        break;
      default:
        // Number shortcuts inside the hour chooser.
        if (overlay.type === 'hours' && key >= '1' && key <= '5') {
          var idx = Number(key) - 1;
          if (idx < overlay.items.length) overlay.items[idx].action();
          e.preventDefault();
        } else if (!browserAll && /^[0-9*#]$/.test(key)) {
          // Keep the browser's number-key functions suppressed while an
          // overlay is open too.
          e.preventDefault();
        }
        break;
    }
  }

  // ---- Boot -----------------------------------------------------------

  function boot() {
    var savedFont = 1;
    try {
      var raw = localStorage.getItem(FONT_KEY);
      if (raw !== null) savedFont = Number(raw);
      if (isNaN(savedFont)) savedFont = 1;
    } catch (e) { /* defaults apply */ }
    setFontSize(savedFont);

    try {
      setTheme(localStorage.getItem(THEME_KEY) || 'light');
      setSerif(localStorage.getItem(SERIF_KEY) === '1');
    } catch (e) {
      /* defaults apply */
    }

    // Kill the emulated cursor where the platform lets us: the manifest's
    // "cursor": false covers packaged apps, and spatialNavigationEnabled
    // (behind the spatialnavigation-app-manage permission, privileged apps
    // only) is the runtime switch. A plain page in the KaiOS *browser*
    // cannot turn the browser's cursor off — that needs the installed app.
    try {
      if ('spatialNavigationEnabled' in navigator) {
        navigator.spatialNavigationEnabled = false;
      }
    } catch (e) {
      /* not permitted in this context */
    }

    document.addEventListener('keydown', onKeyDown);

    // Pointer fallbacks: the KaiOS browser's virtual cursor and desktop
    // mice never produce softkey events, so every control is clickable.
    el.navPrev.addEventListener('click', function () { changeDay(-1); });
    el.navNext.addEventListener('click', function () { changeDay(1); });
    el.skLeft.addEventListener('click', function () {
      if (!state.overlay) openOptionsMenu();
    });
    el.skCenter.addEventListener('click', function () {
      if (state.overlay) {
        overlayActivate(state.overlay.index);
      } else {
        primaryAction();
      }
    });
    el.skRight.addEventListener('click', backAction);
    el.overlayList.addEventListener('click', function (e) {
      var li = e.target;
      while (li && li.nodeName !== 'LI') li = li.parentNode;
      if (!li || !li.parentNode) return;
      var index = Array.prototype.indexOf.call(el.overlayList.children, li);
      overlayActivate(index);
    });

    loadDay();
  }

  boot();
})();
