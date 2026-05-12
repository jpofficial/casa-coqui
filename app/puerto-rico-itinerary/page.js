import AtardecerHero from './components/AtardecerHero';

export const metadata = {
  title: 'Mi Itinerario · Plan your Puerto Rico trip · Casa Coqui',
  description:
    'Free, vetted, day-by-day Puerto Rico itineraries from a local in San Juan. Built by your host at Casa Coqui.',
  openGraph: {
    title: 'Your Puerto Rico, day by day · Mi Itinerario',
    description:
      'Free local-curated San Juan itineraries. No signup.',
  },
};

export default function PlanLandingPage() {
  return <AtardecerHero />;
}
