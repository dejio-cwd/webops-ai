// Shared unconditional route guard. Never allows a Vercel Function Invocation
// Failed (raw HTML 500) to reach a client. Every unexpected throw is caught,
// logged to Vercel's runtime log via console.error (with the actor/route
// context), and echoed to the client as JSON so the UI can display it.
//
// Security: the error text is derived from Error.message only; stacks are
// logged server-side but never returned. This never bypasses guardApiRequest;
// it wraps it so a network hiccup inside auth can't leak a 500.

// Generic to accept both plain and dynamic-route handlers ({ params }).
export type RouteHandler<C = unknown> = (request: Request, context: C) => Promise<Response> | Response;

export function guard<C = unknown>(name: string, handler: RouteHandler<C>): RouteHandler<C> {
  return async function guardedHandler(request, context) {
    try {
      return await handler(request, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const requestId = request.headers.get("x-vercel-id") || "";
      // Server-side observability. Anyone with Vercel logs access sees the
      // full stack; the client only sees the message.
      console.error(`[route-guard] ${name} threw for ${request.method} ${new URL(request.url).pathname}`, { requestId, message, stack });
      return Response.json(
        { error: `Server error in ${name}: ${message}`, requestId, route: name },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}
