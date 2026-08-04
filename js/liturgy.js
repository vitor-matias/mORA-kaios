/* Liturgy data layer — a Gecko 48-safe port of mORA's src/lib/liturgy.ts
 * and src/lib/hours.ts. Same API (apiapp.glauco.it GraphQL, Portuguese
 * rite), same per-day localStorage cache with past-day pruning, same
 * wrong-day-response guard.
 *
 * Syntax budget: nothing newer than Gecko 48 — no async/await, no
 * optional chaining/nullish coalescing, no object spread, no modules.
 */
(function (global) {
  'use strict';

  var API_URL = 'https://apiapp.glauco.it/liturgiadashoras/graphql';
  var CACHE_PREFIX = 'mora_liturgy_';

  var QUERY =
    'query DailyLiturgy($date: String!, $rite: String!) {' +
    '  liturgyWithMemories(date: $date, rite: $rite) {' +
    '    date type week_name rite' +
    '    masses { title date text }' +
    '    memories { date title type week_name parts { title order verses { id text order } } }' +
    '  }' +
    '}';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatLocalDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ---- Cache ---------------------------------------------------------

  function readCacheEntry(dateStr) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + dateStr);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // A valid entry must carry a massDate matching its key (guards against a
  // wrong-day response having been cached by an older client).
  function readCache(dateStr) {
    var entry = readCacheEntry(dateStr);
    return entry && entry.massDate === dateStr ? entry : null;
  }

  function pruneCache() {
    try {
      var todayStr = formatLocalDate(new Date());
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(CACHE_PREFIX) !== 0) continue;
        var dateStr = key.slice(CACHE_PREFIX.length);
        if (dateStr < todayStr) localStorage.removeItem(key);
      }
    } catch (e) {
      /* storage errors are non-fatal */
    }
  }

  function writeCache(dateStr, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + dateStr, JSON.stringify(data));
      pruneCache();
    } catch (e) {
      /* quota exceeded — the app still works, just uncached */
    }
  }

  // ---- Colour inference (rough, from the Mass title) ------------------

  function inferColor(title) {
    var t = (title || '').toLowerCase();
    if (t.indexOf('quaresma') !== -1 || t.indexOf('advento') !== -1) return 'roxo';
    if (t.indexOf('mártir') !== -1 || t.indexOf('martir') !== -1 || t.indexOf('espírito santo') !== -1) return 'vermelho';
    if (t.indexOf('solenidade') !== -1 || t.indexOf('festa') !== -1 || t.indexOf('natal') !== -1 || t.indexOf('páscoa') !== -1) return 'branco';
    return 'verde';
  }

  // ---- Fetch ----------------------------------------------------------

  // Gecko 48 has no AbortController, so a hung request would spin forever;
  // racing a timer at least lets the UI recover (the underlying request is
  // simply abandoned).
  var FETCH_TIMEOUT_MS = 15000;

  function fetchWithTimeout(url, opts) {
    return Promise.race([
      fetch(url, opts),
      new Promise(function (resolve, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, FETCH_TIMEOUT_MS);
      })
    ]);
  }

  /**
   * Resolves the day's liturgy: { date, massDate, color, title, weekName,
   * massHtml, parts, sample? } — or null when the API has no Mass for the
   * date. Network failures fall back to a stale cache entry when one
   * exists, otherwise reject.
   */
  function fetchDailyLiturgy(dateStr) {
    var cached = readCache(dateStr);
    if (cached) return Promise.resolve(cached);

    return fetchWithTimeout(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { date: dateStr, rite: 'portoghese' } })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        var data = json && json.data ? json.data.liturgyWithMemories : null;
        if (!data || !data.masses || data.masses.length === 0) return null;

        // The upstream has been seen answering with another day's liturgy;
        // wrong-day data must never render or be cached.
        if (data.date && data.date !== dateStr) {
          throw new Error('Liturgy response is for ' + data.date + ', not ' + dateStr);
        }
        var mass = null;
        for (var i = 0; i < data.masses.length; i++) {
          if (data.masses[i].date === dateStr) { mass = data.masses[i]; break; }
        }
        if (!mass) throw new Error('No Mass dated ' + dateStr + ' in liturgy response');

        var memory = data.memories && data.memories.length > 0 ? data.memories[0] : null;
        var result = {
          date: dateStr,
          massDate: mass.date,
          color: inferColor(mass.title),
          title: mass.title,
          weekName: memory ? memory.week_name : null,
          massHtml: mass.text,
          parts: memory ? memory.parts : []
        };
        writeCache(dateStr, result);
        return result;
      })
      .catch(function (err) {
        // Better stale than an error page when the network is down.
        var stale = readCacheEntry(dateStr);
        if (stale) return stale;
        throw err;
      });
  }

  /**
   * Warms the cache for the next few days so mornings work instantly and
   * offline (port of mORA's preloadUpcomingLiturgy). Sequential to avoid
   * hammering the API, skips days already cached, never rejects.
   */
  function preloadUpcoming(days) {
    days = days || 5;
    var base = new Date();
    var chain = Promise.resolve();

    function enqueue(dateStr) {
      chain = chain.then(function () {
        if (readCache(dateStr)) return null;
        return fetchDailyLiturgy(dateStr).then(null, function () { return null; });
      });
    }

    for (var i = 1; i <= days; i++) {
      var d = new Date(base.getTime());
      d.setDate(base.getDate() + i);
      enqueue(formatLocalDate(d));
    }
    return chain;
  }

  // ---- Canonical hours -------------------------------------------------

  /**
   * Maps the raw API parts into the 5 canonical hours (port of
   * buildCanonicalHours in LiturgiaHoras.tsx):
   *  - Ofício de Leitura: Invitatório + Ofício de Leitura
   *  - Laudes: Invitatório + Laudes
   *  - Hora Intermédia: Tércia + Sexta + Noa
   *  - Vésperas / Completas: matched by prefix (the API renames them on
   *    Saturdays/Sundays, e.g. "Vésperas II", "Compl. dep. Vésp. II").
   */
  function buildCanonicalHours(rawParts) {
    rawParts = rawParts || [];

    function byTitle(title) {
      for (var i = 0; i < rawParts.length; i++) {
        if (rawParts[i].title === title) return rawParts[i];
      }
      return null;
    }
    function byPrefix(prefix) {
      for (var i = 0; i < rawParts.length; i++) {
        if (rawParts[i].title && rawParts[i].title.indexOf(prefix) === 0) return rawParts[i];
      }
      return null;
    }

    var invitatorio = byTitle('Invitatório');
    var oficio = byTitle('Ofício de Leitura');
    var laudes = byTitle('Laudes');
    var tercia = byTitle('Tércia');
    var sexta = byTitle('Sexta');
    var noa = byTitle('Noa');
    var vesperas = byPrefix('Vésperas');
    var completas = byPrefix('Completas') || byPrefix('Compl');

    var moments = [];
    var parts;

    parts = [];
    if (invitatorio) parts.push(invitatorio);
    if (oficio) parts.push(oficio);
    if (parts.length > 0) {
      moments.push({ id: 'oficio', label: 'Ofício de Leitura', shortLabel: 'Ofício', parts: parts });
    }

    parts = [];
    if (invitatorio) parts.push(invitatorio);
    if (laudes) parts.push(laudes);
    if (parts.length > 0) {
      moments.push({ id: 'laudes', label: 'Laudes', shortLabel: 'Laudes', parts: parts });
    }

    parts = [];
    if (tercia) parts.push(tercia);
    if (sexta) parts.push(sexta);
    if (noa) parts.push(noa);
    if (parts.length > 0) {
      moments.push({ id: 'intermedia', label: 'Hora Intermédia', shortLabel: 'Interm.', parts: parts });
    }

    if (vesperas) {
      moments.push({ id: 'vesperas', label: vesperas.title, shortLabel: 'Vésperas', parts: [vesperas] });
    }
    if (completas) {
      var label = completas.title.indexOf('Completas') === 0 ? completas.title : 'Completas';
      moments.push({ id: 'completas', label: label, shortLabel: 'Completas', parts: [completas] });
    }

    return moments;
  }

  /** Which hour the user most likely wants right now (port of getHourForTime). */
  function getHourForTime(now) {
    now = now || new Date();
    var h = now.getHours();
    if (h >= 6 && h < 9) return 'laudes';
    if (h >= 9 && h < 18) return 'intermedia';
    if (h >= 18 && h < 21) return 'vesperas';
    if (h >= 21 || h < 2) return 'completas';
    return 'oficio';
  }

  /** From Saturday 16:00 onward the vigil Mass belongs to Sunday. */
  function getDefaultMassDate(now) {
    now = now || new Date();
    if (now.getDay() === 6 && now.getHours() >= 16) {
      var sunday = new Date(now.getTime());
      sunday.setDate(now.getDate() + 1);
      return sunday;
    }
    return now;
  }

  global.MoraLiturgy = {
    formatLocalDate: formatLocalDate,
    fetchDailyLiturgy: fetchDailyLiturgy,
    preloadUpcoming: preloadUpcoming,
    buildCanonicalHours: buildCanonicalHours,
    getHourForTime: getHourForTime,
    getDefaultMassDate: getDefaultMassDate
  };
})(window);
