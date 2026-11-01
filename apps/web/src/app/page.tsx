import { brand } from '@salon/config/brand';
import { Button } from '@salon/ui';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl">{brand.name}</h1>
      <p className="mt-2 text-muted">{brand.tagline}</p>
      <Button href="/book" className="mt-8">
        Book appointment
      </Button>
    </main>
  );
}
