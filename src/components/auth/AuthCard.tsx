import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "~/components/ui/card";

interface AuthCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <main className="flex min-h-svh flex-col sm:items-center sm:justify-center sm:p-4">
      <Card className="sm:bg-card w-full flex-1 gap-8 rounded-none border-0 bg-transparent pt-16 pb-8 shadow-none sm:w-sm sm:flex-none sm:gap-6 sm:rounded-xl sm:border sm:py-6 sm:shadow-sm">
        <CardHeader className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-2xl">
            {title}
          </h1>
          <CardDescription className="text-base sm:text-sm">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
