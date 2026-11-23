import { AdminSourceSkeleton } from "~/components/admin/AdminSkeletons";

// Shapes only: a non-admin's 404 payload carries it too; see AdminSkeletons.
export default function Loading() {
  return <AdminSourceSkeleton />;
}
