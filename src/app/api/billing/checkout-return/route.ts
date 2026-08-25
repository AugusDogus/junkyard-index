export function GET(request: Request): Response {
  const searchUrl = new URL("/search", request.url);
  searchUrl.searchParams.set("subscription", "success");
  return Response.redirect(searchUrl, 303);
}
