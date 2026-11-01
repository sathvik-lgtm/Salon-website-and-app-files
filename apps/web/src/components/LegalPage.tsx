import { PageIntro } from './PageIntro';

/** Wrapper for the legal pages: a prominent "placeholder" notice, then readable long-form text. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageIntro title={title}>Last updated: {updated}</PageIntro>
      <div className="mx-auto max-w-6xl px-4">
        <div
          role="note"
          className="max-w-3xl rounded-card border border-accent bg-accent-soft p-4 text-sm"
        >
          <p className="font-semibold">Placeholder text. Not legal advice.</p>
          <p className="mt-1">
            This page is draft copy that must be reviewed and replaced by a qualified lawyer before
            the website launches. Anything in [square brackets] still needs a real value.
          </p>
        </div>
        <div className="mt-8 max-w-3xl space-y-4 leading-relaxed [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
          {children}
        </div>
      </div>
    </>
  );
}
