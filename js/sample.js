/* Bundled sample day — shown only when there is no network AND no cached
 * entry for the requested date, so the app can always be demoed. The
 * content is deliberately minimal (well-known liturgical incipits and
 * placeholders), clearly flagged in the UI via the `sample` field.
 */
(function (global) {
  'use strict';

  global.MoraSample = function (dateStr) {
    return {
      date: dateStr,
      massDate: dateStr,
      color: 'verde',
      title: 'Dia de exemplo (sem ligação)',
      weekName: 'Tempo Comum',
      sample: true,
      massHtml:
        '<h2>LEITURA I</h2>' +
        '<p><em>Leitura de exemplo — sem ligação à internet, os textos do dia ' +
        'não estão disponíveis. Ligue os dados e escolha «Atualizar» no menu ' +
        'de opções.</em></p>' +
        '<h2>SALMO RESPONSORIAL</h2>' +
        '<p><strong>Refrão:</strong> O Senhor é o meu pastor: nada me falta.</p>' +
        '<h2>EVANGELHO</h2>' +
        '<p><em>Texto disponível apenas com ligação.</em></p>',
      parts: [
        {
          title: 'Invitatório',
          order: 1,
          verses: [
            { id: 's1', order: 1, text: '<p>V. Abri, Senhor, os meus lábios.<br>R. E a minha boca anunciará o vosso louvor.</p>' },
            { id: 's2', order: 2, text: '<p><em>Antífona:</em> Vinde, adoremos o Senhor.</p>' }
          ]
        },
        {
          title: 'Laudes',
          order: 2,
          verses: [
            { id: 's3', order: 1, text: '<p>V. Deus, vinde em meu auxílio.<br>R. Senhor, socorrei-me e ajudai-me.</p>' },
            { id: 's4', order: 2, text: '<p>Glória ao Pai e ao Filho e ao Espírito Santo. Como era no princípio, agora e sempre. Amen.</p>' },
            { id: 's5', order: 3, text: '<p><em>Os salmos e leituras do dia só estão disponíveis com ligação à internet.</em></p>' }
          ]
        },
        {
          title: 'Vésperas',
          order: 3,
          verses: [
            { id: 's6', order: 1, text: '<p>V. Deus, vinde em meu auxílio.<br>R. Senhor, socorrei-me e ajudai-me.</p>' },
            { id: 's7', order: 2, text: '<p><em>Os salmos e leituras do dia só estão disponíveis com ligação à internet.</em></p>' }
          ]
        },
        {
          title: 'Completas',
          order: 4,
          verses: [
            { id: 's8', order: 1, text: '<p>V. Deus, vinde em meu auxílio.<br>R. Senhor, socorrei-me e ajudai-me.</p>' },
            { id: 's9', order: 2, text: '<p>Numa noite tranquila e num fim perfeito nos guarde o Senhor omnipotente. Amen.</p>' }
          ]
        }
      ]
    };
  };
})(window);
