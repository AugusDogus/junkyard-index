import { Eye, EyeOff } from "lucide-react";

export function PasswordVisibilityButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      className="text-muted-foreground hover:text-foreground focus-visible:outline-focus absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
