/**
 * RAG Result Filter — removes/annotates results that contradict current property facts.
 */

const PROPERTY_FACT_FILTERS = [
  {
    name: 'no_car_rental',
    test: (hostReply) => {
      const lower = (hostReply || '').toLowerCase();
      return (
        lower.includes('ford focus') ||
        lower.includes('tengo un carro') ||
        lower.includes('i have a car') ||
        lower.includes('rent it for') ||
        lower.includes('te lo dejo a') ||
        lower.includes('$65') ||
        lower.includes('65 dollars') ||
        lower.includes('65 por dia') ||
        lower.includes('renting out my vehicle') ||
        (lower.includes('car') && lower.includes('property') && lower.includes('passenger'))
      );
    },
    redact: '[OUTDATED — Julio no longer rents out a car. This reply offered a vehicle that is no longer available. IGNORE this reply entirely for car rental topics. Recommend Dollar Rental or airport rental companies instead.]',
  },
  {
    name: 'no_traffic_hedging',
    test: (hostReply) => {
      const lower = (hostReply || '').toLowerCase();
      return (
        (lower.includes('traffic') && (lower.includes('30') || lower.includes('35') || lower.includes('hour'))) ||
        (lower.includes('trafico') && (lower.includes('30') || lower.includes('35')))
      );
    },
    redact: null,
    annotate: '[NOTE: Ignore the traffic disclaimer in this reply. Julio now gives the distance confidently without hedging: "15-20 minutes away." Do not add traffic caveats.]',
  },
];

function filterRAGResults(relevantConversations) {
  if (!relevantConversations || relevantConversations.length === 0) return [];

  return relevantConversations.map((conv) => {
    for (const filter of PROPERTY_FACT_FILTERS) {
      if (filter.test(conv.hostReply)) {
        if (filter.redact) {
          return { ...conv, hostReply: filter.redact, _filtered: filter.name };
        }
        if (filter.annotate) {
          return { ...conv, hostReply: filter.annotate + '\n\nOriginal reply: ' + conv.hostReply, _filtered: filter.name };
        }
      }
    }
    return conv;
  });
}

module.exports = { filterRAGResults };
