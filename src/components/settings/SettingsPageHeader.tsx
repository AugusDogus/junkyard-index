export function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="border-border border-b pb-6 sm:pb-8">
      <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
        {title}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-7 text-pretty">
        {description}
      </p>
    </header>
  );
}
