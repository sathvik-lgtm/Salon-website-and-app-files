/** The h1 and lead paragraph that open every inner page. */
export function PageIntro({
  title,
  children,
  eyebrow,
}: {
  title: string;
  children?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="fade-in mx-auto max-w-6xl px-4 pb-8 pt-12 md:pt-16">
      {eyebrow && <p className="mb-3 text-sm font-medium text-accent">{eyebrow}</p>}
      <h1 className="font-display text-4xl tracking-tight md:text-5xl">{title}</h1>
      {children && <div className="mt-4 max-w-2xl text-lg text-muted">{children}</div>}
    </div>
  );
}
