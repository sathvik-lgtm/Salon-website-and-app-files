import Link from 'next/link';
import { buttonClasses } from '@salon/ui';
import { PageIntro } from '../components/PageIntro';

export default function NotFound() {
  return (
    <>
      <PageIntro title="We can't find that page">
        The page may have moved, or the link may be wrong.
      </PageIntro>
      <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-4">
        <Link href="/" className={buttonClasses()}>
          Go to the home page
        </Link>
        <Link href="/branches" className={buttonClasses({ variant: 'secondary' })}>
          Find a branch
        </Link>
      </div>
    </>
  );
}
