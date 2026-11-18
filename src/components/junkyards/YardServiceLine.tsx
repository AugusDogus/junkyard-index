import { YardService } from "~/lib/yard-service";

export function YardServiceLine({
  service,
  hint = false,
}: {
  service: YardService;
  hint?: boolean;
}) {
  const label = YardService.label(service);
  if (!label) return null;
  return (
    <p className="text-muted-foreground text-xs leading-snug">
      <span>Yard type: {label}</span>
      {hint && service.kind === "full_service" && (
        <span className="mt-0.5 block">
          Parts may already be pulled. Call the yard.
        </span>
      )}
    </p>
  );
}
