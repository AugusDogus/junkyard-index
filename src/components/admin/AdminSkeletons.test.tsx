import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdminFiguresSkeleton,
  AdminOverviewSkeleton,
  AdminSearchSkeleton,
  AdminSourceSkeleton,
  AdminSourcesSkeleton,
} from "./AdminSkeletons";

// A non-admin's 404 payload carries these too, so they must say nothing
// about the admin pages.
test.each([
  ["overview", AdminOverviewSkeleton],
  ["sources", AdminSourcesSkeleton],
  ["source", AdminSourceSkeleton],
  ["search", AdminSearchSkeleton],
  ["figures", AdminFiguresSkeleton],
])("the %s skeleton holds no text but Loading", (_, Skeleton) => {
  const html = renderToStaticMarkup(<Skeleton />);
  expect(html.replace(/<[^>]*>/g, "")).toBe("Loading");
});
